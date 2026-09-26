/* 探针：Analyzer 防覆盖 + Formula 自动同步（串行，9527 单线程） */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const STUB = `(function(){
  window.__sb = { upserts: [], user: { id: 'stub-user-0001', email: 'stub@example.com' } };
  function makeQuery(table){
    var q = { table: table, filters: [] };
    var api = {};
    api.select = function(){ q.kind='select'; return api; };
    api.eq = function(k,v){ q.filters.push([k,v]); return api; };
    api.maybeSingle = function(){
      return Promise.resolve({ data: window.__cloudSeed || null, error: null });
    };
    api.upsert = function(payload, opts){
      window.__sb.upserts.push({ table: q.table, payload: JSON.parse(JSON.stringify(payload)), opts: opts });
      return Promise.resolve({ data: null, error: null });
    };
    return api;
  }
  window.supabase = { createClient: function(url, key){ return {
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

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  => ' + extra : '')); }
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.__errors = errors;
  await ctx.route('**/supabase-js@2/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  /* ============ A. Analyzer ============ */
  {
    const { ctx, page } = await newPage(browser);
    await page.addInitScript(() => {
      // 本地为空（模拟新环境登录），云端种入 3 条 solves
      localStorage.removeItem('cubeAnalyzerDataV2');
      window.__cloudSeed = {
        data: {
          data: { cubeAnalyzerData: { name: '云端数据', solves: [ { id: 'c1' }, { id: 'c2' }, { id: 'c3' } ] } },
          siteScope: 'Cube-Analyzer'
        },
        updated_at: '2026-09-26T10:00:00Z'
      };
    });
    await page.goto('http://localhost:9527/Cube/Analyzer/?probe=hyd1892');
    await page.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem('cubeAnalyzerDataV2') || 'null'); } catch (e) { return null; }
    }, null, { timeout: 8000 }).catch(() => {});
    const hydrated = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2') || 'null');
      return d && Array.isArray(d.solves) ? d.solves.length : -1;
    });
    check('A1 登录后自动载入云端数据（3 条）', hydrated === 3, 'got ' + hydrated);
    const snapKey = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.indexOf('__siteNav_preOverwrite_v1:') === 0).length);
    check('A2 覆盖前留了回滚快照', snapKey >= 1, 'snapshots=' + snapKey);

    // 空数据闸门：本地清空 + 云端有数据 ⇒ 拒绝自动上传
    await page.evaluate(() => {
      window.__sb.upserts.length = 0;
      window.CubeAnalyzerCloud.allowEmptyUploadOnce = false;
      window.storageManager.setJson('cubeAnalyzerDataV2', { name: '训练数据', solves: [] });
      window.CubeAnalyzerCloud.scheduleUpload(50);
    });
    await page.waitForTimeout(600);
    let upserts = await page.evaluate(() => window.__sb.upserts.length);
    check('A3 本地为空+云端有数据 ⇒ 自动上传被拦截', upserts === 0, 'upserts=' + upserts);

    // 显式清空放行一次（真实 clearBtn 同设两个放行旗）
    await page.evaluate(() => {
      window.CubeAnalyzerCloud.allowEmptyUploadOnce = true;
      window.CubeAnalyzerCloud.allowCountRegressionOnce = true;
      window.CubeAnalyzerCloud.scheduleUpload(50);
    });
    await page.waitForTimeout(600);
    let last = await page.evaluate(() => {
      const u = window.__sb.upserts; return u.length ? u[u.length - 1] : null;
    });
    check('A4 显式清空（allowEmptyUploadOnce）放行空上传', !!last, 'no upsert');
    if (last) {
      check('A5 空上传的 site_scope = Cube-Analyzer', last.payload.site_scope === 'Cube-Analyzer', last.payload.site_scope);
    }

    // 正常自动保存：本地 2 条（少于云端 3 条，显式放行后 ⇒ 上传）
    await page.evaluate(() => {
      window.__sb.upserts.length = 0;
      window.storageManager.setJson('cubeAnalyzerDataV2', { name: '训练数据', solves: [ { id: 's1' }, { id: 's2' } ] });
      window.CubeAnalyzerCloud.allowCountRegressionOnce = true;
      window.CubeAnalyzerCloud.scheduleUpload(50);
    });
    await page.waitForTimeout(600);
    last = await page.evaluate(() => {
      const u = window.__sb.upserts; return u.length ? u[u.length - 1] : null;
    });
    check('A6 有数据时自动上传成功', !!last, 'no upsert');
    if (last) {
      check('A7 上传负载带 2 条 solves', last.payload.data.data.cubeAnalyzerData.solves.length === 2);
      check('A8 onConflict = user_id,site_scope', last.opts && last.opts.onConflict === 'user_id,site_scope');
    }
    check('A9 Analyzer 页无 JS 异常', page.__errors.length === 0, page.__errors.join(' | '));
    await ctx.close();
  }

  /* ============ B. Formula ============ */
  {
    const { ctx, page } = await newPage(browser);
    await page.addInitScript(() => {
      window.__cloudSeed = null; // 云端暂无数据
      localStorage.removeItem('cube_memory_progress');
      localStorage.removeItem('smartCubeFormulaEntries');
      localStorage.removeItem('smartCubePracticeStats');
    });
    await page.goto('http://localhost:9527/Cube/Formula/?probe=auto1892');
    await page.waitForFunction(() =>
      !!(window.cloudSyncManager && typeof window.cloudSyncManager.scheduleUpload === 'function' && window.storageManager),
      null, { timeout: 15000 }).catch(() => {});
    const ready = await page.evaluate(() => typeof window.cloudSyncManager.scheduleUpload === 'function');
    check('B1 Formula 加载 scheduleUpload 可用', ready);

    // 模拟用户改数据（走真实 setJson 补丁路径）
    await page.evaluate(() => {
      window.__sb.upserts.length = 0;
      window.storageManager.setJson('smartCubeFormulaEntries', [ { name: '测试公式', alg: 'R U R\u0027 U\u0027' } ]);
    });
    await page.waitForFunction(() => window.__sb.upserts.length > 0, null, { timeout: 6000 }).catch(() => {});
    let last = await page.evaluate(() => {
      const u = window.__sb.upserts; return u.length ? u[u.length - 1] : null;
    });
    check('B2 改数据后自动触发上传', !!last, 'no upsert');
    if (last) {
      check('B3 site_scope = Cube-Formula', last.payload.site_scope === 'Cube-Formula', last.payload.site_scope);
      check('B4 onConflict = user_id,site_scope', last.opts && last.opts.onConflict === 'user_id,site_scope');
      check('B5 负载含 formula 条目', Array.isArray(last.payload.data.data.smartCubeFormulaEntries) && last.payload.data.data.smartCubeFormulaEntries.length === 1);
    }

    // 空数据闸门：本地清空 + 云端种入有数据 ⇒ 自动上传被拦截
    await page.evaluate(() => {
      window.__sb.upserts.length = 0;
      window.__cloudSeed = {
        data: {
          data: { cube_memory_progress: { planText: '云端备份' }, smartCubeFormulaEntries: [ { name: '云' } ] },
          siteScope: 'Cube-Formula'
        },
        updated_at: '2026-09-26T10:00:00Z'
      };
      window.storageManager.removeItem('cube_memory_progress');
      window.storageManager.removeItem('smartCubeFormulaEntries');
      window.storageManager.removeItem('smartCubePracticeStats');
      window.cloudSyncManager.scheduleUpload(50);
    });
    await page.waitForTimeout(800);
    upserts = await page.evaluate(() => window.__sb.upserts.length);
    check('B6 本地为空+云端有数据 ⇒ 自动上传被拦截', upserts === 0, 'upserts=' + upserts);

    // 云端也没数据时，空上传允许（建空行，无危害）
    await page.evaluate(() => {
      window.__sb.upserts.length = 0;
      window.__cloudSeed = null;
      window.cloudSyncManager.scheduleUpload(50);
    });
    await page.waitForFunction(() => window.__sb.upserts.length > 0, null, { timeout: 6000 }).catch(() => {});
    last = await page.evaluate(() => { const u = window.__sb.upserts; return u.length ? u[u.length - 1] : null; });
    check('B7 云端无数据时空上传放行', !!last, 'no upsert');
    check('B8 Formula 页无 JS 异常', page.__errors.length === 0, page.__errors.join(' | '));
    await ctx.close();
  }

  /* ============ C. 冒烟：未登录真实加载（不拦截） ============ */
  for (const url of ['http://localhost:9527/Cube/Analyzer/?probe=smoke', 'http://localhost:9527/Cube/Formula/?probe=smoke']) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    check('C 冒烟无 JS 异常 ' + url.replace('http://localhost:9527', ''), errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log('---');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e); process.exit(2); });
