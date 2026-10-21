/* 计分引擎单元测试（Node 环境，无需浏览器）
 * 运行：node tests/engine.test.js
 */
global.window = global;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
require('../src/js/rules.js');
require('../src/js/store.js');
require('../src/js/engine.js');
require('../src/js/insights.js');

const ZC = global.ZC;
const R0 = ZC.DEFAULT_RULES;
let pass = 0, fail = 0;
const eq = (name, got, want, tol = 1e-9) => {
  const ok = Math.abs(Number(got) - Number(want)) <= tol;
  if (ok) { pass++; console.log(`  ✓ ${name}  = ${got}`); }
  else { fail++; console.log(`  ✗ ${name}  got ${got}, want ${want}`); }
};
const eqs = (name, got, want) => {
  if (String(got) === String(want)) { pass++; console.log(`  ✓ ${name}  = ${got}`); }
  else { fail++; console.log(`  ✗ ${name}  got "${got}", want "${want}"`); }
};
const tru = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };
const P = () => { const p = ZC.blankProfile('t', '彭康书院', '2025—2026'); return p; };
const C = (p, ro) => ZC.compute(p, ZC.mergeRules(R0, ro));

console.log('\n【1】基线与框架');
{
  const p = P(); p.meta.assessPass = true;
  eq('空白档案（仅基准分）总分', C(p).total, 70);
  eq('品行素质分', C(p).pinxing.final, 70);
  eq('能力拓展分', C(p).ability.final, 0);
  eq('奖励分', C(p).reward.final, 0);
  p.meta.assessPass = false;
  eq('评议未通过 → 基准分为 0', C(p).total, 0);
}

console.log('\n【2】品行素质分 · 集体活动（0.6 分/次，上限 3）');
{
  const p = P();
  p.pinxing.collective.entries = [{ id: 'a', name: 'A', times: 4 }];
  eq('4 次 × 0.6', C(p).pinxing.subs.collective.final, 2.4);
  p.pinxing.collective.entries = [{ id: 'a', name: 'A', times: 10 }];
  const s = C(p).pinxing.subs.collective;
  eq('10 次原始 6.0 → 封顶', s.final, 3);
  eq('封顶前原始值保留可审计', s.raw, 6);
  p.pinxing.collective.outstanding = true;
  eq('突出贡献一次性满分', C(p).pinxing.subs.collective.final, 3);
}

console.log('\n【3】品行素质分 · 思想政治理论学习（上限 3）');
{
  const p = P();
  p.pinxing.ideology = { orgTraining: 1, provincialTraining: 0, excellentTrainee: 0 };
  eq('党团培训 1 次', C(p).pinxing.subs.ideology.final, 1);
  p.pinxing.ideology = { orgTraining: 0, provincialTraining: 1, excellentTrainee: 1 };
  eq('省部级 2 + 优秀学员 1', C(p).pinxing.subs.ideology.final, 3);
  p.pinxing.ideology = { orgTraining: 2, provincialTraining: 1, excellentTrainee: 1 };
  const s = C(p).pinxing.subs.ideology;
  eq('原始 2+2+1=5 → 封顶 3', s.final, 3);
  eq('原始值 5', s.raw, 5);
}

console.log('\n【4】品行素质分 · 社会服务（上限 4）');
{
  const p = P();
  p.pinxing.service.volunteerHours = 32;
  eq('志愿 32h = 1 分', C(p).pinxing.subs.service.final, 1);
  p.pinxing.service.volunteerHours = 16;
  eq('志愿 16h 按比例 = 0.5', C(p).pinxing.subs.service.final, 0.5);
  p.pinxing.service.volunteerHours = 100;
  eq('志愿 100h 仍为 1 分', C(p).pinxing.subs.service.final, 1);
  p.pinxing.service = { volunteerHours: 0, schoolPractice: 1, cityIntern: 1, provIntern: 1, advanced: 1 };
  const s = C(p).pinxing.subs.service;
  eq('1+1+2+1 = 5 → 封顶 4', s.final, 4);
  eq('原始 5', s.raw, 5);
}

console.log('\n【5】品行素质分 · 扣分（不设上限）与下限');
{
  const p = P();
  p.pinxing.deductions = [{ id: 'a', type: 'kuangke', count: 3 }, { id: 'b', type: 'weisheng', count: 2 }, { id: 'c', type: 'tongbao', count: 1 }];
  const r = C(p);
  eq('旷课3×1 + 卫生2×1 + 通报1×2 = 7', r.pinxing.deduction, 7);
  eq('品行 = 70 − 7 = 63', r.pinxing.final, 63);
  p.pinxing.deductions = [{ id: 'a', type: 'liuxiao', count: 1 }, { id: 'b', type: 'jiguo', count: 1 }, { id: 'c', type: 'yanzhong', count: 1 }, { id: 'd', type: 'jinggao', count: 1 }, { id: 'e', type: 'tongbao', count: 1 }];
  eq('10+8+6+4+2 = 30', C(p).pinxing.deduction, 30);
  eq('品行 = 70 − 30 = 40', C(p).pinxing.final, 40);
  const p2 = P();
  p2.pinxing.deductions = Array.from({ length: 80 }, (_, i) => ({ id: 'x' + i, type: 'kuangke', count: 1 }));
  eq('扣 80 分 → 下限 0（不出现负分）', C(p2).pinxing.final, 0);
  eq('下限 0 时总分不为负', C(p2).total, 0);
  eq('关闭下限时可为负', C(p2, { pinxing: { floorAtZero: false } }).pinxing.final, -10);
}

console.log('\n【6】能力拓展 · 学术科研竞赛（上限 10）');
{
  const p = P();
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'X', level: 'intl_nat', award: '一等奖' }];
  eq('国家级一等 = 10', C(p).ability.subs.academic.final, 10);
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'X', level: 'intl_nat', award: '特等奖' }];
  eq('国家级特等参照一等 = 10', C(p).ability.subs.academic.final, 10);
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'X', level: 'intl_nat', award: '二等奖' }];
  eq('国家级二等 = 9', C(p).ability.subs.academic.final, 9);
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'X', level: 'prov', award: '二等奖' }, { id: 'b', kind: 'competition', project: 'Y', level: 'school', award: '优秀奖' }];
  eq('省级二等 6 + 校级优秀 1 = 7', C(p).ability.subs.academic.final, 7);
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'X', level: 'intl_nat', award: '一等奖' }, { id: 'b', kind: 'competition', project: 'Y', level: 'intl_nat', award: '一等奖' }];
  const r = C(p);
  eq('两个国家级一等 20 → 封顶 10', r.ability.subs.academic.final, 10);
  eq('溢出被记录', r.ability.subs.academic.raw, 20);
  // 同一项目取最高
  p.ability.academic = [{ id: 'a', kind: 'competition', project: '同一个项目', level: 'prov', award: '一等奖' }, { id: 'b', kind: 'competition', project: '同一个项目', level: 'school', award: '三等奖' }];
  const r2 = C(p);
  eq('同一项目取最高（8，不累计 8+2）', r2.ability.subs.academic.final, 8);
  tru('合并信息被记录到 merged', r2.merged.length >= 1);
  const dropped = r2.ability.subs.academic.items.filter(i => !i._counted);
  tru('被合并的条目标记为未计入', dropped.length === 1 && dropped[0]._pts === 2);
  // 省级无优秀奖
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'X', level: 'prov', award: '优秀奖' }];
  eq('省级无"优秀奖"档 → 0', C(p).ability.subs.academic.final, 0);
}

console.log('\n【7】能力拓展 · 论文 / 专利 / 专著');
{
  const mk = (o) => { const p = P(); p.ability.academic = [Object.assign({ id: 'a', signUnit: '西安交通大学', noMerge: true }, o)]; return p; };
  eq('i 类一作 = 10', C(mk({ kind: 'paper', pubClass: 'i', rank: 1 })).ability.subs.academic.final, 10);
  eq('i 类二作 = 8', C(mk({ kind: 'paper', pubClass: 'i', rank: 2 })).ability.subs.academic.final, 8);
  eq('i 类三作 = 6', C(mk({ kind: 'paper', pubClass: 'i', rank: 3 })).ability.subs.academic.final, 6);
  eq('i 类第五作 = 2', C(mk({ kind: 'paper', pubClass: 'i', rank: 5 })).ability.subs.academic.final, 2);
  eq('ii 类一作 = 6', C(mk({ kind: 'paper', pubClass: 'ii', rank: 1 })).ability.subs.academic.final, 6);
  eq('ii 类四作 = 1', C(mk({ kind: 'paper', pubClass: 'ii', rank: 4 })).ability.subs.academic.final, 1);
  eq('一般期刊一作 = 3', C(mk({ kind: 'paper', pubClass: 'general', rank: 1 })).ability.subs.academic.final, 3);
  eq('一般期刊四作 = 0（无分值）', C(mk({ kind: 'paper', pubClass: 'general', rank: 4 })).ability.subs.academic.final, 0);
  eq('专著一作 = 10', C(mk({ kind: 'book', pubClass: 'book', rank: 1 })).ability.subs.academic.final, 10);
  eq('专著第4位依次递减 = 5', C(mk({ kind: 'book', pubClass: 'book', rank: 4 })).ability.subs.academic.final, 5);
  eq('专著第6位 = 3', C(mk({ kind: 'book', pubClass: 'book', rank: 6 })).ability.subs.academic.final, 3);
  eq('专著参编 = 1', C(mk({ kind: 'book', pubClass: 'book', isEditor: true })).ability.subs.academic.final, 1);
  eq('会议入围优秀论文额外 +1', C(mk({ kind: 'paper', pubClass: 'ii', rank: 3, excellentPaper: true })).ability.subs.academic.final, 5);
  eq('发明专利 = i 类（一作 10）', C(mk({ kind: 'patent', patentType: '发明专利', rank: 1 })).ability.subs.academic.final, 10);
  eq('实用新型 = ii 类（一作 6）', C(mk({ kind: 'patent', patentType: '实用新型专利', rank: 1 })).ability.subs.academic.final, 6);
  eq('软著 = ii 类（二作 5）', C(mk({ kind: 'patent', patentType: '软件著作权', rank: 2 })).ability.subs.academic.final, 5);
  // 署名单位
  const bad = mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: '某外部研究院' });
  const rb = C(bad);
  eq('署名单位非西交大 → 0 分', rb.ability.subs.academic.final, 0);
  tru('并进入 blocked 提示', rb.blocked.length === 1);
  eq('英文署名可识别', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: "Xi'an Jiaotong University" })).ability.subs.academic.final, 10);
  eq('英文缩写署名可识别', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: 'Xian Jiaotong Univ.' })).ability.subs.academic.final, 10);
  eq('XJTU 缩写可识别', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: 'XJTU' })).ability.subs.academic.final, 10);
  eq('西安交通大学第一附属医院可识别', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: '西安交通大学第一附属医院' })).ability.subs.academic.final, 10);
  eq('北京交通大学不误判为西交大', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: '北京交通大学' })).ability.subs.academic.final, 0);
  eq('清华大学不予认定', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: '清华大学' })).ability.subs.academic.final, 0);
  eq('关闭署名校验后可计分', C(mk({ kind: 'paper', pubClass: 'i', rank: 1, signUnit: '某外部研究院' }), { ability: { publication: { mustBeFirstUnit: false } } }).ability.subs.academic.final, 10);
}

console.log('\n【8】能力拓展 · 文体竞赛（上限 6）');
{
  const mk = (o) => { const p = P(); p.ability.culture = [Object.assign({ id: 'a' }, o)]; return p; };
  eq('国家级文艺一等 = 6', C(mk({ kind: 'art', level: 'intl_nat', award: '一等奖' })).ability.subs.culture.final, 6);
  eq('国家级文艺优秀奖 = 3', C(mk({ kind: 'art', level: 'intl_nat', award: '优秀奖' })).ability.subs.culture.final, 3);
  eq('省级文艺二等 = 3.5', C(mk({ kind: 'art', level: 'prov', award: '二等奖' })).ability.subs.culture.final, 3.5);
  eq('校级文艺三等 = 1', C(mk({ kind: 'art', level: 'school', award: '三等奖' })).ability.subs.culture.final, 1);
  eq('校级文艺无优秀奖 → 0', C(mk({ kind: 'art', level: 'school', award: '优秀奖' })).ability.subs.culture.final, 0);
  eq('国家级体育第1名 = 6', C(mk({ kind: 'sport', level: 'intl_nat', award: '第1名' })).ability.subs.culture.final, 6);
  eq('省级体育第4—8名 = 2', C(mk({ kind: 'sport', level: 'prov', award: '第4—8名' })).ability.subs.culture.final, 2);
  eq('校级体育第4—8名 = 0.5', C(mk({ kind: 'sport', level: 'school', award: '第4—8名' })).ability.subs.culture.final, 0.5);
  eq('校级一等 + 破校级纪录 = 2+3', C(mk({ kind: 'sport', level: 'school', award: '第1名', record: true })).ability.subs.culture.final, 5);
  eq('省级一等 + 破省级纪录 = 4+5 = 9 → 封顶 6', C(mk({ kind: 'sport', level: 'prov', award: '第1名', record: true })).ability.subs.culture.final, 6);
  const p = P();
  p.ability.culture = [{ id: 'a', kind: 'art', level: 'prov', award: '一等奖', name: '甲' }, { id: 'b', kind: 'art', level: 'prov', award: '一等奖', name: '乙' }];
  eq('不同项目累计 4+4=8 → 封顶 6', C(p).ability.subs.culture.final, 6);
}

console.log('\n【9】能力拓展 · 任职（上限 4，兼任取最高，任期酌情）');
{
  const mk = (o) => { const p = P(); p.ability.position = [Object.assign({ id: 'a' }, o)]; return p; };
  eq('一档优秀 = 4', C(mk({ tier: 't1', assessment: '优秀' })).ability.subs.position.final, 4);
  eq('一档合格 = 3', C(mk({ tier: 't1', assessment: '合格' })).ability.subs.position.final, 3);
  eq('二档良好 = 3', C(mk({ tier: 't2', assessment: '良好' })).ability.subs.position.final, 3);
  eq('三档优秀（班长） = 2', C(mk({ tier: 't3', assessment: '优秀' })).ability.subs.position.final, 2);
  eq('四档良好（干事） = 0.75', C(mk({ tier: 't4', assessment: '良好' })).ability.subs.position.final, 0.75);
  eq('四档合格（宿舍长） = 0.5', C(mk({ tier: 't4', assessment: '合格' })).ability.subs.position.final, 0.5);
  eq('考核不合格 = 0', C(mk({ tier: 't1', assessment: '不合格' })).ability.subs.position.final, 0);
  // 任期
  eq('满 12 个月不折减', C(mk({ tier: 't3', assessment: '优秀', startDate: '2024-09-01', endDate: '2025-08-31' })).ability.subs.position.final, 2);
  eq('6 个月按比例 → 2×0.5=1', C(mk({ tier: 't3', assessment: '优秀', startDate: '2025-03-01', endDate: '2025-08-31' })).ability.subs.position.final, 1);
  eq('half 口径：6 个月 → 上限 1/2', C(mk({ tier: 't3', assessment: '优秀', startDate: '2025-03-01', endDate: '2025-08-31' }), { ability: { position: { partialTerm: { mode: 'half', custom: 0.5 } } } }).ability.subs.position.final, 1);
  eq('half 口径：11 个月也不超 1/2 → 1', C(mk({ tier: 't3', assessment: '优秀', startDate: '2024-10-01', endDate: '2025-08-31' }), { ability: { position: { partialTerm: { mode: 'half', custom: 0.5 } } } }).ability.subs.position.final, 1);
  eq('none 口径：不满一年 → 0', C(mk({ tier: 't3', assessment: '优秀', startDate: '2025-03-01', endDate: '2025-08-31' }), { ability: { position: { partialTerm: { mode: 'none' } } } }).ability.subs.position.final, 0);
  eq('custom 0.3 口径：2×0.3=0.6', C(mk({ tier: 't3', assessment: '优秀', startDate: '2025-03-01', endDate: '2025-08-31' }), { ability: { position: { partialTerm: { mode: 'custom', custom: 0.3 } } } }).ability.subs.position.final, 0.6);
  // 兼任取最高
  const p = P();
  p.ability.position = [
    { id: 'a', tier: 't4', assessment: '合格', role: '宿舍长' },
    { id: 'b', tier: 't3', assessment: '优秀', role: '班长' },
    { id: 'c', tier: 't2', assessment: '合格', role: '社团副职' }
  ];
  const r = C(p);
  eq('兼任 3 项取最高（2.5）不累加', r.ability.subs.position.final, 2.5);
  eq('仅 1 项被计入', r.ability.subs.position.items.filter(i => i._counted).length, 1);
}

console.log('\n【10】能力拓展总分封顶 20');
{
  const p = P();
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'A', level: 'intl_nat', award: '一等奖' }];
  p.ability.culture = [{ id: 'b', kind: 'art', level: 'intl_nat', award: '一等奖' }];
  p.ability.position = [{ id: 'c', tier: 't1', assessment: '优秀' }];
  eq('10 + 6 + 4 = 20（恰好满）', C(p).ability.final, 20);
  p.ability.culture.push({ id: 'd', kind: 'art', level: 'intl_nat', award: '一等奖', name: '另一项' });
  eq('文体溢出后能力拓展仍为 20', C(p).ability.final, 20);
}

console.log('\n【11】奖励分（上限 5）');
{
  const p = P();
  p.reward.items = [{ id: 'a', category: 'honor', level: 'college' }];
  eq('院级表彰 = 1', C(p).reward.final, 1);
  p.reward.items = [{ id: 'a', category: 'honor', level: 'school' }, { id: 'b', category: 'brave', level: 'city' }];
  eq('校 2 + 市 3 = 5', C(p).reward.final, 5);
  p.reward.items = [{ id: 'a', category: 'honor', level: 'nation' }, { id: 'b', category: 'brave', level: 'prov' }];
  const r = C(p);
  eq('全国 5 + 省 4 = 9 → 封顶 5', r.reward.final, 5);
  eq('原始 9 可审计', r.reward.raw, 9);
  p.reward.items = [{ id: 'a', category: 'deed' }, { id: 'b', category: 'deed' }, { id: 'c', category: 'deed' }];
  eq('做好事 3 项 = 3', C(p).reward.final, 3);
}

console.log('\n【12】总分与理论上限');
{
  const p = P();
  p.pinxing.collective.outstanding = true;
  p.pinxing.ideology = { orgTraining: 1, provincialTraining: 1, excellentTrainee: 1 };
  p.pinxing.service = { volunteerHours: 40, schoolPractice: 1, cityIntern: 1, provIntern: 1, advanced: 1 };
  p.ability.academic = [{ id: 'a', kind: 'competition', project: 'A', level: 'intl_nat', award: '一等奖' }];
  p.ability.culture = [{ id: 'b', kind: 'art', level: 'intl_nat', award: '一等奖' }];
  p.ability.position = [{ id: 'c', tier: 't1', assessment: '优秀' }];
  p.reward.items = [{ id: 'd', category: 'honor', level: 'nation' }];
  const r = C(p);
  eq('品行 70+3+3+4 = 80', r.pinxing.final, 80);
  eq('能力 10+6+4 = 20', r.ability.final, 20);
  eq('奖励 5', r.reward.final, 5);
  eq('理论满分 105', r.total, 105);
  eq('剩余空间 0', r.headroom.total, 0);
}

console.log('\n【13】综合成绩口径');
{
  const p = P();
  p.coursework.score = 90;
  p.pinxing.collective.outstanding = true;
  const r = C(p);   // 综测 = 70 + 3 = 73
  eq('奖学金口径 90×0.8 + 73×0.2 = 86.6', r.composite.total, 86.6);
  eqs('默认口径为奖学金', r.composite.presetId, 'scholarship');
  eq('敏感度 = 0.2', r.composite.sensitivity, 0.2);
  const r2 = C(p, { composite: { preset: 'transfer' } });
  eq('转专业口径 90×0.9 + 73×0.1 = 88.3', r2.composite.total, 88.3);
  const r3 = C(p, { composite: { preset: 'scholarship', normalizeZongce: true } });
  eq('折算百分制 73/105×100 = 69.52', r3.composite.normalized, 69.52, 0.01);
  eq('折算后综合成绩 = 90×0.8 + 69.52×0.2 = 85.9', r3.composite.total, 85.9, 0.02);
  const p2 = P();
  const r4 = C(p2);
  tru('未填课程成绩时标记为不完整', r4.composite.incomplete === true);
}

console.log('\n【14】书院口径覆盖（0.6 → 1.0 分/次）');
{
  const p = P();
  p.pinxing.collective.entries = [{ id: 'a', name: 'A', times: 2 }];
  eq('默认 2 次 × 0.6 = 1.2', C(p).pinxing.subs.collective.final, 1.2);
  eq('覆盖为 1.0/次 → 2 分', C(p, { pinxing: { collective: { perTime: 1 } } }).pinxing.subs.collective.final, 2);
  eq('志愿达标线改为 20h', C((() => { const q = P(); q.pinxing.service.volunteerHours = 20; return q; })(), { pinxing: { service: { volunteerHours: 20 } } }).pinxing.subs.service.final, 1);
}

console.log('\n【15】工作日推算（申诉时效）');
{
  // 2026-10-19 是周一
  eqs('公示 2026-10-16(五) + 3 工作日 = 10-21(三)', ZC.dateStr(ZC.addWorkdays('2026-10-16', 3)), '2026-10-21');
  eqs('公示 2026-10-19(一) + 3 工作日 = 10-22(四)', ZC.dateStr(ZC.addWorkdays('2026-10-19', 3)), '2026-10-22');
  const tl = ZC.appealTimeline('2026-10-19', R0);
  eqs('异议截止', ZC.dateStr(tl.objection), '2026-10-22');
  eqs('答复截止', ZC.dateStr(tl.reply), '2026-10-27');
  eqs('申诉截止', ZC.dateStr(tl.appeal), '2026-10-30');
  eqs('最终处理', ZC.dateStr(tl.final), '2026-11-04');
}

console.log('\n【16】任期月数计算');
{
  eq('2024-09-01 ~ 2025-08-31 = 12 个月', ZC.termMonths('2024-09-01', '2025-08-31'), 12);
  eq('2025-03-01 ~ 2025-08-31 = 6 个月', ZC.termMonths('2025-03-01', '2025-08-31'), 6);
  eq('结束早于开始 → null', ZC.termMonths('2025-08-31', '2025-03-01'), null);
  tru('在职中（无结束日）按今天计 → 非 null', ZC.termMonths('2025-03-01', '') !== null);
  eq('未填开始日 → null', ZC.termMonths('', ''), null);
}

console.log('\n【17】智能提示引擎');
{
  const p = P();
  p.pinxing.service.volunteerHours = 10;
  p.pinxing.deductions = [{ id: 'a', type: 'kuangke', count: 4 }];
  p.ability.academic = [{ id: 'b', kind: 'paper', pubClass: 'i', rank: 1, signUnit: '某外部机构', noMerge: true }];
  p.target.score = 100;
  const r = C(p);
  const ins = ZC.buildInsights(p, R0, r);
  tru('生成提示', ins.length > 5);
  tru('含署名不符风险', ins.some(i => i.title.includes('署名单位')));
  tru('含旷课风险', ins.some(i => i.title.includes('旷课')));
  tru('含志愿时长机会', ins.some(i => i.title.includes('志愿服务还差')));
  tru('含目标差距', ins.some(i => i.title.includes('距离目标')));
  tru('风险类排在最前', ins[0].level === 'danger');
  const rec = ZC.recommend(p, R0, r);
  tru('推荐非空且按 ROI 降序', rec.length > 0 && rec.every((x, i) => i === 0 || rec[i - 1].roi >= x.roi));
  tru('推荐项收益均 > 0', rec.every(x => x.gain > 0));
  // 封顶后不再推荐
  const p2 = P();
  p2.pinxing.collective.outstanding = true;
  const rec2 = ZC.recommend(p2, R0, C(p2));
  tru('集体活动已满 → 不再推荐该机会', !rec2.some(x => x.id === 'collect'));
}

console.log('\n【18】示例档案（首次打开的引导数据）');
{
  const p = ZC.buildDemoProfile();
  const r = C(p, ZC.mergeRules(R0, p.ruleOverride));
  console.log(`  示例：品行 ${r.pinxing.final} + 能力 ${r.ability.final} + 奖励 ${r.reward.final} = ${r.total} / ${r.maxTotal}`);
  console.log(`  综合成绩（${r.composite.preset.name}）= ${r.composite.total}`);
  tru('示例总分在合理区间 (70, 105]', r.total > 70 && r.total <= 105);
  tru('示例能产出提示', ZC.buildInsights(p, ZC.mergeRules(R0, p.ruleOverride), r).length > 3);
  const pos = r.ability.subs.position.items[0];
  tru('示例任职为"在职中"，按预计满一年计 1.5 分', pos._ongoing === true && pos._pts === 1.5);
  tru('并给出中途退任的折减值', pos._ifQuitNow !== undefined && pos._ifQuitNow < 1.5);
  const insD = ZC.buildInsights(p, ZC.mergeRules(R0, p.ruleOverride), r);
  tru('提示中含"在职中"说明', insD.some(i => i.title.includes('在职中')));
}

console.log('\n【19】报表生成（自评表 / CSV）');
{
  const p = ZC.buildDemoProfile();
  const R = ZC.mergeRules(R0, p.ruleOverride);
  const r = C(p, R);
  const md = ZC.buildMarkdownReport(p, R, r);
  const csv = ZC.buildCSV(p, R, r);
  tru('Markdown 含总分', md.includes('## 总分：**' + ZC.fmt(r.total) + '**'));
  tru('Markdown 含计算过程', md.includes('## 计算过程'));
  tru('Markdown 含署名不符/未计入说明或明细行', md.split('\n').length > 40);
  tru('CSV 含 BOM 与表头', csv.charCodeAt(0) === 0xFEFF && csv.includes('大类'));
  tru('CSV 行数 > 8', csv.split('\r\n').length > 8);
  console.log('  ── Markdown 前 12 行预览 ──');
  md.split('\n').slice(0, 12).forEach(l => console.log('  │ ' + l));
}

console.log('\n【20】规则数值被清空 / 填成非法值时的健壮性');
{
  const dirty = [
    { pinxing: { collective: { perTime: '' } } },
    { pinxing: { collective: { perTime: 'abc' } } },
    { pinxing: { collective: { outstandingFull: null } } },
    { pinxing: { caps: { collective: '', ideology: undefined, service: null } } },
    { pinxing: { base: '' } },
    { pinxing: { service: { volunteerHours: 0 } } },
    { pinxing: { service: { volunteerHours: '', volunteerPoint: '' } } },
    { ability: { caps: { academic: '', culture: null, position: 'x' } } },
    { reward: { cap: '' } },
    { frame: { pinxing: '', ability: null, reward: { cap: '' } } },
    { composite: { presets: [{ id: 'scholarship', name: 'x', desc: '', parts: [{ key: 'course', label: 'c', weight: '' }, { key: 'zongce', label: 'z', weight: 'abc' }] }] } }
  ];
  const p = ZC.buildDemoProfile();
  dirty.forEach((ro, i) => {
    const q = ZC.clone(p); q.ruleOverride = ro;
    let r;
    try { r = C(q, ro); } catch (e) { fail++; console.log(`  ✗ 脏规则 #${i} 抛异常：${e.message}`); return; }
    const vals = [r.total, r.pinxing.final, r.ability.final, r.reward.final, r.composite.total, r.maxTotal, r.headroom.total];
    const bad = vals.filter(v => !isFinite(v));
    if (bad.length) { fail++; console.log(`  ✗ 脏规则 #${i} 产生非有限值：${JSON.stringify(vals)}`); }
    else { pass++; console.log(`  ✓ 脏规则 #${i} ${JSON.stringify(Object.keys(ro))} → 总分 ${r.total}（无 NaN/Infinity）`); }
    // 所有视图也要能渲染
    try { ZC.buildInsights(q, ZC.mergeRules(R0, ro), r); pass++; }
    catch (e) { fail++; console.log(`  ✗ 脏规则 #${i} 提示引擎异常：${e.message}`); }
  });
  // 提示文案不应出现 Infinity / NaN
  const q = ZC.clone(p); q.ruleOverride = { pinxing: { collective: { perTime: 0 } } };
  const rq = C(q, { pinxing: { collective: { perTime: 0 } } });
  const ins = ZC.buildInsights(q, ZC.mergeRules(R0, { pinxing: { collective: { perTime: 0 } } }), rq);
  const txt = ins.map(i => i.title + i.body).join(' ');
  tru('单次分值为 0 时提示不含 Infinity/NaN', !/Infinity|NaN/.test(txt));
}

console.log('\n【21】字段联动校正（切换级别/类别后自动修正失效选项）');
{
  const p = P();
  p.ability.culture = [{ id: 'c1', kind: 'art', level: 'prov', award: '优秀奖' }];
  p.ability.culture[0].kind = 'sport';                 // 省级体育没有"优秀奖"这一档
  ZC.fixups(p, 'ability.culture[0].kind');
  eqs('文艺→体育后奖项自动改为有效档', p.ability.culture[0].award, '第3名');
  p.ability.culture[0].kind = 'art';                   // 文艺没有"第3名"这一档
  ZC.fixups(p, 'ability.culture[0].kind');
  eqs('体育→文艺后奖项自动改为有效档', p.ability.culture[0].award, '三等奖');
  const keep = P();
  keep.ability.culture = [{ id: 'c2', kind: 'art', level: 'prov', award: '优秀奖' }];
  ZC.fixups(keep, 'ability.culture[0].level');
  eqs('本来合法的"省级文艺优秀奖"不被改动', keep.ability.culture[0].award, '优秀奖');
  p.ability.academic = [{ id: 'a1', kind: 'competition', level: 'prov', award: '优秀奖' }];
  ZC.fixups(p, 'ability.academic[0].level');
  eqs('省级无优秀奖 → 自动改为三等奖', p.ability.academic[0].award, '三等奖');
  p.ability.academic = [{ id: 'a2', kind: 'paper' }];
  ZC.fixups(p, 'ability.academic[0].kind');
  eqs('切换为论文 → 默认 ii 类', p.ability.academic[0].pubClass, 'ii');
  tru('论文默认不参与同名合并', p.ability.academic[0].noMerge === true);
  p.ability.academic = [{ id: 'a3', kind: 'patent' }];
  ZC.fixups(p, 'ability.academic[0].kind');
  eqs('切换为专利 → 默认实用新型', p.ability.academic[0].patentType, '实用新型专利');
  p.reward.items = [{ id: 'r1', category: 'honor', level: '' }];
  ZC.fixups(p, 'reward.items[0].category');
  eqs('奖励级别为空 → 默认校级', p.reward.items[0].level, 'school');
  p.reward.items = [{ id: 'r2', category: 'deed', level: 'school' }];
  ZC.fixups(p, 'reward.items[0].category');
  eqs('做好事类不强制级别（保持原值）', p.reward.items[0].level, 'school');
  p.pinxing.deductions = [{ id: 'd1', type: 'other', customPer: 3 }];
  ZC.fixups(p, 'pinxing.deductions[0].type');
  p.pinxing.deductions[0].type = 'kuangke';
  ZC.fixups(p, 'pinxing.deductions[0].type');
  tru('切换为非"其他"扣分类型 → 清除自定义分值', p.pinxing.deductions[0].customPer === undefined);
  // 已有合法选项时不应被改动
  const q = P();
  q.ability.culture = [{ id: 'c9', kind: 'art', level: 'school', award: '二等奖' }];
  ZC.fixups(q, 'ability.culture[0].level');
  eqs('合法选项保持不变', ZC.compute(q, R0).ability.subs.culture.final, 1.5);
}

console.log(`\n────────────────────────────\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
