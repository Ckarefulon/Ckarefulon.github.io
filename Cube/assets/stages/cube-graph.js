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

	/* 关键边：只画「常见推进方向」的连线，作为导航辅助，不限制选择。
	 * 方向不表示「必须这样走」，只是把常见推进画出来当导航；反向和任意跳步都能连。
	 *
	 * 关于连线密度（重要）：用户**可以**连任意两点，但图上不可能把 272 种组合全画出来
	 * —— 顶层四个子节点两两互连会在那一小块堆成一团，反而看不清节点。
	 * 所以这里的取法是：
	 *   · 只画「读者一眼能看出流向」的边：主流推进 + 少量典型跳步；
	 *   · 顶层四个正交目标（OLL 棱/OLL 角/PLL 棱/PLL 角）互相之间只画成环，
	 *     表达「这四个没有固定先后、任意交错都行」，而不是画满六条两两连线；
	 *   · 拖动的自由连边不受这里限制，选中的路会用高亮描出来。
	 *
	 * 另补「跳过中间的组」的快捷边，例如 CB 式在 F4 过程中顺便控棱，
	 * 等价于从 F3 直接到 OLL 棱。 */
	var EDGES = (function () {
		var list = [
			/* 十字 / F2L 主轴 */
			["scramble", "cross"], ["cross", "f2l1"], ["f2l1", "f2l2"], ["f2l2", "f2l3"], ["f2l3", "f2l4"],
			/* F2L → 顶层：F4 直接进顶层；CB 式从 F3/F2 就控棱 */
			["f2l4", "oll"], ["f2l4", "pll"],
			["f2l3", "ollEdge"], ["f2l2", "ollEdge"],
			/* 顶层：方向 → 位置的主干，以及两个聚合节点 */
			["ollEdge", "oll"], ["ollCorner", "oll"],
			["pllEdge", "pll"], ["pllCorner", "pll"],
			["oll", "pll"], ["oll", "solved"], ["pll", "solved"],
			/* 顶层四个正交目标：画成一个「任意交错」的环 + 两条对角线。
			 * 对角线（棱↔角交叉）正是「先 PLL 棱、再 OLL 角」这类交错顺序用到的边，
			 * 必须画出来；但不再补满六条，否则那一小块会糊成一团。 */
			["f2l4", "ollEdge"], ["f2l4", "ollCorner"],
			["ollEdge", "ollCorner"], ["ollCorner", "pllCorner"],
			["pllCorner", "pllEdge"], ["pllEdge", "ollEdge"],
			["ollEdge", "pllCorner"], ["ollCorner", "pllEdge"],
			/* Roux */
			["scramble", "fb"], ["fb", "sb"], ["sb", "cmll"], ["cmll", "lse"], ["lse", "solved"],
			["sb", "f2l4"], ["f2l4", "sb"], ["fb", "cross"], ["cross", "sb"],
			["cmll", "pll"], ["cmll", "solved"]
		];
		return list;
	})();

	/* 每侧的边集合（用于「这条边两侧的点」快捷选择） */
	function edgeKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
	var EDGE_SET = {};
	EDGES.forEach(function (e) { EDGE_SET[edgeKey(e[0], e[1])] = true; });

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

			/* 连线 */
			EDGES.forEach(function (e) {
				var a = centers[e[0]], b = centers[e[1]];
				if (!a || !b) { return; }
				var t = trim(a, b, R);
				var isActive = !!activeLinks[edgeKey(e[0], e[1])];
				var line = svgEl("line", {
					x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2,
					"class": "gpLink" + (isActive ? " active" : "")
				});
				linkLayer.appendChild(line);
				/* 命中区：点边 = 一键选中两端 */
				var hit = svgEl("line", {
					x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, "class": "gpLinkHit"
				});
				hit.addEventListener("click", function (ev) {
					ev.stopPropagation();
					selected = [e[0], e[1]];
					emit();
				});
				hit.appendChild(svgEl("title")).textContent = "";
				hit.querySelector("title").textContent = "点此选中这条边的两端：" + label(e[0]) + " → " + label(e[1]);
				linkLayer.appendChild(hit);
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
			EDGES: EDGES
		};
	}

	root.CubeStageGraph = {
		create: create,
		EDGES: EDGES,
		POS_KEY: POS_KEY,
		W: W, H: H, R: R
	};
})(typeof globalThis !== "undefined" ? globalThis : this);
