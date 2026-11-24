/*
 * 魔方案例示意图（Cube 公用）
 * ---------------------------------------------------------------------------
 * 只做「状态 → 一张 SVG 图」，不掺页面状态、文案与交互。两种视角：
 *
 *   net  紧凑展开图：中间一个 3×3 面 + 四周 12 条块 = 48 个色块 rect。
 *        这是本站示例图的主视角，Analyzer 的 Case 卡片用它。
 *
 *   iso  斜三面视图：上面 + 前左面 + 前右面 = 27 张贴纸多边形。
 *        正交投影（yaw −34°、俯视 28.5°、轻微透视），参数见下方 ISO 段。
 *
 * 与 Cube/assets/cube-net/cube-net.js 的分工：
 *   cube-net    六个面完整展开（DOM 方块），给「看当前魔方状态」用；
 *   cube-figure 一张紧凑示意图（矢量 SVG），给「列表/卡片缩略图」用。
 *   两者都收 54 字符面位串，口径一致，调用页不需要自己换算。
 *
 * 用法（脚本用 defer 引入即可，无依赖，不碰 DOM 之外的东西）：
 *
 *   // 1) 最省事：给一个 54 字符面位串（URFDLB，与 mathlib.SOLVED_FACELET 同口径）
 *   CubeFigure.render(el, { state: mathlib.SOLVED_FACELET });
 *
 *   // 2) 只想要字符串 / data URI（<img src> 或 CSS background 用）
 *   img.src = CubeFigure.dataURI({ state: facelet, view: 'iso', size: 96 });
 *
 *   // 3) 只要某个面（case 数据就是这种形态：五个面各 9 格）
 *   CubeFigure.svg({ state: { U:'yyyyyyyyy', F:'ggggggggg', R:'rrrrrrrrr' } });
 *
 *   // 4) 加换位箭头
 *   CubeFigure.svg({ state: facelet, arrows: [['U0','U2'], ['U2','U8'], ['U8','U0']] });
 *   CubeFigure.svg({ state: facelet, arrows: ['U0>U2', 'U2>U8'] });      // 字符串写法
 *   CubeFigure.svg({ state: facelet, arrows: [['U1','U7','<>']] });      // 双头
 *   CubeFigure.svg({ state: facelet, arrows: CubeFigure.arrowCycle('U0 U2 U8') });
 *
 * 输入口径（state 认这几种，缺的面按「未指定」灰处理，不会抛错）：
 *   · 54 字符面位串          'URFDLB' 六面各 9 格，URFDLB 顺序 —— 颜色取调色板的「面」表
 *   · 54 长度数值数组        每格 0..53（cube-net.toNumeric 那种），face = floor(v/9)
 *   · { U,D,F,B,R,L }        每面 9 字符（面字母或颜色字母都行）或 9 个颜色值
 *
 * 调色板：
 *   'site'（默认）白红绿黄橙蓝，取自 cube-net.js，全站示意图同色。
 *   也可传自定义对象，形如 { U,R,F,D,L,B, grey, letters:{r,o,b,g,w,y,l} }。
 *
 * 选项（render / svg / dataURI 通用）：
 *   state       见上，必填
 *   view        'net'（默认）| 'iso'
 *   size        输出 width/height 像素值；net 默认 75，iso 默认 96
 *   palette     'site' | 对象
 *   background  给底色的可选填充色（默认不画，缝隙透出页面背景）
 *   title       给 SVG 加 <title>（无障碍用）
 *   arrows      箭头数组，见上文。指向用「面字母 + 该面第几格(0..8，行优先)」。
 *                net 视图只画得出 U 九格与四个侧面的首行（F/B/L/R 的 0..2）；
 *                iso 视图用 U / F / R（其余三面在背面）。
 *   arrowColor  箭头色，默认 #5d4ea8
 */
(function (root) {
	'use strict';

	var VERSION = '1.0.0';

	// 六面顺序，与 mathlib / 面位串一致
	var FACE_ORDER = 'URFDLB';
	var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

	// 全站示意图配色（与 cube-net.js 的 COLOR_OF_FACE 同源，全站一眼同色）
	var SITE_PALETTE = {
		U: '#f5f5f5',
		R: '#c62828',
		F: '#2e9e4b',
		D: '#f5c518',
		L: '#ef6c1a',
		B: '#1565c0',
		grey: '#888888',
		// 面位串里出现的小写颜色字母（r/o/b/g/w/y/l）按这张表取色，
		// 与上面的面表同色，只是换了个写法而已。
		letters: { r: '#c62828', o: '#ef6c1a', b: '#1565c0', g: '#2e9e4b', w: '#f5f5f5', y: '#f5c518', l: '#888888' }
	};

	// ---------------------------------------------------------------- net 几何
	// 一个 3×3 面 = 9 块，每块 = 4 个 13.125 的 1/4 片，片内偏 4.375。
	// 这些数值与整张图的留白/圆角刻度是配套的（见下方 RADII），改动时要一起看。
	var NET = {
		viewBox: '0 0 75 75',
		L0: 9.305555555555555,        // 第一块中心区的原点
		PITCH: 19.444444444444443,    // 块间距
		QUARTER: 13.125,              // 1/4 片边长
		OFFSET: 4.375,                // 片在块内的偏移
		ARM_W: 17.5,                  // 横条宽 = 3 × 片 + 偏
		ARM_H: 6.388888888888889,     // 横条厚
		ARM_X: 0.9722222222222221,    // 左条 x
		ARM_X2: 67.63888888888889,    // 右条 x
		ARM_Y: 0.9722222222222221,    // 上条 y
		ARM_Y2: 67.63888888888889,    // 下条 y
		ARM_R: 1.0
	};

	// RADII[bx][by][q]：q 依次是块内 (0,0) 左上、(0,1) 左下、(1,0) 右上、(1,1) 右下
	var RADII = [
		[[0, 0, 0, 1.0], [0, 0, 4.375, 4.375], [0, 0, 4.375, 0]],
		[[0, 4.375, 0, 4.375], [4.375, 4.375, 4.375, 4.375], [4.375, 0, 4.375, 0]],
		[[0, 1.0, 1.0, 0], [4.375, 4.375, 1.0, 0], [1.0, 0, 1.0, 0]]
	];
	var QUARTER_OFFSETS = [[0, 0], [0, 1], [1, 0], [1, 1]];

	// SVG 头（与全站其它矢量资源的写法保持一致）
	var NET_HEADER = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
		+ 'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svgjs="http://svgjs.dev/svgjs" '
		+ 'viewBox="0 0 75 75" width="75" height="75">';

	// ---------------------------------------------------------------- iso 几何
	// 立方体取 [-1,1]³：R 在 +x，U 在 +y，F 在 +z。相机先绕 Y 轴转 yaw，再俯视 tilt，
	// 然后按 perspective 做一次近大远小。
	//
	// 三个参数都是**用原版输出反推**的，不是随手取的好看值。拿 speedcubedb 那张 icube 的
	// 输出（fl 已知，多边形坐标可读）量三个与参数一一对应的统计量，再对着搜：
	//
	//   量                   原版      本站   对应参数
	//   上面菱形的 高/宽      0.369     0.372  tilt（越陡越扁）
	//   前/右两立面的 宽度比  1.655     1.644  yaw（tan yaw = 窄/宽）
	//   外侧竖边的 内收      11.9%     11.0%  perspective（正交时恒为 0）
	//
	// 早期版本写的是 yaw = 45°、纯正交：那会让前后两个立面一样宽，看起来像站在立方体的
	// 正对角上、而且外侧竖边完全竖直 —— 这就是「有点怪」的来源。
	var ISO = {
		viewBox: '0 0 100 100',
		yaw: -0.594,        // ≈ -34°
		tilt: 0.497,        // ≈ 28.5°
		perspective: 0.14,  // 相机距离 ≈ 1/0.14 ≈ 7 个半棱长；给 0 就是纯正交（外侧竖边竖直）
		pad: 3,             // viewBox 边距
		gap: 0.14           // 贴纸相对边长的留缝比例（缝隙透出背景）
	};

	function paletteOf(p) {
		if (!p || p === 'site') { return SITE_PALETTE; }
		var merged = {
			grey: p.grey || SITE_PALETTE.grey,
			letters: p.letters || SITE_PALETTE.letters
		};
		for (var i = 0; i < FACE_ORDER.length; i++) {
			var f = FACE_ORDER[i];
			merged[f] = p[f] || SITE_PALETTE[f];
		}
		return merged;
	}

	function blankFaces(palette) {
		var faces = {};
		for (var i = 0; i < FACE_ORDER.length; i++) {
			var f = FACE_ORDER[i];
			faces[f] = [];
			for (var k = 0; k < 9; k++) { faces[f][k] = palette.grey; }
		}
		return faces;
	}

	// 一个格子的颜色：'#' 开头当色值；**大写** URFDLB 当面字母；
	// **小写** r/o/b/g/w/y/l 当颜色字母（'l' = 未指定灰，不能和面字母 L 撞车）。
	function colorOf(ch, palette) {
		if (!ch) { return palette.grey; }
		if (ch.charAt(0) === '#') { return ch; }
		var up = ch.toUpperCase();
		if (ch === up && FACE_ORDER.indexOf(up) >= 0) { return palette[up]; }
		var low = ch.toLowerCase();
		if (palette.letters && palette.letters[low]) { return palette.letters[low]; }
		if (FACE_ORDER.indexOf(up) >= 0) { return palette[up]; }
		return palette.grey;
	}

	function fillNine(value, palette) {
		var out = new Array(9);
		if (value == null) { return null; }
		if (typeof value === 'string') {
			for (var i = 0; i < 9; i++) { out[i] = colorOf(value.charAt(i), palette); }
			return out;
		}
		if (typeof value.length === 'number') {
			for (var j = 0; j < 9; j++) {
				var v = value[j];
				if (typeof v === 'number') {
					var face = FACE_ORDER[Math.floor(v / 9)] || 'U';
					out[j] = palette[face];
				} else {
					out[j] = colorOf(v, palette);
				}
			}
			return out;
		}
		return null;
	}

	/**
	 * 把各种口径的状态统一成 { U,D,F,B,R,L } 六个 9 格颜色数组。
	 * 认不出来的格子留灰，认不出来的整体输入返回 null。
	 */
	function faces(state, opts) {
		var palette = paletteOf(opts && opts.palette);
		var out = blankFaces(palette);
		if (state == null) { return out; }

		// 字符串：54 字符面位串（URFDLB 六面各 9 格）
		if (typeof state === 'string') {
			var s = state.trim();
			if (s.length >= 54) {
				for (var f = 0; f < 6; f++) {
					var face = FACE_ORDER[f];
					for (var i = 0; i < 9; i++) { out[face][i] = colorOf(s.charAt(f * 9 + i), palette); }
				}
			}
			return out;
		}

		// 数值数组：每格 0..53，face = floor(v/9)
		if (typeof state.length === 'number' && typeof state[0] === 'number') {
			for (var n = 0; n < 54 && n < state.length; n++) {
				var fi = FACE_ORDER[Math.floor(state[n] / 9)] || 'U';
				out[fi][n % 9] = palette[fi];
			}
			return out;
		}

		// 对象：按面字母取，大小写都收（{ U: 'yyyyyyyyy' } 或 { u: ... }）
		if (typeof state === 'object') {
			for (var p = 0; p < FACE_ORDER.length; p++) {
				var letter = FACE_ORDER[p];
				var value = state[letter] != null ? state[letter] : state[letter.toLowerCase()];
				if (value != null) { out[letter] = fillNine(value, palette) || out[letter]; }
			}
		}
		return out;
	}

	/** 数值格式化：与现存静态图的小数写法一致（1.0 不能写成 1，0 干脆省略圆角属性） */
	function num(v) {
		return String(v);
	}

	function rxAttr(rx) {
		if (!rx) { return ''; }
		return ' rx="' + (rx === 1 ? '1.0' : num(rx)) + '" ry="' + (rx === 1 ? '1.0' : num(rx)) + '"';
	}

	function rect(w, h, x, y, rx, fill) {
		return '<rect width="' + num(w) + '" height="' + num(h)
			+ '" x="' + num(x) + '" y="' + num(y) + '"'
			+ rxAttr(rx) + ' fill="' + fill + '"></rect>';
	}

	// ------------------------------------------------------------------ net
	function netBody(f, palette) {
		var out = [];
		// 中心 3×3：按 by（行）/ bx（列）遍历，每块 4 个 1/4 片
		for (var by = 0; by < 3; by++) {
			for (var bx = 0; bx < 3; bx++) {
				var fill = f.U[by * 3 + bx];
				var x0 = NET.L0 + bx * NET.PITCH;
				var y0 = NET.L0 + by * NET.PITCH;
				var rad = RADII[bx][by];
				for (var q = 0; q < 4; q++) {
					var qx = QUARTER_OFFSETS[q][0];
					var qy = QUARTER_OFFSETS[q][1];
					out.push(rect(NET.QUARTER, NET.QUARTER,
						x0 + qx * NET.OFFSET, y0 + qy * NET.OFFSET, rad[q], fill));
				}
			}
		}
		// 四周 12 条：上 = B 首行反序，下 = F 首行，左 = L 首行，右 = R 首行反序
		for (var i = 0; i < 3; i++) {
			var x = NET.L0 + i * NET.PITCH;
			out.push(rect(NET.ARM_W, NET.ARM_H, x, NET.ARM_Y, NET.ARM_R, f.B[2 - i]));
			out.push(rect(NET.ARM_W, NET.ARM_H, x, NET.ARM_Y2, NET.ARM_R, f.F[i]));
			out.push(rect(NET.ARM_H, NET.ARM_W, NET.ARM_X, x, NET.ARM_R, f.L[i]));
			out.push(rect(NET.ARM_H, NET.ARM_W, NET.ARM_X2, x, NET.ARM_R, f.R[2 - i]));
		}
		return out.join('');
	}

	// ------------------------------------------------------------------ 箭头
	// 样式与 Cube/Analyzer/assets/cases/PLL/*.svg 里那批换位箭头一致，尺寸是从那 21 张图里
	// 62 条箭头**逐条量**出来的（把 payload 拆成点，反解出「尾端」和「尖端」分别对网格中心的位置）：
	//
	//   · 尾端（平口）正好落在**起点色块中心**，一个像素都不偏（62 条里最大偏差 0.006，
	//     纯粹是原图只保留两位小数的舍入）；
	//   · 尖端越过**目标色块中心** 2.128 —— 也就是说「对准中心的」不是箭尖，是箭尖往回退
	//     2.128 的位置；这条就是当初调很久的那个点位，照抄；
	//   · 箭头头部 长 6.95、半宽 2.5；杆 半厚 0.95；
	//   · 双头箭头（H、E 这类「互换」）两端都按上面规则各伸出一个头。
	//
	// 所有尺寸都以「一个色块边长 = 17.5」为基准，换视角时按该视角下一个色块的投影边长等比缩放。
	var ARROW = {
		overshoot: 2.128,
		headLen: 6.95,
		headHalfW: 2.5,
		shaftHalf: 0.95,
		ref: 17.5,
		color: '#5d4ea8'
	};

	// 统一成 [{ from, to, double }]
	function arrowList(arrows) {
		var out = [];
		if (!arrows) { return out; }
		for (var i = 0; i < arrows.length; i++) {
			var a = arrows[i];
			if (!a) { continue; }
			if (typeof a === 'string') {
				var m = /^\s*([URFDLB]\d)\s*(<>|->|>|)\s*([URFDLB]\d)\s*$/i.exec(a);
				if (m) { out.push({ from: m[1].toUpperCase(), to: m[3].toUpperCase(), double: m[2] === '<>' }); }
			} else if (typeof a.from === 'string' && typeof a.to === 'string') {
				out.push({ from: a.from.toUpperCase(), to: a.to.toUpperCase(), double: !!a.double });
			} else if (typeof a.length === 'number' && a.length >= 2) {
				out.push({ from: String(a[0]).toUpperCase(), to: String(a[1]).toUpperCase(), double: !!a[2] });
			}
		}
		return out;
	}

	/** 环状顺序 → 首尾相接的箭头对（A→B、B→C、C→A） */
	function arrowCycle(refs) {
		var list = typeof refs === 'string' ? refs.split(/[\s,]+/) : (refs || []);
		var pairs = [];
		for (var i = 0; i < list.length; i++) {
			if (!list[i]) { continue; }
			pairs.push([list[i], list[(i + 1) % list.length]]);
		}
		return pairs;
	}

	function splitRef(ref) {
		return [ref.charAt(0), parseInt(ref.slice(1), 10) || 0];
	}

	// 箭头路径：p0/p1 已在该视图的坐标系里，unit = 该视图下一个色块的边长
	function arrowPath(p0, p1, unit, double, color) {
		var k = unit / ARROW.ref;
		var over = ARROW.overshoot * k;
		var headLen = ARROW.headLen * k;
		var headW = ARROW.headHalfW * k;
		var shaft = ARROW.shaftHalf * k;
		var dx = p1[0] - p0[0];
		var dy = p1[1] - p0[1];
		var len = Math.sqrt(dx * dx + dy * dy);
		if (!len) { return ''; }
		var ux = dx / len;
		var uy = dy / len;
		var px = -uy;              // 顺时针 90°（屏幕 y 向下），与原图一致
		var py = ux;
		function pt(x, y) {
			var sx = x.toFixed(2);
			var sy = y.toFixed(2);
			if (sx === '-0.00') { sx = '0.00'; }
			if (sy === '-0.00') { sy = '0.00'; }
			return sx + ',' + sy;
		}
		function at(o) {   // 原点 + 沿轴 o + 法向 w
			return function (w) { return pt(o[0] + px * w, o[1] + py * w); };
		}
		// 单头：A 端是平口尾端，落在起点色块中心；B 端是尖端，越过终点色块中心。
		// 双头：两端都是尖端，各自**朝外**越过自己的色块中心（A 端反着伸出去）。
		var tipA = [p0[0] - ux * over, p0[1] - uy * over];
		var tipB = [p1[0] + ux * over, p1[1] + uy * over];
		var baseA = [tipA[0] + ux * headLen, tipA[1] + uy * headLen];
		var baseB = [tipB[0] - ux * headLen, tipB[1] - uy * headLen];
		var d;
		if (double) {
			// 双头：M 尖端A → 底A+头宽 → 底A+杆 → 底B+杆 → 底B+头宽 → 尖端B → 底B-头宽 → 底B-杆 → 底A-杆 → 底A-头宽 → Z
			d = 'M' + pt(tipA[0], tipA[1])
				+ 'L' + at(baseA)(headW)
				+ 'L' + at(baseA)(shaft)
				+ 'L' + at(baseB)(shaft)
				+ 'L' + at(baseB)(headW)
				+ 'L' + pt(tipB[0], tipB[1])
				+ 'L' + at(baseB)(-headW)
				+ 'L' + at(baseB)(-shaft)
				+ 'L' + at(baseA)(-shaft)
				+ 'L' + at(baseA)(-headW)
				+ 'Z';
		} else {
			// 单头：尾端平口在起点中心，尖端越过终点中心
			d = 'M' + pt(tipB[0], tipB[1])
				+ 'L' + at(baseB)(headW)
				+ 'L' + at(baseB)(shaft)
				+ 'L' + at(p0)(shaft)
				+ 'L' + at(p0)(-shaft)
				+ 'L' + at(baseB)(-shaft)
				+ 'L' + at(baseB)(-headW)
				+ 'Z';
		}
		return '<path d="' + d + '" fill="' + color + '"></path>';
	}

	// net：色块中心。只有 U 九格 + 四个侧面首行（F/B/L/R 的 0..2）在图上
	function netCenter(ref) {
		var f = splitRef(ref);
		var face = f[0];
		var i = f[1];
		var half = NET.ARM_W / 2;
		if (face === 'U') {
			if (i < 0 || i > 8) { return null; }
			return [NET.L0 + (i % 3) * NET.PITCH + half, NET.L0 + Math.floor(i / 3) * NET.PITCH + half];
		}
		if (i < 0 || i > 2) { return null; }
		if (face === 'B') { return [NET.L0 + (2 - i) * NET.PITCH + half, NET.ARM_Y + NET.ARM_H / 2]; }
		if (face === 'F') { return [NET.L0 + i * NET.PITCH + half, NET.ARM_Y2 + NET.ARM_H / 2]; }
		if (face === 'L') { return [NET.ARM_X + NET.ARM_H / 2, NET.L0 + i * NET.PITCH + half]; }
		if (face === 'R') { return [NET.ARM_X2 + NET.ARM_H / 2, NET.L0 + (2 - i) * NET.PITCH + half]; }
		return null;
	}

	function netArrows(arrows, color) {
		var list = arrowList(arrows);
		var out = [];
		for (var i = 0; i < list.length; i++) {
			var p0 = netCenter(list[i].from);
			var p1 = netCenter(list[i].to);
			if (!p0 || !p1) { continue; }
			var path = arrowPath(p0, p1, NET.ARM_W, list[i].double, color);
			if (path) { out.push(path); }
		}
		return out.join('');
	}

	// ------------------------------------------------------------------ iso
	function isoVectors() {
		var cy = Math.cos(ISO.yaw);
		var sy = Math.sin(ISO.yaw);
		var ct = Math.cos(ISO.tilt);
		var st = Math.sin(ISO.tilt);
		var p = ISO.perspective > 0 ? ISO.perspective : 0;
		return function (x, y, z) {
			var x1 = x * cy + z * sy;
			var z1 = -x * sy + z * cy;
			// 相机在 +z 方向、俯视 tilt：深度要用**俯视后**的 z（含 y 的分量），
			// 否则竖直边永远是竖直的，少了原版那种外侧竖边微微内收的立体感。
			var depth = y * st + z1 * ct;
			var k = p ? 1 / (1 - depth * p) : 1;
			return [x1 * k, (-y * ct + z1 * st) * k];
		};
	}

	// 三张可见面的 3×3 格子中心（3D），顺序 = 该面自身的行优先（i = 行*3 + 列）
	function isoCells() {
		var cells = [];
		var step = 2 / 3;
		var i, r, c;
		for (r = 0; r < 3; r++) {
			for (c = 0; c < 3; c++) {
				cells.push({ face: 'U', i: r * 3 + c, p: [-1 + (c + 0.5) * step, 1, -1 + (r + 0.5) * step] });
			}
		}
		for (r = 0; r < 3; r++) {
			for (c = 0; c < 3; c++) {
				cells.push({ face: 'F', i: r * 3 + c, p: [-1 + (c + 0.5) * step, 1 - (r + 0.5) * step, 1] });
			}
		}
		for (r = 0; r < 3; r++) {
			for (c = 0; c < 3; c++) {
				// R 面从右侧看：列 0 靠前(F)，列 2 靠后(B)
				cells.push({ face: 'R', i: r * 3 + c, p: [1, 1 - (r + 0.5) * step, 1 - (c + 0.5) * step] });
			}
		}
		for (i = 0; i < cells.length; i++) {
			// 每个格子的两条边向量（沿贴纸平面），半边长 = 1/3
			var cell = cells[i];
			if (cell.face === 'U') { cell.u = [1, 0, 0]; cell.v = [0, 0, 1]; }
			else if (cell.face === 'F') { cell.u = [1, 0, 0]; cell.v = [0, 1, 0]; }
			else { cell.u = [0, 0, 1]; cell.v = [0, 1, 0]; }
		}
		return cells;
	}

	// 任意一面某一格的中心（3D）。iso 里 B/L/D 是背面，投影会落在可见区域外面，
	// 所以这种视角下箭头请只用 U / F / R。
	function isoCenter(ref) {
		var f = splitRef(ref);
		var face = f[0];
		var i = f[1];
		if (i < 0 || i > 8) { return null; }
		var step = 2 / 3;
		var r = Math.floor(i / 3);
		var c = i % 3;
		if (face === 'U') { return [-1 + (c + 0.5) * step, 1, -1 + (r + 0.5) * step]; }
		if (face === 'F') { return [-1 + (c + 0.5) * step, 1 - (r + 0.5) * step, 1]; }
		if (face === 'R') { return [1, 1 - (r + 0.5) * step, 1 - (c + 0.5) * step]; }
		if (face === 'B') { return [1 - (c + 0.5) * step, 1 - (r + 0.5) * step, -1]; }
		if (face === 'L') { return [-1, 1 - (r + 0.5) * step, -1 + (c + 0.5) * step]; }
		return [-1 + (c + 0.5) * step, -1, 1 - (r + 0.5) * step];
	}

	// 视野框：投影 + 缩放 + 平移，一次算好给贴纸和箭头共用
	function isoFrame() {
		var project = isoVectors();
		var cells = isoCells();
		var half = 1 / 3;
		var pts = [];
		var i, k;
		for (i = 0; i < cells.length; i++) {
			var cell = cells[i];
			for (k = 0; k < 4; k++) {
				var su = (k === 0 || k === 3) ? -1 : 1;
				var sv = (k < 2) ? -1 : 1;
				pts.push(project(
					cell.p[0] + cell.u[0] * su * half + cell.v[0] * sv * half,
					cell.p[1] + cell.u[1] * su * half + cell.v[1] * sv * half,
					cell.p[2] + cell.u[2] * su * half + cell.v[2] * sv * half
				));
			}
		}
		var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (i = 0; i < pts.length; i++) {
			if (pts[i][0] < minX) { minX = pts[i][0]; }
			if (pts[i][0] > maxX) { maxX = pts[i][0]; }
			if (pts[i][1] < minY) { minY = pts[i][1]; }
			if (pts[i][1] > maxY) { maxY = pts[i][1]; }
		}
		var box = 100 - ISO.pad * 2;
		var scale = Math.min(box / (maxX - minX || 1), box / (maxY - minY || 1));
		var ox = ISO.pad + (box - (maxX - minX) * scale) / 2 - minX * scale;
		var oy = ISO.pad + (box - (maxY - minY) * scale) / 2 - minY * scale;

		// 该视角下一个色块的投影边长：取 U 面中间格两条边长的平均
		var c0 = isoCenter('U4');
		var c1 = isoCenter('U5');
		var c2 = isoCenter('U7');
		var center = project(c0[0], c0[1], c0[2]);
		var right = project(c1[0], c1[1], c1[2]);
		var down = project(c2[0], c2[1], c2[2]);
		var unit = ((Math.abs(right[0] - center[0]) + Math.abs(right[1] - center[1])
			+ Math.abs(down[0] - center[0]) + Math.abs(down[1] - center[1])) / 2) * scale;

		return {
			project: project,
			cells: cells,
			scale: scale,
			unit: unit,
			toScreen: function (p) { return [(ox + p[0] * scale).toFixed(3), (oy + p[1] * scale).toFixed(3)]; },
			toPoint: function (p) { return [ox + p[0] * scale, oy + p[1] * scale]; }
		};
	}

	function isoBody(f, frame) {
		var half = 1 / 3;
		var shrink = half * (1 - ISO.gap);   // 留缝：贴纸向内收
		var project = frame.project;
		var cells = frame.cells;
		var out = [];
		for (var i = 0; i < cells.length; i++) {
			var c = cells[i];
			var corners = [];
			for (var k = 0; k < 4; k++) {
				var du = (k === 0 || k === 3) ? -shrink : shrink;
				var dv = (k < 2) ? -shrink : shrink;
				corners.push(frame.toScreen(project(
					c.p[0] + c.u[0] * du + c.v[0] * dv,
					c.p[1] + c.u[1] * du + c.v[1] * dv,
					c.p[2] + c.u[2] * du + c.v[2] * dv
				)));
			}
			out.push('<polygon points="' + corners.map(function (q) { return q[0] + ',' + q[1]; }).join(' ') + '" fill="' + f[c.face][c.i] + '"></polygon>');
		}
		return out.join('');
	}

	function isoArrows(arrows, frame, color) {
		var list = arrowList(arrows);
		var out = [];
		for (var i = 0; i < list.length; i++) {
			var c0 = isoCenter(list[i].from);
			var c1 = isoCenter(list[i].to);
			if (!c0 || !c1) { continue; }
			var p0 = frame.toPoint(frame.project(c0[0], c0[1], c0[2]));
			var p1 = frame.toPoint(frame.project(c1[0], c1[1], c1[2]));
			var path = arrowPath(p0, p1, frame.unit, list[i].double, color);
			if (path) { out.push(path); }
		}
		return out.join('');
	}

	function buildSVG(f, opts) {
		var o = opts || {};
		var view = o.view === 'iso' ? 'iso' : 'net';
		var arrows = o.arrows;
		var arrowColor = o.arrowColor || ARROW.color;
		var body;
		if (view === 'iso') {
			var frame = isoFrame();
			body = isoBody(f, frame);
			if (arrows) { body += isoArrows(arrows, frame, arrowColor); }
		} else {
			body = netBody(f, o.palette);
			if (arrows) { body += netArrows(arrows, arrowColor); }
		}
		var size = o.size || (view === 'iso' ? 96 : 75);
		var vb = view === 'iso' ? ISO.viewBox : NET.viewBox;
		var title = o.title ? '<title>' + escapeText(o.title) + '</title>' : '';
		var bg = o.background
			? '<rect x="0" y="0" width="100%" height="100%" fill="' + o.background + '"></rect>'
			: '';
		// 只有「纯 net + 无箭头 + 无底色 + 无标题 + 75px」才走与现存静态图完全相同的头
		if (view === 'net' && !o.background && !o.title && !arrows && Number(size) === 75) {
			return NET_HEADER + body + '</svg>';
		}
		return '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
			+ 'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svgjs="http://svgjs.dev/svgjs" '
			+ 'viewBox="' + vb + '" width="' + size + '" height="' + size + '">'
			+ title + bg + body + '</svg>';
	}

	function escapeText(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	/** 状态 → SVG 字符串 */
	function svg(opts) {
		var o = opts || {};
		return buildSVG(faces(o.state, o), o);
	}

	/** 状态 → data URI（可以直接塞给 <img src> / CSS background） */
	function dataURI(opts) {
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(opts));
	}

	/** 状态 → 挂进一个宿主元素，返回生成的 <svg>；宿主不存在就返回 null */
	function render(host, opts) {
		if (!host) { return null; }
		host.innerHTML = svg(opts);
		return host.querySelector('svg');
	}

	root.CubeFigure = {
		VERSION: VERSION,
		FACE_ORDER: FACE_ORDER,
		FACE_INDEX: FACE_INDEX,
		PALETTES: { site: SITE_PALETTE },
		NET: NET,
		NET_RADII: RADII,
		ISO: ISO,
		ARROW: ARROW,
		faces: faces,
		svg: svg,
		dataURI: dataURI,
		render: render,
		// 箭头：把环状顺序 ("U0 U2 U8") 展开成首尾相接的箭头对
		arrowCycle: arrowCycle
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
