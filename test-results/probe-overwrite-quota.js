/* 探针：覆盖前快照在「本机存储快满」时还能不能保存（对应「导入失败：无法保存覆盖前状态」）
 * 场景A：空间充足 ⇒ 保存完整快照
 * 场景B：配额只剩一个 256KB 块 ⇒ 完整快照放不下，应自动降级为精简快照（记录一条不少）
 * 场景C：精简快照也能正常回滚（记录条数与成绩保留）
 */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (e ? '  => ' + e : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  async function fresh() {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
    await page.goto('http://localhost:9527/Cube/Analyzer/?probe=snapshot');
    await page.waitForTimeout(1500);
    return { ctx, page, errs };
  }

  const MAKE_LOCAL = `
    const recs = [];
    for (let i = 0; i < 40; i++) {
      recs.push({ id: 's' + i, moves: 60, timeMs: 12000, pad: 'x'.repeat(1500),
        snapshots: 'S'.repeat(3000), stateSequence: 'Q'.repeat(3000), steps: [{ stage: 'F2L' }] });
    }
    localStorage.setItem('cubeAnalyzerDataV2', JSON.stringify({ name: '训练数据', solves: recs }));
  `;

  /* ---------- 场景A：空间充足 ---------- */
  {
    const { ctx, page, errs } = await fresh();
    const r = await page.evaluate(`(() => { ${MAKE_LOCAL}; return 'ok'; })()`);
    const out = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2'));
      const guard = window._siteNavPrepareOverwrite('本地备份导入', { cubeAnalyzerData: { name: '导入数据', solves: [{ id: 'imp' }] }, cubeAnalyzerSettings: {} }, { source: 'test' });
      const snap = window._siteNavPrepareOverwrite && JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.indexOf('__siteNav_preOverwrite_v1') === 0)) || 'null');
      return { guard: { success: guard.success, compacted: guard.compacted }, snapCompacted: snap && snap.compacted, chain: !!(snap && snap.payload && snap.payload.data), keptSnapshots: !!(snap && snap.payload.data.cubeAnalyzerData.solves[0] && snap.payload.data.cubeAnalyzerData.solves[0].snapshots) };
    });
    console.log('\n[场景A] 空间充足');
    console.log('  ' + JSON.stringify(out));
    check('A1 保存成功', out.guard.success === true);
    check('A2 用的是完整快照（compacted=false）', out.guard.compacted === false && out.keptSnapshots === true);
    check('A3 快照带 payload.data 结构（可回滚）', out.chain === true);
    check('A4 无页面报错', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  /* ---------- 场景B/C：配额几乎打满 ---------- */
  {
    const { ctx, page, errs } = await fresh();
    const out = await page.evaluate(`(() => {
      // 数据：40 条 × (pad 4000 + snapshots 4000 + stateSequence 4000) ≈ 480KB
      // ⇒ 完整快照约 480KB，精简快照约 165KB（只剩 pad）
      const recs = [];
      for (let i = 0; i < 40; i++) {
        recs.push({ id: 's' + i, moves: 60, timeMs: 12000, pad: 'x'.repeat(4000),
          snapshots: 'S'.repeat(4000), stateSequence: 'Q'.repeat(4000), steps: [{ stage: 'F2L' }] });
      }
      localStorage.setItem('cubeAnalyzerDataV2', JSON.stringify({ name: '训练数据', solves: recs }));

      // 用 64KB 小块填到「刚好写不下」，再腾出 3 块 ⇒ 剩余空间约 192~256KB
      const chunk = 'y'.repeat(65536);
      let i = 0;
      try { for (; i < 200; i++) { localStorage.setItem('__fill_' + i, chunk); } } catch (e) {}
      for (let k = 1; k <= 3; k++) { if (i - k >= 0) { localStorage.removeItem('__fill_' + (i - k)); } }
      const fillOk = i;

      const before = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2')).solves.length;
      const guard = window._siteNavPrepareOverwrite('本地备份导入', { cubeAnalyzerData: { name: '导入数据', solves: [{ id: 'imp' }] }, cubeAnalyzerSettings: {} }, { source: 'test' });
      const key = Object.keys(localStorage).find(k => k.indexOf('__siteNav_preOverwrite_v1') === 0);
      const snap = key ? JSON.parse(localStorage.getItem(key)) : null;
      const solves = snap && snap.payload && snap.payload.data && snap.payload.data.cubeAnalyzerData ? snap.payload.data.cubeAnalyzerData.solves : null;
      const res = {
        fillOk: fillOk,
        guard: { success: guard.success, compacted: guard.compacted, message: guard.message || '' },
        snapCompacted: snap && snap.compacted,
        snapReason: snap && snap.reason,
        keptCount: solves ? solves.length : -1,
        firstId: solves && solves[0] ? solves[0].id : '',
        firstTime: solves && solves[0] ? solves[0].timeMs : 0,
        hasHeavy: !!(solves && solves[0] && (solves[0].snapshots || solves[0].stateSequence || solves[0].steps)),
        before: before
      };
      // 回滚：把快照写回本地，确认记录条数与成绩都在
      window.cloudSyncManager.applyDataToLocalStorage(snap.payload.data);
      const after = JSON.parse(localStorage.getItem('cubeAnalyzerDataV2'));
      res.afterCount = after.solves.length;
      res.afterTime = after.solves[0] ? after.solves[0].timeMs : 0;
      return res;
    })()`);
    console.log('\n[场景B] 配额几乎打满（填了 ' + out.fillOk + ' 块 256KB 后只剩 1 块空间）');
    console.log('  ' + JSON.stringify(out.guard) + ' | compacted=' + out.snapCompacted + ' | reason=' + out.snapReason);
    console.log('  快照内记录数=' + out.keptCount + ' (源 ' + out.before + ') | 首条 ' + out.firstId + '/' + out.firstTime + 'ms | 含重型轨迹=' + out.hasHeavy);
    check('B1 配额紧张时不再报「无法保存覆盖前状态」', out.guard.success === true, out.guard.message);
    check('B2 自动降级为精简快照', out.snapCompacted === true && out.guard.compacted === true);
    check('B3 记录一条不少（40 条）', out.keptCount === 40, 'kept=' + out.keptCount);
    check('B4 精简快照已去掉重型轨迹数据', out.hasHeavy === false);
    check('C1 回滚后记录条数不变', out.afterCount === 40, 'after=' + out.afterCount);
    check('C2 回滚后成绩保留', out.afterTime === 12000, 'time=' + out.afterTime);
    check('C3 无页面报错', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
