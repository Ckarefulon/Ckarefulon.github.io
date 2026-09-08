/* Cross 训练 · 页面逻辑 */
(function () {
	'use strict';

	var E = window.CrossEngine;
	var MOVES = E.MOVE_NAMES;
	var COLOR_NAME = { 0: '白', 1: '红', 2: '绿', 3: '黄', 4: '橙', 5: '蓝' };
	var FACE_NAME = { 0: '上面', 1: '右面', 2: '前面', 3: '下面', 4: '左面', 5: '后面' };
	var SETTINGS_KEY = 'crossTrainerSettings';

	var el = {};
	var state = {
		colorFace: 0,
		pos: 'D',
		steps: 5,
		puzzle: null,
		userMoves: [],
		allMoves: [],
		phase: 'solve',      // scramble = 正在打乱；solve = 正在做十字
		scrambleProgress: 0, // 已确认完成的打乱步数
			revealed: {},        // 手动点开的解法
		done: {},            // 已完成的解法
		connected: false,
		deviceName: '',
		lastPrevMoves: [],
		ignoreMoves: true
	};

	function $(id) { return document.getElementById(id); }
	function crossFace() { return state.pos === 'D' ? 3 : 0; }

	/* ---------------- 设置 ---------------- */
	function loadSettings() {
		try {
			var raw = localStorage.getItem(SETTINGS_KEY);
			if (raw) {
				var s = JSON.parse(raw);
				if (typeof s.colorFace === 'number') { state.colorFace = s.colorFace; }
				if (s.pos === 'U' || s.pos === 'D') { state.pos = s.pos; }
				if (typeof s.steps === 'number') { state.steps = s.steps; }
			}
		} catch (e) { /* ignore */ }
		// URL 参数优先：?color=0-5&pos=U|D&steps=1-8
		try {
			var q = new URLSearchParams(location.search);
			if (q.has('color')) { state.colorFace = Math.max(0, Math.min(5, Number(q.get('color')) || 0)); }
			if (q.get('pos') === 'U' || q.get('pos') === 'D') { state.pos = q.get('pos'); }
			if (q.has('steps')) { state.steps = Math.max(1, Math.min(8, Number(q.get('steps')) || 5)); }
		} catch (e) { /* ignore */ }
	}
	function saveSettings() {
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify({
				colorFace: state.colorFace, pos: state.pos, steps: state.steps
			}));
		} catch (e) { /* ignore */ }
	}

	/* ---------------- 渲染：设置区 ---------------- */
	function buildPickers() {
		var cp = el.colorPicker;
		cp.innerHTML = '';
		[0, 1, 2, 3, 4, 5].forEach(function (c) {
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'swatch';
			b.dataset.color = c;
			b.title = COLOR_NAME[c] + '色十字';
			b.setAttribute('aria-label', COLOR_NAME[c] + '色十字');
			b.addEventListener('click', function () {
				state.colorFace = c;
				syncPickers();
				saveSettings();
				newPuzzle();
			});
			cp.appendChild(b);
		});

		var sp = el.stepsPicker;
		sp.innerHTML = '';
		for (var i = 1; i <= 8; i++) {
			(function (n) {
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'stepChip';
				b.textContent = n;
				b.dataset.step = n;
				b.addEventListener('click', function () {
					state.steps = n;
					syncPickers();
					saveSettings();
					newPuzzle();
				});
				sp.appendChild(b);
			})(i);
		}

		Array.prototype.forEach.call(el.posSeg.querySelectorAll('button'), function (b) {
			b.addEventListener('click', function () {
				state.pos = b.dataset.pos;
				syncPickers();
				saveSettings();
				newPuzzle();
			});
		});
	}

	function syncPickers() {
		Array.prototype.forEach.call(el.colorPicker.children, function (b) {
			b.classList.toggle('isActive', Number(b.dataset.color) === state.colorFace);
		});
		Array.prototype.forEach.call(el.stepsPicker.children, function (b) {
			b.classList.toggle('isActive', Number(b.dataset.step) === state.steps);
		});
		Array.prototype.forEach.call(el.posSeg.querySelectorAll('button'), function (b) {
			b.classList.toggle('isActive', b.dataset.pos === state.pos);
		});
		el.crossTargetHint.textContent = '目标：' + COLOR_NAME[state.colorFace] + '十字 · ' +
			(state.pos === 'D' ? '底面' : '顶面');
	}

	/* ---------------- 魔方展开图 ---------------- */
	function buildCubeNet() {
		var net = el.cubeNet;
		net.innerHTML = '';
		['U', 'L', 'F', 'R', 'B', 'D'].forEach(function (fname) {
			var face = document.createElement('div');
			face.className = 'face';
			face.dataset.face = fname;
			for (var i = 0; i < 9; i++) {
				var s = document.createElement('div');
				s.className = 'sticker';
				face.appendChild(s);
			}
			net.appendChild(face);
		});
	}

	function renderCubeNet(facelets) {
		if (!facelets) { return; }
		el.cubeTitle.textContent = (state.connected && state.phase === 'scramble') ? '打乱中 · 实时状态' : '打乱后状态';
		var order = ['U', 'L', 'F', 'R', 'B', 'D'];
		var faces = el.cubeNet.querySelectorAll('.face');
		for (var f = 0; f < order.length; f++) {
			var fi = E.FACE_INDEX[order[f]];
			var stickers = faces[f].children;
			for (var i = 0; i < 9; i++) {
				var src = facelets[fi * 9 + i];
				var color = E.COLOR_OF_FACE[Math.floor(src / 9)];
				stickers[i].style.background = color;
			}
		}
	}

	/* ---------------- 生成题目 ---------------- */
	function newPuzzle() {
		var t0 = performance.now();
		var p = E.generate(state.colorFace, crossFace(), state.steps, Math.random, { limit: 1200 });
		if (!p) {
			el.scrambleText.textContent = '生成失败，请重试';
			return;
		}
		state.puzzle = p;
		state.userMoves = [];
		state.allMoves = [];
		state.scrambleProgress = 0;
		state.revealed = {};
		state.done = {};
		state.phase = state.connected ? 'scramble' : 'solve';
		state.lastPrevMoves = [];
		el.revealAll.dataset.all = '';
		el.revealAll.textContent = '看答案';
		el.solCount.textContent = '（' + p.solutions.length + ' 条 · ' + state.steps + ' 步）';
		renderScrambleSteps();
		el.scrambleMeta.textContent = p.scramble.length + ' 步打乱 · ' +
			(performance.now() - t0).toFixed(0) + 'ms';
		renderSolutions();
		renderMoves();
		renderCubeNet(currentFacelets());
		if (el.cubePopWrap.classList.contains('isPinned')) { positionCubePop(); }
		updatePhaseChip();
		el.matchInfo.textContent = '';
	}

	/* ---------------- 打乱公式动态视图 ----------------
	 * 把已做的转动化简后与打乱序列做前缀匹配：
	 * - 已匹配部分：半透明（已打乱）
	 * - 未匹配余项（转错/进行中）：取逆作为「修正步」插入公式（青底），与原剩余首步同面时自动合并
	 * - 原剩余部分：紫（待打乱）
	 * 任何状态按当前公式继续转，最终都到达目标打乱状态。
	 */
	function computeScrambleView() {
		var p = state.puzzle;
		var simp = E.simplifyMoves(state.allMoves);
		var k = 0;
		while (k < simp.length && k < p.scramble.length && simp[k] === p.scramble[k]) { k++; }
		var extra = simp.slice(k);
		var items = [], i;
		for (i = 0; i < k; i++) { items.push({ text: MOVES[p.scramble[i]], cls: 'scStep isDone' }); }
		var correcting = extra.length > 0 && k < p.scramble.length;
		if (correcting) {
			var corr = E.invertMoves(extra);
			var rest = p.scramble.slice(k);
			var ri = 0, changed = true;
			while (changed && corr.length && ri < rest.length) {
				changed = false;
				var last = corr[corr.length - 1];
				if (E.moveFace(last) === E.moveFace(rest[ri])) {
					var pw = (E.movePower(last) + E.movePower(rest[ri])) % 4;
					corr.pop();
					if (pw !== 0) { corr.push(E.moveFace(last) * 3 + (pw === 1 ? 0 : pw === 2 ? 1 : 2)); }
					ri++;
					changed = true;
				}
			}
			for (i = 0; i < corr.length; i++) {
				items.push({ text: MOVES[corr[i]], cls: 'scStep isFix' + (i === 0 ? ' isCurrent' : '') });
			}
			for (i = ri; i < rest.length; i++) { items.push({ text: MOVES[rest[i]], cls: 'scStep isPending' }); }
		} else {
			for (i = k; i < p.scramble.length; i++) { items.push({ text: MOVES[p.scramble[i]], cls: 'scStep isPending' }); }
		}
		return {
			items: items,
			progress: k,
			correcting: correcting,
			done: k === p.scramble.length && extra.length === 0
		};
	}

	function renderScrambleSteps() {
		var p = state.puzzle;
		if (!p) { return; }
		if (!(state.connected && state.phase === 'scramble')) {
			/* 非打乱阶段：打乱完成保持半透明，其余（手动模式）中性 */
			var allDone = state.connected && state.scrambleProgress === p.scramble.length;
			var html = '';
			for (var i = 0; i < p.scramble.length; i++) {
				html += '<span class="scStep' + (allDone ? ' isDone' : '') + '">' + MOVES[p.scramble[i]] + '</span>';
			}
			el.scrambleText.innerHTML = html;
			return;
		}
		var view = computeScrambleView();
		var out = '';
		for (var j = 0; j < view.items.length; j++) {
			out += '<span class="' + view.items[j].cls + '">' + view.items[j].text + '</span>';
		}
		el.scrambleText.innerHTML = out;
	}

	/* 渐进识别打乱进度：完成即切换到做题阶段 */
	function updateScrambleProgress() {
		var p = state.puzzle;
		if (!p || state.phase !== 'scramble') { return; }
		var view = computeScrambleView();
		state.scrambleProgress = view.progress;
		if (view.done) {
			state.phase = 'solve';
			state.userMoves = [];
			renderMoves();
			flash(el.phaseChip);
		}
	}

	function currentFacelets() {
		var p = state.puzzle;
		if (!p) { return E.solvedFacelets(); }
		if (state.phase === 'scramble') {
			return E.applyFaceletMoves(E.solvedFacelets(), state.allMoves);
		}
		return E.applyFaceletMoves(p.scrambleFacelets, state.userMoves);
	}

	/* ---------------- 解法列表 ---------------- */
	function renderSolutions() {
		var p = state.puzzle;
		var box = el.solutions;
		box.innerHTML = '';
		if (!p) { return; }
		var maxRender = 240;
		var list = p.solutionTexts;
		for (var i = 0; i < Math.min(list.length, maxRender); i++) {
			(function (idx) {
				var item = document.createElement('div');
				item.className = 'solItem';
				item.textContent = list[idx];
				item.dataset.index = idx;
				if (state.done[idx]) { item.classList.add('isDone'); }
				else if (state.revealed[idx]) { item.classList.add('isRevealed'); }
				item.addEventListener('click', function () {
					if (state.done[idx]) { return; }
					state.revealed[idx] = !state.revealed[idx];
					item.classList.toggle('isRevealed', !!state.revealed[idx]);
				});
				box.appendChild(item);
			})(i);
		}
		if (list.length > maxRender) {
			var more = document.createElement('div');
			more.className = 'solMore';
			more.textContent = '仅显示前 ' + maxRender + ' 条，共 ' + list.length + ' 条。';
			box.appendChild(more);
		}
	}

	function markSolutionDone(idx) {
		if (state.done[idx]) { return; }
		state.done[idx] = true;
		var items = el.solutions.querySelectorAll('.solItem');
		for (var i = 0; i < items.length; i++) {
			if (Number(items[i].dataset.index) === idx) {
				items[i].classList.add('isDone');
				items[i].scrollIntoView({ block: 'nearest' });
			}
		}
	}

	/* ---------------- 用户转动 ---------------- */
	function addUserMove(m) {
		state.userMoves.push(m);
		evaluate();
	}

	function addRawMove(m) {
		if (state.phase === 'scramble') {
			state.allMoves.push(m);
			updateScrambleProgress();
			renderScrambleSteps();
			updatePhaseChip();
		} else {
			addUserMove(m);
		}
		renderCubeNet(currentFacelets());
	}

	function evaluate() {
		var p = state.puzzle;
		if (!p) { return; }
		var simp = E.simplifyMoves(state.userMoves);
		var text = E.movesToText(simp);
		var hit = -1;
		for (var i = 0; i < p.solutionTexts.length; i++) {
			if (p.solutionTexts[i] === text) { hit = i; break; }
		}
		if (hit >= 0) {
			markSolutionDone(hit);
		}
		// 兜底：步数相同且十字已完成（解法过多被截断时）
		if (hit < 0 && simp.length === state.steps && E.isCrossDone(currentFacelets(), state.colorFace, crossFace())) {
			el.matchInfo.textContent = '已完成十字（' + text + '），这条不在展示的前若干条里。';
		} else if (hit >= 0) {
			el.matchInfo.textContent = '命中解法 #' + (hit + 1) + '：' + text;
		} else {
			el.matchInfo.textContent = '';
		}
		renderMoves();
	}

	function renderMoves() {
		var simp = E.simplifyMoves(state.userMoves);
		/* 已做序列直接写进输入框（正在输入时不打断） */
		if (document.activeElement !== el.moveInput) {
			el.moveInput.value = simp.length ? E.movesToText(simp) : '';
		}
		/* 撤销序列：与打乱相同的逐词格式 */
		var undo = E.invertMoves(simp);
		if (!undo.length) {
			el.undoMoves.innerHTML = simp.length ? '（已全部抵消）' : '—';
			return;
		}
		var html = '';
		for (var i = 0; i < undo.length; i++) {
			html += '<span class="undoStep">' + MOVES[undo[i]] + '</span>';
		}
		el.undoMoves.innerHTML = html;
	}

	function updatePhaseChip() {
		var chip = el.phaseChip;
		if (!state.connected) {
			chip.dataset.phase = 'solve';
			chip.textContent = '手动模式';
			chip.style.cursor = 'default';
			return;
		}
		chip.dataset.phase = state.phase;
		if (state.phase === 'scramble') {
			var view = computeScrambleView();
			var total = state.puzzle ? state.puzzle.scramble.length : 0;
			chip.textContent = view.correcting
				? '打乱中 · 修正偏差'
				: '打乱 ' + view.progress + '/' + total;
		} else {
			chip.textContent = '做十字中';
		}
		chip.style.cursor = 'pointer';
	}

	function flash(node) {
		node.animate && node.animate(
			[{ opacity: 0.25 }, { opacity: 1 }],
			{ duration: 420, easing: 'ease-out' }
		);
	}

	/* ---------------- 蓝牙 ---------------- */
	function setBtStatus(text, kind) {
		el.btStatus.textContent = text;
		el.btDot.dataset.state = kind || 'off';
	}

	function initBluetooth() {
		if (!window.GiikerCube) {
			// 硬件脚本尚未就绪时等 load 事件再试一次
			window.addEventListener('load', function () {
				window.setTimeout(initBluetooth, 0);
			});
			if (document.readyState === 'complete') {
				setBtStatus('蓝牙模块未加载', 'err');
				el.connectBtn.disabled = true;
			}
			return;
		}
		if (el.connectBtn.disabled && !state.connected) { el.connectBtn.disabled = false; }
		window.GiikerCube.setCallback(onCubeCallback);
		window.GiikerCube.setEventCallback(function (info) {
			if (info === 'disconnect') {
				state.connected = false;
				state.phase = 'solve';
				el.connectBtn.textContent = '连接魔方';
				el.connectBtn.classList.remove('isActive');
				setBtStatus('已断开', 'off');
				updatePhaseChip();
			}
		});
		if (!navigator.bluetooth) {
			setBtStatus('当前环境不支持 Web Bluetooth', 'err');
			el.connectBtn.disabled = true;
		}
	}

	function connect() {
		if (!window.GiikerCube) { return; }
		if (state.connected) {
			window.GiikerCube.stop();
			return;
		}
		el.connectBtn.disabled = true;
		setBtStatus('等待选择设备…', 'off');
		state.ignoreMoves = true;
		state.lastPrevMoves = [];
		window.GiikerCube.init().then(function () {
			state.connected = true;
			state.allMoves = [];
			state.scrambleProgress = 0;
			state.phase = state.puzzle ? 'scramble' : 'solve';
			el.connectBtn.textContent = '断开';
			el.connectBtn.classList.add('isActive');
			el.connectBtn.disabled = false;
			setBtStatus('已连接' + (state.deviceName ? ' · ' + state.deviceName : ''), 'on');
			window.setTimeout(function () { state.ignoreMoves = false; }, 300);
			renderScrambleSteps();
			updatePhaseChip();
		})['catch'](function (err) {
			el.connectBtn.disabled = false;
			setBtStatus('连接失败：' + String((err && err.message) || err), 'err');
		});
	}

	function normMove(raw) {
		var t = String(raw || '').replace(/[’‘`]/g, "'").replace(/\s+/g, '');
		var idx = MOVES.indexOf(t.toUpperCase());
		return idx;
	}

	/* 从硬件上报的历史里取出新增的转动（历史数组最新在前） */
	function extractNewMoves(prevMoves) {
		var cur = [];
		for (var i = 0; prevMoves && i < prevMoves.length; i++) {
			var m = normMove(prevMoves[i]);
			if (m >= 0) { cur.push(m); }
		}
		if (!cur.length) { return []; }
		var last = state.lastPrevMoves;
		state.lastPrevMoves = cur.slice(0, 12);
		if (!last.length) { state.ignoreMoves = false; return [cur[0]]; }
		var n = 1;
		for (; n <= cur.length; n++) {
			var tail = cur.slice(n), head = last.slice(0, tail.length);
			if (tail.length === head.length && tail.every(function (m, i) { return m === head[i]; })) { break; }
		}
		if (n > cur.length) { n = 1; }
		return cur.slice(0, n).reverse();
	}

	function onCubeCallback(facelet, prevMoves, lastTs, hardware) {
		if (hardware) { state.deviceName = String(hardware); }
		if (state.ignoreMoves) {
			state.lastPrevMoves = [];
			return;
		}
		var news = extractNewMoves(prevMoves);
		for (var i = 0; i < news.length; i++) { addRawMove(news[i]); }
		if (state.connected) { updatePhaseChip(); }
	}

	/* ---------------- 手动输入 ---------------- */
	function applyInputText(text) {
		var moves = E.textToMoves(text);
		for (var i = 0; i < moves.length; i++) { addRawMove(moves[i]); }
		return moves.length;
	}

	function bindInput() {
		el.applyMoves.addEventListener('click', function () {
			var v = el.moveInput.value;
			el.moveInput.value = '';
			applyInputText(v); /* 应用后 renderMoves 会把化简结果写回输入框 */
		});
		el.moveInput.addEventListener('keydown', function (ev) {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				var v = el.moveInput.value;
				el.moveInput.value = '';
				applyInputText(v);
			}
			ev.stopPropagation();
		});
		el.moveInput.addEventListener('keyup', function (ev) { ev.stopPropagation(); });

		el.resetMoves.addEventListener('click', function () {
			state.userMoves = [];
			state.allMoves = [];
			state.scrambleProgress = 0;
			if (state.connected) { state.phase = 'scramble'; }
			el.matchInfo.textContent = '';
			renderMoves();
			renderScrambleSteps();
			renderCubeNet(currentFacelets());
			updatePhaseChip();
		});

		document.addEventListener('keydown', function (ev) {
			var tag = (ev.target && ev.target.tagName || '').toLowerCase();
			if (tag === 'input' || tag === 'textarea') { return; }
			if (ev.metaKey || ev.ctrlKey || ev.altKey) { return; }
			var k = ev.key;
			if (k === ' ') {
				ev.preventDefault();
				newPuzzle();
				return;
			}
			if (k === 'Backspace') {
				ev.preventDefault();
				state.userMoves.pop();
				renderMoves();
				renderCubeNet(currentFacelets());
				return;
			}
			var face = 'URFDLB'.indexOf(k.toUpperCase());
			if (face >= 0 && /^[a-zA-Z]$/.test(k)) {
				ev.preventDefault();
				var pow = ev.shiftKey ? 2 : 0; // 0=顺时针 2=逆时针
				addRawMove(face * 3 + pow);
			}
		});
	}

	/* ---------------- 复制 ---------------- */
	function copyText(text, btn) {
		if (!text) { return; }
		var done = function () {
			if (!btn) { return; }
			var old = btn.textContent;
			btn.textContent = '已复制';
			window.setTimeout(function () { btn.textContent = old; }, 900);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
		} else {
			fallbackCopy(text, done);
		}
	}
	function fallbackCopy(text, done) {
		var ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
		document.body.removeChild(ta);
	}

	/* 当前打乱公式文本（含修正步，与页面显示一致） */
	function currentScrambleText() {
		var p = state.puzzle;
		if (!p) { return ''; }
		if (state.connected && state.phase === 'scramble') {
			var view = computeScrambleView();
			return view.items.map(function (it) { return it.text; }).join(' ');
		}
		return p.scrambleText;
	}
	/* 当前撤销序列文本 */
	function currentUndoText() {
		var simp = E.simplifyMoves(state.userMoves);
		return E.movesToText(E.invertMoves(simp));
	}

	/* 状态图弹窗定位：fixed 相对视口，右侧弹出；右溢出翻左侧；垂直 clamp 在视口内 */
	function positionCubePop() {
		var pop = el.cubePop, wrap = el.cubePopWrap;
		if (!pop) { return; }
		var r = wrap.getBoundingClientRect();
		var w = pop.offsetWidth || 300;
		var h = pop.offsetHeight || 220;
		var vw = window.innerWidth, vh = window.innerHeight;
		var left = r.right + 10;
		if (left + w > vw - 8) { left = Math.max(8, r.left - w - 10); }
		var top = Math.max(8, Math.min(r.top, vh - h - 8));
		pop.style.left = left + 'px';
		pop.style.top = top + 'px';
	}

	/* ---------------- 初始化 ---------------- */
	function init() {
		['colorPicker', 'posSeg', 'stepsPicker', 'scrambleText', 'scrambleMeta', 'copyScramble',
			'newScramble', 'cubeNet', 'cubeTitle', 'crossTargetHint', 'cubeBtn', 'cubePopWrap', 'cubePop', 'solutions', 'solCount', 'revealAll',
			'undoMoves', 'copyUndo', 'moveInput', 'applyMoves', 'resetMoves',
			'phaseChip', 'matchInfo', 'connectBtn', 'btStatus', 'btDot'].forEach(function (id) {
				el[id] = $(id);
			});

		loadSettings();
		buildPickers();
		syncPickers();
		buildCubeNet();
		bindInput();

		el.newScramble.addEventListener('click', function () { newPuzzle(); });
		el.scrambleText.addEventListener('dblclick', function () { newPuzzle(); });
		el.copyScramble.addEventListener('click', function () {
			copyText(currentScrambleText(), el.copyScramble);
		});
		el.cubeBtn.addEventListener('click', function () {
			var isPinned = el.cubePopWrap.classList.toggle('isPinned');
			if (isPinned) {
				positionCubePop();
			} else {
				el.cubePop.style.left = '';
				el.cubePop.style.top = '';
			}
		});
		window.addEventListener('resize', function () {
			if (el.cubePopWrap.classList.contains('isPinned')) { positionCubePop(); }
		});
		el.copyUndo.addEventListener('click', function () {
			copyText(currentUndoText(), el.copyUndo);
		});
		el.revealAll.addEventListener('click', function () {
			var items = el.solutions.querySelectorAll('.solItem');
			var reveal = !el.revealAll.dataset.all;
			for (var i = 0; i < items.length; i++) {
				var idx = Number(items[i].dataset.index);
				if (state.done[idx]) { continue; }
				state.revealed[idx] = reveal;
				items[i].classList.toggle('isRevealed', reveal);
			}
			el.revealAll.dataset.all = reveal ? '1' : '';
			el.revealAll.textContent = reveal ? '重新隐藏' : '看答案';
		});
		el.phaseChip.addEventListener('click', function () {
			if (!state.connected) { return; }
			state.phase = state.phase === 'scramble' ? 'solve' : 'scramble';
			state.userMoves = [];
			if (state.phase === 'scramble') {
				state.allMoves = [];
				state.scrambleProgress = 0;
			}
			renderMoves();
			renderScrambleSteps();
			renderCubeNet(currentFacelets());
			updatePhaseChip();
		});
		el.connectBtn.addEventListener('click', connect);

		newPuzzle();
		initBluetooth();
		runAutoDebug();
	}

	/* 调试钩子：#auto=N/输入序列 或 ?auto=N/输入序列，设置步数 N 并应用输入序列（留空则自动应用第一条解法）；
	 * ?sim=N：模拟蓝牙打乱进度（喂入打乱序列前 N 步） */
	function runAutoDebug() {
		var q = null;
		try { q = new URLSearchParams(location.search); } catch (e) { /* ignore */ }
		var simN = (q && q.has('sim')) ? Math.max(0, Number(q.get('sim')) || 0) : -1;

		var spec = '';
		if (location.hash.indexOf('#auto=') === 0) { spec = location.hash.slice(6); }
		else if (q && q.has('auto')) { spec = q.get('auto'); }

		if (spec) {
			var m = /^(\d+)\/?(.*)/.exec(spec);
			if (m) {
				var n = Number(m[1]);
				var txt = decodeURIComponent(m[2] || '');
				var chip = el.stepsPicker.querySelector('.stepChip[data-step="' + n + '"]');
				if (chip) { chip.click(); }
				var applied = -1;
				if (txt) { applied = applyInputText(txt); }
				else if (state.puzzle && state.puzzle.solutions[0]) {
					applied = applyInputText(E.movesToText(state.puzzle.solutions[0]));
				}
				if (applied < 0) { el.matchInfo.textContent = '[auto] 未找到可应用的解法'; }
			}
		}

		if (simN >= 0) {
			state.connected = true;
			state.phase = 'scramble';
			state.ignoreMoves = false;
			state.allMoves = [];
			state.userMoves = [];
			state.scrambleProgress = 0;
			renderScrambleSteps();
			updatePhaseChip();
			var seq = state.puzzle ? state.puzzle.scramble : [];
			for (var j = 0; j < Math.min(simN, seq.length); j++) { addRawMove(seq[j]); }
			/* &simerr=1：在进度后再喂一步与下一步异面的错误转动，验证修正吸收 */
			if (q && q.has('simerr') && simN < seq.length) {
				var nextFace = E.moveFace(seq[simN]);
				var bad = ((nextFace + 1) % 6) * 3;
				addRawMove(bad);
			}
		}
		if (q && q.has('pin')) {
			el.cubePopWrap.classList.add('isPinned');
			positionCubePop();
		}
	}

	window.CrossApp = { initBluetooth: initBluetooth, state: state, newPuzzle: newPuzzle, applyInputText: applyInputText, E: E };

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
