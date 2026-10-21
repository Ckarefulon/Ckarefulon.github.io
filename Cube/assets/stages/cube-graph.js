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
	function nodeCenter(id, pos, i) {
		var q = pos[id] || defaultPos(id, i);
		return { x: q[0], y: q[1] };
	}
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

		function emit() {
			onChange(orderedPath(), { selected: selected.slice() });
			render();
		}

		function toggle(id) {
			var at = selected.indexOf(id);
			if (at >= 0) { selected.splice(at, 1); }
			else { selected.push(id); }
			emit();
		}

		function setPath(p) {
			selected = (p || []).slice();
			emit();
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
			CS.NODES.forEach(function (n, i) { centers[n.id] = nodeCenter(n.id, loadPos(), i); });

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
				dragging = true; moved = false;
				var p = pt(ev);
				startX = p.x; startY = p.y;
				origX = center.x; origY = center.y;
				g.setPointerCapture && g.setPointerCapture(ev.pointerId);
			});
			g.addEventListener("pointermove", function (ev) {
				if (!dragging) { return; }
				var p = pt(ev);
				var dx = p.x - startX, dy = p.y - startY;
				if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { moved = true; }
				if (!moved) { return; }
				var nx = Math.max(R + 4, Math.min(W - R - 4, origX + dx));
				var ny = Math.max(R + 4, Math.min(H - R - 4, origY + dy));
				var store = loadPos();
				store[id] = [Math.round(nx), Math.round(ny)];
				savePos(store);
				var c2 = centers[id];
				c2.x = nx; c2.y = ny;
				render();
			});
			g.addEventListener("pointerup", function (ev) {
				if (dragging && moved) {
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
			resetLayout: function () { try { localStorage.removeItem(POS_KEY); } catch (e) {} render(); },
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
