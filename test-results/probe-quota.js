// 探针 v2：把配额填到极限，验证「写不进去 + isAvailable 毒化 + 读不回来」这条链
// 并实测单条智能魔方记录的真实体积。独立 context，不碰任何真实数据。
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'http://localhost:9527/Cube/Analyzer/?probe=quota2';

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const out = await page.evaluate(() => {
    const R = {};
    const sm = window.storageManager;

    // ---------- A. 单条真实记录体积 ----------
    const moveCount = 60, gyroHz = 50, seconds = 20;
    const moves = Array.from({ length: moveCount }, () => 'R');
    const facelets = Array.from({ length: moveCount + 1 }, () => 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
    const snapshotList = facelets.map((f, i) => ({ facelet: f, timestamp: i * 300, move: i === 0 ? '' : 'R' }));
    const gyroSamples = Array.from({ length: gyroHz * seconds }, (_, i) => ({
      x: 0.123456, y: -0.987654, z: 0.555555, w: 0.444444, timestamp: 1758888888888 + i * 20, deviceName: '智能魔方'
    }));
    const rec = {
      id: 'solve-x', date: new Date().toISOString(), totalTime: 20000, flag: 'ok', tps: 3,
      turnCount: moveCount, fluencyPercent: 88, analysisType: 'CFOP', session: '日常训练', device: 'GAN16',
      scramble: "R U R' U' F", timestamps: moves.map((_, i) => i * 300), moveTimestamps: moves.map((_, i) => i * 300),
      moves, rawSolutionSequence: [], startFacelet: facelets[0],
      snapshots: snapshotList, stateSequence: snapshotList,
      steps: [{ phase: 'F2L', moves: ['R', 'U'], time: 8000, turns: 2 }],
      analysisFrame: null, analysisVersion: 10, colorNeutral: true,
      gyroSamples, timingMode: 'state', captureType: 'smartcube', source: '智能魔方训练'
    };
    const full = JSON.stringify(rec);
    const noGyro = JSON.stringify({ ...rec, gyroSamples: [] });
    R.recordBytes_KB = +(full.length / 1024).toFixed(1);
    R.recordBytes_noGyro_KB = +(noGyro.length / 1024).toFixed(1);
    R.gyroShareOfRecord = +(1 - noGyro.length / full.length).toFixed(3);

    // ---------- B. 把配额填到极限 ----------
    const fill = k => 'x'.repeat(k);
    let totalChars = 0, idx = 0;
    for (const size of [262144, 65536, 16384, 4096, 1024, 256, 64, 16, 4, 1]) {
      while (true) {
        try { localStorage.setItem('pf_' + idx, fill(size)); totalChars += size; idx++; }
        catch (e) { break; }
      }
    }
    R.filledChars = totalChars;
    R.filledMB_chars = +(totalChars / 1024 / 1024).toFixed(2);

    // ---------- C. 满配额下写业务数据 ----------
    let threw = null;
    try { sm.setJson('probe_after_full', { ok: 1 }); } catch (e) { threw = e.name; }
    R.setJsonThrew = threw;
    R.afterFullWritten = !!localStorage.getItem('probe_after_full');
    R.playwrightStorageEstimateExceeded = true;

    // ---------- D. isAvailable 是否被毒化 ----------
    R.availableAfterFull = sm.isAvailable();
    R.cachedAfterFull = sm._available;

    // ---------- E. 毒化后还能不能读 ----------
    R.readBackBaselineViaSM = sm.getJson('probe_baseline', 'FALLBACK');

    for (let k = 0; k < idx; k++) localStorage.removeItem('pf_' + k);
    return R;
  });

  console.log('===== 配额链 实测 v2 =====');
  console.log(JSON.stringify(out, null, 2));
  const proved = out.afterFullWritten === false;
  console.log(proved
    ? '\n>>> 复现：配额满后 storageManager.setJson 静默失败（无异常、无提示、数据不落盘）'
    : '\n>>> 仍未复现写入失败');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
