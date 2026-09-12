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
		steps: 5,
		puzzle: null,
		userMoves: [],
		allMoves: [],
		phase: 'solve',      // scramble = 正在打乱；solve = 正在做十字
		scrambleProgress: 0, // 已确认完成的打乱步数
			revealed: {},        // 手动点开的解法
		done: {},            // 已完成的解法
		hinted: {},          // 完成时已处于显示状态的解法（紫色，不算成功）
		fixDone: [],         // 已完成的修正步（按插入位置保留显示，半透明）
		prevCorr: [],        // 上一帧的修正步序列（用于检测修正步被做掉）
		connected: false,
		deviceName: '',
		lastPrevMoves: [],
		ignoreMoves: true,
		realFacelets: null,   // 硬件上报的真实状态（权威），未连接时为 null
		pendingRealSync: false, // 连上后等待首次真实状态，拿到即按当前状态重新出题
		drift: 0              // 真实状态与推演连续不符的次数
	};

	function $(id) { return document.getElementById(id); }
	function crossFace() { return state.colorFace; }
	/* 是否完全还原（所有贴片归位） */
	function isSolvedState(f) {
		for (var i = 0; i < f.length; i++) { if (f[i] !== i) { return false; } }
		return true;
	}
	function sameFacelets(a, b) {
		if (!a || !b || a.length !== b.length) { return false; }
		for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
		return true;
	}
	/* 真实状态可用时它才是权威；否则按虚拟推演 */
	function realState() {
		return (state.connected && state.realFacelets) ? state.realFacelets : null;
	}

	/* ---------------- 设置 ---------------- */
	function loadSettings() {
		try {
			var raw = localStorage.getItem(SETTINGS_KEY);
			if (raw) {
				var s = JSON.parse(raw);
				if (typeof s.colorFace === 'number') { state.colorFace = s.colorFace; }
				if (typeof s.steps === 'number') { state.steps = s.steps; }
			}
		} catch (e) { /* ignore */ }
		// URL 参数优先：?color=0-5&steps=1-8
		try {
			var q = new URLSearchParams(location.search);
			if (q.has('color')) { state.colorFace = Math.max(0, Math.min(5, Number(q.get('color')) || 0)); }
			if (q.has('steps')) { state.steps = Math.max(1, Math.min(8, Number(q.get('steps')) || 5)); }
		} catch (e) { /* ignore */ }
	}
	function saveSettings() {
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify({
				colorFace: state.colorFace, steps: state.steps
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
	}

	function syncPickers() {
		Array.prototype.forEach.call(el.colorPicker.children, function (b) {
			b.classList.toggle('isActive', Number(b.dataset.color) === state.colorFace);
		});
		Array.prototype.forEach.call(el.stepsPicker.children, function (b) {
			b.classList.toggle('isActive', Number(b.dataset.step) === state.steps);
		});
		el.crossTargetHint.textContent = '目标：' + COLOR_NAME[state.colorFace] + '十字';
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
		/* 只有拿到蓝牙真实状态才能「从当前状态」出题；否则无从得知魔方实况，按复原态生成 */
		var real = realState();
		var cur = real || currentFacelets();
		var fromCurrent = !!real && !isSolvedState(real);
		var p = fromCurrent
			? E.generateFrom(cur, state.colorFace, crossFace(), state.steps, Math.random, { limit: 1200 })
			: E.generate(state.colorFace, crossFace(), state.steps, Math.random, { limit: 1200 });
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
		state.hinted = {};
		state.fixDone = [];
		state.prevCorr = [];
		recState.currentId = null;
		state.phase = state.connected ? 'scramble' : 'solve';
		state.lastPrevMoves = [];
		el.revealAll.dataset.all = '';
		el.revealAll.textContent = '看答案';
		el.solCount.textContent = '（' + p.solutions.length + ' 条 · ' + p.steps + ' 步）';
		renderScrambleSteps();
		el.scrambleMeta.textContent = p.scramble.length + ' 步打乱 · ' +
			(performance.now() - t0).toFixed(0) + 'ms' + (fromCurrent ? ' · 从当前状态' : '');
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
	 * - 青色当前步：有且仅有一个，位于半透明与紫的交界（打乱完成时无）
	 * 任何状态按当前公式继续转，最终都到达目标打乱状态。
	 */
	/* 检测被做掉的修正步：corr 序列恰好从上一帧的前缀缩短 = 前缀里的修正步已被做掉，
	   按插入位置记入 fixDone，列表里保留显示（半透明，同普通已完成步） */
	function collectDoneFixes(newCorr, k) {
		var prev = state.prevCorr;
		state.prevCorr = newCorr.slice();
		if (!prev || !prev.length || newCorr.length >= prev.length) { return; }
		var off = prev.length - newCorr.length;
		for (var i = 0; i < newCorr.length; i++) {
			if (prev[off + i] !== newCorr[i]) { return; } /* 非单纯缩短（如中途新增错拧），不记账 */
		}
		for (i = 0; i < off; i++) { state.fixDone.push({ pos: k, m: prev[i] }); }
	}

	function computeScrambleView() {
		var p = state.puzzle;
		var simp = E.simplifyMoves(state.allMoves);
		var k = 0;
		while (k < simp.length && k < p.scramble.length && simp[k] === p.scramble[k]) { k++; }
		var extra = simp.slice(k);
		var correcting = extra.length > 0 && k < p.scramble.length;
		var corr = [], rest = null, ri = 0;
		if (correcting) {
			corr = E.invertMoves(extra);
			rest = p.scramble.slice(k);
			var changed = true;
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
		}
		collectDoneFixes(corr, k);
		var items = [], i, fi = 0, fixes = state.fixDone;
		/* 已完成修正步按插入位置插回列表（pos = 插入时所处的打乱进度） */
		var flush = function (pos) {
			while (fi < fixes.length && fixes[fi].pos === pos) {
				items.push({ text: MOVES[fixes[fi].m], cls: 'scStep isDone' });
				fi++;
			}
		};
		if (correcting) {
			for (i = 0; i < k; i++) { flush(i); items.push({ text: MOVES[p.scramble[i]], cls: 'scStep isDone' }); }
			flush(k);
			for (i = 0; i < corr.length; i++) {
				items.push({ text: MOVES[corr[i]], cls: 'scStep' + (i === 0 ? ' isFix isCurrent' : ' isPending') });
			}
			for (i = ri; i < rest.length; i++) { items.push({ text: MOVES[rest[i]], cls: 'scStep isPending' }); }
		} else {
			for (i = 0; i < p.scramble.length; i++) {
				flush(i);
				items.push({ text: MOVES[p.scramble[i]], cls: 'scStep' + (i < k ? ' isDone' : ' isPending' + (i === k ? ' isCurrent' : '')) });
			}
			flush(p.scramble.length);
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
			adoptRealAsScrambled();
			ensureRecord();  // 打乱成功即计入记录（可能 0 条做对）
			renderMoves();
			flash(el.phaseChip);
		}
	}

	/* 以真实状态为准重算解法：蓝牙漏步/错位导致与预期打乱态不符时，
	   直接把魔方实际状态当作「打乱后状态」，保证给出的解法真能做出十字 */
	function adoptRealAsScrambled() {
		var p = state.puzzle;
		var real = realState();
		if (!p || !real) { return false; }
		if (sameFacelets(real, p.scrambleFacelets)) { return false; }
		var rebuilt = E.rebuildSolutions(real, state.colorFace, crossFace(), 1200);
		p.scrambleFacelets = real;
		p.steps = rebuilt.steps;
		p.solutions = rebuilt.solutions;
		p.solutionTexts = rebuilt.solutionTexts;
		p.stateCode = rebuilt.stateCode;
		state.userMoves = [];
		state.revealed = {};
		state.done = {};
		state.hinted = {};
		state.fixDone = [];
		state.prevCorr = [];
		recState.currentId = null;
		el.revealAll.dataset.all = '';
		el.revealAll.textContent = '看答案';
		el.solCount.textContent = '（' + p.solutions.length + ' 条 · ' + p.steps + ' 步）';
		renderSolutions();
		el.matchInfo.textContent = p.steps > 0
			? '已按魔方实际状态更新解法（' + p.steps + ' 步）'
			: '魔方当前已完成十字，无需再解';
		return true;
	}

	function currentFacelets() {
		var real = realState();
		if (real) { return real; }
		var p = state.puzzle;
		if (!p) { return E.solvedFacelets(); }
		if (state.phase === 'scramble') {
			/* 打乱阶段的实时状态 = 本题起点（可能非复原态）+ 已做转动 */
			var base = p.baseFacelets || E.solvedFacelets();
			return E.applyFaceletMoves(base, state.allMoves);
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
				if (state.done[idx]) { item.classList.add(state.hinted[idx] ? 'isHinted' : 'isDone'); }
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

	function markSolutionDone(idx, hinted) {
		if (state.done[idx]) { return; }
		state.done[idx] = true;
		if (hinted) { state.hinted[idx] = true; }
		var cls = hinted ? 'isHinted' : 'isDone';
		var items = el.solutions.querySelectorAll('.solItem');
		for (var i = 0; i < items.length; i++) {
			if (Number(items[i].dataset.index) === idx) {
				items[i].classList.add(cls);
				items[i].scrollIntoView({ block: 'nearest' });
			}
		}
	}

	/* ---------------- 用户转动 ---------------- */
	/* 真实状态与推演不符（漏步、中途手动改动）：连续两次确认后按实际状态重算解法 */
	function checkDrift() {
		var p = state.puzzle, real = realState();
		if (!p || !real) { state.drift = 0; return false; }
		if (sameFacelets(real, E.applyFaceletMoves(p.scrambleFacelets, state.userMoves))) {
			state.drift = 0;
			return false;
		}
		state.drift = (state.drift || 0) + 1;
		if (state.drift < 2) { return false; }
		state.drift = 0;
		return adoptRealAsScrambled();
	}

	function addUserMove(m) {
		state.userMoves.push(m);
		if (checkDrift()) {
			renderMoves();
			return;
		}
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
		syncRecordCubeMove(m);
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
			/* 完成时该解法已处于显示状态 → 紫色标记，记录里算普通未完成解法 */
			var wasRevealed = !!state.revealed[hit];
			markSolutionDone(hit, wasRevealed);
			markRecordResult(p.solutionTexts[hit], wasRevealed);
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

	/* 断开清理：硬件掉线（事件回调）与主动断开共用。
	   注意 GiikerCube.stop() 会先摘掉 gattserverdisconnected 监听再断开，
	   事件回调不会派发 → 主动断开必须手动调这里 */
	function handleBtDisconnected() {
		state.connected = false;
		state.phase = 'solve';
		state.realFacelets = null;
		state.pendingRealSync = false;
		el.connectBtn.textContent = '连接魔方';
		el.connectBtn.classList.remove('isActive');
		setBtStatus('已断开', 'off');
		updatePhaseChip();
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
			if (info === 'disconnect') { handleBtDisconnected(); }
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
			handleBtDisconnected(); /* stop() 不派发 disconnect 事件，必须手动清理 */
			return;
		}
		el.connectBtn.disabled = true;
		setBtStatus('等待选择设备…', 'off');
		state.ignoreMoves = true;
		state.lastPrevMoves = [];
		/* 必须提前：连接成功后硬件 readValue 的状态回调可能先于 init() 的 then 到达，
		   若到时 pendingRealSync/connected 还没置位，「重新出题」会推迟到转第一下才发生 */
		state.pendingRealSync = true;
		state.connected = true;
		window.GiikerCube.init().then(function () {
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
			state.connected = false;
			state.pendingRealSync = false;
			state.ignoreMoves = false;
			el.connectBtn.disabled = false;
			setBtStatus('连接失败：' + String((err && err.message) || err), 'err');
		});
	}

	function normMove(raw) {
		var t = String(raw || '').replace(/[’‘`]/g, "'").replace(/\s+/g, '');
		var idx = MOVES.indexOf(t.toUpperCase());
		return idx;
	}

	/* 硬件历史（最新在前）→ move 索引数组 */
	function parseHistory(prevMoves) {
		var cur = [];
		for (var i = 0; prevMoves && i < prevMoves.length; i++) {
			var m = normMove(prevMoves[i]);
			if (m >= 0) { cur.push(m); }
		}
		return cur;
	}

	/* 从硬件上报的历史里取出新增的转动（历史数组最新在前） */
	function extractNewMoves(prevMoves) {
		var cur = parseHistory(prevMoves);
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

	/* 同步硬件上报的真实状态。返回 true 表示本次回调已被消费（不应再补记转动） */
	function syncRealFacelets(real, prevMoves) {
		if (!real) { return false; }
		var first = !state.realFacelets;
		state.realFacelets = real;
		if (state.pendingRealSync) {
			state.pendingRealSync = false;
			state.lastPrevMoves = parseHistory(prevMoves).slice(0, 12);
			/* 连上的魔方多半不在复原态：按它的真实状态重新出题 */
			newPuzzle();
			renderCubeNet(currentFacelets());
			return true;
		}
		if (first) { renderCubeNet(real); }
		/* 真实状态已到达目标打乱态：直接判定完成，不受累积转动记录是否完整影响 */
		var p = state.puzzle;
		if (state.connected && p && state.phase === 'scramble' && sameFacelets(real, p.scrambleFacelets)) {
			state.allMoves = p.scramble.slice();
			updateScrambleProgress();
			renderScrambleSteps();
			updatePhaseChip();
			/* 本事件被消费、不再走 addRawMove → 网格要在这里补画，
			   否则打乱尾步的实时状态上不了屏，网格会停在倒数第二步 */
			renderCubeNet(currentFacelets());
			/* 本事件（打乱尾步）已消费：phase 已切 solve，
			   不能再 return false 让 extractNewMoves 把它记进「我的转动」 */
			return true;
		}
		return false;
	}

	function onCubeCallback(facelet, prevMoves, lastTs, hardware) {
		if (hardware) { state.deviceName = String(hardware); }
		/* 真实状态永远优先同步（即便此刻还在忽略转动的窗口内） */
		var consumed = syncRealFacelets(E.faceletsFromColorString(facelet), prevMoves);
		if (state.ignoreMoves || consumed) {
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
			state.fixDone = [];
			state.prevCorr = [];
			el.matchInfo.textContent = '';
			/* 连着魔方时「清空」= 以魔方实际状态重新来一道 */
			if (state.connected && state.realFacelets) { newPuzzle(); return; }
			if (state.connected) { state.phase = 'scramble'; }
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
			if (k === 'Escape' && recCube.open) {
				ev.preventDefault();
				closeRecordCube();
				return;
			}
			if (k === ' ' && !recCube.open) {
				ev.preventDefault();
				newPuzzle();
				return;
			}
			if (k === 'Backspace' && !recCube.open) {
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

	/* ---------------- 记录（历史） ---------------- */
	var RECORDS_KEY = 'crossRecords';
	function recordScope() {
		return window.getCurrentSiteScope ? window.getCurrentSiteScope() : 'Cube-Cross';
	}
	var recState = {
		list: [],        // 全部记录
		filter: 0,       // 0 = 全部，1-8 = 按步数筛选
		expanded: {},    // 展开的记录 id（仅本页会话）
		currentId: null, // 当前题对应的记录 id
		cloudOn: false,  // 已登录（可云同步）
		pushTimer: 0
	};

	function findRecord(id) {
		for (var i = 0; i < recState.list.length; i++) {
			if (recState.list[i].id === id) { return recState.list[i]; }
		}
		return null;
	}

	/* 垃圾桶图标：确认态与普通态同图标，仅颜色不同（isArm 红） */
	var TRASH_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

	function loadRecords() {
		try {
			var raw = localStorage.getItem(RECORDS_KEY);
			var list = raw ? JSON.parse(raw) : [];
			recState.list = Array.isArray(list) ? list : [];
		} catch (e) { recState.list = []; }
	}

	function saveRecords(cloud) {
		try { localStorage.setItem(RECORDS_KEY, JSON.stringify(recState.list)); } catch (e) { /* ignore */ }
		if (cloud) { pushRecords(); }
	}

	function filteredRecords() {
		var out = [];
		for (var i = 0; i < recState.list.length; i++) {
			if (recState.list[i].del) { continue; } // 已删除（墓碑）：不展示、不计分，但保留参与云同步
			if (!recState.filter || recState.list[i].steps === recState.filter) { out.push(recState.list[i]); }
		}
		out.sort(function (a, b) { return (b.mut || 0) - (a.mut || 0); });
		return out;
	}

	/* 打乱成功即给当前题建档：只记解法文本与标记，不记打乱和朝向 */
	function ensureRecord() {
		var p = state.puzzle;
		if (!p) { return null; }
		var rec = recState.currentId ? findRecord(recState.currentId) : null;
		if (rec) { return rec; }
		rec = {
			id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36),
			ts: Date.now(),
			mut: Date.now(),
			steps: p.steps,
			color: state.colorFace,
			solutions: p.solutionTexts.slice(),
			done: [],
			hinted: [],
			starred: []
		};
		recState.list.push(rec);
		recState.currentId = rec.id;
		saveRecords(true);
		renderRecords();
		return rec;
	}

	/* 完成解法：成功（青✓计分）或看答案做出（紫✓不计分） */
	function markRecordResult(text, hinted) {
		var rec = ensureRecord();
		if (!rec) { return; }
		var doneAt = rec.done.indexOf(text);
		var hintAt = (rec.hinted || []).indexOf(text);
		if (hinted && hintAt < 0) {
			if (doneAt >= 0) { rec.done.splice(doneAt, 1); }
			rec.hinted.push(text);
			rec.mut = Date.now();
			saveRecords(true);
			renderRecords();
		} else if (!hinted && doneAt < 0) {
			if (hintAt >= 0) { rec.hinted.splice(hintAt, 1); }
			rec.done.push(text);
			rec.mut = Date.now();
			saveRecords(true);
			renderRecords();
		}
	}

	function toggleRecordStar(recId, text) {
		var rec = findRecord(recId);
		if (!rec) { return; }
		var at = rec.starred.indexOf(text);
		if (at >= 0) { rec.starred.splice(at, 1); } else { rec.starred.push(text); }
		rec.mut = Date.now();
		saveRecords(true);
		renderRecords();
	}

	function fmtRecTime(ts) {
		var d = new Date(ts);
		var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
		return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
	}

	function renderRecFilters() {
		var box = el.recFilters;
		box.innerHTML = '';
		var mk = function (label, value) {
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'recChip';
			b.textContent = label;
			b.classList.toggle('isActive', recState.filter === value);
			b.addEventListener('click', function () {
				recState.filter = value;
				renderRecords();
			});
			box.appendChild(b);
		};
		mk('全部', 0);
		for (var n = 1; n <= 8; n++) { mk(String(n), n); }
	}

	function renderRecScore() {
		var list = filteredRecords();
		var total = 0, score = 0;
		for (var i = 0; i < list.length; i++) {
			total += list[i].solutions.length * list[i].steps;
			score += list[i].done.length * list[i].steps;
		}
		el.recScore.textContent = total
			? score + '/' + total + ' ' + Math.round(score / total * 100) + '%'
			: '—';
	}

	function renderRecList() {
		var box = el.recList;
		box.innerHTML = '';
		var alive = 0;
		for (var k = 0; k < recState.list.length; k++) { if (!recState.list[k].del) { alive++; } }
		el.recCount.textContent = alive ? '（' + alive + '）' : '';
		var list = filteredRecords();
		if (!list.length) {
			var empty = document.createElement('div');
			empty.className = 'recEmpty';
			empty.textContent = '打乱成功后自动记录';
			box.appendChild(empty);
			return;
		}
		for (var i = 0; i < list.length; i++) { box.appendChild(buildRecItem(list[i])); }
	}

	function buildRecItem(rec) {
		var item = document.createElement('div');
		item.className = 'recItem' + (recState.expanded[rec.id] ? ' isExpanded' : '');

		var head = document.createElement('div');
		head.className = 'recItemHead';
		var time = document.createElement('span');
		time.className = 'recTime';
		time.textContent = fmtRecTime(rec.ts);
		var steps = document.createElement('span');
		steps.className = 'recSteps';
		steps.textContent = rec.steps + '步';
		var ratio = document.createElement('span');
		ratio.className = 'recRatio';
		ratio.textContent = rec.done.length + '/' + rec.solutions.length;
		var chevron = document.createElement('span');
		chevron.className = 'recChevron';
		chevron.textContent = '▾';
		head.appendChild(time);
		head.appendChild(steps);
		head.appendChild(ratio);
		head.appendChild(chevron);
		/* 删除：首次点击进入确认态（✓ 红），再次点击才删；2.5s 后自动解除 */
		var del = document.createElement('button');
		del.type = 'button';
		del.className = 'recDelBtn';
		del.innerHTML = TRASH_SVG;
		del.title = '删除记录';
		del.addEventListener('click', function (ev) {
			ev.stopPropagation();
			if (del.dataset.arm !== '1') {
				del.dataset.arm = '1';
				del.classList.add('isArm');
				window.setTimeout(function () {
					if (del.isConnected && del.dataset.arm === '1') {
						del.dataset.arm = '';
						del.classList.remove('isArm');
					}
				}, 2500);
				return;
			}
			rec.del = 1;
			rec.mut = Date.now();
			if (recState.currentId === rec.id) { recState.currentId = null; }
			saveRecords(true);
			renderRecords();
		});
		head.appendChild(del);
		head.addEventListener('click', function () {
			recState.expanded[rec.id] = !recState.expanded[rec.id];
			item.classList.toggle('isExpanded', !!recState.expanded[rec.id]);
		});
		item.appendChild(head);

		var sols = document.createElement('div');
		sols.className = 'recSols';
		for (var i = 0; i < rec.solutions.length; i++) {
			(function (text) {
				var row = document.createElement('div');
				if (rec.done.indexOf(text) >= 0) { row.className = 'recSol isDone'; }
				else if ((rec.hinted || []).indexOf(text) >= 0) { row.className = 'recSol isHinted'; }
				else { row.className = 'recSol'; }
				var txt = document.createElement('span');
				txt.className = 'recSolText';
				txt.textContent = text;
				txt.title = '查看 3D 状态';
				txt.addEventListener('click', function () { openRecordCube(rec, text); });
				var star = document.createElement('button');
				star.type = 'button';
				star.className = 'recStarBtn' + (rec.starred.indexOf(text) >= 0 ? ' isActive' : '');
				star.textContent = rec.starred.indexOf(text) >= 0 ? '★' : '☆';
				star.title = '星标';
				star.addEventListener('click', function (ev) {
					ev.stopPropagation();
					toggleRecordStar(rec.id, text);
				});
				row.appendChild(txt);
				row.appendChild(star);
				sols.appendChild(row);
			})(rec.solutions[i]);
		}
		item.appendChild(sols);
		return item;
	}

	function renderRecStars() {
		var box = el.recStars;
		box.innerHTML = '';
		var list = filteredRecords();
		var items = [];
		for (var i = 0; i < list.length; i++) {
			for (var j = 0; j < list[i].starred.length; j++) {
				items.push({ rec: list[i], text: list[i].starred[j] });
			}
		}
		el.recStarsCount.textContent = items.length ? '（' + items.length + '）' : '';
		for (var k = 0; k < items.length; k++) {
			(function (it) {
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'recStarItem';
				b.textContent = '★ ' + it.text;
				b.title = '查看 3D 状态';
				b.addEventListener('click', function () { openRecordCube(it.rec, it.text); });
				box.appendChild(b);
			})(items[k]);
		}
		if (window.requestAnimationFrame) { window.requestAnimationFrame(layoutRecStars); }
	}

	/* 星标两栏：某条在一栏里放不下，就独占一整行 */
	function layoutRecStars() {
		var items = el.recStars.querySelectorAll('.recStarItem');
		for (var i = 0; i < items.length; i++) {
			items[i].classList.remove('isFull');
			if (items[i].scrollWidth > items[i].clientWidth + 1) {
				items[i].classList.add('isFull');
			}
		}
	}

	function renderRecords() {
		renderRecFilters();
		renderRecScore();
		renderRecList();
		renderRecStars();
	}

	/* ---------------- 记录云同步（Supabase user_data · site_scope 由共享 site-scope 提供） ---------------- */
	function setRecCloud(text) {
		if (el.recCloud) { el.recCloud.textContent = text; }
	}

	function initRecordCloud() {
		if (!window.authManager) { setRecCloud('本地'); return; }
		window.authManager.onAuthStateChange(function (user) {
			recState.cloudOn = !!user;
			if (user) {
				setRecCloud('云端');
				pullRecords();
			} else {
				setRecCloud('本地');
			}
		});
	}

	function pullRecords() {
		var client = window.supabaseClient;
		var user = window.authManager && window.authManager.getUser();
		if (!client || !user) { return; }
		client.from('user_data')
			.select('data')
			.eq('user_id', user.id)
			.eq('site_scope', recordScope())
			.maybeSingle()
			.then(function (result) {
				if (result.error || !result.data || !result.data.data) { return; }
				var cloudList = result.data.data.records;
				if (Array.isArray(cloudList)) { mergeRecords(cloudList); }
			})['catch'](function () { /* ignore */ });
	}

	function mergeRecords(cloudList) {
		var byId = {};
		var i;
		for (i = 0; i < recState.list.length; i++) { byId[recState.list[i].id] = recState.list[i]; }
		var changed = false;
		for (i = 0; i < cloudList.length; i++) {
			var r = cloudList[i];
			if (!r || !r.id) { continue; }
			if (!byId[r.id] || (r.mut || 0) > (byId[r.id].mut || 0)) {
				byId[r.id] = r;
				changed = true;
			}
		}
		if (changed) {
			recState.list = Object.keys(byId).map(function (k) { return byId[k]; });
			saveRecords(false);
			renderRecords();
		}
	}

	function pushRecords() {
		if (!recState.cloudOn || !window.supabaseClient || !window.authManager) { return; }
		var user = window.authManager.getUser();
		if (!user) { return; }
		if (recState.pushTimer) { window.clearTimeout(recState.pushTimer); }
		recState.pushTimer = window.setTimeout(function () {
			recState.pushTimer = 0;
			window.supabaseClient
				.from('user_data')
				.upsert({
					user_id: user.id,
					site_scope: recordScope(),
					data: { version: 1, exportedAt: new Date().toISOString(), records: recState.list },
					updated_at: new Date().toISOString()
				}, { onConflict: 'user_id,site_scope' })
				.then(function (result) {
					setRecCloud(result.error ? '未同步' : '云端');
				})['catch'](function () { setRecCloud('未同步'); });
		}, 800);
	}

	/* ---------------- 记录 3D 预览（复用 Formula 的 twisty） ---------------- */
	var recCube = { open: false, scene: null, showAll: false, color: 0 };

	function twistyMove(m) {
		var face = E.FACES[(m / 3) | 0];                    // 'U''R''F''D''L''B'
		var pow = (m % 3 === 0) ? 1 : (m % 3 === 1 ? 2 : -1); // 顺 / 180 / 逆
		return [1, 1, face, pow];
	}

	function resizeSceneToStage(scene, stage) {
		if (!scene || !stage) { return; }
		var rect = stage.getBoundingClientRect();
		var child = stage.firstElementChild;
		if (child) {
			child.style.width = rect.width + 'px';
			child.style.height = rect.height + 'px';
		}
		if (scene.resize) { scene.resize(); }
	}

	function prepareStickerScene(scene) {
		if (!scene || !scene.getTwisty) { return; }
		var twisty = scene.getTwisty();
		if (!twisty || !twisty.cubePieces) { return; }
		var dimension = twisty.options.dimension;
		scene._customCubieByFacelet = {};
		for (var faceIndex = 0; faceIndex < twisty.cubePieces.length; faceIndex++) {
			var face = twisty.cubePieces[faceIndex];
			for (var stickerIndex = 0; stickerIndex < face.length; stickerIndex++) {
				var sticker = face[stickerIndex];
				var mesh = sticker[1].children[0];
				var fi = matrixToFaceletIndex(sticker[0], dimension);
				sticker[1]._customFaceletIndex = fi;
				sticker[1]._customCubieKey = cubieKeyOfMatrix(sticker[0], dimension);
				scene._customCubieByFacelet[fi] = sticker[1]._customCubieKey;
				mesh._customColoredMaterial = mesh.materials[0];
			}
		}
	}

	function matrixToFaceletIndex(matrix, dimension) {
		var xyXchg = [1, 0, 0, 1, 0, 0];
		var xInv = [1, -1, -1, -1, -1, -1];
		var yInv = [1, -1, 1, 1, 1, -1];
		var coord = [Math.round(matrix.n24), Math.round(matrix.n14), Math.round(matrix.n34)];
		var coordIndex = coord.indexOf(dimension) + coord.indexOf(-dimension) + 1;
		var axis = coordIndex + (coord[coordIndex] > 0 ? 0 : 3);
		coord.splice(coordIndex, 1);
		var xy = xyXchg[axis];
		var x = (coord[xy] * xInv[axis] + dimension - 1) / 2;
		var y = (coord[1 - xy] * yInv[axis] + dimension - 1) / 2;
		return axis * dimension * dimension + x * dimension + y;
	}

	/* 贴纸所在块的中心坐标（把法向分量从 ±dimension 收回到块中心） */
	function cubieKeyOfMatrix(matrix, dimension) {
		var c = [Math.round(matrix.n14), Math.round(matrix.n24), Math.round(matrix.n34)];
		for (var i = 0; i < 3; i++) {
			if (c[i] === dimension) { c[i] = dimension - 1; }
			else if (c[i] === -dimension) { c[i] = -(dimension - 1); }
		}
		return c.join(',');
	}

	/* 只显示 5 个方块：十字面中心 + 4 条十字棱块（整块，含侧面色），共 9 个色块 */
	function crossPiecesMask(colorFace, scene) {
		var byFacelet = scene && scene._customCubieByFacelet;
		if (!byFacelet) { return crossColorMask(colorFace); }
		var edgeKeys = [];
		for (var p = 0; p < 9; p++) {
			if (p !== 4 && p % 2 === 1) {  // 十字面的 4 个棱位：1/3/5/7
				var key = byFacelet[colorFace * 9 + p];
				if (key) { edgeKeys.push(key); }
			}
		}
		var centerIndex = colorFace * 9 + 4;
		var mask = {};
		for (var i = 0; i < 54; i++) {
			var key = byFacelet[i];
			mask[i] = !(i === centerIndex || (key && edgeKeys.indexOf(key) >= 0));
		}
		return mask;
	}

	/* 兜底：按颜色隐藏（只看十字面色） */
	function crossColorMask(colorFace) {
		var mask = {};
		for (var i = 0; i < 54; i++) {
			if (((i / 9) | 0) !== colorFace) { mask[i] = true; }
		}
		return mask;
	}

	function applyHiddenMask(scene, mask) {
		if (!scene || !scene.getTwisty) { return; }
		var twisty = scene.getTwisty();
		if (!twisty || !twisty.cubePieces) { return; }
		if (!scene._customHiddenMaterial) {
			scene._customHiddenMaterial = new THREE.MeshBasicMaterial({
				color: 0x9aa0aa, opacity: 0.28, transparent: true
			});
		}
		for (var faceIndex = 0; faceIndex < twisty.cubePieces.length; faceIndex++) {
			var face = twisty.cubePieces[faceIndex];
			for (var stickerIndex = 0; stickerIndex < face.length; stickerIndex++) {
				var sticker = face[stickerIndex][1];
				var mesh = sticker.children[0];
				if (mask && mask[sticker._customFaceletIndex]) {
					mesh.materials[0] = scene._customHiddenMaterial;
				} else if (mesh._customColoredMaterial) {
					mesh.materials[0] = mesh._customColoredMaterial;
				}
			}
		}
		if (scene.render) { scene.render(); }
	}

	/* 通过解法反推状态：复原态 + 解法的逆 = 该解法的起点（与智能魔方状态无关） */
	function openRecordCube(rec, text) {
		if (!window.twistyjs || !window.THREE) { return; }
		recCube.open = true;
		recCube.showAll = false;
		recCube.color = rec.color;
		el.recModal.dataset.open = '1';
		el.recModal.setAttribute('aria-hidden', 'false');
		el.recModalMoves.textContent = text;
		el.recModalToggle.textContent = '显示全部';
		el.recModalToggle.classList.remove('isActive');

		el.recModalStage.innerHTML = '';
		var scene = new window.twistyjs.TwistyScene();
		recCube.scene = scene;
		el.recModalStage.appendChild(scene.getDomElement());
		scene.initializeTwisty({
			type: 'cube',
			dimension: 3,
			stickerWidth: 1.72,
			scale: 0.96,
			allowDragging: false,
			faceColors: [0xffffff, 0xf05a3b, 0x2dbb70, 0xffd447, 0xff941f, 0x2f69df]
		});
		prepareStickerScene(scene);
		var inv = E.invertMoves(E.textToMoves(text));
		var moves = [];
		for (var i = 0; i < inv.length; i++) { moves.push(twistyMove(inv[i])); }
		if (moves.length) { scene.applyMoves(moves); }
		applyHiddenMask(scene, crossPiecesMask(rec.color, scene));
		resizeSceneToStage(scene, el.recModalStage);
	}

	function closeRecordCube() {
		recCube.open = false;
		recCube.scene = null;
		el.recModal.dataset.open = '';
		el.recModal.setAttribute('aria-hidden', 'true');
		el.recModalStage.innerHTML = '';
	}

	function toggleRecordCubeAll() {
		recCube.showAll = !recCube.showAll;
		el.recModalToggle.textContent = recCube.showAll ? '只看十字' : '显示全部';
		el.recModalToggle.classList.toggle('isActive', recCube.showAll);
		if (recCube.scene) {
			applyHiddenMask(recCube.scene, recCube.showAll ? {} : crossPiecesMask(recCube.color, recCube.scene));
		}
	}

	/* 智能魔方 / 键盘的转动同步到预览魔方 */
	function syncRecordCubeMove(m) {
		if (!recCube.open || !recCube.scene) { return; }
		recCube.scene.addMoves([twistyMove(m)]);
	}

	/* 拖动旋转视角（参考 Formula 的 customCube 拖动实现） */
	function bindRecordCubeDrag() {
		var stage = el.recModalStage;
		var drag = { active: false, x: 0, y: 0, yaw: 0, pitch: 0 };
		stage.addEventListener('pointerdown', function (event) {
			if (event.button !== 0 || !recCube.scene || !recCube.scene.setViewDrag) { return; }
			drag.active = true;
			drag.x = event.clientX;
			drag.y = event.clientY;
			var vs = recCube.scene.getViewState ? recCube.scene.getViewState() : { dragTheta: 0, dragPhi: 0 };
			drag.yaw = vs.dragTheta;
			drag.pitch = vs.dragPhi;
			if (stage.setPointerCapture) {
				try { stage.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
			}
			event.preventDefault();
		});
		stage.addEventListener('pointermove', function (event) {
			if (!drag.active || !recCube.scene || !recCube.scene.setViewDrag) { return; }
			var dx = event.clientX - drag.x;
			var dy = event.clientY - drag.y;
			var rect = stage.getBoundingClientRect();
			var scale = (Math.PI / 4) / Math.max(140, Math.min(rect.width, rect.height) * 0.45);
			var yaw = drag.yaw - dx * scale;
			var pitch = drag.pitch + dy * scale;
			var length = Math.sqrt(yaw * yaw + pitch * pitch);
			var limit = Math.PI / 4;
			if (length > limit) {
				yaw = yaw / length * limit;
				pitch = pitch / length * limit;
			}
			recCube.scene.setViewDrag(yaw, pitch);
			event.preventDefault();
		});
		var finish = function () { drag.active = false; };
		stage.addEventListener('pointerup', finish);
		stage.addEventListener('pointercancel', finish);
	}

	/* ---------------- 初始化 ---------------- */
	function init() {
		['colorPicker', 'stepsPicker', 'scrambleText', 'scrambleMeta', 'copyScramble',
			'newScramble', 'cubeNet', 'cubeTitle', 'crossTargetHint', 'cubeBtn', 'cubePopWrap', 'cubePop', 'solutions', 'solCount', 'revealAll',
			'undoMoves', 'copyUndo', 'moveInput', 'applyMoves', 'resetMoves',
			'phaseChip', 'matchInfo', 'connectBtn', 'btStatus', 'btDot',
			'recCount', 'recScore', 'recFilters', 'recCloud', 'recList', 'recStars', 'recStarsCount',
			'recModal', 'recModalMask', 'recModalStage', 'recModalMoves', 'recModalToggle', 'recModalClose'].forEach(function (id) {
				el[id] = $(id);
			});

		loadSettings();
		buildPickers();
		syncPickers();
		buildCubeNet();
		bindInput();
		loadRecords();
		renderRecords();
		/* 站点导航栏：authManager.init 由 nav 触发，须在记录云同步之前 */
		if (window.siteNav && typeof window.siteNav.init === 'function') {
			window.siteNav.init({});
		}
		initRecordCloud();

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
			if (recCube.open) { resizeSceneToStage(recCube.scene, el.recModalStage); layoutRecStars(); }
		});
		el.recModalClose.addEventListener('click', closeRecordCube);
		el.recModalMask.addEventListener('click', closeRecordCube);
		el.recModalToggle.addEventListener('click', toggleRecordCubeAll);
		bindRecordCubeDrag();
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

	window.CrossApp = {
		initBluetooth: initBluetooth, state: state, newPuzzle: newPuzzle, applyInputText: applyInputText, E: E,
		onCubeCallback: onCubeCallback, syncRealFacelets: syncRealFacelets, adoptRealAsScrambled: adoptRealAsScrambled,
		recState: recState, recCube: recCube, openRecordCube: openRecordCube, closeRecordCube: closeRecordCube,
		toggleRecordStar: toggleRecordStar, renderRecords: renderRecords
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
