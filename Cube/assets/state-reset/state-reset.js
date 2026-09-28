execMain(function() {
	// 状态重置功能块（Cube 公用）：给已连接的 GAN 智能魔方发 REQUEST_RESET，
	// 让魔方把「当前物理姿态」认作复原态（内部面位清零）。驱动能力在
	// ../bluetooth/gancube.js（requestReset），本模块只管交互：两段式确认、
	// 执行态、结果反馈。页面 mount 后拿到按钮，无需自己写一份样式。
	// 用法：window.CubeStateReset.mount(el, { onStatus(text, kind) }) → { destroy }
	// kind: 'info' | 'warn' | 'ok' | 'err'
	function mount(el, opts) {
		opts = opts || {};
		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'cubeStateResetBtn';
		btn.title = '把魔方当前状态认作复原态（重置魔方内部面位）';
		btn.textContent = '状态重置';
		el.appendChild(btn);

		var armed = false;
		var busy = false;
		var confirmTimer = null;

		function setStatus(text, kind) {
			if (typeof opts.onStatus === 'function') {
				opts.onStatus(text, kind || 'info');
			}
		}

		function disarm() {
			armed = false;
			btn.classList.remove('isConfirm');
			btn.textContent = '状态重置';
			if (confirmTimer) {
				clearTimeout(confirmTimer);
				confirmTimer = null;
			}
		}

		btn.addEventListener('click', function() {
			if (busy) {
				return;
			}
			if (!window.GiikerCube || !GiikerCube.isConnected()) {
				disarm();
				setStatus('状态重置：魔方未连接', 'err');
				return;
			}
			var cube = GiikerCube.getCube();
			if (!cube || typeof cube.requestReset !== 'function') {
				setStatus('状态重置：当前魔方不支持该命令', 'err');
				return;
			}
			if (!armed) {
				armed = true;
				btn.classList.add('isConfirm');
				btn.textContent = '确认重置？';
				setStatus('状态重置：将把魔方当前状态认作复原态，重置期间请勿转动魔方', 'warn');
				confirmTimer = setTimeout(disarm, 6000);
				return;
			}
			disarm();
			busy = true;
			btn.classList.add('isBusy');
			btn.textContent = '重置中…';
			setStatus('状态重置：执行中，请勿转动魔方…', 'warn');
			cube.requestReset().then(function() {
				busy = false;
				btn.classList.remove('isBusy');
				setStatus('状态重置：完成，魔方当前状态已认作复原态', 'ok');
			}, function(err) {
				busy = false;
				btn.classList.remove('isBusy');
				setStatus('状态重置失败：' + String((err && err.message) || err), 'err');
			});
		});

		return {
			destroy: function() {
				disarm();
				btn.remove();
			}
		};
	}

	window.CubeStateReset = {
		mount: mount
	};
});
