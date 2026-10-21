/* =========================================================================
 * merit-app.js — 应用外壳、路由、事件委托、渲染调度
 * ========================================================================= */
(function () {
	'use strict';
	var ZC = window.ZC;
	var ui = ZC.ui, esc = ZC.esc, icon = ui.icon;

	/* ------------------------------------------------------------- 导航 */
	ZC.NAV = [
		{ group: '计分', items: [
			{ id: 'overview', label: '概览', ico: 'overview' },
			{ id: 'pinxing', label: '品行素质分', ico: 'shield', score: 'pinxing' },
			{ id: 'ability', label: '能力拓展分', ico: 'rocket', score: 'ability' },
			{ id: 'reward', label: '奖励分', ico: 'award', score: 'reward' }
		] },
		{ group: '工具', items: [
			{ id: 'composite', label: '综合成绩 · 资格', ico: 'calc' },
			{ id: 'materials', label: '材料清单', ico: 'folder' },
			{ id: 'simulate', label: '情景模拟', ico: 'flask' },
			{ id: 'rank', label: '班级对比', ico: 'users' },
			{ id: 'procedure', label: '程序与时效', ico: 'clock' }
		] },
		{ group: '参考', items: [
			{ id: 'rulebook', label: '规则手册', ico: 'book' },
			{ id: 'settings', label: '设置', ico: 'gear' }
		] }
	];

	/* ------------------------------------------------------------- 上下文 */
	ZC.ctx = function () {
		var p = ZC.getProfile();
		var R = ZC.getRules(p);
		var res = ZC.compute(p, R);
		var insights = ZC.buildInsights(p, R, res);
		var map = { academic: {}, culture: {}, position: {}, reward: {} };
		['academic', 'culture', 'position'].forEach(function (k) {
			(res.ability.subs[k].items || []).forEach(function (it) { map[k][it.id] = it; });
		});
		(res.reward.items || []).forEach(function (it) { map.reward[it.id] = it; });
		return { p: p, R: R, res: res, insights: insights, map: map };
	};

	/* ------------------------------------------------------------- Toast */
	var toastTimer = null;
	ZC.toast = function (msg, kind) {
		var t = document.getElementById('toast');
		if (!t) return;
		t.textContent = msg;
		t.className = 'toast is-show' + (kind ? ' is-' + kind : '');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { t.className = 'toast'; }, 2400);
	};
	ZC.flashSaved = function (memoryOnly) {
		var el = document.getElementById('save-state');
		if (!el) return;
		el.textContent = memoryOnly ? '仅本次会话（存储被禁用）' : '已保存 · ' + new Date().toLocaleTimeString('zh-CN');
		el.classList.add('is-flash');
		setTimeout(function () { el.classList.remove('is-flash'); }, 600);
	};

	/* ------------------------------------------------------------- 云标签 */
	ZC.updateCloudTag = function () {
		var tags = document.querySelectorAll('[data-cloud-tag]');
		var m = {
			local: ['本地', 'local'],
			cloud: ['云端', 'cloud'],
			syncing: ['同步中', 'sync'],
			error: ['未同步', 'err'],
			noscope: ['无作用域', 'err'],
			conflict: ['冲突', 'err']
		};
		var s = m[ZC.cloud.state] || m.local;
		for (var i = 0; i < tags.length; i++) {
			tags[i].textContent = s[0];
			tags[i].setAttribute('data-state', s[1]);
			tags[i].title = ZC.cloud.message || '';
		}
	};

	/* ------------------------------------------------------------- 外壳 */
	function shell() {
		var navHtml = ZC.NAV.map(function (g) {
			return '<div class="nav-group"><span class="nav-group-t">' + g.group + '</span>' +
				g.items.map(function (it) {
					return '<a class="nav-item" href="#/' + it.id + '" data-nav="' + it.id + '">' +
						'<span class="nav-ico">' + icon(it.ico, 17) + '</span>' +
						'<span class="nav-txt">' + it.label + '</span>' +
						(it.score ? '<span class="nav-score" data-score="' + it.score + '">0</span>' : '') +
						'</a>';
				}).join('') + '</div>';
		}).join('');

		return '<div class="shell">' +
			'<aside class="side">' +
				'<div class="side-top">' +
					'<div class="brand">' +
						'<span class="brand-mark">' + icon('calc', 19) + '</span>' +
						'<span class="brand-txt"><b>综测算分器</b><i>西安交通大学 · 本科生综合素质测评</i></span>' +
					'</div>' +
				'</div>' +
				'<nav class="side-nav">' + navHtml + '</nav>' +
				'<div class="side-foot">' +
					'<span class="cloud-tag" data-cloud-tag data-state="local">本地</span>' +
					'<span class="side-note" id="save-state">未保存</span>' +
				'</div>' +
			'</aside>' +
			'<div class="main">' +
				'<header class="topbar">' +
					'<span class="tb-wrap">' +
						'<button type="button" class="tb-profile" data-act="prof-menu" title="切换档案 / 设置">' +
							'<span class="tb-avatar">' + icon('user', 15) + '</span>' +
							'<span class="tb-pname" id="tb-pname">—</span>' +
							'<span class="tb-pyear" id="tb-pyear"></span>' +
							icon('down', 12) +
						'</button>' +
						'<div class="tb-menu" id="tb-menu" data-open="0" role="menu"></div>' +
					'</span>' +
					'<div class="tb-score" id="tb-score"></div>' +
					'<div class="tb-acts">' +
						'<button type="button" class="icon-btn" data-act="undo" title="撤销 (Ctrl+Z)" id="btn-undo">' + icon('undo', 16) + '</button>' +
						'<button type="button" class="icon-btn" data-act="exp-json" title="导出 JSON 备份">' + icon('download', 16) + '</button>' +
						'<button type="button" class="icon-btn" data-act="theme" title="切换深浅色">' + icon('moon', 16) + '</button>' +
					'</div>' +
				'</header>' +
				'<main class="view" id="view"></main>' +
				'<footer class="foot">' +
					'<p>依据《西安交通大学本科生综合素质测评成绩评定办法》（2018 年 5 月印发）及其实施细则构建 · 仅供自评与材料准备参考</p>' +
					'<p class="foot-w">集体活动单次分值、任职不满一年的酌情幅度等由各书（学）院自行认定，最终以所在书院当年公示的细则与班级评议、书院审定结果为准。</p>' +
				'</footer>' +
			'</div>' +
		'</div>';
	}

	/* ------------------------------------------------------------- 计分条 */
	function scoreStrip(ctx) {
		var R = ctx.R, res = ctx.res, p = ctx.p;
		var segs = [
			{ l: '品行', v: res.pinxing.final, m: R.frame.pinxing, nav: 'pinxing' },
			{ l: '能力', v: res.ability.final, m: R.frame.ability, nav: 'ability' },
			{ l: '奖励', v: res.reward.final, m: R.reward.cap, nav: 'reward' }
		];
		var target = +p.target.score || 0;
		var gap = target ? ZC.r2(target - res.total) : null;
		return segs.map(function (s) {
			return '<a class="tb-seg" href="#/' + s.nav + '" data-nav="' + s.nav + '" title="' + s.l + '素质分 ' + ZC.fmt(s.v) + ' / ' + s.m + '">' +
				'<span>' + s.l + '</span><b>' + ZC.fmt(s.v) + '</b><i>' + s.m + '</i>' +
				ui.bar(s.v, s.m, 'bar-xs') + '</a>';
		}).join('') +
			'<a class="tb-total" href="#/overview" data-nav="overview" title="综合素质测评成绩">' +
				'<span>总分</span><b>' + ZC.fmt(res.total) + '</b><i>/ ' + res.maxTotal + '</i></a>' +
			(gap !== null ? '<span class="tb-gap ' + (gap > 0 ? 'is-neg' : 'is-pos') + '">' + icon('target', 12) +
				(gap > 0 ? '差 ' + ZC.fmt(gap) : '超 ' + ZC.fmt(-gap)) + '</span>' : '');
	}

	/* ------------------------------------------------------------- 档案菜单 */
	function renderProfileMenu(ctx) {
		var host = document.getElementById('tb-menu');
		if (!host) return;
		var open = !!ZC.state.ui.expanded.profMenu;
		host.setAttribute('data-open', open ? '1' : '0');
		if (!open) { host.innerHTML = ''; return; }
		var rows = ZC.state.profiles.map(function (pr) {
			var r = ZC.getRules(pr), rs = ZC.compute(pr, r);
			return '<button type="button" class="tb-mi' + (pr.id === ZC.state.activeId ? ' is-on' : '') + '" role="menuitem" data-act="prof-switch" data-arg="' + pr.id + '">' +
				'<span class="tb-mi-name">' + esc(pr.meta.name || '未命名档案') + '</span>' +
				'<span class="tb-mi-meta">' + esc(pr.meta.academicYear) + ' · ' + esc(pr.meta.college) + '</span>' +
				'<span class="tb-mi-score">' + ZC.fmt(rs.total) + '</span></button>';
		}).join('');
		host.innerHTML = rows +
			'<div class="tb-mi-sep"></div>' +
			'<button type="button" class="tb-mi is-plain" data-act="prof-new">' + icon('plus', 14) + '<span>新建档案</span></button>' +
			'<button type="button" class="tb-mi is-plain" data-act="go" data-arg="settings">' + icon('gear', 14) + '<span>档案与设置</span></button>';
	}

	/* ------------------------------------------------------------- 渲染 */
	var pending = false;
	var lastCtx = null;
	ZC.rerender = function () {
		if (pending) return;
		pending = true;
		requestAnimationFrame(function () { pending = false; doRender(); });
	};

	function doRender() {
		var ctx = ZC.ctx();
		lastCtx = ctx;
		var view = ZC.views[ZC.state.ui.view] || ZC.views.overview;

		var ae = document.activeElement;
		var key = (ae && ae.getAttribute) ? ae.getAttribute('data-k') : null;
		var s1 = 0, s2 = 0;
		try { s1 = ae.selectionStart; s2 = ae.selectionEnd; } catch (e) { /* textarea/input only */ }
		var sy = window.scrollY;

		var host = document.getElementById('view');
		host.innerHTML = view.render(ctx);
		document.getElementById('tb-score').innerHTML = scoreStrip(ctx);
		document.getElementById('tb-pname').textContent = ctx.p.meta.name || '未命名档案';
		document.getElementById('tb-pyear').textContent = ctx.p.meta.academicYear + ' · ' + ctx.p.meta.college;
		renderProfileMenu(ctx);

		var scores = {
			pinxing: ZC.fmt(ctx.res.pinxing.final),
			ability: ZC.fmt(ctx.res.ability.final),
			reward: ZC.fmt(ctx.res.reward.final)
		};
		Object.keys(scores).forEach(function (k) {
			var n = document.querySelector('[data-score="' + k + '"]');
			if (n) n.textContent = scores[k];
		});
		var items = document.querySelectorAll('.nav-item');
		for (var i = 0; i < items.length; i++) {
			items[i].classList.toggle('is-on', items[i].getAttribute('data-nav') === ZC.state.ui.view);
		}
		/* 移动端的顶部分栏是横向滚动的：切页后把当前项滚进可视区 */
		if (window.innerWidth < 980) {
			var on = document.querySelector('.nav-item.is-on');
			if (on && on.scrollIntoView) {
				try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* 老浏览器忽略 */ }
			}
		}
		var ub = document.getElementById('btn-undo');
		if (ub) ub.disabled = !ZC.canUndo();

		if (key) {
			var sel = '[data-k="' + key.replace(/"/g, '\\"') + '"]';
			var t = host.querySelector(sel);
			if (t && !t.disabled) {
				try {
					t.focus({ preventScroll: true });
					if (s1 || s2) t.setSelectionRange(s1, s2);
				} catch (e) { /* 非文本控件忽略 */ }
			}
		}
		window.scrollTo(0, sy);
		if (view.after) view.after(ctx, host);
	}

	ZC.go = function (id) {
		if (!ZC.views[id]) id = 'overview';
		ZC.state.ui.view = id;
		if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
		window.scrollTo(0, 0);
		ZC.rerender();
		ZC.save({ silent: true });
	};

	/* ------------------------------------------------------------- 字段写入 */
	function coerce(el, raw) {
		var t = el.getAttribute('data-t');
		if (t === 'bool') return !!el.checked;
		if (t === 'num') {
			if (raw === '' || raw === null) return '';
			var n = parseFloat(raw);
			return isNaN(n) ? '' : n;
		}
		return raw;
	}

	function setField(path, value) {
		if (path === '@@autoSync') { ZC.cloud.setAuto(value); return; }
		if (path === '@@paste') { ZC.state.ui.pasteDraft = value; return; }
		if (path.indexOf('ui.') === 0) { ZC.setPath(ZC.state.ui, path.slice(3), value); ZC.save({ silent: true }); return; }
		var p = ZC.getProfile();
		ZC.setPath(p, path, value);
		ZC.fixups(p, path, ZC.getRules(p));
		ZC.save();
	}

	function onField(el) {
		var k = el.getAttribute('data-k');
		if (!k) return;
		var val = coerce(el, el.value);
		var cur;
		if (k.indexOf('ui.') === 0) cur = ZC.getPath(ZC.state.ui, k.slice(3));
		else if (k.charAt(0) === '@') cur = null;
		else cur = ZC.getPath(ZC.getProfile(), k);
		if (cur !== undefined && String(cur) === String(val)) return;
		setField(k, val);
		ZC.rerender();
	}

	/* ------------------------------------------------------------- 条目模板 */
	function newItem(tpl) {
		var base = { id: ZC.uid(), status: 'todo', evidence: '', date: '' };
		switch (tpl) {
			case 'collective': return Object.assign(base, { name: '', times: 1 });
			case 'deduction': return Object.assign(base, { type: 'kuangke', count: 1, note: '' });
			case 'academic-comp': return Object.assign(base, { kind: 'competition', project: '', level: 'school', award: '三等奖', noMerge: false });
			case 'academic-paper': return Object.assign(base, { kind: 'paper', project: '', pubClass: 'ii', rank: 1, signUnit: '西安交通大学', excellentPaper: false, noMerge: true });
			case 'academic-patent': return Object.assign(base, { kind: 'patent', project: '', patentType: '实用新型专利', rank: 1, signUnit: '西安交通大学', noMerge: true });
			case 'academic-book': return Object.assign(base, { kind: 'book', project: '', pubClass: 'book', rank: 1, signUnit: '西安交通大学', isEditor: false, noMerge: true });
			case 'culture-art': return Object.assign(base, { kind: 'art', name: '', level: 'school', award: '三等奖', record: false });
			case 'culture-sport': return Object.assign(base, { kind: 'sport', name: '', level: 'school', award: '第3名', record: false });
			case 'position': return Object.assign(base, { org: '', role: '', tier: 't4', assessment: '合格', startDate: '', endDate: '' });
			case 'reward': return Object.assign(base, { category: 'honor', level: 'school', name: '' });
			case 'classmate': return { id: ZC.uid(), name: '', composite: '', zongce: '' };
			default: return base;
		}
	}

	function expandKeyFor(tpl, item) {
		if (tpl === 'collective') return 'c:' + item.id;
		if (tpl === 'deduction') return '';
		if (tpl.indexOf('academic') === 0) return 'a:' + item.id;
		if (tpl.indexOf('culture') === 0) return 'u:' + item.id;
		if (tpl === 'position') return 'p:' + item.id;
		if (tpl === 'reward') return 'r:' + item.id;
		return '';
	}

	/* ------------------------------------------------------------- 扣分步进 */
	function dedStep(type, delta, limit) {
		var p = ZC.getProfile();
		var arr = p.pinxing.deductions || (p.pinxing.deductions = []);
		var idx = -1;
		arr.forEach(function (d, i) { if (d.type === type) idx = i; });
		if (idx < 0) {
			if (delta <= 0) return;
			arr.push({ id: ZC.uid(), type: type, count: Math.min(limit, delta), note: '', date: '', status: 'todo' });
		} else {
			var n = (+arr[idx].count || 0) + delta;
			if (n <= 0) arr.splice(idx, 1);
			else arr[idx].count = Math.min(limit, n);
		}
		ZC.save();
	}

	/* ------------------------------------------------------------- 动作 */
	Object.assign(ZC.actions, {
		go: function (arg) { ZC.go(arg); },
		theme: function () { ZC.toggleTheme(); ZC.rerender(); },
		undo: function () { if (ZC.undo()) ZC.rerender(); },
		'prof-menu': function () {
			var ex = ZC.state.ui.expanded || (ZC.state.ui.expanded = {});
			ex.profMenu = !ex.profMenu;
			ZC.save({ silent: true });
			ZC.rerender();
		},

		inc: function (arg) {
			var a = String(arg).split('|');
			var path = a[0], step = +a[1] || 1, limit = +a[2];
			if (path.indexOf('@@ded:') === 0) { dedStep(path.slice(6), step, limit); ZC.rerender(); return; }
			var p = ZC.getProfile();
			var cur = +ZC.getPath(p, path) || 0;
			var next = cur + step;
			if (isFinite(limit)) next = Math.min(limit, next);
			ZC.setPath(p, path, Math.max(0, next));
			ZC.save();
			ZC.rerender();
		},
		dec: function (arg) {
			var a = String(arg).split('|');
			var path = a[0], step = +a[1] || 1;
			if (path.indexOf('@@ded:') === 0) { dedStep(path.slice(6), -step, 99); ZC.rerender(); return; }
			var p = ZC.getProfile();
			var cur = +ZC.getPath(p, path) || 0;
			ZC.setPath(p, path, Math.max(0, cur - step));
			ZC.save();
			ZC.rerender();
		},
		seg: function (arg) {
			var i = String(arg).indexOf('|');
			var path = String(arg).slice(0, i), value = String(arg).slice(i + 1);
			setField(path, value);
			ZC.rerender();
		},
		toggle: function (arg) {
			var ex = ZC.state.ui.expanded || (ZC.state.ui.expanded = {});
			ex[arg] = !ex[arg];
			ZC.save({ silent: true });
			ZC.rerender();
		},
		add: function (arg) {
			var a = String(arg).split('|');
			var listKey = a[0], tpl = a[1] || a[0];
			var path = ZC.LIST_PATH[listKey];
			if (!path) return;
			var p = ZC.getProfile();
			ZC.snapshot('新增条目');
			var item = newItem(tpl);
			var arr = ZC.getPath(p, path) || [];
			if (!Array.isArray(arr)) { ZC.setPath(p, path, arr = []); }
			arr.push(item);
			var key = expandKeyFor(tpl, item);
			if (key) ZC.state.ui.expanded[key] = true;
			ZC.save();
			ZC.rerender();
		},
		del: function (arg) {
			var i = String(arg).lastIndexOf('|');
			var path = String(arg).slice(0, i), idx = +String(arg).slice(i + 1);
			var p = ZC.getProfile();
			ZC.snapshot('删除条目');
			var arr = ZC.getPath(p, path);
			if (!arr || !arr.splice) return;
			arr.splice(idx, 1);
			ZC.save();
			ZC.rerender();
			ZC.toast('已删除，可用顶部撤销恢复', 'ok');
		},
		dup: function (arg) {
			var i = String(arg).lastIndexOf('|');
			var path = String(arg).slice(0, i), idx = +String(arg).slice(i + 1);
			var p = ZC.getProfile();
			ZC.snapshot('复制条目');
			var arr = ZC.getPath(p, path);
			if (!arr) return;
			var c = ZC.clone(arr[idx]);
			c.id = ZC.uid();
			c.status = 'todo';
			arr.splice(idx + 1, 0, c);
			ZC.save();
			ZC.rerender();
		},
		'tips-filter': function (arg) { ZC.state.ui.tipsFilter = arg; ZC.save({ silent: true }); ZC.rerender(); },
		'mat-filter': function (arg) { ZC.state.ui.matFilter = arg; ZC.save({ silent: true }); ZC.rerender(); },

		/* ---- 情景模拟 ---- */
		'sim-enter': function () { ZC.sim.enter(); },
		'sim-apply': function () { ZC.sim.exit(true); },
		'sim-discard': function () { ZC.sim.exit(false); },
		'sim-reset': function () { ZC.sim.reset(); },
		'sim-quick': function (arg) { ZC.sim.quick(arg); },

		/* ---- 班级对比批量粘贴 ---- */
		'paste-do': function () {
			var txt = String(ZC.state.ui.pasteDraft || '');
			var lines = txt.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
			if (!lines.length) { ZC.toast('没有可导入的内容', 'warn'); return; }
			var p = ZC.getProfile();
			p.classmates = p.classmates || [];
			ZC.snapshot('批量导入同学');
			var n = 0;
			lines.forEach(function (l) {
				var parts = l.split(/[,，\t ]+/).filter(Boolean);
				if (!parts.length) return;
				var name = isNaN(+parts[0]) ? parts.shift() : ('同学 ' + (p.classmates.length + 1));
				var nums = parts.map(function (x) { return +x; }).filter(function (x) { return !isNaN(x); });
				p.classmates.push({ id: ZC.uid(), name: name, composite: nums[0] !== undefined ? nums[0] : '', zongce: nums[1] !== undefined ? nums[1] : '' });
				n++;
			});
			ZC.state.ui.pasteDraft = '';
			ZC.state.ui.expanded.paste = false;
			ZC.save();
			ZC.rerender();
			ZC.toast('已导入 ' + n + ' 位同学', 'ok');
		},

		/* ---- 导出 / 复制 ---- */
		'exp-json': function () { ZC.exportJSON(); },
		'exp-md': function () {
			var c = ZC.ctx();
			ZC.download('综测自评表_' + (c.p.meta.name || '未命名') + '_' + ZC.today() + '.md', ZC.buildMarkdownReport(c.p, c.R, c.res), 'text/markdown');
			ZC.toast('已导出 Markdown 自评表', 'ok');
		},
		'exp-csv': function () {
			var c = ZC.ctx();
			ZC.download('综测明细_' + (c.p.meta.name || '未命名') + '_' + ZC.today() + '.csv', ZC.buildCSV(c.p, c.R, c.res), 'text/csv');
			ZC.toast('已导出 CSV 明细', 'ok');
		},
		print: function () { window.print(); },
		'copy-md': function () {
			var c = ZC.ctx();
			ZC.copyText(ZC.buildMarkdownReport(c.p, c.R, c.res), '自评表已复制');
		},
		'copy-appeal': function () {
			var el = document.getElementById('appeal-ta');
			if (el) ZC.copyText(el.value, '申诉模板已复制');
		},
		import: function () {
			var inp = document.createElement('input');
			inp.type = 'file';
			inp.accept = '.json,application/json';
			inp.onchange = function () {
				var f = inp.files[0];
				if (!f) return;
				var rd = new FileReader();
				rd.onload = function () { if (ZC.importJSON(rd.result)) ZC.rerender(); };
				rd.readAsText(f);
			};
			inp.click();
		},
		demo: function () {
			ZC.snapshot('载入示例');
			var d = ZC.buildDemoProfile();
			ZC.state.profiles.push(d);
			ZC.state.activeId = d.id;
			ZC.save();
			ZC.rerender();
			ZC.toast('已载入示例档案', 'ok');
		},
		'reset-rules': function () {
			ZC.snapshot('重置规则');
			ZC.state.globalRules = {};
			ZC.getProfile().ruleOverride = {};
			ZC.save();
			ZC.rerender();
			ZC.toast('已恢复校级默认规则', 'ok');
		},
		'clear-profile': function () {
			var b = document.querySelector('[data-act="clear-profile"]');
			if (b && !b.__armed) {
				b.__armed = true;
				b.classList.add('is-armed');
				var label = b.querySelector('span');
				var old = label ? label.textContent : '';
				if (label) label.textContent = '再点一次确认清空';
				ZC.toast('再点一次确认清空当前档案', 'warn');
				setTimeout(function () {
					if (!b.__armed) return;
					b.__armed = false;
					b.classList.remove('is-armed');
					if (label) label.textContent = old;
				}, 3200);
				return;
			}
			if (b) { b.__armed = false; b.classList.remove('is-armed'); }
			ZC.snapshot('清空档案');
			var p = ZC.getProfile();
			var meta = ZC.clone(p.meta), id = p.id, ca = p.createdAt;
			var fresh = ZC.blankProfile(meta.name, meta.college, meta.academicYear);
			fresh.meta = meta;
			fresh.id = id;
			fresh.createdAt = ca;
			fresh.updatedAt = Date.now();
			var i = 0;
			ZC.state.profiles.forEach(function (x, idx) { if (x.id === id) i = idx; });
			ZC.state.profiles[i] = fresh;
			ZC.save();
			ZC.rerender();
			ZC.toast('已清空当前档案', 'ok');
		},

		/* ---- 档案 ---- */
		'prof-switch': function (arg) {
			ZC.state.ui.expanded.profMenu = false;
			ZC.switchProfile(arg);
			ZC.rerender();
			ZC.toast('已切换档案', 'ok');
		},
		'prof-new': function () {
			ZC.state.ui.expanded.profMenu = false;
			ZC.addProfile('新档案', ZC.getProfile().meta.college, ZC.currentAcademicYear(), ZC.getProfile());
			ZC.rerender();
			ZC.toast('已新建并切换到新档案', 'ok');
		},
		'prof-dup': function (arg) {
			var src = ZC.state.profiles.filter(function (x) { return x.id === arg; })[0];
			if (!src) return;
			ZC.addProfile(src.meta.name + ' 副本', src.meta.college, src.meta.academicYear, src);
			ZC.rerender();
			ZC.toast('已复制档案', 'ok');
		},
		'prof-del': function (arg) {
			var src = ZC.state.profiles.filter(function (x) { return x.id === arg; })[0];
			if (!src) return;
			ZC.deleteProfile(arg);
			ZC.rerender();
		},
		'profiles-open': function () { ZC.go('settings'); },

		/* ---- 云同步 ---- */
		'cloud-push': function () {
			if (!(window.authManager && window.authManager.isLoggedIn())) { ZC.toast('请先在站点顶栏登录', 'warn'); return; }
			ZC.toast('正在上传…', 'info');
			window.cloudSyncManager.uploadLocalToCloud().then(function (r) {
				ZC.toast(r.message, r.success ? 'ok' : 'danger');
			});
		},
		'cloud-pull': function () {
			if (!(window.authManager && window.authManager.isLoggedIn())) { ZC.toast('请先在站点顶栏登录', 'warn'); return; }
			ZC.toast('正在读取云端…', 'info');
			window.cloudSyncManager.downloadCloudToLocal().then(function (r) {
				ZC.toast(r.message, r.success ? 'ok' : 'danger');
				if (r.success) ZC.rerender();
			});
		},
		'cloud-login': function () {
			var b = document.getElementById('siteLoginBtn') || document.getElementById('siteAvatar') ||
				document.getElementById('siteGuestAvatar');
			if (b) b.click();
			ZC.toast('登录入口在站点顶栏：账号与本站其它工具共用', 'info');
		},
		'cloud-signout': function () {
			if (window.authManager) window.authManager.signOut().then(function () { ZC.toast('已退出登录', 'ok'); });
		}
	});

	/* ------------------------------------------------------------- 情景模拟 */
	ZC.sim = {
		enter: function () {
			if (ZC.state.simMode) return;
			ZC.state.simDraft = ZC.clone(ZC.getRealProfile());
			ZC.state.simMode = true;
			ZC.save({ silent: true });
			ZC.rerender();
			ZC.toast('已进入模拟模式：所有改动只影响草稿', 'ok');
		},
		exit: function (apply) {
			if (!ZC.state.simMode) return;
			if (apply) {
				ZC.snapshot('应用模拟结果');
				var d = ZC.state.simDraft;
				var i = -1;
				ZC.state.profiles.forEach(function (x, idx) { if (x.id === d.id) i = idx; });
				d.updatedAt = Date.now();
				if (i >= 0) ZC.state.profiles[i] = d;
				else ZC.state.profiles.push(d);
				ZC.toast('模拟结果已应用到正式档案（可撤销）', 'ok');
			} else {
				ZC.toast('已丢弃模拟草稿', 'muted');
			}
			ZC.state.simMode = false;
			ZC.state.simDraft = null;
			ZC.save();
			ZC.rerender();
		},
		reset: function () {
			ZC.state.simDraft = ZC.clone(ZC.getRealProfile());
			ZC.rerender();
			ZC.toast('草稿已重置为当前正式数据', 'ok');
		},
		quick: function (arg) {
			if (!ZC.state.simMode) ZC.sim.enter();
			var d = ZC.state.simDraft, R = ZC.getRules(d);
			var year = ZC.today().slice(0, 4);
			switch (arg) {
				case 'vol32': d.pinxing.service.volunteerHours = Math.max(+d.pinxing.service.volunteerHours || 0, R.pinxing.service.volunteerHours); break;
				case 'orgtrain': d.pinxing.ideology.orgTraining = (+d.pinxing.ideology.orgTraining || 0) + 1; break;
				case 'provtrain': d.pinxing.ideology.provincialTraining = (+d.pinxing.ideology.provincialTraining || 0) + 1; break;
				case 'collect': d.pinxing.collective.mode = 'count'; d.pinxing.collective.entries.push({ id: ZC.uid(), name: '假设：重大活动', times: 1, status: 'todo', evidence: '' }); break;
				case 'practice': d.pinxing.service.schoolPractice = (+d.pinxing.service.schoolPractice || 0) + 1; break;
				case 'provint': d.pinxing.service.provIntern = (+d.pinxing.service.provIntern || 0) + 1; break;
				case 'c_sch_1': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：校级竞赛', level: 'school', award: '一等奖', status: 'todo', evidence: '', noMerge: false }); break;
				case 'c_sch_3': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：校级竞赛', level: 'school', award: '三等奖', status: 'todo', evidence: '', noMerge: false }); break;
				case 'c_prov_2': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：省级竞赛', level: 'prov', award: '二等奖', status: 'todo', evidence: '', noMerge: false }); break;
				case 'c_nat_3': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：国家级竞赛', level: 'intl_nat', award: '三等奖', status: 'todo', evidence: '', noMerge: false }); break;
				case 'p_gen': d.ability.academic.push({ id: ZC.uid(), kind: 'paper', project: '假设：一般期刊论文', pubClass: 'general', rank: 1, signUnit: '西安交通大学', status: 'todo', evidence: '', noMerge: true }); break;
				case 'p_core': d.ability.academic.push({ id: ZC.uid(), kind: 'paper', project: '假设：核心 / 国际会议论文', pubClass: 'ii', rank: 1, signUnit: '西安交通大学', status: 'todo', evidence: '', noMerge: true }); break;
				case 'p_util': d.ability.academic.push({ id: ZC.uid(), kind: 'patent', project: '假设：实用新型专利', patentType: '实用新型专利', rank: 1, signUnit: '西安交通大学', status: 'todo', evidence: '', noMerge: true }); break;
				case 'a_sch_1': d.ability.culture.push({ id: ZC.uid(), kind: 'art', name: '假设：校级文艺比赛', level: 'school', award: '一等奖', status: 'todo', evidence: '' }); break;
				case 'a_sch_3': d.ability.culture.push({ id: ZC.uid(), kind: 'art', name: '假设：校级文艺比赛', level: 'school', award: '三等奖', status: 'todo', evidence: '' }); break;
				case 'a_prov_1': d.ability.culture.push({ id: ZC.uid(), kind: 'art', name: '假设：省级文艺比赛', level: 'prov', award: '一等奖', status: 'todo', evidence: '' }); break;
				case 's_sch_48': d.ability.culture.push({ id: ZC.uid(), kind: 'sport', name: '假设：校级体育竞赛', level: 'school', award: '第4—8名', status: 'todo', evidence: '' }); break;
				case 'pos_dorm': d.ability.position.push({ id: ZC.uid(), org: '假设：宿舍', role: '宿舍长', tier: 't4', assessment: '合格', startDate: year + '-09-01', endDate: (+year + 1) + '-08-31', status: 'todo', evidence: '' }); break;
				case 'pos_banz': d.ability.position.push({ id: ZC.uid(), org: '假设：班级', role: '班长', tier: 't3', assessment: '优秀', startDate: year + '-09-01', endDate: (+year + 1) + '-08-31', status: 'todo', evidence: '' }); break;
				case 'pos_head': d.ability.position.push({ id: ZC.uid(), org: '假设：院级学生组织', role: '主席', tier: 't1', assessment: '优秀', startDate: year + '-09-01', endDate: (+year + 1) + '-08-31', status: 'todo', evidence: '' }); break;
				case 'r_coll': d.reward.items.push({ id: ZC.uid(), category: 'honor', level: 'college', name: '假设：院级表彰', status: 'todo', evidence: '' }); break;
				case 'r_school': d.reward.items.push({ id: ZC.uid(), category: 'honor', level: 'school', name: '假设：校级表彰', status: 'todo', evidence: '' }); break;
				case 'r_deed': d.reward.items.push({ id: ZC.uid(), category: 'deed', name: '假设：做好事受表扬', status: 'todo', evidence: '' }); break;
				case 'ded_kuangke': d.pinxing.deductions.push({ id: ZC.uid(), type: 'kuangke', count: (+((d.pinxing.deductions.filter(function (x) { return x.type === 'kuangke'; })[0] || {}).count) || 0) + 1, note: '假设：旷课', status: 'todo' }); break;
				case 'ded_weisheng': d.pinxing.deductions.push({ id: ZC.uid(), type: 'weisheng', count: 1, note: '假设：宿舍卫生不合格', status: 'todo' }); break;
				case 'ded_jinggao': d.pinxing.deductions.push({ id: ZC.uid(), type: 'jinggao', count: 1, note: '假设：警告处分', status: 'todo' }); break;
			}
			ZC.save({ silent: true });
			ZC.rerender();
		}
	};

	/* ------------------------------------------------------------- 复制文本 */
	ZC.copyText = function (text, okMsg) {
		var done = function () { ZC.toast(okMsg || '已复制', 'ok'); };
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
		} else fallback();
		function fallback() {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand('copy'); done(); } catch (e) { ZC.toast('复制失败，请手动选择文本', 'warn'); }
			ta.remove();
		}
	};

	/* ------------------------------------------------------------- 事件 */
	function bind() {
		document.addEventListener('input', function (e) {
			var el = e.target;
			if (el && el.getAttribute && el.getAttribute('data-k')) onField(el);
		});
		document.addEventListener('change', function (e) {
			var el = e.target;
			if (el && el.getAttribute && el.getAttribute('data-k')) onField(el);
		});
		document.addEventListener('click', function (e) {
			/* 点空白处收起档案菜单 */
			if (ZC.state.ui.expanded && ZC.state.ui.expanded.profMenu && !e.target.closest('.tb-wrap')) {
				ZC.state.ui.expanded.profMenu = false;
				ZC.rerender();
			}
			var nav = e.target.closest('[data-nav]');
			if (nav) {
				e.preventDefault();
				ZC.go(nav.getAttribute('data-nav'));
				return;
			}
			var b = e.target.closest('[data-act]');
			if (!b || b.disabled) return;
			var fn = ZC.actions[b.getAttribute('data-act')];
			if (!fn) return;
			e.preventDefault();
			fn(b.getAttribute('data-arg'), b, e);
		});
		window.addEventListener('hashchange', function () {
			var id = (location.hash || '').replace('#/', '');
			if (id && ZC.views[id] && id !== ZC.state.ui.view) {
				ZC.state.ui.view = id;
				ZC.rerender();
			}
		});
		document.addEventListener('keydown', function (e) {
			var inField = e.target && e.target.closest && e.target.closest('input,textarea,select');
			if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z' && !inField) {
				e.preventDefault();
				ZC.actions.undo();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
				e.preventDefault();
				ZC.flushSave();
				ZC.toast('已保存到本机（建议同时导出 JSON 备份）', 'ok');
				return;
			}
			if (e.key === '/' && !inField) {
				var s = document.getElementById('rb-search');
				if (s) { e.preventDefault(); s.focus(); }
			}
		});
		window.addEventListener('beforeunload', function () { if (ZC.state.dirty) ZC.flushSave(); });
		window.addEventListener('pagehide', function () { if (ZC.state.dirty) ZC.flushSave(); });
	}

	/* ------------------------------------------------------------- 启动 */
	ZC.boot = function () {
		ZC.load();
		var h = (location.hash || '').replace('#/', '');
		if (h && ZC.views[h]) ZC.state.ui.view = h;
		document.getElementById('app').innerHTML = shell();
		bind();
		doRender();
		ZC.flushSave();
		ZC.updateCloudTag();

		var st = document.getElementById('save-state');
		if (st) st.textContent = ZC.storageOK ? '已就绪 · 数据存于本机' : '仅本次会话有效（存储被禁用）';

		if (ZC.state.firstRun) {
			ZC.state.firstRun = false;
			setTimeout(function () {
				ZC.toast('已载入示例档案：可以先看数据，再在「设置」里清空成你自己的', 'info');
			}, 600);
		}
		if (!ZC.storageOK) {
			setTimeout(function () {
				ZC.toast('此环境禁用了本地存储：数据只在本次会话有效，请导出 JSON 备份', 'danger');
			}, 900);
		}

		/* 站点导航栏：authManager.init 由 nav 触发，须在云同步之前 */
		if (window.siteNav && typeof window.siteNav.init === 'function') {
			window.siteNav.init({ setTheme: function (theme) { ZC.state.ui.theme = theme === 'light' ? 'light' : 'dark'; ZC.save({ silent: true }); } });
		}
		if (ZC.initCloud) ZC.initCloud();
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { try { ZC.boot(); } catch (err) { console.error(err); document.getElementById('app').innerHTML = '<div style="padding:36px;font:14px/1.9 system-ui">应用初始化失败：' + esc(err.message) + '</div>'; } });
	} else {
		try { ZC.boot(); } catch (err) { console.error(err); }
	}
})();
