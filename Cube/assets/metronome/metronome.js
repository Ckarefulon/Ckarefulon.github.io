/*
 * Cube Metronome —— 站点共享节拍器功能块（Cube/assets/metronome/）
 * ---------------------------------------------------------------------------
 * 慢拧跟拍：按 TPS 定时发声与回调，节拍音复用站点 CubeAudio（beat.wav）。
 *
 * 契约（window.CubeMetronome）：
 *   start(tps, onBeat)  开始；onBeat(beatIndex, accent)，accent 为每 4 拍第 1 拍（重音）
 *   stop()              停止并清零拍号
 *   setTps(tps)         热改速度：运行中会接着当前拍继续，不打断回调
 *   isRunning()         是否在跑
 *   tps()               当前速度
 *   ensure(cb)          预加载音频；cb(ok)，音频不可用时仍可只用回调（静默节拍）
 *
 * 设计要点（吸收 Trainer 与 Formula Quick Reaction 两版之长）：
 *   - 并发 ensure 走 waiters 队列（Trainer 版），不是 setInterval 轮询（Quick Reaction 版）
 *   - 支持 setTps 热改（Trainer 版；Quick Reaction 版只能停再起）
 *   - setTps 保留当前拍号（两版都会把拍号清零，慢拧提速时听感断拍）
 *   - 纯回调，不碰 DOM（Quick Reaction 版把 DOM 写死在模块里，无法复用）
 *   - 音频不可用时给出明确失败回调，由调用方决定是否提示
 *   - 音频路径由本文件自身定位，调用方不必关心自己在哪一层目录
 */
(function (global) {
	'use strict';

	var MIN_PERIOD_MS = 60;   // 上限约 16.7 tps，防呆
	var ACCENT_EVERY = 4;     // 每 4 拍一个重音

	var state = {
		running: false,
		tps: 2,
		timer: null,
		beat: 0,
		onBeat: null,
		loading: false,
		audioOk: null,       // null=未判定 true/false=已判定
		waiters: []
	};

	/* 音频模块与本文件同属 Cube/assets/<块>/，从自身 src 推出 audio 子目录 */
	function audioUrl() {
		try {
			var s = document.currentScript && document.currentScript.src;
			if (s) return s.replace(/[^/]*$/, '').replace(/[^/]*\/$/, '') + 'audio/cube-audio.js';
		} catch (e) { /* 落到兜底 */ }
		return '../assets/audio/cube-audio.js';
	}

	/* 预加载 CubeAudio：并发调用共用一个 waiters 队列，只插一次 script */
	function ensure(cb) {
		cb = cb || function () {};
		if (global.CubeAudio) { state.audioOk = true; cb(true); return; }
		if (state.audioOk === false) { cb(false); return; }
		state.waiters.push(cb);
		if (state.loading) { return; }
		state.loading = true;
		var s = document.createElement('script');
		s.src = audioUrl();
		s.onload = finishLoad(!!global.CubeAudio);
		s.onerror = function () { finishLoad(false); };
		document.head.appendChild(s);
	}

	function finishLoad(ok) {
		state.loading = false;
		state.audioOk = ok;
		var ws = state.waiters;
		state.waiters = [];
		for (var i = 0; i < ws.length; i++) {
			try { ws[i](ok); } catch (e) { /* 单个回调失败不影响其他 */ }
		}
	}

	function playBeat(accent) {
		try {
			if (global.CubeAudio && typeof global.CubeAudio.effect === 'function') {
				global.CubeAudio.effect('beat', accent ? 1 : 0.72);
			}
		} catch (e) { /* 音频失败不影响节拍回调 */ }
	}

	/* 只重排定时器，不重置拍号 —— setTps 热改与 start 复位用不同入口 */
	function armTimer() {
		if (state.timer) { clearInterval(state.timer); }
		var period = Math.max(MIN_PERIOD_MS, Math.round(1000 / state.tps));
		state.timer = setInterval(function () {
			var accent = (state.beat % ACCENT_EVERY) === 0;
			playBeat(accent);
			if (state.onBeat) {
				try { state.onBeat(state.beat, accent); } catch (e) { /* 调用方异常不该停掉节拍 */ }
			}
			state.beat += 1;
		}, period);
	}

	/* start(tps, onBeat)：总是从头开始（拍号归零） */
	function start(tps, onBeat) {
		stop();
		state.tps = normalizeTps(tps);
		state.beat = 0;
		state.onBeat = typeof onBeat === 'function' ? onBeat : null;
		state.running = true;
		armTimer();
		/* 音频异步就绪；就绪前节拍照走（静默），到了就自动出声 */
		ensure(function (ok) { state.audioOk = ok; });
	}

	/* setTps(tps)：热改速度，保留拍号（慢拧提速时听感不断拍） */
	function setTps(tps) {
		state.tps = normalizeTps(tps);
		if (state.running) { armTimer(); }
		return state.tps;
	}

	function normalizeTps(tps) {
		var v = Number(tps);
		if (!isFinite(v) || v <= 0) { v = 2; }
		return Math.min(20, Math.max(0.25, v));
	}

	function stop() {
		if (state.timer) { clearInterval(state.timer); state.timer = null; }
		state.running = false;
		state.beat = 0;
	}

	global.CubeMetronome = {
		start: start,
		stop: stop,
		setTps: setTps,
		isRunning: function () { return state.running; },
		tps: function () { return state.tps; },
		ensure: ensure,
		ACCENT_EVERY: ACCENT_EVERY
	};
})(typeof window !== 'undefined' ? window : this);
