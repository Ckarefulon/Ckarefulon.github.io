/* 探针：量化「一次页面加载 / 一次打开菜单 / 一次保存」向云端请求了多少次、多少字节
 * 桩只替换 CDN 的 supabase-js，页面真实代码全跑。
 * 场景1：云端是改造之前上传的旧数据（4.4MB、没有指纹块）
 * 场景2：云端已带指纹块（只需几百字节就能判断状态）
 */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const STUB = `(function(){
  window.__sb = { user: { id: 'stub-user-0001', email: 'stub@example.com' }, selects: [], upserts: [], bytes: 0 };
  function makeQuery(table){
    var q = { table: table, cols: '' };
    var api = {};
    api.select = function(cols){ q.cols = cols || '*'; return api; };
    api.eq = function(){ return api; };
    api.maybeSingle = function(){
      var r = null;
      if (q.table === 'user_data' && window.__cloudSeed) {
        var seed = window.__cloudSeed;
        // 模拟 PostgREST 的 JSON 路径投影：select data->meta 时只返回小 meta 块（别名为 meta）
        if (q.cols.indexOf('data->meta') >= 0) {
          var meta = (seed.data && seed.data.data && seed.data.data.meta) || null;
          r = { updated_at: seed.updated_at, meta: meta };
        } else {
          r = { updated_at: seed.updated_at, data: seed.data };
        }
      }
      var size = JSON.stringify(r).length;
      window.__sb.selects.push({ table: q.table, cols: q.cols, bytes: q.table === 'user_data' ? size : 0 });
      if (q.table === 'user_data') window.__sb.bytes += size;
      return Promise.resolve({ data: r, error: null });
    };
    api.upsert = function(payload){
      window.__sb.upserts.push({ payload: JSON.parse(JSON.stringify(payload)), size: JSON.stringify(payload).length });
      return Promise.resolve({ data: null, error: null });
    };
    return api;
  }
  window.supabase = { createClient: function(){ return {
    from: makeQuery,
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: { user: window.__sb.user } }, error: null }); },
      onAuthStateChange: function(cb){ window.__sb.onAuth = cb; return { data: { subscription: { unsubscribe: function(){} } } }; },
      signOut: function(){ return Promise.resolve({ error: null }); },
      signInWithPassword: function(){ return Promise.resolve({ data: { user: window.__sb.user, session: { user: window.__sb.user } }, error: null }); },
      setSession: function(){ return Promise.resolve({ data: { user: window.__sb.user }, error: null }); }
    }
  };}};
})();`;

const KB = 1024;
const fmt = b => (b / KB).toFixed(2) + ' KB';

function bigLegacySeed(n, perRecBytes) {
  const gyro = perRecBytes * 0.88;
  const solves = [];
  for (let i = 0; i < n; i++) {
    solves.push({ id: 'c' + i, moves: 60, gyroSamples: 'g'.repeat(Math.round(gyro)), pad: 'x'.repeat(Math.round(perRecBytes - gyro - 20)) });
  }
  return { data: { data: { cubeAnalyzerData: { name: '云端数据', solves } }, siteScope: 'Cube-Analyzer' }, updated_at: '2026-09-26T10:00:00.000000+00:00' };
}

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  => ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const local = { name: '训练数据', solves: Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, moves: 60, pad: 'x'.repeat(12000) })) };
  const legacySeed = bigLegacySeed(40, 112000);

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await ctx.route('**/supabase-js@2/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.addInitScript(({ local, seed }) => {
    localStorage.clear();
    localStorage.setItem('cubeAnalyzerDataV2', JSON.stringify(local));
    window.__cloudSeed = seed;
  }, { local, seed: legacySeed });

  const resetCounters = () => page.evaluate(() => { window.__sb.selects.length = 0; window.__sb.bytes = 0; window.__sb.upserts.length = 0; });
  const snap = () => page.evaluate(() => ({
    selects: window.__sb.selects.slice(), bytes: window.__sb.bytes,
    upserts: window.__sb.upserts.map(u => u.size), status: (document.getElementById('cloudStatus') || {}).textContent
  }));
  const openMenu = async () => {
    // 直接调检查函数（点头像会切换开关，容易变成「关菜单」而根本不触发检查）
    await page.evaluate(() => window._siteNavCheckCloudDiff && window._siteNavCheckCloudDiff());
    await page.waitForTimeout(2000);
  };

  console.log('云端种子（旧数据，无指纹）: ' + fmt(JSON.stringify(legacySeed).length) + '  /  本机 40 条');

  /* ---------- 场景1：云端还是旧数据（没有指纹块） ---------- */
  await page.goto('http://localhost:9527/Cube/Analyzer/?probe=traffic2');
  await page.waitForTimeout(2500);
  await resetCounters();
  await openMenu();
  let s = await snap();
  console.log('\n[场景1] 云端=旧数据，打开菜单');
  console.log('  请求 ' + s.selects.length + ' 次 | 接收 ' + fmt(s.bytes) + ' | ' + s.selects.map(x => JSON.stringify(x.cols) + '=' + fmt(x.bytes)).join(', '));
  check('1a 旧云端数据仍能正确判定（回退路径不退化）', /已同步|更改|冲突|都有数据|下载/.test(s.status || ''), 'status=' + s.status);

  /* ---------- 场景2：把云端升级成「已带指纹」的状态（等价于上传过一次） ---------- */
  const injected = await page.evaluate(() => {
    // 用页面自己的构造器算指纹，保证与 nav 比对时完全一致
    const p = window.cloudSyncManager.buildLocalPayload();
    const hash = window._siteNavPayloadHash(p.data);
    window.__cloudSeed.data.data.meta = { bytes: JSON.stringify(p.data).length, items: 2, solves: 40, hash: hash };
    return { hash };
  });
  console.log('\n  已把云端种子升级为「带指纹」：hash=' + injected.hash);
  await resetCounters();
  await openMenu();
  s = await snap();
  console.log('\n[场景2] 云端=带指纹（内容与本机一致），打开菜单');
  console.log('  请求 ' + s.selects.length + ' 次 | 接收 ' + fmt(s.bytes) + ' | ' + s.selects.map(x => JSON.stringify(x.cols) + '=' + fmt(x.bytes)).join(', '));
  check('2a 打开菜单不再下载整份数据（接收 < 2KB）', s.bytes < 2048, fmt(s.bytes));
  check('2b 状态显示为已同步', /已同步/.test(s.status || ''), 'status=' + s.status);

  /* ---------- 场景3：一次自动保存 ---------- */
  await resetCounters();
  await page.evaluate(() => { window.CubeAnalyzerCloud.scheduleUpload(50); });
  await page.waitForTimeout(2500);
  s = await snap();
  console.log('\n[场景3] 一次自动保存');
  console.log('  请求 ' + s.selects.length + ' 次 | 接收 ' + fmt(s.bytes) + ' | 上传 ' + s.upserts.length + ' 次，体量 ' + (s.upserts[0] ? fmt(s.upserts[0]) : '-'));
  check('3a 保存前不再下载整份数据（接收 < 2KB）', s.bytes < 2048, fmt(s.bytes));
  check('3b 上传照常发生', s.upserts.length === 1, 'upserts=' + s.upserts.length);
  const hasMeta = await page.evaluate(() => {
    const p = window.cloudSyncManager.buildLocalPayload();
    return !!(p.data.meta && p.data.meta.hash && p.data.meta.solves === 40);
  });
  check('3c 上传的 payload 带正确指纹块（hash + solves=40）', hasMeta);

  /* ---------- 场景4：本机改了数据 → 应显示「本地有未上传更改」且不下载数据 ---------- */
  await resetCounters();
  const verdict = await page.evaluate(async () => {
    // 先把「上次同步指纹」设成当前（未改动）状态的指纹，再新增一条记录
    const p0 = window.cloudSyncManager.buildLocalPayload();
    window._siteNavSyncState = { lastSyncedHash: window._siteNavPayloadHash(p0.data), lastSyncTime: new Date().toISOString(), siteScope: window.getCurrentSiteScope ? window.getCurrentSiteScope() : '' };
    const d = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2'));
    d.solves.push({ id: 'new', moves: 10 });
    localStorage.setItem('cubeAnalyzerDataV2', JSON.stringify(d));
    window._siteNavCheckCloudDiff();
    await new Promise(r => setTimeout(r, 1500));
    return (document.getElementById('cloudStatus') || {}).textContent;
  });
  s = await snap();
  console.log('\n[场景4] 本机新增一条记录后检查状态');
  console.log('  请求 ' + s.selects.length + ' 次 | 接收 ' + fmt(s.bytes) + ' | 状态：' + verdict);
  check('4a 正确识别「本地有未上传更改」', /未上传更改/.test(verdict || ''), 'status=' + verdict);
  check('4b 判定过程同样不下载整份数据（接收 < 2KB）', s.bytes < 2048, fmt(s.bytes));

  if (errs.length) console.log('\n页面报错: ' + errs.join(' | '));
  check('5  页面无 JS 报错', errs.length === 0, errs.join(' | '));

  console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
  await ctx.close();
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
