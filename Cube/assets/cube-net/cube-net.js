/*
 * 魔方展开图（Cube 公用）
 * ---------------------------------------------------------------------------
 * 六个面按十字排布：U 在 F 上方，L / F / R / B 一行，D 在 F 下方。
 *
 * 职责边界：只做「建结构 + 按 facelets 上色」，不掺页面状态与文案
 * （标题、是否显示等由调用页自己管）。
 *
 * 面位两种口径都收，调用页**不需要自己换算**：
 *   · 54 字符面位串（"URFDLB"，与 mathlib 的 SOLVED_FACELET 同口径）—— 直接传；
 *   · 54 长度数值面序贴纸数组（各页引擎内部多为此形态）—— 直接传，配合 faceIndex / colorOfFace。
 * 需要数值形态时用 CubeNet.toNumeric(facelet)，别在页面里再抄一份映射表。
 *
 * 用法：
 *   CubeNet.build(document.getElementById('cubeNet'));              // 建一次即可
 *   CubeNet.render(document.getElementById('cubeNet'), faceletStr);  // 字符串，最常见
 *   CubeNet.render(document.getElementById('cubeNet'), numericArr, {
 *       faceIndex: E.FACE_INDEX, colorOfFace: E.COLOR_OF_FACE
 *   });
 *
 * 容器需要 class="cubeNet"（样式在 Cube/cube-net/cube-net.css）。
 */
(function (root) {
	'use strict';

	// 展开图里六个面的排列顺序，下标与 DOM 中 .face 的出现顺序一致
	var ORDER = ['U', 'L', 'F', 'R', 'B', 'D'];

	// mathlib / 面位串的标准口径：面序 URFDLB，配色白红绿黄橙蓝
	var FACE_LETTERS = 'URFDLB';
	var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
	var COLOR_OF_FACE = ['#f5f5f5', '#c62828', '#2e9e4b', '#f5c518', '#ef6c1a', '#1565c0'];

	function build(net) {
		if (!net) { return; }
		net.innerHTML = '';
		for (var f = 0; f < ORDER.length; f++) {
			var face = document.createElement('div');
			face.className = 'face';
			face.dataset.face = ORDER[f];
			for (var i = 0; i < 9; i++) {
				var sticker = document.createElement('div');
				sticker.className = 'sticker';
				face.appendChild(sticker);
			}
			net.appendChild(face);
		}
	}

	/** 54 字符面位串 → 数值面序贴纸数组（colorOfFace[Math.floor(v/9)] 即得颜色） */
	function toNumeric(facelet) {
		var s = String(facelet || '').trim().toUpperCase();
		var out = new Array(54);
		for (var i = 0; i < 54; i++) {
			var fi = FACE_LETTERS.indexOf(s.charAt(i));
			out[i] = (fi < 0 ? 0 : fi) * 9 + (i % 9);
		}
		return out;
	}

	/** 54 字符面位串 → 每格直接是面序号（与 toNumeric 的分工见 render 内部：本函数给不了颜色） */
	function isFaceletString(v) {
		return typeof v === 'string' && v.length >= 54;
	}

	function render(net, facelets, opts) {
		if (!net || !facelets) { return; }
		opts = opts || {};
		/* 字符串口径：面序由面位串自身决定，配色取标准表（调用页可覆盖） */
		var numeric = isFaceletString(facelets) ? toNumeric(facelets) : facelets;
		var faceIndex = opts.faceIndex || FACE_INDEX;
		var colorOfFace = opts.colorOfFace || COLOR_OF_FACE;
		var faces = net.querySelectorAll('.face');
		for (var f = 0; f < ORDER.length && f < faces.length; f++) {
			var fi = faceIndex[ORDER[f]];
			if (fi === undefined) { continue; }
			var stickers = faces[f].children;
			for (var i = 0; i < 9 && i < stickers.length; i++) {
				var src = numeric[fi * 9 + i];
				if (src === undefined) { continue; }
				stickers[i].style.background = colorOfFace[Math.floor(src / 9)] || '';
			}
		}
	}

	root.CubeNet = {
		ORDER: ORDER,
		FACE_LETTERS: FACE_LETTERS,
		FACE_INDEX: FACE_INDEX,
		COLOR_OF_FACE: COLOR_OF_FACE,
		build: build,
		toNumeric: toNumeric,
		render: render
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
