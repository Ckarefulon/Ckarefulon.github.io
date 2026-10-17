/*
 * Trainer 公共组件（Cube 公用）
 * ---------------------------------------------------------------------------
 * 吸收 XC大师「专题练习」与 AI_CFOP 分步训练思路，供 Cube/Trainer 页面复用：
 *   FaceletUtil  坐标引擎 facelet 工具（标准 Singmaster 记号，支持宽层/MES/xyz）+ 四档完成判定
 *   Scramble     WCA 式随机打乱（避同面连续、避三同轴连续）
 *   Stats        本地成绩（trainerStats.v1：次数/最佳/ao5/best3/今日）
 *   Prediction   练前预测 / 练后对照（trainerPrediction.v1）
 *   Bot          人机赛：按历史成绩分位采样机器人时间，single/ao5/best3 结算
 *   Metronome    节拍器（转发到公用块 Cube/assets/metronome/，TPS 0.5-8）
 *   Badge        徽章 DOM 工厂
 *
 * 依赖（由 index.html 保证加载顺序）：
 *   compat.js（DEBUG 全局）→ isaac.js → mathlib.js（仅提取 plain 移动表）→ formula-core.js → 本文件
 * 本文件不碰页面状态，只提供纯能力与本地存储。
 */
(function (root) {
	'use strict';

	var mathlib = root.mathlib;

	/* ================= FaceletUtil ================= */

	var SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
	/* 与 Cube/Cross 引擎同口径：U R F D L B */
	var COLOR_OF_FACE = ['#f5f5f5', '#c62828', '#2e9e4b', '#f5c518', '#ef6c1a', '#1565c0'];
	var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
	var FACE_LETTERS = "URFDLB";

	/* mathlib token 归一：小写宽层 u/d/l/r/f/b 与标准大写 Rw 形式 → Uw/Dw/Lw/Rw/Fw/Bw */
	function normMod(mod) {
		var two = mod.indexOf("2") >= 0;
		var prime = (mod.match(/'/g) || []).length % 2 === 1;
		return two ? "2" : (prime ? "'" : "");
	}
	function normTok(tok) {
		var m;
		if ((m = /^([UDLRFB])([2']*)$/.exec(tok))) return m[1] + normMod(m[2]);
		if ((m = /^([UDLRFB])w([2']*)$/.exec(tok))) return m[1] + "w" + normMod(m[2]);
		if ((m = /^([udlrfb])([2']*)$/.exec(tok))) return m[1].toUpperCase() + "w" + normMod(m[2]);
		if ((m = /^([MES])([2']*)$/.exec(tok))) return m[1] + normMod(m[2]);
		if ((m = /^([xyz])([2']*)$/.exec(tok))) return m[1] + normMod(m[2]);
		return null;
	}

	/* ================= 坐标引擎（标准 Singmaster 记号） =================
	 * 为什么不走 mathlib CubieCube：mathlib 的宽层/MES/xyz 语义与站点既有记号
	 * （陀螺仪跟随关闭时 RLx→M 合并、QR 的 r→Rw 归一）不一致，且 toFaceCube 的
	 * withOri 补偿损坏。本引擎在 facelet（54 贴纸）层面用 3D 坐标旋转推导移动表：
	 *   - plain U/R/F/D/L/B 表从 mathlib toPerm 提取（500 组随机序列与 mathlib 逐字节一致）
	 *   - M/E/S 切片表与 x/y/z 整体旋转表由 rotPerm 坐标推导（中心冻结：视觉物理正确）
	 *   - 宽层 Rw/Lw/Uw/Dw/Fw/Bw = plain 表 ∘ 反向切片表（同轴不相交可交换）
	 * 标准方向（从对应面外侧看顺时针）：U=绕-y、R=绕-x、F=绕-z；
	 *   M 跟 L 向、E 跟 D 向、S 跟 F 向；x 跟 R 向、y 跟 U 向、z 跟 F 向。
	 * 已验：x=R M' L' / y=U E' D' / z=F S B' / x2=R2 M2 L2 / Rw=R M' / Uw=U E' / Fw=F S
	 *   全 PASS；78 个 QR 案例（r→Rw 口径）闭环全过；500 组混合序列往返全过；
	 *   全部移动表（含 2/' 派生）双射且 6 中心不动。
	 * 注意：中心冻结表示下 90° 切片 / 宽层 / 整体转是「物理正确但数学出群」的态
	 *   （棱置换为奇、角偶，违反角棱偶性相等），故不做 mathlib fromFacelet 群校验；
	 *   渲染与面颜色判定均不受影响（QR 案例闭环已证明实用正确）。 */
	function posOf(face, row, col) {
		switch (face) {
			case 0: return [col - 1, 1, row - 1];
			case 1: return [1, 1 - row, 1 - col];
			case 2: return [col - 1, 1 - row, 1];
			case 3: return [col - 1, -1, 1 - row];
			case 4: return [-1, 1 - row, col - 1];
			case 5: return [1 - col, 1 - row, -1];
		}
		return null;
	}
	function rowColOf(face, p) {
		var x = p[0], y = p[1], z = p[2];
		switch (face) {
			case 0: return [z + 1, x + 1];
			case 1: return [1 - y, 1 - z];
			case 2: return [1 - y, x + 1];
			case 3: return [1 - z, x + 1];
			case 4: return [1 - y, z + 1];
			case 5: return [1 - y, 1 - x];
		}
		return null;
	}
	var NORMAL = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];
	function faceOfNormal(n) {
		for (var f = 0; f < 6; f++) {
			var m = NORMAL[f];
			if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) { return f; }
		}
		return -1;
	}
	var CENTERS = [4, 13, 22, 31, 40, 49];
	/* 由坐标旋转 T 生成 facelet 置换表；axis=undefined 整体旋转，
	 * axis=0/1/2 只转对应切片（该坐标为 0 的面贴纸），中心永不动。 */
	function rotPerm(T, axis) {
		var fwd = new Array(54).fill(-1);
		var inSlice = function (p) { return axis === undefined || p[axis] === 0; };
		var isCenter = function (i) { return CENTERS.indexOf(i) >= 0; };
		for (var i = 0; i < 54; i++) {
			var p = posOf(~~(i / 9), ~~(i % 9 / 3), i % 3);
			if (!inSlice(p) || isCenter(i)) { fwd[i] = i; continue; }
			var f = ~~(i / 9);
			var f2 = faceOfNormal(T(NORMAL[f]));
			if (f2 < 0) { throw new Error('rot maps face to non-face'); }
			var rc = rowColOf(f2, T(posOf(f, ~~(i % 9 / 3), i % 3)));
			fwd[i] = f2 * 9 + rc[0] * 3 + rc[1];
		}
		var tbl = new Array(54);
		for (var j = 0; j < 54; j++) { tbl[fwd[j]] = j; }
		return tbl;
	}
	function compose(a, b) { var t = new Array(54); for (var i = 0; i < 54; i++) { t[i] = a[b[i]]; } return t; }
	function power(tbl, n) { var r = null; for (var i = 0; i < n; i++) { r = r ? compose(tbl, r) : tbl; } return r; }

	var ROT = {
		M: function (p) { return [p[0], -p[2], p[1]]; },   // 跟 L 向（绕 +x）
		E: function (p) { return [p[2], p[1], -p[0]]; },   // 跟 D 向（绕 +y）
		S: function (p) { return [p[1], -p[0], p[2]]; },   // 跟 F 向（绕 -z）
		x: function (p) { return [p[0], p[2], -p[1]]; },   // 跟 R 向（绕 -x）
		y: function (p) { return [-p[2], p[1], p[0]]; },   // 跟 U 向（绕 -y）
		z: function (p) { return [p[1], -p[0], p[2]]; }    // 跟 F 向（绕 -z）
	};

	/* plain 表：从 mathlib toPerm 提取（站点其余页面同源，保证口径一致） */
	var PLAIN = {};
	(function buildPlain() {
		var CC = mathlib && mathlib.CubieCube;
		if (!CC) { throw new Error('trainer-common: mathlib not loaded'); }
		var mods = ["", "'", "2"];
		for (var f = 0; f < 6; f++) {
			for (var s = 0; s < 3; s++) {
				var cc = new CC();
				cc.selfMoveStr(FACE_LETTERS[f] + mods[s]);
				PLAIN[FACE_LETTERS[f] + mods[s]] = cc.toPerm();
			}
		}
	})();
	var SLICE = { M: rotPerm(ROT.M, 0), E: rotPerm(ROT.E, 1), S: rotPerm(ROT.S, 2) };
	var ROTP = { x: rotPerm(ROT.x), y: rotPerm(ROT.y), z: rotPerm(ROT.z) };
	var WIDE = {
		Rw: compose(PLAIN.R, power(SLICE.M, 3)),
		Lw: compose(PLAIN.L, power(SLICE.M, 1)),
		Uw: compose(PLAIN.U, power(SLICE.E, 3)),
		Dw: compose(PLAIN.D, power(SLICE.E, 1)),
		Fw: compose(PLAIN.F, power(SLICE.S, 1)),
		Bw: compose(PLAIN.B, power(SLICE.S, 3))
	};
	var BASE = {};
	(function buildBase() {
		var f;
		for (f = 0; f < 6; f++) { BASE[FACE_LETTERS[f]] = PLAIN[FACE_LETTERS[f]]; }
		for (f in WIDE) { if (Object.prototype.hasOwnProperty.call(WIDE, f)) { BASE[f] = WIDE[f]; } }
		for (f in SLICE) { if (Object.prototype.hasOwnProperty.call(SLICE, f)) { BASE[f] = SLICE[f]; } }
		for (f in ROTP) { if (Object.prototype.hasOwnProperty.call(ROTP, f)) { BASE[f] = ROTP[f]; } }
	})();

	function tokTbl(tok) {
		var m = /^([URFDLBMES]|[RULDFB]w|[xyz])(2|'?)$/.exec(tok);
		if (!m) { return null; }
		var base = BASE[m[1]];
		if (!base) { return null; }
		return m[2] === "2" ? power(base, 2) : (m[2] === "'" ? power(base, 3) : base);
	}

	/* 把算法（token 数组，内部自动 normTok 归一）应用到某个 facelet，返回新 facelet。
	 * tokens 为空/非数组（parseAlg 对空输入返回 null）时返回 null，与「无法应用」同口径。 */
	function applyTokens(facelet, tokens) {
		if (!facelet || !tokens || !tokens.length) { return null; }
		var f = facelet;
		for (var i = 0; i < tokens.length; i++) {
			var tbl = tokTbl(normTok(tokens[i]) || tokens[i]);
			if (!tbl) { return null; }
			var out = new Array(54);
			for (var j = 0; j < 54; j++) { out[j] = f.charAt(tbl[j]); }
			f = out.join("");
		}
		return f;
	}

	/* 解析用户输入的算法文本（FormulaCore 口径：空格/逗号分隔，支持 ()[] 组与 R3 次数）。
	 * 失败返回 null（调用方给 err 提示）。 */
	function parseAlg(text) {
		if (!root.FormulaCore) { return null; }
		try {
			var toks = root.FormulaCore.processTarget(text);
			return (toks && toks.length) ? toks : null;
		} catch (e) {
			return null;
		}
	}

	/* 把算法应用到某个 facelet 状态，返回新 facelet（= applyTokens，保留旧名供调用方） */
	function applyToFacelet(facelet, tokens) {
		return applyTokens(facelet, tokens);
	}

	/* ---- 四档完成判定（facelet 口径，索引见下）----
	 * 面序 U=0-8 R=9-17 F=18-26 D=27-35 L=36-44 B=45-53，每面 3×3 行优先。
	 * 侧带行：顶行 9-11/18-20/36-38/45-47，中行 12-14/21-23/39-41/48-50，底行 15-17/24-26/42-44/51-53。
	 * cross / f2l 要求底/中行为【该面自身颜色】（防整条底带旋转的假完成）；
	 * solvedExceptAuf 只要求 12 行【各自单色】（AUF 会轮换顶行颜色，QR 同款口径）。 */
	function rowUniform(f, idx) {
		var c = f.charAt(idx[0]);
		for (var i = 1; i < idx.length; i++) {
			if (f.charAt(idx[i]) !== c) return false;
		}
		return true;
	}
	function rowAll(f, idx, ch) {
		for (var i = 0; i < idx.length; i++) {
			if (f.charAt(idx[i]) !== ch) return false;
		}
		return true;
	}
	function faceAll(f, from, to, ch) {
		for (var i = from; i < to; i++) {
			if (f.charAt(i) !== ch) return false;
		}
		return true;
	}

	function crossDone(f) {
		if (!f || f.length !== 54) return false;
		if (!faceAll(f, 27, 36, "D")) return false;
		if (!rowAll(f, [15, 16, 17], "R")) return false;
		if (!rowAll(f, [24, 25, 26], "F")) return false;
		if (!rowAll(f, [42, 43, 44], "L")) return false;
		if (!rowAll(f, [51, 52, 53], "B")) return false;
		return true;
	}
	function f2lDone(f) {
		if (!crossDone(f)) return false;
		if (!rowAll(f, [12, 13, 14], "R")) return false;
		if (!rowAll(f, [21, 22, 23], "F")) return false;
		if (!rowAll(f, [39, 40, 41], "L")) return false;
		if (!rowAll(f, [48, 49, 50], "B")) return false;
		return true;
	}
	function ollDone(f) {
		if (!f2lDone(f)) return false;
		return faceAll(f, 0, 9, "U");
	}

	var SIDE_ROWS = [
		[9, 10, 11], [18, 19, 20], [36, 37, 38], [45, 46, 47],
		[12, 13, 14], [21, 22, 23], [39, 40, 41], [48, 49, 50],
		[15, 16, 17], [24, 25, 26], [42, 43, 44], [51, 52, 53]
	];
	/* 完全复原（容忍 U 层 AUF）：U 面全 U + D 面全 D + 四侧 12 行各自单色。
	 * 合法性依据：D 纯 + 侧带中/底行单色 ⟹ F2L 完好；再加 U 面全 U ⟹ U 层仅剩循环置换（AUF）。 */
	function solvedExceptAuf(f) {
		if (!f || f.length !== 54) return false;
		if (!faceAll(f, 0, 9, "U")) return false;
		if (!faceAll(f, 27, 36, "D")) return false;
		for (var r = 0; r < SIDE_ROWS.length; r++) {
			if (!rowUniform(f, SIDE_ROWS[r])) return false;
		}
		return true;
	}

	/* facelet 字符串 → CubeNet 数值口径（colorOfFace[Math.floor(v/9)]） */
	function toNumeric(f) {
		var out = new Array(54);
		for (var i = 0; i < 54; i++) {
			var fi = FACE_LETTERS.indexOf(f.charAt(i));
			if (fi < 0) { fi = 0; }
			out[i] = fi * 9 + (i % 9);
		}
		return out;
	}

	var FaceletUtil = {
		SOLVED: SOLVED,
		COLOR_OF_FACE: COLOR_OF_FACE,
		FACE_INDEX: FACE_INDEX,
		normTok: normTok,
		tokTbl: tokTbl,
		applyTokens: applyTokens,
		parseAlg: parseAlg,
		applyToFacelet: applyToFacelet,
		toNumeric: toNumeric,
		crossDone: crossDone,
		f2lDone: f2lDone,
		ollDone: ollDone,
		solvedExceptAuf: solvedExceptAuf
	};

	/* ================= Scramble ================= */

	var FACES = ["U", "R", "F", "D", "L", "B"];
	var AXIS_OF = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
	var MODS = ["", "'", "2"];

	/* WCA 式：不同面连续、不出现三连同轴 */
	function randomScramble(len) {
		var moves = [];
		var prevFace = "", prevAxis = -1, prev2Axis = -1;
		var guard = 0;
		while (moves.length < len && guard++ < 500) {
			var face = FACES[(Math.random() * 6) | 0];
			if (face === prevFace) { continue; }
			var axis = AXIS_OF[face];
			if (axis === prevAxis && axis === prev2Axis) { continue; }
			moves.push(face + MODS[(Math.random() * 3) | 0]);
			prev2Axis = prevAxis;
			prevAxis = axis;
			prevFace = face;
		}
		return moves;
	}
	function randomScrambleRange(a, b) {
		return randomScramble(a + ((Math.random() * (b - a + 1)) | 0));
	}

	/* ================= Stats ================= */

	var STATS_KEY = "trainerStats.v1";

	function todayStr() {
		var d = new Date();
		return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
	}
	function statsLoad() {
		try {
			var s = JSON.parse(localStorage.getItem(STATS_KEY));
			return (s && typeof s === "object") ? s : {};
		} catch (e) { return {}; }
	}
	function statsSave(s) {
		try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
	}
	function statsBlank() {
		return { count: 0, best: 0, recent: [], today: { date: todayStr(), count: 0, best: 0 } };
	}
	function statsMode(mode) {
		var s = statsLoad();
		if (!s[mode]) { s[mode] = statsBlank(); }
		return s[mode];
	}
	/* entry = { t: 秒, steps: 步数, badge: '' | 'opt' | 'over', badgeText: 徽章文案 } */
	function statsRecord(mode, entry) {
		var s = statsLoad();
		var m = s[mode] || (s[mode] = statsBlank());
		var td = todayStr();
		if (!m.today || m.today.date !== td) { m.today = { date: td, count: 0, best: 0 }; }
		m.count = (m.count || 0) + 1;
		m.recent = m.recent || [];
		m.recent.unshift({ t: entry.t, steps: entry.steps, badge: entry.badge || "", badgeText: entry.badgeText || "", at: Date.now() });
		if (m.recent.length > 60) { m.recent.length = 60; }
		if (!m.best || entry.t < m.best) { m.best = entry.t; }
		m.today.count = (m.today.count || 0) + 1;
		if (!m.today.best || entry.t < m.today.best) { m.today.best = entry.t; }
		statsSave(s);
		return m;
	}
	function timesOf(m) {
		return (m.recent || []).map(function (r) { return r.t; }).filter(function (t) { return t > 0; });
	}
	/* WCA ao5 口径：最近 5 次去掉最快最慢取平均 */
	function ao5Of(times) {
		if (times.length < 5) { return 0; }
		var w = times.slice(0, 5).sort(function (a, b) { return a - b; });
		return (w[1] + w[2] + w[3]) / 3;
	}
	function best3Of(times) {
		if (times.length < 3) { return 0; }
		var w = times.slice().sort(function (a, b) { return a - b; }).slice(0, 3);
		return (w[0] + w[1] + w[2]) / 3;
	}
	function statsSummary(mode) {
		var m = statsMode(mode);
		var times = timesOf(m);
		var isToday = m.today && m.today.date === todayStr();
		return {
			count: m.count || 0,
			best: m.best || 0,
			ao5: ao5Of(times),
			best3: best3Of(times),
			todayCount: isToday ? (m.today.count || 0) : 0,
			todayBest: isToday ? (m.today.best || 0) : 0,
			recent: m.recent || []
		};
	}

	/* ================= Prediction ================= */

	var PRED_KEY = "trainerPrediction.v1";

	function predLoad() {
		try {
			var p = JSON.parse(localStorage.getItem(PRED_KEY));
			return (p && typeof p === "object") ? p : {};
		} catch (e) { return {}; }
	}
	function predSave(p) {
		try { localStorage.setItem(PRED_KEY, JSON.stringify(p)); } catch (e) {}
	}
	/* 记录一次预测对照；返回 { dir: 'better'|'worse'|'equal', diff: 实际-预测 } */
	function predRecord(mode, predicted, actual) {
		var p = predLoad();
		var m = p[mode] || (p[mode] = { count: 0, better: 0, worse: 0, sumAbs: 0, last: 0 });
		var diff = actual - predicted;
		var dir = diff > 0.005 ? "worse" : (diff < -0.005 ? "better" : "equal");
		m.count = (m.count || 0) + 1;
		m.sumAbs = (m.sumAbs || 0) + Math.abs(diff);
		if (dir === "better") { m.better = (m.better || 0) + 1; }
		else if (dir === "worse") { m.worse = (m.worse || 0) + 1; }
		m.last = predicted;
		p[mode] = m;
		predSave(p);
		return { dir: dir, diff: diff };
	}
	function predSummary(mode) {
		var p = predLoad();
		return p[mode] || { count: 0, better: 0, worse: 0, sumAbs: 0, last: 0 };
	}

	/* ================= Bot ================= */

	/* 按该模式历史成绩分位（p50）采样机器人时间；样本 <3 返回 0（不参赛） */
	function botSampleTime(mode) {
		var times = timesOf(statsMode(mode));
		if (times.length < 3) { return 0; }
		var sorted = times.slice().sort(function (a, b) { return a - b; });
		var p50 = sorted[Math.floor((sorted.length - 1) * 0.5)];
		var jitter = 0.96 + Math.random() * 0.08;
		return Math.round(p50 * jitter * 10) / 10;
	}
	/* 结算判定：settle 值 vs 机器人时间 */
	function botVerdict(value, botTime) {
		if (!botTime || !(value > 0)) { return null; }
		var d = value - botTime;
		if (Math.abs(d) <= 0.05) { return { kind: "tie", diff: 0 }; }
		return d < 0 ? { kind: "win", diff: -d } : { kind: "lose", diff: d };
	}

	/* ================= Metronome =================
	 * 实现在公用功能块 Cube/assets/metronome/（与本页共用同一份，Formula 也用它）。
	 * 这里只做一层薄转发，保留 TrainerCommon.Metronome 这个既有调用面。 */

	function metroApi() {
		return root.CubeMetronome || null;
	}
	function metroStart(tps, onBeat) {
		var m = metroApi();
		if (m) { m.start(tps, onBeat); }
	}
	function metroStop() {
		var m = metroApi();
		if (m) { m.stop(); }
	}
	function metroSetTps(tps) {
		var m = metroApi();
		if (m) { m.setTps(tps); }
	}
	function metroIsRunning() {
		var m = metroApi();
		return !!(m && m.isRunning());
	}

	/* ================= Badge ================= */

	function badge(text, kind, title) {
		var el = document.createElement("span");
		el.className = "trBadge";
		if (kind) { el.dataset.kind = kind; }
		el.textContent = text;
		if (title) { el.title = title; }
		return el;
	}

	/* ================= PathStats（按「节点路径」存成绩） =================
	 * 每个去重后的路径（节点 id 数组拼成的 key）一份成绩：
	 *   完成次数 / 最佳 / ao5 / 最近记录（带分段）
	 * 与旧的按模式存（trainerStats.v1）并存，旧键不再写入但保留读取。
	 * 记录 schema（每个条目）：
	 *   { t, dnf, steps, at, seg: [秒...], nodes: [id...], frame: "D|F", badge }
	 */
	var PATH_STATS_KEY = "trainerPathStats.v1";

	function pathKeyOf(nodes) {
		return (nodes || []).join(">");
	}
	function pathGridLoad() {
		try {
			var s = JSON.parse(localStorage.getItem(PATH_STATS_KEY));
			return (s && typeof s === "object") ? s : {};
		} catch (e) { return {}; }
	}
	function pathGridSave(s) {
		try { localStorage.setItem(PATH_STATS_KEY, JSON.stringify(s)); } catch (e) {}
	}
	function pathBlank() {
		return { count: 0, best: 0, recent: [] };
	}
	function pathStatsGet(nodes) {
		var s = pathGridLoad();
		return s[pathKeyOf(nodes)] || pathBlank();
	}
	/* entry = { t, dnf, steps, seg, frame, badge, badgeText } */
	function pathStatsRecord(nodes, entry) {
		var s = pathGridLoad();
		var k = pathKeyOf(nodes);
		var m = s[k] || (s[k] = pathBlank());
		m.nodes = (nodes || []).slice();
		m.count = (m.count || 0) + 1;
		m.recent = m.recent || [];
		m.recent.unshift({
			t: entry.t,
			dnf: !!entry.dnf,
			steps: entry.steps || 0,
			seg: (entry.seg || []).slice(),
			nodes: (nodes || []).slice(),
			frame: entry.frame || "",
			badge: entry.badge || "",
			badgeText: entry.badgeText || "",
			at: Date.now()
		});
		if (m.recent.length > 60) { m.recent.length = 60; }
		if (!entry.dnf && entry.t > 0 && (!m.best || entry.t < m.best)) { m.best = entry.t; }
		pathGridSave(s);
		return m;
	}
	/* 只统计有效（非 DNF）成绩 */
	function pathValidTimes(m) {
		return (m.recent || []).filter(function (r) { return !r.dnf && r.t > 0; }).map(function (r) { return r.t; });
	}
	function pathSummary(nodes) {
		var m = pathStatsGet(nodes);
		var times = pathValidTimes(m);
		return {
			count: m.count || 0,
			validCount: times.length,
			best: m.best || 0,
			ao5: ao5Of(times),
			recent: m.recent || [],
			nodes: m.nodes || (nodes || []).slice()
		};
	}
	/* 列出所有已练过的路径（按最近一次时间倒序） */
	function pathList() {
		var s = pathGridLoad();
		var out = [];
		for (var k in s) {
			if (!Object.prototype.hasOwnProperty.call(s, k)) { continue; }
			var m = s[k];
			if (!m || !m.nodes || !m.nodes.length) { continue; }
			out.push({
				key: k,
				nodes: m.nodes.slice(),
				count: m.count || 0,
				best: m.best || 0,
				ao5: ao5Of(pathValidTimes(m)),
				lastAt: m.recent && m.recent.length ? m.recent[0].at : 0
			});
		}
		out.sort(function (a, b) { return b.lastAt - a.lastAt; });
		return out;
	}
	function pathRemove(nodes) {
		var s = pathGridLoad();
		delete s[pathKeyOf(nodes)];
		pathGridSave(s);
	}

	/* ================= 我的路径（保存起来的自定义路径） ================= */

	var SAVED_KEY = "trainerSavedPaths.v1";
	function savedLoad() {
		try {
			var a = JSON.parse(localStorage.getItem(SAVED_KEY));
			return Array.isArray(a) ? a : [];
		} catch (e) { return []; }
	}
	function savedSave(a) {
		try { localStorage.setItem(SAVED_KEY, JSON.stringify(a)); } catch (e) {}
	}
	function savedAdd(nodes, frame) {
		var a = savedLoad();
		var k = pathKeyOf(nodes);
		for (var i = 0; i < a.length; i++) { if (pathKeyOf(a[i].nodes) === k) { return a; } }
		a.unshift({ nodes: (nodes || []).slice(), frame: frame || "", at: Date.now() });
		if (a.length > 40) { a.length = 40; }
		savedSave(a);
		return a;
	}
	function savedRemove(nodes) {
		var k = pathKeyOf(nodes);
		var a = savedLoad().filter(function (x) { return pathKeyOf(x.nodes) !== k; });
		savedSave(a);
		return a;
	}

	/* ================= 导出 ================= */

	root.TrainerCommon = {
		FaceletUtil: FaceletUtil,
		Scramble: { random: randomScramble, randomRange: randomScrambleRange },
		Stats: {
			record: statsRecord,
			summary: statsSummary,
			mode: statsMode,
			ao5Of: ao5Of,
			best3Of: best3Of
		},
		PathStats: {
			record: pathStatsRecord,
			summary: pathSummary,
			get: pathStatsGet,
			list: pathList,
			remove: pathRemove,
			keyOf: pathKeyOf,
			validTimes: pathValidTimes
		},
		SavedPaths: {
			add: savedAdd,
			remove: savedRemove,
			list: savedLoad
		},
		Prediction: { record: predRecord, summary: predSummary },
		Bot: { sampleTime: botSampleTime, verdict: botVerdict },
		Metronome: { start: metroStart, stop: metroStop, setTps: metroSetTps, isRunning: metroIsRunning },
		Badge: badge,
		fmt: fmtSeconds
	};

	/* 计时格式：<60s → "12.34"；≥60s → "1:02.34"（不带单位，单位由调用方拼） */
	function fmtSeconds(t) {
		if (t == null || !isFinite(t) || t < 0) { return "--"; }
		var s = t;
		if (s < 60) { return s.toFixed(2); }
		var m = Math.floor(s / 60);
		var r = s - m * 60;
		return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2);
	}
})(typeof globalThis !== "undefined" ? globalThis : this);
