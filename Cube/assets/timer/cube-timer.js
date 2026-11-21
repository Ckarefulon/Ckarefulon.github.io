/*
 * Cube 计时训练台（公用）
 * ---------------------------------------------------------------------------
 * 「计时 + 阶段进度 + 实时数据 + 动作流 + 屏幕魔方 + 蓝牙起停」这一套的公用逻辑。
 * 训练场（Cube/Trainer）用它。
 *
 * 职责边界：
 *   · 本模块负责计时状态机、阶段分段、实时数据、动作流、蓝牙起停判定；
 *   · 出题（打乱/案例）、成绩存储、页面排版由调用页负责，通过 options 注入；
 *   · 蓝牙这一层**不再由本模块自己加载适配器**：统一走共用桥
 *     /Cube/assets/bluetooth/smartcube-bridge.js（window.CubeSmartCube），
 *     与 Analyzer 用的是同一份实现，避免两处各养一套「加载顺序 + 面位差分」。
 *
 * 起停口径（与用户确认）：
 *   · 起表用「智能魔方直接拧」→ 停表也用智能魔方状态识别（到达终点节点自动停）；
 *   · 起表用手动（空格/按钮）→ 即使连着蓝牙也必须手动停表，
 *     停表后校验状态，没到终点节点判 DNF。
 *
 * 依赖：TrainerCommon.FaceletUtil（引擎口径）、CubeStages（节点判定）、
 *       CubeSmartCube（蓝牙桥，可选）、CubeNet（屏幕魔方，可选）。
 */
(function (root) {
	'use strict';

	var F = root.TrainerCommon && root.TrainerCommon.FaceletUtil;
	var CS = root.CubeStages;

	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) { e.className = cls; }
		if (text != null) { e.textContent = text; }
		return e;
	}
	function fmt(t) {
		if (t == null || !isFinite(t) || t < 0) { return "--"; }
		if (t < 60) { return t.toFixed(2); }
		var m = Math.floor(t / 60), r = t - m * 60;
		return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2);
	}

	/* ================= 蓝牙接入 =================
	 * 薄转发层：真正的连线 / 差分 / 中层识别都在 CubeSmartCube 里。
	 * 这里只把桥的事件转成计时台能用的形状，并保留一个「桥没加载也能用」
	 * 的降级面（页面照常手动计时）。 */
	var btBridge = null;
	function bridge() {
		if (!btBridge && root.CubeSmartCube) { btBridge = root.CubeSmartCube; }
		return btBridge;
	}
	function requiresBridge() {
		var b = bridge();
		if (!b) {
			throw new Error('蓝牙桥未加载（/Cube/assets/bluetooth/smartcube-bridge.js）');
		}
		return b;
	}
	var btListeners = { connect: null, disconnect: null, state: null, move: null, connecting: null };

	function bindBridge() {
		var b = bridge();
		if (!b || b.__ctBound) { return; }
		b.__ctBound = true;
		b.on('connecting', function () { if (btListeners.connecting) { btListeners.connecting(); } });
		b.on('connect', function (d) { if (btListeners.connect) { btListeners.connect(d); } });
		b.on('disconnect', function () { if (btListeners.disconnect) { btListeners.disconnect(); } });
		b.on('state', function (d) { if (btListeners.state) { btListeners.state(d); } });
		b.on('move', function (d) { if (btListeners.move) { btListeners.move(d); } });
	}

	var btApi = {
		isSupported: function () { return !!(root.navigator && navigator.bluetooth); },
		isConnected: function () { var b = bridge(); return !!(b && b.isConnected()); },
		isConnecting: function () { var b = bridge(); return !!(b && b.isConnecting()); },
		deviceName: function () { var b = bridge(); return (b && b.getDeviceName()) || '智能魔方'; },
		facelet: function () { var b = bridge(); return (b && b.getFacelet()) || ''; },
		isSolved: function (s) {
			var b = bridge();
			return b ? b.isSolved(s) : false;
		},
		/* 事件类型：connect / disconnect / connecting / state / move */
		on: function (type, fn) {
			if (!(type in btListeners)) { return; }
			btListeners[type] = fn;
			bindBridge();
		},
		connect: function () {
			return Promise.resolve().then(function () {
				return requiresBridge().connect();
			});
		},
		disconnect: function () {
			var b = bridge();
			return b ? b.disconnect() : Promise.resolve();
		},
		/* 预加载适配层（不弹选设备框）：页面空闲时调一下，首次点「连接魔方」就不用等 */
		preload: function () {
			var b = bridge();
			return (b && b.ensureLoaded) ? b.ensureLoaded() : Promise.resolve(false);
		}
	};

	/* ================= 训练台实例 =================
	 * opts:
	 *   mount       {object}    各 DOM 宿主（见下方 resolveMounts）
	 *   path        {string[]}  节点 id 路径，[起点, 中间..., 终点]
	 *   frame       {object}    参考系 {bottom, front}（六色底）
	 *   judgeStart  {function}  可选：自定义起点判定
	 *   onFinish    {function}  一段完整成绩的回调（含分段）
	 *   onPhase     {function}  阶段变化回调
	 *   cubeNet     {boolean}   是否渲染屏幕魔方（默认 true）
	 *   keyboard    {boolean}   是否渲染 18 键（默认 false，输入框为主）
	 *   startFacelet {string}   初始状态（打乱态），由调用页给出
	 */
	function create(opts) {
		opts = opts || {};
		var M = resolveMounts(opts.mount || {});
		var path = (opts.path || []).slice();
		var frame = opts.frame || { bottom: "D", front: "F" };

		var st = {
			phase: "ready",          /* ready | running | done | dnf */
			startT: 0,
			elapsed: 0,
			raf: 0,
			poll: 0,
			timingMode: "pending",   /* pending | manual | state */
			startFacelet: opts.startFacelet || F.SOLVED,
			curFacelet: opts.startFacelet || F.SOLVED,
			segTimes: [],            /* 每段用时（秒），长度 = path.length-1 */
			segMarks: [],            /* 每段结束时的时间戳（ms，相对起表） */
			doneSegs: 0,             /* 已经结算完的段数（segTimes 的下一个空位） */
			live: { turns: 0, tps: 0, moves: [] },
			dnf: false,
			dnfReason: ""
		};

		/* ---- 阶段进度渲染 ---- */
		function nodeName(id) {
			var n = CS && CS.nodeById(id);
			return n ? n.name : id;
		}
		function renderStageBar() {
			if (!M.stageBar) { return; }
			M.stageBar.innerHTML = "";
			if (path.length < 2) { return; }
			/* 只读推进状态，绝不在这里改 st.doneSegs —— 分段的账由 recordSegments 记。 */
			var idx = CS ? CS.progressIndex(path, st.curFacelet, frame) : 0;
			for (var i = 1; i < path.length; i++) {
				if (i > 1) {
					M.stageBar.appendChild(el("span", "ctStageSegArrow", "\u203a"));
				}
				var seg = el("div", "ctStageSeg");
				var state;
				if (i <= idx) { state = "done"; }
				else if (i === idx + 1) { state = "current"; }
				else { state = ""; }
				seg.dataset.state = state;
				var time = st.segTimes[i - 1];
				if (state === "current" && st.phase === "running") {
					time = st.elapsed - (st.segMarks[i - 2] || 0) / 1000;
				}
				seg.appendChild(el("span", "ctStageSegName", nodeName(path[i - 1]) + " \u2192 " + nodeName(path[i])));
				seg.appendChild(el("span", "ctStageSegTime", time != null ? fmt(time) : "\u2014"));
				M.stageBar.appendChild(seg);
			}
		}

		/* ---- 实时数据 ---- */
		function renderLive() {
			if (!M.liveTurns) { return; }
			M.liveTurns.textContent = String(st.live.turns);
			if (M.liveTps) { M.liveTps.textContent = st.live.tps ? st.live.tps.toFixed(2) : "\u2014"; }
			if (M.moves) {
				M.moves.innerHTML = "";
				var recent = st.live.moves.slice(-28);
				if (!recent.length) {
					M.moves.appendChild(el("span", "ctMovesEmpty", "转动会显示在这里"));
				} else {
					for (var i = 0; i < recent.length; i++) {
						M.moves.appendChild(el("span", "ctMoveChip" + (i === recent.length - 1 ? " latest" : ""), recent[i]));
					}
				}
			}
		}

		/* ---- 屏幕魔方 ---- */
		function renderCube() {
			if (!M.net || !root.CubeNet) { return; }
			root.CubeNet.render(M.net, F.toNumeric(st.curFacelet), {
				faceIndex: F.FACE_INDEX,
				colorOfFace: F.COLOR_OF_FACE
			});
		}

		/* ---- 计时 ---- */
		function tick() {
			if (st.phase !== "running") { return; }
			st.elapsed = (performance.now() - st.startT) / 1000;
			if (M.timer) { M.timer.textContent = fmt(st.elapsed); }
			st.live.tps = st.elapsed > 0 ? st.live.turns / st.elapsed : 0;
			renderLive();
			renderStageBar();
			st.raf = requestAnimationFrame(tick);
		}
		function stopTimers() {
			if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
			if (st.poll) { clearInterval(st.poll); st.poll = 0; }
		}

		function setPhase(p, label) {
			st.phase = p;
			if (M.timerBox) { M.timerBox.dataset.phase = p; }
			if (M.phase) { M.phase.dataset.phase = p; M.phase.textContent = label; }
			if (opts.onPhase) { opts.onPhase(p); }
		}

		/* ---- 起点：把路径第一段之前的状态视为已达成 ---- */
		function startRun(mode) {
			if (st.phase === "running") { return false; }
			st.phase = "running";
			st.timingMode = mode;         /* manual | state */
			st.startT = performance.now();
			st.elapsed = 0;
			st.segTimes = [];
			st.segMarks = [];
			st.live = { turns: 0, tps: 0, moves: [] };
			st.dnf = false;
			st.dnfReason = "";
			/* 起表时结算「起表瞬间已经满足的前缀段」。
			 *
			 * 下标口径（关键，曾经差一）：progressIndex 返回的是「已满足的节点数」，
			 * 而段数 = 节点数 - 1。路的第一个节点是起点标记（几乎总是满足的），
			 * 所以「满足 n 个节点」= 「已完成 n-1 段」。这里把已完成的前缀段
			 * 记成 0 秒，用户只被计到「从当前真实位置往下拧」用的时间。 */
			st.doneSegs = 0;
			if (CS) {
				var reachedNodes = CS.progressIndex(path, st.curFacelet, frame);
				var preDone = Math.max(0, Math.min(reachedNodes, path.length) - 1);
				for (var s = 0; s < preDone; s++) {
					st.segMarks[s] = 0;
					st.segTimes[s] = 0;
				}
				st.doneSegs = preDone;
			}
			if (M.timer) { M.timer.textContent = "0.00"; }
			setPhase("running", mode === "state" ? "计时中 · 魔方起停" : "计时中 · 手动停表");
			renderLive();
			renderStageBar();
			st.raf = requestAnimationFrame(tick);
			st.poll = setInterval(judgeNow, 60);
			return true;
		}

		/* ---- 判定：达到终点节点 ---- */
		function endNodeId() { return path.length ? path[path.length - 1] : ""; }
		function reachedEnd(f) {
			var id = endNodeId();
			if (!id) { return false; }
			return CS ? CS.doneAt(id, f, frame) : false;
		}

		/* 中途分段：按顺序把经过的中间节点打上时间戳。
		 *
		 * 下标口径（很容易搞错，写清楚）：
		 *   path = [n0, n1, ..., n_{k}]  共 k 段，第 i 段 = n_i → n_{i+1}（i 从 0 起）。
		 *   segTimes[i] = 第 i 段的用时；st.doneSegs = 已经结算完的段数。
		 *   已经到达 path[j] 意味着前 j 段都完成了，所以 doneSegs 应推进到 j。
		 *
		 * 用时一律取「当前真实用时」而不是 st.elapsed —— st.elapsed 只在 rAF 的 tick()
		 * 里推进，而输入法驱动（一次性重放多步）或蓝牙批量上报时，判定可能在同一帧内
		 * 连续发生，读 st.elapsed 会拿到 0（曾经因此把分段记成 0.00s）。 */
		function nowElapsed() {
			if (st.phase !== "running") { return st.elapsed; }
			return Math.max(0, (performance.now() - st.startT) / 1000);
		}
		function recordSegments(f) {
			if (!CS || path.length < 2) { return; }
			/* progressIndex 给的是「已满足的节点数」；已完成的段数 = 节点数 - 1。 */
			var reachedNodes = CS.progressIndex(path, f, frame);
			var target = Math.max(0, Math.min(reachedNodes, path.length) - 1);
			if (target <= st.doneSegs) { return; }
			var elapsed = nowElapsed();
			while (st.doneSegs < target) {
				var i = st.doneSegs;
				st.segMarks[i] = Math.round(elapsed * 1000);
				var from = i > 0 ? (st.segMarks[i - 1] || 0) : 0;
				st.segTimes[i] = Math.max(0, (st.segMarks[i] - from) / 1000);
				st.doneSegs++;
			}
		}

		/* 到终点（或停表）时把最后一段补上：最后一段的终点就是总用时。
		 * path 有 n 个节点就有 n-1 段；中间节点让前 n-2 段在途中就定下来了，
		 * 最后一段要等停表才有确定终点。 */
		function finalizeLastSegment() {
			if (!CS || path.length < 2) { return; }
			var last = path.length - 2;
			if (st.segTimes[last] != null) { return; }
			var prevMark = last > 0 ? (st.segMarks[last - 1] || 0) : 0;
			st.segMarks[last] = Math.round(st.elapsed * 1000);
			st.segTimes[last] = Math.max(0, (st.segMarks[last] - prevMark) / 1000);
		}

		function judgeNow() {
			if (st.phase !== "running") { return; }
			recordSegments(st.curFacelet);
			if (st.timingMode === "state" && reachedEnd(st.curFacelet)) { finish(true, "auto"); }
		}

		/* ---- 结束 ---- */
		function finish(ok, how) {
			if (st.phase !== "running") { return null; }
			stopTimers();
			st.elapsed = (performance.now() - st.startT) / 1000;
			/* 手动停表必须校验状态；未达终点判 DNF */
			var reached = reachedEnd(st.curFacelet);
			st.dnf = !reached;
			st.dnfReason = reached ? "" : "停表时未达到终点节点";
			/* 无论是否到终点，都先把已经完成的中间段结算掉：
			 * 用户可能在完成第二段之后才停下，那第一、二段的用时是真实有效的。 */
			recordSegments(st.curFacelet);
			/* 到终点时补上最后一段（它的终点就是本次总用时） */
			if (reached) { finalizeLastSegment(); }
			var total = Math.round(st.elapsed * 1000) / 1000;
			var result = {
				t: total,
				dnf: st.dnf,
				dnfReason: st.dnfReason,
				how: how,
				timingMode: st.timingMode,
				segTimes: st.segTimes.slice(),
				segMarks: st.segMarks.slice(),
				turns: st.live.turns,
				tps: st.live.turns && total > 0 ? Math.round(st.live.turns / total * 100) / 100 : 0,
				moves: st.live.moves.slice(),
				path: path.slice(),
				at: Date.now()
			};
			if (M.timer) { M.timer.textContent = fmt(total); }
			setPhase(st.dnf ? "dnf" : "done", st.dnf ? "DNF" : "完成");
			if (opts.onFinish) { opts.onFinish(result); }
			return result;
		}

		function stopManual() {
			if (st.phase !== "running" || st.timingMode !== "manual") { return false; }
			finish(true, "manual");
			return true;
		}

		/* ---- 状态注入 ---- */
		function setState(facelet, countTurn, moveText) {
			if (facelet) { st.curFacelet = facelet; }
			if (countTurn && st.phase === "running") {
				st.live.turns++;
				st.live.moves.push(moveText || "");
			}
			renderCube();
			renderStageBar();
			if (st.phase === "running") {
				recordSegments(st.curFacelet);
				if (st.timingMode === "state" && reachedEnd(st.curFacelet)) { finish(true, "auto"); }
			}
		}

		function reset(facelet) {
			stopTimers();
			st.phase = "ready";
			st.elapsed = 0;
			st.segTimes = [];
			st.segMarks = [];
			st.live = { turns: 0, tps: 0, moves: [] };
			st.dnf = false;
			st.curFacelet = facelet || st.startFacelet;
			st.startFacelet = st.curFacelet;
			st.timingMode = "pending";
			st.doneSegs = 0;
			if (M.timer) { M.timer.textContent = "0.00"; }
			setPhase("ready", "准备");
			renderLive();
			renderCube();
			renderStageBar();
		}

		/* ---- 键盘（可选） ---- */
		var KEY_LAYOUT = [
			["U", "U'", "U2", "R", "R'", "R2"],
			["F", "F'", "F2", "D", "D'", "D2"],
			["L", "L'", "L2", "B", "B'", "B2"]
		];
		function renderKeys() {
			if (!M.keys) { return; }
			M.keys.innerHTML = "";
			KEY_LAYOUT.forEach(function (row) {
				row.forEach(function (tok) {
					var b = el("button", "ctKey", tok);
					b.type = "button";
					b.addEventListener("click", function () { if (opts.onKey) { opts.onKey(tok); } });
					M.keys.appendChild(b);
				});
			});
		}

		function buildNet() {
			if (M.net && root.CubeNet) { root.CubeNet.build(M.net); }
		}
		buildNet();
		renderKeys();
		renderCube();
		renderLive();
		renderStageBar();

		return {
			state: st,
			start: startRun,
			stopManual: stopManual,
			finish: finish,
			reset: reset,
			setState: setState,
			setPath: function (p) { path = p.slice(); reset(); },
			path: function () { return path.slice(); },
			setFrame: function (fr) { frame = fr || frame; renderStageBar(); },
			frame: function () { return { bottom: frame.bottom, front: frame.front }; },
			renderStageBar: renderStageBar,
			reachedEnd: function () { return reachedEnd(st.curFacelet); },
			segments: function () { return st.segTimes.slice(); }
		};
	}

	/* 把 opts.mount 里的 id 字符串解析成元素 */
	function resolveMounts(m) {
		var out = {};
		Object.keys(m).forEach(function (k) {
			var v = m[k];
			out[k] = typeof v === "string" ? document.getElementById(v) : v;
		});
		return out;
	}

	root.CubeTimer = {
		create: create,
		bluetooth: btApi,
		fmt: fmt,
		isSolvedFacelet: function (s) { return btApi.isSolved(s); }
	};
})(typeof globalThis !== "undefined" ? globalThis : this);
