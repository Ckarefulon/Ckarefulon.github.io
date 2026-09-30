/*
 * Cube Audio —— 站点共享音频功能块（Cube/assets/audio/）
 * 职责：音效（click / alert / beat 等 wav）与 WCA 观察语音报点（inspection_{8,12}_{lang}_{gender}.mp3）
 *       的预加载、播放与偏好管理。Analyzer / Trainer / Study 等页面共用同一套偏好。
 * 偏好存储：localStorage 'cubeAudioPrefsV1'（独立键，不进任何训练数据载荷）。
 * 用法：
 *   CubeAudio.effect('click');            // 受 soundOn 开关控制
 *   CubeAudio.voice('12');                // 观察剩余 12 秒报点，受 voiceOn / lang / gender 控制
 *   CubeAudio.setPrefs({ voiceOn:false });// 修改并持久化偏好
 *   CubeAudio.prefs();                    // 读取当前偏好
 */
(function (global) {
	'use strict';

	var PREFS_KEY = 'cubeAudioPrefsV1';
	var DEFAULTS = { soundOn: true, voiceOn: true, lang: 'zh', gender: 'female' };
	var BASE = 'sounds/';

	function scriptDir() {
		try {
			var s = document.currentScript && document.currentScript.src;
			if (!s) return '';
			return s.replace(/[^/]*$/, '');
		} catch (e) { return ''; }
	}
	var baseUrl = scriptDir() + BASE;

	function loadPrefs() {
		try {
			var raw = global.localStorage.getItem(PREFS_KEY);
			return raw ? Object.assign({}, DEFAULTS, JSON.parse(raw)) : Object.assign({}, DEFAULTS);
		} catch (e) { return Object.assign({}, DEFAULTS); }
	}
	var prefs = loadPrefs();
	var cache = new Map();

	function get(name) {
		var a = cache.get(name);
		if (!a) {
			a = new Audio(baseUrl + name);
			a.preload = 'auto';
			cache.set(name, a);
		}
		return a;
	}

	function playName(name, volume) {
		try {
			var a = get(name);
			a.pause();
			try { a.currentTime = 0; } catch (e) {}
			a.volume = typeof volume === 'number' ? volume : 1;
			var p = a.play();
			if (p && typeof p.catch === 'function') p.catch(function () {});
		} catch (e) {}
	}

	/* 音效：受 soundOn 控制 */
	function effect(name, volume) {
		if (!prefs.soundOn) return;
		playName(name + '.wav', volume);
	}

	/* 观察语音报点：受 voiceOn 控制（'8' | '12'） */
	function voice(sec) {
		if (!prefs.voiceOn) return;
		playName('inspection_' + sec + '_' + prefs.lang + '_' + prefs.gender + '.mp3');
	}

	function setPrefs(patch) {
		var needClear = false;
		Object.keys(patch).forEach(function (k) {
			if (prefs[k] !== patch[k] && (k === 'lang' || k === 'gender')) needClear = true;
			prefs[k] = patch[k];
		});
		if (needClear) {
			cache.forEach(function (a) { try { a.pause(); } catch (e) {} });
			cache.clear();
		}
		try { global.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
		return Object.assign({}, prefs);
	}

	global.CubeAudio = {
		effect: effect,
		voice: voice,
		setPrefs: setPrefs,
		prefs: function () { return Object.assign({}, prefs); },
		preload: function () {
			['click.wav', 'alert.wav', 'inspection_8_' + prefs.lang + '_' + prefs.gender + '.mp3',
			 'inspection_12_' + prefs.lang + '_' + prefs.gender + '.mp3'].forEach(function (n) { get(n); });
		}
	};
})(typeof window !== 'undefined' ? window : this);
