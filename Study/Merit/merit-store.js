/* =========================================================================
 * merit-store.js — 状态 / 本地持久化 / 档案 / 撤销 / 导入导出 / 云同步（Supabase）
 *
 * 数据分两层：
 *   本机：localStorage（被禁用时降级为内存，界面会明确告知）
 *   云端：Supabase public.user_data，作用域由 site-scope.js 按路径计算
 * ========================================================================= */
(function () {
	'use strict';
	var ZC = window.ZC;
	var KEY = 'merit.zongce.v1';
	var APP_ID = 'study-merit';

	/* ------------------------------------------------ 存储层（带降级） */
	var mem = {};
	var lsOK = true;
	try { localStorage.setItem(KEY + '__probe', '1'); localStorage.removeItem(KEY + '__probe'); }
	catch (e) { lsOK = false; }
	ZC.storageOK = lsOK;

	var disk = {
		get: function (k) {
			try {
				var v = localStorage.getItem(k);
				if (v !== null) return v;
			} catch (e) { /* ignore */ }
			return mem[k] === undefined ? null : mem[k];
		},
		set: function (k, v) {
			mem[k] = v;
			if (!lsOK) return false;
			try { localStorage.setItem(k, v); return true; }
			catch (e) { lsOK = false; ZC.storageOK = false; return false; }
		}
	};

	/* ------------------------------------------------ 状态 */
	var state = {
		version: 1,
		profiles: [],
		activeId: null,
		globalRules: {},
		ui: { view: 'overview', theme: 'dark', tipsFilter: 'all', matFilter: 'all', rbQuery: '', expanded: {} },
		simMode: false,
		simDraft: null,
		deleted: {},
		lastSaved: null,
		dirty: false
	};
	ZC.state = state;

	/* ------------------------------------------------ 档案读写 */
	ZC.getProfile = function () {
		if (state.simMode && state.simDraft) return state.simDraft;
		return state.profiles.filter(function (p) { return p.id === state.activeId; })[0] || state.profiles[0];
	};
	ZC.getRealProfile = function () {
		return state.profiles.filter(function (p) { return p.id === state.activeId; })[0] || state.profiles[0];
	};
	ZC.getRules = function (profile) {
		var p = profile || ZC.getProfile();
		return ZC.mergeRules(ZC.mergeRules(ZC.DEFAULT_RULES, state.globalRules), p ? p.ruleOverride : null);
	};

	/** 用空档案做模板递归补全缺失字段（数组整体替换，不逐元素合并） */
	function deepFill(base, over) {
		Object.keys(base).forEach(function (k) {
			var ov = over ? over[k] : undefined;
			if (ov === undefined) return;
			var bv = base[k];
			if (bv && typeof bv === 'object' && !Array.isArray(bv) && ov && typeof ov === 'object' && !Array.isArray(ov)) deepFill(bv, ov);
			else base[k] = ov;
		});
		Object.keys(over || {}).forEach(function (k) { if (!(k in base)) base[k] = over[k]; });
		return base;
	}
	function fillProfile(p) {
		var out = deepFill(ZC.blankProfile('x', 'y', 'z'), p || {});
		out.id = (p && p.id) || ZC.uid();
		out.createdAt = (p && p.createdAt) || Date.now();
		out.updatedAt = (p && p.updatedAt) || out.createdAt;
		return out;
	}
	ZC.fillProfile = fillProfile;

	function migrate(raw) {
		if (!raw || typeof raw !== 'object') return null;
		if (!Array.isArray(raw.profiles)) raw.profiles = [];
		raw.profiles.forEach(function (p, i) { raw.profiles[i] = fillProfile(p); });
		return raw;
	}

	ZC.load = function () {
		var raw = null;
		try { raw = JSON.parse(disk.get(KEY) || 'null'); } catch (e) { raw = null; }
		raw = migrate(raw);
		if (raw && raw.profiles && raw.profiles.length) {
			state.profiles = raw.profiles;
			state.activeId = (raw.activeId && raw.profiles.some(function (p) { return p.id === raw.activeId; })) ? raw.activeId : raw.profiles[0].id;
			state.globalRules = raw.globalRules || {};
			state.deleted = raw.deleted || {};
			state.simMode = !!raw.simMode;
			state.simDraft = raw.simDraft || null;
			if (state.simMode && !state.simDraft) state.simMode = false;
			Object.assign(state.ui, raw.ui || {});
		} else {
			var demo = ZC.buildDemoProfile();
			state.profiles = [demo];
			state.activeId = demo.id;
			state.globalRules = {};
			state.firstRun = true;
		}
		/* 主题：smartCubeTheme 是全站唯一真源（顶栏的主题按钮写的也是它），
		   本档案里的 ui.theme 只在站点没有存过时兜底 */
		var siteTheme = null;
		try { siteTheme = localStorage.getItem('smartCubeTheme'); } catch (e) { siteTheme = null; }
		if (siteTheme === 'light' || siteTheme === 'dark') state.ui.theme = siteTheme;
		else if (!(raw && raw.ui && raw.ui.theme)) {
			state.ui.theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
		}
		applyTheme();
		return state;
	};

	function payload() {
		return JSON.stringify({
			version: 1,
			profiles: state.profiles,
			activeId: state.activeId,
			globalRules: state.globalRules,
			deleted: state.deleted,
			simMode: state.simMode,
			simDraft: state.simDraft,
			ui: { view: state.ui.view, theme: state.ui.theme, tipsFilter: state.ui.tipsFilter, matFilter: state.ui.matFilter }
		});
	}

	ZC.flushSave = function () {
		try {
			var ok = disk.set(KEY, payload());
			state.dirty = false;
			state.lastSaved = new Date();
			return ok ? 'disk' : 'memory';
		} catch (e) { return false; }
	};

	var saveTimer = null;
	ZC.save = function (opts) {
		var silent = !!(opts && opts.silent);
		var p = ZC.getProfile();
		if (p) p.updatedAt = Date.now();
		state.dirty = true;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
			var r = ZC.flushSave();
			if (r === false) {
				ZC.toast('保存失败：浏览器存储空间不足，请立即导出 JSON 备份', 'danger');
				return;
			}
			if (!silent) ZC.flashSaved(r === 'memory');
			ZC.cloud.scheduleUpload();
		}, 220);
	};

	/* ------------------------------------------------ 撤销栈 */
	var undoStack = [];
	ZC.snapshot = function (label) {
		undoStack.push({
			label: label || '修改',
			data: JSON.stringify({ profiles: state.profiles, activeId: state.activeId, globalRules: state.globalRules, deleted: state.deleted })
		});
		if (undoStack.length > 40) undoStack.shift();
	};
	ZC.undo = function () {
		var s = undoStack.pop();
		if (!s) { ZC.toast('没有可撤销的操作', 'muted'); return false; }
		var d = JSON.parse(s.data);
		state.profiles = d.profiles;
		state.activeId = d.activeId;
		state.globalRules = d.globalRules;
		state.deleted = d.deleted || {};
		ZC.save({ silent: true });
		ZC.toast('已撤销：' + s.label, 'ok');
		return true;
	};
	ZC.canUndo = function () { return undoStack.length > 0; };

	/* ------------------------------------------------ 档案 CRUD */
	ZC.addProfile = function (name, college, year, copyFrom) {
		ZC.snapshot('新建档案');
		var p;
		if (copyFrom) {
			p = ZC.clone(copyFrom);
			p.id = ZC.uid();
			p.createdAt = Date.now();
			p.meta = Object.assign({}, p.meta, { name: name || (copyFrom.meta.name + ' 副本'), academicYear: year || copyFrom.meta.academicYear });
			if (college) p.meta.college = college;
		} else {
			p = ZC.blankProfile(name, college, year);
		}
		state.profiles.push(p);
		state.activeId = p.id;
		ZC.save({ silent: true });
		return p;
	};
	ZC.deleteProfile = function (id) {
		if (state.profiles.length <= 1) { ZC.toast('至少保留一个档案', 'warn'); return; }
		ZC.snapshot('删除档案');
		var i = -1;
		state.profiles.forEach(function (p, idx) { if (p.id === id) i = idx; });
		if (i < 0) return;
		var nm = state.profiles[i].meta.name;
		state.profiles.splice(i, 1);
		state.deleted[id] = Date.now();
		if (state.activeId === id) state.activeId = state.profiles[Math.max(0, i - 1)].id;
		ZC.save({ silent: true });
		ZC.toast('已删除档案「' + nm + '」，可撤销', 'ok');
	};
	ZC.switchProfile = function (id) {
		state.activeId = id;
		ZC.save({ silent: true });
	};

	/* ------------------------------------------------ 路径读写 */
	ZC.getPath = function (obj, path) {
		return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce(function (o, k) {
			return (o == null) ? o : o[k];
		}, obj);
	};
	ZC.setPath = function (obj, path, val) {
		var keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
		var cur = obj;
		for (var i = 0; i < keys.length - 1; i++) {
			if (cur[keys[i]] == null) cur[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
			cur = cur[keys[i]];
		}
		cur[keys[keys.length - 1]] = val;
	};

	/* ------------------------------------------------ 主题 */
	function applyTheme() {
		document.documentElement.setAttribute('data-theme', state.ui.theme === 'light' ? 'light' : 'dark');
	}
	ZC.applyTheme = applyTheme;
	ZC.toggleTheme = function () {
		state.ui.theme = state.ui.theme === 'dark' ? 'light' : 'dark';
		applyTheme();
		/* 与全站共用 smartCubeTheme，顺便把顶栏的主题按钮文字对齐 */
		try { localStorage.setItem('smartCubeTheme', state.ui.theme); } catch (e) { /* ignore */ }
		var btn = document.getElementById('siteThemeToggle');
		if (btn) btn.textContent = state.ui.theme === 'dark' ? '☀' : '☾';
		ZC.save({ silent: true });
	};

	/* ------------------------------------------------ 导入 / 导出 */
	ZC.exportJSON = function () {
		var data = {
			app: '综测算分器', appId: APP_ID, version: 1, exportedAt: new Date().toISOString(),
			profiles: state.profiles, globalRules: state.globalRules
		};
		var p = ZC.getProfile();
		ZC.download('综测数据_' + (p.meta.name || '未命名') + '_' + ZC.today() + '.json', JSON.stringify(data, null, 2), 'application/json');
		ZC.toast('已导出 JSON 备份', 'ok');
	};
	ZC.importJSON = function (text) {
		try {
			var d = JSON.parse(text);
			var incoming = migrate(d);
			if (!incoming || !incoming.profiles || !incoming.profiles.length) throw new Error('文件格式不正确');
			ZC.snapshot('导入数据');
			incoming.profiles.forEach(function (p) {
				p.id = ZC.uid();
				p.updatedAt = Date.now();
				state.profiles.push(p);
			});
			state.activeId = state.profiles[state.profiles.length - 1].id;
			if (d.globalRules) state.globalRules = d.globalRules;
			ZC.save({ silent: true });
			ZC.toast('已导入 ' + incoming.profiles.length + ' 个档案', 'ok');
			return true;
		} catch (e) {
			ZC.toast('导入失败：' + e.message, 'danger');
			return false;
		}
	};
	ZC.download = function (filename, text, mime) {
		var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
	};
	ZC.today = function () {
		var d = new Date();
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	};
	function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

	/* ------------------------------------------------ 工作日 / 申诉时效 */
	ZC.addWorkdays = function (dateStr, n) {
		var d = new Date(dateStr + 'T00:00:00');
		if (isNaN(d)) return null;
		var added = 0;
		while (added < n) {
			d.setDate(d.getDate() + 1);
			var w = d.getDay();
			if (w !== 0 && w !== 6) added++;
		}
		return d;
	};
	ZC.dateStr = function (d) {
		return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : '—';
	};
	ZC.appealTimeline = function (publicityDate, R) {
		var P = (R || ZC.DEFAULT_RULES).procedure;
		var objection = ZC.addWorkdays(publicityDate, P.publicityDays);
		var reply = objection ? ZC.addWorkdays(ZC.dateStr(objection), P.replyDays) : null;
		var appeal = reply ? ZC.addWorkdays(ZC.dateStr(reply), P.appealDays) : null;
		var final = appeal ? ZC.addWorkdays(ZC.dateStr(appeal), P.finalDays) : null;
		return { objection: objection, reply: reply, appeal: appeal, final: final };
	};

	/* ------------------------------------------------ 导出报表 */
	ZC.buildMarkdownReport = function (profile, R, res) {
		var p = profile;
		var L = [];
		L.push('# 综合素质测评自评表（' + p.meta.academicYear + ' 学年）');
		L.push('');
		L.push('- 姓名：' + (p.meta.name || '—') + '　学号：' + (p.meta.studentId || '—'));
		L.push('- 书院：' + p.meta.college + '　专业：' + (p.meta.major || '—') + '　班级：' + (p.meta.grade || '—'));
		L.push('- 生成时间：' + new Date().toLocaleString('zh-CN'));
		L.push('');
		L.push('## 总分：**' + ZC.fmt(res.total) + '** / ' + res.maxTotal);
		L.push('');
		L.push('| 构成 | 得分 | 满分 |');
		L.push('|---|---|---|');
		L.push('| 品行素质分 | ' + ZC.fmt(res.pinxing.final) + ' | ' + R.frame.pinxing + ' |');
		L.push('| 能力拓展分 | ' + ZC.fmt(res.ability.final) + ' | ' + R.frame.ability + ' |');
		L.push('| 奖励分 | ' + ZC.fmt(res.reward.final) + ' | ' + R.reward.cap + ' |');
		L.push('');
		var st = function (id) {
			var s = ZC.EVIDENCE_STATUS.filter(function (x) { return x.id === id; })[0];
			return s ? s.label : '未准备';
		};
		var sec = function (title, rows) {
			if (!rows.length) return;
			L.push('### ' + title);
			L.push('| 项目 | 分值 | 佐证材料 | 状态 |');
			L.push('|---|---|---|---|');
			rows.forEach(function (r) { L.push('| ' + r[0] + ' | ' + r[1] + ' | ' + (r[2] || '—') + ' | ' + (r[3] || '—') + ' |'); });
			L.push('');
		};
		sec('一、品行素质分 · 集体活动', res.pinxing.subs.collective.items.map(function (i) {
			return [i.label + (i.note ? '（' + i.note + '）' : ''), ZC.fmt(i.points), i.evidence || '', st(i.status)];
		}));
		if (p.meta.assessPass) L.push('> 基准分：' + ZC.fmt(res.pinxing.base) + ' 分（班级评议合格 + 书院审定通过）\n');
		sec('一、品行素质分 · 思想政治理论学习', res.pinxing.subs.ideology.items.map(function (i) {
			return [i.label + (i.note ? '（' + i.note + '）' : ''), ZC.fmt(i.points), '', ''];
		}));
		sec('一、品行素质分 · 社会服务', res.pinxing.subs.service.items.map(function (i) {
			return [i.label + (i.note ? '（' + i.note + '）' : ''), ZC.fmt(i.points), i.evidence || '', st(i.status)];
		}));
		sec('一、品行素质分 · 扣分', res.pinxing.deductions.map(function (i) {
			return [i.label, '−' + ZC.fmt(i.points), i.note, ''];
		}));
		sec('二、能力拓展分 · 学术科研及创新创业', res.ability.subs.academic.items.map(function (i) {
			return [(i.project || i.name || '未命名') + (i._merged && !i._counted ? '（同一项目取最高，未计入）' : ''),
				i._counted ? ZC.fmt(i._pts) : '0', i.evidence || '', st(i.status)];
		}));
		sec('二、能力拓展分 · 文体竞赛', res.ability.subs.culture.items.map(function (i) {
			return [(i.name || i.project || '未命名') + (i._merged && !i._counted ? '（同一项目取最高，未计入）' : ''),
				i._counted ? ZC.fmt(i._pts) : '0', i.evidence || '', st(i.status)];
		}));
		sec('二、能力拓展分 · 学生组织、社团任职', res.ability.subs.position.items.map(function (i) {
			return [(i.org || '') + ' ' + (i.role || '') + '（' + i._reason + '）' + (i._counted ? '' : '（兼任取最高，未计入）'),
				i._counted ? ZC.fmt(i._pts) : '0', i.evidence || '', st(i.status)];
		}));
		sec('三、奖励分', res.reward.items.map(function (i) {
			return [i.name || i._reason, ZC.fmt(i._pts), i.evidence || '', st(i.status)];
		}));
		L.push('## 计算过程');
		L.push('```');
		res.trace.forEach(function (t) {
			L.push(new Array(t.indent + 1).join('　') + t.label + (t.value !== undefined ? '　' + t.value : '') + (t.note ? '　// ' + t.note : ''));
		});
		L.push('```');
		if (res.composite && !res.composite.incomplete) {
			L.push('');
			L.push('## 综合成绩（' + res.composite.preset.name + '）');
			L.push('');
			L.push('**' + ZC.fmt(res.composite.total) + '**　＝　' + res.composite.parts.map(function (x) {
				return x.label + ' ' + ZC.fmt(x.value) + '×' + Math.round(x.weight * 100) + '%';
			}).join('　+　'));
		}
		L.push('');
		L.push('---');
		L.push('> 本表由「综测算分器」依据《西安交通大学本科生综合素质测评成绩评定办法》（2018 年 5 月印发）及其实施细则自动生成，仅供自评与材料准备参考。');
		L.push('> 集体活动单次分值、任职不满一年的酌情幅度等由各书（学）院自行认定，最终以所在书院当年公示的细则和班级评议结果为准。');
		return L.join('\n');
	};

	ZC.buildCSV = function (profile, R, res) {
		var rows = [['大类', '子类', '项目', '计入分值', '原始分值', '计算依据', '佐证材料', '材料状态', '日期']];
		var st = function (id) {
			var s = ZC.EVIDENCE_STATUS.filter(function (x) { return x.id === id; })[0];
			return s ? s.label : '未准备';
		};
		rows.push(['品行素质分', '基准分', '班级评议合格 + 书院审定通过', ZC.fmt(res.pinxing.base), '', '', '', '', '']);
		var sub = function (cat, name, o, label) {
			(o.items || []).forEach(function (i) {
				var v = (i._pts !== undefined ? i._pts : i.points);
				rows.push([cat, name, label(i), i._counted === false ? '0' : ZC.fmt(v), ZC.fmt(v),
					i._reason || i.note || '', i.evidence || '', st(i.status || i._status), i.date || '']);
			});
		};
		sub('品行素质分', '集体活动', res.pinxing.subs.collective, function (i) { return i.label; });
		sub('品行素质分', '思想政治理论学习', res.pinxing.subs.ideology, function (i) { return i.label; });
		sub('品行素质分', '社会服务', res.pinxing.subs.service, function (i) { return i.label; });
		res.pinxing.deductions.forEach(function (i) {
			rows.push(['品行素质分', '扣分', i.label, '−' + ZC.fmt(i.points), '', i.note, '', st(i.status), i.date]);
		});
		sub('能力拓展分', '学术科研及创新创业', res.ability.subs.academic, function (i) { return i.project || i.name || ''; });
		sub('能力拓展分', '文体竞赛', res.ability.subs.culture, function (i) { return i.name || i.project || ''; });
		sub('能力拓展分', '学生组织任职', res.ability.subs.position, function (i) { return (i.org || '') + ' ' + (i.role || ''); });
		sub('奖励分', '荣誉表彰', res.reward, function (i) { return i.name || i._reason; });
		rows.push([]);
		rows.push(['合计', '', '综合素质测评成绩', ZC.fmt(res.total), '', '满分 ' + res.maxTotal, '', '', '']);
		return '\uFEFF' + rows.map(function (r) {
			return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
		}).join('\r\n');
	};

	/* ------------------------------------------------ 示例档案 */
	ZC.buildDemoProfile = function () {
		var p = ZC.blankProfile('示例同学', '彭康书院', ZC.currentAcademicYear());
		p.meta.major = '计算机科学与技术';
		p.meta.grade = '计算机 0001 班';
		p.meta.studentId = '';
		p.meta.note = '这是一份示例档案，用来演示每一项怎么填、分数怎么算。可在「设置 → 数据管理」里清空后录入你自己的数据。';
		p.pinxing.collective.entries = [
			{ id: ZC.uid(), name: '书院迎新晚会', times: 1, date: '', status: 'approved', evidence: '主办单位名单' },
			{ id: ZC.uid(), name: '校庆志愿服务方阵', times: 1, date: '', status: 'submitted', evidence: '活动证明' },
			{ id: ZC.uid(), name: '书院体育节', times: 2, date: '', status: 'todo', evidence: '' }
		];
		p.pinxing.ideology = { orgTraining: 2, provincialTraining: 0, excellentTrainee: 1 };
		p.pinxing.service = { volunteerHours: 21, volunteerStatus: 'todo', volunteerNote: '志愿汇截图', schoolPractice: 1, cityIntern: 0, provIntern: 0, advanced: 0 };
		p.pinxing.deductions = [{ id: ZC.uid(), type: 'weisheng', count: 1, date: '', note: '10 月宿舍卫生检查', status: 'submitted' }];
		p.ability.academic = [
			{ id: ZC.uid(), kind: 'competition', project: '「互联网+」大学生创新创业大赛', level: 'prov', award: '二等奖', date: '', status: 'approved', evidence: '获奖证书扫描件', noMerge: false },
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
		return p;
	};

	/* =====================================================================
	 * 云同步（Supabase public.user_data · site_scope = Study-Merit）
	 * 与站点 nav.js 的约定：暴露 window.cloudSyncManager 的通用接口，
	 * 顶栏的登录 / 上传 / 下载 / 状态提示即可直接复用。
	 * ===================================================================== */

	function scope() {
		return window.getCurrentSiteScope ? window.getCurrentSiteScope() : '';
	}
	function basePath() {
		return window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : '';
	}

	var cloud = {
		state: 'local',      /* local | cloud | syncing | error | noscope | conflict */
		auto: true,
		timer: null,
		aligned: false,
		lastSync: null,
		message: ''
	};
	ZC.cloud = cloud;

	function setState(s, msg) {
		cloud.state = s;
		cloud.message = msg || '';
		if (s === 'cloud') cloud.lastSync = new Date();
		ZC.updateCloudTag();
	}

	/* 各设备的 profile 之间做「按 updatedAt 取新」的合并，删除用墓碑 */
	function mergeCloud(remote) {
		if (!remote || typeof remote !== 'object') return false;
		var changed = false;
		var byId = {};
		state.profiles.forEach(function (p) { byId[p.id] = p; });
		(remote.profiles || []).forEach(function (rp) {
			if (!rp || !rp.id) return;
			var local = byId[rp.id];
			if (!local) {
				var filled = fillProfile(rp);
				state.profiles.push(filled);
				byId[filled.id] = filled;
				changed = true;
			} else if ((rp.updatedAt || 0) > (local.updatedAt || 0)) {
				var idx = state.profiles.indexOf(local);
				var np = fillProfile(rp);
				state.profiles[idx] = np;
				byId[np.id] = np;
				changed = true;
			}
		});
		/* 墓碑：云端删除时间晚于本地修改 ⇒ 删掉本地那份 */
		Object.keys(remote.deleted || {}).forEach(function (id) {
			var ts = remote.deleted[id];
			var local = byId[id];
			if (local && ts > (local.updatedAt || 0) && state.profiles.length > 1) {
				state.profiles = state.profiles.filter(function (p) { return p.id !== id; });
				state.deleted[id] = ts;
				changed = true;
			}
			if (!state.deleted[id] || state.deleted[id] < ts) state.deleted[id] = ts;
		});
		if (!state.profiles.length) {
			var demo = ZC.buildDemoProfile();
			state.profiles = [demo];
			state.activeId = demo.id;
			changed = true;
		}
		if (!state.profiles.some(function (p) { return p.id === state.activeId; })) {
			state.activeId = state.profiles[0].id;
			changed = true;
		}
		if (remote.globalRules && Object.keys(remote.globalRules).length) {
			/* 规则口径以本机为准，但云端有、本机空时接过来 */
			if (!Object.keys(state.globalRules).length) { state.globalRules = remote.globalRules; changed = true; }
		}
		return changed;
	}

	function hasLocalData() {
		return state.profiles.some(function (p) {
			return (p.ability.academic || []).length || (p.ability.culture || []).length ||
				(p.ability.position || []).length || (p.reward.items || []).length ||
				(p.pinxing.collective.entries || []).length || (p.pinxing.deductions || []).length;
		});
	}

	function unpackCloudData(data) {
		if (window.SitePayloadCodec && typeof window.SitePayloadCodec.unpackPayloadData === 'function') {
			return window.SitePayloadCodec.unpackPayloadData(data);
		}
		return Promise.resolve(data);
	}

	function buildMeta(data) {
		var bytes = 0;
		try { bytes = JSON.stringify(data).length; } catch (e) { bytes = 0; }
		var n = 0;
		((data.merit || {}).profiles || []).forEach(function (p) {
			n += (p.ability.academic || []).length + (p.ability.culture || []).length +
				(p.ability.position || []).length + (p.reward.items || []).length +
				(p.pinxing.collective.entries || []).length + (p.pinxing.deductions || []).length;
		});
		return {
			bytes: bytes,
			items: n,
			profiles: ((data.merit || {}).profiles || []).length,
			hash: typeof window._siteNavPayloadHash === 'function' ? window._siteNavPayloadHash(data) : ''
		};
	}

	var manager = {
		isReady: function () {
			return !!(scope() && window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
		},
		hasScope: function () { return !!scope(); },

		buildLocalPayload: function () {
			var data = {
				merit: {
					app: APP_ID,
					schema: 1,
					activeId: state.activeId,
					profiles: state.profiles,
					globalRules: state.globalRules,
					deleted: state.deleted
				}
			};
			data.meta = buildMeta(data);
			return {
				exportedAt: new Date().toISOString(),
				source: 'Ckarefulon',
				siteScope: scope(),
				siteBasePath: basePath(),
				version: 1,
				data: data
			};
		},

		getCloudStatus: function (opts) {
			var light = !!(opts && opts.light);
			if (!manager.isReady()) return Promise.resolve({ success: false, message: '请先登录', hasData: false, cloudData: null });
			var user = window.authManager.getUser();
			if (!scope()) return Promise.resolve({ success: false, message: '当前路径无站点作用域', hasData: false, cloudData: null });
			var query = function (cols) {
				return window.supabaseClient.from('user_data').select(cols)
					.eq('user_id', user.id).eq('site_scope', scope()).maybeSingle();
			};
			return query(light ? 'updated_at,top_meta:data->meta,inner_meta:data->data->meta' : 'data, updated_at')
				.then(function (result) {
					if (light && result.error) {
						return query('data, updated_at').then(function (full) {
							if (full.error) return { success: false, message: '查询云端状态失败', hasData: false, cloudData: null };
							if (!full.data) return { success: true, message: '云端暂无数据', hasData: false, cloudData: null };
							return unpackCloudData(full.data.data).then(function (plain) {
								return { success: true, message: '云端已有数据', hasData: true, cloudData: plain, updatedAt: full.data.updated_at };
							});
						});
					}
					if (result.error) return { success: false, message: '查询云端状态失败', hasData: false, cloudData: null };
					if (!result.data) return { success: true, message: '云端暂无数据', hasData: false, cloudData: null };
					if (light) {
						var row = result.data || {};
						var meta = (row.top_meta !== undefined && row.top_meta !== null) ? row.top_meta
							: (row.inner_meta !== undefined && row.inner_meta !== null) ? row.inner_meta
							: ((row.meta !== undefined ? row.meta : (row.data && row.data.meta)) || null);
						return { success: true, message: '云端已有数据', hasData: true, light: true, cloudMeta: meta, updatedAt: row.updated_at, cloudData: null };
					}
					return unpackCloudData(result.data.data).then(function (plain) {
						return { success: true, message: '云端已有数据', hasData: true, cloudData: plain, updatedAt: result.data.updated_at };
					});
				})
				.catch(function (err) {
					console.error('[Merit] 查询云端状态失败', err);
					return { success: false, message: '查询云端状态失败', hasData: false, cloudData: null };
				});
		},

		uploadLocalToCloud: function () {
			if (!manager.isReady()) return Promise.resolve({ success: false, message: '请先登录' });
			var user = window.authManager.getUser();
			if (!scope()) return Promise.resolve({ success: false, message: '当前路径无站点作用域' });
			var packedP = (window.SitePayloadCodec && typeof window.SitePayloadCodec.packPayload === 'function')
				? window.SitePayloadCodec.packPayload(manager.buildLocalPayload())
				: Promise.resolve(manager.buildLocalPayload());
			return packedP.then(function (packed) {
				return window.supabaseClient.from('user_data').upsert({
					user_id: user.id,
					site_scope: scope(),
					data: packed,
					updated_at: new Date().toISOString()
				}, { onConflict: 'user_id,site_scope' });
			}).then(function (result) {
				if (result.error) {
					console.error('[Merit] 上传失败', result.error);
					return { success: false, message: '上传失败，请稍后重试' };
				}
				if (typeof window._siteNavMarkAsSynced === 'function') {
					try { window._siteNavMarkAsSynced(); } catch (e) { /* ignore */ }
				}
				return { success: true, message: '已同步到云端' };
			}).catch(function (err) {
				console.error('[Merit] 上传异常', err);
				return { success: false, message: '上传失败，请稍后重试' };
			});
		},

		applyDataToLocalStorage: function (dataBlock) {
			if (!dataBlock || typeof dataBlock !== 'object') return {};
			var applied = {};
			var merit = dataBlock.merit || dataBlock;
			if (merit && (merit.profiles || merit.deleted)) {
				window._siteNavApplyingCloudData = true;
				try {
					var changed = mergeCloud(merit);
					applied.merit = true;
					ZC.flushSave();
					if (changed) ZC.toast('已从云端同步', 'ok');
				} finally {
					setTimeout(function () { window._siteNavApplyingCloudData = false; }, 0);
				}
			}
			return applied;
		},

		downloadCloudToLocal: function () {
			if (!manager.isReady()) return Promise.resolve({ success: false, message: '请先登录', data: null });
			var user = window.authManager.getUser();
			return window.supabaseClient.from('user_data').select('data')
				.eq('user_id', user.id).eq('site_scope', scope()).maybeSingle()
				.then(function (result) {
					if (result.error) return { success: false, message: '读取云端数据失败', data: null };
					if (!result.data || !result.data.data || !result.data.data.data) return { success: false, message: '云端暂无数据', data: null };
					return unpackCloudData(result.data.data.data).then(function (block) {
						if (!block || typeof block !== 'object') return { success: false, message: '云端数据格式不正确', data: null };
						manager.applyDataToLocalStorage(block);
						setState('cloud');
						return { success: true, message: '已从云端恢复', data: block };
					});
				})
				.catch(function (err) {
					console.error('[Merit] 恢复失败', err);
					return { success: false, message: '恢复失败，请稍后重试', data: null };
				});
		},

		/** 登录后的首次对齐：先合并云端，再上传合并结果 */
		syncNow: function () {
			if (!manager.isReady()) { setState('local'); return Promise.resolve(false); }
			setState('syncing');
			return manager.getCloudStatus().then(function (status) {
				if (!status.success) { setState('error', status.message); return false; }
				if (status.hasData && status.cloudData) {
					var merit = status.cloudData.merit || status.cloudData;
					if (merit && merit.app && merit.app !== APP_ID) {
						setState('conflict', '云端该作用域已有其它站点的数据');
						return false;
					}
					mergeCloud(merit);
					ZC.flushSave();
				}
				return manager.uploadLocalToCloud().then(function (r) {
					setState(r.success ? 'cloud' : 'error', r.message);
					if (r.success && ZC.rerender) ZC.rerender();
					return r.success;
				});
			});
		},

		scheduleUpload: function (delay) {
			if (!manager.isReady() || !cloud.auto) return;
			clearTimeout(cloud.timer);
			cloud.timer = setTimeout(function () {
				cloud.timer = null;
				if (!manager.isReady() || !cloud.auto) return;
				setState('syncing');
				manager.uploadLocalToCloud().then(function (r) {
					setState(r.success ? 'cloud' : 'error', r.message);
				});
			}, typeof delay === 'number' ? delay : 1400);
		},

		setAuto: function (on) {
			cloud.auto = !!on;
			if (cloud.auto) manager.syncNow();
			ZC.updateCloudTag();
		}
	};

	window.cloudSyncManager = manager;
	/* ZC.cloud 既是状态袋也是入口：save() 与设置页都从这里调 */
	cloud.scheduleUpload = manager.scheduleUpload;
	cloud.setAuto = manager.setAuto;
	cloud.syncNow = manager.syncNow;
	cloud.uploadLocalToCloud = manager.uploadLocalToCloud;
	cloud.downloadCloudToLocal = manager.downloadCloudToLocal;
	window._siteNavReloadData = function () {
		/* nav 的下载/回滚流程结束后会调用；本地状态已经改过，重建界面即可 */
		if (ZC.rerender) ZC.rerender();
	};

	ZC.initCloud = function () {
		if (!window.authManager) { setState('local'); return; }
		if (!scope()) { setState('noscope'); return; }
		if (window.authManager.isLoggedIn()) { manager.syncNow(); }
		window.authManager.onAuthStateChange(function (user) {
			cloud.aligned = !!user;
			if (user) manager.syncNow();
			else setState('local');
		});
	};

	ZC.mergeCloud = mergeCloud;
})();
