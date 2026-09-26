// 端到端探针：模拟「本地已被陀螺仪采样撑爆」的旧数据，验证修复后能否自愈且不丢记录
// 独立 context，绝不触碰真实数据。
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'http://localhost:9527/Cube/Analyzer/?probe=quota-fix';
const STORAGE = 'cubeAnalyzerDataV2';

function buildRecord(i, gyroSamples, moves) {
  const facelets = Array.from({ length: moves + 1 }, () => 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
  const seq = facelets.map((f, k) => ({ facelet: f, timestamp: k * 300, move: k === 0 ? '' : 'R' }));
  return {
    id: 'solve-' + i, date: new Date(1758800000000 + i * 60000).toISOString(),
    totalTime: 15000 + i * 100, flag: 'ok', tps: 3.5, turnCount: moves, fluencyPercent: 90,
    analysisType: 'CFOP', session: '日常训练', device: 'GAN16', scramble: "R U R' U' F",
    timestamps: Array.from({ length: moves }, (_, k) => k * 300),
    moveTimestamps: Array.from({ length: moves }, (_, k) => k * 300),
    moves: Array.from({ length: moves }, () => 'R'), rawSolutionSequence: [], startFacelet: facelets[0],
    snapshots: seq, stateSequence: seq,
    steps: [{ phase: 'F2L', moves: ['R'], time: 5000, turns: 1 }],
    analysisFrame: null, analysisVersion: 99, colorNeutral: true,
    gyroSamples, timingMode: 'state', captureType: 'smartcube', source: '智能魔方训练'
  };
}
function makeGyro(n) {
  return Array.from({ length: n }, (_, k) => ({ x: 0.123456, y: -0.987654, z: 0.555555, w: 0.444444, timestamp: 1758888888888 + k * 20, deviceName: '智能魔方' }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // ---------- 1. 塞入带陀螺仪的旧记录，直到接近/打满配额 ----------
  const seed = await page.evaluate(({ STORAGE, recs }) => {
    const R = { seeded: 0, chars: 0, failedAt: -1 };
    for (const rec of recs) {
      const cur = JSON.parse(localStorage.getItem(STORAGE) || 'null') || { name: '训练数据', solves: [] };
      cur.solves.push(rec);
      try { localStorage.setItem(STORAGE, JSON.stringify(cur)); R.seeded++; R.chars = localStorage.getItem(STORAGE).length; }
      catch (e) { R.failedAt = R.seeded; break; }
    }
    return R;
  }, { STORAGE, recs: Array.from({ length: 60 }, (_, i) => buildRecord(i, makeGyro(1000), 60)) });

  const before = await page.evaluate((STORAGE) => {
    const raw = localStorage.getItem(STORAGE) || '';
    return { chars: raw.length, solves: (JSON.parse(raw || '{}').solves || []).length, hasGyro: /"gyroSamples":\[\{/.test(raw) };
  }, STORAGE);

  console.log('====== 场景：旧数据被陀螺仪采样撑爆 ======');
  console.log('塞入记录数        :', seed.seeded, seed.failedAt >= 0 ? '(配额在 ' + seed.failedAt + ' 条时打满)' : '');
  console.log('存储占用(字符)    :', before.chars, '(' + (before.chars / 1024 / 1024).toFixed(2) + ' MB / 上限 5.00 MB)');
  console.log('记录条数          :', before.solves);
  console.log('含陀螺仪采样      :', before.hasGyro);

  // ---------- 2. 重新加载真实页面（触发 load() 的自愈迁移 + save()） ----------
  await page.goto(PAGE + '&reload=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const after = await page.evaluate((STORAGE) => {
    const raw = localStorage.getItem(STORAGE) || '';
    const d = JSON.parse(raw || '{}');
    const badge = document.querySelector('#totalSolveBadge');
    // 修复后还应能把一条新记录写进去（模拟"再练一把"）
    const probeRec = { id: 'new-after-fix', date: new Date().toISOString(), totalTime: 12000, flag: 'ok', moves: ['R'], timestamps: [100], snapshots: [], stateSequence: [] };
    d.solves.push(probeRec);
    const writeOk = localStorage.setItem(STORAGE, JSON.stringify(d)) === undefined;
    return {
      chars: raw.length, solves: (d.solves || []).length, hasGyro: /"gyroSamples":\[\{/.test(raw),
      writeOk, badge: badge ? badge.textContent : null
    };
  }, STORAGE);

  console.log('\n====== 修复后同一份数据 ======');
  console.log('存储占用(字符)    :', after.chars, '(' + (after.chars / 1024 / 1024).toFixed(2) + ' MB)   ← 占用下降 ' +
    (100 - Math.round(after.chars / before.chars * 100)) + '%');
  console.log('记录条数          :', after.solves, '(旧 ' + before.solves + ' 条 + 新增 1 条，一条未丢)');
  console.log('仍含陀螺仪采样    :', after.hasGyro, '  ← 应为 false');
  console.log('写入新记录        :', after.writeOk ? '成功' : '失败');

  // ---------- 3. 写入失败不再静默 ----------
  const loud = await page.evaluate(() => {
    // 用递减块把配额填到真正的极限（只留个位数空间）
    let i = 0;
    for (const size of [262144, 65536, 16384, 4096, 1024, 256, 64, 16, 4, 1]) {
      while (true) {
        try { localStorage.setItem('qf_' + i, 'x'.repeat(size)); i++; }
        catch (e) { break; }
      }
    }
    const ret = window.storageManager.setJson('qf_test', { pad: 'y'.repeat(4096) });
    const err = window.storageManager.lastError;
    for (let k = 0; k < i; k++) localStorage.removeItem('qf_' + k);
    localStorage.removeItem('qf_test');
    return { returned: ret, errorName: err && err.name };
  });
  console.log('\n====== 配额真的满了以后 ======');
  console.log('setJson 返回值    :', loud.returned, ' ← 修复前是 undefined 静默，现在必须是 false');
  console.log('记录到的错误      :', loud.errorName);

  const pass =
    after.solves === before.solves + 1 &&
    after.hasGyro === false &&
    after.chars < before.chars * 0.5 &&
    after.writeOk === true &&
    loud.returned === false;
  console.log('\n' + (pass ? '>>> 全部通过：记录一条未丢、体积大幅下降、写入恢复、失败不再静默' : '>>> 有用例未通过'));
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
