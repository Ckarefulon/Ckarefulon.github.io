/*
 * 智能魔方蓝牙桥（Cube 公用）
 * ---------------------------------------------------------------------------
 * 「选设备 → 连线 → 转动事件 → 面位」这一层各页都要用，但底层适配层
 * （Cube/assets/bluetooth/*：giiker / gocube / gancube / moyu / qiyi）与面位差分
 * 逻辑不该在每个页面各写一遍，所以收口到这里：
 *
 *   window.CubeSmartCube = {
 *     on(type, fn)                    // connecting | connect | disconnect | state | move | gyro
 *     connect() / disconnect()
 *     isConnected() / isConnecting() / getDeviceName() / getFacelet() / isSolved(f)
 *     battery()
 *     ingestLogicalMove(move, meta)   // 页面自己识别出的逻辑步（如双层→中层）喂回来
 *     ensureLoaded()                  // 只预加载适配层，不弹选设备框
 *     flushPending()
 *   }
 *
 * 兼容旧名：window.CubeAnalyzerSmartCube 指向同一个对象（Analyzer 既有代码与
 * 测试都按这个名字取；改名不影响它们）。
 *
 * 事件口径：
 *   move   { move, logicalMove, rawMoves, timestamp, previousFacelet, facelet,
 *            isSlice, isRotation, solved, deviceName }
 *   state  { facelet, solved, deviceName }
 *   gyro   { x, y, z, w, timestamp, deviceName }
 *
 * 依赖（由调用页保证加载顺序，见 ensureLoaded 的 NEEDS 清单）：
 *   base/compat.js → codec/{lzstring,sha256,isaac}.js → cube-solve/mathlib.js
 *   → bluetooth/*（本文件自己按需补，缺谁补谁）
 *
 * 关于面位差额补发（replayConnectGap）：
 *   握手期（选设备 / 读 MAC 阶段）的转动不会上报为 move，只会体现在连接基线的
 *   初始面位里。与连接前已知面位差 1~2 步就把落差补发（算法在 facelet-gap.js）。
 */
(function (root) {
	'use strict';

	var SLICE_WINDOW_MS = 90;

	/* 适配层与本模块的依赖清单：ensureLoaded 按这个顺序补，缺一个都不接。
	 *
	 * ⚠️ 顺序是硬的，不能换（踩过）：
	 *   jquery 必须最先 —— sha256.js 是把 $.sha256 / $.aes128 挂在 jQuery 上的，
	 *     jQuery 不在，那一行就 ReferenceError，GAN / 魔域 / 奇艺的解密全废，
	 *     表面上却只是「连上也拧不动」；
	 *   compat.js 次之 —— 提供 DEBUG / execMain / kernel / giikerutil 与相机、
	 *     提示等全局，各适配层在加载期就要用；
	 *   mathlib 再次 —— 适配层拿它做 CubieCube 换算（gocube / moyu / gan 都用）。
	 *
	 * global 是该文件「加载完成后一定存在的全局」，用来跳过已加载项；调用页如果
	 * 已经在 head 里静态引过其中几个，这里一个都不会重复拉。 */
	var NEEDS = [
		{ path: '/Cube/assets/base/jquery-4.0.0.min.js', ready: function () { return !!root.jQuery; } },
		{ path: '/Cube/assets/base/compat.js', ready: function () { return !!root.giikerutil; } },
		{ path: '/Cube/assets/codec/isaac.js', ready: function () { return !!root.isaac; } },
		{ path: '/Cube/assets/codec/lzstring.js', ready: function () { return !!root.LZString; } },
		/* sha256.js 把 $.sha256 / $.aes128 挂到 jQuery 上，没有自己的全局，按方法判 */
		{ path: '/Cube/assets/codec/sha256.js', ready: function () { return !!(root.jQuery && root.jQuery.aes128); } },
		{ path: '/Cube/assets/cube-solve/mathlib.js', ready: function () { return !!root.mathlib; } },
		{ path: '/Cube/assets/bluetooth/bluetooth.js', ready: function () { return !!root.GiikerCube; } },
		{ path: '/Cube/assets/bluetooth/giikercube.js', ready: null },
		{ path: '/Cube/assets/bluetooth/gocube.js', ready: null },
		{ path: '/Cube/assets/bluetooth/gancube.js', ready: null },
		{ path: '/Cube/assets/bluetooth/moyucube.js', ready: null },
		{ path: '/Cube/assets/bluetooth/moyu32cube.js', ready: null },
		{ path: '/Cube/assets/bluetooth/qiyicube.js', ready: null },
		{ path: '/Cube/assets/bluetooth/facelet-gap.js', ready: function () { return !!root.CubeFaceletGap; } }
	];
	var LOAD_VERSION = '2683';

	var listeners = new Map();
	var loadState = { started: false, promise: null };

	var connected = false;
	var connecting = false;
	var deviceName = '';
	var lastHistory = [];
	var lastStamp = null;
	var lastDeliveredTs = null;
	var ignoreInitialState = true;
	var preConnectFacelet = '';
	var latestFacelet = '';
	var pending = null;
	var pendingTimer = null;

	/* ================= 事件总线 ================= */

	function emit(type, detail) {
		var set = listeners.get(type);
		if (!set) { return; }
		detail = detail || {};
		set.forEach(function (fn) {
			try { fn(detail); } catch (e) { console.error('[CubeSmartCube]', type, e); }
		});
	}

	function on(type, fn) {
		if (typeof fn !== 'function') { return function () {}; }
		if (!listeners.has(type)) { listeners.set(type, new Set()); }
		listeners.get(type).add(fn);
		return function () {
			var s = listeners.get(type);
			if (s) { s.delete(fn); }
		};
	}

	/* ================= 适配层懒加载 ================= */

	function scriptTagged(rel) {
		return document.querySelector('script[data-cube-bt="' + rel + '"]');
	}

	function loadOne(rel) {
		return new Promise(function (resolve) {
			if (scriptTagged(rel)) { resolve(); return; }
			var s = document.createElement('script');
			s.src = rel + '?v=' + LOAD_VERSION;
			s.defer = true;
			s.dataset.cubeBt = rel;
			s.onload = function () { resolve(); };
			s.onerror = function () { resolve(); };   /* 单个失败不拖死整串，缺谁下面再判 */
			document.head.appendChild(s);
		});
	}

	/* 按 NEEDS 顺序串行补：已加载的按 ready 判据跳过。
	 * 判据用「该文件加载后必然存在的全局」，不是 script 标签 —— 调用页可能已经在
	 * head 里静态引过其中几个，这里就该一个都不重复拉。 */
	function ensureLoaded() {
		if (loadState.promise) { return loadState.promise; }
		loadState.started = true;
		loadState.promise = NEEDS.reduce(function (chain, item) {
			return chain.then(function () {
				if (item.ready && item.ready()) { return null; }
				return loadOne(item.path).then(function () { return null; });
			});
		}, Promise.resolve()).then(function () {
			return !!root.GiikerCube;
		});
		return loadState.promise;
	}

	/* ================= 记号归一 ================= */

	function textOf(raw) {
		if (raw == null) { return ''; }
		if (typeof raw === 'string') { return raw; }
		return raw.move || raw.text || raw.notation || '';
	}

	function normalizeFaceMove(raw) {
		var text = String(textOf(raw)).trim().replace(/[\u2019`]/g, "'");
		var m = text.match(/^([URFDLB])([23]?)(\'?)$/i);
		if (!m) { return null; }
		var face = m[1].toUpperCase();
		if (m[2] === '2') { return face + '2'; }
		if (m[2] === '3' || m[3]) { return face + "'"; }
		return face;
	}

	function normalizeLogicalMove(raw) {
		var text = String(textOf(raw)).trim().replace(/[\u2019`]/g, "'");
		var m = text.match(/^([URFDLBMESxyz]|[URFDLB]w)([23]?)(\'?)$/i);
		if (!m) { return null; }
		var base = /^[xyz]$/i.test(m[1]) ? m[1].toLowerCase() : m[1];
		if (m[2] === '2') { return base + '2'; }
		if (m[2] === '3' || m[3]) { return base + "'"; }
		return base;
	}

	function normalizeHistory(prevMoves) {
		var out = [];
		for (var i = 0; prevMoves && i < prevMoves.length; i++) {
			var move = normalizeFaceMove(prevMoves[i]);
			if (move) { out.push(move); }
		}
		return out;
	}

	function isSolved(facelet) {
		var s = String(facelet || '').trim().toUpperCase();
		if (s.length !== 54) { return false; }
		var centers = [];
		for (var i = 0; i < 54; i += 9) {
			var part = s.slice(i, i + 9);
			for (var j = 1; j < 9; j++) {
				if (part.charAt(j) !== part.charAt(0)) { return false; }
			}
			centers.push(part.charAt(0));
		}
		return new Set(centers).size === 6;
	}

	/* ================= 时间戳 ================= */

	function timestampInfo(lastTs) {
		var now = Date.now();
		if (Array.isArray(lastTs)) {
			var hardware = Number(lastTs[0]);
			var local = Number(lastTs[1]);
			var hwOk = isFinite(hardware) ? hardware : null;
			var localOk = isFinite(local) ? local : now;
			var hwLooksLocal = hwOk != null && Math.abs(hwOk - localOk) <= 10000;
			return { hardwareTimestamp: hwOk, localTimestamp: localOk, timestamp: hwLooksLocal ? hwOk : localOk };
		}
		var n = Number(lastTs);
		var hw = isFinite(n) ? n : null;
		var hwLooks = hw != null && Math.abs(hw - now) <= 10000;
		return { hardwareTimestamp: hw, localTimestamp: now, timestamp: hwLooks ? hw : now };
	}

	function historiesEqual(a, b) {
		if (a.length !== b.length) { return false; }
		for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
		return true;
	}

	/* 硬件历史是「最新在前」。若期间来了 N 步，旧历史的开头就在 current[N]。 */
	function findHistoryOverlap(current, previous) {
		for (var offset = 0; offset < current.length; offset++) {
			var match = 0;
			while (match < previous.length && offset + match < current.length &&
				current[offset + match] === previous[match]) { match++; }
			if (previous.length && match === Math.min(previous.length, current.length - offset)) { return offset; }
		}
		return -1;
	}

	function getNewMoves(prevMoves, lastTs) {
		var current = normalizeHistory(prevMoves);
		var stamp = timestampInfo(lastTs).timestamp;
		if (!current.length) { lastStamp = stamp; return []; }

		/* 同一份历史配一个刷新过的驱动时间戳，仍然是同一份历史 */
		if (lastHistory.length && historiesEqual(current, lastHistory)) {
			lastStamp = stamp;
			return [];
		}

		var newCount = 1;
		if (lastHistory.length) {
			var offset = findHistoryOverlap(current, lastHistory);
			if (offset >= 0) { newCount = offset; }
		}
		lastHistory = current.slice(0, 12);
		lastStamp = stamp;
		if (newCount <= 0) { return []; }
		return current.slice(0, Math.min(newCount, current.length)).reverse();
	}

	function saveHistory(prevMoves, lastTs) {
		var current = normalizeHistory(prevMoves);
		if (current.length) { lastHistory = current.slice(0, 12); }
		lastStamp = timestampInfo(lastTs).timestamp;
	}

	/* ================= 中层（M/E/S）识别 =================
	 * 部分硬件把 M 报成同时的 R + L'。90ms 窗口内成对出现且能配成切片就合成一步，
	 * 否则按普通面转分别下发（宁可多报面转，不缺步）。 */

	function clearPendingTimer() {
		if (pendingTimer) { clearTimeout(pendingTimer); }
		pendingTimer = null;
	}

	function emitLogical(detail) {
		var move = normalizeLogicalMove(detail.move);
		if (!move) { return; }
		var rawMoves = Array.isArray(detail.rawMoves)
			? detail.rawMoves.map(normalizeFaceMove).filter(Boolean) : [];
		emit('move', Object.assign({}, detail, {
			move: move,
			logicalMove: move,
			rawMoves: rawMoves,
			isSlice: /^[MES]/.test(move),
			isRotation: /^[xyz]/.test(move),
			solved: !!detail.facelet && isSolved(detail.facelet),
			deviceName: deviceName || '智能魔方'
		}));
		if (isFinite(Number(detail.timestamp))) { lastDeliveredTs = Number(detail.timestamp); }
	}

	function flushPending() {
		if (!pending) { return; }
		var p = pending;
		pending = null;
		clearPendingTimer();
		emitLogical({
			move: p.move,
			rawMoves: [p.move],
			timestamp: p.timestamp,
			hardwareTimestamp: p.hardwareTimestamp,
			localTimestamp: p.localTimestamp,
			previousFacelet: p.previousFacelet,
			facelet: p.facelet,
			batchFinal: p.batchFinal
		});
	}

	function sliceFromPair(a, b) {
		var pair = new Set([a, b]);
		function same(x, y) { return pair.size === 2 && pair.has(x) && pair.has(y); }
		if (same('R', "L'")) { return 'M'; }
		if (same("R'", 'L')) { return "M'"; }
		if (same('U', "D'")) { return 'E'; }
		if (same("U'", 'D')) { return "E'"; }
		if (same("F'", 'B')) { return 'S'; }
		if (same('F', "B'")) { return "S'"; }
		if (same('R2', 'L2')) { return 'M2'; }
		if (same('U2', 'D2')) { return 'E2'; }
		if (same('F2', 'B2')) { return 'S2'; }
		return null;
	}

	function canStartSlice(move) {
		return /^[URFDLB](?:2|')?$/.test(move);
	}

	function processRawMove(event) {
		var move = normalizeFaceMove(event.move);
		if (!move) { return; }

		if (pending && Math.abs(Number(event.timestamp) - Number(pending.timestamp)) <= SLICE_WINDOW_MS) {
			var slice = sliceFromPair(pending.move, move);
			if (slice) {
				var first = pending;
				pending = null;
				clearPendingTimer();
				emitLogical({
					move: slice,
					rawMoves: [first.move, move],
					timestamp: event.timestamp,
					startTimestamp: first.timestamp,
					hardwareTimestamp: event.hardwareTimestamp,
					localTimestamp: event.localTimestamp,
					previousFacelet: first.previousFacelet,
					facelet: event.facelet || first.facelet,
					batchFinal: event.batchFinal
				});
				return;
			}
		}

		flushPending();
		if (canStartSlice(move)) {
			pending = Object.assign({}, event, { move: move });
			pendingTimer = setTimeout(flushPending, SLICE_WINDOW_MS);
			return;
		}
		emitLogical(Object.assign({}, event, { move: move, rawMoves: [move] }));
	}

	function interpolatedTimes(count, endTs) {
		if (count <= 1) { return [endTs]; }
		var start = Number(lastDeliveredTs);
		if (!isFinite(start) || start >= endTs) { start = endTs - Math.max(count - 1, 1) * 35; }
		var available = Math.max(count, endTs - start);
		var step = Math.max(1, Math.min(120, available / count));
		var first = endTs - step * (count - 1);
		var out = [];
		for (var i = 0; i < count; i++) { out.push(first + step * i); }
		return out;
	}

	/* ================= 硬件回调 ================= */

	function callback(facelet, prevMoves, lastTs, hardware) {
		if (hardware) { deviceName = String(hardware); }
		var previousFacelet = latestFacelet;
		if (typeof facelet === 'string' && facelet.length >= 54) { latestFacelet = facelet; }

		if (ignoreInitialState) {
			saveHistory(prevMoves, lastTs);
			ignoreInitialState = false;
			emit('state', { facelet: facelet, solved: isSolved(facelet), deviceName: deviceName });
			replayConnectGap(facelet, lastTs);
			return;
		}

		var moves = getNewMoves(prevMoves, lastTs);
		var timing = timestampInfo(lastTs);
		if (!moves.length) {
			/* BLE 常把同一份「最新在前」历史连时间戳一起重发。此时别急着把
			 * 正等另一半的面转吐出去 —— 90ms 的定时器自己会兜底。 */
			if (pending) {
				if (typeof facelet === 'string' && facelet.length === 54) { pending.facelet = facelet; }
				return;
			}
			emit('state', { facelet: facelet, solved: isSolved(facelet), deviceName: deviceName });
			return;
		}

		var times = interpolatedTimes(moves.length, timing.timestamp);
		for (var i = 0; i < moves.length; i++) {
			var last = i === moves.length - 1;
			processRawMove({
				move: moves[i],
				timestamp: times[i],
				hardwareTimestamp: timing.hardwareTimestamp,
				localTimestamp: timing.localTimestamp,
				previousFacelet: i === 0 ? previousFacelet : null,
				facelet: last ? facelet : null,
				batchFinal: last
			});
		}

		/* 面转还在等 90ms 配对窗口时不要发 state，免得下游拿到半拍的状态 */
		if (!pending) {
			emit('state', { facelet: facelet, solved: isSolved(facelet), deviceName: deviceName });
		}
	}

	/* 握手期落差补发：与连接前已知面位差 1~2 步就补，差更多不动。 */
	function replayConnectGap(facelet, lastTs) {
		if (!preConnectFacelet || typeof facelet !== 'string' || facelet.length < 54) { return; }
		if (preConnectFacelet === facelet) { return; }
		if (!root.CubeFaceletGap || typeof root.CubeFaceletGap.gapMoves !== 'function') { return; }
		var gap = root.CubeFaceletGap.gapMoves(preConnectFacelet, facelet, 2);
		if (!gap || !gap.length) { return; }
		var timing = timestampInfo(lastTs);
		var times = interpolatedTimes(gap.length, timing.timestamp);
		for (var i = 0; i < gap.length; i++) {
			var last = i === gap.length - 1;
			processRawMove({
				move: gap[i],
				timestamp: times[i],
				hardwareTimestamp: timing.hardwareTimestamp,
				localTimestamp: timing.localTimestamp,
				previousFacelet: i === 0 ? preConnectFacelet : null,
				facelet: last ? facelet : null,
				batchFinal: last
			});
		}
	}

	function gyroCallback(x, y, z, w, hardware) {
		if (hardware) { deviceName = String(hardware); }
		emit('gyro', {
			x: Number(x), y: Number(y), z: Number(z), w: Number(w),
			timestamp: Date.now(), deviceName: deviceName || '智能魔方'
		});
	}

	/* ================= 连接 ================= */

	function connect() {
		if (connecting) { return Promise.resolve(false); }
		if (connected) { return disconnect(); }
		if (!navigator.bluetooth) {
			return Promise.reject(new Error('当前浏览器不支持 Web Bluetooth，请使用 Chrome / Edge 并通过 HTTPS 打开页面'));
		}
		emit('connecting');
		connecting = true;
		ignoreInitialState = true;
		lastHistory = [];
		lastStamp = null;
		lastDeliveredTs = null;
		/* 连接前已知面位：断线重连时是上次实时状态；整页刷新后没有已知状态，
		 * 按复原态处理（与 Formula 显示侧从复原起步的口径一致）。 */
		preConnectFacelet = latestFacelet ||
			(root.mathlib && root.mathlib.SOLVED_FACELET) ||
			'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
		latestFacelet = '';
		pending = null;
		clearPendingTimer();

		return ensureLoaded().then(function (ok) {
			if (!ok || !root.GiikerCube) {
				throw new Error('智能魔方适配层未加载（检查 /Cube/assets/bluetooth/ 下的脚本）');
			}
			root.GiikerCube.setCallback(callback);
			if (typeof root.GiikerCube.setGyroCallback === 'function') {
				root.GiikerCube.setGyroCallback(gyroCallback);
			}
			root.GiikerCube.setEventCallback(function (info) {
				if (info === 'disconnect') {
					connected = false;
					connecting = false;
					lastHistory = [];
					lastStamp = null;
					pending = null;
					clearPendingTimer();
					emit('disconnect');
				}
			});
			return root.GiikerCube.init();
		}).then(function () {
			connected = true;
			connecting = false;
			emit('connect', { deviceName: deviceName || '智能魔方' });
			return true;
		}).catch(function (e) {
			connected = false;
			connecting = false;
			var raw = String((e && (e.message || e)) || '连接失败');
			if (/cancel|chooser|User cancelled|NotFoundError/i.test(raw)) {
				throw new Error('已取消选择设备');
			}
			throw new Error(raw);
		});
	}

	function disconnect() {
		flushPending();
		if (!root.GiikerCube) {
			connected = false;
			connecting = false;
			emit('disconnect');
			return Promise.resolve();
		}
		return Promise.resolve(root.GiikerCube.stop()).catch(function (e) {
			console.warn('[CubeSmartCube] stop', e);
		}).then(function () {
			connected = false;
			connecting = false;
			lastHistory = [];
			lastStamp = null;
			lastDeliveredTs = null;
			pending = null;
			clearPendingTimer();
			emit('disconnect');
		});
	}

	function battery() {
		try {
			var cube = root.GiikerCube && root.GiikerCube.getCube && root.GiikerCube.getCube();
			if (cube && typeof cube.getBatteryLevel === 'function') {
				return Promise.resolve(cube.getBatteryLevel()).catch(function () { return null; });
			}
		} catch (e) { /* 没有电量通道就当没有 */ }
		return Promise.resolve(null);
	}

	/* 页面侧自己识别出的逻辑步（例如把两个面转合成 M）从这个口喂回来，
	 * 不必改本模块的配对时序。 */
	function ingestLogicalMove(move, meta) {
		meta = meta || {};
		var logical = normalizeLogicalMove(move);
		if (!logical) { return false; }
		flushPending();
		emitLogical({
			move: logical,
			rawMoves: meta.rawMoves || [],
			timestamp: isFinite(Number(meta.timestamp)) ? Number(meta.timestamp) : Date.now(),
			hardwareTimestamp: meta.hardwareTimestamp == null ? null : meta.hardwareTimestamp,
			localTimestamp: meta.localTimestamp == null ? Date.now() : meta.localTimestamp,
			previousFacelet: meta.previousFacelet || latestFacelet || null,
			facelet: meta.facelet || latestFacelet || null,
			source: meta.source || 'logical'
		});
		return true;
	}

	var api = {
		on: on,
		connect: connect,
		disconnect: disconnect,
		battery: battery,
		ingestLogicalMove: ingestLogicalMove,
		ensureLoaded: ensureLoaded,
		flushPending: flushPending,
		isConnected: function () { return connected; },
		isConnecting: function () { return connecting; },
		isSupported: function () { return !!navigator.bluetooth; },
		getDeviceName: function () { return deviceName || '智能魔方'; },
		getFacelet: function () { return latestFacelet; },
		isSolved: isSolved,
		normalizeMove: normalizeLogicalMove,
		normalizeFaceMove: normalizeFaceMove,
		sliceFromPair: sliceFromPair,
		getNewMoves: getNewMoves,
		ADAPTERS: NEEDS,
		LOAD_VERSION: LOAD_VERSION,
		/* 兼容旧内部名（Analyzer 的测试与老代码按带下划线的名字取） */
		_getNewMoves: getNewMoves,
		_sliceFromPair: sliceFromPair,
		_flushPending: flushPending
	};

	root.CubeSmartCube = api;
	/* 旧名同指一个对象：Analyzer 既有代码与历史测试都按这个名字取 */
	root.CubeAnalyzerSmartCube = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
