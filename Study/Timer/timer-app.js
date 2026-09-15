(function () {
	'use strict';

	var LS_KEY = 'studyTimer.v1';
	var CONFIRM_MS = 2500;

	function $(id) { return document.getElementById(id); }

	function clampNum(v, min, max, dft) {
		v = Math.round(Number(v));
		if (!isFinite(v)) return dft;
		return Math.min(max, Math.max(min, v));
	}

	function genId() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

/* ================= 数据 =================
 * data = {
 *   totalMin: 总倒计时（分钟）,
 *   endPreMin: 终点预留（分钟，剩这么多时提醒收尾；0 = 关）,
 *   nodes: [{ id, at 节点剩余分钟, pre 预留分钟, mut, del }],
 *   nodesMut: 节点集合修改时间,
 *   totalMut: 总时长修改时间,
 *   endPreMut: 终点预留修改时间
 * }
 * 节点含义：从「还剩 at 分钟」开始，持续到「还剩 0 分钟」（即时间轴 at → 0）。
 * pre 为「预留时间」，窗口为 at+pre → at。
 */
	function defaultData() {
		var now = Date.now();
		return {
			totalMin: 40,
			totalMut: now,
			endPreMin: 5,
			endPreMut: now,
			nodes: [
				{ id: genId(), at: 20, pre: 5, mut: now, del: false },
				{ id: genId(), at: 30, pre: 5, mut: now, del: false }
			],
			nodesMut: now
		};
	}

	function load() {
		try {
			var raw = localStorage.getItem(LS_KEY);
			if (raw) {
				var d = JSON.parse(raw);
				if (d && typeof d === 'object') {
					var out = {
						totalMin: clampNum(d.totalMin, 1, 600, 40),
						totalMut: typeof d.totalMut === 'number' ? d.totalMut : 0,
						endPreMin: clampNum(d.endPreMin, 0, 120, 5),
						endPreMut: typeof d.endPreMut === 'number' ? d.endPreMut : 0,
						nodes: [],
						nodesMut: typeof d.nodesMut === 'number' ? d.nodesMut : 0
					};
					if (Array.isArray(d.nodes)) {
						for (var i = 0; i < d.nodes.length; i++) {
							var n = d.nodes[i];
							if (!n || typeof n !== 'object') continue;
							var at = clampNum(n.at, 1, 600, 0);
							if (!at) continue;
							out.nodes.push({
								id: (typeof n.id === 'string' && n.id) ? n.id : genId(),
								at: at,
								pre: clampNum(n.pre, 0, 120, 0),
								mut: typeof n.mut === 'number' ? n.mut : 0,
								del: !!n.del
							});
						}
					}
					return out;
				}
			}
		} catch (e) { /* ignore */ }
		return defaultData();
	}

	var data = load();

	function save(cloudPush) {
		try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
		if (cloudPush) pushCloud();
	}

	/* ================= 运行动态 ================= */
	var run = {
		phase: 'idle',     /* idle | running | paused | done */
		startAt: 0,        /* 本轮开始时间戳 */
		pausedLeftMs: 0,   /* 暂停时剩余毫秒 */
		preFired: {},      /* { nodeId: true } 预留提醒已发 */
		nodeFired: {},     /* { nodeId: true } 节点提醒已发 */
		endPreFired: false,
		endFired: false,
		lastSec: -1
	};

	function resetRunState() {
		run.phase = 'idle';
		run.startAt = 0;
		run.pausedLeftMs = 0;
		run.preFired = {};
		run.nodeFired = {};
		run.endPreFired = false;
		run.endFired = false;
		run.lastSec = -1;
	}

	function totalMs() { return data.totalMin * 60000; }

	function leftMs() {
		if (run.phase === 'idle') return totalMs();
		if (run.phase === 'done') return 0;
		if (run.phase === 'paused') return Math.max(0, run.pausedLeftMs);
		return Math.max(0, totalMs() - (Date.now() - run.startAt));
	}

	/* 活跃节点（未删除、at 不超过总时长），按 at 升序（时间轴由早到晚） */
	function activeNodes() {
		var list = [];
		for (var i = 0; i < data.nodes.length; i++) {
			var n = data.nodes[i];
			if (n.del) continue;
			if (n.at > data.totalMin) continue;
			list.push(n);
		}
		list.sort(function (a, b) { return a.at - b.at; });
		return list;
	}

	/* ================= 声音（Web Audio 合成，无外部资源） ================= */
	var audio = {
		ctx: null,
		enabled: true,
		ensure: function () {
			if (this.ctx) return this.ctx;
			try {
				var Ctor = window.AudioContext || window.webkitAudioContext;
				if (!Ctor) return null;
				this.ctx = new Ctor();
			} catch (e) { this.ctx = null; }
			return this.ctx;
		},
		unlock: function () {
			var ctx = this.ensure();
			if (ctx && ctx.state === 'suspended') {
				try { ctx.resume(); } catch (e) { /* ignore */ }
			}
		},
		/* 单音 */
		blip: function (freq, startAt, dur, gainVal, type) {
			var ctx = this.ctx;
			if (!ctx) return;
			var osc = ctx.createOscillator();
			var g = ctx.createGain();
			osc.type = type || 'sine';
			osc.frequency.setValueAtTime(freq, startAt);
			g.gain.setValueAtTime(0, startAt);
			g.gain.linearRampToValueAtTime(gainVal, startAt + 0.015);
			g.gain.exponentialRampToValueAtTime(0.0008, startAt + dur);
			osc.connect(g);
			g.connect(ctx.destination);
			osc.start(startAt);
			osc.stop(startAt + dur + 0.03);
		},
		/* kind: 'pre' 预留到（三音上挑 ≈1.2s） / 'node' 节点到（四音两轮 ≈2.3s） / 'end' 结束（三轮 + 长尾 ≈3.9s） */
		play: function (kind) {
			if (!this.enabled) return;
			var ctx = this.ensure();
			if (!ctx) return;
			if (ctx.state === 'suspended') {
				try { ctx.resume(); } catch (e) { /* ignore */ }
			}
			var t = ctx.currentTime + 0.02;
			if (kind === 'pre') {
				/* 预留提醒：三音上挑，约 1.2 秒 */
				this.blip(784, t, 0.30, 0.18, 'triangle');
				this.blip(988, t + 0.28, 0.30, 0.19, 'triangle');
				this.blip(1175, t + 0.56, 0.62, 0.21, 'triangle');
			} else if (kind === 'node') {
				/* 节点到：四音上挑 × 两轮，约 2.3 秒 */
				this.blip(659, t, 0.22, 0.18, 'triangle');
				this.blip(784, t + 0.20, 0.22, 0.19, 'triangle');
				this.blip(988, t + 0.40, 0.22, 0.20, 'triangle');
				this.blip(1175, t + 0.60, 0.55, 0.22, 'triangle');
				this.blip(659, t + 1.15, 0.22, 0.17, 'triangle');
				this.blip(784, t + 1.35, 0.22, 0.18, 'triangle');
				this.blip(988, t + 1.55, 0.22, 0.19, 'triangle');
				this.blip(1318, t + 1.75, 0.55, 0.21, 'triangle');
			} else {
				/* 计时结束：四音一轮 × 三轮 + 长尾音，约 3.9 秒 */
				this.blip(523, t, 0.26, 0.20, 'triangle');
				this.blip(659, t + 0.20, 0.26, 0.20, 'triangle');
				this.blip(784, t + 0.40, 0.26, 0.21, 'triangle');
				this.blip(1046, t + 0.60, 0.50, 0.23, 'triangle');
				this.blip(523, t + 1.15, 0.26, 0.20, 'triangle');
				this.blip(659, t + 1.35, 0.26, 0.20, 'triangle');
				this.blip(784, t + 1.55, 0.26, 0.21, 'triangle');
				this.blip(1046, t + 1.75, 0.50, 0.23, 'triangle');
				this.blip(523, t + 2.30, 0.26, 0.20, 'triangle');
				this.blip(659, t + 2.50, 0.26, 0.20, 'triangle');
				this.blip(784, t + 2.70, 0.26, 0.21, 'triangle');
				this.blip(1046, t + 2.90, 0.50, 0.23, 'triangle');
				this.blip(1318, t + 3.05, 0.90, 0.24, 'triangle');
			}
		}
	};

	/* ================= Toast ================= */
	var toastTimer = null;
	var toastLastAt = 0;
	var TOAST_MERGE_MS = 500;
	function toast(msg, kind) {
		var el = $('toast');
		var now = Date.now();
		/* 连发窗口内（如同帧的节点到 + 终点收尾）：并入当前 toast，提醒信息不互相覆盖 */
		if (el.classList.contains('show') && now - toastLastAt < TOAST_MERGE_MS && el.textContent) {
			msg = el.textContent + '；' + msg;
			if (!kind) kind = el.className.indexOf('alert') >= 0 ? 'alert' : (el.className.indexOf('warn') >= 0 ? 'warn' : '');
		}
		el.textContent = msg;
		el.className = 'show' + (kind ? ' ' + kind : '');
		toastLastAt = now;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { el.className = ''; }, 2600);
	}

	/* ================= 二次确认 ================= */
	function disarm(btn) {
		if (btn.__t) clearTimeout(btn.__t);
		btn.__t = null; btn.__armed = false;
		btn.classList.remove('armed');
		if (btn.__mini) { btn.textContent = '✕'; }
		else if (btn.__orig != null) { btn.textContent = btn.__orig; }
	}
	function armConfirm(btn, fn) {
		if (btn.__armed) { disarm(btn); fn(); return; }
		btn.__orig = btn.textContent;
		btn.__armed = true;
		btn.classList.add('armed');
		btn.textContent = '确认？';
		btn.__t = setTimeout(function () { disarm(btn); }, CONFIRM_MS);
	}

	/* ================= 时间格式 ================= */
	function fmtClock(ms) {
		ms = Math.max(0, ms);
		var s = Math.ceil(ms / 1000);
		var h = Math.floor(s / 3600);
		var m = Math.floor(s % 3600 / 60);
		var sec = s % 60;
		if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
		return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
	}
	function fmtClockMs(ms) {
		/* 带 0.1 秒，仅用于临近节点时的细腻显示 */
		ms = Math.max(0, ms);
		var s = Math.ceil(ms / 1000);
		var m = Math.floor(s / 60);
		var sec = s % 60;
		return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
	}
	function fmtMin(min) {
		if (min >= 60) {
			var h = Math.floor(min / 60), r = min % 60;
			return r ? h + '时' + r + '分' : h + '小时';
		}
		return min + '分钟';
	}

	/* ================= 圆盘几何 ================= */
	var RING_R = 80;
	var RING_C = 2 * Math.PI * RING_R;
	var RING_W = 12;          /* 弧宽 */
	var TICK_MINUTES = 5;

	function polar(cx, cy, r, angleDeg) {
		var a = (angleDeg - 90) * Math.PI / 180;
		return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
	}

	function arcPath(cx, cy, r, fromAngle, toAngle) {
		var p1 = polar(cx, cy, r, toAngle);
		var p2 = polar(cx, cy, r, fromAngle);
		var large = (toAngle - fromAngle) % 360 > 180 ? 1 : 0;
		return 'M ' + p1.x.toFixed(3) + ' ' + p1.y.toFixed(3) +
			' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + p2.x.toFixed(3) + ' ' + p2.y.toFixed(3);
	}

	/* 顺时针圆弧：起笔在 fromAngle（fromAngle < toAngle），沿屏幕顺时针画到 toAngle。
	   预留段用它把「青端（贴节点）」放在路径起点 ⇒ 消退时只要缩 dasharray 的可见长度，
	   d 与渐变端点全程不动，色条从紫端一侧一点点消失。 */
	function arcPathCW(cx, cy, r, fromAngle, toAngle) {
		var p1 = polar(cx, cy, r, fromAngle);
		var p2 = polar(cx, cy, r, toAngle);
		var large = (toAngle - fromAngle) > 180 ? 1 : 0;
		return 'M ' + p1.x.toFixed(3) + ' ' + p1.y.toFixed(3) +
			' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p2.x.toFixed(3) + ' ' + p2.y.toFixed(3);
	}

	/* 剩余 ms → 圆盘角度（逆时针叙事：正上方 12 点既是起点也是终点）。
	   顺时针角 = (剩余/总) × 360：满 → 12 点(360°)，剩一半 → 6 点(180°)，耗尽 → 回到 12 点(0°)。
	   节点/刻度/预留段/收尾带全部用「剩余值」定位，指针（= 紫弧流逝端）自然落在比例位。 */
	function angleOf(ms) {
		var t = totalMs();
		if (t <= 0) return 0;
		return Math.max(0, Math.min(t, ms)) / t * 360;
	}

	/* ================= 渲染：圆盘 ================= */
	var marksBuiltKey = '';
	var preBuiltKey = '';
	var preBandCfg = {};      /* dataTag -> { aNode, aOuter, el, grad }：渲染期退去用 */

	/* 预留段层：静态几何，仅依赖 totalMin / 节点配置 / 终点预留。
	   每段渐变独立生成（userSpaceOnUse）：紫端 = 窗口开始，青端贴节点（或 12 点终点）。
	   运行中几何与渐变端点全程不变，只用 dasharray 从紫端一侧逐段消失（见 renderDial）。 */
	function buildPreLayer() {
		var g = $('dialPreLayer');
		var defs = $('dialDefs');
		var nodes = activeNodes();
		var endPre = Math.min(data.endPreMin || 0, data.totalMin);
		var key = data.totalMin + '|' + endPre + '|' + nodes.map(function (n) { return n.id + ':' + n.at + ':' + n.pre; }).join(',');
		if (key === preBuiltKey) return;
		preBuiltKey = key;

		/* 清掉上一轮的动态渐变 */
		var olds = defs.querySelectorAll('linearGradient[data-dyn]');
		for (var d = 0; d < olds.length; d++) {
			olds[d].parentNode.removeChild(olds[d]);
		}

		var grads = [], paths = [], bandDefs = [];

		/* 通用段：aFrom = 紫端（窗口开始/远离节点），aTo = 青端（贴节点，高光）。
		   新角度语义下 aFrom ≥ aTo；path 用 arcPathCW 从青端起笔顺时针画到紫端，
		   长度 = 整段，运行期只改 dasharray ⇒ 渐变固定不动。 */
		function addBand(aFrom, aTo, idTag, dataTag) {
			var pA = polar(100, 100, RING_R, aFrom);   /* 紫端 */
			var pB = polar(100, 100, RING_R, aTo);     /* 青端 */
			var gid = 'dynPre_' + idTag;
			var aIn = Math.min(aFrom, aTo);
			var aOut = Math.max(aFrom, aTo);
			grads.push(
				'<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" data-dyn="1"' +
				' x1="' + pA.x.toFixed(2) + '" y1="' + pA.y.toFixed(2) +
				'" x2="' + pB.x.toFixed(2) + '" y2="' + pB.y.toFixed(2) + '">' +
				'<stop offset="0" stop-color="var(--dsk-primary)"></stop>' +
				'<stop offset="1" stop-color="var(--dsk-accent)"></stop>' +
				'</linearGradient>'
			);
			paths.push('<path class="dialPreArc" data-pre="' + dataTag + '" stroke="url(#' + gid + ')" d="' +
				arcPathCW(100, 100, RING_R, aIn, aOut) + '"></path>');
			bandDefs.push({
				tag: dataTag, gid: idTag, aNode: aIn, aOuter: aOut,
				len: RING_C * (aOut - aIn) / 360
			});
		}

		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			if (n.pre <= 0) continue;
			var aPre = angleOf((n.at + n.pre) * 60000);
			var aAt = angleOf(n.at * 60000);
			if (Math.abs(aPre - aAt) < 0.3) continue;  /* 新语义下 aPre > aAt，用跨度判断 */
			addBand(aPre, aAt, 'n' + i, n.id);
		}

		/* 终点收尾带：最后 endPre 分钟 → 12 点顺时针侧 [0°, aEnd]，青端贴 12 点（计时终点）。
		   新语义下 angleOf(endPre) = (endPre/total)×360 恰为该段外端角；
		   path 从 12 点（青端）起笔顺时针画到 aEnd（紫端），消退方式同节点段。 */
		if (endPre > 0) {
			var aEnd = angleOf(endPre * 60000);
			if (aEnd > 0.3 && aEnd < 359.7) {
				var pE = polar(100, 100, RING_R, aEnd);  /* 紫端（外） */
				var pT = polar(100, 100, RING_R, 0);      /* 青端 = 12 点 */
				grads.push(
					'<linearGradient id="dynPre_end" gradientUnits="userSpaceOnUse" data-dyn="1"' +
					' x1="' + pE.x.toFixed(2) + '" y1="' + pE.y.toFixed(2) +
					'" x2="' + pT.x.toFixed(2) + '" y2="' + pT.y.toFixed(2) + '">' +
					'<stop offset="0" stop-color="var(--dsk-primary)"></stop>' +
					'<stop offset="1" stop-color="var(--dsk-accent)"></stop>' +
					'</linearGradient>'
				);
				paths.push('<path class="dialPreArc" data-pre="__end__" stroke="url(#dynPre_end)" d="' +
					arcPathCW(100, 100, RING_R, 0, aEnd) + '"></path>');
				bandDefs.push({
					tag: '__end__', gid: 'end', aNode: 0, aOuter: aEnd,
					len: RING_C * aEnd / 360
				});
			}
		}

		defs.insertAdjacentHTML('beforeend', grads.join(''));
		g.innerHTML = paths.join('');

		/* 记录各段几何（角度 + 整段弧长）与元素引用，供 renderDial 做「逐段消失」 */
		preBandCfg = {};
		for (var b = 0; b < bandDefs.length; b++) {
			var bd = bandDefs[b];
			preBandCfg[bd.tag] = {
				aNode: bd.aNode, aOuter: bd.aOuter, len: bd.len,
				el: g.querySelector('[data-pre="' + bd.tag + '"]')
			};
		}
	}

	/* 刻度 + 节点标记层 */
	function buildMarks() {
		var g = $('dialMarks');
		var nodes = activeNodes();
		var key = data.totalMin + '|' + nodes.map(function (n) { return n.id + ':' + n.at + ':' + n.pre; }).join(',');
		if (key === marksBuiltKey) return;
		marksBuiltKey = key;

		var html = [];
		/* 刻度线贴环外侧；数字稀疏标注在内圈，避免与节点标签抢位 */
		var tickStep = data.totalMin > 120 ? 10 : TICK_MINUTES;
		var labelStep = data.totalMin <= 30 ? 10 : (data.totalMin <= 90 ? 15 : 30);
		for (var m = 0; m <= data.totalMin; m += tickStep) {
			var angT = angleOf(m * 60000);
			var pIn = polar(100, 100, 87.5, angT);
			var pOut = polar(100, 100, 92.5, angT);
			html.push('<line class="dialTickLine" x1="' + pIn.x.toFixed(2) + '" y1="' + pIn.y.toFixed(2) +
				'" x2="' + pOut.x.toFixed(2) + '" y2="' + pOut.y.toFixed(2) + '"></line>');
			if (m > 0 && m < data.totalMin - 0.001 && m % labelStep === 0) {
				var pL = polar(100, 100, 63, angT);
				html.push('<text class="dialTickText" x="' + pL.x.toFixed(2) + '" y="' + pL.y.toFixed(2) +
					'">' + m + '</text>');
			}
		}
		/* 节点：青色刻线（横跨环宽）+ 外侧标签 */
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			if (n.at <= 0) continue;
			var aAt = angleOf(n.at * 60000);

			/* 节点刻线：从环内缘到环外缘的一道青色短划 */
			var pN1 = polar(100, 100, RING_R - RING_W / 2 - 1, aAt);
			var pN2 = polar(100, 100, RING_R + RING_W / 2 + 1, aAt);
			html.push('<line class="dialNodeTick" data-node="' + n.id + '" x1="' + pN1.x.toFixed(2) +
				'" y1="' + pN1.y.toFixed(2) + '" x2="' + pN2.x.toFixed(2) + '" y2="' + pN2.y.toFixed(2) + '"></line>');

			/* 外延细线 + 标签（标签更靠外，与内侧刻度数字分层） */
			var pS1 = polar(100, 100, RING_R + RING_W / 2 + 2, aAt);
			var pS2 = polar(100, 100, 96, aAt);
			html.push('<line class="dialNodeStem" data-node-stem="' + n.id + '" x1="' + pS1.x.toFixed(2) +
				'" y1="' + pS1.y.toFixed(2) + '" x2="' + pS2.x.toFixed(2) + '" y2="' + pS2.y.toFixed(2) + '"></line>');

			var pLab = polar(100, 100, 104, aAt);
			html.push('<text class="dialNodeLabel" data-node-label="' + n.id + '" x="' + pLab.x.toFixed(2) +
				'" y="' + pLab.y.toFixed(2) + '">' + n.at + '</text>');
		}
		g.innerHTML = html.join('');
	}

	function renderDial() {
		buildPreLayer();
		buildMarks();
		var left = leftMs();
		var t = totalMs();
		var remainingFrac = t > 0 ? Math.max(0, Math.min(1, left / t)) : 0;

		/* 紫色倒计时弧：从 12 点顺时针覆盖剩余部分（dashoffset 恒 0）。
		   剩余减少时顺时针末端沿逆时针退回 12 点 —— 逆时针褪去；末端即指针，正对节点比例位。 */
		var countEl = $('dialCount');
		countEl.setAttribute('stroke-dasharray', (remainingFrac * RING_C).toFixed(2) + ' ' + RING_C.toFixed(2));

		/* 中心文字 */
		var dialTime = $('dialTime');
		var dialSub = $('dialSub');
		var wrap = document.querySelector('.dialWrap');
		var nodes = activeNodes();

		if (run.phase === 'done') {
			dialTime.textContent = '00:00';
			dialSub.textContent = '计时结束';
		} else {
			dialTime.textContent = fmtClock(left);
		if (run.phase === 'running') {
			var endPre = data.endPreMin || 0;
			var hot = null;
			for (var j = 0; j < nodes.length; j++) {
				var nj = nodes[j];
				if (!run.nodeFired[nj.id] && left <= nj.at * 60000) { hot = nj; break; }
				if (!run.preFired[nj.id] && nj.pre > 0 && left <= (nj.at + nj.pre) * 60000) { hot = nj; break; }
			}
			var inEndPre = endPre > 0 && left > 0 && left <= endPre * 60000;
			dialSub.textContent = hot
				? (left <= hot.at * 60000 ? ('冲刺中 · ' + fmtMin(hot.at) + '节点')
					: ('预留中 · ' + fmtMin(hot.at) + '节点'))
				: (inEndPre ? ('准备收尾 · 最后 ' + fmtMin(endPre))
					: ('倒计时 · ' + fmtMin(data.totalMin)));
		} else if (run.phase === 'paused') {
				dialSub.textContent = '已暂停';
			} else {
				dialSub.textContent = '准备开始';
			}
		}

		/* 预留段退去：可见范围 = 青端（贴节点/12 点）起、向紫端方向留到 min(外端, 指针角)。
		   d 与渐变端点全程不改，只用 dasharray 缩短可见长度 ⇒ 渐变起点/终点固定，色条一段段消失。 */
		var pointerAng = remainingFrac * 360;
		for (var pk in preBandCfg) {
			if (!Object.prototype.hasOwnProperty.call(preBandCfg, pk)) continue;
			var cfgB = preBandCfg[pk];
			if (!cfgB.el || !cfgB.el.parentNode) continue;
			var aOuterNow = Math.max(cfgB.aNode, Math.min(cfgB.aOuter, pointerAng));
			var span = cfgB.aOuter - cfgB.aNode;
			var visLen = span > 0 ? cfgB.len * (aOuterNow - cfgB.aNode) / span : 0;
			if (visLen < 0.5) {
				cfgB.el.style.display = 'none';
			} else {
				cfgB.el.style.display = '';
				cfgB.el.style.strokeDasharray = visLen.toFixed(2) + ' ' + cfgB.len.toFixed(2);
			}
		}

		/* 节点标记状态 */
		var marks = $('dialMarks');
		var nTicks = marks.querySelectorAll('[data-node]');
		for (var a = 0; a < nTicks.length; a++) {
			var nodeA = findNode(nTicks[a].getAttribute('data-node'));
			if (!nodeA) continue;
			var passedA = left <= nodeA.at * 60000;
			var hotA = !passedA && nodeA.pre > 0 && left <= (nodeA.at + nodeA.pre) * 60000;
			nTicks[a].setAttribute('class', 'dialNodeTick' + (passedA ? ' isPassed' : (hotA ? ' isHot' : '')));
		}
		var stems = marks.querySelectorAll('[data-node-stem]');
		for (var s = 0; s < stems.length; s++) {
			var nodeS = findNode(stems[s].getAttribute('data-node-stem'));
			if (!nodeS) continue;
			stems[s].setAttribute('class', 'dialNodeStem' + (left <= nodeS.at * 60000 ? ' isPassed' : ''));
		}
		var labels = marks.querySelectorAll('[data-node-label]');
		for (var l = 0; l < labels.length; l++) {
			var nodeL = findNode(labels[l].getAttribute('data-node-label'));
			if (!nodeL) continue;
			labels[l].setAttribute('class', 'dialNodeLabel' + (left <= nodeL.at * 60000 ? ' isPassed' : ''));
		}

		wrap.classList.toggle('isRunning', run.phase === 'running');
		wrap.classList.toggle('isDone', run.phase === 'done');
		$('dial').classList.toggle('done', run.phase === 'done');
	}

	function findNode(id) {
		for (var i = 0; i < data.nodes.length; i++) {
			if (data.nodes[i].id === id) return data.nodes[i];
		}
		return null;
	}

	/* ================= 渲染：节点列表 ================= */
	function nodeState(n, left) {
		/* 用一个很小的容差避免抖动 */
		var atMs = n.at * 60000;
		var preMs = (n.at + n.pre) * 60000;
		if (left <= atMs) return 'passed';
		if (n.pre > 0 && left <= preMs) return 'pre';
		return 'idle';
	}

	/* 进度条可见范围：左端随窗口进度向右褪去（右端 = 青 = 贴节点，是锚点）。
	   只裁掉左段，渐变本身不缩放 ⇒ 起点/终点全程固定；两端圆角由 inset(... round 5px) 给出
	   （5px = 条高 10px 的一半，裁出来的可见段就是一根药丸）。 */
	function barClipPath(scale) {
		var cut = Math.max(0, Math.min(1, 1 - scale)) * 100;
		return 'inset(0 0 0 ' + cut.toFixed(3) + '% round 5px)';
	}

	function renderList() {
		var box = $('nodeList');
		var nodes = activeNodes();
		$('emptyHint').hidden = nodes.length > 0;

		var left = leftMs();
		var total = data.totalMin;
		var html = [];

		for (var i = nodes.length - 1; i >= 0; i--) {
			var n = nodes[i];
			var st = nodeState(n, left);
			var cardCls = 'nodeCard' + (st === 'pre' ? ' isHot' : '') + (st === 'passed' ? ' isPassed' : '');

			/* 进度条：整段 = 从「还剩 at 分钟」走到「还剩 0 分钟」。
			   预留窗口 (at+pre → at) 内左端向右褪去（右端贴节点，是锚点）；窗口之前恒为满。 */
			var scale = 1;
			if (n.pre > 0) {
				var winTotal = n.pre * 60000;
				var remainInWin = Math.max(0, Math.min(winTotal, left - n.at * 60000));
				scale = remainInWin / winTotal;
				if (st === 'passed') scale = 0;
			} else if (st === 'passed') {
				scale = 0;
			}
			if (run.phase !== 'running' && run.phase !== 'paused' && st === 'idle') scale = 1;

			var badge, countText, countCls;
			if (st === 'passed') {
				badge = '<span class="nodeBadge badgeDone">已到</span>';
				countText = '已到';
				countCls = ' isDone';
			} else if (st === 'pre') {
				badge = '<span class="nodeBadge badgePre">预留中</span>';
				countText = fmtClockMs(left - n.at * 60000);
				countCls = ' isHot';
			} else {
				badge = n.pre > 0 ? '<span class="nodeBadge">待预留</span>' : '<span class="nodeBadge">等待</span>';
				countText = fmtClock(left - n.at * 60000);
				countCls = '';
			}

			var footLeft = '剩 ' + fmtMin(n.at) + ' 处节点';
			if (n.pre > 0) footLeft += ' · 预留 ' + fmtMin(n.pre);
			var footRight = '';
			if (n.pre > 0) {
				var fireMs = (n.at + n.pre) * 60000;
				footRight = left > fireMs ? ('预留提醒 ' + fmtClock(left - fireMs) + ' 后') :
					'预留提醒已响';
			} else {
				footRight = '无预留';
			}

			/* 预留为 0 的节点不显示进度条，只保留倒计时与状态 */
			var barHtml = n.pre > 0
				? '<div class="barOuter">' +
					'<div class="barInner" style="clip-path:' + barClipPath(scale) + '"></div>' +
				  '</div>'
				: '<div class="barAbsent">无预留 · 到点直接提醒</div>';

			html.push(
				'<div class="' + cardCls + '" data-id="' + n.id + '">' +
					'<div class="nodeHead">' +
						'<div class="nodeTitle">' +
							'<span class="nodeTime">' + n.at + '<span class="at">分钟</span></span>' +
							badge +
						'</div>' +
						'<div class="nodeRight">' +
							'<span class="nodeCount' + countCls + '">' + countText + '</span>' +
							'<button class="iconBtn" type="button" data-del="' + n.id + '" title="删除节点">✕</button>' +
						'</div>' +
					'</div>' +
					barHtml +
					'<div class="nodeFoot">' +
						'<span>' + footLeft + '</span>' +
						'<span class="fire">' + footRight + '</span>' +
					'</div>' +
					'<div class="nodeEditor">' +
						'<span>节点</span>' +
						'<input type="number" min="1" max="600" step="1" value="' + n.at + '" data-field="at" data-id="' + n.id + '">' +
						'<span>预留</span>' +
						'<input type="number" min="0" max="120" step="1" value="' + n.pre + '" data-field="pre" data-id="' + n.id + '">' +
						'<span>分钟 · 失焦即生效</span>' +
					'</div>' +
				'</div>'
			);
		}
		box.innerHTML = html.join('');
	}

	/* ================= 提醒判定 ================= */
	function checkAlerts() {
		if (run.phase !== 'running' && run.phase !== 'paused') return;
		var left = leftMs();
		var nodes = activeNodes();
		var sec = Math.floor(left / 1000);

		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			/* ① 节点预留时间到 */
			if (n.pre > 0 && !run.preFired[n.id] && left <= (n.at + n.pre) * 60000) {
				run.preFired[n.id] = true;
				audio.play('pre');
				toast('还有 ' + fmtMin(n.at) + ' 到 ' + n.at + ' 分钟节点，预留 ' + fmtMin(n.pre) + ' 开始', 'warn');
			}
			/* ② 节点到（该节点区间开始） */
			if (!run.nodeFired[n.id] && left <= n.at * 60000) {
				run.nodeFired[n.id] = true;
				audio.play('node');
				toast(n.at + ' 分钟节点到了' + (n.at === 0 ? '' : '，最后 ' + fmtMin(n.at) + ' 冲刺'), 'warn');
			}
		}

		/* ③ 终点预留时间到（独立设置，默认剩 5 分钟提醒收尾） */
		var endPre = data.endPreMin || 0;
		if (endPre > 0 && !run.endPreFired && left > 0 && left <= endPre * 60000) {
			run.endPreFired = true;
			audio.play('pre');
			toast('最后 ' + fmtMin(endPre) + '，准备收尾', 'warn');
		}

		/* ④ 计时结束 */
		if (!run.endFired && left <= 0) {
			run.endFired = true;
			run.phase = 'done';
			run.pausedLeftMs = 0;
			audio.play('end');
			toast('⏰ 计时结束', 'alert');
			flashDial();
			renderAll();
			return;
		}

		/* 状态变化时刷新（每秒一次足够，避免抖动） */
		if (sec !== run.lastSec) {
			run.lastSec = sec;
			renderDial();
			renderList();
		}
	}

	function flashDial() {
		var wrap = document.querySelector('.dialWrap');
		wrap.classList.remove('isFlashing');
		void wrap.offsetWidth;
		wrap.classList.add('isFlashing');
		setTimeout(function () { wrap.classList.remove('isFlashing'); }, 3200);
	}

	/* ================= 总渲染 ================= */
	function renderAll() {
		renderDial();
		renderList();
		syncButtons();
	}

	function syncButtons() {
		var running = run.phase === 'running';
		var paused = run.phase === 'paused';
		var idle = run.phase === 'idle';
		var done = run.phase === 'done';
		$('btnStart').hidden = running;
		$('btnPause').hidden = !running;
		$('btnStart').textContent = (paused || done) ? '继续' : '开始';
		$('btnReset').hidden = false;
		$('addNodeBtn').disabled = running || paused;
		$('endPreInput').disabled = running || paused;
		/* 仅待开始状态可点击盘心时间编辑总时长 */
		var wrap = document.querySelector('.dialWrap');
		wrap.classList.toggle('isIdle', idle);
		var dt = $('dialTime');
		if (dt) dt.title = idle ? '点击设置总时长' : '';
	}

	/* ================= 交互 ================= */
	$('btnStart').addEventListener('click', function () {
		audio.unlock();
		if (run.phase === 'running') return;
		if (run.phase === 'paused') {
			run.startAt = Date.now() - (totalMs() - run.pausedLeftMs);
			run.phase = 'running';
		} else {
			resetRunState();
			run.phase = 'running';
			run.startAt = Date.now();
		}
		renderAll();
		toast('开始倒计时 · ' + fmtMin(data.totalMin));
	});

	$('btnPause').addEventListener('click', function () {
		if (run.phase !== 'running') return;
		run.pausedLeftMs = leftMs();
		run.phase = 'paused';
		renderAll();
		toast('已暂停');
	});

	$('btnReset').addEventListener('click', function () {
		var btn = this;
		armConfirm(btn, function () {
			var wasRunning = run.phase !== 'idle';
			resetRunState();
			renderAll();
			toast(wasRunning ? '已重置' : '已是待开始状态');
		});
	});

	/* 盘心时间 = 总时长编辑入口：仅待开始状态可编辑，失焦 / 回车即生效，Esc 取消 */
	var dialTimeEl = $('dialTime');
	var timeEditor = null;

	function closeTimeEditor(commit) {
		var ed = timeEditor;
		if (!ed) return;
		timeEditor = null;
		if (commit) {
			var v = clampNum(ed.value, 1, 600, data.totalMin);
			if (v !== data.totalMin) {
				data.totalMin = v;
				data.totalMut = Date.now();
				marksBuiltKey = '';
				preBuiltKey = '';
				resetRunState();
				save(true);
				renderAll();
				toast('总时长已设为 ' + fmtMin(v));
			}
		}
		if (ed.parentNode) ed.parentNode.removeChild(ed);
		dialTimeEl.style.display = '';
	}

	dialTimeEl.addEventListener('click', function () {
		if (run.phase !== 'idle' || timeEditor) return;
		var ed = document.createElement('input');
		ed.type = 'number';
		ed.id = 'dialTimeEdit';
		ed.min = '1';
		ed.max = '600';
		ed.step = '1';
		ed.value = data.totalMin;
		dialTimeEl.style.display = 'none';
		dialTimeEl.parentNode.insertBefore(ed, dialTimeEl);
		timeEditor = ed;
		ed.focus();
		if (ed.select) ed.select();
		ed.addEventListener('blur', function () { closeTimeEditor(true); });
		ed.addEventListener('keydown', function (ev) {
			if (ev.key === 'Enter') { ed.blur(); }
			else if (ev.key === 'Escape') { closeTimeEditor(false); }
		});
	});

	$('endPreInput').addEventListener('change', function () {
		var v = clampNum(this.value, 0, 120, 5);
		this.value = v;
		if (v !== data.endPreMin) {
			data.endPreMin = v;
			data.endPreMut = Date.now();
			preBuiltKey = '';
			run.endPreFired = false;
			save(true);
			renderAll();
			toast(v > 0 ? ('终点预留已设为 ' + fmtMin(v)) : '终点预留已关闭');
		}
	});

	/* 列表区添加节点：默认总时长一半处、预留 5 分钟，具体数值在卡片内改（失焦即生效） */
	$('addNodeBtn').addEventListener('click', function () {
		if (run.phase === 'running' || run.phase === 'paused') return;
		var taken = {};
		for (var i = 0; i < data.nodes.length; i++) {
			if (!data.nodes[i].del) taken[data.nodes[i].at] = true;
		}
		var at = Math.max(1, Math.floor(data.totalMin / 2));
		while (at > 1 && taken[at]) at--;
		if (taken[at]) { toast('节点时间已占满，请先调整现有节点'); return; }
		var id = genId();
		data.nodes.push({ id: id, at: at, pre: 5, mut: Date.now(), del: false });
		data.nodesMut = Date.now();
		marksBuiltKey = '';
		preBuiltKey = '';
		applyLiveEdit();
		save(true);
		renderAll();
		var card = document.querySelector('.nodeCard[data-id="' + id + '"]');
		if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		toast('已加 ' + at + ' 分钟节点（预留 5 分钟），可在卡片中直接修改');
	});

	/* 列表事件委托 */
	$('nodeList').addEventListener('click', function (ev) {
		var delBtn = ev.target.closest ? ev.target.closest('[data-del]') : null;
		if (delBtn) {
			delBtn.__mini = true;
			armConfirm(delBtn, function () {
				var id = delBtn.getAttribute('data-del');
				var n = findNode(id);
				if (!n) return;
				n.del = true;
				n.mut = Date.now();
				data.nodesMut = Date.now();
				marksBuiltKey = '';
				save(true);
				renderAll();
				toast('已删除 ' + n.at + ' 分钟节点');
			});
			return;
		}
	});

	/* 卡片内编辑：失焦 / 回车即生效（无应用按钮） */
	$('nodeList').addEventListener('keydown', function (ev) {
		if (ev.target && ev.target.matches && ev.target.matches('input[data-field]') && ev.key === 'Enter') {
			ev.target.blur();
		}
	});

	$('nodeList').addEventListener('change', function (ev) {
		var inp = ev.target;
		if (!inp || !inp.matches || !inp.matches('input[data-field]')) return;
		var id = inp.getAttribute('data-id');
		var field = inp.getAttribute('data-field');
		var n = findNode(id);
		if (!n) return;
		var isAt = field === 'at';
		var v = clampNum(inp.value, isAt ? 1 : 0, isAt ? 600 : 120, isAt ? n.at : n.pre);
		if (isAt && v > data.totalMin) {
			toast('节点不能晚于总时长 ' + fmtMin(data.totalMin));
			inp.value = n.at;
			return;
		}
		inp.value = v;
		if (v === n[field]) return;
		var preStructChanged = !isAt && ((n.pre > 0) !== (v > 0));
		n[field] = v;
		n.mut = Date.now();
		data.nodesMut = Date.now();
		marksBuiltKey = '';
		preBuiltKey = '';
		applyLiveEdit();
		save(true);
		if (preStructChanged) {
			/* 进度条 ↔ 无预留 结构切换，整卡重绘 */
			renderAll();
			return;
		}
		renderDial();
		refreshCard(id);
		updateListLive();
		toast(isAt ? ('节点已改为 ' + fmtMin(v)) : ('预留已改为 ' + fmtMin(v)));
	});

	/* 就地刷新卡片静态文字（不重建 DOM，保持输入焦点） */
	function refreshCard(id) {
		var card = document.querySelector('.nodeCard[data-id="' + id + '"]');
		var n = findNode(id);
		if (!card || !n) return;
		var t = card.querySelector('.nodeTime');
		if (t) t.innerHTML = n.at + '<span class="at">分钟</span>';
		var foot = card.querySelector('.nodeFoot span');
		if (foot) {
			var s = '剩 ' + fmtMin(n.at) + ' 处节点';
			if (n.pre > 0) s += ' · 预留 ' + fmtMin(n.pre);
			foot.textContent = s;
		}
	}

	/* 编辑节点时间后，若新时间晚于当前剩余时间，则该节点的提醒可重新触发 */
	function applyLiveEdit() {
		var left = leftMs();
		for (var i = 0; i < data.nodes.length; i++) {
			var n = data.nodes[i];
			if (left > (n.at + n.pre) * 60000) {
				delete run.preFired[n.id];
			}
			if (left > n.at * 60000) {
				delete run.nodeFired[n.id];
			}
		}
		run.endPreFired = false;
	}

	/* 导出 / 导入 / 清空 */
	$('btnExport').addEventListener('click', function () {
		var out = {
			app: 'study-timer', version: 1,
			totalMin: data.totalMin, totalMut: data.totalMut || 0,
			endPreMin: data.endPreMin, endPreMut: data.endPreMut || 0,
			nodes: data.nodes, nodesMut: data.nodesMut || 0
		};
		var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
		var a = document.createElement('a');
		var n = new Date();
		var stamp = n.getFullYear() + String(n.getMonth() + 1).padStart(2, '0') + String(n.getDate()).padStart(2, '0')
			+ '-' + String(n.getHours()).padStart(2, '0') + String(n.getMinutes()).padStart(2, '0');
		a.href = URL.createObjectURL(blob);
		a.download = 'study-timer-backup-' + stamp + '.json';
		document.body.appendChild(a); a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
		toast('已导出 ' + activeNodes().length + ' 个节点');
	});

	$('btnImport').addEventListener('click', function () { $('fileImport').click(); });

	$('fileImport').addEventListener('change', function () {
		var file = this.files && this.files[0];
		this.value = '';
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function () {
			try {
				var obj = JSON.parse(reader.result);
				if (!obj || typeof obj !== 'object') { toast('文件格式不对，导入失败'); return; }
				if (typeof obj.totalMin === 'number') {
					data.totalMin = clampNum(obj.totalMin, 1, 600, data.totalMin);
					data.totalMut = Date.now();
				}
				if (typeof obj.endPreMin === 'number') {
					data.endPreMin = clampNum(obj.endPreMin, 0, 120, data.endPreMin);
					data.endPreMut = Date.now();
					preBuiltKey = '';
				}
				var arr = Array.isArray(obj.nodes) ? obj.nodes : [];
				var byId = {};
				var i;
				for (i = 0; i < data.nodes.length; i++) { byId[data.nodes[i].id] = data.nodes[i]; }
				var merged = 0;
				for (i = 0; i < arr.length; i++) {
					var s = arr[i];
					if (!s || typeof s !== 'object') continue;
					var at = clampNum(s.at, 1, 600, 0);
					if (!at) continue;
					var id = (typeof s.id === 'string' && s.id) ? s.id : genId();
					var mut = (typeof s.mut === 'number') ? s.mut : Date.now();
					if (!byId[id] || mut > (byId[id].mut || 0)) {
						byId[id] = { id: id, at: at, pre: clampNum(s.pre, 0, 120, 0), mut: mut, del: !!s.del };
						merged++;
					}
				}
				data.nodes = Object.keys(byId).map(function (k) { return byId[k]; });
				data.nodesMut = Date.now();
				marksBuiltKey = '';
				save(true);
				resetRunState();
				renderAll();
				toast('导入完成：合并 ' + merged + ' 个节点');
			} catch (err) {
				toast('文件解析失败');
			}
		};
		reader.readAsText(file);
	});

	$('btnClear').addEventListener('click', function () {
		var btn = this;
		armConfirm(btn, function () {
			var now = Date.now();
			for (var i = 0; i < data.nodes.length; i++) {
				if (!data.nodes[i].del) {
					data.nodes[i].del = true;
					data.nodes[i].mut = now;
				}
			}
			data.nodesMut = now;
			marksBuiltKey = '';
			save(true);
			resetRunState();
			renderAll();
			toast('节点已清空');
		});
	});

	/* 空格：开始 / 暂停 */
	document.addEventListener('keydown', function (e) {
		if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
		if (e.code === 'Space') {
			e.preventDefault();
			if (run.phase === 'running') $('btnPause').click();
			else $('btnStart').click();
		}
	});

	/* 回到前台时立即校正一次 */
	document.addEventListener('visibilitychange', function () {
		if (!document.hidden) {
			checkAlerts();
			renderAll();
		}
	});

	/* ================= 云同步（Supabase user_data · scope=Study-Timer） ================= */
	/* 站点作用域：一律由 site-scope.js 按路径计算；算不出来就返回空串，
	 * 此时禁止任何云端读写（绝不兜底到 Cube-Formula，那会覆盖别站点数据） */
	function timerScope() {
		return window.getCurrentSiteScope ? window.getCurrentSiteScope() : '';
	}
	var cloud = { on: false, pushTimer: 0, blocked: false };

	function setCloud(text, state) {
		var el = $('cloudState');
		if (!el) return;
		el.textContent = text;
		el.setAttribute('data-state', state || 'local');
	}

	/* 云端那一行是不是本应用写的：靠 data.app 认领
	 * 有内容但没有 app 标记（= 别的站点写的）一律视为「不是我们的」，拒绝上传以防覆盖 */
	function isOwnCloudRow(cd, app) {
		if (!cd || typeof cd !== 'object') return true;
		if (!cd.app) return false;
		return cd.app === app;
	}

	function setScopeConflict(cd) {
		cloud.blocked = true;
		setCloud('作用域冲突', 'err');
		console.error('[Timer] 云端作用域「' + timerScope() + '」里已有其他站点的数据（app=' + (cd && cd.app ? cd.app : '未标记') + '），已拒绝上传以防覆盖');
		toast('云端该作用域已有其他站点的数据，已停止上传');
	}

	function initCloud() {
		if (!window.authManager) { setCloud('本地'); return; }
		if (!timerScope()) {
			setCloud('无作用域', 'err');
			console.warn('[Timer] 当前路径没有可用的站点作用域，已禁用云端同步：' + window.location.pathname);
			return;
		}
		window.authManager.onAuthStateChange(function (user) {
			cloud.on = !!user;
			if (user) {
				setCloud('云端', 'cloud');
				pullCloud();
			} else {
				setCloud('本地', 'local');
			}
		});
	}

	function pullCloud() {
		var client = window.supabaseClient;
		var user = window.authManager && window.authManager.getUser();
		if (!client || !user) return;
		var sc = timerScope();
		if (!sc) { setCloud('无作用域', 'err'); return; }
		client.from('user_data')
			.select('data')
			.eq('user_id', user.id)
			.eq('site_scope', sc)
			.maybeSingle()
			.then(function (result) {
				if (result.error) { setCloud('未同步', 'err'); return; }
				var cd = (result.data && result.data.data) ? result.data.data : null;
				if (!isOwnCloudRow(cd, 'study-timer')) { setScopeConflict(cd); return; }
				if (cd) mergeFromCloud(cd);
			})['catch'](function () { setCloud('未同步', 'err'); });
	}

	function mergeFromCloud(cd) {
		if (!cd || typeof cd !== 'object') return;
		var changed = false;

		if (typeof cd.totalMin === 'number' && (cd.totalMut || 0) > (data.totalMut || 0)) {
			var t = clampNum(cd.totalMin, 1, 600, data.totalMin);
			if (t !== data.totalMin) { data.totalMin = t; changed = true; }
			data.totalMut = cd.totalMut || 0;
		}

		if (typeof cd.endPreMin === 'number' && (cd.endPreMut || 0) > (data.endPreMut || 0)) {
			var ep = clampNum(cd.endPreMin, 0, 120, data.endPreMin);
			if (ep !== data.endPreMin) { data.endPreMin = ep; changed = true; }
			data.endPreMut = cd.endPreMut || 0;
		}

		var byId = {}, i;
		for (i = 0; i < data.nodes.length; i++) { byId[data.nodes[i].id] = data.nodes[i]; }
		var list = Array.isArray(cd.nodes) ? cd.nodes : [];
		var nodesChanged = false;
		for (i = 0; i < list.length; i++) {
			var r = list[i];
			if (!r || typeof r.id !== 'string' || !r.id) continue;
			var at = clampNum(r.at, 1, 600, 0);
			if (!at) continue;
			var mut = (typeof r.mut === 'number') ? r.mut : 0;
			if (!byId[r.id] || mut > (byId[r.id].mut || 0)) {
				byId[r.id] = { id: r.id, at: at, pre: clampNum(r.pre, 0, 120, 0), mut: mut, del: !!r.del };
				nodesChanged = true;
			}
		}
		if (nodesChanged) {
			data.nodes = Object.keys(byId).map(function (k) { return byId[k]; });
			data.nodesMut = cd.nodesMut || Date.now();
			changed = true;
		}

		if (changed) {
			marksBuiltKey = '';
			preBuiltKey = '';
			save(false);
			renderAll();
			toast('已从云端同步');
		}
	}

	function pushCloud() {
		if (!cloud.on || !window.supabaseClient || !window.authManager) return;
		if (cloud.blocked) { setCloud('作用域冲突', 'err'); return; }
		var user = window.authManager.getUser();
		if (!user) return;
		var sc = timerScope();
		if (!sc) { setCloud('无作用域', 'err'); return; }
		if (cloud.pushTimer) window.clearTimeout(cloud.pushTimer);
		setCloud('同步中', 'sync');
		cloud.pushTimer = window.setTimeout(function () {
			cloud.pushTimer = 0;
			window.supabaseClient
				.from('user_data')
				.upsert({
					user_id: user.id,
					site_scope: sc,
					data: {
						version: 1,
						app: 'study-timer',
						exportedAt: new Date().toISOString(),
						totalMin: data.totalMin,
						totalMut: data.totalMut || 0,
						endPreMin: data.endPreMin,
						endPreMut: data.endPreMut || 0,
						nodes: data.nodes,
						nodesMut: data.nodesMut || 0
					},
					updated_at: new Date().toISOString()
				}, { onConflict: 'user_id,site_scope' })
				.then(function (result) {
					setCloud(result.error ? '未同步' : '云端', result.error ? 'err' : 'cloud');
				})['catch'](function () { setCloud('未同步', 'err'); });
		}, 800);
	}

	/* ================= 主题（与全站共享 smartCubeTheme） ================= */
	function initTheme() {
		var saved = null;
		try { saved = localStorage.getItem('smartCubeTheme'); } catch (e) { /* ignore */ }
		var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		var theme = saved || (prefersDark ? 'dark' : 'light');
		applyTheme(theme, false);
	}

	function applyTheme(theme, save2) {
		theme = theme === 'dark' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		var btn = document.getElementById('siteThemeToggle');
		if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
		if (save2 !== false) {
			try { localStorage.setItem('smartCubeTheme', theme); } catch (e) { /* ignore */ }
			if (window.globalDataManager && window.globalDataManager.isReady()) {
				window.globalDataManager.saveThemePreference(theme)['catch'](function (error) {
					console.warn('[Theme] 云端主题同步失败:', error);
				});
			}
		}
	}

	/* ================= 启动 ================= */
	initTheme();

	$('endPreInput').value = data.endPreMin;
	if (window.siteNav && typeof window.siteNav.init === 'function') {
		window.siteNav.init({
			setTheme: function (theme) { applyTheme(theme, true); }
		});
	}

	renderAll();
	initCloud();
	setInterval(function () {
		checkAlerts();
		if (run.phase === 'running' || run.phase === 'paused') {
			renderDial();
			/* 列表只更新数字与进度，避免每秒重建 DOM */
			updateListLive();
		}
	}, 250);

	function updateListLive() {
		var nodes = activeNodes();
		var left = leftMs();
		var cards = $('nodeList').querySelectorAll('.nodeCard');
		for (var i = 0; i < cards.length; i++) {
			var card = cards[i];
			var n = findNode(card.getAttribute('data-id'));
			if (!n) continue;
			var st = nodeState(n, left);
			card.classList.toggle('isHot', st === 'pre');
			card.classList.toggle('isPassed', st === 'passed');
			var inner = card.querySelector('.barInner');
			if (inner) {
				var scale = 1;
				var winTotal = n.pre * 60000;
				var remainInWin = Math.max(0, Math.min(winTotal, left - n.at * 60000));
				scale = remainInWin / winTotal;
				if (st === 'passed') scale = 0;
				inner.style.clipPath = barClipPath(scale);
			}
			var badge = card.querySelector('.nodeBadge');
			var count = card.querySelector('.nodeCount');
			if (st === 'passed') {
				if (badge) { badge.className = 'nodeBadge badgeDone'; badge.textContent = '已到'; }
				if (count) { count.className = 'nodeCount isDone'; count.textContent = '已到'; }
			} else if (st === 'pre') {
				if (badge) { badge.className = 'nodeBadge badgePre'; badge.textContent = '预留中'; }
				if (count) { count.className = 'nodeCount isHot'; count.textContent = fmtClockMs(left - n.at * 60000); }
			} else {
				if (badge) { badge.className = 'nodeBadge'; badge.textContent = n.pre > 0 ? '待预留' : '等待'; }
				if (count) { count.className = 'nodeCount'; count.textContent = fmtClock(left - n.at * 60000); }
			}
			var fireEl = card.querySelector('.nodeFoot .fire');
			if (fireEl) {
				if (n.pre > 0) {
					var fireMs = (n.at + n.pre) * 60000;
					fireEl.textContent = left > fireMs ? ('预留提醒 ' + fmtClock(left - fireMs) + ' 后') : '预留提醒已响';
				} else {
					fireEl.textContent = '无预留';
				}
			}
		}
	}

	/* 启动即同步一次（间隔 250ms 已在上面注册，这里补一次首帧） */
	syncButtons();
})();
