/* 探针：云同步 payload 应用层 gzip 压缩
 * A. 纯 codec 往返：4MB 级数据 pack → 大小对比 + unpack → 深比较相等
 * B. Analyzer 真代码链路（stub supabase）：
 *    B1 上传后 stub 捕获的 payload 是压缩壳（enc=gzip+b64、meta 顶层明文、体积大幅下降）
 *    B2 云端是压缩壳 → downloadCloudToLocal 解包成功，40 条记录全部落本地
 *    B3 云端是旧明文数据 → 原样应用（兼容）
 *    B4 light 状态查询走壳顶层 meta（条数闸门不弱化）
 *    B5 getCloudStatus() full 返回解包后的明文
 */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const STUB = `(function(){
  window.__sb = { user: { id: 'stub-user-0001', email: 'stub@example.com' }, selects: [], upserts: [], stored: null };
  function makeQuery(table){
    var q = { table: table, cols: '' };
    var api = {};
    api.select = function(cols){ q.cols = cols || '*'; return api; };
    api.eq = function(){ return api; };
    api.maybeSingle = function(){
      var r = null;
      if (q.table === 'user_data' && window.__cloudRow) {
        if (q.cols.indexOf('data->meta') >= 0) {
          // 模拟真实 PostgREST 双投影：top_meta = payload['meta']，inner_meta = payload['data']['meta']
          var payload0 = window.__cloudRow.data;
          r = { updated_at: window.__cloudRow.updated_at,
            top_meta: (payload0 && payload0.meta !== undefined) ? payload0.meta : null,
            inner_meta: (payload0 && payload0.data && payload0.data.meta) || null };
        } else if (q.cols === 'data') {
          r = { data: window.__cloudRow.data };
        } else {
          r = { data: window.__cloudRow.data, updated_at: window.__cloudRow.updated_at };
        }
      }
      var size = JSON.stringify(r || {}).length;
      window.__sb.selects.push({ table: q.table, cols: q.cols, bytes: q.table === 'user_data' ? size : 0 });
      return Promise.resolve({ data: r, error: null });
    };
    api.upsert = function(payload){
      window.__sb.upserts.push({ size: JSON.stringify(payload).length, data: payload.data });
      window.__cloudRow = { data: JSON.parse(JSON.stringify(payload.data)), updated_at: payload.updated_at };
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

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (e ? '  => ' + e : '')); } };
const fmt = b => (b / 1024).toFixed(1) + ' KB';

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function makeLocalSolves(n, padPerRec) {
  const solves = [];
  for (let i = 0; i < n; i++) {
    solves.push({ id: 's' + i, moves: 60, timeMs: 12000 + i, pad: 'x'.repeat(padPerRec),
      steps: [{ stage: 'F2L', t: 3200 }], solution: "R U R' U'".repeat(8) });
  }
  return { name: '训练数据', solves };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  /* ---------- A. 纯 codec 往返（独立小页面，只引 codec） ---------- */
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const data = { cubeAnalyzerData: makeLocalSolves(40, 45000), cubeAnalyzerSettings: { theme: 'dark' } };
    data.meta = { bytes: JSON.stringify(data).length, items: 2, solves: 40, hash: 'deadbeefdeadbeef' };
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ path: require('path').join(
      'C:/Users/Vxiao/OneDrive - Ckarefulon/-------  Careful S.  -------/Careful S/Program/Github/Ckarefulon.github.io',
      'assets/services/sync/payload-codec.js') });
    const out = await page.evaluate(async (raw) => {
      const payload = { exportedAt: '2026-09-26T15:00:00Z', source: 'Ckarefulon', siteScope: 'Cube-Analyzer', version: 7, data: raw };
      const t0 = performance.now();
      const packed = await window.SitePayloadCodec.packPayload(payload);
      const packMs = performance.now() - t0;
      const t1 = performance.now();
      const plain = await window.SitePayloadCodec.unpackPayloadData(packed.data);
      const unpackMs = performance.now() - t1;
      return {
        supported: window.SitePayloadCodec.supported(),
        isShell: window.SitePayloadCodec.isCompressedPayloadData(packed.data),
        rawSize: JSON.stringify(payload).length,
        packedSize: JSON.stringify(packed).length,
        metaTop: packed.data.meta && packed.data.meta.hash !== undefined,
        roundTrip: JSON.stringify(plain) === JSON.stringify(raw),
        plainOfLegacy: JSON.stringify(await window.SitePayloadCodec.unpackPayloadData(raw)) === JSON.stringify(raw),
        packMs: Math.round(packMs), unpackMs: Math.round(unpackMs)
      };
    }, data);
    console.log('  原始 ' + fmt(out.rawSize) + ' → 压缩 ' + fmt(out.packedSize) +
      '（' + (out.packedSize / out.rawSize * 100).toFixed(1) + '%）  pack ' + out.packMs + 'ms / unpack ' + out.unpackMs + 'ms');
    check('A1 浏览器支持 CompressionStream', out.supported === true);
    check('A2 pack 产出压缩壳', out.isShell === true);
    check('A3 meta 在壳顶层明文（轻量查询可用）', out.metaTop === true);
    check('A4 往返解包与原始数据深相等', out.roundTrip === true);
    check('A5 旧明文数据 unpack 原样返回', out.plainOfLegacy === true);
    check('A6 压缩率 ≤ 25%（传输量至少省 3/4）', out.packedSize <= out.rawSize * 0.25, fmt(out.packedSize));
    await ctx.close();
  }

  /* ---------- B. Analyzer 真代码链路 ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await ctx.route('**/assets/vendor/supabase/supabase.min.js*', r =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
    const local = makeLocalSolves(40, 8000);
    await page.addInitScript(seed => {
      localStorage.clear();
      localStorage.setItem('cubeAnalyzerDataV2', JSON.stringify(seed));
      window.__cloudRow = null;
    }, local);
    await page.goto('http://localhost:9527/Cube/Analyzer/?probe=compress');
    await page.waitForTimeout(2500);

    // B1 上传 → 压缩壳（upsert VALUES.data = 完整 payload，壳在其 .data）
    const up = await page.evaluate(async () => {
      const r = await window.cloudSyncManager.uploadLocalToCloud();
      const u = window.__sb.upserts[window.__sb.upserts.length - 1];
      const shell = u.data && u.data.data;
      const plainSize = JSON.stringify({ cubeAnalyzerData: JSON.parse(localStorage.getItem('cubeAnalyzerDataV2')), cubeAnalyzerSettings: {} }).length;
      return { r, size: u.size, enc: shell && shell.enc, metaTop: !!(shell && shell.meta && shell.meta.solves === 40),
        hasBlob: typeof (shell && shell.blob) === 'string', plainSize };
    });
    console.log('  上传明文 ' + fmt(up.plainSize) + ' → 实际 upsert ' + fmt(up.size));
    check('B1a 上传成功', up.r.success === true, up.r.message);
    check('B1b 上传的是压缩壳（enc=gzip+b64 + blob）', up.enc === 'gzip+b64' && up.hasBlob === true);
    check('B1c meta 顶层明文且条数 40', up.metaTop === true);
    check('B1d upsert 体积 ≤ 明文 25%', up.size <= up.plainSize * 0.25, fmt(up.size));

    // B2 下载 → 解包应用
    const down = await page.evaluate(async () => {
      localStorage.setItem('cubeAnalyzerDataV2', JSON.stringify({ name: '空', solves: [] }));
      const r = await window.cloudSyncManager.downloadCloudToLocal();
      const cur = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2'));
      return { r, count: cur && cur.solves ? cur.solves.length : 0, name: cur && cur.name };
    });
    check('B2a 压缩壳下载恢复成功', down.r.success === true, down.r.message);
    check('B2b 40 条记录全部落本地', down.count === 40, String(down.count));

    // B3 旧明文兼容（种子按真实层级：row.data = payload 层；结束后恢复壳供 B4/B5 使用）
    const legacy = await page.evaluate(async () => {
      const backup = window.__cloudRow;
      window.__cloudRow = {
        data: { data: { cubeAnalyzerData: { name: '旧数据', solves: [{ id: 'old1' }] }, cubeAnalyzerSettings: {} } },
        updated_at: '2026-09-01T00:00:00Z'
      };
      const r = await window.cloudSyncManager.downloadCloudToLocal();
      const cur = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2'));
      window.__cloudRow = backup;
      return { r, name: cur && cur.name, count: cur && cur.solves ? cur.solves.length : 0 };
    });
    check('B3a 旧明文数据原样恢复', legacy.r.success === true && legacy.name === '旧数据' && legacy.count === 1,
      legacy.r.message);

    // B4 light 查询走壳顶层 meta（先恢复 B2 的云端壳，避免 B3 种子污染）
    const light = await page.evaluate(async () => {
      const s = await window.cloudSyncManager.getCloudStatus({ light: true });
      return { meta: s.cloudMeta, bytes: window.__sb.selects[window.__sb.selects.length - 1].bytes };
    });
    check('B4a light 状态拿到 meta（solves=40）', light.meta && light.meta.solves === 40, JSON.stringify(light.meta));
    check('B4b light 查询仍为几百字节级', light.bytes < 512, light.bytes + ' B');

    // B5 full 查询返回明文
    const full = await page.evaluate(async () => {
      const s = await window.cloudSyncManager.getCloudStatus();
      const blk = s.cloudData && s.cloudData.data; // cloudData 是 payload 层，业务块在其 .data
      return { enc: blk && blk.enc, count: blk && blk.cubeAnalyzerData && Array.isArray(blk.cubeAnalyzerData.solves) ? blk.cubeAnalyzerData.solves.length : 0 };
    });
    check('B5 full 查询自动解包成明文（40 条）', full.enc === undefined && full.count === 40, JSON.stringify(full));

    check('B6 页面无报错', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
  process.exit(fail ? 1 : 0);
})();
