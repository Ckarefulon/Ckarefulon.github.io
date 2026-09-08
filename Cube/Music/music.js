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

	// 正逆同音映射（关闭「正逆异音」开关时使用）：正逆转动共用同一个音
	var SAME_MAP = [
		{ move: "R", deg: 1, oct: 0, slice: false },
		{ move: "U", deg: 5, oct: 0, slice: false },
		{ move: "F", deg: 3, oct: 0, slice: false },
		{ move: "L", deg: 2, oct: 0, slice: false },
		{ move: "B", deg: 6, oct: 0, slice: false },
		{ move: "D", deg: 6, oct: -1, slice: false },
		{ move: "M", deg: 5, oct: -1, slice: true },
		{ move: "S", deg: 1, oct: 1, slice: true },
		{ move: "E", deg: 2, oct: 1, slice: true }
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
		// 国风音色（置顶）
		{ id: "guzheng", label: "古筝" },
		{ id: "pipa", label: "琵琶" },
		{ id: "konghou", label: "箜篌" },
		{ id: "yangqin", label: "扬琴" },
		{ id: "dizi", label: "笛子" },
		{ id: "erhu", label: "二胡" },
		{ id: "xiao", label: "箫" },
		{ id: "xun", label: "埙" },
		{ id: "guqin", label: "古琴" },
		{ id: "suona", label: "唢呐" },
		{ id: "sheng", label: "笙" },
		{ id: "hulusi", label: "葫芦丝" },
		{ id: "ruan", label: "中阮" },
		{ id: "liuqin", label: "柳琴" },
		{ id: "bianzhong", label: "编钟" },
		// 原有音色
		{ id: "piano", label: "钢琴" },
		{ id: "musicbox", label: "音乐盒" },
		{ id: "bell", label: "钟琴" },
		{ id: "guitar", label: "吉他" },
		{ id: "sine", label: "正弦" },
		{ id: "triangle", label: "三角" },
		{ id: "square", label: "方波" },
		{ id: "sawtooth", label: "锯齿" }
	];

	// 国风拨弦类（Karplus-Strong 变体参数）
	// smooth 初始噪声平滑 / damp 弦阻尼 / tone 衰减速率 / cut cutMax 低通亮度 / decayMul maxLife 余韵 / bend 起音滑音
	var PLUCK_PRESETS = {
		guzheng: { smooth: 0.34, damp: 0.9975, tone: 3.6, cut: 12, cutMax: 11000, level: 0.8, decayMul: 1.3, maxLife: 4.5, bend: [0.982, 0.07] },
		pipa: { smooth: 0.5, damp: 0.996, tone: 5.2, cut: 9, cutMax: 9000, level: 0.75, decayMul: 1.0, maxLife: 2.8 },
		konghou: { smooth: 0.72, damp: 0.996, tone: 2.6, cut: 6.5, cutMax: 6000, level: 0.75, decayMul: 1.5, maxLife: 4 },
		guqin: { smooth: 0.88, damp: 0.9985, tone: 1.5, cut: 4, cutMax: 2600, level: 0.8, decayMul: 2.6, maxLife: 6.5, bend: [0.99, 0.5] },
		ruan: { smooth: 0.62, damp: 0.9965, tone: 3.4, cut: 6, cutMax: 5000, level: 0.78, decayMul: 1.2, maxLife: 3.5 },
		liuqin: { smooth: 0.3, damp: 0.997, tone: 4.8, cut: 11, cutMax: 10000, level: 0.7, decayMul: 1.0, maxLife: 2.6 }
	};

	// 国风长音类（吹奏 / 拉弦 / 簧管）：
	// parts 泛音列 [波形, 倍率, 电平] / cut 低通 / peak 共振峰 [倍率, dB]
	// vibRate vibDepth vibRamp 颤音（吟弦、气震音）：速率、幅度（音分）、随时间加深的时长
	// breath 气声噪声强度 / attack 起音
	var SUSTAIN_PRESETS = {
		dizi: { parts: [["sine", 1, 0.20], ["square", 1, 0.05], ["sine", 2, 0.055], ["sine", 3, 0.028]], cut: 5200, level: 0.34, attack: 0.045, vibRate: 5.2, vibDepth: 14, vibRamp: 0.3, breath: 0.035 },
		erhu: { parts: [["sine", 1, 0.11], ["sawtooth", 1, 0.05], ["sine", 2, 0.05], ["sine", 3, 0.032], ["sine", 4, 0.018]], cut: 4200, level: 0.32, attack: 0.07, vibRate: 5.6, vibDepth: 26, vibRamp: 0.32, breath: 0.014, peak: [2.8, 7] },
		xiao: { parts: [["sine", 1, 0.20], ["sine", 2, 0.022], ["sine", 3, 0.01]], cut: 2200, level: 0.34, attack: 0.09, vibRate: 4.6, vibDepth: 10, vibRamp: 0.55, breath: 0.055 },
		xun: { parts: [["sine", 1, 0.22], ["sine", 2, 0.016], ["sine", 3, 0.008]], cut: 1700, level: 0.36, attack: 0.075, vibRate: 4.2, vibDepth: 8, vibRamp: 0.5, breath: 0.04 },
		suona: { parts: [["square", 1, 0.045], ["sine", 1, 0.13], ["sine", 2, 0.06], ["sine", 3, 0.05], ["sine", 4, 0.028]], cut: 8500, level: 0.3, attack: 0.03, vibRate: 5.6, vibDepth: 18, vibRamp: 0.12, breath: 0.012, peak: [2.4, 8] },
		sheng: { parts: [["sine", 1, 0.17], ["square", 1, 0.022], ["sine", 2, 0.03], ["sine", 3, 0.014]], cut: 3000, level: 0.32, attack: 0.06, vibRate: 5.0, vibDepth: 6, vibRamp: 0.4, breath: 0.02 },
		hulusi: { parts: [["sine", 1, 0.19], ["sine", 2, 0.032], ["sine", 3, 0.014]], cut: 2600, level: 0.34, attack: 0.065, vibRate: 4.8, vibDepth: 10, vibRamp: 0.45, breath: 0.05 }
	};

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

	// 音位自定义可选项：五声 degrees × 八度偏移（低二 ~ 高二）
	var NOTE_OPTIONS = [];
	[-2, -1, 0, 1, 2].forEach(function (oct) {
		[1, 2, 3, 5, 6].forEach(function (deg) {
			var marks = "";
			for (var i = 0; i < Math.abs(oct); i++) {
				marks += oct > 0 ? "^" : "_";
			}
			NOTE_OPTIONS.push({ deg: deg, oct: oct, label: String(deg) + marks });
		});
	});

	var ACTIVE_INDEX = {};

	/** 当前生效的映射表：默认表 + 用户自定义覆盖 */
	function activeMap() {
		var base = settings.split ? MOVE_MAP : SAME_MAP;
		var custom = settings.split ? settings.customSplit : settings.customSame;
		if (!custom) return base;
		return base.map(function (item) {
			var c = custom[item.move];
			return c ? { move: item.move, deg: c[0], oct: c[1], slice: item.slice } : item;
		});
	}

	function rebuildActive() {
		ACTIVE_INDEX = {};
		activeMap().forEach(function (item) {
			ACTIVE_INDEX[item.move] = item;
		});
	}

	/** 取某转动的音位；同音模式下逆时针回落到同面顺时针（R' 按 R） */
	function noteFor(move) {
		var item = ACTIVE_INDEX[move];
		if (!item && !settings.split) {
			item = ACTIVE_INDEX[String(move).replace("'", "")];
		}
		return item;
	}

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
		slice: true,
		split: true,
		customSplit: null,
		customSame: null
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
			var known = {};
			TONES.forEach(function (tone) {
				known[tone.id] = 1;
			});
			if (!known[settings.tone]) {
				settings.tone = "piano";
			}
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
		voice: null,    // 当前长音（单声部：下一音起时收束）
		noiseBuf: null, // 气声共用白噪

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

			// 长音单声部：新音起，旧音收（结束时间为下一音响起或到达最长时长）
			if (this.voice) this.killVoice(0.08);

			if (PLUCK_PRESETS[toneId]) {
				this.pluck(ctx, t, freq, life, PLUCK_PRESETS[toneId]);
				return;
			}
			if (SUSTAIN_PRESETS[toneId]) {
				this.sustained(ctx, t, freq, life, SUSTAIN_PRESETS[toneId]);
				return;
			}

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
				case "yangqin":
					this.yangqin(ctx, t, freq, life);
					break;
				case "bianzhong":
					this.bianzhong(ctx, t, freq, life);
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
		},

		/** 收束当前长音：快速淡出并停掉全部节点 */
		killVoice: function (fade) {
			if (!this.voice || !this.ctx) return;
			var v = this.voice;
			this.voice = null;
			var now = this.ctx.currentTime;
			try {
				v.gain.gain.cancelScheduledValues(now);
				v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), now);
				v.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade * 4);
			} catch (error) {
				/* 忽略收束异常 */
			}
			for (var i = 0; i < v.nodes.length; i++) {
				try {
					v.nodes[i].stop(now + fade * 4 + 0.02);
				} catch (error) {
					/* 忽略 */
				}
			}
		},

		/** 气声共用白噪（1 秒循环） */
		getNoise: function (ctx) {
			if (!this.noiseBuf || this.noiseBuf.sampleRate !== ctx.sampleRate) {
				var len = ctx.sampleRate;
				var buf = ctx.createBuffer(1, len, ctx.sampleRate);
				var data = buf.getChannelData(0);
				for (var i = 0; i < len; i++) {
					data[i] = Math.random() * 2 - 1;
				}
				this.noiseBuf = buf;
			}
			return this.noiseBuf;
		},

		/** 国风拨弦通用（Karplus-Strong 变体） */
		pluck: function (ctx, t, freq, dur, o) {
			var rate = ctx.sampleRate;
			var n = Math.max(2, Math.round(rate / freq));
			var life = Math.min(dur * (o.decayMul || 1.15), o.maxLife || 4);
			var len = Math.max(64, Math.ceil(rate * life));
			var buffer = ctx.createBuffer(1, len, rate);
			var data = buffer.getChannelData(0);

			var ring = new Float32Array(n);
			var i;
			for (i = 0; i < n; i++) {
				ring[i] = Math.random() * 2 - 1;
			}
			var smooth = 0;
			var k = o.smooth;
			for (i = 0; i < n; i++) {
				smooth = smooth * (1 - k) + ring[i] * k;
				ring[i] = smooth;
			}

			var idx = 0;
			var decayStep = Math.exp(-(o.tone || 3) / len);
			var amp = 1;
			for (i = 0; i < len; i++) {
				var cur = ring[idx];
				var next = ring[(idx + 1) % n];
				data[i] = cur * amp * (o.level || 0.8);
				ring[idx] = (cur + next) * 0.5 * (o.damp || 0.996);
				idx = (idx + 1) % n;
				amp *= decayStep;
			}

			var src = ctx.createBufferSource();
			src.buffer = buffer;
			// 起音滑音（古筝按滑、古琴进复）
			if (o.bend) {
				src.playbackRate.setValueAtTime(o.bend[0], t);
				src.playbackRate.linearRampToValueAtTime(1, t + o.bend[1]);
			}

			var filter = ctx.createBiquadFilter();
			filter.type = "lowpass";
			filter.frequency.value = Math.min(freq * (o.cut || 10), o.cutMax || 9000);

			var gain = ctx.createGain();
			gain.gain.value = 1;

			src.connect(filter);
			filter.connect(gain);
			gain.connect(this.master);
			src.start(t);
		},

		/** 国风长音通用：颤音（吟弦、气震音）随时间加深 + 气声噪声层 + 单声部收束 */
		sustained: function (ctx, t, freq, dur, o) {
			// 到达最长时长自动收束；被下一音打断时由 killVoice 立即收束
			var max = Math.max(1.0, Math.min(3.4, 0.55 + dur * 1.15));
			var attack = o.attack || 0.05;
			var peak = o.level || 0.32;

			var gain = ctx.createGain();
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.linearRampToValueAtTime(peak, t + attack);
			gain.gain.linearRampToValueAtTime(peak * 0.8, t + attack + 0.3);
			gain.gain.setTargetAtTime(0.0001, t + max, 0.18);
			gain.connect(this.master);

			var filter = ctx.createBiquadFilter();
			filter.type = "lowpass";
			filter.frequency.value = o.cut || 5000;
			filter.Q.value = 0.5;
			filter.connect(gain);

			var tail = filter;
			if (o.peak) {
				// 共振峰（二胡琴筒、唢呐喇叭）
				var formant = ctx.createBiquadFilter();
				formant.type = "peaking";
				formant.frequency.value = freq * o.peak[0];
				formant.gain.value = o.peak[1];
				formant.Q.value = 1.1;
				formant.connect(filter);
				tail = formant;
			}

			var nodes = [];

			// 吟弦 / 气震音：LFO 调制所有泛音 detune（音分）。
			// 只加在长音上：音符存活超过 0.45s（未被下一音收束）才从零渐入，短音保持干净
			var vib = ctx.createOscillator();
			vib.type = "sine";
			vib.frequency.value = o.vibRate || 5;
			var vibGain = ctx.createGain();
			vibGain.gain.setValueAtTime(0.0001, t);
			vibGain.gain.setValueAtTime(0.0001, t + 0.45);
			vibGain.gain.linearRampToValueAtTime(o.vibDepth || 12, t + 0.45 + (o.vibRamp || 0.35));
			vib.connect(vibGain);
			nodes.push(vib);

			var i, p, osc, og;
			for (i = 0; i < o.parts.length; i++) {
				p = o.parts[i];
				osc = ctx.createOscillator();
				osc.type = p[0];
				osc.frequency.value = freq * p[1];
				og = ctx.createGain();
				og.gain.value = p[2];
				vibGain.connect(osc.detune);
				osc.connect(og);
				og.connect(tail);
				nodes.push(osc);
			}

			// 气声：起音略强，随后稳定，随长音收束
			if (o.breath) {
				var noise = ctx.createBufferSource();
				noise.buffer = this.getNoise(ctx);
				noise.loop = true;
				var nf = ctx.createBiquadFilter();
				nf.type = "bandpass";
				nf.frequency.value = Math.min(freq * 2.2, 6500);
				nf.Q.value = 0.7;
				var ng = ctx.createGain();
				ng.gain.setValueAtTime(o.breath * 2, t);
				ng.gain.linearRampToValueAtTime(o.breath, t + 0.2);
				ng.gain.setTargetAtTime(0.0001, t + max, 0.15);
				noise.connect(nf);
				nf.connect(ng);
				ng.connect(gain);
				nodes.push(noise);
			}

			for (i = 0; i < nodes.length; i++) {
				nodes[i].start(t);
				nodes[i].stop(t + max + 1.2);
			}

			this.voice = { gain: gain, nodes: nodes };
		},

		/** 扬琴：击弦，双弦微失谐 + 非谐泛音 */
		yangqin: function (ctx, t, freq, dur) {
			this.partials(ctx, t, freq, dur, [
				[1, 0.18, 1],
				[2.0, 0.06, 0.55],
				[2.76, 0.05, 0.45],
				[5.4, 0.022, 0.22]
			]);
			this.partials(ctx, t, freq * 1.004, dur, [
				[1, 0.10, 0.8],
				[2.76, 0.03, 0.35]
			]);
		},

		/** 编钟：青铜钟非谐泛音，长余韵 */
		bianzhong: function (ctx, t, freq, dur) {
			this.partials(ctx, t, freq, dur, [
				[1, 0.17, 1.5],
				[2.0, 0.05, 0.9],
				[2.4, 0.07, 1.1],
				[3.2, 0.03, 0.6],
				[4.5, 0.018, 0.4]
			]);
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
	var logSeq = 0;

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
			var item = noteFor(pads[i].dataset.move);
			var deg = pads[i].querySelector(".padDeg");
			var note = pads[i].querySelector(".padNote");
			if (item && deg && note) {
				deg.innerHTML = degHtml(item.deg, item.oct);
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
		logSeq++;
		logEntries.unshift({ id: logSeq, move: move, note: noteName(midi) });
		if (logEntries.length > 24) {
			logEntries.length = 24;
		}
		renderLog();
	}

	function renderLog() {
		var box = els.logList;
		// FLIP：先记录每条旧记录的位置，重建后从旧位置平滑移动到新位置
		var prevRects = {};
		var oldChips = box.querySelectorAll(".logChip");
		for (var i = 0; i < oldChips.length; i++) {
			prevRects[oldChips[i].dataset.id] = oldChips[i].getBoundingClientRect();
		}

		box.innerHTML = "";
		if (!logEntries.length) {
			var empty = document.createElement("p");
			empty.className = "empty";
			empty.textContent = "转动魔方或点击上方音位开始";
			box.appendChild(empty);
			return;
		}

		var moved = [];
		logEntries.forEach(function (entry, index) {
			var chip = document.createElement("span");
			chip.className = "logChip" + (index === 0 ? " is-new" : "");
			chip.dataset.id = entry.id;
			var move = document.createElement("span");
			move.className = "logMove";
			move.textContent = entry.move;
			var note = document.createElement("span");
			note.className = "logNote";
			note.textContent = entry.note;
			chip.appendChild(move);
			chip.appendChild(note);
			box.appendChild(chip);

			var old = prevRects[entry.id];
			if (old) {
				var rect = chip.getBoundingClientRect();
				var dx = old.left - rect.left;
				var dy = old.top - rect.top;
				if (dx || dy) {
					chip.style.transition = "none";
					chip.style.transform = "translate(" + dx + "px, " + dy + "px)";
					moved.push(chip);
				}
			}
		});

		if (moved.length) {
			void box.offsetWidth; // 强制回流，确保起点生效
			requestAnimationFrame(function () {
				moved.forEach(function (chip) {
					chip.style.transition = "transform 0.24s ease";
					chip.style.transform = "";
				});
			});
		}
	}

	function updateStatus(kind, text, device) {
		els.statusText.textContent = text;
		els.statusDot.className = "statusDot" + (kind ? " is-" + kind : "");
		if (device !== undefined) {
			els.deviceText.textContent = device;
		}
	}

	function trigger(move) {
		var item = noteFor(move);
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
	   音位表设置弹窗
	   ============================================================ */

	var mapDialog = null;

	function ensureMapDialog() {
		if (mapDialog) return mapDialog;
		var overlay = document.createElement("div");
		overlay.className = "modalOverlay";
		overlay.hidden = true;
		overlay.innerHTML =
			'<div class="modalDialog" role="dialog" aria-modal="true" aria-label="音位表设置">' +
				'<div class="modalHead">' +
					'<h3 class="modalTitle">音位表设置</h3>' +
					'<button type="button" class="modalClose" aria-label="关闭">&#10005;</button>' +
				'</div>' +
				'<div class="mapRows"></div>' +
				'<div class="modalFoot">' +
					'<button type="button" class="btn btn--ghost btn--sm" data-map="reset">恢复默认</button>' +
					'<button type="button" class="btn btn--primary btn--sm" data-map="done">完成</button>' +
				'</div>' +
			'</div>';
		document.body.appendChild(overlay);
		overlay.addEventListener("click", function (event) {
			if (event.target === overlay) {
				closeMapDialog();
			}
		});
		overlay.querySelector(".modalClose").addEventListener("click", closeMapDialog);
		overlay.querySelector('[data-map="done"]').addEventListener("click", closeMapDialog);
		overlay.querySelector('[data-map="reset"]').addEventListener("click", function () {
			if (settings.split) {
				settings.customSplit = null;
			} else {
				settings.customSame = null;
			}
			rebuildActive();
			renderPadNotes();
			saveSettings();
			buildMapRows();
		});
		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape" && mapDialog && !mapDialog.hidden) {
				closeMapDialog();
			}
		});
		mapDialog = overlay;
		return overlay;
	}

	function openMapDialog() {
		var overlay = ensureMapDialog();
		buildMapRows();
		overlay.hidden = false;
	}

	function closeMapDialog() {
		if (mapDialog) {
			mapDialog.hidden = true;
		}
	}

	/** 开关切换时若弹窗已打开，同步重建行 */
	function refreshMapRows() {
		if (mapDialog && !mapDialog.hidden) {
			buildMapRows();
		}
	}

	function buildMapRows() {
		var box = mapDialog.querySelector(".mapRows");
		box.innerHTML = "";
		var items = activeMap();
		[["外层", false], ["中层", true]].forEach(function (group) {
			var list = items.filter(function (item) {
				return item.slice === group[1];
			});
			if (!list.length) return;
			var label = document.createElement("p");
			label.className = "groupLabel";
			label.textContent = group[0];
			box.appendChild(label);
			var grid = document.createElement("div");
			grid.className = "mapGrid";
			list.forEach(function (item) {
				grid.appendChild(buildMapRow(item));
			});
			box.appendChild(grid);
		});
	}

	function buildMapRow(item) {
		var row = document.createElement("label");
		row.className = "mapRow";
		var move = document.createElement("span");
		move.className = "mapMove";
		move.textContent = item.move;
		var wrap = document.createElement("div");
		wrap.className = "selectWrap";
		var select = document.createElement("select");
		select.className = "select";
		NOTE_OPTIONS.forEach(function (opt) {
			var option = document.createElement("option");
			option.value = opt.deg + ":" + opt.oct;
			option.textContent = opt.label;
			select.appendChild(option);
		});
		select.value = item.deg + ":" + item.oct;
		select.addEventListener("change", function () {
			var parts = select.value.split(":");
			applyMapOverride(item.move, Number(parts[0]), Number(parts[1]));
		});
		wrap.appendChild(select);
		row.appendChild(move);
		row.appendChild(wrap);
		return row;
	}

	/** 修改某转动音位：写入当前模式的自定义表，立即生效并发声反馈 */
	function applyMapOverride(move, deg, oct) {
		var key = settings.split ? "customSplit" : "customSame";
		if (!settings[key]) {
			settings[key] = {};
		}
		settings[key][move] = [deg, oct];
		rebuildActive();
		renderPadNotes();
		saveSettings();
		Audio.init();
		Audio.play(midiOf(deg, oct), settings.tone, settings.release / 100);
	}

	/* ============================================================
	   蓝牙魔方
	   ============================================================ */

	var cube = {
		connected: false,
		hasBaseline: false,
		solved: false,
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

	/** 复原尾音：主和弦琶音上行，高音主音收束，避免终曲悬停感 */
	function playEnding() {
		Audio.init();
		var steps = [
			{ deg: 1, oct: 0, delay: 0.16, dur: 0.45 },
			{ deg: 3, oct: 0, delay: 0.32, dur: 0.45 },
			{ deg: 5, oct: 0, delay: 0.48, dur: 0.45 },
			{ deg: 1, oct: 1, delay: 0.64, dur: 2.6 }
		];
		steps.forEach(function (step) {
			setTimeout(function () {
				Audio.play(midiOf(step.deg, step.oct), settings.tone, step.dur);
			}, step.delay * 1000);
		});
	}

	/** 判定 54 面贴是否复原：每面 9 格同色；格式未知返回 null */
	function isSolvedFacelets(facelet) {
		if (!facelet || typeof facelet !== "string" || facelet.length !== 54) {
			return null;
		}
		for (var f = 0; f < 6; f++) {
			var face = facelet.substr(f * 9, 9);
			for (var i = 1; i < 9; i++) {
				if (face.charAt(i) !== face.charAt(0)) {
					return false;
				}
			}
		}
		return true;
	}

	function onCubeCallback(facelet, prevMoves, lastTs, hardware) {
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
			var first = isSolvedFacelets(facelet);
			if (first !== null) {
				cube.solved = first;
			}
			return;
		}
		var news = diffMoves(list, cube.history);
		cube.history = list.slice();
		if (news.length > 4) return; // 跨度过大视为重新同步
		var now = Date.now();
		for (var k = 0; k < news.length; k++) {
			feedMove(news[k], now);
		}
		// 由乱到复：播放收束尾音
		if (news.length > 0) {
			var solved = isSolvedFacelets(facelet);
			if (solved !== null) {
				if (solved && !cube.solved) {
					playEnding();
				}
				cube.solved = solved;
			}
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

		els.splitToggle.checked = !!settings.split;
		els.splitToggle.addEventListener("change", function () {
			settings.split = els.splitToggle.checked;
			rebuildActive();
			renderPadNotes();
			saveSettings();
			refreshMapRows();
		});

		els.mapSettingsBtn.addEventListener("click", openMapDialog);

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
			splitToggle: $("splitToggle"),
			mapSettingsBtn: $("mapSettingsBtn"),
			scaleBtn: $("scaleBtn"),
			clearLogBtn: $("clearLogBtn"),
			padGridFace: $("padGridFace"),
			padGridSlice: $("padGridSlice"),
			logList: $("logList")
		};

		loadSettings();
		rebuildActive();
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
