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
	var W = 940, H = 520;
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

	/* ---------- 默认坐标 ---------- */
	var DEFAULT_POS = {
		scramble:  [58, 262],
		cross:     [178, 262],
		f2l1:      [298, 384],
		f2l2:      [418, 384],
		f2l3:      [538, 384],
		f2l4:      [538, 262],
		ollEdge:   [658, 148],
		ollCorner: [658, 214],
		oll:       [658, 340],
		pllEdge:   [790, 156],
		pllCorner: [790, 232],
		pll:       [790, 356],
		solved:    [898, 262],
		fb:        [178, 120],
		sb:        [380, 96],
		cmll:     [518, 148],
		lse:       [880, 96]
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

		function render() {
			if (!svg) { return; }
			linkLayer.innerHTML = "";
			ghostLayer.innerHTML = "";
			nodeLayer.innerHTML = "";

			var path = orderedPath();
			var activeLinks = {};
			for (var i = 0; i + 1 < path.length; i++) { activeLinks[edgeKey(path[i], path[i + 1])] = true; }

			var centers = {};
			CS.NODES.forEach(function (n, i) { centers[n.id] = displayOf(n.id); });

			/* 连线：全部「不回退」的组合都画出来，但底色极淡（当作可选范围的底纹），
			 * 只有①选中路径上的边 ②鼠标悬停节点时该节点的边 才亮起来。
			 * 这样既如实表达「这些都能连」，又不会糊成一团看不清节点。 */
			var linesByNode = {};
			EDGES.forEach(function (e) {
				var a = centers[e[0]], b = centers[e[1]];
				if (!a || !b) { return; }
				var t = trim(a, b, R);
				var isActive = !!activeLinks[edgeKey(e[0], e[1])];
				var line = svgEl("line", {
					x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
					"class": "gpLink" + (isActive ? " active" : "")
				});
				line.setAttribute("data-a", e[0]);
				line.setAttribute("data-b", e[1]);
				linkLayer.appendChild(line);
				(linesByNode[e[0]] = linesByNode[e[0]] || []).push(line);
				(linesByNode[e[1]] = linesByNode[e[1]] || []).push(line);
			});

			/* 节点 */
			CS.NODES.forEach(function (n, i) {
				var c = centers[n.id];
				var g = svgEl("g", { "class": "gpNode", "data-id": n.id, "data-role": n.id === "scramble" ? "start" : (n.end ? "end" : "") });
				var inPath = path.indexOf(n.id) >= 0;
				g.setAttribute("data-selected", inPath ? "1" : "0");

				var grp = CS.groupById(n.group);
				var circle = svgEl("circle", { cx: c.x, cy: c.y, r: R, "class": "gpNodeCircle" });
				circle.style.stroke = inPath ? "" : (grp ? grp.color : "");
				g.appendChild(circle);

				/* 分组色点（节点内小圆，标示归属） */
				var dot = svgEl("circle", { cx: c.x, cy: c.y + R - 8, r: 3.5, "class": "gpNodeDot" });
				dot.style.fill = grp ? grp.color : "";
				g.appendChild(dot);

				/* 路径序号 */
				var idx = path.indexOf(n.id);
				if (idx >= 0) {
					var ord = svgEl("text", { x: c.x, y: c.y - 3, "class": "gpNodeOrder" });
					ord.style.fill = "#0f0d18";
					ord.textContent = String(idx + 1);
					g.appendChild(ord);
				}

				var lab = svgEl("text", { x: c.x, y: c.y + 5, "class": "gpNodeLabel" });
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

		function enableDrag(g, id, center, centers) {
			var dragging = false, startX = 0, startY = 0, origX = 0, origY = 0, moved = false;
			function pt(ev) {
				var box = svg.getBoundingClientRect();
				var sx = W / box.width, sy = H / box.height;
				var src = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
				return { x: (src.clientX - box.left) * sx, y: (src.clientY - box.top) * sy };
			}
			g.addEventListener("pointerdown", function (ev) {
				stopAnim();          /* 手动拖动优先，先终止进行中的自动动画 */
				dragging = true; moved = false;
				var p = pt(ev);
				startX = p.x; startY = p.y;
				origX = center.x; origY = center.y;
				/* 合成事件可能没有活跃指针，捕获失败不影响拖动本身 */
				try { g.setPointerCapture && g.setPointerCapture(ev.pointerId); } catch (e) {}
			});
			g.addEventListener("pointermove", function (ev) {
				if (!dragging) { return; }
				var p = pt(ev);
				var dx = p.x - startX, dy = p.y - startY;
				if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { moved = true; }
				if (!moved) { return; }
				var nx = Math.max(R + 4, Math.min(W - R - 4, origX + dx));
				var ny = Math.max(R + 4, Math.min(H - R - 4, origY + dy));
				/* 只改内存里的位置，拖动过程中不写 localStorage（60fps 下会明显卡） */
				pos[id] = [Math.round(nx), Math.round(ny)];
				delete disp[id];
				var c2 = centers[id];
				c2.x = nx; c2.y = ny;
				render();
			});
			g.addEventListener("pointerup", function (ev) {
				if (dragging && moved) {
					savePos(pos);          /* 松手时落盘一次即可 */
					/* 拖动结束时不要再触发 click 的选中切换 */
					ev.preventDefault();
					ev.stopPropagation();
				}
				dragging = false;
			});
			g.addEventListener("click", function (ev) { if (moved) { ev.stopPropagation(); } }, true);
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

		return {
			setPath: setPath,
			path: orderedPath,
			selected: function () { return selected.slice(); },
			clear: function () { selected = []; emit(); },
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
			hasEdge: hasEdge
		};
	}

	root.CubeStageGraph = {
		create: create,
		EDGES: EDGES,
		hasEdge: hasEdge,
		LANES: LANES,
		POS_KEY: POS_KEY,
		W: W, H: H, R: R
	};
})(typeof globalThis !== "undefined" ? globalThis : this);
