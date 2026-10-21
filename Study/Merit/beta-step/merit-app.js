/* ============================================================
   merit-app.js — 综评计分器 交互逻辑（纯静态，无后端）
   数据只存本机 localStorage，可导出 / 导入 JSON 备份。
   ============================================================ */
(function () {
	'use strict';

	var R = window.MeritRules;
	var LS_KEY = 'merit.beta-step.v1';
	var SHEET_PREFIX = 'merit.beta-step.sheet.';

	function $(id) { return document.getElementById(id); }
	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function num(v, fallback) {
		v = parseFloat(v);
		if (!isFinite(v) || v < 0) return fallback || 0;
		return v;
	}
	function genId() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	/* ================= 学年 ================= */
	function currentSchoolYear() {
		var n = new Date();
		var y = n.getFullYear();
		var m = n.getMonth() + 1;
		if (m >= 8) return y + '—' + (y + 1);
		return (y - 1) + '—' + y;
	}
	function yearOptions() {
		var out = [];
		var cur = currentSchoolYear();
		var base = parseInt(cur.split('—')[0], 10);
		for (var i = 0; i < 6; i++) out.push((base - i) + '—' + (base - i + 1));
		return out;
	}

	/* ================= 数据 ================= */
	function blankSheet() {
		return {
			base: false,                                  // 基准分 70
			collectiveMode: 'count',                      // count | flat
			collectiveCount: 0,
			volunteer: 0,                                 // 志愿服务小时
			collectivePerTime: 0.6,                       // 当前集体活动口径（每次分值）
			pin: {},                                      // 思政 / 社会服务 勾选项
			deduct: {},                                   // 扣分次数
			items: []                                     // 能力拓展 / 奖励分条目
		};
	}

	function loadAll() {
		try {
			var raw = localStorage.getItem(LS_KEY);
			if (raw) {
				var d = JSON.parse(raw);
				if (d && typeof d === 'object') {
					if (!d.sheets || typeof d.sheets !== 'object') d.sheets = {};
					if (!d.year || !d.sheets[d.year]) d.year = currentSchoolYear();
					if (!d.sheets[d.year]) d.sheets[d.year] = blankSheet();
					return d;
				}
			}
		} catch (e) {}
		return { year: currentSchoolYear(), sheets: { [currentSchoolYear()]: blankSheet() } };
	}

	var store = loadAll();
	function sheet() { return store.sheets[store.year]; }
	function save() {
		try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
	}

	/* ================= 算分 ================= */
	function sumKeys(target, list) {
		var s = 0;
		for (var i = 0; i < list.length; i++) {
			if (target[list[i].id]) s += list[i].score;
		}
		return s;
	}

	function computePin() {
		var s = sheet();
		var base = s.base ? 70 : 0;

		var collective = 0;
		if (s.collectiveMode === 'flat') collective = 3;
		else collective = Math.min(3, num(s.collectiveCount) * num(s.collectivePerTime, 0.6));

		var ideology = Math.min(3, sumKeys(s.pin, R.IDEOLOGY));
		var social = Math.min(4, volScore(s.volunteer) + sumKeys(s.pin, R.SOCIAL));

		var deduct = 0;
		for (var i = 0; i < R.DEDUCT_RULES.length; i++) {
			var r = R.DEDUCT_RULES[i];
			deduct += num(s.deduct[r.id]) * r.per;
		}

		return {
			base: base,
			collective: R.fmt1(collective),
			ideology: ideology,
			social: social,
			deduct: deduct,
			total: R.fmt1(base + collective + ideology + social - deduct)
		};
	}

	function volScore(h) {
		h = num(h);
		if (h <= 0) return 0;
		// 不足 32 小时按比例折算；满 32 小时计 1 分，之后仍按累计小时折算
		return Math.min(1, h / R.VOL_HOURS_STEP);
	}

	function groupSum(key) {
		var s = sheet();
		var t = 0;
		for (var i = 0; i < s.items.length; i++) {
			if (s.items[i].group === key) t += num(s.items[i].score);
		}
		return t;
	}

	function compute() {
		var pin = computePin();
		var academic = Math.min(R.COMPETITION.cap, groupSum('academic'));
		var culture = Math.min(6, groupSum('culture'));
		var duty = Math.min(4, groupSum('duty'));
		var reward = Math.min(R.REWARD.cap, groupSum('reward'));
		var cap = Math.min(R.CAP.cap, academic + culture + duty);
		var total = num(parseFloat(pin.total)) + cap + reward;
		return {
			pin: pin,
			academic: R.fmt1(academic),
			culture: R.fmt1(culture),
			duty: R.fmt1(duty),
			capArea: R.fmt1(academic + culture + duty),
			reward: R.fmt1(reward),
			total: R.fmt1(total)
		};
	}

	/* ================= Toast ================= */
	var toastTimer = null;
	function toast(msg, kind) {
		var t = $('toast');
		t.textContent = msg;
		t.className = 'show' + (kind ? ' ' + kind : '');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { t.className = ''; }, 2200);
	}

	/* ================= 渲染：顶部总分 ================= */
	var RING_C = 2 * Math.PI * 26; // r=26

	function renderTotal() {
		var s = compute();
		$('totalScore').textContent = s.total;

		var parts = [];
		parts.push('品行素质 <b>' + s.pin.total + '</b>');
		parts.push('能力拓展 <b>' + s.capArea + '</b>');
		parts.push('奖励分 <b>' + s.reward + '</b>');
		var sub = parts.join(' + ');
		if (parseFloat(s.pin.deduct) > 0) sub += ' <span class="neg">（扣分 −' + R.fmt1(s.pin.deduct) + '）</span>';
		$('totalSub').innerHTML = sub;

		// 三个进度环
		var rings = [
			{ cls: 'isPin', cur: parseFloat(s.pin.total), max: 80, label: '品行' },
			{ cls: 'isCap', cur: parseFloat(s.capArea), max: 20, label: '能力' },
			{ cls: 'isReward', cur: parseFloat(s.reward), max: 5, label: '奖励' }
		];
		var host = $('scoreRings');
		host.innerHTML = '';
		for (var i = 0; i < rings.length; i++) {
			var r = rings[i];
			var pct = Math.min(1, r.cur / r.max);
			var off = RING_C * (1 - pct);
			var box = el('div', 'ring ' + r.cls);
			var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', '0 0 60 60');
			var c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			c1.setAttribute('class', 'ringTrack'); c1.setAttribute('cx', '30'); c1.setAttribute('cy', '30'); c1.setAttribute('r', '26');
			var c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			c2.setAttribute('class', 'ringFill'); c2.setAttribute('cx', '30'); c2.setAttribute('cy', '30'); c2.setAttribute('r', '26');
			c2.setAttribute('stroke-dasharray', RING_C.toFixed(1));
			c2.setAttribute('stroke-dashoffset', off.toFixed(1));
			svg.appendChild(c1); svg.appendChild(c2);
			box.appendChild(svg);
			var c = el('div', 'ringC');
			c.appendChild(el('div', 'ringV', R.fmt1(r.cur)));
			c.appendChild(el('div', 'ringL', r.label));
			box.appendChild(c);
			box.title = r.label + '：' + R.fmt1(r.cur) + ' / ' + r.max;
			host.appendChild(box);
		}

		// tab 上的小圆点（有数据才亮）
		setTabDot('pin', parseFloat(s.pin.total));
		setTabDot('cap', parseFloat(s.capArea));
		setTabDot('reward', parseFloat(s.reward));
	}

	function setTabDot(tab, val) {
		var btn = document.querySelector('.mTab[data-tab="' + tab + '"]');
		if (!btn) return;
		var dot = btn.querySelector('.mTabDot');
		if (val > 0) {
			if (!dot) { dot = el('span', 'mTabDot'); btn.appendChild(dot); }
			dot.hidden = false;
		} else if (dot) {
			dot.hidden = true;
		}
	}

	/* ================= 渲染：品行素质 ================= */
	function renderPin() {
		var s = sheet();
		var p = computePin();

		// 基准分
		$('pinBaseOk').checked = !!s.base;
		$('pinBaseVal').textContent = p.base;
		$('pinBaseVal').className = 'rowVal' + (p.base ? ' isHot' : '');

		// 集体活动
		var flat = s.collectiveMode === 'flat';
		document.querySelectorAll('#collectiveModeSeg .segBtn').forEach(function (b) {
			b.classList.toggle('isActive', b.dataset.mode === s.collectiveMode);
		});
		var perTime = num(s.collectivePerTime, 0.6);
		$('collectiveNoteText').innerHTML = flat
			? '对集体荣誉作出突出贡献，经书院认定可<b>一次性获得满分 3 分</b>。'
			: (perTime > 0
				? '当前口径：参与一次 <b>' + R.fmt1(perTime) + '</b> 分，封顶 3 分。校级办法未统一规定单次分值，由各书（学）院自行认定。'
				: '校级办法<b>未统一规定单次分值</b>，由各书（学）院自行认定，请以你所在书院当年公示细则为准。');
		$('collectiveCountWrap').style.display = flat ? 'none' : '';
		$('collectiveCountIn').value = num(s.collectiveCount);
		$('collectiveVal').textContent = R.fmt1(parseFloat(p.collective));
		$('collectiveVal').className = 'rowVal' + (parseFloat(p.collective) > 0 ? ' isHot' : '');

		// 思政 + 社会服务
		renderPinGroup(s.pin, R.IDEOLOGY);
		renderPinGroup(s.pin, R.SOCIAL);

		// 志愿时长
		$('volHours').value = num(s.volunteer);
		var vs = volScore(s.volunteer);
		$('volVal').textContent = '+' + R.fmt1(vs);
		$('volVal').className = 'rowVal' + (vs > 0 ? ' isHot' : '');
		var pctVol = Math.min(100, num(s.volunteer) / R.VOL_HOURS_STEP * 100);
		$('volBarFill').style.width = pctVol + '%';
		$('volBarFill').classList.toggle('isHit', num(s.volunteer) >= R.VOL_HOURS_STEP);

		// 扣分
		for (var i = 0; i < R.DEDUCT_RULES.length; i++) {
			var r = R.DEDUCT_RULES[i];
			var input = document.querySelector('.numIn[data-k="' + r.id + '"]');
			if (input) input.value = num(s.deduct[r.id]);
			setRowVal(r.id, num(s.deduct[r.id]) * r.per);
		}

		markFullBlocks();
	}

	function renderPinGroup(target, list) {
		for (var i = 0; i < list.length; i++) {
			var input = document.querySelector('input[data-k="' + list[i].id + '"]');
			if (!input) continue;
			input.checked = !!target[list[i].id];
			var row = input.closest('.row');
			if (row) row.classList.toggle('isOn', input.checked);
		}
	}

	function setRowVal(id, val) {
		var input = document.querySelector('.numIn[data-k="' + id + '"]');
		if (!input) return;
		var row = input.closest('.row');
		var v = row ? row.querySelector('.rowVal') : null;
		if (v) {
			v.textContent = val === 0 ? '0' : '−' + R.fmt1(val);
			v.className = 'rowVal' + (val > 0 ? ' isNeg' : '');
		}
	}

	function markFullBlocks() {
		var keys = {
			base: { get: function () { var p = computePin(); return p.base; }, max: 70 },
			collective: { get: function () { return parseFloat(computePin().collective); }, max: 3 },
			ideology: { get: function () { return computePin().ideology; }, max: 3 },
			social: { get: function () { return computePin().social; }, max: 4 }
		};
		Object.keys(keys).forEach(function (k) {
			var blk = document.querySelector('.blk[data-cap-key="' + k + '"]');
			if (blk) blk.classList.toggle('isFull', keys[k].get() >= keys[k].max);
		});
	}

	/* ================= 能力拓展 / 奖励分条目 ================= */
	var GROUP_META = {
		academic: { cap: 10, title: '学术科研及创新创业' },
		culture: { cap: 6, title: '文体竞赛' },
		duty: { cap: 4, title: '学生组织、社团任职' },
		reward: { cap: 5, title: '奖励分' }
	};

	/* ---------- 条目描述 ---------- */
	function describeItem(it) {
		if (it.group === 'academic') {
			if (it.kind === 'paper') {
				var k = R.PAPER.kinds.filter(function (x) { return x.id === it.paperKind; })[0];
				var rank = R.PAPER.rankNames[it.rank];
				return (it.name ? it.name + ' · ' : '') + (k ? k.name : '—') + ' · ' + (rank || '');
			}
			var lv = (R.COMPETITION.levels.filter(function (x) { return x.id === it.level; })[0] || {}).name;
			var pz = (R.COMPETITION.prizes.filter(function (x) { return x.id === it.prize; })[0] || {}).name;
			return (it.name ? it.name + ' · ' : '') + (lv || '—') + ' ' + (pz || '');
		}
		if (it.group === 'culture') {
			var sp = it.kind === 'sport';
			var rule = sp ? R.SPORT : R.ART;
			var l2 = (rule.levels.filter(function (x) { return x.id === it.level; })[0] || {}).name;
			var p2 = (rule.prizes.filter(function (x) { return x.id === it.prize; })[0] || {}).name;
			var head = sp ? '体育' : '文艺';
			var tail = sp && it.brk ? ' · 破' + (it.brk === 'nat' ? '省级及以上' : '校级') + '纪录' : '';
			return (it.name ? it.name + ' · ' : '') + head + ' · ' + (l2 || '—') + ' ' + (p2 || '') + tail;
		}
		if (it.group === 'duty') {
			var post = (R.DUTY.posts.filter(function (x) { return x.id === it.post; })[0] || {});
			var grade = (R.DUTY.grades.filter(function (x) { return x.id === it.grade; })[0] || {}).name;
			var term = (R.DUTY.terms.filter(function (x) { return x.id === it.term; })[0] || {}).name;
			return (it.name ? it.name + ' · ' : '') + (post.name || '—') + ' · ' + (grade || '') + (term ? ' · ' + term : '');
		}
		if (it.group === 'reward') {
			var type = (R.REWARD.types.filter(function (x) { return x.id === it.type; })[0] || {});
			var lv2 = (R.REWARD.levels.filter(function (x) { return x.id === it.level; })[0] || {}).name;
			return (it.name ? it.name + ' · ' : '') + (type.name || '—') + (lv2 ? ' · ' + lv2 : '');
		}
		return it.name || '条目';
	}

	function scoreOf(it) {
		if (it.group === 'academic') {
			if (it.kind === 'paper') {
				var k = R.PAPER.kinds.filter(function (x) { return x.id === it.paperKind; })[0];
				if (!k) return 0;
				var base = k.ranks[it.rank];
				// 表外位次走缺省回退：专著第九位及以后 1 分，其余成果不计分
				if (base == null) base = (k.id === 'book') ? 1 : 0;
				return base + (it.bound && k.id !== 'book' ? 1 : 0);
			}
			var lv = (R.COMPETITION.levels.filter(function (x) { return x.id === it.level; })[0] || {});
			var v = lv.values ? lv.values[it.prize] : null;
			return v == null ? 0 : v;
		}
		if (it.group === 'culture') {
			var rule = it.kind === 'sport' ? R.SPORT : R.ART;
			var l2 = (rule.levels.filter(function (x) { return x.id === it.level; })[0] || {});
			var v2 = l2.values ? l2.values[it.prize] : null;
			if (v2 == null) return 0;
			if (it.kind === 'sport' && it.brk) v2 += rule.breakBonus[it.brk] || 0;			return v2;
		}
		if (it.group === 'duty') {
			var post = R.DUTY.posts.filter(function (x) { return x.id === it.post; })[0];
			if (!post) return 0;
			var full = post.values[it.grade] || 0;
			// 官方口径：任期原则上满一年；不满一年按实际工作时间酌情给分，
			// 上限不超过满一年加分。这里给出三档折算比例用于估算。
			if (it.term === 'year') return full;
			if (it.term === 'half') return full * 0.5;
			return full * 0.25;
		}
		if (it.group === 'reward') {
			if (it.type === 'praise') return 1;
			var lv3 = (R.REWARD.levels.filter(function (x) { return x.id === it.level; })[0] || {});
			return lv3.value == null ? 0 : lv3.value;
		}
		return 0;
	}
	function resolveScore(it) { return R.fmt1(scoreOf(it)); }

	/* ---------- 任期折算说明 ---------- */
	function termNote(it, full) {
		if (it.term === 'year') return '';
		if (it.term === 'half') return '任期约一学期，酌情按满额 ' + R.fmt1(full) + ' 的一半计（上限不超过满一年加分）';
		return '任期不满一学期，酌情按满额 ' + R.fmt1(full) + ' 的较低比例计（上限不超过满一年加分）';
	}

	/* ---------- 渲染列表 ---------- */
	function renderItems() {
		var s = sheet();
		var groups = ['academic', 'culture', 'duty', 'reward'];
		groups.forEach(function (g) {
			var host = $('list-' + g);
			if (!host) return;
			host.innerHTML = '';
			var rows = s.items.filter(function (x) { return x.group === g; });
			if (!rows.length) {
				host.appendChild(el('div', 'itemsEmpty', '还没有录入' + GROUP_META[g].title + '相关条目'));
			} else {
				rows.forEach(function (it) { host.appendChild(itemNode(it)); });
			}
			// 区块进度条
			var total = Math.min(GROUP_META[g].cap, groupSum(g));
			var fill = document.querySelector('.capFill[data-fill="' + g + '"]');
			if (fill) {
				fill.style.width = Math.min(100, total / GROUP_META[g].cap * 100) + '%';
				fill.classList.toggle('isFull', total >= GROUP_META[g].cap);
			}
			var blk = document.querySelector('.blk[data-cap-key="' + g + '"]');
			if (blk) blk.classList.toggle('isFull', total >= GROUP_META[g].cap);
		});
	}

	function itemNode(it) {
		var node = el('div', 'item');
		node.dataset.id = it.id;
		node.appendChild(el('div', 'itemMark'));

		var body = el('div', 'itemBody');
		body.appendChild(el('div', 'itemName', describeItem(it)));
		var meta = [];
		if (it.group === 'duty') {
			var post = R.DUTY.posts.filter(function (x) { return x.id === it.post; })[0];
			var full = post ? (post.values[it.grade] || 0) : 0;
			var note = termNote(it, full);
			if (note) meta.push(note);
		}
		if (it.group === 'academic' && it.kind === 'paper' && it.bound && it.paperKind !== 'book') {
			meta.push('会议入围优秀论文 +1');
		}
		if (it.note) meta.push(it.note);
		if (meta.length) body.appendChild(el('div', 'itemMeta', meta.join(' · ')));
		node.appendChild(body);

		node.appendChild(el('div', 'itemScore', resolveScore(it)));

		var act = el('div', 'itemAct');
		var ed = el('button', 'iaBtn', '编辑');
		ed.type = 'button';
		ed.title = '编辑';
		ed.addEventListener('click', function () { openItemModal(it.group, it); });
		var del = el('button', 'iaBtn iaDel', '删除');
		del.type = 'button';
		del.title = '删除';
		del.addEventListener('click', function () {
			if (del.classList.contains('armed')) {
				removeItem(it.id, node);
			} else {
				del.classList.add('armed');
				del.textContent = '确认';
				setTimeout(function () {
					del.classList.remove('armed');
					del.textContent = '删除';
				}, 2500);
			}
		});
		act.appendChild(ed); act.appendChild(del);
		node.appendChild(act);
		return node;
	}

	function removeItem(id, node) {
		var s = sheet();
		for (var i = 0; i < s.items.length; i++) {
			if (s.items[i].id === id) { s.items.splice(i, 1); break; }
		}
		save();
		if (node) {
			node.classList.add('isLeaving');
			setTimeout(function () { renderAll(); }, 180);
		} else {
			renderAll();
		}
	}

	/* ================= 弹窗：添加 / 编辑条目 ================= */
	var modalState = { group: null, editing: null, draft: {} };

	function openItemModal(group, editing) {
		modalState.group = group;
		modalState.editing = editing || null;
		modalState.draft = editing ? JSON.parse(JSON.stringify(editing)) : defaultDraft(group);

		var titles = {
			academic: '学术科研及创新创业',
			culture: '文体竞赛',
			duty: '学生组织、社团任职',
			reward: '奖励分'
		};
		$('itemModalTitle').textContent = (editing ? '编辑 · ' : '添加 · ') + titles[group];
		$('itemModalErr').textContent = '';
		buildForm();
		$('itemModal').dataset.open = '1';
		$('itemModal').setAttribute('aria-hidden', 'false');
	}

	function closeItemModal() {
		$('itemModal').dataset.open = '0';
		$('itemModal').setAttribute('aria-hidden', 'true');
	}

	/* ---------- 各分区默认草稿：保证打开弹窗即有合法值，直接保存不会失败 ---------- */
	function defaultDraft(group) {
		var d = { group: group, name: '', note: '' };
		if (group === 'academic') {
			d.kind = 'award';
			d.level = R.COMPETITION.levels[0].id;   // 高水平国际、国家级
			d.prize = R.COMPETITION.prizes[0].id;   // 一等奖
		} else if (group === 'culture') {
			d.kind = 'art';
			d.level = R.ART.levels[0].id;            // 国际级 / 国家级
			d.prize = R.ART.prizes[0].id;            // 一等奖
		} else if (group === 'duty') {
			d.post = R.DUTY.posts[2].id;             // 党支部委员 / 部长 / 团支书 / 班长
			d.grade = R.DUTY.grades[1].id;           // 良好
			d.term = R.DUTY.terms[0].id;             // 任期满一年
		} else if (group === 'reward') {
			d.type = R.REWARD.types[0].id;           // 精神文明集体 / 个人荣誉表彰
			d.level = R.REWARD.levels[3].id;         // 校
		}
		return d;
	}

	function buildForm() {
		var host = $('itemModalBody');
		host.innerHTML = '';
		var d = modalState.draft;

		// 名称（除文艺/体育外的品类都可填）
		if (modalState.group !== 'culture') {
			host.appendChild(fieldInput('条目名称', 'name', d.name, namePlaceholder(modalState.group)));
		}

		if (modalState.group === 'academic') {
			var kind = d.kind || 'award';
			host.appendChild(fieldSeg('类型', 'kind', [
				{ id: 'award', name: '竞赛获奖' },
				{ id: 'paper', name: '论文 / 专著 / 专利' }
			], kind));
			if (kind === 'paper') {
				host.appendChild(fieldSelect('成果类型', 'paperKind',
					R.PAPER.kinds.map(function (k) { return { id: k.id, name: k.name }; }), d.paperKind || 'i'));
				host.appendChild(fieldSelect('署名位次', 'rank',
					R.rankNamesFor(d.paperKind || 'i'), d.rank || 'r1'));
				host.appendChild(fieldCheck('会议入围优秀论文（额外 +1）', 'bound', !!d.bound));
			} else {
				host.appendChild(fieldSelect('竞赛级别', 'level',
					R.COMPETITION.levels.map(function (l) { return { id: l.id, name: l.name }; }), d.level || 'intl'));
				host.appendChild(fieldSelect('获奖等次', 'prize',
					R.COMPETITION.prizes.map(function (p) { return { id: p.id, name: p.name }; }), d.prize || 'first'));
			}
			host.appendChild(fieldArea('备注', 'note', d.note, '可写竞赛全称、主办方、获奖时间等，便于核对'));
		}

		if (modalState.group === 'culture') {
			host.appendChild(fieldSeg('类别', 'kind', [
				{ id: 'art', name: '文艺比赛' },
				{ id: 'sport', name: '体育竞赛' }
			], d.kind || 'art'));
			var rule = d.kind === 'sport' ? R.SPORT : R.ART;
			host.appendChild(fieldSelect('赛事级别', 'level',
				rule.levels.map(function (l) { return { id: l.id, name: l.name }; }), d.level || 'nat'));
			host.appendChild(fieldSelect(d.kind === 'sport' ? '名次' : '获奖等次', 'prize',
				rule.prizes.map(function (p) { return { id: p.id, name: p.name }; }), d.prize || 'first'));
			if (d.kind === 'sport') {
				// 破纪录：单选「破省级及以上 / 破校级 / 未破纪录」，避免只给一个布尔值
				host.appendChild(fieldSelect('破纪录', 'brk', [
					{ id: '', name: '未破纪录' },
					{ id: 'nat', name: '破省级及以上纪录（+5）' },
					{ id: 'school', name: '破校级纪录（+3）' }
				], d.brk || ''));
			}
			host.appendChild(fieldInput('赛事名称（可选）', 'name', d.name, '如：全国大学生艺术展演'));
			host.appendChild(fieldArea('备注', 'note', d.note, '可写主办方、获奖时间等'));
		}

		if (modalState.group === 'duty') {
			host.appendChild(fieldInput('职务名称（可选）', 'name', d.name, '如：校学生会文艺部部长'));
			host.appendChild(fieldSelect('职务档位', 'post',
				R.DUTY.posts.map(function (p) { return { id: p.id, name: p.name }; }), d.post || 'minister'));
			host.appendChild(fieldSelect('考核等次', 'grade',
				R.DUTY.grades.map(function (g) { return { id: g.id, name: g.name }; }), d.grade || 'good'));
			host.appendChild(fieldSelect('任期', 'term',
				R.DUTY.terms.map(function (t) { return { id: t.id, name: t.name }; }), d.term || 'year'));
			host.appendChild(fieldArea('备注', 'note', d.note, '考核不合格不加分'));
		}

		if (modalState.group === 'reward') {
			host.appendChild(fieldSelect('表彰类型', 'type',
				R.REWARD.types.map(function (t) { return { id: t.id, name: t.name + (t.note ? '（' + t.note + '）' : '') }; }),
				d.type || 'honor'));
			if ((d.type || 'honor') !== 'praise') {
				host.appendChild(fieldSelect('表彰级别', 'level',
					R.REWARD.levels.map(function (l) { return { id: l.id, name: l.name }; }), d.level || 'school'));
			}
			host.appendChild(fieldInput('表彰名称（可选）', 'name', d.name, '如：优秀学生标兵'));
			host.appendChild(fieldArea('备注', 'note', d.note, '可写授奖单位、时间等'));
		}

		host.appendChild(livePreview());
		refreshPreview();
	}

	function namePlaceholder(group) {
		return {
			academic: '如：全国大学生数学建模竞赛',
			duty: '如：校学生会文艺部部长',
			reward: '如：优秀学生标兵'
		}[group] || '';
	}

	/* ---------- 表单控件工厂 ---------- */
	function fieldInput(label, key, value, ph) {
		var row = el('div', 'fRow');
		row.appendChild(el('label', 'fLabel', label));
		var input = el('input', 'fIn');
		input.type = 'text';
		input.value = value || '';
		input.placeholder = ph || '';
		input.dataset.fkey = key;
		input.addEventListener('input', function () { modalState.draft[key] = input.value.trim(); refreshPreview(); });
		row.appendChild(input);
		return row;
	}

	function fieldArea(label, key, value, ph) {
		var row = el('div', 'fRow');
		row.appendChild(el('label', 'fLabel', label));
		var input = el('textarea', 'fIn');
		input.value = value || '';
		input.placeholder = ph || '';
		input.dataset.fkey = key;
		input.addEventListener('input', function () { modalState.draft[key] = input.value.trim(); });
		row.appendChild(input);
		return row;
	}

	function fieldSelect(label, key, options, value) {
		var row = el('div', 'fRow');
		row.appendChild(el('label', 'fLabel', label));
		var wrap = el('div', 'optGrid');
		options.forEach(function (o) {
			var opt = el('label', 'opt' + (o.id === value ? ' isOn' : ''));
			var radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = 'f_' + key;
			radio.value = o.id;
			radio.checked = o.id === value;

			// 这些 key 变化会影响其它行的分值标注，需要重建表单
			var REBUILD_KEYS = { kind: 1, level: 1, paperKind: 1, post: 1, type: 1 };
			function afterPick() {
				if (REBUILD_KEYS[key]) buildForm();
				else refreshPreview();
			}

			// 只认 change：label 包裹 radio，点 label 即激活 radio。
			// 不另接 label click —— 脚本触发时 change 与 click 的先后不稳定，
			// 两路都写会互相抵消。
			radio.addEventListener('change', function () {
				modalState.draft[key] = o.id;
				wrap.querySelectorAll('.opt').forEach(function (n) { n.classList.remove('isOn'); });
				opt.classList.add('isOn');
				afterPick();
			});

			opt.appendChild(radio);
			opt.appendChild(el('div', 'optName', o.name));
			opt.appendChild(el('div', 'optVal', optionValue(key, o.id)));
			wrap.appendChild(opt);
		});
		row.appendChild(wrap);
		return row;
	}

	/* 计算某个选项对应的分值（用于在选项上直接标出） */
	function optionValue(key, id) {
		var d = modalState.draft;
		if (key === 'level') {
			// 竞赛 / 文艺 / 体育：取该级别下所有等次里的最高分，标「N 起」
			var rule = null, prizes = null;
			if (d.group === 'academic') { rule = R.COMPETITION; prizes = R.COMPETITION.prizes; }
			else { rule = d.kind === 'sport' ? R.SPORT : R.ART; prizes = rule.prizes; }
			var lv = rule.levels.filter(function (x) { return x.id === id; })[0];
			if (lv && prizes && prizes.length) {
				var best = Math.max.apply(null, prizes.map(function (p) {
					var v = lv.values[p.id]; return v == null ? 0 : v;
				}));
				return best > 0 ? R.fmt1(best) + ' 起' : '';
			}
			return '';
		}
		if (key === 'prize') {
			// 等次：结合当前已选级别，直接标出该等次分值
			var rule2 = null, prizes2 = null;
			if (d.group === 'academic') { rule2 = R.COMPETITION; prizes2 = R.COMPETITION.prizes; }
			else { rule2 = d.kind === 'sport' ? R.SPORT : R.ART; prizes2 = rule2.prizes; }
			var lv2 = rule2.levels.filter(function (x) { return x.id === d.level; })[0];
			if (lv2 && lv2.values && lv2.values[id] != null) return '+' + R.fmt1(lv2.values[id]);
			return '不计分';
		}
		return '';
	}

	function fieldSeg(label, key, options, value) {
		var row = el('div', 'fRow');
		row.appendChild(el('label', 'fLabel', label));
		var seg = el('div', 'seg');
		options.forEach(function (o) {
			var b = el('button', 'segBtn' + (o.id === value ? ' isActive' : ''), o.name);
			b.type = 'button';
			b.addEventListener('click', function () {
				modalState.draft[key] = o.id;
				seg.querySelectorAll('.segBtn').forEach(function (n) { n.classList.remove('isActive'); });
				b.classList.add('isActive');
				if (key === 'kind') buildForm();
				else refreshPreview();
			});
			seg.appendChild(b);
		});
		row.appendChild(seg);
		return row;
	}

	function fieldCheck(label, key, checked, valWhenOn) {
		var row = el('div', 'fRow');
		var lab = el('label', 'sw');
		var input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = !!checked;
		// 只认 change：label 包裹 input，点 label 即激活 input，不另接 click 以免重复触发
		input.addEventListener('change', function () {
			modalState.draft[key] = input.checked ? (valWhenOn || true) : false;
			refreshPreview();
		});
		lab.appendChild(input);
		var box = el('span', 'swBox');
		box.appendChild(el('span', 'swDot'));
		lab.appendChild(box);
		lab.appendChild(el('span', 'rowText', label));
		row.appendChild(lab);
		return row;
	}

	function livePreview() {
		var row = el('div', 'fPreview');
		row.id = 'fPreview';
		row.appendChild(el('div', 'fPreviewLabel', '该条预计得分'));
		var v = el('div', 'fPreviewVal', '0');
		row.appendChild(v);
		return row;
	}

	function refreshPreview() {
		var pv = $('fPreview');
		if (!pv) return;
		var v = pv.querySelector('.fPreviewVal');
		var sc = scoreOf(modalState.draft);
		v.textContent = R.fmt1(sc);
		v.style.color = sc > 0 ? '' : 'var(--dsk-foreground-subtle)';
	}

	/* ================= 推演 · 提示 ================= */
	function renderInsight() {
		var host = $('insightBody');
		host.innerHTML = '';
		var c = compute();
		var s = sheet();

		host.appendChild(scholarshipCard(c));
		host.appendChild(peekCard(c));
		host.appendChild(tipsCard(c, s));
	}

	/* ---------- 奖学金推演 ---------- */
	function scholarshipCard(c) {
		var total = parseFloat(c.total);

		var group = el('div', 'insGroup');
		var head = el('div', 'insGroupHead');
		head.appendChild(el('div', 'insGroupTitle', '奖学金综合成绩推演'));
		head.appendChild(el('span', 'insGroupTag', '综合成绩 = 课程 × 80% + 综测 × 20%'));
		group.appendChild(head);

		// 你的综测在加权公式里的实际贡献
		var contrib = total * 0.2;
		var card = el('div', 'card');
		card.appendChild(cardHeadDefault('加权贡献'));
		var body = el('div', 'cardBody');
		var line = el('div', 'gapRow');
		line.appendChild(el('div', 'gapRowLabel', '综测 ' + R.fmt1(total) + ' 分折算进综合成绩'));
		line.appendChild(el('div', 'gapRowVal', '+' + R.fmt1(contrib)));
		body.appendChild(line);
		var hint = el('div', 'barNote');
		hint.style.marginTop = 'var(--dsk-space-1)';
		hint.innerHTML = '课程每高 1 分 = 综合成绩 0.8 分；综测每高 1 分 = 综合成绩 0.2 分。' +
			'换句话说，<b>综测 5 分 ≈ 课程 1.25 分</b>。';
		body.appendChild(hint);
		card.appendChild(body);
		group.appendChild(card);

		// 奖学金档位
		var tiers = R.SCHOLARSHIP.national.concat(R.SCHOLARSHIP.school);
		var card2 = el('div', 'card');
		card2.appendChild(cardHeadDefault('奖学金档位与门槛'));
		var body2 = el('div', 'cardBody');
		var tbl = document.createElement('table');
		tbl.className = 'schTable';
		var thead = document.createElement('thead');
		var htr = document.createElement('tr');
		['奖学金', '金额', '综测门槛推演', '体测要求'].forEach(function (h) {
			var th = document.createElement('th'); th.textContent = h; htr.appendChild(th);
		});
		thead.appendChild(htr);
		tbl.appendChild(thead);
		var tb = document.createElement('tbody');
		tiers.forEach(function (r) {
			var tr = document.createElement('tr');
			var td1 = document.createElement('td'); td1.className = 'schName'; td1.textContent = r.name; tr.appendChild(td1);
			var td2 = document.createElement('td'); td2.className = 'schAmt'; td2.textContent = R.money(r.amount); tr.appendChild(td2);
			var td3 = document.createElement('td'); td3.className = 'schNeed'; td3.textContent = '按排名竞争'; tr.appendChild(td3);
			var td4 = document.createElement('td'); td4.className = 'schGap'; td4.textContent = r.peNote; tr.appendChild(td4);
			tb.appendChild(tr);
		});
		tbl.appendChild(tb);
		body2.appendChild(tbl);
		card2.appendChild(body2);
		group.appendChild(card2);

		var note = el('div', 'tip');
		note.innerHTML = '<span class="tipIcon">!</span><span>奖学金按<b>排名</b>竞争，不是划线。综测越高排名越靠前。' +
			'红线：参评学年必修课考核不及格（<b>补考、重修视同不及格</b>），或受到校级、院级纪律处分（含尚未解除），' +
			'取消当年度奖学金参评资格。金额与体测要求以当年评审通知为准。</span>';
		group.appendChild(note);

		if (hasRedline(sheet())) {
			var rl = el('div', 'tip isRisk');
			rl.innerHTML = '<span class="tipIcon">!</span><span><b>资格红线提醒：</b>你录入了纪律处分记录，该校级 / 院级处分' +
				'（含尚未解除）会取消当年度奖学金参评资格。</span>';
			group.appendChild(rl);
		}
		return group;
	}

	function cardHeadDefault(title) {
		return (function () {
			var h = el('div', 'cardHead');
			h.appendChild(el('div', 'cardTitle', title));
			return h;
		})();
	}

	function hasRedline(s) {
		return num(s.deduct.d_warn) + num(s.deduct.d_serious) + num(s.deduct.d_record) + num(s.deduct.d_probation) > 0;
	}

	/* ---------- 提分空间 ---------- */
	function peekCard(c) {
		var total = parseFloat(c.total);
		var group = el('div', 'insGroup');
		var head = el('div', 'insGroupHead');
		head.appendChild(el('div', 'insGroupTitle', '还能加在哪里'));
		head.appendChild(el('span', 'insGroupTag', '剩余空间 ' + R.fmt1(R.TOTAL_MAX - total) + ' 分'));
		group.appendChild(head);

		var gaps = [
			{ label: '能力拓展 — 学术科研 / 文体竞赛', cur: parseFloat(c.academic) + parseFloat(c.culture), max: 16, tab: 'cap' },
			{ label: '能力拓展 — 学生组织、社团任职', cur: parseFloat(c.duty), max: 4, tab: 'cap' },
			{ label: '品行素质 — 集体活动', cur: parseFloat(c.pin.collective), max: 3, tab: 'pin' },
			{ label: '品行素质 — 思想政治理论学习', cur: c.pin.ideology, max: 3, tab: 'pin' },
			{ label: '品行素质 — 社会服务', cur: c.pin.social, max: 4, tab: 'pin' },
			{ label: '奖励分 — 精神文明 / 表彰', cur: parseFloat(c.reward), max: 5, tab: 'reward' }
		];

		var card = el('div', 'card');
		var body = el('div', 'cardBody');
		gaps.forEach(function (g) {
			var left = Math.max(0, g.max - g.cur);
			var row = el('div', 'gapRow');
			row.appendChild(el('div', 'gapRowLabel', g.label));
			var val = el('div', 'gapRowVal');
			val.textContent = left > 0 ? '还差 ' + R.fmt1(left) : '已满';
			val.style.color = left > 0 ? '' : 'var(--dsk-accent)';
			row.appendChild(val);
			body.appendChild(row);
			var bar = el('div', 'barTrack');
			bar.style.marginBottom = 'var(--dsk-space-3)';
			var fill = el('div', 'barFill' + (g.cur >= g.max ? ' isHit' : ''));
			fill.style.width = Math.min(100, g.cur / g.max * 100) + '%';
			bar.appendChild(fill);
			body.appendChild(bar);
		});
		card.appendChild(body);
		group.appendChild(card);
		return group;
	}

	/* ---------- 温馨提示 ---------- */
	function tipsCard(c, s) {
		var group = el('div', 'insGroup');
		var head = el('div', 'insGroupHead');
		head.appendChild(el('div', 'insGroupTitle', '温馨提示'));
		group.appendChild(head);

		var tips = [];

		// 志愿时长
		var vh = num(s.volunteer);
		if (vh < R.VOL_HOURS_STEP) {
			tips.push({
				kind: vh >= R.VOL_HOURS_STEP * 0.6 ? 'warn' : 'risk',
				icon: '!',
				html: '志愿服务 <b>' + vh + ' 小时</b>，不足每学年 32 小时的门槛，' +
					'再加 <b>' + Math.ceil(R.VOL_HOURS_STEP - vh) + ' 小时</b> 即可拿到这 1 分。<b>按学年累计</b>，早做早从容。',
				act: { text: '去填写', fn: function () { focusVol(); } }
			});
		} else {
			tips.push({ kind: 'ok', icon: '✓', html: '志愿服务已满 <b>' + vh + ' 小时</b>，达到每学年 32 小时的加分线。' });
		}

		// 集体活动口径
		if (s.collectiveMode === 'count' && num(s.collectivePerTime, 0.6) === 0) {
			tips.push({
				kind: 'warn', icon: '!',
				html: '集体活动当前按<b>校级通用口径</b>（未定单次分值）计算。校级办法未作统一规定，' +
					'<b>由各书（学）院自行认定</b>，请以你所在书院当年公示细则为准。',
				act: { text: '查看书院口径', fn: function () { openRuleModal(); } }
			});
		}

		// 基准分
		if (!s.base) {
			tips.push({
				kind: 'risk', icon: '!',
				html: '基准分 <b>70 分</b>尚未确认。需经班级评议小组评议合格、书院审定通过后方可获得，这是综测的大头。',
				act: { text: '去确认', fn: function () { goTab('pin'); } }
			});
		}

		// 扣分
		var dtotal = 0;
		for (var i = 0; i < R.DEDUCT_RULES.length; i++) dtotal += num(s.deduct[R.DEDUCT_RULES[i].id]);
		if (dtotal > 0) {
			tips.push({
				kind: 'risk', icon: '!',
				html: '已录入 <b>' + dtotal + ' 项</b>扣分记录，合计扣 <b>' + R.fmt1(c.pin.deduct) + '</b> 分。' +
					'扣分<b>不设上限</b>，直接从 70 分基准分里扣 —— 很多排名落差来自这些"小事"。'
			});
		} else {
			tips.push({ kind: 'ok', icon: '✓', html: '没有任何扣分记录。旷课、宿舍卫生、违纪处分都不设上限，保持住就是优势。' });
		}

		// 任职
		var dutyShort = s.items.filter(function (x) { return x.group === 'duty' && x.term !== 'year'; });
		if (dutyShort.length) {
			tips.push({
				kind: 'warn', icon: '!',
				html: '有 <b>' + dutyShort.length + ' 项</b>任职未满一年。官方口径是"原则上满一年；不满一年<b>酌情加分</b>，上限不超过满一年加分"，' +
					'不是一分没有。但想收益最大化，仍是<b>做满一年并争取"优秀"考核</b>。'
			});
		}
		if (!s.items.filter(function (x) { return x.group === 'duty'; }).length) {
			tips.push({
				kind: 'warn', icon: '!',
				html: '还没有录入任何任职。兼任多项职务<b>只取最高、不累加</b>，所以专注一个做满一年，比广撒网更划算。',
				act: { text: '去添加', fn: function () { goTab('cap'); } }
			});
		}

		// 论文署名单位
		var papers = s.items.filter(function (x) { return x.kind === 'paper'; });
		if (papers.length) {
			tips.push({
				kind: 'warn', icon: '!',
				html: '已录入 <b>' + papers.length + ' 项</b>论文 / 专利成果。第一署名单位必须是' +
					'「西安交通大学」或「Xi’an Jiaotong University」，否则不予认定 —— 参与外单位项目前先确认署名安排。'
			});
		}

		// 推免提示
		tips.push({
			kind: 'ok', icon: 'i',
			html: '推免综合成绩中综测的占比<b>因学院而异</b>（部分学院为 10%），并不存在全校统一数值，' +
				'务必以你所在学院当年推免办法为准。推免 / 复试要做的"综合素质测试"是<b>心理测评</b>，与综测加分是两回事。',
			act: { text: '查看细则', fn: function () { openRuleModal(); } }
		});

		var list = el('div', 'tipList');
		tips.forEach(function (t) {
			var node = el('div', 'tip' + (t.kind !== 'ok' ? ' is' + (t.kind === 'warn' ? 'Warn' : 'Risk') : ' isOk'));
			node.innerHTML = '<span class="tipIcon">' + t.icon + '</span><span>' + t.html + '</span>';
			if (t.act) {
				var b = el('button', 'tipAct', t.act.text);
				b.type = 'button';
				b.addEventListener('click', t.act.fn);
				node.querySelector('span:last-child').appendChild(b);
			}
			list.appendChild(node);
		});
		group.appendChild(list);
		return group;
	}

	function focusVol() {
		goTab('pin');
		setTimeout(function () {
			var input = $('volHours');
			if (input) { input.focus(); input.select(); }
		}, 60);
	}
	function goTab(tab) {
		var btn = document.querySelector('.mTab[data-tab="' + tab + '"]');
		if (btn) btn.click();
	}

	/* ================= 规则弹窗 ================= */
	function openRuleModal() {
		var host = $('ruleModalBody');
		host.innerHTML = '';

		host.appendChild(ruleSec('总公式', '综合素质测评成绩 = 品行素质分（80 分）＋ 能力拓展分（20 分）＋ 奖励分（5 分），' +
			'满分 105 分。每学年第一学期集中开展，由书院综测工作组与班级评议小组评定。'));

		var pinTbl = table([
			['项目', '满分'],
			['基准分', '70'],
			['集体活动分', '3'],
			['思想政治理论学习分', '3'],
			['社会服务分', '4']
		]);
		host.appendChild(ruleSec('品行素质分（80 分）', '经班级评议小组评议合格、书院审定通过即可获得基准分 70 分。加分项如下，' +
			'扣分项不设上限、从基准分扣除。', pinTbl));

		host.appendChild(ruleSec('集体活动分（上限 3）', '参与学校及书（学）院主办或发起的重大活动。<b>校级办法未统一规定单次分值，' +
			'由各书（学）院自行认定</b>：本工具默认按彭康书院口径 0.6 分 / 次，可切换为校级通用口径或「突出贡献」一次性满分。' +
			'对集体荣誉作出突出贡献，经书院认定可一次性获得满分 3 分。'));

		host.appendChild(ruleSec('思想政治理论学习分（上限 3）', '各级党团组织理论学习培训（含网络学习）+1；省、部级理论学习培训 +2；' +
			'培训获「优秀学员」称号额外 +1。三项可叠加，总封顶 3 分。'));

		host.appendChild(ruleSec('社会服务分（上限 4）', '志愿服务每学年 ≥32 小时 +1（不足按比例折算）；校级社会实践考核合格的团队成员 +1；' +
			'市、县级挂职锻炼及政府见习 +1；省、部级挂职锻炼及政府见习、国际组织见习 +2；获先进个人及表彰额外 +1。各项可累计、封顶 4 分。'));

		var dedTbl = table([['扣分行为', '分值']].concat(R.DEDUCT_RULES.map(function (r) {
			return [r.text, '−' + r.per + ' / ' + r.unit];
		})));
		host.appendChild(ruleSec('品行素质扣分（无上限）', '以下扣分直接从基准分扣除，不设上限。', dedTbl));

		var compTbl = table([
			['竞赛级别', '特等奖', '一等奖', '二等奖', '三等奖', '优秀奖'],
			['高水平国际、国家级', '10', '10', '9', '8', '—'],
			['省级', '8', '8', '6', '4', '—'],
			['校级 / 地方行政 / 行业 / 学会', '4', '4', '3', '2', '1']
		]);
		host.appendChild(ruleSec('能力拓展 · 学术科研及创新创业（上限 10）',
			'特等奖单列成档、与一等奖同分。同一项目获不同奖项不累计、取最高；不同项目可累计。', compTbl));

		var paperTbl = table([
			['成果', '第一作者', '第二', '第三', '第四', '第五及以后'],
			['学校认定的国际期刊论文', '10', '8', '6', '2', '2'],
			['国内核心期刊、国际会议', '6', '5', '4', '1', '1'],
			['国内一般期刊、国内会议', '3', '2', '1', '—', '—'],
			['出版专著', '10', '8', '6', '5', '4 / 3 / 2 / 1（最低 1）'],
			['发明专利（按 i 类）', '10', '8', '6', '2', '2'],
			['实用新型 / 软著（按 ii 类）', '6', '5', '4', '1', '1']
		]);
		host.appendChild(ruleSec('能力拓展 · 论文 / 专著 / 专利',
			R.PAPER.hint + ' 专著按「第四位起依次递减 1」展开：10/8/6/5/4/3/2/1，第九位及以后 1 分。会议入围优秀论文额外 +1。', paperTbl));

		var artTbl = table([
			['级别', '一等', '二等', '三等', '优秀奖'],
			['国际级 / 国家级', '6', '5', '4', '3'],
			['省级', '4', '3.5', '3', '2'],
			['校级', '2', '1.5', '1', '—']
		]);
		var sportTbl = table([
			['级别', '第 1 名', '第 2 名', '第 3 名', '第 4–8 名'],
			['国际级 / 国家级', '6', '5', '4', '3'],
			['省级', '4', '3.5', '3', '2'],
			['校级', '2', '1.5', '1', '0.5']
		]);
		host.appendChild(ruleSec('能力拓展 · 文体竞赛（上限 6）',
			'同一项目取最高、不同项目可累计。破省级及以上纪录 +5，破校级纪录 +3。', artTbl));
		host.appendChild(ruleSec('体育竞赛', '按名次计分：', sportTbl));

		var dutyTbl = table([
			['职务档位', '优', '良', '合格'],
			['院级及以上学生组织正职等', '4', '3.5', '3'],
			['党总支委员、组织副职、优秀社团正职', '3.5', '3', '2.5'],
			['党支部委员、组织部长、甲级社团正职、团支书、班长', '2', '1.5', '1'],
			['团学组织干事、一般干部、宿舍长', '1', '0.75', '0.5']
		]);
		host.appendChild(ruleSec('能力拓展 · 学生组织、社团任职（上限 4）',
			'兼任多项职务按最高分计、不累加；考核不合格不加分。<b>任期原则上满一年；不满一年根据工作时间酌情加分，' +
			'最高不得超过任期满一年的加分。</b>', dutyTbl));

		var rewTbl = table([
			['级别', '全国', '省', '市', '校', '院'],
			['精神文明集体 / 个人荣誉表彰', '5', '4', '3', '2', '1'],
			['见义勇为、舍己救人、拾金不昧等受表彰', '5', '4', '3', '2', '1']
		]);
		host.appendChild(ruleSec('奖励分（上限 5）',
			'累加超过 5 分按 5 分计。做好事受表扬 / 为校争光、突出贡献：每项 +1，可累加，封顶 5。', rewTbl));

		host.appendChild(ruleSec('评定程序与申诉', '学生提交学年总结及支撑材料 → 班级评议小组初评 → 学生核对并<b>签字确认</b> → 书院工作组审核 → ' +
			'院内公示不少于 3 个工作日 → 报学生处审核。<br>' +
			'异议：公示起 3 个工作日内向书院工作组书面提出 → 3 个工作日内答复；仍不服，答复后 3 个工作日内向学生处书面申诉 → ' +
			'学生处 3 个工作日内出具<b>最终处理意见</b>。'));

		host.appendChild(ruleSec('文件依据', '学生工作部（处）《西安交通大学本科生综合素质测评成绩评定办法》，2018 年 5 月印发；' +
			'2018 年 7 月 12 日经校长办公会审议通过的《实施细则》与《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41 号）' +
			'共同发布，2018—2019 学年起统一执行。<br>各书（学）院可能有细化口径，<b>以你所在书院当年公示细则为最终执行依据</b>。'));

		$('ruleModal').dataset.open = '1';
		$('ruleModal').setAttribute('aria-hidden', 'false');
	}

	function closeRuleModal() {
		$('ruleModal').dataset.open = '0';
		$('ruleModal').setAttribute('aria-hidden', 'true');
	}

	function ruleSec(title, body, tbl) {
		var sec = el('div', 'ruleSec');
		sec.appendChild(el('div', 'ruleSecTitle', title));
		sec.appendChild((function () {
			var b = el('div', 'ruleSecBody');
			b.innerHTML = body;
			if (tbl) b.appendChild(tbl);
			return b;
		})());
		return sec;
	}

	function table(rows) {
		var t = document.createElement('table');
		t.className = 'ruleTbl';
		rows.forEach(function (r, i) {
			var tr = document.createElement('tr');
			r.forEach(function (cell) {
				var c = document.createElement(i === 0 ? 'th' : 'td');
				c.textContent = cell;
				tr.appendChild(c);
			});
			t.appendChild(tr);
		});
		return t;
	}

	/* ================= 学年菜单 ================= */
	function renderYearMenu() {
		var menu = $('yearMenu');
		menu.innerHTML = '';
		yearOptions().forEach(function (y) {
			var b = el('button', 'mYearOpt' + (y === store.year ? ' isActive' : ''), y);
			b.type = 'button';
			b.setAttribute('role', 'option');
			var n = (store.sheets[y] ? store.sheets[y].items.length : 0);
			if (n) b.appendChild(el('span', 'yrMeta', n + ' 项'));
			b.addEventListener('click', function () {
				store.year = y;
				if (!store.sheets[y]) store.sheets[y] = blankSheet();
				save();
				closeYearMenu();
				renderAll();
				toast('已切换到 ' + y + ' 学年');
			});
			menu.appendChild(b);
		});
		$('yearText').textContent = store.year + ' 学年';
	}
	function openYearMenu() { $('yearBtn').classList.add('isOpen'); $('yearMenu').parentNode.classList.add('isOpen'); $('yearBtn').setAttribute('aria-expanded', 'true'); }
	function closeYearMenu() { $('yearBtn').classList.remove('isOpen'); $('yearMenu').parentNode.classList.remove('isOpen'); $('yearBtn').setAttribute('aria-expanded', 'false'); }

	/* ================= Tab ================= */
	function bindTabs() {
		document.querySelectorAll('.mTab').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var tab = btn.dataset.tab;
				document.querySelectorAll('.mTab').forEach(function (b) {
					var on = b === btn;
					b.classList.toggle('isActive', on);
					b.setAttribute('aria-selected', on ? 'true' : 'false');
				});
				document.querySelectorAll('.mPane').forEach(function (p) {
					var on = p.id === 'pane-' + tab;
					p.classList.toggle('isActive', on);
					p.hidden = !on;
				});
				if (tab === 'insight') renderInsight();
				$('mScroll').scrollTop = 0;
			});
		});
	}

	/* ================= 品行素质绑定 ================= */
	function bindPin() {
		// 基准分
		$('pinBaseOk').addEventListener('change', function () {
			sheet().base = this.checked;
			save(); renderAll();
		});

		// 集体活动：口径切换
		var countWrap = $('collectiveCountWrap');
		document.querySelectorAll('#collectiveModeSeg .segBtn').forEach(function (b) {
			b.addEventListener('click', function () {
				sheet().collectiveMode = b.dataset.mode;
				save(); renderAll();
			});
		});

		// 集体活动：步进器
		var inCount = $('collectiveCountIn');
		inCount.addEventListener('input', function () {
			sheet().collectiveCount = Math.max(0, Math.min(99, Math.round(num(this.value))));
			save(); renderAll();
		});
		inCount.addEventListener('blur', function () { this.value = num(sheet().collectiveCount); });
		$('collectiveCount').querySelectorAll('.stepBtn').forEach(function (b) {
			b.addEventListener('click', function () {
				var step = parseInt(b.dataset.step, 10);
				var v = num(sheet().collectiveCount) + step;
				sheet().collectiveCount = Math.max(0, Math.min(99, v));
				save(); renderAll();
			});
		});

		// 书院口径切换
		$('collectiveSwitch').addEventListener('click', function () {
			var s = sheet();
			if (num(s.collectivePerTime, 0.6) > 0) {
				s.collectivePerTime = 0;
				toast('已切到校级通用口径（未定单次分值）', 'warn');
			} else {
				s.collectivePerTime = 0.6;
				toast('已切到彭康书院口径（0.6 分 / 次）');
			}
			save(); renderAll();
		});

		// 志愿时长
		var vol = $('volHours');
		vol.addEventListener('input', function () {
			sheet().volunteer = Math.max(0, Math.min(500, num(this.value)));
			save(); renderAll();
		});

		// 思政 / 社会服务勾选：唯一写入路径是 input 的 change。
		// label 包裹 input，用户点 label 的任何位置都会激活 input 并派发 change，
		// 因此不再另接 label click —— 避免与 change 重复触发互相抵消。
		document.querySelectorAll('.blk[data-cap-key="ideology"] input[data-k], .blk[data-cap-key="social"] input[data-k]')
			.forEach(function (input) {
				input.addEventListener('change', function () {
					sheet().pin[input.dataset.k] = input.checked;
					save(); renderAll();
				});
			});

		// 基准分开关：同上
		(function () {
			var input = $('pinBaseOk');
			if (!input) return;
			input.addEventListener('change', function () {
				sheet().base = input.checked;
				save(); renderAll();
			});
		})();

		// 扣分次数
		document.querySelectorAll('.blk[data-cap-key="deduct"] .numIn').forEach(function (input) {
			var key = input.dataset.k;
			input.addEventListener('input', function () {
				sheet().deduct[key] = Math.max(0, Math.min(99, Math.round(num(this.value))));
				save(); renderAll();
			});
			input.addEventListener('blur', function () { this.value = num(sheet().deduct[key]); });
		});
	}

	/* ================= 添加条目 ================= */
	function bindAdd() {
		document.querySelectorAll('[data-add]').forEach(function (b) {
			b.addEventListener('click', function () { openItemModal(b.dataset.add, null); });
		});
	}

	function bindModal() {
		$('itemModalClose').addEventListener('click', closeItemModal);
		$('itemModalCancel').addEventListener('click', closeItemModal);
		$('itemModalMask').addEventListener('click', closeItemModal);
		$('itemModalSave').addEventListener('click', saveItemFromModal);
		$('ruleModalClose').addEventListener('click', closeRuleModal);
		$('ruleModalOk').addEventListener('click', closeRuleModal);
		$('ruleModalMask').addEventListener('click', closeRuleModal);
	}

	function saveItemFromModal() {
		var d = modalState.draft;
		var err = $('itemModalErr');

		// 校验
		if (modalState.group === 'academic') {
			if ((d.kind || 'award') === 'paper') {
				if (!d.paperKind) { err.textContent = '请选择成果类型'; return; }
				if (!d.rank) { err.textContent = '请选择署名位次'; return; }
				var k = R.PAPER.kinds.filter(function (x) { return x.id === d.paperKind; })[0];
				if (k && k.ranks[d.rank] == null) { err.textContent = '该位次在此类成果中不计分'; return; }
			} else {
				if (!d.level || !d.prize) { err.textContent = '请选择竞赛级别与获奖等次'; return; }
			}
		}
		if (modalState.group === 'culture') {
			if (!d.level || !d.prize) { err.textContent = '请选择赛事级别与等次'; return; }
		}
		if (modalState.group === 'duty') {
			if (!d.post || !d.grade) { err.textContent = '请选择职务档位与考核等次'; return; }
		}
		if (modalState.group === 'reward' && !d.type) { err.textContent = '请选择表彰类型'; return; }

		var s = sheet();
		var it = {
			id: d.id || genId(),
			group: modalState.group,
			kind: d.kind,
			name: d.name || '',
			note: d.note || '',
			level: d.level,
			prize: d.prize,
			paperKind: d.paperKind,
			rank: d.rank,
			bound: !!d.bound,
			post: d.post,
			grade: d.grade,
			term: d.term,
			type: d.type,
			brk: d.brk || null
		};
		it.score = parseFloat(scoreOf(it));

		if (modalState.editing) {
			var found = false;
			for (var i = 0; i < s.items.length; i++) {
				if (s.items[i].id === it.id) { s.items[i] = it; found = true; break; }
			}
			if (!found) s.items.push(it);
			toast('已更新');
		} else {
			s.items.push(it);
			toast('已添加，+' + R.fmt1(it.score));
		}
		save();
		closeItemModal();
		renderAll();
	}

	/* ================= 导入 / 导出 / 清空 ================= */
	function bindTools() {
		$('btnRules').addEventListener('click', openRuleModal);
		$('btnPanel').addEventListener('click', function () { openRuleModal(); });

		$('btnExport').addEventListener('click', function () {
			var payload = {
				app: 'merit-beta-step',
				version: 1,
				exportedAt: new Date().toISOString(),
				year: store.year,
				data: store
			};
			var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = '综评成绩_' + store.year + '.json';
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
			toast('已导出 JSON 备份');
		});

		$('btnImport').addEventListener('click', function () { $('fileImport').click(); });
		$('fileImport').addEventListener('change', function () {
			var f = this.files && this.files[0];
			if (!f) return;
			var reader = new FileReader();
			reader.onload = function () {
				try {
					var d = JSON.parse(reader.result);
					var incoming = d && (d.data || d);
					if (!incoming || typeof incoming !== 'object' || !incoming.sheets) throw new Error('bad');
					store = incoming;
					if (!store.year || !store.sheets[store.year]) store.year = currentSchoolYear();
					if (!store.sheets[store.year]) store.sheets[store.year] = blankSheet();
					save();
					renderAll();
					toast('导入成功');
				} catch (e) {
					toast('文件格式不正确', 'alert');
				}
			};
			reader.readAsText(f);
			this.value = '';
		});

		var clearArmed = false;
		var clearTimer = null;
		$('btnClear').addEventListener('click', function () {
			var b = this;
			if (!clearArmed) {
				clearArmed = true;
				b.classList.add('armed');
				b.textContent = '确认清空本学年';
				clearTimer = setTimeout(function () {
					clearArmed = false; b.classList.remove('armed'); b.textContent = '清空';
				}, 3000);
				return;
			}
			clearTimeout(clearTimer);
			clearArmed = false;
			b.classList.remove('armed');
			b.textContent = '清空';
			store.sheets[store.year] = blankSheet();
			save();
			renderAll();
			toast('已清空本学年数据', 'warn');
		});
	}

	/* ================= 全局 ================= */
	function bindGlobal() {
		// 学年菜单
		$('yearBtn').addEventListener('click', function (e) {
			e.stopPropagation();
			$('yearBtn').classList.contains('isOpen') ? closeYearMenu() : openYearMenu();
		});
		document.addEventListener('click', function (e) {
			if (!e.target.closest('.mYear')) closeYearMenu();
		});

		// Esc 关弹窗
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') {
				if ($('ruleModal').dataset.open === '1') closeRuleModal();
				else if ($('itemModal').dataset.open === '1') closeItemModal();
				else closeYearMenu();
			}
		});
	}

	/* ================= 渲染入口 ================= */
	function renderAll() {
		renderTotal();
		renderPin();
		renderItems();
		renderYearMenu();
		if ($('pane-insight').classList.contains('isActive')) renderInsight();
	}

	function boot() {
		bindTabs();
		bindPin();
		bindAdd();
		bindModal();
		bindTools();
		bindGlobal();

		// 主题切换接入站点顶栏
		if (window.siteNav && typeof window.siteNav.init === 'function') {
			window.siteNav.init({
				setTheme: function (theme) {
					document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
				}
			});
		}

		renderAll();
	}

	/* 供 .tests/merit-rules-diff.js 做行为探针（页面本身不依赖） */
	window.MeritStepEngine = {
		scoreOf: scoreOf,
		compute: compute,
		computePin: computePin,
		volScore: volScore
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
