/* Cross 判定链（吸收 XC大师规则，对页面零侵入）
 * 挂在 cross-app.js 之前（defer 顺序）：init() 在 readyState=interactive 时同步跑 newPuzzle()，
 * 排后面的 defer 脚本届时还没加载。
 *
 * 两块能力：
 * 1) 难度徽章（onPuzzle）：对「打乱后状态」算六底色各自的最优十字步数，
 *    当前底高亮，≥7 步标难；六底全 ≥7 时记「难十字」（XC大师 7+ 筛选口径）。
 *    当前底一步可见（generate 时该 solver 已缓存），六底色全量约 100ms 延后算，不卡出题。
 * 2) 完成判定（onSolved）：做通十字时按 简化步数 − 最优步数 给 Optimal / Optimal +n 徽章。
 *
 * 只读 CrossEngine，不碰页面状态、不改既有函数行为。
 */
(function (root) {
	'use strict';

	var E = root.CrossEngine;
	if (!E) { return; }

	/* 与 cross-app.js 一致的数字键颜色名（CrossEngine.COLOR_NAME 是面字母键，别用错） */
	var COLOR_NAME = { 0: '白', 1: '红', 2: '绿', 3: '黄', 4: '橙', 5: '蓝' };
	var COLOR_HEX = E.COLOR_OF_FACE; // ['#f5f5f5', …] U R F D L B
	var HARD = 7;                    // XC大师口径：最优解 ≥7 步记为难十字

	var token = 0; // 出题代数：只认最后一次 onPuzzle 的延迟渲染，连点「换一条」不闪旧值

	function colorDistances(facelets) {
		var dists = [];
		for (var c = 0; c < 6; c++) {
			var solver = E.getSolver(c, c);
			dists.push(solver.dist[E.codeFromFacelets(facelets, solver.blocks)]);
		}
		return dists;
	}

	function chipHtml(c, d, isCur) {
		return '<span class="diffChip' + (isCur ? ' isCur' : '') + (d >= HARD ? ' isHard' : '') + '">' +
			'<i style="background:' + COLOR_HEX[c] + '"></i>' + COLOR_NAME[c] + ' ' + d + '</span>';
	}

	function renderFull(facelets, colorFace) {
		var box = document.getElementById('crossDiff');
		if (!box) { return; }
		var dists = colorDistances(facelets);
		var min = 9;
		for (var i = 0; i < 6; i++) { if (dists[i] < min) { min = dists[i]; } }
		var html = '<span class="diffLabel">难度</span>';
		for (var c = 0; c < 6; c++) { html += chipHtml(c, dists[c], c === colorFace); }
		if (min >= HARD) { html += '<span class="diffFlag">全底色 ' + HARD + '+ 难十字</span>'; }
		box.innerHTML = html;
		box.dataset.hard = min >= HARD ? '1' : '';
	}

	/* 出题/按实际状态重算后调用：p = state.puzzle */
	function onPuzzle(p, colorFace, crossFace) {
		var box = document.getElementById('crossDiff');
		if (!box || !p || !p.scrambleFacelets) { return; }
		var my = ++token;
		/* 当前底同步出（该 solver 在 generate 时已缓存），其余五色延后 */
		var cur = -1;
		try {
			var solver = E.getSolver(colorFace, crossFace);
			cur = solver.dist[p.stateCode];
		} catch (e) { cur = -1; }
		var html = '<span class="diffLabel">难度</span>';
		if (cur >= 0) {
			html += chipHtml(colorFace, cur, true) + '<span class="diffMore">六底色计算中…</span>';
		} else {
			html += '<span class="diffMore">六底色计算中…</span>';
		}
		box.innerHTML = html;
		box.dataset.hard = cur >= HARD ? '1' : '';
		box.hidden = false;
		setTimeout(function () {
			if (my !== token) { return; } // 已换新题
			renderFull(p.scrambleFacelets, colorFace);
		}, 24);
	}

	/* 做通十字时调用：moveCount = 简化后的用户步数 */
	function onSolved(moveCount, p, colorFace, crossFace) {
		var box = document.getElementById('optBadge');
		if (!box) { return; }
		var opt = -1;
		try {
			var solver = E.getSolver(colorFace, crossFace);
			opt = solver.dist[p.stateCode];
		} catch (e) { opt = -1; }
		if (opt <= 0) { box.hidden = true; return; } // 已是完成态出题（opt=0）不评
		var extra = moveCount - opt;
		box.hidden = false;
		if (extra <= 0) {
			box.textContent = 'Optimal';
			box.dataset.kind = 'opt';
			box.title = '最优 ' + opt + ' 步';
		} else {
			box.textContent = 'Optimal +' + extra;
			box.dataset.kind = 'over';
			box.title = '最优 ' + opt + ' 步，多用 ' + extra + ' 步';
		}
	}

	function clearSolved() {
		var box = document.getElementById('optBadge');
		if (box) { box.hidden = true; }
	}

	root.CrossJudge = {
		onPuzzle: onPuzzle,
		onSolved: onSolved,
		clearSolved: clearSolved,
		HARD: HARD
	};
})(typeof self !== 'undefined' ? self : this);
