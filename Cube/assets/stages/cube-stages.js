/*
 * Cube 阶段节点库（公用）
 * ---------------------------------------------------------------------------
 * 训练场「选一段复原流程来练」的节点定义与判定。
 *
 * 设计口径（与用户确认）：
 *   · 节点 = 复原过程中可以停下来打点的某个层级，不限解法流派；
 *     不存在「CFOP 一条路 / Roux 一条路」这种预设路线，节点是一张图上的点，
 *     用户自己在任意两点之间连线，中间经过哪些点由用户自己定。
 *   · 所以本文件只提供「节点表 + 每个节点的状态判定」，不提供路线。
 *
 * 六色底（重要）：
 *   · 所有判定都按「参考系」算，参考系 = 底面 + 前面。
 *   · 完整打乱态下自动识别底色：枚举全部 24 个参考系，看哪个参考系底下
 *     当前状态离目标最近（已完成的层级最多），这就是「最该用的底色」。
 *   · 其他节点状态下底色由用户选择（界面给六色按钮），不再自动改。
 *   · 判定一律在 facelet 层做「重定向」而不是整体转动魔方：
 *     把参考系翻译成一个 facelet 索引映射，判定函数只看映射后的 54 贴纸。
 *
 * 依赖：mathlib（CubieCube 用于置换类判定）、TrainerCommon.FaceletUtil（基本口径）。
 */
(function (root) {
	'use strict';

	var F = root.TrainerCommon && root.TrainerCommon.FaceletUtil;
	if (!F) { return; }

	var FACES = ["U", "R", "F", "D", "L", "B"];

	/* ================= 参考系（frame） =================
	 * frame = { bottom: 'D', front: 'F' }；bottom 与 front 必须相邻。
	 * 我们把「用户眼里的底面」映射到标准坐标的 D 面、「前面」映射到 F 面。
	 *
	 * 实现方式：不做魔方整体旋转（那会改变 facelet 串的物理含义），
	 * 而是在读贴纸时用一张「坐标 → 标准索引」的映射表。
	 * 映射表由「把 bottom 转到 D、front 转到 F 的整体旋转」推导：
	 *   对每个标准位置，算出它在旋转后落在哪，再取该位置的字符。
	 */

	/* 标准坐标下每个 facelet 的法向（与 trainer-common 的坐标系一致：
	 * U=+y R=+x F=+z D=-y L=-x B=-z） */
	var NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };

	/* 面 → facelet 起始索引（U=0 R=9 F=18 D=27 L=36 B=45） */
	var FACE_START = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

	/* 行列 → 面上的局部索引（0..8，行优先） */
	function localIdx(row, col) { return row * 3 + col; }

	/* 给定面 f、局部 (row,col)，返回该贴纸在标准 facelet 串中的索引 */
	function faceletIndex(f, row, col) { return FACE_START[f] + localIdx(row, col); }

	/* 面的行/列方向：对每个面定义「屏幕右方向」与「屏幕下方向」在世界坐标里是什么。
	 * 这样从 world 坐标反查 (row,col) 才是对的。
	 * 返回 { right:[x,y,z], down:[x,y,z] } */
	var FACE_AXES = {
		U: { right: [1, 0, 0], down: [0, 0, 1] },    // 俯视 U：右=+x，下=+z
		D: { right: [1, 0, 0], down: [0, 0, -1] },   // 仰视 D：右=+x，下=-z
		F: { right: [1, 0, 0], down: [0, -1, 0] },   // 正视 F：右=+x，下=-y
		B: { right: [-1, 0, 0], down: [0, -1, 0] },  // 正视 B：右=-x，下=-y
		R: { right: [0, 0, -1], down: [0, -1, 0] },  // 正视 R：右=-z，下=-y
		L: { right: [0, 0, 1], down: [0, -1, 0] }    // 正视 L：右=+z，下=-y
	};

	/* 由轴对齐法向反查面名 */
	function faceOfNormal(n) {
		for (var i = 0; i < FACES.length; i++) {
			var m = NORMAL[FACES[i]];
			if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) { return FACES[i]; }
		}
		return null;
	}

	/* 世界坐标 → 标准 facelet 索引。
	 * 输入是「面法向」与两个切向偏移 —— 不是贴纸的三维点。
	 * 角块贴纸的三维点有三个非零分量（如 (1,1,-1)），拿它去「按最大分量挑面」会挑错，
	 * 所以这里只接受法向（轴对齐单位向量，无歧义）+ 已经解好的 (row,col) 偏移。 */
	function worldToIndex(normal, rightOff, downOff) {
		var face = null;
		for (var i = 0; i < FACES.length; i++) {
			var n = NORMAL[FACES[i]];
			if (n[0] === normal[0] && n[1] === normal[1] && n[2] === normal[2]) { face = FACES[i]; break; }
		}
		if (!face) { return -1; }
		var row = Math.round(downOff) + 1, col = Math.round(rightOff) + 1;
		if (row < 0 || row > 2 || col < 0 || col > 2) { return -1; }
		return faceletIndex(face, row, col);
	}

	/* 整体旋转：把 frame 的 bottom 转到 D、front 转到 F。
	 * 返回一个「读字符」函数 map(standardIdx) → 原始串索引。
	 *
	 * 做法：对标准位置 i（属于面 f、局部 r,c），先算它的世界坐标 w，
	 * 然后用逆旋转 R⁻¹ 得到它在原魔方里的世界坐标 w0，
	 * 再把 w0 投影回某个面的局部坐标，取原始串对应字符。
	 * 这样「标准位置上的贴纸」=「原魔方里该位置的实际贴纸」，等价于把魔方整体转正。 */

	function rotMatFromTo(fromVec, toVec) {
		/* 构造把 fromVec 转到 toVec 的一个旋转矩阵（整数，因为都是轴对齐单位向量） */
		var f = fromVec, t = toVec;
		if (f[0] === t[0] && f[1] === t[1] && f[2] === t[2]) { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
		var dot = f[0] * t[0] + f[1] * t[1] + f[2] * t[2];
		var cross = [f[1] * t[2] - f[2] * t[1], f[2] * t[0] - f[0] * t[2], f[0] * t[1] - f[1] * t[0]];
		if (dot === -1) {
			/* 反向：绕任意垂直轴转 180°，取与 f 不平行的轴 */
			var axis = Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
			/* 正交化 */
			var d2 = axis[0] * f[0] + axis[1] * f[1] + axis[2] * f[2];
			axis = [axis[0] - d2 * f[0], axis[1] - d2 * f[1], axis[2] - d2 * f[2]];
			var c2 = [f[1] * axis[2] - f[2] * axis[1], f[2] * axis[0] - f[0] * axis[2], f[0] * axis[1] - f[1] * axis[0]];
			/* 绕 axis 转 180：R = 2*aa^T - I */
			return [
				2 * axis[0] * axis[0] - 1, 2 * axis[0] * axis[1], 2 * axis[0] * axis[2],
				2 * axis[1] * axis[0], 2 * axis[1] * axis[1] - 1, 2 * axis[1] * axis[2],
				2 * axis[2] * axis[0], 2 * axis[2] * axis[1], 2 * axis[2] * axis[2] - 1
			];
		}
		return [
			cross[0] * cross[0] + dot, cross[0] * cross[1] - cross[2], cross[0] * cross[2] + cross[1],
			cross[1] * cross[0] + cross[2], cross[1] * cross[1] + dot, cross[1] * cross[2] - cross[0],
			cross[2] * cross[0] - cross[1], cross[2] * cross[1] + cross[0], cross[2] * cross[2] + dot
		];
	}
	function applyMat(m, v) {
		return [
			m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
			m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
			m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
		];
	}
	function transposeMat(m) {
		return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
	}
	function round3(v) { return [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])]; }

	/* 计算「把 bottom 转到 D、front 转到 F」的旋转矩阵 R。
	 * 先求把 bottom→D 的旋转 A；再在 A 之后绕 y 轴微调，使 front 落位到 F。 */
	function frameMatrix(bottom, front) {
		var A = rotMatFromTo(NORMAL[bottom], NORMAL.D);
		/* A 之后 front 去了哪 */
		var fAfter = round3(applyMat(A, NORMAL[front]));
		/* 绕 y 轴旋转，把 fAfter 转到 F=(0,0,1)。允许 4 种 90° 步进 */
		var steps = null;
		var cur = fAfter;
		for (var k = 0; k < 4; k++) {
			if (cur[0] === 0 && cur[1] === 0 && cur[2] === 1) { steps = k; break; }
			/* 绕 y 轴 +90°： (x,y,z) -> (z, y, -x) */
			cur = [cur[2], cur[1], -cur[0]];
		}
		if (steps === null) { return null; }
		var Y = [1, 0, 0, 0, 1, 0, 0, 0, 1];
		var yStep = [0, 0, 1, 0, 1, 0, -1, 0, 0]; /* 绕 y +90° */
		for (var s = 0; s < steps; s++) { Y = matMul(yStep, Y); }
		return matMul(Y, A);
	}
	function matMul(a, b) {
		var o = new Array(9);
		for (var r = 0; r < 3; r++) {
			for (var c = 0; c < 3; c++) {
				o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
			}
		}
		return o;
	}

	/* 构建「标准位置 → 原始串索引」映射。
	 *
	 * 正确做法（曾经写错两次，这里说明清楚）：
	 *   不要变换「贴纸的三维点」再去反查它属于哪一面 —— 角块贴纸的点有多个非零
	 *   分量，按最大分量挑面会挑错，且会算出重复/缺失的映射。
	 *   要变换的是「面的法向」与「面的两个切向」：
	 *     · 标准面 f 的法向 n 经 R⁻¹ 后，唯一确定它原本属于哪一面 f0；
	 *     · 该面的 right/down 切向也经 R⁻¹ 变换，就在 f0 的坐标系里给出 (row,col)。
	 *   这样每个标准贴纸都得到唯一且互不重复的原图索引（54 个目标双射）。 */
	function buildRemap(bottom, front) {
		var R = frameMatrix(bottom, front);
		if (!R) { return null; }
		var Rt = transposeMat(R);
		var remap = new Array(54);
		for (var fi = 0; fi < FACES.length; fi++) {
			var f = FACES[fi];
			var ax = FACE_AXES[f];
			var nC = round3(applyMat(Rt, NORMAL[f]));      /* 原魔方里这个面朝哪 */
			var nR = round3(applyMat(Rt, ax.right));       /* 原魔方里「右」指向哪 */
			var nD = round3(applyMat(Rt, ax.down));        /* 原魔方里「下」指向哪 */
			var f0 = faceOfNormal(nC);
			if (!f0) { return null; }
			var ax0 = FACE_AXES[f0];
			for (var row = 0; row < 3; row++) {
				for (var col = 0; col < 3; col++) {
					var rOff = col - 1, dOff = row - 1;
					/* 把切向偏移搬到原魔方坐标系 */
					var t = [
						nR[0] * rOff + nD[0] * dOff,
						nR[1] * rOff + nD[1] * dOff,
						nR[2] * rOff + nD[2] * dOff
					];
					var rightOff = t[0] * ax0.right[0] + t[1] * ax0.right[1] + t[2] * ax0.right[2];
					var downOff = t[0] * ax0.down[0] + t[1] * ax0.down[1] + t[2] * ax0.down[2];
					var idx = worldToIndex(nC, rightOff, downOff);
					if (idx < 0) { return null; }
					remap[faceletIndex(f, row, col)] = idx;
				}
			}
		}
		return remap;
	}

	/* 把某个 facelet 串按 frame 归一化到「标准坐标」（底面=bottom、前面=front）：
	 * 返回一个 54 长度的字符数组，下标语义与标准 facelet 一致。
	 *
	 * 归一化后各面中心必然是「该面字母」—— 这是参考系成立的判据（也验证了重映射正确）。
	 * 若中心对不上，说明调用方给了非法 frame（底与前后相邻），此时退回原串并按
	 * 默认参考系处理，避免把整页判定拖成静默错误。 */
	function normalize(f, frame) {
		frame = frame || { bottom: "D", front: "F" };
		var remap = (frame.bottom === "D" && frame.front === "F")
			? null
			: buildRemap(frame.bottom, frame.front);
		if (!remap) { return f.split(""); }
		var out = new Array(54);
		for (var i = 0; i < 54; i++) { out[i] = f.charAt(remap[i]); }
		for (var k = 0; k < FACES.length; k++) {
			if (out[FACE_START[FACES[k]] + 4] !== FACES[k]) {
				return f.split("");
			}
		}
		return out;
	}

	/* 全部 24 个合法参考系（bottom 6 × front 4，front 与 bottom 相邻） */
	var FRAMES = (function () {
		var out = [];
		for (var b = 0; b < 6; b++) {
			var bottom = FACES[b];
			for (var q = 0; q < 6; q++) {
				var front = FACES[q];
				if (NORMAL[front][0] === -NORMAL[bottom][0] &&
					NORMAL[front][1] === -NORMAL[bottom][1] &&
					NORMAL[front][2] === -NORMAL[bottom][2]) { continue; } /* 对面不行 */
				if (front === bottom) { continue; }
				out.push({ bottom: bottom, front: front });
			}
		}
		return out;
	})();

	/* ================= 基础工具（都吃「归一化后的字符数组」） ================= */

	function charsAt(a, idx) {
		var out = "";
		for (var i = 0; i < idx.length; i++) { out += a[idx[i]]; }
		return out;
	}
	function allChar(a, idx, ch) {
		for (var i = 0; i < idx.length; i++) { if (a[idx[i]] !== ch) { return false; } }
		return true;
	}
	function faceDone(a, face) {
		var s = FACE_START[face];
		return allChar(a, [s, s + 1, s + 2, s + 3, s + 4, s + 5, s + 6, s + 7, s + 8], face);
	}

	var TOP_ROWS = [[9, 10, 11], [18, 19, 20], [36, 37, 38], [45, 46, 47]];   /* R F L B */
	var MID_ROWS = [[12, 13, 14], [21, 22, 23], [39, 40, 41], [48, 49, 50]];
	var BOTTOM_ROWS = [[15, 16, 17], [24, 25, 26], [42, 43, 44], [51, 52, 53]];
	var BOTTOM_FACES = ["R", "F", "L", "B"];
	var MID_FACES = ["R", "F", "L", "B"];

	/* ---- 十字 / F2L ---- */
	function crossDoneA(a) {
		if (!faceDone(a, "D")) { return false; }
		for (var i = 0; i < 4; i++) { if (!allChar(a, BOTTOM_ROWS[i], BOTTOM_FACES[i])) { return false; } }
		return true;
	}
	function f2lDoneA(a) {
		if (!crossDoneA(a)) { return false; }
		for (var i = 0; i < 4; i++) { if (!allChar(a, MID_ROWS[i], MID_FACES[i])) { return false; } }
		return true;
	}
	var F2L_SLOTS = [0, 1, 2, 3].map(function (i) {
		return { index: i, key: BOTTOM_FACES[i], bottom: BOTTOM_ROWS[i], mid: MID_ROWS[i], face: BOTTOM_FACES[i] };
	});
	function slotDoneA(a, slot) {
		var s = F2L_SLOTS[slot];
		return allChar(a, s.bottom, s.face) && allChar(a, s.mid, s.face);
	}
	function f2lSlotsDoneA(a) {
		var n = 0;
		for (var i = 0; i < 4; i++) { if (slotDoneA(a, i)) { n++; } }
		return n;
	}

	/* ---- U 层方向 ---- */
	var U_EDGE_IDX = [1, 3, 5, 7];
	var U_CORNER_IDX = [0, 2, 6, 8];
	function ollEdgesA(a) { return f2lDoneA(a) && allChar(a, U_EDGE_IDX, "U"); }
	function ollCornersA(a) { return f2lDoneA(a) && allChar(a, U_CORNER_IDX, "U"); }
	function ollA(a) { return f2lDoneA(a) && allChar(a, [0, 1, 2, 3, 4, 5, 6, 7, 8], "U"); }

	/* ---- U 层位置（置换）----
	 * 方向与位置是**正交**的两件事（OLL 管方向、PLL 管位置），所以这里判定位置时
	 * 一律**不看朝向** —— 棱可以还是翻的、角可以还是拧的，「先把棱的位置摆对、
	 * 角还没翻正」这种中间态必须能被判定出来。
	 *
	 * 判定口径：U 层这 4 个块是否各自回到了「正确的位置」。
	 * 位置用 cubie 的归属判断（块 i 应在的位置 i），并容忍 AUF：
	 * 顶层整层转动后，所有块的位置会整体循环一位，这不算没做对，
	 * 所以判据是「存在某个 k ∈ {0,1,2,3}，使每个块都落在 (应在位置 + k) 上」。 */
	function cubieOfA(a) {
		var ML = root.mathlib;
		if (!ML || !ML.CubieCube) { return null; }
		try {
			var c = new ML.CubieCube();
			var s = a.join("");
			if (c.fromFacelet(s) === -1) { return null; }
			return c;
		} catch (e) { return null; }
	}
	/* 一块都没跑出 U 层，且相对次序是纯循环位移（容忍 AUF） */
	function uLayerRotation(locs) {
		var sorted = locs.slice().sort(function (x, y) { return x - y; });
		if (sorted.join(",") !== "0,1,2,3") { return false; }
		var d = ((locs[1] - locs[0]) % 4 + 4) % 4;
		return ((locs[2] - locs[1]) % 4 + 4) % 4 === d && ((locs[3] - locs[2]) % 4 + 4) % 4 === d;
	}
	/* U 层棱的位置已归位（不看朝向）：块 i 落在位置 (i + k) 上，k 对四个块一致。
	 * cubie.ea[i] = 位置*2 + 朝向，取 >>1 得到位置。 */
	function uEdgesPlacedA(a) {
		var c = cubieOfA(a);
		if (!c) { return false; }
		var locs = [];
		for (var i = 0; i < 4; i++) { locs.push((c.ea[i] >> 1) - i); }
		return sameShift(locs);
	}
	/* U 层角的位置已归位（不看朝向）：cubie.ca[i] 直接是块 i 所在的位置 */
	function uCornersPlacedA(a) {
		var c = cubieOfA(a);
		if (!c) { return false; }
		var locs = [];
		for (var i = 0; i < 4; i++) { locs.push(c.ca[i] - i); }
		return sameShift(locs);
	}
	/* 四个 (所在位置 - 应在位置) 的差值是否同一个 mod 4 —— 即整层纯转动造成的位移。
	 * 注意：每个块的差值本身要落在 {-3..3}，等价于它在 U 层内的循环距离，
	 * 所以先归一化到 0..3 再比较。 */
	function sameShift(diffs) {
		var norm = diffs.map(function (d) { return ((d % 4) + 4) % 4; });
		for (var i = 1; i < norm.length; i++) { if (norm[i] !== norm[0]) { return false; } }
		return true;
	}

	/* ---- 顶层四个正交目标 ----
	 *   ollEdge   棱的方向（翻棱）
	 *   ollCorner 角的方向（翻角）
	 *   pllEdge   棱的位置（控棱位）
	 *   pllCorner 角的位置（控角位）
	 * 四者互相独立，任意组合、任意先后都能判定。 */
	function pllEdgesA(a) { return f2lDoneA(a) && uEdgesPlacedA(a); }
	function pllCornersA(a) { return f2lDoneA(a) && uCornersPlacedA(a); }
	function solvedA(a) {
		if (!faceDone(a, "U") || !faceDone(a, "D")) { return false; }
		for (var i = 0; i < 4; i++) {
			if (!rowUniformA(a, TOP_ROWS[i])) { return false; }
			if (!rowUniformA(a, MID_ROWS[i])) { return false; }
			if (!rowUniformA(a, BOTTOM_ROWS[i])) { return false; }
		}
		return true;
	}
	function rowUniformA(a, idx) {
		var c = a[idx[0]];
		for (var i = 1; i < idx.length; i++) { if (a[idx[i]] !== c) { return false; } }
		return true;
	}

	/* ---- Roux ---- */
	var FB_LEFT = { face: "L", extra: { F: [18, 21, 24], B: [47, 50, 53] } };
	var SB_RIGHT = { face: "R", extra: { F: [20, 23, 26], B: [45, 48, 51] } };
	function blockDoneA(a, def) {
		if (!faceDone(a, def.face)) { return false; }
		for (var face in def.extra) {
			if (!Object.prototype.hasOwnProperty.call(def.extra, face)) { continue; }
			if (!allChar(a, def.extra[face], face)) { return false; }
		}
		return true;
	}
	function fbA(a) { return blockDoneA(a, FB_LEFT); }
	function sbA(a) { return fbA(a) && blockDoneA(a, SB_RIGHT); }
	function cmllA(a) {
		if (!sbA(a)) { return false; }
		if (!faceDone(a, "U")) { return false; }
		return uCornersPlacedA(a);
	}
	function lseA(a) { return solvedA(a); }

	/* ================= 节点表 ================= */

	var GROUPS = [
		{ id: "base",  name: "起止",     color: "#8ab4f8" },
		{ id: "cross", name: "十字",     color: "#7ee0d0" },
		{ id: "f2l",   name: "F2L",      color: "#24f0ea" },
		{ id: "oll",   name: "顶层方向", color: "#c9a6ff" },
		{ id: "pll",   name: "顶层置换", color: "#f0a6d8" },
		{ id: "roux",  name: "桥式",     color: "#f5c518" }
	];

	/* done 接收「归一化字符数组」 */
	var NODES = [
		{ id: "scramble", name: "打乱态", group: "base", start: true, end: false,
			desc: "随机打乱后的原始状态，通常作为整条路的起点。", done: function () { return true; } },
		{ id: "solved", name: "复原", group: "base", start: false, end: true,
			desc: "魔方完全复原（容忍收尾的顶层转动）。", done: solvedA },

		{ id: "cross", name: "十字", group: "cross",
			desc: "底面十字完成：底面纯色，四条底行各自对上该面颜色。", done: crossDoneA },

		{ id: "f2l1", name: "F2L 1", group: "f2l",
			desc: "底面十字加任意 1 组前两层就位（不限定是哪一槽）。", done: function (a) { return crossDoneA(a) && f2lSlotsDoneA(a) >= 1; } },
		{ id: "f2l2", name: "F2L 2", group: "f2l",
			desc: "底面十字加任意 2 组前两层就位。", done: function (a) { return crossDoneA(a) && f2lSlotsDoneA(a) >= 2; } },
		{ id: "f2l3", name: "F2L 3", group: "f2l",
			desc: "底面十字加任意 3 组前两层就位。", done: function (a) { return crossDoneA(a) && f2lSlotsDoneA(a) >= 3; } },
		{ id: "f2l4", name: "F2L 4", group: "f2l",
			desc: "前两层全部完成：四槽都归位且中行对上自身面颜色。", done: f2lDoneA },

		{ id: "ollEdge", name: "OLL 棱", group: "oll",
			desc: "顶面四条棱已翻正（顶面出十字）。只看棱的朝向，角位/角朝向、棱的位置都不管。", done: ollEdgesA },
		{ id: "ollCorner", name: "OLL 角", group: "oll",
			desc: "顶面四个角已翻正。只看角的朝向，棱朝向、棱位/角位都不管。", done: ollCornersA },
		{ id: "oll", name: "OLL", group: "oll",
			desc: "顶层方向全部完成：棱与角都已翻正（顶面纯色），且前两层保持完好。", done: ollA },

		{ id: "pllEdge", name: "PLL 棱", group: "pll",
			desc: "顶层棱块位置已归位。只看棱的位置，与朝向无关 —— 角还没翻正也能达成。", done: pllEdgesA },
		{ id: "pllCorner", name: "PLL 角", group: "pll",
			desc: "顶层角块位置已归位。只看角的位置，与朝向无关 —— 棱还没翻正也能达成。", done: pllCornersA },
		{ id: "pll", name: "PLL", group: "pll",
			desc: "最后一层复原：整个魔方完成（容忍收尾的顶层转动）。", done: solvedA },

		{ id: "fb", name: "左桥", group: "roux",
			desc: "左侧 1×2×3 块完成。", done: fbA },
		{ id: "sb", name: "右桥", group: "roux",
			desc: "左桥加右侧 1×2×3 块完成（两个桥都搭好）。", done: sbA },
		{ id: "cmll", name: "CMLL", group: "roux",
			desc: "两桥完好且顶层四角已复原。", done: cmllA },
		{ id: "lse", name: "LSE", group: "roux",
			desc: "最后六棱完成，魔方整体复原。", done: lseA }
	];

	function nodeById(id) {
		for (var i = 0; i < NODES.length; i++) { if (NODES[i].id === id) { return NODES[i]; } }
		return null;
	}
	function groupById(id) {
		for (var i = 0; i < GROUPS.length; i++) { if (GROUPS[i].id === id) { return GROUPS[i]; } }
		return GROUPS[GROUPS.length - 1];
	}

	/* 判定：nodeId 在 frame 参考系下是否达成 */
	function doneAt(nodeId, facelet, frame) {
		var n = nodeById(nodeId);
		if (!n || !facelet) { return false; }
		try {
			var a = normalize(facelet, frame);
			return !!n.done(a);
		} catch (e) { return false; }
	}

	function progressIndex(path, facelet, frame) {
		for (var i = 0; i < path.length; i++) {
			if (!doneAt(path[i], facelet, frame)) { return i; }
		}
		return path.length;
	}

	/* ================= 底色自动识别 =================
	 * 完整打乱态下：枚举 24 个参考系，给每个参考系打分 = 已完成的层级数，
	 * 选得分最高（离目标最近）的参考系。同分时优先白底，其次按 FACES 顺序。
	 *
	 * 打分口径：把「该 frame 下已经满足的节点」按难易加权，
	 * 越靠后的节点权重越大（能直接做出 F2L 的底色显然更值得选）。 */
	var FRAME_WEIGHTS = {
		cross: 10, f2l1: 6, f2l2: 8, f2l3: 10, f2l4: 14,
		ollEdge: 3, ollCorner: 3, oll: 8, pll: 6,
		fb: 10, sb: 14, cmll: 6, lse: 6, solved: 20
	};
	function scoreFrame(facelet, frame) {
		var a;
		try { a = normalize(facelet, frame); } catch (e) { return -1; }
		var score = 0;
		if (crossDoneA(a)) {
			score += FRAME_WEIGHTS.cross;
			var slots = f2lSlotsDoneA(a);
			score += [0, 6, 12, 18][slots] || 0;
			if (slots === 4) { score += 14; }
			if (ollA(a)) {
				score += FRAME_WEIGHTS.oll + FRAME_WEIGHTS.pll;
				/* 已定向再看置换进度 */
				if (uEdgesPlacedA(a)) { score += 3; }
				if (uCornersPlacedA(a)) { score += 3; }
				if (solvedA(a)) { score += FRAME_WEIGHTS.solved; }
			}
		}
		if (fbA(a)) {
			score += FRAME_WEIGHTS.fb;
			if (sbA(a)) {
				score += FRAME_WEIGHTS.sb;
				if (cmllA(a)) { score += FRAME_WEIGHTS.cmll; }
			}
		}
		return score;
	}

	/* 返回按得分从高到低排好的参考系（含分数），供界面展示「推荐底色」 */
	function rankFrames(facelet) {
		var out = FRAMES.map(function (fr) {
			return { frame: fr, score: scoreFrame(facelet, fr) };
		});
		out.sort(function (x, y) {
			if (y.score !== x.score) { return y.score - x.score; }
			/* 同分：优先白底（D/F），再按面序 */
			var wx = (x.frame.bottom === "D" ? 0 : 1), wy = (y.frame.bottom === "D" ? 0 : 1);
			if (wx !== wy) { return wx - wy; }
			return FACES.indexOf(x.frame.bottom) - FACES.indexOf(y.frame.bottom) ||
				FACES.indexOf(x.frame.front) - FACES.indexOf(y.frame.front);
		});
		return out;
	}
	function bestFrame(facelet) {
		var r = rankFrames(facelet);
		return r.length ? r[0] : { frame: { bottom: "D", front: "F" }, score: 0 };
	}

	/* ================= 路径合法性 ================= */
	function validatePath(path) {
		if (!Array.isArray(path) || path.length < 2) { return { ok: false, reason: "至少选两个节点" }; }
		var seen = {};
		for (var i = 0; i < path.length; i++) {
			var n = nodeById(path[i]);
			if (!n) { return { ok: false, reason: "未知节点 " + path[i] }; }
			if (seen[path[i]]) { return { ok: false, reason: "节点重复：" + n.name }; }
			seen[path[i]] = 1;
		}
		if (path[0] === path[path.length - 1]) { return { ok: false, reason: "起点与终点不能相同" }; }
		var endNode = nodeById(path[path.length - 1]);
		if (endNode && endNode.end === false) { return { ok: false, reason: endNode.name + " 不能作为终点" }; }
		return { ok: true, reason: "" };
	}

	root.CubeStages = {
		FACES: FACES,
		GROUPS: GROUPS,
		NODES: NODES,
		FRAMES: FRAMES,
		nodeById: nodeById,
		groupById: groupById,
		doneAt: doneAt,
		progressIndex: progressIndex,
		validatePath: validatePath,
		/* 参考系 */
		normalize: normalize,
		buildRemap: buildRemap,
		frameMatrix: frameMatrix,
		bestFrame: bestFrame,
		rankFrames: rankFrames,
		scoreFrame: scoreFrame,
		/* 单项判定（吃 facelet + 可选 frame） */
		pred: {
			cross: function (f, fr) { return crossDoneA(normalize(f, fr)); },
			f2lDone: function (f, fr) { return f2lDoneA(normalize(f, fr)); },
			f2lSlots: function (f, fr) { return f2lSlotsDoneA(normalize(f, fr)); },
			ollEdges: function (f, fr) { return ollEdgesA(normalize(f, fr)); },
			ollCorners: function (f, fr) { return ollCornersA(normalize(f, fr)); },
			oll: function (f, fr) { return ollA(normalize(f, fr)); },
			pllEdges: function (f, fr) { return pllEdgesA(normalize(f, fr)); },
			pllCorners: function (f, fr) { return pllCornersA(normalize(f, fr)); },
			solved: function (f, fr) { return solvedA(normalize(f, fr)); },
			fb: function (f, fr) { return fbA(normalize(f, fr)); },
			sb: function (f, fr) { return sbA(normalize(f, fr)); },
			cmll: function (f, fr) { return cmllA(normalize(f, fr)); },
			lse: function (f, fr) { return lseA(normalize(f, fr)); }
		}
	};
})(typeof globalThis !== "undefined" ? globalThis : this);
