/* =========================================================================
 * merit-engine.js — 计分引擎
 * 设计原则：
 *  1) 纯函数：compute(profile, rules) → result，不修改入参
 *  2) 全程可审计：每一分都带「依据」，能逐行核对
 *  3) 封顶、同一项目取最高、任职兼任取最高、任期折减、署名单位校验，
 *     全部在引擎内完成，界面只负责展示
 * ========================================================================= */
(function () {
	'use strict';
	var ZC = window.ZC;

	var r2 = function (n) { return Math.round((+n + Number.EPSILON) * 100) / 100; };
	var num = function (v, dflt) { var n = parseFloat(v); return isFinite(n) ? n : (dflt === undefined ? 0 : dflt); };
	ZC.r2 = r2;

	ZC.fmt = function (n) {
		if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
		var v = r2(n);
		return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : String(v);
	};
	ZC.signed = function (n) { return (n > 0 ? '+' : '') + ZC.fmt(n); };

	/* ================================================== 单项：学术成果 */
	function scoreAcademic(item, R) {
		var out = { points: 0, reason: '', blocked: false };
		var kind = item.kind || 'competition';
		var PUB = R.ability.publication;

		if (kind === 'competition') {
			var lv = (R.ability.competition.levels || []).filter(function (l) { return l.id === item.level; })[0];
			if (!lv) { out.reason = '未选择竞赛级别'; return out; }
			var av = lv.awards[item.award];
			if (av === undefined || av === null) { out.reason = '「' + lv.label + '」无「' + (item.award || '未选奖项') + '」档'; return out; }
			out.points = num(av);
			out.reason = lv.label + ' · ' + item.award;
			return out;
		}

		/* 论文 / 专著 / 专利：署名单位校验 */
		if (PUB.mustBeFirstUnit) {
			var unit = String(item.signUnit || '').trim();
			var norm = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, ''); };
			var pats = PUB.firstUnitPatterns || ['西安交通', 'xjtu', 'xianjiaotong'];
			var nu = norm(unit);
			var ok = !!nu && pats.some(function (a) { return nu.indexOf(norm(a)) >= 0; });
			if (!ok) {
				out.blocked = true;
				out.reason = unit
					? '第一署名单位「' + unit + '」非西安交通大学，不予认定'
					: '未填第一署名单位（须为「西安交通大学」或「Xi\'an Jiaotong University」）';
				return out;
			}
		}

		var clsId = item.pubClass;
		if (kind === 'patent') clsId = PUB.patentMap[item.patentType] || 'ii';
		if (kind === 'book') clsId = 'book';
		var cls = (PUB.classes || []).filter(function (c) { return c.id === clsId; })[0];
		if (!cls) { out.reason = '未选择成果类别'; return out; }

		var rank = parseInt(item.rank, 10) || 0;
		var v = 0;
		var rk = cls.ranks || [];
		if (item.isEditor) {
			v = cls.bookStyle ? num(cls.editor, 1) : 0;
			out.reason = cls.label + ' · 参编';
		} else if (rank >= 1 && rank <= rk.length) {
			/* 表内位次：直接查表（专著表已按「第四位起依次递减 1」展开到 1 分） */
			v = num(rk[rank - 1]);
			out.reason = cls.label + ' · 第' + rank + '作者 / 完成人';
		} else if (rank > rk.length) {
			/* 表外位次：按该类成果的缺省回退值（专著 1 分、一般期刊 0 分） */
			v = num(cls.rest);
			out.reason = cls.label + ' · 第' + rank + '位（第' + (rk.length + 1) + '位及以后按 ' + ZC.fmt(v) + ' 分）';
		} else { out.reason = '未填写署名位次'; return out; }

		if (item.excellentPaper) {
			v += num(PUB.excellentPaperBonus);
			out.reason += ' · 会议入围优秀论文 +1';
		}
		out.points = v;
		return out;
	}

	/* ================================================== 单项：文体竞赛 */
	function scoreCulture(item, R) {
		var out = { points: 0, reason: '' };
		var isSport = item.kind === 'sport';
		var tbl = isSport ? R.ability.sport : R.ability.art;
		var lv = (tbl.levels || []).filter(function (l) { return l.id === item.level; })[0];
		if (!lv) { out.reason = '未选择级别'; return out; }
		var av = lv.awards[item.award];
		if (av === undefined || av === null) { out.reason = '「' + lv.label + '」无「' + (item.award || '未选名次') + '」档'; return out; }
		out.points = num(av);
		out.reason = (isSport ? '体育' : '文艺') + ' · ' + lv.label + ' · ' + item.award;
		if (item.record) {
			var add = num(item.level === 'school' ? R.ability.sport.record.school : R.ability.sport.record.provincialOrAbove);
			out.points += add;
			out.reason += ' · 破' + (item.level === 'school' ? '校级' : '省级及以上') + '纪录 +' + add;
		}
		return out;
	}

	/* ================================================== 任期月数 */
	ZC.termMonths = function (start, end, today) {
		if (!start) return null;
		var a = new Date(start + (String(start).length === 10 ? 'T00:00:00' : ''));
		var b = end ? new Date(end + (String(end).length === 10 ? 'T00:00:00' : '')) : (today || new Date());
		if (isNaN(a) || isNaN(b) || b < a) return null;
		return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1) + 1;
	};

	/* ================================================== 单项：任职 */
	function scorePosition(item, R) {
		var out = { points: 0, reason: '', fullPoints: 0, factor: 1, months: null };
		var P = R.ability.position;
		var tier = (P.tiers || []).filter(function (t) { return t.id === item.tier; })[0];
		if (!tier) { out.reason = '未选择职务档位'; return out; }
		var assess = item.assessment || '合格';
		if (assess === '不合格' && P.failNoPoint) {
			out.reason = tier.label + ' · 考核不合格，不加分';
			return out;
		}
		if (tier.values[assess] === undefined) { out.reason = '未选择考核等级'; return out; }
		var base = num(tier.values[assess]);
		out.fullPoints = base;

		var months = ZC.termMonths(item.startDate, item.endDate);
		out.months = months;
		out.ongoing = !!item.startDate && !item.endDate;
		var pt = P.partialTerm || {};
		var factorFor = function (m) {
			if (pt.mode === 'none') return 0;
			if (pt.mode === 'half') return Math.min(1, pt.custom === undefined ? 0.5 : +pt.custom);
			if (pt.mode === 'custom') return Math.max(0, Math.min(1, +pt.custom || 0));
			return Math.max(0, Math.min(1, m / 12));
		};
		var factor = 1;
		if (months === null) {
			out.reason = tier.label + ' · ' + assess + '（未填任期，按满一年计）';
		} else if (out.ongoing) {
			out.ifQuitNow = r2(base * factorFor(months));
			out.reason = tier.label + ' · ' + assess + '（在职中，至今 ' + months + ' 个月，按预计满一年计）';
		} else if (months < 12) {
			factor = factorFor(months);
			out.reason = tier.label + ' · ' + assess + ' ' + ZC.fmt(base) + ' × 任期仅 ' + months + ' 个月（系数 ' + ZC.fmt(factor) + '）';
		} else {
			out.reason = tier.label + ' · ' + assess + '（任期 ' + months + ' 个月，已满一年）';
		}
		out.factor = factor;
		out.points = r2(base * factor);
		return out;
	}

	/* ================================================== 单项：奖励分 */
	function scoreReward(item, R) {
		var RW = R.reward;
		var cat = (RW.categories || []).filter(function (c) { return c.id === item.category; })[0] || RW.categories[0];
		if (cat.mode === 'level') {
			var lv = (RW.levels || []).filter(function (l) { return l.id === item.level; })[0];
			return { points: lv ? num(lv.v) : 0, reason: cat.label + ' · ' + (lv ? lv.label : '未选级别'), cat: cat };
		}
		return { points: num(cat.each, 1), reason: cat.label + ' · 每项 +' + num(cat.each, 1), cat: cat };
	}

	/** 单项计分统一入口（供条目编辑预览用） */
	ZC.scoreItem = function (group, item, R) {
		if (group === 'academic') return scoreAcademic(item, R);
		if (group === 'culture') return scoreCulture(item, R);
		if (group === 'position') return scorePosition(item, R);
		if (group === 'reward') return scoreReward(item, R);
		return { points: 0, reason: '' };
	};

	/* ======================================== 分组：同一项目取最高、不累计 */
	function groupKey(item) {
		if (item.noMerge) return '@@' + item.id;
		var g = String(item.group || item.project || item.name || '').trim().toLowerCase();
		return g ? 'g:' + g : '@@' + item.id;
	}
	function dedupe(items) {
		var map = {}, order = [];
		items.forEach(function (it) {
			var k = groupKey(it);
			if (!map[k]) { map[k] = []; order.push(k); }
			map[k].push(it);
		});
		var merged = [];
		order.forEach(function (k) {
			var arr = map[k];
			arr.sort(function (a, b) { return (b._pts || 0) - (a._pts || 0); });
			arr.forEach(function (it, i) {
				it._merged = arr.length > 1;
				it._mergedRank = i;
				it._mergedCount = arr.length;
				it._counted = (i === 0);
				it._groupKey = k;
			});
			merged = merged.concat(arr);
		});
		return merged;
	}

	/* ================================================== 主计算入口 */
	ZC.compute = function (profile, rules) {
		var R = rules || ZC.mergeRules(ZC.DEFAULT_RULES, profile.ruleOverride);
		var p = profile;
		var res = { rules: R, trace: [], warnings: [], merged: [], blocked: [] };

		/* ---------------- 一、品行素质分 ---------------- */
		var PX = R.pinxing;
		var base = p.meta.assessPass ? num(PX.base) : 0;
		if (!p.meta.assessPass) res.warnings.push('基准分未计入：班级评议小组评议合格 + 书院审定通过后才能获得基准分。');

		var COL = p.pinxing.collective || { mode: 'count', entries: [] };
		var colItems = [], colRaw = 0;
		if (COL.mode === 'flat') {
			var ov = num(PX.collective.outstandingFull);
			colRaw += ov;
			colItems.push({ label: '对集体荣誉作出突出贡献（书院认定，一次性满分）', points: ov, kind: 'flat' });
		} else {
			(COL.entries || []).forEach(function (e) {
				var times = +e.times || 0;
				var v = r2(times * num(PX.collective.perTime));
				colRaw += v;
				colItems.push({
					label: e.name || '集体活动', points: v, id: e.id, status: e.status,
					note: times + ' 次 × ' + ZC.fmt(PX.collective.perTime) + ' 分/次',
					evidence: e.evidence || '', date: e.date || ''
				});
			});
		}
		var collective = Math.min(r2(colRaw), num(PX.caps.collective));

		var ID = p.pinxing.ideology, IDR = PX.ideology;
		var idItems = [], idRaw = 0;
		[['orgTraining', IDR.orgTraining, '各级党团组织理论学习培训（含网络学习）'],
		 ['provincialTraining', IDR.provincialTraining, '省、部级理论学习培训'],
		 ['excellentTrainee', IDR.excellentTrainee, '培训获「优秀学员」称号（额外）']].forEach(function (row) {
			var per = num(row[1]), n = +ID[row[0]] || 0;
			if (n > 0) {
				var v = r2(n * per);
				idRaw += v;
				idItems.push({ key: row[0], label: row[2], points: v, note: n + ' 次 × ' + ZC.fmt(per) });
			}
		});
		var ideology = Math.min(r2(idRaw), num(PX.caps.ideology));

		var SV = p.pinxing.service, SR = PX.service;
		var svItems = [], svRaw = 0;
		var hours = +SV.volunteerHours || 0;
		var vReq = Math.max(0, num(SR.volunteerHours, 32)), vPt = num(SR.volunteerPoint, 1);
		var volGot = vReq <= 0 ? vPt : (hours >= vReq ? vPt : (SR.volunteerProrate ? r2(vPt * hours / vReq) : 0));
		if (hours > 0 || volGot > 0) {
			svRaw += volGot;
			svItems.push({
				label: '志愿服务 ' + ZC.fmt(hours) + ' 小时', points: volGot, kind: 'volunteer',
				note: hours >= vReq ? '已满 ' + ZC.fmt(vReq) + ' 小时' : '按比例 ' + ZC.fmt(hours) + '/' + ZC.fmt(vReq) + ' 小时',
				status: SV.volunteerStatus, evidence: SV.volunteerNote
			});
		}
		[['schoolPractice', SR.schoolPractice, '校级社会实践（考核合格的团队成员）'],
		 ['cityIntern', SR.cityIntern, '市、县级挂职锻炼及政府见习'],
		 ['provIntern', SR.provIntern, '省、部级挂职锻炼及政府见习 / 国际组织见习'],
		 ['advanced', SR.advanced, '获先进个人及表彰（额外）']].forEach(function (row) {
			var per = num(row[1]), n = +SV[row[0]] || 0;
			if (n > 0) {
				var v = r2(n * per);
				svRaw += v;
				svItems.push({ key: row[0], label: row[2], points: v, note: n + ' 项 × ' + ZC.fmt(per) });
			}
		});
		var service = Math.min(r2(svRaw), num(PX.caps.service));

		/* 扣分：不设上限 */
		var dedItems = [], ded = 0;
		(p.pinxing.deductions || []).forEach(function (d) {
			var t = (PX.deduction.types || []).filter(function (x) { return x.id === d.type; })[0] || { label: '其他', per: 1 };
			var per = d.type === 'other' ? num(d.customPer, num(t.per)) : num(t.per);
			var n = +d.count || 1;
			var v = r2(per * n);
			ded += v;
			dedItems.push({
				id: d.id, type: d.type, label: t.label + (n > 1 ? ' ×' + n : ''), points: v,
				note: d.note || '', date: d.date || '', status: d.status,
				fatal: ['jinggao', 'yanzhong', 'jiguo', 'liuxiao'].indexOf(d.type) >= 0
			});
		});
		ded = r2(ded);

		var pinxingRaw = r2(base + collective + ideology + service - ded);
		var pinxing = PX.floorAtZero ? Math.max(0, pinxingRaw) : pinxingRaw;

		res.pinxing = {
			base: base,
			raw: pinxingRaw,
			final: r2(pinxing),
			cap: num(R.frame.pinxing),
			deduction: ded,
			deductions: dedItems,
			subs: {
				collective: { raw: r2(colRaw), final: collective, cap: num(PX.caps.collective), items: colItems },
				ideology: { raw: r2(idRaw), final: ideology, cap: num(PX.caps.ideology), items: idItems },
				service: { raw: r2(svRaw), final: service, cap: num(PX.caps.service), items: svItems }
			}
		};

		/* ---------------- 二、能力拓展分 ---------------- */
		var AB = R.ability;

		var acadRaw = (p.ability.academic || []).map(function (it) {
			var s = scoreAcademic(it, R);
			return Object.assign({}, it, { _pts: r2(s.points), _reason: s.reason, _blocked: !!s.blocked });
		});
		acadRaw.filter(function (i) { return i._blocked; }).forEach(function (i) {
			res.blocked.push({ cat: '学术成果', label: i.project || i.name || '未命名成果', reason: i._reason });
		});
		var acad = dedupe(acadRaw);
		acad.filter(function (i) { return i._merged && !i._counted; }).forEach(function (i) {
			res.merged.push({ cat: '学术科研', name: i.project || i.name || '未命名', dropped: ZC.fmt(i._pts), reason: '同一项目获不同奖项不累计、取最高' });
		});
		var acadSum = r2(acad.filter(function (i) { return i._counted; }).reduce(function (s, i) { return s + i._pts; }, 0));
		var academic = Math.min(acadSum, num(AB.caps.academic));

		var culRaw = (p.ability.culture || []).map(function (it) {
			var s = scoreCulture(it, R);
			return Object.assign({}, it, { _pts: r2(s.points), _reason: s.reason });
		});
		var cul = dedupe(culRaw);
		cul.filter(function (i) { return i._merged && !i._counted; }).forEach(function (i) {
			res.merged.push({ cat: '文体竞赛', name: i.name || i.project || '未命名', dropped: ZC.fmt(i._pts), reason: '同一项目取最高' });
		});
		var culSum = r2(cul.filter(function (i) { return i._counted; }).reduce(function (s, i) { return s + i._pts; }, 0));
		var culture = Math.min(culSum, num(AB.caps.culture));

		var posAll = (p.ability.position || []).map(function (it) {
			var s = scorePosition(it, R);
			return Object.assign({}, it, {
				_pts: r2(s.points), _reason: s.reason, _full: s.fullPoints, _factor: s.factor,
				_months: s.months, _ongoing: !!s.ongoing, _ifQuitNow: s.ifQuitNow
			});
		});
		var posBest = null;
		posAll.forEach(function (it) { if (!posBest || it._pts > posBest._pts) posBest = it; });
		posAll.forEach(function (it) { it._counted = !!(posBest && it.id === posBest.id && it._pts > 0); });
		if (posAll.length > 1) {
			res.merged.push({
				cat: '学生组织任职', name: '共 ' + posAll.length + ' 项任职',
				dropped: ZC.fmt(r2(posAll.reduce(function (s, i) { return s + i._pts; }, 0) - (posBest ? posBest._pts : 0))),
				reason: '兼任多项职务按最高分计、不累加'
			});
		}
		var position = Math.min(posBest ? posBest._pts : 0, num(AB.caps.position));

		var abilitySum = r2(academic + culture + position);
		var ability = Math.min(abilitySum, num(R.frame.ability));

		res.ability = {
			final: r2(ability),
			cap: num(R.frame.ability),
			raw: abilitySum,
			subs: {
				academic: { raw: acadSum, final: r2(academic), cap: num(AB.caps.academic), items: acad },
				culture: { raw: culSum, final: r2(culture), cap: num(AB.caps.culture), items: cul },
				position: { raw: posBest ? posBest._pts : 0, final: r2(position), cap: num(AB.caps.position), items: posAll, best: posBest }
			}
		};

		/* ---------------- 三、奖励分 ---------------- */
		var RW = R.reward;
		var rwItems = (p.reward.items || []).map(function (it) {
			var s = scoreReward(it, R);
			return Object.assign({}, it, { _pts: r2(s.points), _reason: s.reason, _catLabel: s.cat.label });
		});
		var rwSum = r2(rwItems.reduce(function (s, i) { return s + i._pts; }, 0));
		var reward = Math.min(rwSum, num(RW.cap));
		res.reward = { raw: rwSum, final: r2(reward), cap: num(RW.cap), items: rwItems };

		/* ---------------- 合计与剩余空间 ---------------- */
		res.total = r2(pinxing + ability + reward);
		res.maxTotal = num(R.frame.pinxing) + num(R.frame.ability) + num(RW.cap);

		res.headroom = {
			collective: r2(Math.max(0, num(PX.caps.collective) - collective)),
			ideology: r2(Math.max(0, num(PX.caps.ideology) - ideology)),
			service: r2(Math.max(0, num(PX.caps.service) - service)),
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
		res.trace = buildTrace(res, R);
		return res;
	};

	/* ------------------------------------------------ 综合成绩（多口径） */
	ZC.composite = function (profile, R, zongce) {
		var cp = R.composite;
		var preset = (cp.presets || []).filter(function (x) { return x.id === cp.preset; })[0] || cp.presets[0];
		var cw = profile.coursework || {};
		/* 自定义口径的权重单独存 profile.customWeights：
		   若写进 ruleOverride.composite.presets[..].parts[..]，深合并会把 presets 数组整体替换成对象 */
		var cwW = (preset.id === 'custom' && profile.customWeights) ? profile.customWeights : null;
		var maxZ = num(R.frame.pinxing) + num(R.frame.ability) + num((R.reward || {}).cap || 5);
		var norm = cp.normalizeZongce ? r2(zongce / (maxZ || 105) * 100) : zongce;
		var vals = { course: +cw.score || 0, zongce: norm, deyu: +cw.deyu || 0, pe: +cw.pe || 0 };
		var total = 0, parts = [];
		(preset.parts || []).forEach(function (pt) {
			var w = num(pt.weight);
			if (cwW && cwW[pt.key] !== undefined && cwW[pt.key] !== '') w = num(cwW[pt.key], w);
			var v = vals[pt.key] || 0;
			total += v * w;
			parts.push({ key: pt.key, label: pt.label, value: v, weight: w, contrib: r2(v * w), filled: !!(+cw.score || +cw.deyu || +cw.pe) && v !== 0 });
		});
		var weightSum = (preset.parts || []).reduce(function (s, x) { return s + (+x.weight || 0); }, 0);
		var zPart = (preset.parts || []).filter(function (x) { return x.key === 'zongce'; })[0];
		return {
			preset: preset, presetId: cp.preset, total: r2(total), parts: parts,
			normalized: norm, weightSum: r2(weightSum),
			incomplete: parts.some(function (x) { return !x.filled; }),
			sensitivity: r2(zPart ? zPart.weight : 0)
		};
	};

	/* ------------------------------------------------------ 轨迹（可审计） */
	function capNote(sub) {
		if (!sub) return '';
		var over = sub.raw > sub.cap + 1e-9;
		return over ? '原始 ' + ZC.fmt(sub.raw) + ' → 封顶 ' + ZC.fmt(sub.cap) : '上限 ' + ZC.fmt(sub.cap);
	}
	ZC.capNote = capNote;

	function buildTrace(res, R) {
		var T = [];
		var line = function (indent, label, value, note) { T.push({ indent: indent, label: label, value: value, note: note || '' }); };
		line(0, '一、品行素质分', ZC.fmt(res.pinxing.final), '满分 ' + R.frame.pinxing);
		line(1, '基准分（班级评议合格 + 书院审定通过）', ZC.fmt(res.pinxing.base), res.pinxing.base ? '' : '未通过评议，基准分为 0');
		var s = res.pinxing.subs;
		line(1, '集体活动分', ZC.signed(s.collective.final), capNote(s.collective));
		line(1, '思想政治理论学习分', ZC.signed(s.ideology.final), capNote(s.ideology));
		line(1, '社会服务分', ZC.signed(s.service.final), capNote(s.service));
		line(1, '品行素质扣分（不设上限）', res.pinxing.deduction ? '−' + ZC.fmt(res.pinxing.deduction) : '0',
			res.pinxing.deduction ? res.pinxing.deductions.length + ' 条记录' : '无扣分记录');
		line(0, '二、能力拓展分', ZC.fmt(res.ability.final), '满分 ' + R.frame.ability);
		var a = res.ability.subs;
		line(1, '学术科研及创新创业', ZC.signed(a.academic.final), capNote(a.academic));
		line(1, '文体竞赛', ZC.signed(a.culture.final), capNote(a.culture));
		line(1, '学生组织、社团任职（兼任取最高）', ZC.signed(a.position.final), capNote(a.position));
		line(0, '三、奖励分', ZC.signed(res.reward.final), capNote(res.reward));
		return T;
	}

	/* ------------------------------------------------- 字段联动校正
	 * 切换「类别 / 级别」后，原先选中的奖项可能在新表里不存在
	 * （例如从省级切到国家级后仍留着「优秀奖」），会得 0 分并让人困惑。
	 * 这里自动改成一个保守且有效的档位。 */
	ZC.fixups = function (profile, changedPath, R) {
		var m, it;
		if ((m = changedPath.match(/^ability\.academic\[(\d+)\]\.(kind|level|patentType|pubClass)$/))) {
			it = (profile.ability.academic || [])[+m[1]];
			if (!it) return;
			if (it.kind === 'patent' && !it.patentType) it.patentType = '实用新型专利';
			if (it.kind === 'paper' && ['i', 'ii', 'general'].indexOf(it.pubClass) < 0) it.pubClass = 'ii';
			if (it.kind === 'book') it.pubClass = 'book';
			if (it.kind === 'competition') {
				var lv = R.ability.competition.levels.filter(function (l) { return l.id === it.level; })[0];
				if (lv) it.award = pickAward(Object.keys(lv.awards), it.award, ['三等奖', '二等奖', '一等奖']);
			}
			if (it.kind !== 'competition') it.noMerge = true;
		}
		if ((m = changedPath.match(/^ability\.culture\[(\d+)\]\.(kind|level)$/))) {
			it = (profile.ability.culture || [])[+m[1]];
			if (!it) return;
			var tbl = it.kind === 'sport' ? R.ability.sport : R.ability.art;
			if (!tbl.levels.some(function (l) { return l.id === it.level; })) it.level = 'school';
			var lv2 = tbl.levels.filter(function (l) { return l.id === it.level; })[0];
			if (lv2) it.award = pickAward(Object.keys(lv2.awards), it.award, it.kind === 'sport' ? ['第3名', '第2名', '第1名'] : ['三等奖', '二等奖', '一等奖']);
		}
		if ((m = changedPath.match(/^reward\.items\[(\d+)\]\.category$/))) {
			it = (profile.reward.items || [])[+m[1]];
			var cat = it && R.reward.categories.filter(function (c) { return c.id === it.category; })[0];
			if (it && cat && cat.mode === 'level' && !R.reward.levels.some(function (l) { return l.id === it.level; })) it.level = 'school';
		}
		if ((m = changedPath.match(/^pinxing\.deductions\[(\d+)\]\.type$/))) {
			it = (profile.pinxing.deductions || [])[+m[1]];
			if (it && it.type !== 'other') delete it.customPer;
		}
		/* 集体活动切换口径时不动已录入的活动（切回「按次数」还能继续用） */
	};
	function pickAward(list, cur, prefer) {
		if (list.indexOf(cur) >= 0) return cur;
		for (var i = 0; i < prefer.length; i++) { if (list.indexOf(prefer[i]) >= 0) return prefer[i]; }
		return list[list.length - 1] || '';
	}
})(window);
