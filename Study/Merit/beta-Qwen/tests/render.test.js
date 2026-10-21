/* 全视图渲染冒烟测试：用最小 DOM 桩在 Node 中跑通所有页面与关键动作
 * 运行：node tests/render.test.js
 */
'use strict';

/* ---------------------------------------------------------- 最小 DOM 桩 */
class El {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase(); this.id = id || '';
    this._html = ''; this.dataset = {}; this.style = {}; this.children = [];
    this.value = ''; this.checked = false; this.disabled = false; this.selectionStart = 0; this.selectionEnd = 0;
    this._cls = new Set();
    const self = this;
    this.classList = {
      add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c),
      toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; on ? self._cls.add(c) : self._cls.delete(c); return on; },
      contains: (c) => self._cls.has(c)
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text || ''; }
  addEventListener() {} removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  appendChild(c) { this.children.push(c); return c; }
  remove() {} focus() {} click() {} setSelectionRange() {}
  getAttribute(k) { return this.dataset[k]; } setAttribute(k, v) { this.dataset[k] = v; }
  get offsetWidth() { return 100; }
}

const registry = {};
function byId(id) { if (!registry[id]) registry[id] = new El('div', id); return registry[id]; }

global.document = {
  documentElement: new El('html'),
  body: new El('body'),
  activeElement: null,
  getElementById: byId,
  createElement: (t) => new El(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  execCommand: () => true
};
global.window = global;
// Node 22+ 的 navigator 是只有 getter 的全局对象，直接赋值会抛 TypeError
Object.defineProperty(global, 'navigator', { value: { clipboard: null }, configurable: true, writable: true });
global.location = { hash: '' };
global.history = { replaceState: () => {} };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] === undefined ? null : this._d[k]; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.Blob = class { constructor(parts) { this.size = (parts || []).join('').length; } };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.requestAnimationFrame = (fn) => { fn(); return 1; };
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;
global.scrollTo = () => {}; global.print = () => {};
global.addEventListener = () => {}; global.removeEventListener = () => {};
global.dispatchEvent = () => true; global.getComputedStyle = () => ({});
global.CSS = { escape: (s) => s };
global.innerWidth = 1440;

/* ------------------------------------------------------------ 加载应用 */
const path = require('path');
['rules.js', 'engine.js', 'insights.js', 'store.js', 'ui.js', 'views-core.js', 'views-tools.js', 'app.js']
  .forEach(f => require(path.join(__dirname, '../src/js', f)));

const ZC = global.ZC;
let pass = 0, fail = 0;
const errs = [];
function check(name, fn) {
  try { const r = fn(); if (r === false) throw new Error('返回 false'); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; errs.push(`${name}: ${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`); console.log(`  ✗ ${name} → ${e.message}`); }
}

console.log('\n【A】启动');
check('ZC.boot() 无异常', () => { ZC.boot(); });
check('外壳已渲染（含侧栏导航）', () => byId('app').innerHTML.includes('nav__i'));
check('默认视图 = 仪表盘且有内容', () => byId('view').innerHTML.length > 2000);
check('计分条已渲染', () => byId('score-strip').innerHTML.includes('strip__big'));
check('档案名已写入顶栏', () => byId('top-pname').textContent.length > 0);

console.log('\n【B】11 个视图在示例档案下全部可渲染');
const VIEWS = ['dashboard', 'pinxing', 'ability', 'reward', 'composite', 'materials', 'simulate', 'class', 'procedure', 'rulebook', 'settings'];
VIEWS.forEach(v => {
  check(`视图 ${v}`, () => {
    ZC.state.ui.view = v;
    const ctx = ZC.ctx();
    const html = ZC.views[v].render(ctx);
    if (!html || html.length < 200) throw new Error('输出过短 ' + (html || '').length);
    if (html.includes('undefined') && !/undefined分/.test(html)) {
      const i = html.indexOf('undefined');
      throw new Error('模板含 undefined：…' + html.slice(Math.max(0, i - 70), i + 30).replace(/\s+/g, ' ') + '…');
    }
    if (ZC.views[v].after) ZC.views[v].after(ctx);
    return true;
  });
});

console.log('\n【C】极端数据下的渲染健壮性');
function withProfile(mutate, label) {
  check(label, () => {
    const p = ZC.blankProfile('压力测试', '南洋书院', '2025—2026');
    mutate(p);
    ZC.state.profiles.push(p); ZC.state.activeId = p.id;
    VIEWS.forEach(v => {
      ZC.state.ui.view = v;
      const html = ZC.views[v].render(ZC.ctx());
      if (!html || html.length < 100) throw new Error(`视图 ${v} 输出异常`);
      if (html.includes('NaN')) throw new Error(`视图 ${v} 出现 NaN`);
    });
    return true;
  });
}
withProfile(p => {}, '完全空白档案');
withProfile(p => { p.meta.assessPass = false; }, '评议未通过（基准分 0）');
withProfile(p => { p.pinxing.deductions = Array.from({ length: 50 }, (_, i) => ({ id: 'd' + i, type: 'kuangke', count: 2 })); }, '50 条扣分（触发下限 0）');
withProfile(p => {
  p.pinxing.collective.outstanding = true;
  p.pinxing.ideology = { orgTraining: 5, provincialTraining: 5, excellentTrainee: 5 };
  p.pinxing.service = { volunteerHours: 999, schoolPractice: 9, cityIntern: 9, provIntern: 9, advanced: 9 };
  p.ability.academic = Array.from({ length: 12 }, (_, i) => ({ id: 'a' + i, kind: 'competition', project: '同一个项目', level: 'intl_nat', award: '一等奖' }));
  p.ability.culture = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, kind: 'sport', level: 'intl_nat', award: '第1名', record: true, name: '项目' + i }));
  p.ability.position = Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, tier: 't1', assessment: '优秀', startDate: '2020-01-01', endDate: '2025-01-01' }));
  p.reward.items = Array.from({ length: 9 }, (_, i) => ({ id: 'r' + i, category: 'honor', level: 'nation' }));
  p.coursework.score = 99; p.target.score = 105;
}, '全部封顶 + 同项目重复 12 条');
withProfile(p => {
  p.ability.academic = [
    { id: 'x1', kind: 'paper', pubClass: 'i', rank: 1, signUnit: '外部研究所', noMerge: true },
    { id: 'x2', kind: 'patent', patentType: '发明专利', rank: 9, signUnit: '', noMerge: true },
    { id: 'x3', kind: 'book', pubClass: 'book', isEditor: true, signUnit: '西安交通大学', noMerge: true },
    { id: 'x4', kind: 'competition', level: '__不存在__', award: '__不存在__', project: '坏数据' }
  ];
  p.ability.culture = [{ id: 'y1', kind: 'art', level: 'zzz', award: 'zzz' }];
  p.ability.position = [{ id: 'z1', tier: 'zzz', assessment: 'zzz', startDate: 'bad-date', endDate: 'worse' }];
  p.reward.items = [{ id: 'w1', category: 'zzz', level: 'zzz' }];
}, '脏数据 / 非法枚举值 / 错误日期');
withProfile(p => { p.meta.publicityDate = '2020-01-01'; }, '公示日已过（申诉窗口关闭）');
withProfile(p => { p.meta.publicityDate = ZC.today(); }, '公示日为今天（窗口紧急）');
withProfile(p => { p.classmates = [{ id: 'm1', name: '甲', composite: 90, zongce: 95 }, { id: 'm2', name: '乙', composite: 80, zongce: 70 }]; p.coursework.score = 85; }, '班级对比有数据');

console.log('\n【D】书院口径切换后重新渲染');
check('切换集体活动口径 0.6 → 1.0 后各视图正常', () => {
  const p = ZC.getProfile();
  p.pinxing.collective.entries = [{ id: 'e1', name: '活动', times: 4, status: 'todo' }];
  ZC.setPath(p, 'ruleOverride.pinxing.collective.perTime', 1);
  const r = ZC.compute(p, ZC.getRules(p));
  if (r.pinxing.subs.collective.final !== 3) throw new Error('封顶未生效，得 ' + r.pinxing.subs.collective.final);
  VIEWS.forEach(v => { ZC.state.ui.view = v; ZC.views[v].render(ZC.ctx()); });
  return true;
});
check('切换综合成绩口径到崇实书院（三部分权重）', () => {
  const p = ZC.getProfile();
  ZC.setPath(p, 'ruleOverride.composite.preset', 'chongshi');
  p.coursework.score = 88; p.coursework.deyu = 90; p.coursework.pe = 85;
  const r = ZC.compute(p, ZC.getRules(p));
  const want = ZC.r2(90 * 0.2 + 88 * 0.7 + 85 * 0.1);
  if (r.composite.total !== want) throw new Error(`got ${r.composite.total}, want ${want}`);
  ZC.state.ui.view = 'composite'; ZC.views.composite.render(ZC.ctx());
  return true;
});

console.log('\n【E】模拟模式');
check('进入模拟模式后 getProfile 返回草稿', () => {
  const real = ZC.getRealProfile();
  ZC.sim.enter();
  if (!ZC.state.simMode) throw new Error('未进入模拟模式');
  if (ZC.getProfile().id !== real.id) throw new Error('草稿 id 不一致');
  return true;
});
check('25 个快捷模拟按钮全部可用', () => {
  const keys = ['vol32', 'orgtrain', 'provtrain', 'collect', 'practice', 'provint', 'c_sch_1', 'c_sch_3', 'c_prov_2', 'c_nat_3',
    'p_gen', 'p_core', 'p_util', 'a_sch_1', 'a_sch_3', 'a_prov_1', 's_sch_48', 'pos_dorm', 'pos_banz', 'pos_head',
    'r_coll', 'r_school', 'r_deed', 'ded_kuangke', 'ded_weisheng', 'ded_jinggao'];
  keys.forEach(k => {
    ZC.state.ui.view = 'simulate';
    ZC.sim.quick(k);
    const html = ZC.views.simulate.render(ZC.ctx());
    if (!html.includes('对比结果')) throw new Error('快捷项 ' + k + ' 后渲染失败');
  });
  return true;
});
check('草稿改动不影响正式档案', () => {
  const real = ZC.getRealProfile();
  const before = ZC.compute(real, ZC.getRules(real)).total;
  ZC.sim.quick('c_nat_3');
  const afterReal = ZC.compute(ZC.getRealProfile(), ZC.getRules(ZC.getRealProfile())).total;
  if (before !== afterReal) throw new Error('正式档案被污染');
  return true;
});
check('重置草稿', () => { ZC.state.ui.view = 'simulate'; ZC.sim.reset(); ZC.views.simulate.render(ZC.ctx()); return true; });
check('丢弃草稿并退出模拟', () => { ZC.sim.exit(false); if (ZC.state.simMode) throw new Error('未退出'); return true; });
check('应用草稿到正式档案', () => {
  ZC.sim.enter(); ZC.sim.quick('vol32');
  const draftVol = ZC.state.simDraft.pinxing.service.volunteerHours;
  ZC.sim.exit(true);
  if (ZC.getRealProfile().pinxing.service.volunteerHours !== draftVol) throw new Error('未应用');
  return true;
});

console.log('\n【F】列表增删改 / 撤销 / 路径读写');
check('add → del → undo 全链路', () => {
  ZC.state.ui.view = 'ability';
  const p = ZC.getProfile();
  const n0 = p.ability.academic.length;
  ZC.actions.add('academic|academic-comp');
  if (p.ability.academic.length !== n0 + 1) throw new Error('add 失败');
  ZC.actions.add('academic|academic-paper');
  ZC.actions.add('academic|academic-patent');
  ZC.actions.add('academic|academic-book');
  ZC.actions.add('culture|culture-art');
  ZC.actions.add('culture|culture-sport');
  ZC.actions.add('position|position');
  ZC.actions.add('reward|reward');
  ZC.actions.add('collective|collective');
  ZC.actions.add('deduction|kuangke');
  ZC.actions.add('classmate|classmate');
  VIEWS.forEach(v => { ZC.state.ui.view = v; ZC.views[v].render(ZC.ctx()); });
  ZC.actions.del(`ability.academic|${p.ability.academic.length - 1}`);
  if (p.ability.academic.length !== n0 + 3) throw new Error('del 失败');
  ZC.actions.dup('ability.academic|0');
  ZC.actions.move('ability.academic|0|1');
  ZC.undo(); ZC.undo();
  VIEWS.forEach(v => { ZC.state.ui.view = v; ZC.views[v].render(ZC.ctx()); });
  return true;
});
check('setPath / getPath 支持数组下标与自动建层', () => {
  const o = {};
  ZC.setPath(o, 'a.b[2].c', 7);
  if (ZC.getPath(o, 'a.b[2].c') !== 7) throw new Error('读写不一致');
  if (!Array.isArray(o.a.b)) throw new Error('未自动创建数组');
  return true;
});
check('所有条目字段均可通过 data-k 写回', () => {
  const p = ZC.getProfile();
  const paths = [
    ['meta.name', '测试'], ['meta.studentId', '123'], ['meta.college', '仲英书院'], ['meta.major', 'x'], ['meta.grade', 'y'],
    ['meta.academicYear', '2026—2027'], ['meta.assessPass', false], ['meta.publicityDate', '2026-10-19'], ['meta.signedOff', true],
    ['notes', 'n'], ['target.score', 95], ['coursework.score', 88.8], ['coursework.deyu', 90], ['coursework.pe', 80],
    ['pinxing.collective.outstanding', true], ['pinxing.collective.entries[0].name', 'a'], ['pinxing.collective.entries[0].times', 3],
    ['pinxing.collective.entries[0].status', 'approved'], ['pinxing.collective.entries[0].evidence', 'e'],
    ['pinxing.ideology.orgTraining', 2], ['pinxing.service.volunteerHours', 33.5], ['pinxing.service.advanced', 1],
    ['pinxing.deductions[0].type', 'jinggao'], ['pinxing.deductions[0].count', 2], ['pinxing.deductions[0].customPer', 3],
    ['ability.academic[0].kind', 'paper'], ['ability.academic[0].pubClass', 'ii'], ['ability.academic[0].rank', 3],
    ['ability.academic[0].signUnit', 'XJTU'], ['ability.academic[0].excellentPaper', true], ['ability.academic[0].isEditor', true],
    ['ability.academic[0].patentType', '软件著作权'], ['ability.academic[0].group', 'g'], ['ability.academic[0].noMerge', true],
    ['ability.culture[0].kind', 'sport'], ['ability.culture[0].level', 'prov'], ['ability.culture[0].award', '第2名'], ['ability.culture[0].record', true],
    ['ability.position[0].tier', 't2'], ['ability.position[0].assessment', '不合格'], ['ability.position[0].startDate', '2025-01-01'], ['ability.position[0].endDate', '2025-06-30'],
    ['reward.items[0].category', 'deed'], ['reward.items[0].level', 'prov'],
    ['eligibility.scholarship.fail', true], ['eligibility.commend.hygiene', true],
    ['ruleOverride.pinxing.caps.collective', 5], ['ruleOverride.ability.position.partialTerm.mode', 'half'],
    ['ruleOverride.ability.position.partialTerm.custom', 0.4], ['ruleOverride.composite.normalizeZongce', '1'],
    ['ruleOverride.classQuota.te', 2], ['ruleOverride.frame.pinxing', 80], ['ruleOverride.reward.cap', 6]
  ];
  paths.forEach(([k, v]) => { ZC.setPath(p, k, v); if (String(ZC.getPath(p, k)) !== String(v)) throw new Error('写回失败: ' + k); });
  VIEWS.forEach(view => { ZC.state.ui.view = view; const h = ZC.views[view].render(ZC.ctx()); if (h.includes('NaN')) throw new Error(view + ' 出现 NaN'); });
  return true;
});

console.log('\n【G】持久化 / 导入导出 / 报表');
check('保存到 localStorage 并可重新加载', () => {
  ZC.save(true); ZC.flushSave();
  const raw = global.localStorage.getItem('xjtu_zongce_v3');
  if (!raw) throw new Error('未写入');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || !parsed.profiles.length) throw new Error('结构不正确');
  return true;
});
check('导出 JSON → 再导入（迁移逻辑）', () => {
  const raw = global.localStorage.getItem('xjtu_zongce_v3');
  const n0 = ZC.state.profiles.length;
  if (!ZC.importJSON(raw)) throw new Error('导入失败');
  if (ZC.state.profiles.length !== n0 * 2) throw new Error('档案数不对');
  VIEWS.forEach(v => { ZC.state.ui.view = v; ZC.views[v].render(ZC.ctx()); });
  return true;
});
check('缺字段的老档案可被 migrate 补全', () => {
  const legacy = { version: 1, profiles: [{ id: 'old', meta: { name: '老档案' }, pinxing: { service: { volunteerHours: 5 } } }], activeId: 'old' };
  if (!ZC.importJSON(JSON.stringify(legacy))) throw new Error('导入失败');
  const p = ZC.state.profiles[ZC.state.profiles.length - 1];
  if (!p.ability || !p.reward || !p.eligibility || !p.classmates) throw new Error('字段未补全');
  ZC.state.activeId = p.id;
  VIEWS.forEach(v => { ZC.state.ui.view = v; ZC.views[v].render(ZC.ctx()); });
  return true;
});
check('Markdown 自评表 / CSV 生成', () => {
  const p = ZC.getProfile(), R = ZC.getRules(p), r = ZC.compute(p, R);
  const md = ZC.buildMarkdownReport(p, R, r), csv = ZC.buildCSV(p, R, r);
  if (!md.includes('综合素质测评自评表')) throw new Error('MD 缺标题');
  if (!csv.startsWith('\uFEFF')) throw new Error('CSV 缺 BOM');
  if (md.includes('undefined') || csv.includes('undefined')) throw new Error('含 undefined');
  return true;
});
check('档案新建 / 复制 / 切换 / 删除', () => {
  const n0 = ZC.state.profiles.length;
  const src = ZC.getProfile();
  ZC.addProfile('新档案A', '钱学森书院', '2026—2027');
  ZC.addProfile('副本', '启德书院', '2026—2027', src);
  if (ZC.state.profiles.length !== n0 + 2) throw new Error('新建失败');
  ZC.switchProfile(src.id);
  if (ZC.getProfile().id !== src.id) throw new Error('切换失败');
  ZC.deleteProfile(ZC.state.profiles[ZC.state.profiles.length - 1].id);
  VIEWS.forEach(v => { ZC.state.ui.view = v; ZC.views[v].render(ZC.ctx()); });
  return true;
});

console.log('\n【H】动作注册表完整性（模板里出现的 data-act 都有对应处理函数）');
check('扫描所有视图 HTML 中的 data-act', () => {
  const found = new Set();
  VIEWS.forEach(v => {
    ZC.state.ui.view = v;
    const html = ZC.views[v].render(ZC.ctx());
    (html.match(/data-act="([^"]+)"/g) || []).forEach(m => found.add(m.slice(10, -1)));
  });
  // 弹窗内的动作
  ['exportMenu'].forEach(a => found.add(a));
  const missing = [...found].filter(a => typeof ZC.actions[a] !== 'function');
  if (missing.length) throw new Error('缺失动作: ' + missing.join(', '));
  console.log(`    （共 ${found.size} 个动作，全部已注册）`);
  return true;
});
check('扫描所有 data-nav 目标都存在', () => {
  const found = new Set();
  VIEWS.forEach(v => {
    ZC.state.ui.view = v;
    const html = ZC.views[v].render(ZC.ctx()) + (v === 'dashboard' ? ZC.NAV.map(n => n.items.map(i => `data-nav="${i.id}"`).join('')).join('') : '');
    (html.match(/data-nav="([^"]+)"/g) || []).forEach(m => found.add(m.slice(10, -1)));
    (html.match(/href="#\/([a-z]+)"/g) || []).forEach(m => found.add(m.slice(8, -1)));
  });
  const missing = [...found].filter(x => !ZC.views[x]);
  if (missing.length) throw new Error('无效跳转目标: ' + missing.join(', '));
  console.log(`    （共 ${found.size} 个跳转目标，全部有效）`);
  return true;
});
check('扫描所有 data-act="rule" 的原文键都存在', () => {
  const found = new Set();
  VIEWS.forEach(v => {
    ZC.state.ui.view = v;
    const html = ZC.views[v].render(ZC.ctx());
    (html.match(/data-act="rule" data-arg="([^"]+)"/g) || []).forEach(m => found.add(m.split('"')[3]));
  });
  const missing = [...found].filter(k => !ZC.RULE_TEXT[k]);
  if (missing.length) throw new Error('缺失规则原文: ' + missing.join(', '));
  console.log(`    （共 ${found.size} 个规则原文引用，全部有效）`);
  return true;
});
check('扫描所有 data-k 路径都能写入档案对象', () => {
  const found = new Set();
  VIEWS.forEach(v => {
    ZC.state.ui.view = v;
    const html = ZC.views[v].render(ZC.ctx());
    (html.match(/data-k="([^"]+)"/g) || []).forEach(m => found.add(m.slice(8, -1)));
  });
  const p = ZC.getProfile();
  const bad = [];
  found.forEach(k => {
    const base = k.replace(/\[\d+\]/g, '[0]');
    const probe = {};
    try { ZC.setPath(probe, base, 1); ZC.setPath(p, k, ZC.getPath(p, k)); }
    catch (e) { bad.push(k + ' → ' + e.message); }
  });
  if (bad.length) throw new Error('非法路径: ' + bad.join(' | '));
  console.log(`    （共 ${found.size} 个绑定路径，全部可写）`);
  return true;
});

console.log('\n【I】规则手册搜索');
check('搜索"志愿"命中', () => { ZC.state.ui.rbQuery = '志愿'; const h = ZC.views.rulebook.render(ZC.ctx()); if (!h.includes('<mark>')) throw new Error('未高亮'); return true; });
check('搜索"署名"命中', () => { ZC.state.ui.rbQuery = '署名'; return ZC.views.rulebook.render(ZC.ctx()).includes('<mark>'); });
check('搜索不存在词显示空状态', () => { ZC.state.ui.rbQuery = 'zzzz不存在'; return ZC.views.rulebook.render(ZC.ctx()).includes('没有匹配的内容'); });
check('搜索含正则特殊字符不崩溃', () => { ZC.state.ui.rbQuery = '.*+?^${}()|[]\\'; ZC.views.rulebook.render(ZC.ctx()); return true; });
check('清空搜索恢复全部', () => { ZC.state.ui.rbQuery = ''; return ZC.views.rulebook.render(ZC.ctx()).includes('总公式'); });

console.log('\n【J】XSS / 转义');
check('用户输入的尖括号被转义', () => {
  const p = ZC.getProfile();
  p.meta.name = '<img src=x onerror=alert(1)>';
  p.ability.academic = [{ id: 'q1', kind: 'competition', project: '"><script>alert(2)</script>', level: 'prov', award: '一等奖', evidence: '<b>x</b>' }];
  ZC.state.ui.view = 'ability';
  const h = ZC.views.ability.render(ZC.ctx());
  if (h.includes('<script>alert(2)')) throw new Error('未转义');
  if (h.includes('<img src=x onerror')) throw new Error('姓名未转义');
  ZC.state.ui.view = 'materials';
  const h2 = ZC.views.materials.render(ZC.ctx());
  if (h2.includes('<b>x</b>')) throw new Error('材料字段未转义');
  ZC.state.ui.view = 'dashboard';
  ZC.views.dashboard.render(ZC.ctx());
  p.meta.name = '示例同学（可删除）';
  return true;
});

console.log(`\n────────────────────────────\n结果：${pass} 通过 / ${fail} 失败\n`);
if (errs.length) { console.log('失败详情：'); errs.forEach(e => console.log(' • ' + e)); }
process.exit(fail ? 1 : 0);
