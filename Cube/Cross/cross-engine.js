/* Cross 训练引擎
 * 依赖 cross-tables.js（由 mathlib 导出的置换表）
 * 坐标系：标准 facelet 顺序 U(0-8) R(9-17) F(18-26) D(27-35) L(36-44) B(45-53)
 * 默认持握：白顶(U) 绿前(F)
 */
(function (root, factory) {
	var tables = (typeof module !== 'undefined' && module.exports) ? require('./cross-tables.js') : root.CROSS_TABLES;
	var api = factory(tables);
	if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
	root.CrossEngine = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
	'use strict';

	var MOVE_NAMES = T.MOVE_NAMES;
	var EF = T.EDGE_FACELETS;
	var CF = T.CORNER_FACELETS;
	var EM = T.EDGE_MOVE;
	var CM = T.CORNER_MOVE;

	/* move 索引：face*3 + (0=顺时针 1=180 2=逆时针) */
	var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
	var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
	var COLOR_OF_FACE = ['#f5f5f5', '#c62828', '#2e9e4b', '#f5c518', '#ef6c1a', '#1565c0']; // U R F D L B
	var COLOR_NAME = { U: '白', R: '红', F: '绿', D: '黄', L: '橙', B: '蓝' };

	function moveFace(m) { return (m / 3) | 0; }
	function movePower(m) { return (m % 3) + 1; } // 1 / 2 / 3(逆时针)
	function inverseMove(m) { return ((m / 3) | 0) * 3 + (2 - (m % 3)); }

	/* ---------------- facelet 置换 ---------------- */
	var FACELET_PERM = (function () {
		var perm = [];
		for (var m = 0; m < 18; m++) {
			var p = new Array(54);
			for (var i = 0; i < 54; i++) { p[i] = i; }
			for (var e = 0; e < 12; e++) {
				var v = EM[m][e], to = v >> 1, d = v & 1;
				for (var n = 0; n < 2; n++) { p[EF[to][(n + d) % 2]] = EF[e][n]; }
			}
			for (var c = 0; c < 8; c++) {
				var w = CM[m][c], tc = w >> 2, dc = w & 3;
				for (var k = 0; k < 3; k++) { p[CF[tc][(k + dc) % 3]] = CF[c][k]; }
			}
			perm.push(p);
		}
		return perm;
	})();

	/* facelets[i] = 该位置上的贴纸在复原状态下所在的 facelet 序号；
	   取颜色用 faceOfFacelet(facelets[i]) */
	function solvedFacelets() {
		var f = [];
		for (var i = 0; i < 54; i++) { f.push(i); }
		return f;
	}

	function applyFaceletMove(facelets, m) {
		var p = FACELET_PERM[m], out = new Array(54);
		for (var i = 0; i < 54; i++) { out[i] = facelets[p[i]]; }
		return out;
	}

	function applyFaceletMoves(facelets, moves) {
		for (var i = 0; i < moves.length; i++) { facelets = applyFaceletMove(facelets, moves[i]); }
		return facelets;
	}

	/* ---------------- 目标定义 ---------------- */
	function faceOfFacelet(fl) { return (fl / 9) | 0; }

	/* 返回 { colorFace, crossFace, blocks:[棱块id×4], target:[v×4] }，v = pos*2 + ori
	 * colorFace：做十字的颜色所在的面（决定要归位的 4 个棱块）
	 * crossFace：十字所在的几何面（由 CROSS_TARGETS 查表得到，已按整体旋转对齐侧面）
	 */
	function buildTarget(colorFace, crossFace) {
		if (crossFace === undefined || crossFace === null) { crossFace = colorFace; }
		var entry = T.CROSS_TARGETS[colorFace * 6 + crossFace];
		if (!entry) { entry = T.CROSS_TARGETS[colorFace * 6 + colorFace]; crossFace = colorFace; }
		return {
			colorFace: colorFace,
			crossFace: crossFace,
			blocks: entry.b.slice(),
			target: entry.t.slice()
		};
	}

	/* ---------------- 状态编码（只跟踪 4 个目标棱） ---------------- */
	function encode4(v0, v1, v2, v3) { return v0 * 13824 + v1 * 576 + v2 * 24 + v3; }
	function decode4(code) {
		var v3 = code % 24, r = (code - v3) / 24;
		var v2 = r % 24; r = (r - v2) / 24;
		var v1 = r % 24; r = (r - v1) / 24;
		return [r, v1, v2, v3];
	}
	function applyCodeMove(code, m) {
		var v3 = code % 24, r = (code - v3) / 24;
		var v2 = r % 24; r = (r - v2) / 24;
		var v1 = r % 24; r = (r - v1) / 24;
		var v0 = r;
		var n0 = EM[m][v0 >> 1] ^ (v0 & 1);
		var n1 = EM[m][v1 >> 1] ^ (v1 & 1);
		var n2 = EM[m][v2 >> 1] ^ (v2 & 1);
		var n3 = EM[m][v3 >> 1] ^ (v3 & 1);
		return n0 * 13824 + n1 * 576 + n2 * 24 + n3;
	}
	function applyCodeMoves(code, moves) {
		for (var i = 0; i < moves.length; i++) { code = applyCodeMove(code, moves[i]); }
		return code;
	}

	var SOLVERS = {};

	function getSolver(colorFace, crossFace) {
		if (crossFace === undefined || crossFace === null) { crossFace = colorFace; }
		var key = colorFace * 6 + crossFace;
		if (SOLVERS[key]) { return SOLVERS[key]; }
		var info = buildTarget(colorFace, crossFace);
		var targetCode = encode4(info.target[0], info.target[1], info.target[2], info.target[3]);
		var dist = new Int8Array(331776);
		dist.fill(-1);
		dist[targetCode] = 0;
		var frontier = new Int32Array(200000), fLen = 0;
		var next = new Int32Array(200000);
		frontier[fLen++] = targetCode;
		var d = 0, visited = 1;
		while (fLen > 0) {
			var nLen = 0;
			for (var i = 0; i < fLen; i++) {
				var code = frontier[i];
				for (var m = 0; m < 18; m++) {
					var nc = applyCodeMove(code, m);
					if (dist[nc] === -1) {
						dist[nc] = d + 1;
						next[nLen++] = nc;
						visited++;
					}
				}
			}
			var tmp = frontier; frontier = next; next = tmp;
			fLen = nLen; d++;
		}
		var solver = {
			colorFace: colorFace, crossFace: crossFace, blocks: info.blocks, target: info.target,
			targetCode: targetCode, dist: dist, maxDist: d - 1, visited: visited
		};
		SOLVERS[key] = solver;
		return solver;
	}

	/* 从完整 facelet 状态取出 4 个目标棱的编码 */
	function codeFromFacelets(facelets, blocks) {
		var vs = [];
		for (var i = 0; i < 4; i++) {
			var b = blocks[i];
			var fA = EF[b][0], fB = EF[b][1];   // 该块在 solved 状态下的两个 facelet 位置
			var ca = facelets.indexOf(fA), cb = facelets.indexOf(fB); // 现在分别在哪个位置
			var pos = -1, ori = 0;
			for (var p = 0; p < 12; p++) {
				if (EF[p][0] === ca && EF[p][1] === cb) { pos = p; ori = 0; break; }
				if (EF[p][1] === ca && EF[p][0] === cb) { pos = p; ori = 1; break; }
			}
			vs.push(pos * 2 + ori);
		}
		return encode4(vs[0], vs[1], vs[2], vs[3]);
	}

	/* ---------------- 求解 ---------------- */
	/* 返回所有最短解（move 索引数组的数组），limit 限制条数 */
	function allShortestSolutions(solver, startCode, limit) {
		limit = limit || 400;
		var dist = solver.dist;
		var d0 = dist[startCode];
		if (d0 <= 0) { return []; }
		var out = [], path = [];
		(function rec(code, depth) {
			if (out.length >= limit) { return; }
			if (depth === 0) {
				if (code === solver.targetCode) { out.push(path.slice()); }
				return;
			}
			for (var m = 0; m < 18; m++) {
				var nc = applyCodeMove(code, m);
				if (dist[nc] === depth - 1) {
					path.push(m);
					rec(nc, depth - 1);
					path.pop();
					if (out.length >= limit) { return; }
				}
			}
		})(startCode, d0);
		return out;
	}

	/* 从 startCode 出发，在限定深度内找到距离为 want 的状态，返回 { code, path } */
	function localFix(solver, startCode, want, avoidFace, maxDepth) {
		maxDepth = maxDepth || 9;
		var dist = solver.dist;
		if (dist[startCode] === want) { return { code: startCode, path: [] }; }
		var seen = new Set();
		var queue = [{ code: startCode, path: [] }];
		seen.add(startCode);
		for (var depth = 1; depth <= maxDepth; depth++) {
			var nextQueue = [];
			for (var i = 0; i < queue.length; i++) {
				var node = queue[i];
				for (var m = 0; m < 18; m++) {
					if (node.path.length === 0 && avoidFace >= 0 && moveFace(m) === avoidFace) { continue; }
					if (node.path.length > 0 && moveFace(m) === moveFace(node.path[node.path.length - 1])) { continue; }
					var nc = applyCodeMove(node.code, m);
					if (seen.has(nc)) { continue; }
					seen.add(nc);
					var np = node.path.concat([m]);
					if (dist[nc] === want) { return { code: nc, path: np }; }
					nextQueue.push({ code: nc, path: np });
				}
			}
			queue = nextQueue;
		}
		return null;
	}

	/* 随机自然打乱（不含同面/同轴连续），用于打乱前缀 */
	function randomScramble(rng, len) {
		var moves = [], lastAxis = -1, lastLastAxis = -2;
		for (var i = 0; i < len; i++) {
			var m, guard = 0;
			do {
				m = (rng() * 18) | 0;
				var axis = (m / 3) | 0;
				var ax = axis % 3;
				guard++;
				if (guard > 50) { break; }
			} while (ax === lastAxis || (ax === lastLastAxis && (lastAxis % 3) === ((ax + 1) % 3)));
			var axis2 = (m / 3) | 0;
			lastLastAxis = lastAxis;
			lastAxis = axis2 % 3;
			moves.push(m);
		}
		return moves;
	}

	/* 生成一次训练：colorFace 十字颜色、crossFace 十字所在面、steps 解法步数（以复原态为起点） */
	function generate(colorFace, crossFace, steps, rng, opts) {
		return generateFrom(solvedFacelets(), colorFace, crossFace, steps, rng, opts);
	}

	/* 同 generate，但以给定状态 facelets 为打乱起点（魔方未还原时用其当前状态） */
	function generateFrom(facelets, colorFace, crossFace, steps, rng, opts) {
		opts = opts || {};
		rng = rng || Math.random;
		var solver = getSolver(colorFace, crossFace);
		if (steps > solver.maxDist) { steps = solver.maxDist; }
		// 起点状态未必是复原态（复原态也未必等于目标态，例如白十字做在底面）
		var startCode = codeFromFacelets(facelets, solver.blocks);
		for (var attempt = 0; attempt < 60; attempt++) {
			var prefix = randomScramble(rng, 16 + ((rng() * 6) | 0));
			var code = applyCodeMoves(startCode, prefix);
			var avoid = prefix.length ? moveFace(prefix[prefix.length - 1]) : -1;
			var fix = localFix(solver, code, steps, avoid, opts.maxFixDepth || 9);
			if (!fix) { continue; }
			var scramble = prefix.concat(fix.path);
			var solutions = allShortestSolutions(solver, fix.code, opts.limit || 200);
			if (!solutions.length) { continue; }
			solutions.sort(function (a, b) {
				var sa = a.map(function (m) { return MOVE_NAMES[m]; }).join(' ');
				var sb = b.map(function (m) { return MOVE_NAMES[m]; }).join(' ');
				return sa < sb ? -1 : sa > sb ? 1 : 0;
			});
			var endFacelets = applyFaceletMoves(facelets, scramble);
			return {
				colorFace: colorFace,
				crossFace: crossFace,
				steps: steps,
				baseFacelets: facelets,
				scramble: scramble,
				scrambleText: movesToText(scramble),
				solutions: solutions,
				solutionTexts: solutions.map(function (s) { return movesToText(s); }),
				scrambleFacelets: endFacelets,
				stateCode: fix.code
			};
		}
		return null;
	}

	/* ---------------- 序列工具 ---------------- */
	function movesToText(moves) {
		return moves.map(function (m) { return MOVE_NAMES[m]; }).join(' ');
	}
	function textToMoves(text) {
		var out = [];
		text.trim().split(/\s+/).forEach(function (tok) {
			var idx = MOVE_NAMES.indexOf(tok.toUpperCase().replace(/’/g, "'"));
			if (idx >= 0) { out.push(idx); }
		});
		return out;
	}
	function invertMoves(moves) {
		var out = [];
		for (var i = moves.length - 1; i >= 0; i--) { out.push(inverseMove(moves[i])); }
		return out;
	}
	/* 抵消：同面合并（含 360° 归零、A A' 抵消） */
	function simplifyMoves(moves) {
		var stack = [];
		for (var i = 0; i < moves.length; i++) {
			var f = moveFace(moves[i]), p = movePower(moves[i]);
			var top = stack[stack.length - 1];
			if (top && top[0] === f) {
				var c = (top[1] + p) % 4;
				if (c === 0) { stack.pop(); } else { top[1] = c; }
			} else {
				stack.push([f, p]);
			}
		}
		return stack.map(function (s) { return s[0] * 3 + (s[1] === 1 ? 0 : s[1] === 2 ? 1 : 2); });
	}
	/* ---------------- 硬件状态接入 ---------------- */
	var COLOR_CHARS = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

	/* 颜色数组（标准 URFDLB 面序，值 0-5 = U R F D L B）→ 内部 facelet 置换表示。
	   逐块匹配：中心按颜色；棱/角按该块当前颜色组合反查它原本是哪一块、朝向如何。 */
	function faceletsFromColors(colors) {
		if (!colors || colors.length < 54) { return null; }
		var f = new Array(54), i;
		for (i = 0; i < 54; i++) {
			var c = colors[i];
			if (!(c >= 0 && c <= 5)) { return null; }
		}
		for (var face = 0; face < 6; face++) {
			f[face * 9 + 4] = colors[face * 9 + 4] * 9 + 4;
		}
		for (var p = 0; p < 12; p++) {
			var s0 = EF[p][0], s1 = EF[p][1];
			var e = -1, flip = 0, e2;
			for (e2 = 0; e2 < 12; e2++) {
				var a = faceOfFacelet(EF[e2][0]), b = faceOfFacelet(EF[e2][1]);
				if (a === colors[s0] && b === colors[s1]) { e = e2; flip = 0; break; }
				if (b === colors[s0] && a === colors[s1]) { e = e2; flip = 1; break; }
			}
			if (e < 0) { return null; }
			f[s0] = EF[e][flip];
			f[s1] = EF[e][1 - flip];
		}
		for (var q = 0; q < 8; q++) {
			var t0 = CF[q][0], t1 = CF[q][1], t2 = CF[q][2];
			var hit = -1, ori = 0, c2, o;
			for (c2 = 0; c2 < 8 && hit < 0; c2++) {
				for (o = 0; o < 3; o++) {
					if (faceOfFacelet(CF[c2][o]) === colors[t0] &&
						faceOfFacelet(CF[c2][(o + 1) % 3]) === colors[t1] &&
						faceOfFacelet(CF[c2][(o + 2) % 3]) === colors[t2]) { hit = c2; ori = o; break; }
				}
			}
			if (hit < 0) { return null; }
			f[t0] = CF[hit][ori];
			f[t1] = CF[hit][(ori + 1) % 3];
			f[t2] = CF[hit][(ori + 2) % 3];
		}
		return f;
	}

	/* 硬件上报的 facelet 串（"UUUUURRRR…"，URFDLB 面序）→ 内部表示 */
	function faceletsFromColorString(str) {
		if (!str) { return null; }
		var arr = typeof str === 'string' ? str.split('') : str;
		if (arr.length < 54) { return null; }
		var colors = new Array(54);
		for (var i = 0; i < 54; i++) {
			var c = COLOR_CHARS[String(arr[i]).toUpperCase()];
			if (c === undefined) { return null; }
			colors[i] = c;
		}
		return faceletsFromColors(colors);
	}

	/* ---------------- 从任意状态重算解法 ---------------- */
	function sortSolutions(solutions) {
		solutions.sort(function (a, b) {
			var sa = a.map(function (m) { return MOVE_NAMES[m]; }).join(' ');
			var sb = b.map(function (m) { return MOVE_NAMES[m]; }).join(' ');
			return sa < sb ? -1 : sa > sb ? 1 : 0;
		});
		return solutions;
	}

	/* 把给定状态当作「打乱后状态」，重新枚举全部最短解（步数 = 该状态的实际距离） */
	function rebuildSolutions(facelets, colorFace, crossFace, limit) {
		var solver = getSolver(colorFace, crossFace);
		var code = codeFromFacelets(facelets, solver.blocks);
		var d = solver.dist[code];
		var solutions = d > 0 ? allShortestSolutions(solver, code, limit || 200) : [];
		return {
			steps: d,
			solutions: sortSolutions(solutions),
			solutionTexts: solutions.map(function (s) { return movesToText(s); }),
			scrambleFacelets: facelets,
			stateCode: code
		};
	}

	/* 判断当前 facelet 状态是否已完成指定颜色在指定面上的十字 */
	function isCrossDone(facelets, colorFace, crossFace, blocks) {
		var solver = getSolver(colorFace, crossFace);
		return codeFromFacelets(facelets, solver.blocks) === solver.targetCode;
	}

	return {
		MOVE_NAMES: MOVE_NAMES,
		FACES: FACES,
		FACE_INDEX: FACE_INDEX,
		COLOR_OF_FACE: COLOR_OF_FACE,
		COLOR_NAME: COLOR_NAME,
		moveFace: moveFace,
		movePower: movePower,
		inverseMove: inverseMove,
		solvedFacelets: solvedFacelets,
		applyFaceletMove: applyFaceletMove,
		applyFaceletMoves: applyFaceletMoves,
		buildTarget: buildTarget,
		getSolver: getSolver,
		codeFromFacelets: codeFromFacelets,
		applyCodeMoves: applyCodeMoves,
		allShortestSolutions: allShortestSolutions,
		generate: generate,
		generateFrom: generateFrom,
		faceletsFromColors: faceletsFromColors,
		faceletsFromColorString: faceletsFromColorString,
		rebuildSolutions: rebuildSolutions,
		movesToText: movesToText,
		textToMoves: textToMoves,
		invertMoves: invertMoves,
		simplifyMoves: simplifyMoves,
		isCrossDone: isCrossDone,
		randomScramble: randomScramble
	};
});
