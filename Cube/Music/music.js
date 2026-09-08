(function () {
	"use strict";

	/* ============================================================
	   数据定义
	   ============================================================ */

	var STORAGE_KEY = "cubeMusicSettings";
	var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

	// move -> 简谱唱名 + 八度偏移
	var MOVE_MAP = [
		{ move: "R", deg: 1, oct: 0, slice: false },
		{ move: "R'", deg: 2, oct: 0, slice: false },
		{ move: "U", deg: 3, oct: 0, slice: false },
		{ move: "U'", deg: 5, oct: 0, slice: false },
		{ move: "F", deg: 6, oct: 0, slice: false },
		{ move: "F'", deg: 6, oct: -1, slice: false },
		{ move: "D", deg: 5, oct: -1, slice: false },
		{ move: "D'", deg: 1, oct: 1, slice: false },
		{ move: "L", deg: 3, oct: -1, slice: false },
		{ move: "L'", deg: 2, oct: 1, slice: false },
		{ move: "B", deg: 6, oct: 1, slice: false },
		{ move: "B'", deg: 1, oct: 2, slice: false },
		{ move: "M", deg: 3, oct: 1, slice: true },
		{ move: "M'", deg: 5, oct: 1, slice: true },
		{ move: "S", deg: 2, oct: -1, slice: true },
		{ move: "S'", deg: 1, oct: -1, slice: true },
		{ move: "E", deg: 2, oct: 2, slice: true },
		{ move: "E'", deg: 6, oct: -2, slice: true }
	];

	// 调式：degree -> 相对主音的半音数
	var MODES = [
		{ id: "gong", label: "宫", deg: { 1: 0, 2: 2, 3: 4, 5: 7, 6: 9 } },
		{ id: "shang", label: "商", deg: { 1: 10, 2: 0, 3: 2, 5: 5, 6: 7 } },
		{ id: "jue", label: "角", deg: { 1: 8, 2: 10, 3: 0, 5: 3, 6: 5 } },
		{ id: "zhi", label: "徵", deg: { 1: 5, 2: 7, 3: 9, 5: 0, 6: 2 } },
		{ id: "yu", label: "羽", deg: { 1: 3, 2: 5, 3: 7, 5: 10, 6: 0 } },
		{ id: "major", label: "大调", deg: { 1: 0, 2: 2, 3: 4, 5: 7, 6: 9 } },
		{ id: "minor", label: "小调", deg: { 1: 0, 2: 2, 3: 3, 5: 7, 6: 8 } }
	];

	var TONES = [
		{ id: "piano", label: "钢琴" },
		{ id: "musicbox", label: "音乐盒" },
		{ id: "bell", label: "钟琴" },
		{ id: "guitar", label: "吉他" },
		{ id: "sine", label: "正弦" },
		{ id: "triangle", label: "三角" },
		{ id: "square", label: "方波" },
		{ id: "sawtooth", label: "锯齿" }
	];

	// 中层切片：由两个外层转动组合识别（顺序无关）
	var SLICE_PAIRS = [
		{ slice: "M", a: "R", b: "L'" },
		{ slice: "M'", a: "R'", b: "L" },
		{ slice: "E", a: "U", b: "D'" },
		{ slice: "E'", a: "U'", b: "D" },
		{ slice: "S", a: "F'", b: "B" },
		{ slice: "S'", a: "F", b: "B'" }
	];
	var SLICE_STARTERS = ["R", "R'", "L", "L'", "U", "U'", "D", "D'", "F", "F'", "B", "B'"];

	var MOVE_INDEX = {};
	MOVE_MAP.forEach(function (item) {
		MOVE_INDEX[item.move] = item;
	});

	/* ============================================================
	   设置
	   ============================================================ */

	var settings = {
		mode: "gong",
		tonic: 0,
		octave: 4,
		tone: "piano",
		volume: 70,
		release: 120,
		slice: true
	};

	function loadSettings() {
		try {
			var raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			var saved = JSON.parse(raw);
			Object.keys(settings).forEach(function (key) {
				if (saved[key] !== undefined && saved[key] !== null) {
					settings[key] = saved[key];
				}
			});
		} catch (error) {
			/* 忽略损坏的配置 */
		}
	}

	function saveSettings() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch (error) {
			/* 存储不可用时静默降级 */
		}
	}

	function getMode() {
		for (var i = 0; i < MODES.length; i++) {
			if (MODES[i].id === settings.mode) return MODES[i];
		}
		return MODES[0];
	}

	function midiOf(deg, oct) {
		var mode = getMode();
		var base = (settings.octave + 1) * 12 + settings.tonic;
		return base + (mode.deg[deg] || 0) + oct * 12;
	}

	function noteName(midi) {
		var pc = ((midi % 12) + 12) % 12;
		return NOTE_NAMES[pc] + (Math.floor(midi / 12) - 1);
	}

	function degHtml(deg, oct) {
		if (!oct) return String(deg);
		var dots = new Array(Math.abs(oct) + 1).join("·");
		return oct > 0 ? deg + "<sup>" + dots + "</sup>" : deg + "<sub>" + dots + "</sub>";
	}

	/* ============================================================
	   音频引擎
	   ============================================================ */

	var Audio = {
		ctx: null,
		master: null,

		init: function () {
			if (!this.ctx) {
				var Ctor = window.AudioContext || window.webkitAudioContext;
				if (!Ctor) return null;
				this.ctx = new Ctor();
				this.master = this.ctx.createGain();
				this.master.gain.value = volumeToGain(settings.volume);
				var comp = this.ctx.createDynamicsCompressor();
				comp.threshold.value = -12;
				comp.knee.value = 24;
				comp.ratio.value = 8;
				comp.attack.value = 0.003;
				comp.release.value = 0.25;
				this.master.connect(comp);
				comp.connect(this.ctx.destination);
			}
			if (this.ctx.state === "suspended") {
				this.ctx.resume();
			}
			return this.ctx;
		},

		setVolume: function (value) {
			if (!this.master) return;
			var now = this.ctx ? this.ctx.currentTime : 0;
			this.master.gain.setTargetAtTime(volumeToGain(value), now, 0.02);
		},

		play: function (midi, toneId, dur) {
			var ctx = this.init();
			if (!ctx) return;
			var freq = 440 * Math.pow(2, (midi - 69) / 12);
			if (!isFinite(freq) || freq <= 0) return;
			var life = Math.max(0.12, dur || 1.2);
			var t = ctx.currentTime + 0.002;

			switch (toneId) {
				case "piano":
					this.piano(ctx, t, freq, life);
					break;
				case "musicbox":
					this.musicBox(ctx, t, freq, life);
					break;
				case "bell":
					this.bell(ctx, t, freq, life);
					break;
				case "guitar":
					this.guitar(ctx, t, freq, life);
					break;
				default:
					this.basic(ctx, t, freq, life, toneId);
			}
		},

		/** 单个衰减泛音 */
		partial: function (ctx, t, freq, dur, ratio, amp, decayScale) {
			var life = Math.max(0.12, dur * decayScale);
			var osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.value = freq * ratio;
			var gain = ctx.createGain();
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.linearRampToValueAtTime(amp, t + 0.004);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + life);
			osc.connect(gain);
			gain.connect(this.master);
			osc.start(t);
			osc.stop(t + life + 0.05);
		},

		partials: function (ctx, t, freq, dur, list) {
			for (var i = 0; i < list.length; i++) {
				this.partial(ctx, t, freq, dur, list[i][0], list[i][1], list[i][2]);
			}
		},

		basic: function (ctx, t, freq, dur, type) {
			var peak = type === "square" ? 0.15 : type === "sawtooth" ? 0.17 : 0.3;
			var cut = type === "square" ? Math.min(freq * 6, 5200) :
				type === "sawtooth" ? Math.min(freq * 8, 8000) :
					Math.min(freq * 12, 14000);

			var osc = ctx.createOscillator();
			osc.type = type;
			osc.frequency.value = freq;

			var filter = ctx.createBiquadFilter();
			filter.type = "lowpass";
			filter.frequency.value = Math.max(cut, 900);
			filter.Q.value = 0.6;

			var gain = ctx.createGain();
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.linearRampToValueAtTime(peak, t + 0.006);
			gain.gain.exponentialRampToValueAtTime(peak * 0.42, t + 0.09);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

			osc.connect(filter);
			filter.connect(gain);
			gain.connect(this.master);
			osc.start(t);
			osc.stop(t + dur + 0.05);
		},

		piano: function (ctx, t, freq, dur) {
			this.partials(ctx, t, freq, dur, [
				[1, 0.30, 1],
				[2, 0.12, 0.60],
				[3, 0.055, 0.40],
				[4.02, 0.022, 0.28]
			]);
		},

		musicBox: function (ctx, t, freq, dur) {
			this.partials(ctx, t, freq, dur, [
				[1, 0.24, 1],
				[2, 0.10, 0.48],
				[3.01, 0.045, 0.30],
				[5.4, 0.020, 0.18]
			]);
		},

		bell: function (ctx, t, freq, dur) {
			var carrier = ctx.createOscillator();
			carrier.type = "sine";
			carrier.frequency.value = freq;

			var mod = ctx.createOscillator();
			mod.type = "sine";
			mod.frequency.value = freq * 3.5;

			var modGain = ctx.createGain();
			modGain.gain.setValueAtTime(freq * 3.2, t);
			modGain.gain.exponentialRampToValueAtTime(freq * 0.02, t + dur * 0.5);

			mod.connect(modGain);
			modGain.connect(carrier.frequency);

			var gain = ctx.createGain();
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.linearRampToValueAtTime(0.24, t + 0.003);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

			carrier.connect(gain);
			gain.connect(this.master);
			carrier.start(t);
			carrier.stop(t + dur + 0.05);
			mod.start(t);
			mod.stop(t + dur * 0.5 + 0.05);

			this.partial(ctx, t, freq, dur, 2, 0.06, 0.5);
		},

		guitar: function (ctx, t, freq, dur) {
			var rate = ctx.sampleRate;
			var n = Math.max(2, Math.round(rate / freq));
			var len = Math.ceil(rate * Math.min(dur * 1.15, 4));
			var buffer = ctx.createBuffer(1, len, rate);
			var data = buffer.getChannelData(0);

			var ring = new Float32Array(n);
			var i;
			for (i = 0; i < n; i++) {
				ring[i] = Math.random() * 2 - 1;
			}
			// 预平滑，去掉过亮的白噪
			var smooth = 0;
			for (i = 0; i < n; i++) {
				smooth = smooth * 0.5 + ring[i] * 0.5;
				ring[i] = smooth;
			}

			var idx = 0;
			var decayStep = Math.exp(-3.0 / len);
			var amp = 1;
			for (i = 0; i < len; i++) {
				var cur = ring[idx];
				var next = ring[(idx + 1) % n];
				data[i] = cur * amp * 0.6;
				ring[idx] = (cur + next) * 0.5 * 0.996;
				idx = (idx + 1) % n;
				amp *= decayStep;
			}

			var src = ctx.createBufferSource();
			src.buffer = buffer;

			var filter = ctx.createBiquadFilter();
			filter.type = "lowpass";
			filter.frequency.value = Math.min(freq * 10, 9000);

			var gain = ctx.createGain();
			gain.gain.value = 0.9;

			src.connect(filter);
			filter.connect(gain);
			gain.connect(this.master);
			src.start(t);
		}
	};

	function volumeToGain(value) {
		var v = Math.max(0, Math.min(100, Number(value) || 0));
		return (v / 100) * 0.85;
	}

	/* ============================================================
	   界面
	   ============================================================ */

	var els = {};
	var logEntries = [];

	function $(id) {
		return document.getElementById(id);
	}

	function buildChips(container, items, currentId, onPick) {
		container.innerHTML = "";
		items.forEach(function (item) {
			var chip = document.createElement("button");
			chip.type = "button";
			chip.className = "chip" + (item.id === currentId ? " is-active" : "");
			chip.textContent = item.label;
			chip.setAttribute("role", "radio");
			chip.setAttribute("aria-checked", item.id === currentId ? "true" : "false");
			chip.dataset.id = item.id;
			chip.addEventListener("click", function () {
				onPick(item.id);
			});
			container.appendChild(chip);
		});
	}

	function syncChips(container, currentId) {
		var chips = container.querySelectorAll(".chip");
		for (var i = 0; i < chips.length; i++) {
			var active = chips[i].dataset.id === currentId;
			chips[i].classList.toggle("is-active", active);
			chips[i].setAttribute("aria-checked", active ? "true" : "false");
		}
	}

	function buildSelect(select, options, currentValue) {
		select.innerHTML = "";
		options.forEach(function (opt) {
			var option = document.createElement("option");
			option.value = opt.value;
			option.textContent = opt.label;
			select.appendChild(option);
		});
		select.value = String(currentValue);
	}

	function buildPads() {
		var faceBox = els.padGridFace;
		var sliceBox = els.padGridSlice;
		faceBox.innerHTML = "";
		sliceBox.innerHTML = "";

		MOVE_MAP.forEach(function (item) {
			var pad = document.createElement("button");
			pad.type = "button";
			pad.className = "pad" + (item.slice ? " is-slice" : "");
			pad.dataset.move = item.move;
			pad.innerHTML =
				'<span class="padMove">' + item.move + "</span>" +
				'<span class="padDeg">' + degHtml(item.deg, item.oct) + "</span>" +
				'<span class="padNote"></span>';
			pad.addEventListener("click", function () {
				trigger(item.move);
			});
			(item.slice ? sliceBox : faceBox).appendChild(pad);
		});

		renderPadNotes();
	}

	function renderPadNotes() {
		var pads = document.querySelectorAll(".pad");
		for (var i = 0; i < pads.length; i++) {
			var item = MOVE_INDEX[pads[i].dataset.move];
			var note = pads[i].querySelector(".padNote");
			if (item && note) {
				note.textContent = noteName(midiOf(item.deg, item.oct));
			}
		}
	}

	function flashPad(move) {
		var pad = document.querySelector('.pad[data-move="' + cssEscape(move) + '"]');
		if (!pad) return;
		pad.classList.add("is-hit");
		setTimeout(function () {
			pad.classList.remove("is-hit");
		}, 190);
	}

	function cssEscape(value) {
		return String(value).replace(/["\\]/g, "\\$&");
	}

	function pushLog(move, midi) {
		logEntries.unshift({ move: move, note: noteName(midi) });
		if (logEntries.length > 24) {
			logEntries.length = 24;
		}
		renderLog();
	}

	function renderLog() {
		var box = els.logList;
		box.innerHTML = "";
		if (!logEntries.length) {
			var empty = document.createElement("p");
			empty.className = "empty";
			empty.textContent = "转动魔方或点击上方音位开始";
			box.appendChild(empty);
			return;
		}
		logEntries.forEach(function (entry, index) {
			var chip = document.createElement("span");
			chip.className = "logChip" + (index === 0 ? " is-new" : "");
			var move = document.createElement("span");
			move.className = "logMove";
			move.textContent = entry.move;
			var note = document.createElement("span");
			note.className = "logNote";
			note.textContent = entry.note;
			chip.appendChild(move);
			chip.appendChild(note);
			box.appendChild(chip);
		});
	}

	function updateStatus(kind, text, device) {
		els.statusText.textContent = text;
		els.statusDot.className = "statusDot" + (kind ? " is-" + kind : "");
		if (device !== undefined) {
			els.deviceText.textContent = device;
		}
	}

	function trigger(move) {
		var item = MOVE_INDEX[move];
		if (!item) return;
		var midi = midiOf(item.deg, item.oct);
		Audio.play(midi, settings.tone, settings.release / 100);
		flashPad(move);
		pushLog(move, midi);
	}

	function playScale() {
		var degrees = [1, 2, 3, 5, 6];
		degrees.forEach(function (deg, index) {
			setTimeout(function () {
				Audio.play(midiOf(deg, 0), settings.tone, Math.min(settings.release / 100, 0.9));
			}, index * 230);
		});
	}

	/* ============================================================
	   蓝牙魔方
	   ============================================================ */

	var cube = {
		connected: false,
		hasBaseline: false,
		history: [],
		pending: null,
		pendingTimer: null,
		windowMs: 70
	};

	function normalizeToken(raw) {
		var text = String(raw || "").replace(/[’‘`]/g, "'").replace(/\s+/g, "");
		var m = /^([URFDLB])([']?)([23]?)$/i.exec(text);
		if (m) {
			return m[1].toUpperCase() + (m[2] || "");
		}
		m = /^([MES])([']?)$/i.exec(text);
		if (m) {
			return m[1].toUpperCase() + (m[2] || "");
		}
		return "";
	}

	function diffMoves(current, previous) {
		if (!previous.length || !current.length) return [];
		var bestOffset = 0;
		var bestMatch = 0;
		for (var offset = 1; offset < current.length; offset++) {
			var matched = 0;
			while (matched < previous.length &&
				offset + matched < current.length &&
				current[offset + matched] === previous[matched]) {
				matched++;
			}
			if (matched > bestMatch) {
				bestMatch = matched;
				bestOffset = offset;
			}
		}
		var count = bestOffset > 0 ? bestOffset : 1;
		if (count > current.length) count = current.length;
		return current.slice(0, count).reverse();
	}

	function matchSlice(first, second) {
		for (var i = 0; i < SLICE_PAIRS.length; i++) {
			var pair = SLICE_PAIRS[i];
			if (first === pair.a && second === pair.b) return pair.slice;
			if (first === pair.b && second === pair.a) return pair.slice;
		}
		return null;
	}

	function flushPending() {
		if (cube.pendingTimer) {
			clearTimeout(cube.pendingTimer);
			cube.pendingTimer = null;
		}
		if (!cube.pending) return;
		var token = cube.pending.token;
		cube.pending = null;
		trigger(token);
	}

	function feedMove(token, ts) {
		if (!settings.slice) {
			trigger(token);
			return;
		}
		var pending = cube.pending;
		if (pending && ts - pending.ts <= cube.windowMs) {
			var slice = matchSlice(pending.token, token);
			if (slice) {
				cube.pending = null;
				clearTimeout(cube.pendingTimer);
				cube.pendingTimer = null;
				trigger(slice);
				return;
			}
		}
		flushPending();
		if (SLICE_STARTERS.indexOf(token) >= 0) {
			cube.pending = { token: token, ts: ts };
			cube.pendingTimer = setTimeout(flushPending, cube.windowMs);
			return;
		}
		trigger(token);
	}

	function onCubeCallback(facelet, prevMoves, lastTs, hardware) {
		void facelet;
		void lastTs;
		if (hardware) {
			setDeviceInfo(hardware, null);
		}
		var list = [];
		for (var i = 0; prevMoves && i < prevMoves.length; i++) {
			var token = normalizeToken(prevMoves[i]);
			if (token) list.push(token);
		}
		if (!cube.hasBaseline) {
			cube.hasBaseline = true;
			cube.history = list.slice();
			return;
		}
		var news = diffMoves(list, cube.history);
		cube.history = list.slice();
		if (news.length > 4) return; // 跨度过大视为重新同步
		var now = Date.now();
		for (var k = 0; k < news.length; k++) {
			feedMove(news[k], now);
		}
	}

	function setDeviceInfo(name, battery) {
		if (name) {
			cube.deviceName = name;
		}
		if (typeof battery === "number" && battery > 0) {
			cube.battery = battery;
		}
		var label = cube.deviceName || "-";
		if (typeof cube.battery === "number" && cube.battery > 0) {
			label += " · " + cube.battery + "%";
		}
		if (cube.connected) {
			els.deviceText.textContent = label;
		}
	}

	function connect() {
		if (!window.GiikerCube) {
			updateStatus("error", "蓝牙适配层未加载", "请刷新页面重试");
			return;
		}
		if (!navigator.bluetooth) {
			updateStatus("error", "浏览器不支持", "请使用 Chrome / Edge 并通过 https 或 localhost 打开");
			return;
		}
		if (cube.connected) {
			disconnect();
			return;
		}

		Audio.init();
		els.connectBtn.disabled = true;
		cube.hasBaseline = false;
		cube.history = [];
		cube.pending = null;
		updateStatus("waiting", "等待选择设备", "在浏览器弹窗中选择你的魔方");

		GiikerCube.init().then(function () {
			cube.connected = true;
			els.connectBtn.classList.add("is-connected");
			els.connectBtn.textContent = "断开连接";
			updateStatus("connected", "已连接", cube.deviceName || "魔方已就绪");
		}).catch(function (error) {
			cube.connected = false;
			var message = String((error && error.message) || error || "连接失败");
			updateStatus("error", "连接失败", message);
		}).then(function () {
			els.connectBtn.disabled = false;
		});
	}

	function disconnect() {
		els.connectBtn.disabled = true;
		Promise.resolve(window.GiikerCube && GiikerCube.stop()).catch(function () {
			/* 断开异常时忽略 */
		}).then(function () {
			cube.connected = false;
			cube.hasBaseline = false;
			cube.history = [];
			els.connectBtn.classList.remove("is-connected");
			els.connectBtn.textContent = "连接魔方";
			els.connectBtn.disabled = false;
			updateStatus("", "未连接", "点击按钮选择设备");
		});
	}

	/* ============================================================
	   初始化
	   ============================================================ */

	function bindControls() {
		buildChips(els.modeChips, MODES, settings.mode, function (id) {
			settings.mode = id;
			syncChips(els.modeChips, id);
			renderPadNotes();
			saveSettings();
			Audio.init();
			playScale();
		});

		buildChips(els.toneChips, TONES, settings.tone, function (id) {
			settings.tone = id;
			syncChips(els.toneChips, id);
			saveSettings();
			Audio.init();
			trigger("R");
		});

		buildSelect(els.tonicSelect, NOTE_NAMES.map(function (name, index) {
			return { value: index, label: name };
		}), settings.tonic);
		els.tonicSelect.addEventListener("change", function () {
			settings.tonic = Number(els.tonicSelect.value);
			renderPadNotes();
			saveSettings();
		});

		buildSelect(els.octaveSelect, [2, 3, 4, 5].map(function (value) {
			return { value: value, label: value + " 区" };
		}), settings.octave);
		els.octaveSelect.addEventListener("change", function () {
			settings.octave = Number(els.octaveSelect.value);
			renderPadNotes();
			saveSettings();
		});

		els.volumeRange.value = String(settings.volume);
		els.volumeRange.addEventListener("input", function () {
			settings.volume = Number(els.volumeRange.value);
			Audio.init();
			Audio.setVolume(settings.volume);
			saveSettings();
		});

		els.releaseRange.value = String(settings.release);
		els.releaseRange.addEventListener("input", function () {
			settings.release = Number(els.releaseRange.value);
			saveSettings();
		});

		els.sliceToggle.checked = !!settings.slice;
		els.sliceToggle.addEventListener("change", function () {
			settings.slice = els.sliceToggle.checked;
			saveSettings();
		});

		els.scaleBtn.addEventListener("click", function () {
			Audio.init();
			playScale();
		});

		els.clearLogBtn.addEventListener("click", function () {
			logEntries = [];
			renderLog();
		});

		els.connectBtn.addEventListener("click", connect);
	}

	function bindCubeCallbacks() {
		if (!window.GiikerCube) return;
		GiikerCube.setCallback(onCubeCallback);
		GiikerCube.setEventCallback(function (info) {
			if (info === "disconnect") {
				cube.connected = false;
				cube.hasBaseline = false;
				cube.history = [];
				els.connectBtn.classList.remove("is-connected");
				els.connectBtn.textContent = "连接魔方";
				updateStatus("", "已断开", "点击按钮重新连接");
			}
		});
	}

	function init() {
		els = {
			statusDot: $("statusDot"),
			statusText: $("statusText"),
			deviceText: $("deviceText"),
			connectBtn: $("connectBtn"),
			modeChips: $("modeChips"),
			toneChips: $("toneChips"),
			tonicSelect: $("tonicSelect"),
			octaveSelect: $("octaveSelect"),
			volumeRange: $("volumeRange"),
			releaseRange: $("releaseRange"),
			sliceToggle: $("sliceToggle"),
			scaleBtn: $("scaleBtn"),
			clearLogBtn: $("clearLogBtn"),
			padGridFace: $("padGridFace"),
			padGridSlice: $("padGridSlice"),
			logList: $("logList")
		};

		loadSettings();
		buildPads();
		renderLog();
		bindControls();
		bindCubeCallbacks();

		// 供蓝牙适配层回调（giikerutil）
		window.smartCubeApp = {
			log: function () {
				if (window.DEBUG) console.log.apply(console, arguments);
			},
			setDevice: function (name, battery) {
				setDeviceInfo(name, battery);
			},
			showMacHelp: function (reason) {
				updateStatus("error", "需要 MAC 地址", reason || "请在弹窗中填写设备 MAC");
			},
			setStatus: function (kind, text) {
				if (kind === "error") {
					updateStatus("error", "连接失败", text);
				}
			}
		};
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
