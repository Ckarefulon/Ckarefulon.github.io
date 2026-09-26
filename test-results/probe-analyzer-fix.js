// Analyzer 防丢数据修复探针 v2 — 真实页面代码 + 仅桩 supabase-js CDN
// Phase1: 在真实页面上找一个能让 A.analyze 抛错的「合法字符不可复原」facelet（毒样本）
// Phase2: 毒记录+好记录共存的完整验证：不连坐/持久化往返/水合不覆写/上传闸门
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const STUB = `(function(){
  window.__sb = { upserts: [], user: { id: 'stub-user-0001', email: 'stub@example.com' } };
  function makeQuery(table){
    var q = { table: table, filters: [] };
    var api = {};
    api.select = function(){ q.kind='select'; return api; };
    api.eq = function(k,v){ q.filters.push([k,v]); return api; };
    api.maybeSingle = function(){ return Promise.resolve({ data: window.__cloudSeed || null, error: null }); };
    api.upsert = function(payload, opts){
      window.__sb.upserts.push({ payload: JSON.parse(JSON.stringify(payload)), opts: opts });
      return Promise.resolve({ data: null, error: null });
    };
    return api;
  }
  window.supabase = { createClient: function(){ return {
    from: makeQuery,
    auth: {
      getSession: function(){ return Promise.resolve({ data: { session: { user: window.__sb.user } }, error: null }); },
      onAuthStateChange: function(cb){ setTimeout(function(){ cb('SIGNED_IN', { user: window.__sb.user }); }, 300); return { data: { subscription: { unsubscribe: function(){} } } }; },
      signOut: function(){ return Promise.resolve({ error: null }); },
      signInWithPassword: function(){ return Promise.resolve({ data: { user: window.__sb.user }, error: null }); },
      signUp: function(){ return Promise.resolve({ data: { user: window.__sb.user, session: null }, error: null }); },
      setSession: function(){ return Promise.resolve({ data: { user: window.__sb.user }, error: null }); }
    }
  };}};
})();`;

const goodSolve = {
  id:'solve-good-1', date:'2026-09-26T10:00:00.000Z', totalTime:12345, flag:'ok', tps:3.2, turnCount:40,
  fluencyPercent:80, analysisType:'CFOP', session:'日常训练', device:'手动计时', scramble:'',
  timestamps:[], moveTimestamps:[], moves:[], rawSolutionSequence:[], startFacelet:'',
  snapshots:[], stateSequence:[], steps:[], analysisFrame:null, analysisVersion:0,
  colorNeutral:false, gyroSamples:[], timingMode:'space', captureType:'manual', source:'手动训练'
};
function makePoison(startFacelet){
  return {
    id:'solve-poison-1', date:'2026-09-26T11:00:00.000Z', totalTime:9999, flag:'ok', tps:null, turnCount:2,
    fluencyPercent:null, analysisType:'CFOP', session:'日常训练', device:'智能魔方', scramble:'',
    timestamps:[100,200], moveTimestamps:[100,200], moves:['R','U'],
    rawSolutionSequence:[{move:'R',timestamp:100},{move:'U',timestamp:200}],
    startFacelet, snapshots:[], stateSequence:[], steps:[], analysisFrame:null, analysisVersion:0,
    colorNeutral:false, gyroSamples:[], timingMode:'state', captureType:'smartcube', source:'智能魔方训练'
  };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -- ' + extra : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext();
  await ctx.route('**/supabase-js@2/**', r => r.fulfill({ status:200, contentType:'application/javascript', body: STUB }));

  // ---------- Phase 1: 找毒样本 ----------
  const page1 = await ctx.newPage();
  await page1.goto('http://localhost:9527/Cube/Analyzer/?probe=p1');
  await page1.waitForTimeout(2000);
  const thrower = await page1.evaluate(() => {
    const A = window.CubeAnalyzerSolveAnalysis;
    const base = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    const cands = [];
    // 单贴纸替换成别的面的字母（保持字符合法，破坏块合法性 → 不可复原）
    for (const i of [4, 13, 22, 31, 40, 49, 1, 10, 28, 46]) {
      for (const rep of ['R','U','F','D','L','B']) {
        if (base[i] !== rep) cands.push(base.slice(0, i) + rep + base.slice(i + 1));
      }
    }
    for (const c of cands) {
      try {
        A.analyze({ method:'CFOP', startFacelet:c, moves:['R'], timestamps:[500], totalTime:500,
          snapshots:[], rawSolutionSequence:[{move:'R',timestamp:500}] });
      } catch (e) { return { facelet: c, err: String(e).slice(0, 80) }; }
    }
    return null;
  });
  if (thrower) console.log('毒样本命中: ' + thrower.facelet.slice(0, 20) + '... err=' + thrower.err);
  else console.log('警告: 未找到会抛错的 facelet，改用静态毒样本（隔离逻辑无法被真实触发验证）');
  await page1.close();

  const poisonSolve = makePoison(thrower ? thrower.facelet : 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');

  // ---------- Phase 2: 完整验证 ----------
  const page = await ctx.newPage();
  const consoleWarnings = [];
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') consoleWarnings.push(m.text()); });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(seed => {
    localStorage.setItem('cubeAnalyzerDataV2', seed.local);
    localStorage.removeItem('cubeAnalyzerSettingsV2');
    // 形状对齐真实行：row = { data: buildLocalPayload(), updated_at }
    window.__cloudSeed = {
      data: { data: { cubeAnalyzerData: { name:'训练数据', solves: seed.cloudSolves }, cubeAnalyzerSettings: {} }, version: 7 },
      updated_at: '2026-09-26T00:00:00Z'
    };
  }, { local: JSON.stringify({ name:'训练数据', solves:[goodSolve, poisonSolve] }), cloudSolves: [1,2,3,4,5] });

  await page.goto('http://localhost:9527/Cube/Analyzer/?probe=p2');
  await page.waitForTimeout(2500);

  if (thrower) {
    const degraded = consoleWarnings.some(t => t.includes('单条记录重新分析失败'));
    check('A1 毒记录触发降级警告而非崩页', degraded);
  }
  const badge1 = await page.evaluate(() => document.querySelector('#totalSolveBadge') && document.querySelector('#totalSolveBadge').textContent);
  check('A2 毒记录不连坐：badge 显示 2 solves', badge1 === '2 solves', 'badge=' + badge1);

  // 水合不得覆写本地（本地磁盘 2 条、云端 5 条）
  const localAfterAuth = await page.evaluate(() => JSON.parse(localStorage.getItem('cubeAnalyzerDataV2')).solves.length);
  check('B1 水合未覆写本地（仍为 2 条）', localAfterAuth === 2, 'local=' + localAfterAuth);

  // 条数回退：save → 自动上传必须被闸（云端 5 > 本地 2）
  const segBtn = await page.evaluate(() => { const b = document.querySelector('#metricSeg button[data-v="ao5"]'); if (b) b.click(); return !!b; });
  check('C0 metricSeg 渲染存在（save 触发可用）', segBtn);
  await page.waitForTimeout(2200);
  let upserts = await page.evaluate(() => window.__sb.upserts.length);
  check('C1 本地<云端时自动上传被闸', upserts === 0, 'upserts=' + upserts);

  // 放行一次后正常上传
  await page.evaluate(() => { window.CubeAnalyzerCloud.allowCountRegressionOnce = true; const b = document.querySelector('#metricSeg button[data-v="ao12"]'); if (b) b.click(); });
  await page.waitForTimeout(2200);
  upserts = await page.evaluate(() => window.__sb.upserts.length);
  check('C2 放行后上传正常执行', upserts === 1, 'upserts=' + upserts);
  if (upserts === 1) {
    const info = await page.evaluate(() => {
      const u = window.__sb.upserts[0];
      return { n: u.payload.data.data.cubeAnalyzerData.solves.length, conflict: u.opts && u.opts.onConflict };
    });
    check('C3 上传 payload 含 2 条 solves 且 onConflict 正确', info.n === 2 && info.conflict === 'user_id,site_scope', JSON.stringify(info));
  }

  // 持久化往返：新开页面（同 localStorage），毒记录降级写回后仍是 2 条
  const page2 = await ctx.newPage();
  await page2.goto('http://localhost:9527/Cube/Analyzer/?probe=p3');
  await page2.waitForTimeout(2500);
  const badge2 = await page2.evaluate(() => document.querySelector('#totalSolveBadge').textContent);
  check('D1 刷新后记录仍在（2 solves）', badge2 === '2 solves', 'badge=' + badge2);

  check('E0 全程无未捕获页面错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  await browser.close();
  console.log('----------------------------------------');
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
