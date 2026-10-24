/*
 * Cube/Cross · 解法回放条（懒加载模块）
 *
 * 由 cross-app.js 在打开 3D 预览弹窗时按需插入 <script>（cross-replay.js?v=…），
 * 所以这里连样式（cross-replay.css）都要自己带上，不参与页面首屏加载。
 *
 * 分工：本模块只管按钮和节奏，转动一律交给 request(n)——
 *   调用方自己知道「当前真正应用到第几步」，连续点、乱点、跨步都由它保证顺序正确。
 *   state.step 只是「想停在第几步」（用来显示 3 / 8 和当前转动）。
 * 回放不按真实计时，就是一步一步往下转。
 */
(function (global) {
	'use strict';

	var CSS_HREF = 'cross-replay.css?v=2317';
	var SPEEDS = [0.5, 1, 2, 4];
	var BASE_GAP = 640;              // 1× 时两步之间留多久（ms）
	var state = { tokens: null, step: 0, playing: false, speed: 1, timer: 0, request: null };
	var dom = {};

	function ensureCss() {
		if (document.getElementById('crossReplayCss')) { return; }
		var link = document.createElement('link');
		link.id = 'crossReplayCss';
		link.rel = 'stylesheet';
		link.href = CSS_HREF;
		document.head.appendChild(link);
	}

	function make(tag, className, text) {
		var node = document.createElement(tag);
		if (className) { node.className = className; }
		if (text) { node.textContent = text; }
		return node;
	}

	function total() { return state.tokens ? state.tokens.length : 0; }

	function gap() { return Math.round(BASE_GAP / state.speed); }

	function clearTimer() {
		if (state.timer) { global.clearTimeout(state.timer); state.timer = 0; }
	}

	function paint() {
		if (!dom.step) { return; }
		var n = total();
		dom.step.textContent = state.step + ' / ' + n;
		dom.token.textContent = state.step > 0 ? state.tokens[state.step - 1] : '起点';
		dom.toggle.textContent = state.playing ? '❚❚ 暂停' : '▶ 播放';
		dom.toggle.classList.toggle('isPlaying', state.playing);
		dom.prev.disabled = state.step <= 0;
		dom.next.disabled = state.step >= n;
		for (var i = 0; i < dom.speeds.length; i++) {
			dom.speeds[i].classList.toggle('isActive', Number(dom.speeds[i].dataset.speed) === state.speed);
		}
	}

	/* 到第 n 步：只改「想停在哪」，怎么转由 request 负责 */
	function setStep(n) {
		n = Math.max(0, Math.min(total(), Math.round(n) || 0));
		if (n === state.step) { return; }
		state.step = n;
		paint();
		if (state.request) { state.request(n); }
	}

	function stop() {
		state.playing = false;
		clearTimer();
		paint();
	}

	function schedule() {
		clearTimer();
		if (!state.playing) { return; }
		state.timer = global.setTimeout(function () {
			state.timer = 0;
			if (!state.playing) { return; }
			if (state.step >= total()) { stop(); return; }
			setStep(state.step + 1);
			schedule();
		}, gap());
	}

	function play() {
		if (!total()) { return; }
		if (state.step >= total()) { setStep(0); }        // 播完了再点播放 = 从头放
		state.playing = true;
		paint();
		setStep(state.step + 1);                          // 第一下立刻走，不等一整个间隔
		schedule();
	}

	function toggle() {
		if (state.playing) { stop(); } else { play(); }
	}

	/* ---------------- 挂载 / 卸载 ---------------- */
	function unmount() {
		stop();
		if (dom.host) {
			dom.host.innerHTML = '';
			dom.host.hidden = true;
		}
		state.tokens = null;
		state.step = 0;
		state.playing = false;
		state.timer = 0;
		state.request = null;
		dom = {};
	}

	function mount(opts) {
		unmount();
		if (!opts || !opts.host || !opts.tokens || !opts.tokens.length) { return null; }
		ensureCss();

		state.tokens = opts.tokens;
		state.step = 0;
		state.playing = false;
		state.speed = opts.speed || 1;
		state.request = typeof opts.request === 'function' ? opts.request : null;

		var host = opts.host;
		host.innerHTML = '';
		host.hidden = false;

		var bar = make('div', 'rplBar');
		var left = make('div', 'rplLeft');

		var start = make('button', 'rplBtn', '«');
		start.type = 'button';
		start.title = '回到起点';
		start.addEventListener('click', function () { stop(); setStep(0); });

		var prev = make('button', 'rplBtn', '‹ 上一步');
		prev.type = 'button';
		prev.title = '上一步';
		prev.addEventListener('click', function () { stop(); setStep(state.step - 1); });

		var toggleBtn = make('button', 'rplBtn rplMain', '▶ 播放');
		toggleBtn.type = 'button';
		toggleBtn.title = '播放 / 暂停';
		toggleBtn.addEventListener('click', toggle);

		var next = make('button', 'rplBtn', '下一步 ›');
		next.type = 'button';
		next.title = '下一步';
		next.addEventListener('click', function () { stop(); setStep(state.step + 1); });

		var end = make('button', 'rplBtn', '»');
		end.type = 'button';
		end.title = '跳到终点';
		end.addEventListener('click', function () { stop(); setStep(total()); });

		left.appendChild(start);
		left.appendChild(prev);
		left.appendChild(toggleBtn);
		left.appendChild(next);
		left.appendChild(end);

		var stepLabel = make('span', 'rplStep', '0 / 0');
		var token = make('span', 'rplToken', '起点');
		var spacer = make('span', 'rplSpacer');

		var speeds = make('div', 'rplSpeeds');
		speeds.setAttribute('role', 'group');
		speeds.setAttribute('aria-label', '倍速');
		var speedBtns = [];
		for (var i = 0; i < SPEEDS.length; i++) {
			(function (sp) {
				var b = make('button', 'rplSpeed', sp + '×');
				b.type = 'button';
				b.dataset.speed = String(sp);
				b.addEventListener('click', function () {
					state.speed = sp;
					paint();
					if (state.playing) { schedule(); }    // 播放中换倍速：下一拍用新间隔
				});
				speedBtns.push(b);
				speeds.appendChild(b);
			})(SPEEDS[i]);
		}

		bar.appendChild(left);
		bar.appendChild(stepLabel);
		bar.appendChild(token);
		bar.appendChild(spacer);
		bar.appendChild(speeds);
		host.appendChild(bar);

		dom = {
			host: host, step: stepLabel, token: token,
			prev: prev, next: next, toggle: toggleBtn, speeds: speedBtns
		};
		paint();
		return api;
	}

	var api = {
		mount: mount, unmount: unmount, state: state,
		play: play, pause: stop, toggle: toggle, setStep: setStep
	};

	global.CrossReplay = api;
})(window);
