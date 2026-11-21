/*
 * 复原流程节点图（Cube 公用）
 * ---------------------------------------------------------------------------
 * 训练场首页的「节点连线」选择控件。一张散点图，节点 = 复原过程中的层级。
 *
 * 交互（与用户确认的方向一致）：
 *   · 点第一个节点 = 起点，点第二个节点 = 终点，两点之间连成一条要练的路。
 *   · 之后再点别的节点 = 把该节点作为中间分段插进这条路（按图上的位置自动排序）；
 *     中间节点会用它对整条路做内部再分段，供将来与 Analyzer 融合。
 *   · 点已选中的节点 = 取消选择。
 *   · 直线连边只是「导航辅助」：点边可以一键把边的两端选成路径。
 *
 * 节点位置用固定坐标表（不是力导向），保证每次看到的是同一张图；
 * 用户拖动节点后的位置记在 localStorage 里，全局共用。
 */
(function (root) {
	'use strict';

	var CS = root.CubeStages;
	if (!CS) { return; }

	var NS = "http://www.w3.org/2000/svg";
	var POS_KEY = "cubeStageGraphPos.v1";
	/* 画布尺寸：比「最远节点 + 边距」略大一点。
	   W=1000 / H=500 是配合下面那套三行布局定的，别随手改 ——
	   改小了最右边的「复原」或最下层的顶层四件会画到界外，
	   改大了图会缩得更小、上下留白更多。 */
	var W = 1000, H = 500;
	var R = 26;

	/* 布局约束（自动整理用）：
	 *   GAP_X  路径上相邻两步之间至少要拉开的水平距离（「下一步在上一步右边」）
	 *   MIN_SEP 两个节点之间避免重叠的最小距离
	 *   ANIM_MS 位移动画时长 */
	var GAP_X = R * 2 + 26;
	var MIN_SEP = R * 2 + 10;
	var STAIR_DY = 34;   /* 路径相邻两步的纵向错位：让移动看起来是斜的，而不是横移 */
	var ANIM_MS = 340;

	/* 连线 = 所有「不回退」的两点组合（按规则自动生成，不再手写白名单）。
	 *
	 * 口径（用户定）：只要不破坏已经还原好的部分，任意两点都能连。
	 * 「回退」只有一类：必须先把已完成的拆掉才能到对面。
	 *   · F2L 4 → F2L 1：要拆掉做好的槽 → 不回。
	 *   · 复原 → 任何点：已经全好了，只能倒着拧 → 不回。
	 * 而 **OLL ↔ PLL 之间不是回退**：翻棱／翻角／定向完成／控棱位／控角位这五件事
	 * 彼此正交，谁先谁后都行，所以顶层这五点两两双向连通。
	 *
	 * 另外 CFOP 与 Roux 两条泳道的中间产物互相排斥（搭桥要动十字、做十字要拆桥），
	 * 所以中间不互通；但两条泳道共享起点（打乱）与终点（复原）。
	 */
	var LANES = {
		cfop: ["cross", "f2l1", "f2l2", "f2l3", "f2l4"],
		top:  ["ollEdge", "ollCorner", "oll", "pllEdge", "pllCorner"],
		roux: ["fb", "sb", "cmll"]
	};
	var TERMINAL = ["pll", "solved", "lse"];

	function buildEdges() {
		var out = [], seen = {};
		function add(a, b) {
			if (!a || !b || a === b) { return; }
			var k = a < b ? a + "|" + b : b + "|" + a;
			if (seen[k]) { return; }
			seen[k] = 1;
			out.push([a, b]);
		}
		/* 1. 打乱 → 所有节点 */
		CS.NODES.forEach(function (n) {
			if (n.id !== "scramble") { add("scramble", n.id); }
		});
		/* 2. 泳道内部只许往后（index 递增），所以包含所有跳步：
		 *    cross→f2l1..f2l4、f2l1→f2l2..f2l4、… 全覆盖 */
		["cfop", "roux"].forEach(function (lane) {
			var l = LANES[lane];
			for (var i = 0; i < l.length; i++) {
				for (var j = i + 1; j < l.length; j++) { add(l[i], l[j]); }
			}
		});
		/* 3. CFOP 泳道任意节点 → 顶层任意节点（含 F3 直接进顶层翻棱这种跳步） */
		LANES.cfop.forEach(function (a) {
			LANES.top.forEach(function (b) { add(a, b); });
		});
		/* 4. 顶层五点互相自由（OLL↔PLL 双向、棱↔角交叉都算） */
		var top = LANES.top;
		for (var i = 0; i < top.length; i++) {
			for (var j = i + 1; j < top.length; j++) { add(top[i], top[j]); }
		}
		/* 5. 任意泳道节点 → 终点（提前收尾也是合法的练法） */
		LANES.cfop.concat(LANES.top, LANES.roux).forEach(function (a) {
			TERMINAL.forEach(function (b) { add(a, b); });
		});
		return out;
	}
	var EDGES = buildEdges();

	/* 每侧的边集合（用于外部问「这两点画了线没」） */
	function edgeKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
	var EDGE_SET = {};
	EDGES.forEach(function (e) { EDGE_SET[edgeKey(e[0], e[1])] = true; });
	function hasEdge(a, b) { return !!EDGE_SET[edgeKey(a, b)]; }

	/* ================= 有向判定：能不能「从 a 走到 b」 =================
	 *
	 * 上面 buildEdges 的规则**本来是有向的**（泳道内只许 index 递增），
	 * 但 edgeKey 把 a|b 与 b|a 抹成了同一个键 —— 于是「画了线」变成了双向，
	 * 判定「这一步接得上吗」就会把 F2L 4 → 十字 这种回退也放过去。
	 *
	 * 所以这里按**同一条规则的原始方向**重新算一遍，供「路径是否走得通」使用。
	 * 注意与画线用的 EDGES 分工不同：
	 *   · hasEdge   = 图上画了线没（无向，仅供渲染与「能连」的直觉）；
	 *   · canStep   = 这个方向做得到吗（有向，路径合法性用这个）。
	 *
	 * 顶层五点（ollEdge / ollCorner / oll / pllEdge / pllCorner）彼此正交，
	 * 任意先后都合法，所以它们之间双向都算通 —— 这正是「OLL 不必在 PLL 前面」。
	 */
	var STEP_SET = (function () {
		var set = {};
		function allow(a, b) {
			if (!a || !b || a === b) { return; }
			set[a + ">" + b] = true;
		}
		/* 1. 打乱 → 任何节点（起点是通用的） */
		CS.NODES.forEach(function (n) {
			if (n.id !== "scramble") { allow("scramble", n.id); }
		});
		/* 2. 泳道内只许往后 */
		["cfop", "roux"].forEach(function (lane) {
			var l = LANES[lane];
			for (var i = 0; i < l.length; i++) {
				for (var j = i + 1; j < l.length; j++) { allow(l[i], l[j]); }
			}
		});
		/* 3. CFOP 泳道任意节点 → 顶层任意节点 */
		LANES.cfop.forEach(function (a) {
			LANES.top.forEach(function (b) { allow(a, b); });
		});
		/* 4. 顶层五点彼此**双向**：方向正交，谁先谁后都对 */
		var top = LANES.top;
		for (var i = 0; i < top.length; i++) {
			for (var j = 0; j < top.length; j++) {
				if (i !== j) { allow(top[i], top[j]); }
			}
		}
		/* 5. 任意泳道节点 → 终点 */
		LANES.cfop.concat(LANES.top, LANES.roux).forEach(function (a) {
			TERMINAL.forEach(function (b) { allow(a, b); });
		});
		return set;
	})();
	function canStep(a, b) { return !!STEP_SET[a + ">" + b]; }

	/* ================= 阶段序号（用来画「骨架边」） =================
	 *
	 * 骨架边 = 同一条泳道里前后相邻的两步。给每个节点一个「泳道 + 序号」，
	 * **同泳道且序号差 1** 的才是骨架边。
	 *
	 * 序号按「复原流程的自然顺序」给：
	 *   CFOP 主轴   scramble 0 → cross 1 → f2l1..4 2 → oll 3 → pll 4 → solved 5
	 *   Roux 主轴   fb 1 → sb 2 → cmll 3 → lse 4
	 *   顶层四件     与 OLL/PLL 同层、彼此正交，不属于任何一条主轴
	 *
	 * ⚠️ 泳道必须一起看：CFOP 的 cross 和 Roux 的 fb 都算「第 1 步」，
	 * 只比序号会把两条泳道之间的跨接也当成骨架边，线又交叉回去了。
	 */
	var LANE_STEP = {
		scramble: ["cfop", 0], cross: ["cfop", 1],
		f2l1: ["cfop", 2], f2l2: ["cfop", 2], f2l3: ["cfop", 2], f2l4: ["cfop", 2],
		oll: ["cfop", 3], pll: ["cfop", 4], solved: ["cfop", 5],
		fb: ["roux", 1], sb: ["roux", 2], cmll: ["roux", 3], lse: ["roux", 4]
	};
	function laneIndex(id) { return LANE_STEP[id]; }
	/* 顶层四件（方向/位置）彼此正交、任意先后，不属于任何一条主轴 */
	function isTopFree(id) {
		return id === "ollEdge" || id === "ollCorner" || id === "pllEdge" || id === "pllCorner";
	}

	/* ---------- 默认坐标 ---------- */
	/* ================= 默认布局（三行流水线） =================
	 *
	 * 之前这套坐标是随手排的：CFOP 泳道挤在左下角、顶层挤在右上，
	 * 中间一大片交叉线 —— 看起来像一团乱麻，其实节点是有明确结构的。
	 *
	 * 现在的排法按「复原流程从左到右」分成三条泳道，纵向也分三层：
	 *   上层（ Roux ）   fb → sb → cmll → lse
	 *   中层（ CFOP ）   scramble → cross → f2l1..f2l4 → oll → pll → solved
	 *   下层（ 顶层 ）   ollEdge / ollCorner / pllEdge / pllCorner（可任意穿插）
	 * 这样「同一阶段的东西挨在一起」，连线大部分是短的横线，不再交叉。
	 *
	 * 三行的纵向间距取得比较紧（130 / 250 / 368）。画布高 415，
	 * 内容从 y=106 到 y=394 —— 上下留白 106 / 21，**不对称**。
	 * 原因是三条泳道的重心不在画布正中（上 1 条 + 下 1 条，中间 1 条）。
	 * 所以画布高度改成 500：106/106，正好上下对称，图看起来就稳了。
	 */
	var DEFAULT_POS = {
		/* 中层主轴：横向步长 108（比节点的直径 52 宽一倍多一点，
		   连线短而清楚，不会像之前那样拉成一长条） */
		scramble:  [66, 250],
		cross:     [174, 250],
		f2l1:      [282, 250],
		f2l2:      [390, 250],
		f2l3:      [498, 250],
		f2l4:      [606, 250],
		oll:       [714, 250],
		pll:       [822, 250],
		solved:    [930, 250],
		/* 下层：顶层四件（方向 / 位置互相正交，任意先后） */
		ollEdge:   [714, 368],
		ollCorner: [606, 368],
		pllEdge:   [822, 368],
		pllCorner: [930, 368],
		/* 上层：Roux 桥式 */
		fb:        [174, 132],
		sb:        [390, 132],
		cmll:      [606, 132],
		lse:       [822, 132]
	};
	/* 表里没列到的节点自动排一行兜底 */
	function defaultPos(id, i) {
		return DEFAULT_POS[id] || [120 + (i % 6) * 130, 430 + Math.floor(i / 6) * 60];
	}

	function loadPos() {
		try {
			var p = JSON.parse(localStorage.getItem(POS_KEY));
			return (p && typeof p === "object") ? p : {};
		} catch (e) { return {}; }
	}
	function savePos(p) {
		try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {}
	}

	/* ---------- 几何 ---------- */
	/* 两圆之间的连线端点（裁到圆周，箭头不插进圆里） */
	function trim(a, b, r) {
		var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
		return {
			x1: a.x + dx / d * r, y1: a.y + dy / d * r,
			x2: b.x - dx / d * r, y2: b.y - dy / d * r
		};
	}
	/* ================= 组件 ================= */

	function create(mount, opts) {
		opts = opts || {};
		var pos = loadPos();
		var svg = null;
		var linkLayer = null, ghostLayer = null, nodeLayer = null;
		var selected = [];         /* 选中的节点 id，按「用户点击顺序」 */
		var onChange = opts.onChange || function () {};

		/* 路径 = 用户的点击顺序，原样保留。
		 *
		 * 为什么不再按「图上自然顺序」重排：顶层那几步本来就没有固定先后 ——
		 * 先 PLL 棱、再 OLL 角、再 PLL 角、最后 OLL 棱是合法且常见的练法，
		 * 任何自动排序都会把用户想要的交错顺序改掉，所以一律以点击顺序为准。 */
		function orderedPath() {
			return selected.slice();
		}

		/* 两个节点之间「图上自然要经过」的锚点序列，只用于「新加节点该落在哪」的判断。
		 * 这不是排序规则，也不改路径 —— 它是一个**局部**判据：新节点如果落在某一对
		 * 相邻节点的自然区间里，就把它插到那儿。
		 *
		 * 依据：节点图里已画出的边构成一张有向无环图（只许往后，不许回退）。
		 * 用「从 a 能不能沿边走一段时间步数到达新节点」来判断新节点是否在 a 之后、
		 * b 之前，比拿节点下标硬比更准（顶层那五个点彼此全通，下标没有意义）。 */
		var ADJ = (function () {
			var out = {};
			EDGES.forEach(function (e) {
				(out[e[0]] = out[e[0]] || []).push(e[1]);
			});
			return out;
		})();
		function edgeSteps(from, to, maxSteps) {
			if (from === to) { return 0; }
			var seen = {}, frontier = [from], depth = 0;
			seen[from] = 1;
			while (frontier.length && depth < (maxSteps || 3)) {
				depth++;
				var next = [];
				for (var i = 0; i < frontier.length; i++) {
					var list = ADJ[frontier[i]] || [];
					for (var j = 0; j < list.length; j++) {
						var n = list[j];
						if (seen[n]) { continue; }
						if (n === to) { return depth; }
						seen[n] = 1;
						next.push(n);
					}
				}
				frontier = next;
			}
			return -1;
		}
		function insertIndexFor(node) {
			var path = orderedPath();
			if (path.length < 2) { return -1; }
			var best = -1, bestScore = 1e9;
			for (var i = 0; i + 1 < path.length; i++) {
				var a = path[i], b = path[i + 1];
				if (a === node || b === node) { continue; }
				var ab = edgeSteps(a, b);
				var an = edgeSteps(a, node);
				var nb = edgeSteps(node, b);
				/* 三者都要能走到，且加起来不比直连多太多（= 确实在这段区间里） */
				if (ab < 0 || an < 0 || nb < 0) { continue; }
				var extra = (an + nb) - ab;
				if (extra > 2) { continue; }
				if (extra < bestScore) { bestScore = extra; best = i + 1; }
			}
			return best;
		}

		function nodeIndex(id) {
			for (var i = 0; i < CS.NODES.length; i++) { if (CS.NODES[i].id === id) { return i; } }
			return 0;
		}

		/* ---------- 位置：已提交值 / 动画中的显示值 ---------- */
		var disp = {};        /* 动画期间的插值位置（id → {x,y}），动画结束后清空 */
		var anim = null;      /* { from, to, t0, dur, raf } */

		function baseOf(id) {
			var q = pos[id];
			if (!q) { q = defaultPos(id, nodeIndex(id)); }
			return { x: q[0], y: q[1] };
		}
		/* 画面上此刻应该在的地方：动画中取插值，否则取已提交值 */
		function displayOf(id) {
			return disp[id] || baseOf(id);
		}
		function snapshot() {
			var o = {};
			CS.NODES.forEach(function (n) { o[n.id] = displayOf(n.id); });
			return o;
		}

		/* 缓动：easeOutCubic（起步快、收尾稳，滑动看起来更「丝滑」） */
		function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

		function stopAnim() {
			if (anim && anim.raf) { cancelAnimationFrame(anim.raf); }
			anim = null;
		}

		/* 把一批节点平滑移到目标位置；结束后写回 pos 并落盘 */
		function animateTo(targets, dur) {
			var ids = Object.keys(targets || {});
			if (!ids.length) { return; }
			var from = {};
			ids.forEach(function (id) { from[id] = displayOf(id); });
			stopAnim();
			anim = { from: from, ids: ids, to: targets, t0: performance.now(), dur: dur || ANIM_MS, raf: 0 };

			function step() {
				if (!anim) { return; }
				var k = Math.min(1, (performance.now() - anim.t0) / anim.dur);
				var e = easeOut(k);
				anim.ids.forEach(function (id) {
					var a = anim.from[id], b = anim.to[id];
					disp[id] = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
				});
				render();
				if (k < 1) {
					anim.raf = requestAnimationFrame(step);
				} else {
					anim.ids.forEach(function (id) {
						var b = anim.to[id];
						pos[id] = [Math.round(b.x), Math.round(b.y)];
						delete disp[id];
					});
					savePos(pos);
					anim = null;
					render();
				}
			}
			anim.raf = requestAnimationFrame(step);
		}

		/* ---------- 布局求解：顺序约束 + 互不重叠（二维） ----------
		 * 硬约束（都要满足）：
		 *   ① 路径上「下一步」必须在前一步右边，横向至少拉开 GAP_X；
		 *   ② 任意两个节点不许重叠 —— 节点是圆的，所以按**圆心距离**判定；
		 *   ③ 全部留在画布内。
		 *
		 * 三条都是硬约束，且**两个方向都能动、上一步也能动** ——
		 * 所以这是标准的约束松弛（投影法）：反复把违反约束的两方各推开一半。
		 *   · 缺顺序时：前一个向左、后一个向右各分摊一半（两边都动，位移最小）。
		 *   · 有重叠时：沿**两圆圆心连线**推开，而不是挑某个坐标轴 ——
		 *     这样修正量是斜向的，看起来自然得多（挑轴向会变成纯水平/纯垂直的"横移"）。
		 * 位移最小化靠「各让一半 + 沿连线推」自然达成。
		 */
		function planOrder(path) {
			if (!path || path.length < 2) { return null; }
			var start = snapshot();
			var work = {};
			CS.NODES.forEach(function (n) {
				work[n.id] = { x: start[n.id].x, y: start[n.id].y };
			});

			var ids = CS.NODES.map(function (n) { return n.id; });
			var MIN_X = R + 4, MAX_X = W - R - 4;
			var MIN_Y = R + 4, MAX_Y = H - R - 4;

			function clampAll() {
				ids.forEach(function (id) {
					var p = work[id];
					if (p.x < MIN_X) { p.x = MIN_X; }
					if (p.x > MAX_X) { p.x = MAX_X; }
					if (p.y < MIN_Y) { p.y = MIN_Y; }
					if (p.y > MAX_Y) { p.y = MAX_Y; }
				});
			}

			/* 圆心距离（小于 MIN_SEP 即视为重叠） */
			function tooClose(P, Q) {
				var dx = Q.x - P.x, dy = Q.y - P.y;
				return (dx * dx + dy * dy) < (MIN_SEP - 0.5) * (MIN_SEP - 0.5);
			}

			function violations() {
				var v = 0;
				for (var i = 1; i < path.length; i++) {
					var a = work[path[i - 1]], b = work[path[i]];
					if (a && b && (b.x - a.x) < GAP_X - 0.5) { v++; }
				}
				for (var m = 0; m < ids.length; m++) {
					for (var n = m + 1; n < ids.length; n++) {
						if (tooClose(work[ids[m]], work[ids[n]])) { v++; }
					}
				}
				return v;
			}
			if (!violations()) { return null; }

			/* 迭代松弛：每轮投影一次，越到后面步长越大，保证收敛 */
			var ITER = 120;
			for (var it = 0; it < ITER; it++) {
				var relax = it < ITER * 0.75 ? 0.5 : 1;

				/* ① 顺序：后一个要落到前一个右边，并且**落在前一个的右下方/右上方**。
				 *    如果只是对齐到同一行，虽然 x 够了，但纵向位移被「两行之间那点距离」
				 *    锁死，动画看起来仍然几乎是一条水平线。
				 *    所以这里给一个阶梯偏移 STAIR：后一个的目标是 (A.x + GAP_X, A.y ± STAIR)，
				 *    于是它从原位置斜着滑过去，长距离移动也看得出是斜的。
				 *    方向按空间余量选（默认往下，贴近底边就往上）。
				 *    A 也给一点反向纵向位移，保证「最主要的那两个」都在斜移。 */
				for (var i = 1; i < path.length; i++) {
					var A = work[path[i - 1]], B = work[path[i]];
					if (!A || !B) { continue; }
					var deficit = (A.x + GAP_X) - B.x;
					if (deficit > 0.5) {
						var half = deficit * relax / 2;
						var dy0 = A.y - B.y;
						var stairDir = (A.y + STAIR_DY <= MAX_Y) ? 1 : -1;
						var targetY = A.y + stairDir * STAIR_DY;
						A.x -= half;
						B.x += half;
						A.y -= dy0 * relax * 0.15;
						B.y += (targetY - B.y) * relax * 0.45;
					}
				}

				/* ② 分离：沿圆心连线推开（斜向），两边各让一半 */
				for (var m = 0; m < ids.length; m++) {
					for (var n = m + 1; n < ids.length; n++) {
						var P = work[ids[m]], Q = work[ids[n]];
						var dx = Q.x - P.x, dy = Q.y - P.y;
						var dist = Math.sqrt(dx * dx + dy * dy);
						if (dist >= MIN_SEP - 0.5) { continue; }
						var ux, uy;
						if (dist < 0.01) {
							/* 完全重合：给一个确定的斜向，避免除零 */
							ux = 0.7071; uy = 0.7071;
							dist = 0;
						} else {
							ux = dx / dist; uy = dy / dist;
						}
						var push = (MIN_SEP - dist) * relax / 2 + 0.05;
						P.x -= ux * push; P.y -= uy * push;
						Q.x += ux * push; Q.y += uy * push;
					}
				}

				clampAll();
			}

			/* 收尾：把仍差一点点的顺序约束补齐；
			 * 优先把后一个往右推，右边顶到头了就把前一个往左拉 */
			for (var k = 1; k < path.length; k++) {
				var A2 = work[path[k - 1]], B2 = work[path[k]];
				if (!A2 || !B2) { continue; }
				var d2 = (A2.x + GAP_X) - B2.x;
				if (d2 > 0.5) {
					var roomRight = MAX_X - B2.x;
					var moveRight = Math.min(d2, Math.max(0, roomRight));
					B2.x += moveRight;
					var remain = d2 - moveRight;
					if (remain > 0.5) { A2.x -= remain; }
				}
			}
			clampAll();

			/* 只提交真正移动了的 */
			var targets = {};
			ids.forEach(function (id) {
				var b = work[id], cur = displayOf(id);
				if (Math.abs(cur.x - b.x) > 0.5 || Math.abs(cur.y - b.y) > 0.5) {
					targets[id] = { x: Math.round(b.x), y: Math.round(b.y) };
				}
			});
			return Object.keys(targets).length ? targets : null;
		}

		/* 让路径满足「下一步在上一步右边」，并平滑移动 */
		function applyOrder(opts) {
			opts = opts || {};
			var t = planOrder(orderedPath());
			if (!t) {
				if (!opts.silent) { render(); }
				return false;
			}
			if (opts.animate === false) {
				Object.keys(t).forEach(function (id) {
					pos[id] = [Math.round(t[id].x), Math.round(t[id].y)];
					delete disp[id];
				});
				savePos(pos);
				render();
				return true;
			}
			animateTo(t, opts.dur);
			return true;
		}

		function emit(opts) {
			opts = opts || {};
			onChange(orderedPath(), { selected: selected.slice() });
			if (opts.layout === false) { render(); return; }
			/* 原样透传：animate / dur 都要交给 applyOrder，否则 animate:false 会被丢掉 */
			applyOrder(opts);
		}

		function toggle(id) {
			var at = selected.indexOf(id);
			if (at >= 0) { selected.splice(at, 1); }
			else { selected.push(id); }
			emit();
		}

		function setPath(p, opts) {
			selected = (p || []).slice();
			emit(opts);
		}

		/* ---------- 渲染 ---------- */
		function svgEl(tag, attrs) {
			var e = document.createElementNS(NS, tag);
			if (attrs) {
				Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
			}
			return e;
		}

		/* ================= 缩放补偿（窄窗口下字不能糊） =================
		 *
		 * SVG 是等比缩放的：viewBox 1000 宽画在 780px 的容器里，缩放比只有 0.78，
		 * 于是 11px 的标签在屏幕上只剩 9px —— 这正是「中等窗口字小得看不清」的原因。
		 *
		 * 解法不是把整张图改大（那会溢出），而是**在图内反向补偿**：
		 * 量出当前真实缩放比 k，把节点半径与标签字号都除以 k，
		 * 这样它们在屏幕上始终保持同一个物理大小（默认 11px 字、52px 圆）。
		 * k > 1 时不再补偿 —— 宽屏上本来就够大，再放大反而挤。
		 *
		 * 补偿要受两个限制，取更严的那个：
		 *   ① 圆最多胖到「刚好占满最小间距」：cap1 = MIN_SEP / (2R)；
		 *   ② 胖了之后**真的不能跟邻居压上** —— 逐个邻居算一遍可用空隙
		 *      cap2 = min(邻居圆心距) / (2R) - 一点余量。
		 * 只做 ① 是不够的：默认布局里有些邻居本来就比 MIN_SEP 近，
		 * 补偿一上来就压上了（实测 800px 下 f2l2 与 f2l4、oll 会挤到一起）。
		 */
		function viewScale() {
			if (!svg) { return 1; }
			var box = svg.getBoundingClientRect();
			if (!box.width || !box.height) { return 1; }
			/* 等比缩放取较小者，与 preserveAspectRatio="xMidYMid meet" 一致 */
			return Math.min(box.width / W, box.height / H);
		}
		function scaleFactor() {
			var k = viewScale();
			if (!isFinite(k) || k <= 0) { return 1; }
			if (k >= 1) { return 1; }
			var cap1 = MIN_SEP / (R * 2);
			/* ② 看离得最近的那一对，胖到那里就不能再胖了 */
			var cap2 = Infinity;
			var pts = {};
			CS.NODES.forEach(function (n) { pts[n.id] = displayOf(n.id); });
			var ids = Object.keys(pts);
			for (var i = 0; i < ids.length; i++) {
				for (var j = i + 1; j < ids.length; j++) {
					var a = pts[ids[i]], b = pts[ids[j]];
					var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
					if (d > 0 && d / (R * 2) < cap2) { cap2 = d / (R * 2); }
				}
			}
			/* 留 4% 余量，免得正好相切（相切在屏幕上看着就是挨上） */
			cap2 = cap2 === Infinity ? Infinity : cap2 * 0.96;
			var cap = Math.min(cap1, cap2);
			if (!isFinite(cap) || cap < 1) { cap = 1; }
			return Math.min(1 / k, cap);
		}

		function render() {
			if (!svg) { return; }
			linkLayer.innerHTML = "";
			ghostLayer.innerHTML = "";
			nodeLayer.innerHTML = "";

			/* 当前该用的补偿系数（窄窗口 > 1） */
			var kf = scaleFactor();
			var rUnit = R;            /* 圆心距、夹紧、连线裁切一律用**画布单位**的 R，
			                             保证布局算法不受视觉补偿影响 */
			var rDraw = R * kf;       /* 画出来的半径才乘补偿 */

					/* 连线绘制策略（改过两次，第二次才好看）
		 * ----------------------------------------------------------------------------
		 * v1：把 103 条「能连的边」全画出来当底纹 —— 结果像一团乱麻，
		 *     用户根本看不出主干在哪。
		 * v2（现在）：**只画骨架边**，也就是「同一条泳道里前后相邻的那几步」。
		 *     其余的跳转可能性不画，只在两种时候浮现：
		 *       · 鼠标悬停在某个节点上 → 亮出与它相连的所有边（回答「从这能去哪」）；
		 *       · 节点被选中 → 亮出路径上的边。
		 *     这样图上一眼能看清「流程主干」，交互时又能问出「还有哪些选择」。
		 */
		var path = orderedPath();
		var activeLinks = {};
		for (var i = 0; i + 1 < path.length; i++) { activeLinks[edgeKey(path[i], path[i + 1])] = true; }

		var centers = {};
		CS.NODES.forEach(function (n, i) { centers[n.id] = displayOf(n.id); });

		var linesByNode = {};
		EDGES.forEach(function (e) {
			var a = centers[e[0]], b = centers[e[1]];
			if (!a || !b) { return; }
			var t = trim(a, b, rDraw);
			var isActive = !!activeLinks[edgeKey(e[0], e[1])];
			/* 骨架边 = 同泳道相邻两步。其余的先藏着。
			   顶层四件不属于任何主轴（laneIndex 为 undefined），它们之间的边
			   以及它们与主轴的边都不是骨架 —— 这正对：顶层本来就任意穿插。 */
			var la = laneIndex(e[0]), lb = laneIndex(e[1]);
			var isSpine = !!la && !!lb && la[0] === lb[0] && Math.abs(la[1] - lb[1]) === 1;
			var line = svgEl("line", {
				x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
				"class": "gpLink" + (isSpine ? " spine" : "") + (isActive ? " active" : "")
			});
			line.setAttribute("data-a", e[0]);
			line.setAttribute("data-b", e[1]);
			linkLayer.appendChild(line);
			(linesByNode[e[0]] = linesByNode[e[0]] || []).push(line);
			(linesByNode[e[1]] = linesByNode[e[1]] || []).push(line);
		});

		/* 顶层四件（OLL棱/OLL角/PLL棱/PLL角）是一组「可任意穿插」的小节点，
		 * 给它们连一条淡底线，表明「这四个是一伙的」，而不是四棵孤树。
		 * 这条线是纯装饰，不参与任何判定（TOP_GROUP 只是画着好看的）。 */
		var topIds = ["ollCorner", "ollEdge", "pllEdge", "pllCorner"];
		for (var ti = 0; ti + 1 < topIds.length; ti++) {
			var ta = centers[topIds[ti]], tb = centers[topIds[ti + 1]];
			if (!ta || !tb) { continue; }
			var tt = trim(ta, tb, rDraw);
			linkLayer.appendChild(svgEl("line", {
				x1: tt.x1, y1: tt.y1, x2: tt.x2, y2: tt.y2,
				"class": "gpLink group"
			}));
		}

			/* 节点 */
			CS.NODES.forEach(function (n, i) {
				var c = centers[n.id];
				var g = svgEl("g", { "class": "gpNode", "data-id": n.id, "data-role": n.id === "scramble" ? "start" : (n.end ? "end" : "") });
				var inPath = path.indexOf(n.id) >= 0;
				g.setAttribute("data-selected", inPath ? "1" : "0");

				var grp = CS.groupById(n.group);
				var circle = svgEl("circle", { cx: c.x, cy: c.y, r: rDraw, "class": "gpNodeCircle" });
				circle.style.stroke = inPath ? "" : (grp ? grp.color : "");
				g.appendChild(circle);

				/* 分组色点：贴在圆的下沿，不挡标签（位置也跟着补偿走） */
				var dotR = 3.5;
				var dot = svgEl("circle", {
					cx: c.x, cy: c.y + rDraw - 8 * kf, r: dotR * kf, "class": "gpNodeDot"
				});
				dot.style.fill = grp ? grp.color : "";
				g.appendChild(dot);

				/* 路径序号：小号，压在圆的左上角，与居中的名字分开，
				 * 免得「2 F2L 4」挤成一行看不清谁是序号谁是名字。 */
				var idx = path.indexOf(n.id);
				if (idx >= 0) {
					var badge = svgEl("circle", {
						cx: c.x - rDraw * 0.62, cy: c.y - rDraw * 0.62, r: 8.5 * kf,
						"class": "gpNodeOrderBg"
					});
					g.appendChild(badge);
					var ord = svgEl("text", {
						x: c.x - rDraw * 0.62, y: c.y - rDraw * 0.62, "class": "gpNodeOrder"
					});
					ord.setAttribute("dominant-baseline", "central");
					/* 字号乘补偿：窄窗口下才能保持屏幕上的物理大小 */
					ord.style.fontSize = (9.5 * kf).toFixed(2) + "px";
					ord.textContent = String(idx + 1);
					g.appendChild(ord);
				}

				var lab = svgEl("text", { x: c.x, y: c.y, "class": "gpNodeLabel" });
				lab.setAttribute("dominant-baseline", "central");
				/* 关键：标签字号乘补偿，屏幕上永远是同一个物理尺寸（≈11px） */
				lab.style.fontSize = (11 * kf).toFixed(2) + "px";
				lab.textContent = n.name;
				g.appendChild(lab);

				var title = svgEl("title");
				title.textContent = n.name + "\n" + n.desc;
				g.appendChild(title);

				g.addEventListener("click", function (ev) { ev.stopPropagation(); toggle(n.id); });

				/* 悬停：把该节点能连的所有边点亮，让人一眼看到「从这里能去哪」 */
				var mine = linesByNode[n.id] || [];
				g.addEventListener("pointerenter", function () {
					mine.forEach(function (ln) { ln.classList.add("hover"); });
				});
				g.addEventListener("pointerleave", function () {
					mine.forEach(function (ln) { ln.classList.remove("hover"); });
				});

				/* 拖动改位置（记进 localStorage） */
				enableDrag(g, n.id, c, centers);
				nodeLayer.appendChild(g);
			});
		}

		function label(id) {
			var n = CS.nodeById(id);
			return n ? n.name : id;
		}

		/* 拖动改位置（记进 localStorage）。
		 *
		 * ⚠️ 这里的两个坑（都踩过，改了别再退回去）：
		 *
		 * ① **移动与松手必须挂在 window 上，不能挂在节点自己身上。**
		 *    节点圆直径才 52 个 SVG 单位，鼠标一往外甩就出了元素的盒子，
		 *    pointermove 就不再派发给它 —— 表现为「拖两下就断」。
		 *    setPointerCapture 本来能救，但它在「没有活跃指针」的合成事件里会抛，
		 *    旧代码 try/catch 把它吞掉了，于是静默失效。所以改成：
		 *    按下时同时挂 window 的 move/up/cancel，松手立刻摘掉。
		 *
		 * ② **坐标换算要用 viewBox 的真实缩放比。**
		 *    SVG 是 preserveAspectRatio 等比缩放的，box.width/box.height 与 viewBox
		 *    的宽高比不一定一致（容器偏矮时左右会留白），
		 *    用 width 与 height 各算一个比例就会拖歪。这里统一取较小的那个。 */
		function enableDrag(g, id, center, centers) {
			var dragging = false, startX = 0, startY = 0, origX = 0, origY = 0, moved = false;
			var pid = null;
			/* 拖动后浏览器还会补发一个 click：用一个短窗口把它吞掉。
			 * 不能只看 moved —— 松手时已经把 moved 清掉了。 */
			var swallowClickUntil = 0;

			function toLocal(ev) {
				var box = svg.getBoundingClientRect();
				if (!box.width || !box.height) { return { x: center.x, y: center.y }; }
				/* 等比缩放：取较小比例才是真实 1 单位 = 多少 px */
				var s = Math.min(box.width / W, box.height / H);
				var src = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
				/* 内容居中：把两侧留白减掉 */
				var padX = (box.width - W * s) / 2;
				var padY = (box.height - H * s) / 2;
				return {
					x: (src.clientX - box.left - padX) / s,
					y: (src.clientY - box.top - padY) / s
				};
			}

			function onMove(ev) {
				if (!dragging) { return; }
				if (pid != null && ev.pointerId != null && ev.pointerId !== pid) { return; }
				var p = toLocal(ev);
				var dx = p.x - startX, dy = p.y - startY;
				if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
					moved = true;
					g.classList.add("dragging");
				}
				if (!moved) { return; }
				ev.preventDefault();
				var nx = Math.max(R + 4, Math.min(W - R - 4, origX + dx));
				var ny = Math.max(R + 4, Math.min(H - R - 4, origY + dy));				/* 只改内存里的位置，拖动过程中不写 localStorage（60fps 下会明显卡） */
				pos[id] = [Math.round(nx), Math.round(ny)];
				delete disp[id];
				var c2 = centers[id];
				c2.x = nx; c2.y = ny;
				render();
			}

			function onUp(ev) {
				if (!dragging) { return; }
				if (pid != null && ev && ev.pointerId != null && ev.pointerId !== pid) { return; }
				var wasMoved = moved;
				dragging = false; moved = false; pid = null;
				g.classList.remove("dragging");
				window.removeEventListener("pointermove", onMove, true);
				window.removeEventListener("pointerup", onUp, true);
				window.removeEventListener("pointercancel", onUp, true);
				if (wasMoved) {
					savePos(pos);          /* 松手时落盘一次即可 */
					swallowClickUntil = performance.now() + 400;
					/* 拖动之后不要再触发 click 的选中切换 */
					if (ev) { ev.preventDefault(); ev.stopPropagation(); }
				}
			}

			g.addEventListener("pointerdown", function (ev) {
				if (ev.button != null && ev.button !== 0) { return; }
				stopAnim();          /* 手动拖动优先，先终止进行中的自动动画 */
				dragging = true; moved = false;
				pid = ev.pointerId;
				var p = toLocal(ev);
				startX = p.x; startY = p.y;
				origX = center.x; origY = center.y;
				/* 能捕获就捕获（真实指针下最稳），捕获不到也不影响 ——
				 * window 上的监听才是主通道。 */
				try { g.setPointerCapture && g.setPointerCapture(ev.pointerId); } catch (e) {}
				window.addEventListener("pointermove", onMove, true);
				window.addEventListener("pointerup", onUp, true);
				window.addEventListener("pointercancel", onUp, true);
				ev.preventDefault();
			});

			/* 拖动之后紧跟的 click 要吞掉，否则一拖就顺手选中了节点 */
			g.addEventListener("click", function (ev) {
				if (performance.now() < swallowClickUntil) {
					ev.stopPropagation(); ev.preventDefault();
				}
			}, true);
		}

		/* ---------- 初始化 ---------- */
		mount.innerHTML = "";
		svg = svgEl("svg", { "class": "gpSvg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet" });
		linkLayer = svgEl("g");
		ghostLayer = svgEl("g");
		nodeLayer = svgEl("g");
		svg.appendChild(linkLayer);
		svg.appendChild(ghostLayer);
		svg.appendChild(nodeLayer);
		svg.addEventListener("click", function () { /* 空白处不动作 */ });
		mount.appendChild(svg);

		render();

		/* 窗口尺寸变了 → 缩放比变了 → 图内字号/半径要重新补偿。
		 * 用 ResizeObserver 盯住 svg 本身（比 window.resize 准：容器宽度也会被别的
		 * 布局变化带动，比如侧栏折行），再过一帧重绘，避免 resize 期间狂算。 */
		var refitRaf = 0;
		function scheduleRedraw() {
			if (refitRaf) { cancelAnimationFrame(refitRaf); }
			refitRaf = requestAnimationFrame(function () {
				refitRaf = 0;
				render();
			});
		}
		var ro = null;
		if (typeof ResizeObserver !== "undefined") {
			var lastW = 0;
			ro = new ResizeObserver(function (entries) {
				var w = Math.round(entries[0].contentRect.width);
				if (Math.abs(w - lastW) < 2) { return; }   /* 亚像素抖动不算 */
				lastW = w;
				scheduleRedraw();
			});
			ro.observe(svg);
		} else {
			window.addEventListener("resize", scheduleRedraw);
		}

		return {
			setPath: setPath,
			path: orderedPath,
			selected: function () { return selected.slice(); },
			clear: function () { selected = []; emit(); },
			destroy: function () {
				if (ro) { ro.disconnect(); }
				else { window.removeEventListener("resize", scheduleRedraw); }
				if (refitRaf) { cancelAnimationFrame(refitRaf); }
				stopAnim();
			},
			resetLayout: function () {
				try { localStorage.removeItem(POS_KEY); } catch (e) {}
				pos = {};
				disp = {};
				stopAnim();
				render();
			},
			/* 只整理布局、不改选择；返回是否真的移动了东西 */
			applyOrder: function (o) { return applyOrder(o); },
			/* 供拖动胶囊改顺序后调用：顺序变了，重排并平滑移动 */
			reorder: function (p) { setPath(p, { layout: true }); },
			isAnimating: function () { return !!anim; },
			render: render,
			EDGES: EDGES,
			hasEdge: hasEdge,
			/* 「新加这个节点最该插到第几位」。返回 -1 表示图上找不到自然位置，
			 * 调用方就按点击顺序留在末尾。**不改路径、不改点击顺序语义** ——
			 * 只是把「这一段里补一步」的常见意图算出来，交给调用方决定。 */
			insertIndexFor: insertIndexFor,
			edgeSteps: edgeSteps
		};
	}

	root.CubeStageGraph = {
		create: create,
		EDGES: EDGES,
		hasEdge: hasEdge,
		/* 有向：这个方向做得到吗（路径合法性用这个，别用 hasEdge） */
		canStep: canStep,
		LANES: LANES,
		POS_KEY: POS_KEY,
		W: W, H: H, R: R
	};
})(typeof globalThis !== "undefined" ? globalThis : this);
