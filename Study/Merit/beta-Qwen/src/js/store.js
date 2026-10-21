/* =========================================================================
 * store.js —— 状态管理 / 本地持久化 / 档案 / 撤销 / 导入导出 / 日期工具
 * 无后端：全部数据保存在浏览器 localStorage，可导出 JSON 备份与迁移。
 * ========================================================================= */
(function () {
  const ZC = window.ZC;
  const KEY = 'xjtu_zongce_v3';

  /* 存储层：localStorage 优先，被禁用时（如受限的沙箱预览窗口）降级为内存存储 */
  const mem = {};
  let lsOK = true;
  try { localStorage.setItem(KEY + '__probe', '1'); localStorage.removeItem(KEY + '__probe'); }
  catch (e) { lsOK = false; }
  ZC.storageOK = lsOK;
  const disk = {
    get(k) { try { const v = localStorage.getItem(k); return v === null ? (mem[k] === undefined ? null : mem[k]) : v; } catch (e) { return mem[k] === undefined ? null : mem[k]; } },
    set(k, v) { mem[k] = v; if (!lsOK) return false; try { localStorage.setItem(k, v); return true; } catch (e) { lsOK = false; ZC.storageOK = false; return false; } }
  };

  const state = {
    ready: false,
    version: 3,
    profiles: [],
    activeId: null,
    globalRules: {},          // 用户在设置里改过的校级默认值
    ui: { view: 'dashboard', theme: 'light', sidebarOpen: false, tipsFilter: 'all', expanded: {} },
    lastSaved: null,
    dirty: false
  };
  ZC.state = state;

  /* -------------------------------------------------- 档案读写 */
  /** 取当前正在编辑的档案：模拟模式下返回草稿 */
  ZC.getProfile = () => (state.simMode && state.simDraft) ? state.simDraft
    : (state.profiles.find(p => p.id === state.activeId) || state.profiles[0]);
  /** 取正式档案（模拟模式下用于对比基准） */
  ZC.getRealProfile = () => state.profiles.find(p => p.id === state.activeId) || state.profiles[0];
  ZC.getRules = function (profile) {
    const p = profile || ZC.getProfile();
    return ZC.mergeRules(ZC.mergeRules(ZC.DEFAULT_RULES, state.globalRules), p ? p.ruleOverride : null);
  };

  /** 用空白档案作为模板，递归补全缺失字段（数组整体替换，不做元素级合并） */
  function deepFill(base, over) {
    Object.keys(base).forEach(k => {
      const ov = over ? over[k] : undefined;
      if (ov === undefined) return;
      const bv = base[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && ov && typeof ov === 'object' && !Array.isArray(ov)) deepFill(bv, ov);
      else base[k] = ov;
    });
    Object.keys(over || {}).forEach(k => { if (!(k in base)) base[k] = over[k]; });   // 保留自定义扩展键
    return base;
  }
  function fillProfile(p) {
    const out = deepFill(ZC.blankProfile('x', 'y', 'z'), p || {});
    out.id = (p && p.id) || ZC.uid();
    out.createdAt = (p && p.createdAt) || Date.now();
    out.updatedAt = (p && p.updatedAt) || out.createdAt;
    return out;
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    (raw.profiles || []).forEach((p, i) => { raw.profiles[i] = fillProfile(p); });
    return raw;
  }

  ZC.load = function () {
    let raw = null;
    try { raw = JSON.parse(disk.get(KEY) || 'null'); } catch (e) { console.warn('读取本地数据失败', e); }
    raw = migrate(raw);
    if (raw && raw.profiles && raw.profiles.length) {
      state.profiles = raw.profiles;
      state.activeId = raw.activeId && raw.profiles.some(p => p.id === raw.activeId) ? raw.activeId : raw.profiles[0].id;
      state.globalRules = raw.globalRules || {};
      state.simMode = !!raw.simMode;
      state.simDraft = raw.simDraft || null;
      if (state.simMode && !state.simDraft) state.simMode = false;
      state.ui = Object.assign(state.ui, raw.ui || {});
    } else {
      const demo = ZC.buildDemoProfile();
      state.profiles = [demo];
      state.activeId = demo.id;
      state.globalRules = {};
      state.firstRun = true;          // 首次打开 → 展示引导
    }
    state.version = 3;
    state.ready = true;
    applyTheme();
    return state;
  };

  const payload = () => JSON.stringify({
    version: state.version, profiles: state.profiles, activeId: state.activeId,
    globalRules: state.globalRules, simMode: state.simMode, simDraft: state.simDraft,
    ui: { view: state.ui.view, theme: state.ui.theme, tipsFilter: state.ui.tipsFilter }
  });

  /** 立即同步落盘（关闭页面前 / 测试用） */
  /** 立即落盘；返回 'disk' | 'memory' | false */
  ZC.flushSave = function () {
    try {
      const ok = disk.set(KEY, payload());
      state.dirty = false; state.lastSaved = new Date();
      return ok ? 'disk' : 'memory';
    } catch (e) { return false; }
  };

  let saveTimer = null;
  ZC.save = function (silent) {
    const p = ZC.getProfile(); if (p) p.updatedAt = Date.now();
    state.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const r = ZC.flushSave();
      if (r === false) { ZC.ui && ZC.ui.toast('保存失败：浏览器存储空间不足，请立即导出 JSON 备份', 'danger', 8000); return; }
      if (!silent && ZC.ui) ZC.ui.flashSaved(r === 'memory');
    }, 220);
  };

  /* -------------------------------------------------- 撤销栈 */
  const undoStack = [];
  ZC.snapshot = function (label) {
    undoStack.push({ label: label || '修改', data: JSON.stringify({ profiles: state.profiles, activeId: state.activeId, globalRules: state.globalRules }) });
    if (undoStack.length > 40) undoStack.shift();
  };
  ZC.undo = function () {
    const s = undoStack.pop();
    if (!s) { ZC.ui.toast('没有可撤销的操作', 'muted'); return false; }
    const d = JSON.parse(s.data);
    state.profiles = d.profiles; state.activeId = d.activeId; state.globalRules = d.globalRules;
    ZC.save(true); ZC.ui.toast(`已撤销：${s.label}`, 'ok');
    return true;
  };
  ZC.canUndo = () => undoStack.length > 0;

  /* -------------------------------------------------- 档案 CRUD */
  ZC.addProfile = function (name, college, year, copyFrom) {
    ZC.snapshot('新建档案');
    let p;
    if (copyFrom) { p = ZC.clone(copyFrom); p.id = ZC.uid(); p.createdAt = Date.now(); p.meta.name = name || (copyFrom.meta.name + ' 副本'); p.meta.academicYear = year || copyFrom.meta.academicYear; if (college) p.meta.college = college; }
    else p = ZC.blankProfile(name, college, year);
    state.profiles.push(p); state.activeId = p.id; ZC.save(true);
    return p;
  };
  ZC.deleteProfile = function (id) {
    if (state.profiles.length <= 1) { ZC.ui.toast('至少保留一个档案', 'warn'); return; }
    ZC.snapshot('删除档案');
    const i = state.profiles.findIndex(p => p.id === id);
    if (i < 0) return;
    const nm = state.profiles[i].meta.name;
    state.profiles.splice(i, 1);
    if (state.activeId === id) state.activeId = state.profiles[Math.max(0, i - 1)].id;
    ZC.save(true); ZC.ui.toast(`已删除档案「${nm}」，可撤销`, 'ok', 5000);
  };
  ZC.switchProfile = (id) => { state.activeId = id; ZC.save(true); };

  /* -------------------------------------------------- 路径读写 */
  ZC.getPath = function (obj, path) {
    return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  };
  ZC.setPath = function (obj, path, val) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = val;
  };

  /* -------------------------------------------------- 主题 */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.ui.theme || 'light');
  }
  ZC.toggleTheme = function () {
    state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
    applyTheme(); ZC.save(true);
  };

  /* -------------------------------------------------- 导入 / 导出 */
  ZC.exportJSON = function () {
    const data = { app: 'XJTU 综测算分器', version: state.version, exportedAt: new Date().toISOString(), profiles: state.profiles, globalRules: state.globalRules };
    ZC.download(`综测数据_${ZC.getProfile().meta.name}_${ZC.today()}.json`, JSON.stringify(data, null, 2), 'application/json');
    ZC.ui.toast('已导出 JSON 备份', 'ok');
  };
  ZC.importJSON = function (text) {
    try {
      const d = JSON.parse(text);
      const incoming = migrate(d);
      if (!incoming || !incoming.profiles || !incoming.profiles.length) throw new Error('文件格式不正确');
      ZC.snapshot('导入数据');
      incoming.profiles.forEach(p => { p.id = ZC.uid(); state.profiles.push(p); });
      state.activeId = state.profiles[state.profiles.length - 1].id;
      if (d.globalRules) state.globalRules = d.globalRules;
      ZC.save(true);
      ZC.ui.toast(`已导入 ${incoming.profiles.length} 个档案`, 'ok');
      return true;
    } catch (e) { ZC.ui.toast('导入失败：' + e.message, 'danger', 5000); return false; }
  };
  ZC.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  };
  ZC.today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  /* -------------------------------------------------- 工作日 / 申诉时效 */
  ZC.addWorkdays = function (dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return null;
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; }
    return d;
  };
  ZC.dateStr = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '—';
  ZC.appealTimeline = function (publicityDate, R) {
    const P = (R || ZC.DEFAULT_RULES).procedure;
    const objection = ZC.addWorkdays(publicityDate, P.publicityDays);
    const reply = objection ? ZC.addWorkdays(ZC.dateStr(objection), P.replyDays) : null;
    const appeal = reply ? ZC.addWorkdays(ZC.dateStr(reply), P.appealDays) : null;
    const final = appeal ? ZC.addWorkdays(ZC.dateStr(appeal), P.finalDays) : null;
    return { objection, reply, appeal, final };
  };

  /* -------------------------------------------------- 导出文本：学年总结/材料清单 */
  ZC.buildMarkdownReport = function (profile, R, res) {
    const p = profile;
    const L = [];
    L.push(`# 综合素质测评自评表（${p.meta.academicYear} 学年）`);
    L.push('');
    L.push(`- 姓名：${p.meta.name}　学号：${p.meta.studentId || '—'}`);
    L.push(`- 书院：${p.meta.college}　专业：${p.meta.major || '—'}　班级：${p.meta.grade || '—'}`);
    L.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
    L.push('');
    L.push(`## 总分：**${ZC.fmt(res.total)}** / ${res.maxTotal}`);
    L.push('');
    L.push('| 构成 | 得分 | 满分 |');
    L.push('|---|---|---|');
    L.push(`| 品行素质分 | ${ZC.fmt(res.pinxing.final)} | ${R.frame.pinxing} |`);
    L.push(`| 能力拓展分 | ${ZC.fmt(res.ability.final)} | ${R.frame.ability} |`);
    L.push(`| 奖励分 | ${ZC.fmt(res.reward.final)} | ${R.reward.cap} |`);
    L.push('');
    const sec = (title, rows) => {
      if (!rows.length) return;
      L.push(`### ${title}`); L.push('| 项目 | 分值 | 佐证材料 | 状态 |'); L.push('|---|---|---|---|');
      rows.forEach(r => L.push(`| ${r[0]} | ${r[1]} | ${r[2] || '—'} | ${r[3] || '—'} |`));
      L.push('');
    };
    const st = (id) => ((ZC.EVIDENCE_STATUS.find(s => s.id === id) || {}).label) || '未准备';
    sec('一、品行素质分 · 集体活动', res.pinxing.subs.collective.items.map(i => [i.label + (i.note ? `（${i.note}）` : ''), ZC.fmt(i.points), '', st(i.status)]));
    if (p.meta.assessPass) L.push(`> 基准分：${ZC.fmt(res.pinxing.base)} 分（班级评议合格 + 书院审定通过）\n`);
    sec('一、品行素质分 · 思想政治理论学习', res.pinxing.subs.ideology.items.map(i => [i.label + (i.note ? `（${i.note}）` : ''), ZC.fmt(i.points), '', '']));
    sec('一、品行素质分 · 社会服务', res.pinxing.subs.service.items.map(i => [i.label + (i.note ? `（${i.note}）` : ''), ZC.fmt(i.points), '', '']));
    sec('一、品行素质分 · 扣分', res.pinxing.deductions.map(i => [i.label, '−' + ZC.fmt(i.points), i.note, '']));
    sec('二、能力拓展分 · 学术科研及创新创业', res.ability.subs.academic.items.map(i => [
      `${i.project || i.name || '未命名'}${i._merged && !i._counted ? '（同一项目取最高，未计入）' : ''}`,
      i._counted ? ZC.fmt(i._pts) : '0', i.evidence || '', st(i.status)]));
    sec('二、能力拓展分 · 文体竞赛', res.ability.subs.culture.items.map(i => [
      `${i.name || i.project || '未命名'}${i._merged && !i._counted ? '（同一项目取最高，未计入）' : ''}`,
      i._counted ? ZC.fmt(i._pts) : '0', i.evidence || '', st(i.status)]));
    sec('二、能力拓展分 · 学生组织、社团任职', res.ability.subs.position.items.map(i => [
      `${i.org || ''} ${i.role || ''}（${i._reason}）${i._counted ? '' : '（兼任取最高，未计入）'}`,
      i._counted ? ZC.fmt(i._pts) : '0', i.evidence || '', st(i.status)]));
    sec('三、奖励分', res.reward.items.map(i => [i.name || i._reason, ZC.fmt(i._pts), i.evidence || '', st(i.status)]));
    L.push('## 计算过程');
    L.push('```');
    res.trace.forEach(t => L.push(`${'　'.repeat(t.indent)}${t.label}${t.value !== undefined ? '　' + t.value : ''}${t.note ? '　// ' + t.note : ''}`));
    L.push('```');
    if (res.composite && !res.composite.incomplete) {
      L.push(''); L.push(`## 综合成绩（${res.composite.preset.name}）`);
      L.push(''); L.push(`**${ZC.fmt(res.composite.total)}**　＝　${res.composite.parts.map(x => `${x.label} ${ZC.fmt(x.value)}×${Math.round(x.weight * 100)}%`).join('　+　')}`);
    }
    L.push('');
    L.push('---');
    L.push('> 本表由「综测算分器」依据《西安交通大学本科生综合素质测评成绩评定办法》（2018年5月印发）及其实施细则自动生成，仅供自评与材料准备参考。');
    L.push('> 集体活动单次分值、任职不满一年的酌情幅度等由各书（学）院自行认定，最终以你所在书院当年公示的细则和班级评议结果为准。');
    return L.join('\n');
  };

  ZC.buildCSV = function (profile, R, res) {
    const rows = [['大类', '子类', '项目', '计入分值', '原始分值', '计算依据', '佐证材料', '材料状态', '日期']];
    const st = (id) => ((ZC.EVIDENCE_STATUS.find(s => s.id === id) || {}).label) || '未准备';
    rows.push(['品行素质分', '基准分', '班级评议合格 + 书院审定通过', ZC.fmt(res.pinxing.base), '', '', '', '', '']);
    const sub = (cat, name, o, getLabel) => (o.items || []).forEach(i => rows.push([cat, name, getLabel(i), i._counted === false ? '0' : ZC.fmt(i._pts !== undefined ? i._pts : i.points), ZC.fmt(i._pts !== undefined ? i._pts : i.points), i._reason || i.note || '', i.evidence || '', st(i.status || i._status), i.date || '']));
    sub('品行素质分', '集体活动', res.pinxing.subs.collective, i => i.label);
    sub('品行素质分', '思想政治理论学习', res.pinxing.subs.ideology, i => i.label);
    sub('品行素质分', '社会服务', res.pinxing.subs.service, i => i.label);
    res.pinxing.deductions.forEach(i => rows.push(['品行素质分', '扣分', i.label, '−' + ZC.fmt(i.points), '', i.note, '', st(i.status), i.date]));
    sub('能力拓展分', '学术科研及创新创业', res.ability.subs.academic, i => i.project || i.name || '');
    sub('能力拓展分', '文体竞赛', res.ability.subs.culture, i => i.name || i.project || '');
    sub('能力拓展分', '学生组织任职', res.ability.subs.position, i => `${i.org || ''} ${i.role || ''}`);
    sub('奖励分', '荣誉表彰', res.reward, i => i.name || i._reason);
    rows.push([]); rows.push(['合计', '', '综合素质测评成绩', ZC.fmt(res.total), '', `满分 ${res.maxTotal}`, '', '', '']);
    return '\uFEFF' + rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  };

  /* -------------------------------------------------- 示例档案（首次打开） */
  ZC.buildDemoProfile = function () {
    const p = ZC.blankProfile('示例同学（可删除）', '彭康书院', ZC.currentAcademicYear());
    p.meta.major = '计算机科学与技术'; p.meta.grade = '计算机0001班'; p.meta.studentId = '42xxxxxx01';
    p.pinxing.collective.entries = [
      { id: ZC.uid(), name: '书院迎新晚会', times: 1, date: '', status: 'approved', evidence: '主办单位名单' },
      { id: ZC.uid(), name: '校庆志愿服务方阵', times: 1, date: '', status: 'submitted', evidence: '活动证明' },
      { id: ZC.uid(), name: '书院体育节', times: 2, date: '', status: 'todo', evidence: '' }
    ];
    p.pinxing.ideology = { orgTraining: 2, provincialTraining: 0, excellentTrainee: 1 };
    p.pinxing.service = { volunteerHours: 21, schoolPractice: 1, cityIntern: 0, provIntern: 0, advanced: 0 };
    p.pinxing.deductions = [{ id: ZC.uid(), type: 'weisheng', count: 1, date: '', note: '10 月宿舍卫生检查', status: 'submitted' }];
    p.ability.academic = [
      { id: ZC.uid(), kind: 'competition', project: '"互联网+"大学生创新创业大赛', level: 'prov', award: '二等奖', date: '', status: 'approved', evidence: '获奖证书扫描件', noMerge: false },
      { id: ZC.uid(), kind: 'competition', project: '全国大学生数学建模竞赛', level: 'intl_nat', award: '二等奖', date: '', status: 'approved', evidence: '获奖证书', noMerge: false },
      { id: ZC.uid(), kind: 'patent', project: '一种基于深度学习的排课方法', name: '实用新型专利', patentType: '实用新型专利', rank: 1, signUnit: '西安交通大学', date: '', status: 'submitted', evidence: '专利证书', noMerge: true }
    ];
    p.ability.culture = [
      { id: ZC.uid(), kind: 'art', name: '书院合唱比赛', level: 'school', award: '二等奖', record: false, date: '', status: 'approved', evidence: '获奖证书' }
    ];
    p.ability.position = [
      { id: ZC.uid(), org: '彭康书院学生会', role: '宣传部部长', tier: 't3', assessment: '良好', startDate: ZC.today().slice(0, 4) + '-09-01', endDate: '', status: 'approved', evidence: '任职文件' }
    ];
    p.reward.items = [{ id: ZC.uid(), category: 'honor', level: 'college', name: '院级三好学生', date: '', status: 'approved', evidence: '表彰文件' }];
    p.coursework.score = '86.4';
    p.target.score = '92';
    p.meta.publicityDate = ZC.today();
    p.notes = '这是首次打开时自动生成的示例档案，用来演示各项录入与计分逻辑。点击「设置 → 数据管理 → 清空为全新档案」即可开始记录你自己的数据。';
    return p;
  };
})();
