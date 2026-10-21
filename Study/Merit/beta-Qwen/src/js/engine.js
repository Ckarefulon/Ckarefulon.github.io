/* =========================================================================
 * engine.js —— 计分引擎
 * 设计原则：
 *  1) 纯函数：compute(profile, rules) -> result，不修改入参
 *  2) 全程可审计：每一个分值都带 label / raw / capped / reason，
 *     用户能看到"原始合计 → 封顶 → 最终"的每一步
 *  3) 封顶、去重（同一项目取最高）、任职取最高，全部在引擎内完成
 * ========================================================================= */
(function () {
  const ZC = window.ZC;

  const r2 = (n) => Math.round((+n + Number.EPSILON) * 100) / 100;
  /** 规则数值安全转换：用户可能把设置里的数字清空或填成非法值 */
  const num = (v, dflt) => { const n = parseFloat(v); return isFinite(n) ? n : (dflt === undefined ? 0 : dflt); };
  ZC.r2 = r2;
  ZC.fmt = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const v = r2(n);
    return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : String(v);
  };
  ZC.signed = (n) => (n > 0 ? '+' : '') + ZC.fmt(n);

  /* ------------------------------------------------- 单项：学术成果计分 */
  function scoreAcademic(item, R) {
    const out = { points: 0, reason: '', blocked: false };
    const kind = item.kind || 'competition';

    if (kind === 'competition') {
      const lv = (R.ability.competition.levels || []).find(l => l.id === item.level);
      if (!lv) { out.reason = '未选择竞赛级别'; return out; }
      const v = lv.awards[item.award];
      if (v === undefined || v === null) { out.reason = `「${lv.label}」无「${item.award || '未选奖项'}」档`; return out; }
      out.points = num(v); out.reason = `${lv.label} · ${item.award}`;
      return out;
    }

    // 论文 / 专利 / 专著：署名单位校验
    if (R.ability.publication.mustBeFirstUnit) {
      const unit = String(item.signUnit || '').trim();
      const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
      const pats = R.ability.publication.firstUnitPatterns || ['西安交通', 'xjtu', 'xianjiaotong'];
      const nu = norm(unit);
      const ok = !!nu && pats.some(a => nu.includes(norm(a)));
      if (!ok) {
        out.blocked = true;
        out.reason = unit ? `第一署名单位「${unit}」非西安交通大学，不予认定` : '未填写第一署名单位（须为"西安交通大学"或"Xi\'an Jiaotong University"）';
        return out;
      }
    }

    let clsId = item.pubClass;
    if (kind === 'patent') clsId = R.ability.publication.patentMap[item.patentType] || 'ii';
    const cls = (R.ability.publication.classes || []).find(c => c.id === clsId);
    if (!cls) { out.reason = '未选择成果类别'; return out; }

    const rank = parseInt(item.rank, 10) || 0;
    let v = 0;
    const rk = cls.ranks || [];
    if (item.isEditor) {                       // 参编
      v = cls.bookStyle ? num(cls.editor, 1) : 0;
      out.reason = `${cls.label} · 参编`;
    } else if (rank >= 1 && rank <= rk.length) {
      // 表内位次直接查表（专著表已按「第四位起依次递减 1」展开到 1 分）
      v = num(rk[rank - 1]);
      out.reason = `${cls.label} · 第${rank}作者/完成人`;
    } else if (rank > rk.length) {
      // 表外位次走缺省回退：专著 1 分、一般期刊 0 分
      v = num(cls.rest);
      out.reason = `${cls.label} · 第${rank}位（第${rk.length + 1}位及以后按 ${ZC.fmt(v)} 分）`;
    } else { out.reason = '未填写署名位次'; return out; }

    if (item.excellentPaper) { v += num(R.ability.publication.excellentPaperBonus); out.reason += ' · 会议入围优秀论文 +1'; }
    out.points = v;
    return out;
  }

  /* ------------------------------------------------- 单项：文体竞赛计分 */
  function scoreCulture(item, R) {
    const out = { points: 0, reason: '' };
    const tbl = item.kind === 'sport' ? R.ability.sport : R.ability.art;
    const lv = (tbl.levels || []).find(l => l.id === item.level);
    if (!lv) { out.reason = '未选择级别'; return out; }
    const v = lv.awards[item.award];
    if (v === undefined || v === null) { out.reason = `「${lv.label}」无「${item.award || '未选名次'}」档`; return out; }
    out.points = num(v); out.reason = `${item.kind === 'sport' ? '体育' : '文艺'} · ${lv.label} · ${item.award}`;
    if (item.record) {
      const add = num((item.level === 'school') ? R.ability.sport.record.school : R.ability.sport.record.provincialOrAbove);
      out.points += add;
      out.reason += ` · 破${item.level === 'school' ? '校级' : '省级及以上'}纪录 +${add}`;
    }
    return out;
  }

  /* ------------------------------------------------- 单项：任职计分 */
  /** 任期月数（含首尾月）；end 为空时按今天计（在职中） */
  ZC.termMonths = function (start, end, today) {
    if (!start) return null;
    const a = new Date(start + (String(start).length === 10 ? 'T00:00:00' : ''));
    const b = end ? new Date(end + (String(end).length === 10 ? 'T00:00:00' : '')) : (today || new Date());
    if (isNaN(a) || isNaN(b) || b < a) return null;
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1) + 1;
  };

  function scorePosition(item, R) {
    const out = { points: 0, reason: '', fullPoints: 0, factor: 1, months: null };
    const P = R.ability.position;
    const tier = (P.tiers || []).find(t => t.id === item.tier);
    if (!tier) { out.reason = '未选择职务档位'; return out; }
    const assess = item.assessment || '合格';
    if (assess === '不合格') {
      if (P.failNoPoint) { out.reason = `${tier.label} · 考核不合格，不加分`; out.points = 0; out.fullPoints = 0; return out; }
    }
    const base = num(tier.values[assess]);
    if (tier.values[assess] === undefined) { out.reason = '未选择考核等级'; return out; }
    out.fullPoints = base;

    const hasEnd = !!item.endDate;
    const months = ZC.termMonths(item.startDate, item.endDate);
    out.months = months;
    out.ongoing = !!item.startDate && !hasEnd;
    let factor = 1;
    const pt = P.partialTerm || {};
    const factorFor = (m) => {
      if (pt.mode === 'none') return 0;
      if (pt.mode === 'half') return Math.min(1, pt.custom === undefined ? 0.5 : +pt.custom);
      if (pt.mode === 'custom') return Math.max(0, Math.min(1, +pt.custom || 0));
      return Math.max(0, Math.min(1, m / 12));   // prorate
    };
    if (months === null) {
      out.reason = `${tier.label} · ${assess}（未填任期，按满一年计）`;
    } else if (out.ongoing) {
      /* 在职中：按"预计做满一年"计分，但保留若中途退任的折减值供提示使用 */
      out.ifQuitNow = r2(base * factorFor(months));
      out.reason = `${tier.label} · ${assess}（在职中，至今 ${months} 个月，按预计满一年计 ${base}）`;
    } else if (months < 12) {
      factor = factorFor(months);
      out.reason = `${tier.label} · ${assess} ${base} × 任期仅 ${months} 个月（酌情系数 ${r2(factor)}）`;
    } else {
      out.reason = `${tier.label} · ${assess}（任期 ${months} 个月，已满一年）`;
    }
    out.factor = factor;
    out.points = r2(base * factor);
    return out;
  }

  /* ------------------------------------- 分组：同一项目取最高、不累计 */
  function groupKey(item) {
    if (item.noMerge) return '@@' + item.id;
    const g = String(item.group || item.project || item.name || '').trim().toLowerCase();
    return g ? 'g:' + g : '@@' + item.id;
  }

  function dedupe(items) {
    const map = new Map();
    items.forEach(it => {
      const k = groupKey(it);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    });
    const merged = [];
    map.forEach((arr, k) => {
      arr.sort((a, b) => (b._pts || 0) - (a._pts || 0));
      arr.forEach((it, i) => { it._merged = arr.length > 1; it._mergedRank = i; it._mergedCount = arr.length; it._counted = (i === 0); it._groupKey = k; });
      merged.push(...arr);
    });
    return merged;
  }

  /* ================================================== 主计算入口 */
  ZC.compute = function (profile, rules) {
    const R = rules || ZC.mergeRules(ZC.DEFAULT_RULES, profile.ruleOverride);
    const p = profile;
    const res = { rules: R, trace: [], warnings: [], merged: [], blocked: [] };

    /* ---------------- 一、品行素质分 ---------------- */
    const PX = R.pinxing;
    const base = p.meta.assessPass ? num(PX.base) : 0;
    if (!p.meta.assessPass) res.warnings.push('基准分未计入：班级评议小组评议合格 + 书院审定通过后方可获得 70 分基准分。');

    // 1) 集体活动
    const colItems = [];
    let colRaw = 0;
    if (p.pinxing.collective.outstanding) {
      const v = num(PX.collective.outstandingFull);
      colRaw += v; colItems.push({ label: '对集体荣誉作出突出贡献（书院认定，一次性满分）', points: v });
    }
    (p.pinxing.collective.entries || []).forEach(e => {
      const times = +e.times || 0;
      const v = r2(times * num(PX.collective.perTime));
      colRaw += v;
      colItems.push({
        label: e.name || '集体活动', points: v, id: e.id, status: e.status,
        note: `${times} 次 × ${ZC.fmt(PX.collective.perTime)} 分/次`,
        evidence: e.evidence || '', date: e.date || ''
      });
    });
    const collective = Math.min(r2(colRaw), num(PX.caps.collective));

    // 2) 思想政治理论学习
    const ID = p.pinxing.ideology, IDR = PX.ideology;
    const idItems = [];
    let idRaw = 0;
    [['orgTraining', IDR.orgTraining, '各级党团组织理论学习培训（含网络学习）'],
     ['provincialTraining', IDR.provincialTraining, '省、部级理论学习培训'],
     ['excellentTrainee', IDR.excellentTrainee, '培训获"优秀学员"称号（额外）']].forEach(([k, perRaw, label]) => {
      const per = num(perRaw), n = +ID[k] || 0;
      if (n > 0) { const v = r2(n * per); idRaw += v; idItems.push({ label, points: v, note: `${n} 次 × ${ZC.fmt(per)}` }); }
    });
    const ideology = Math.min(r2(idRaw), num(PX.caps.ideology));

    // 3) 社会服务
    const SV = p.pinxing.service, SR = PX.service;
    const svItems = []; let svRaw = 0;
    const hours = +SV.volunteerHours || 0;
    const vReq = Math.max(0, num(SR.volunteerHours, 32)), vPt = num(SR.volunteerPoint, 1);
    const volGot = vReq <= 0 ? vPt : (hours >= vReq ? vPt : (SR.volunteerProrate ? r2(vPt * hours / vReq) : 0));
    if (hours > 0 || volGot > 0) {
      svRaw += volGot;
      svItems.push({
        label: `志愿服务 ${ZC.fmt(hours)} 小时`, points: volGot,
        note: hours >= vReq ? `已满 ${ZC.fmt(vReq)} 小时` : `按比例 ${ZC.fmt(hours)}/${ZC.fmt(vReq)}`
      });
    }
    [['schoolPractice', SR.schoolPractice, '校级社会实践（考核合格的团队成员）'],
     ['cityIntern', SR.cityIntern, '市、县级挂职锻炼及政府见习'],
     ['provIntern', SR.provIntern, '省、部级挂职锻炼及政府见习 / 国际组织见习'],
     ['advanced', SR.advanced, '获先进个人及表彰（额外）']].forEach(([k, perRaw, label]) => {
      const per = num(perRaw), n = +SV[k] || 0;
      if (n > 0) { const v = r2(n * per); svRaw += v; svItems.push({ label, points: v, note: `${n} 项 × ${ZC.fmt(per)}` }); }
    });
    const service = Math.min(r2(svRaw), num(PX.caps.service));

    const addRaw = r2(colRaw + idRaw + svRaw);
    const addCapped = r2(collective + ideology + service);

    // 4) 扣分（不设上限）
    const dedItems = []; let ded = 0;
    (p.pinxing.deductions || []).forEach(d => {
      const t = PX.deduction.types.find(x => x.id === d.type) || { label: d.customLabel || '其他', per: +d.customPer || 1 };
      const per = d.type === 'other' ? num(d.customPer) : num(t.per);
      const n = +d.count || 1;
      const v = r2(per * n);
      ded += v;
      dedItems.push({ id: d.id, label: `${t.label}${n > 1 ? ' ×' + n : ''}`, points: v, note: d.note || '', date: d.date, status: d.status, fatal: ['jinggao', 'yanzhong', 'jiguo', 'liuxiao'].includes(d.type) });
    });
    ded = r2(ded);

    let pinxingRaw = r2(base + addCapped - ded);
    const pinxing = PX.floorAtZero ? Math.max(0, pinxingRaw) : pinxingRaw;

    res.pinxing = {
      base, addRaw, addCapped, deduction: ded, final: r2(pinxing), cap: PX.frame_cap || R.frame.pinxing,
      subs: {
        collective: { raw: r2(colRaw), final: collective, cap: num(PX.caps.collective), items: colItems },
        ideology: { raw: r2(idRaw), final: ideology, cap: num(PX.caps.ideology), items: idItems },
        service: { raw: r2(svRaw), final: service, cap: num(PX.caps.service), items: svItems }
      },
      deductions: dedItems
    };

    /* ---------------- 二、能力拓展分 ---------------- */
    const AB = R.ability;

    // 1) 学术科研及创新创业
    const acadRaw = (p.ability.academic || []).map(it => {
      const s = it.kind === 'competition' ? scoreAcademic(it, R) : scoreAcademic(it, R);
      return Object.assign({}, it, { _pts: r2(s.points), _reason: s.reason, _blocked: !!s.blocked, _status: it.status });
    });
    if (acadRaw.some(i => i._blocked)) acadRaw.filter(i => i._blocked).forEach(i => res.blocked.push({ cat: 'academic', label: i.project || i.name || '未命名成果', reason: i._reason }));
    const acad = dedupe(acadRaw);
    acad.filter(i => i._merged && !i._counted).forEach(i => res.merged.push({ cat: '学术科研', name: i.project || i.name, kept: ZC.fmt(i._pts), dropped: ZC.fmt(i._pts), reason: '同一项目获不同奖项不累计、取最高' }));
    const acadSum = r2(acad.filter(i => i._counted).reduce((s, i) => s + i._pts, 0));
    const academic = Math.min(acadSum, num(AB.caps.academic));

    // 2) 文体竞赛
    const culRaw = (p.ability.culture || []).map(it => {
      const s = scoreCulture(it, R);
      return Object.assign({}, it, { _pts: r2(s.points), _reason: s.reason, _status: it.status });
    });
    const cul = dedupe(culRaw);
    cul.filter(i => i._merged && !i._counted).forEach(i => res.merged.push({ cat: '文体竞赛', name: i.project || i.name, dropped: ZC.fmt(i._pts), reason: '同一项目取最高' }));
    const culSum = r2(cul.filter(i => i._counted).reduce((s, i) => s + i._pts, 0));
    const culture = Math.min(culSum, num(AB.caps.culture));

    // 3) 任职（兼任取最高、不累加）
    const posAll = (p.ability.position || []).map(it => {
      const s = scorePosition(it, R);
      return Object.assign({}, it, { _pts: r2(s.points), _reason: s.reason, _full: s.fullPoints, _factor: s.factor, _months: s.months, _ongoing: s.ongoing, _ifQuitNow: s.ifQuitNow, _status: it.status });
    });
    let posBest = null;
    posAll.forEach(it => { if (!posBest || it._pts > posBest._pts) posBest = it; });
    posAll.forEach(it => { it._counted = (posBest && it.id === posBest.id && it._pts > 0); });
    if (posAll.length > 1) res.merged.push({ cat: '学生组织任职', name: `共 ${posAll.length} 项任职`, dropped: ZC.fmt(r2(posAll.reduce((s, i) => s + i._pts, 0) - (posBest ? posBest._pts : 0))), reason: '兼任多项职务按最高分计、不累加' });
    const position = Math.min(posBest ? posBest._pts : 0, num(AB.caps.position));

    const abilitySum = r2(academic + culture + position);
    const ability = Math.min(abilitySum, num(R.frame.ability));

    res.ability = {
      final: r2(ability), cap: R.frame.ability,
      subs: {
        academic: { raw: acadSum, final: r2(academic), cap: num(AB.caps.academic), items: acad },
        culture: { raw: culSum, final: r2(culture), cap: num(AB.caps.culture), items: cul },
        position: { raw: posBest ? posBest._pts : 0, final: r2(position), cap: num(AB.caps.position), items: posAll, best: posBest }
      }
    };

    /* ---------------- 三、奖励分 ---------------- */
    const RW = R.reward;
    const rwItems = (p.reward.items || []).map(it => {
      const cat = RW.categories.find(c => c.id === it.category) || RW.categories[0];
      let v = 0, reason = '';
      if (cat.mode === 'level') {
        const lv = RW.levels.find(l => l.id === it.level);
        v = lv ? lv.v : 0; reason = `${cat.label} · ${lv ? lv.label : '未选级别'}`;
      } else { v = cat.each || 1; reason = `${cat.label} · 每项 +${v}`; }
      return Object.assign({}, it, { _pts: r2(v), _reason: reason, _status: it.status });
    });
    const rwSum = r2(rwItems.reduce((s, i) => s + i._pts, 0));
    const reward = Math.min(rwSum, num(RW.cap));
    res.reward = { raw: rwSum, final: r2(reward), cap: num(RW.cap), items: rwItems };

    /* ---------------- 合计 ---------------- */
    res.total = r2(pinxing + ability + reward);
    res.maxTotal = num(R.frame.pinxing) + num(R.frame.ability) + num(RW.cap);

    /* 剩余空间（headroom） */
    res.headroom = {
      collective: r2(num(PX.caps.collective) - collective),
      ideology: r2(num(PX.caps.ideology) - ideology),
      service: r2(num(PX.caps.service) - service),
      deduction: ded,
      academic: r2(Math.max(0, num(AB.caps.academic) - academic)),
      culture: r2(Math.max(0, num(AB.caps.culture) - culture)),
      position: r2(Math.max(0, num(AB.caps.position) - position)),
      ability: r2(Math.max(0, num(R.frame.ability) - ability)),
      reward: r2(Math.max(0, num(RW.cap) - reward))
    };
    res.headroom.pinxingAdd = r2(res.headroom.collective + res.headroom.ideology + res.headroom.service);
    res.headroom.total = r2(res.maxTotal - res.total);

    /* ---------------- 综合成绩 ---------------- */
    res.composite = ZC.composite(p, R, res.total);

    /* ---------------- 计算轨迹 ---------------- */
    res.trace = buildTrace(res, R);
    return res;
  };

  /* ------------------------------------------------ 综合成绩（多口径） */
  ZC.composite = function (profile, R, zongce) {
    const cp = R.composite;
    const preset = (cp.presets || []).find(x => x.id === cp.preset) || cp.presets[0];
    const cw = profile.coursework || {};
    const maxZ = num(R.frame.pinxing) + num(R.frame.ability) + num((R.reward || {}).cap) || 105;
    const norm = cp.normalizeZongce ? r2(zongce / maxZ * 100) : zongce;
    const vals = { course: +cw.score || 0, zongce: norm, deyu: +cw.deyu || 0, pe: +cw.pe || 0 };
    let total = 0; const parts = [];
    (preset.parts || []).forEach(pt => {
      const w = num(pt.weight);
      const v = vals[pt.key] || 0;
      total += v * w;
      parts.push({ label: pt.label, value: v, weight: w, contrib: r2(v * w), filled: !!vals[pt.key] });
    });
    const weightSum = (preset.parts || []).reduce((s, x) => s + (+x.weight || 0), 0);
    return {
      preset, presetId: cp.preset, total: r2(total), parts, normalized: norm,
      weightSum: r2(weightSum), incomplete: parts.some(x => !x.filled),
      sensitivity: r2((preset.parts.find(x => x.key === 'zongce') || { weight: 0 }).weight)
    };
  };

  /* ------------------------------------------------------ 轨迹（可审计） */
  function buildTrace(res, R) {
    const T = [];
    const line = (indent, label, value, note) => T.push({ indent, label, value, note });
    line(0, '一、品行素质分', ZC.fmt(res.pinxing.final), `满分 ${R.frame.pinxing}`);
    line(1, '基准分（班级评议合格 + 书院审定通过）', ZC.fmt(res.pinxing.base), res.pinxing.base ? '' : '未通过评议，基准分为 0');
    const s = res.pinxing.subs;
    line(1, '集体活动分', ZC.signed(s.collective.final), capNote(s.collective));
    line(1, '思想政治理论学习分', ZC.signed(s.ideology.final), capNote(s.ideology));
    line(1, '社会服务分', ZC.signed(s.service.final), capNote(s.service));
    line(1, '品行素质扣分（不设上限）', res.pinxing.deduction ? '−' + ZC.fmt(res.pinxing.deduction) : '0', res.pinxing.deduction ? `${res.pinxing.deductions.length} 条记录` : '无扣分记录 · 保持住');
    line(0, '二、能力拓展分', ZC.fmt(res.ability.final), `满分 ${R.frame.ability}`);
    const a = res.ability.subs;
    line(1, '学术科研及创新创业', ZC.signed(a.academic.final), capNote(a.academic));
    line(1, '文体竞赛', ZC.signed(a.culture.final), capNote(a.culture));
    line(1, '学生组织、社团任职（兼任取最高）', ZC.signed(a.position.final), capNote(a.position));
    line(0, '三、奖励分', ZC.signed(res.reward.final), capNote(res.reward));
    line(0, '综合素质测评成绩', ZC.fmt(res.total), `满分 ${res.maxTotal}`);
    return T;
  }
  function capNote(sub) {
    if (!sub) return '';
    const over = sub.raw > sub.cap + 1e-9;
    return over ? `原始 ${ZC.fmt(sub.raw)} → 封顶 ${ZC.fmt(sub.cap)}` : `上限 ${ZC.fmt(sub.cap)}`;
  }
  ZC.capNote = capNote;

  /* ------------------------------------------------- 字段联动校正
   * 切换"类别/级别"后，原先选中的奖项可能在新表里不存在（例如从省级切到
   * 国家级后仍留着"优秀奖"），会得到 0 分并让用户困惑。这里自动改成一个
   * 保守且有效的档位（优先三等奖/第3名，取不到则取该级别最后一档）。
   */
  ZC.fixups = function (profile, changedPath) {
    const R = ZC.getRules(profile);
    let m;
    // 学术成果：kind / level 变化
    if ((m = changedPath.match(/^ability\.academic\[(\d+)\]\.(kind|level|patentType|pubClass)$/))) {
      const it = (profile.ability.academic || [])[+m[1]];
      if (!it) return;
      if (it.kind === 'patent' && !it.patentType) it.patentType = '实用新型专利';
      if (it.kind === 'paper' && !['i', 'ii', 'general'].includes(it.pubClass)) it.pubClass = 'ii';
      if (it.kind === 'book') it.pubClass = 'book';
      if (it.kind === 'competition') {
        const lv = R.ability.competition.levels.find(l => l.id === it.level);
        if (lv) it.award = pickAward(Object.keys(lv.awards), it.award, ['三等奖', '二等奖', '一等奖']);
      }
      if (it.kind !== 'competition') it.noMerge = true;   // 论文/专利/专著默认不参与同名合并
    }
    // 文体竞赛：kind / level 变化
    if ((m = changedPath.match(/^ability\.culture\[(\d+)\]\.(kind|level)$/))) {
      const it = (profile.ability.culture || [])[+m[1]];
      if (!it) return;
      const tbl = it.kind === 'sport' ? R.ability.sport : R.ability.art;
      if (!tbl.levels.some(l => l.id === it.level)) it.level = 'school';
      const lv = tbl.levels.find(l => l.id === it.level);
      if (lv) it.award = pickAward(Object.keys(lv.awards), it.award, it.kind === 'sport' ? ['第3名', '第2名', '第1名'] : ['三等奖', '二等奖', '一等奖']);
    }
    // 奖励分：category 变化
    if ((m = changedPath.match(/^reward\.items\[(\d+)\]\.category$/))) {
      const it = (profile.reward.items || [])[+m[1]];
      const cat = it && R.reward.categories.find(c => c.id === it.category);
      if (it && cat && cat.mode === 'level' && !R.reward.levels.some(l => l.id === it.level)) it.level = 'school';
    }
    // 扣分：type 变化时清理自定义分值
    if ((m = changedPath.match(/^pinxing\.deductions\[(\d+)\]\.type$/))) {
      const it = (profile.pinxing.deductions || [])[+m[1]];
      if (it && it.type !== 'other') delete it.customPer;
    }
  };
  function pickAward(list, cur, prefer) {
    if (list.includes(cur)) return cur;
    for (const p of prefer) if (list.includes(p)) return p;
    return list[list.length - 1] || '';
  }

  /* ------------------------------------------------- 模拟：加一个假设项 */
  ZC.simulate = function (profile, R, addFn) {
    const copy = ZC.clone(profile);
    addFn(copy);
    return ZC.compute(copy, R);
  };
})();
