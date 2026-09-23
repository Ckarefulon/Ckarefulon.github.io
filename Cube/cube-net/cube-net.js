/*
 * 魔方展开图（Cube 公用）
 * ---------------------------------------------------------------------------
 * 六个面按十字排布：U 在 F 上方，L / F / R / B 一行，D 在 F 下方。
 *
 * 职责边界：只做「建结构 + 按 facelets 上色」，不掺页面状态与文案
 * （标题、是否显示等由调用页自己管）。faceIndex / colorOfFace 由调用页传入，
 * 因为各页引擎的编号表未必相同。
 *
 * 用法：
 *   CubeNet.build(document.getElementById('cubeNet'));                  // 建一次即可
 *   CubeNet.render(document.getElementById('cubeNet'), facelets, {
 *       faceIndex: E.FACE_INDEX, colorOfFace: E.COLOR_OF_FACE
 *   });
 *
 * 容器需要 class="cubeNet"（样式在 Cube/cube-net/cube-net.css）。
 * facelets 为 54 长度的面序贴纸数组（与 mathlib 同口径）。
 */
(function (root) {
	'use strict';

	// 展开图里六个面的排列顺序，下标与 DOM 中 .face 的出现顺序一致
	var ORDER = ['U', 'L', 'F', 'R', 'B', 'D'];

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

	function render(net, facelets, opts) {
		if (!net || !facelets) { return; }
		opts = opts || {};
		var faceIndex = opts.faceIndex || { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
		var colorOfFace = opts.colorOfFace;
		var faces = net.querySelectorAll('.face');
		for (var f = 0; f < ORDER.length && f < faces.length; f++) {
			var fi = faceIndex[ORDER[f]];
			if (fi === undefined) { continue; }
			var stickers = faces[f].children;
			for (var i = 0; i < 9 && i < stickers.length; i++) {
				var src = facelets[fi * 9 + i];
				if (src === undefined) { continue; }
				stickers[i].style.background = colorOfFace ? colorOfFace[Math.floor(src / 9)] : '';
			}
		}
	}

	root.CubeNet = { ORDER: ORDER, build: build, render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
