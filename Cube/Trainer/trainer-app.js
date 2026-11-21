/*
 * Trainer 分段训练（页面主逻辑）
 * ---------------------------------------------------------------------------
 * 训练场的本质：在整个复原过程里「取一段」来练。
 *
 *   1. 选段页给两条路：一条是「快速选段」（预设组合 + 起止两个下拉，三秒选好），
 *      另一条是「节点图」（点两个节点连成一条路，七节点全程可见，任意两点都能连）。
 *      两条路改的是同一份状态，选完立刻同步。
 *   2. 打乱之后，魔方当前状态就是这条路起点节点的判定基准；
 *      拧到终点节点条件满足就结束计时 —— 计时只覆盖选中的这一段。
 *   3. 起停口径：直接开拧（魔方起表）→ 魔方状态到终点自动停；
 *      手动起表（空格/按钮）→ 必须手动停表，停表后校验，没到终点判 DNF。
 *   4. 六色底：完整打乱态自动识别底色；其它情况由用户在选段页自己选。
 *
 * 依赖：TrainerCommon / CubeStages / CubeStageGraph / CubeTimer / CubeNet /
 *       CubeSmartCube（蓝牙桥，可选）。index.html 保证加载顺序。
 */
(function () {
	'use strict';

	var C = window.TrainerCommon;
	var CS = window.CubeStages;
	var F = C && C.FaceletUtil;

	if (!C || !CS || !F || !window.mathlib || !window.CubeNet || !window.CubeTimer) {
		return;
	}

	function $(id) { return document.getElementById(id); }
	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) { e.className = cls; }
		if (text != null) { e.textContent = text; }
		return e;
	}

	/* ================= 状态 ================= */

	var st = {
		view: "pick",                 /* pick | train */
		path: [],                     /* 选中的节点路径 */
		frame: { bottom: "D", front: "F" },
		frameAuto: true,              /* 底色是否来自自动识别 */
		origin: "scramble",           /* scramble | current */
		puzzle: null,                 /* 本题：{ scrambleText, baseFacelet, note } */
		timer: null,
		graph: null,
		connected: false,
		result: null
	};

	/* ================= 常用路径预设 ================= */

	var PRESETS = [
		{ name: "十字", path: ["scramble", "cross"] },
		{ name: "全部 F2L", path: ["scramble", "cross", "f2l4"] },
		{ name: "OLL", path: ["scramble", "f2l4", "oll"] },
		{ name: "PLL", path: ["scramble", "f2l4", "oll", "pll"] },
		{ name: "顶层（OLL+PLL）", path: ["scramble", "f2l4", "oll", "pll"] },
		{ name: "完整 CFOP", path: ["scramble", "cross", "f2l1", "f2l2", "f2l3", "f2l4", "oll", "pll"] },
		{ name: "先翻棱再翻角", path: ["scramble", "f2l4", "ollEdge", "ollCorner", "oll"] },
		{ name: "先翻角再翻棱", path: ["scramble", "f2l4", "ollCorner", "oll"] },
		{ name: "先控棱位再翻角", path: ["scramble", "f2l4", "pllEdge", "oll"] },
		{ name: "棱/角交叉四步", path: ["scramble", "f2l4", "pllEdge", "ollCorner", "pllCorner", "ollEdge"] },
		{ name: "CB 控棱（F3 直入）", path: ["scramble", "cross", "f2l3", "ollEdge", "oll", "pll"] },
		{ name: "右桥", path: ["scramble", "fb", "sb"] },
		{ name: "CMLL+LSE", path: ["scramble", "sb", "cmll", "lse"] },
		{ name: "完整 Roux", path: ["scramble", "fb", "sb", "cmll", "lse"] }
	];

	/* ================= 底色 ================= */

	var COLOR_OF = { U: "#f5f5f5", R: "#c62828", F: "#2e9e4b", D: "#f5c518", L: "#ef6c1a", B: "#1565c0" };
	var COLOR_NAME = { U: "白", R: "红", F: "绿", D: "黄", L: "橙", B: "蓝" };
	var OPPOSITE = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

	function frontOptions(bottom) {
		var opp = OPPOSITE[bottom];
		return CS.FACES.filter(function (f) { return f !== bottom && f !== opp; });
	}

	function renderColorRow() {
		var row = $("trColorRow");
		row.innerHTML = "";
		CS.FACES.forEach(function (face) {
			var b = el("button", "chip swatch");
			b.type = "button";
			b.dataset.face = face;
			b.title = COLOR_NAME[face] + "底";
			b.setAttribute("aria-pressed", st.frame.bottom === face ? "true" : "false");
			b.style.setProperty("--swatch", COLOR_OF[face]);
			b.appendChild(el("span", "chip-swatch"));
			b.appendChild(el("span", null, COLOR_NAME[face]));
			b.addEventListener("click", function () {
				st.frameAuto = false;
				st.frame.bottom = face;
				if (st.frame.front === face || st.frame.front === OPPOSITE[face]) {
					st.frame.front = frontOptions(face)[0];
				}
				renderColorRow();
				renderFrontRow();
				syncAll();
			});
			row.appendChild(b);
		});
	}

	function renderFrontRow() {
		var host = $("trFrontRow");
		host.innerHTML = "";
		frontOptions(st.frame.bottom).forEach(function (face) {
			var b = el("button", "chip swatch");
			b.type = "button";
			b.dataset.face = face;
			b.setAttribute("aria-pressed", st.frame.front === face ? "true" : "false");
			b.style.setProperty("--swatch", COLOR_OF[face]);
			b.title = COLOR_NAME[face] + "朝前";
			b.appendChild(el("span", "chip-swatch"));
			b.appendChild(el("span", null, COLOR_NAME[face]));
			b.addEventListener("click", function () {
				st.frameAuto = false;
				st.frame.front = face;
				renderFrontRow();
				syncAll();
			});
			host.appendChild(b);
		});
	}

	function frameTag() {
		return COLOR_NAME[st.frame.bottom] + "底 / " + COLOR_NAME[st.frame.front] + "前";
	}

	/* 自动识别底色：完整打乱态下枚举 24 个参考系里离目标最近的那个 */
	function autoDetectFrame(facelet) {
		var best = CS.bestFrame(facelet);
		st.frame = { bottom: best.frame.bottom, front: best.frame.front };
		st.frameAuto = true;
		renderColorRow();
		renderFrontRow();
		return best;
	}

	/* ================= 出题 ================= */

	function scrambleFacelet(len) {
		var sc = C.Scramble.randomRange(len || 20, (len || 20) + 5);
		return { moves: sc, text: sc.join(" "), facelet: F.applyToFacelet(F.SOLVED, sc) };
	}

	function bluetoothFacelet() {
		var bt = window.CubeTimer.bluetooth;
		var f = bt.facelet();
		return (f && f.length === 54) ? f : "";
	}

	/* 造一道题：起点状态 + 打乱文本 */
	function newPuzzle() {
		var p;
		var currentFacelet = bluetoothFacelet();
		if (st.origin === "current" && st.connected && currentFacelet) {
			p = {
				baseFacelet: currentFacelet,
				scrambleText: "",
				note: "起点 = 蓝牙魔方的当前状态"
			};
			if (st.frameAuto) { autoDetectFrame(currentFacelet); }
		} else {
			var sc = scrambleFacelet(20);
			p = {
				baseFacelet: sc.facelet,
				scrambleText: sc.text,
				/* 连着魔方时要说清楚：判定看的是手上的真魔方，屏幕上这条公式是要你去拧的 */
				note: st.connected
					? "照着这条公式把魔方打乱，之后判定看的是魔方的真实状态"
					: "打乱态已显示在右侧展开图上；没有魔方就在下面直接打算法"
			};
			if (st.frameAuto) { autoDetectFrame(sc.facelet); }
		}
		st.puzzle = p;
		st.result = null;
		return p;
	}

	/* ================= 路径 ================= */

	function nodeName(id) {
		var n = CS.nodeById(id);
		return n ? n.name : id;
	}
	function pathLabel(path) {
		return (path || st.path).map(nodeName).join(" → ");
	}

	function updatePathUI() {
		var box = $("trPathBox");
		var hint = $("trPathHint");
		box.innerHTML = "";

		if (!st.path.length) {
			box.appendChild(el("span", "gpPathEmpty", "还没有选。点上面的预设，或在节点图上按「起点 → 终点」点两下。"));
		} else {
			st.path.forEach(function (id, i) {
				var item = el("span", "gpPathItem");
				item.dataset.id = id;
				var chip = el("span", "gpChip");
				chip.dataset.id = id;
				chip.dataset.role = (i === 0 || i === st.path.length - 1) ? "end" : "mid";
				chip.title = "按住拖动可调整顺序";
				chip.appendChild(el("span", "gpChipOrder", String(i + 1)));
				chip.appendChild(el("span", null, nodeName(id)));
				var x = el("button", "gpChipX", "\u00d7");
				x.type = "button";
				x.title = "从这条路里去掉";
				x.addEventListener("click", function (ev) {
					ev.stopPropagation();
					var at = st.path.indexOf(id);
					if (at >= 0) { st.path.splice(at, 1); }
					if (st.graph) { st.graph.setPath(st.path); }
					syncAll();
				});
				chip.appendChild(x);
				item.appendChild(chip);
				if (i < st.path.length - 1) {
					item.appendChild(el("span", "gpArrow", "\u2192"));
				}
				box.appendChild(item);
			});
		}

		var v = CS.validatePath(st.path);
		var segCount = st.path.length >= 2 ? st.path.length - 1 : 0;
		if (!st.path.length) {
			hint.textContent = "";
			hint.dataset.kind = "";
		} else if (!v.ok) {
			hint.textContent = v.reason;
			hint.dataset.kind = "err";
		} else {
			/* 只报段数与起止，顺序由用户定，程序不评判方向 */
			hint.textContent = segCount + " 段 · " + nodeName(st.path[0]) + " → " + nodeName(st.path[st.path.length - 1]);
			hint.dataset.kind = "ok";
		}

		var usable = v.ok;
		$("trStartBtn").disabled = !usable;
		$("trSavePathBtn").disabled = !usable;
		renderHeadSub();
		syncPairSelects();
		syncPresetPressed();
		syncStartEnabled();
	}

	/* 页头那句说明：它就是「当前在练哪一段」，没有选段时给一句引导。
	 * 这是这页的主语，所以放在页面标题下面，而不是塞进一条工具条。 */
	function renderHeadSub() {
		var host = $("trHeadSub");
		if (!host) { return; }
		if (!st.path.length) {
			host.textContent = "在节点图上点两个节点连成一条路，只练这一段。";
			return;
		}
		host.innerHTML = "";
		var prefix = document.createTextNode(st.view === "train" ? "正在练：" : "已选这一段：");
		host.appendChild(prefix);
		var span = el("span", "sub-path", pathLabel());
		host.appendChild(span);
		var fr = el("span", "sub-frame", " · " + frameTag());
		host.appendChild(fr);
	}

	/* ---- 拖动胶囊改顺序（图上节点跟着平滑移动） ---- */
	function pathItems() {
		return [].slice.call($("trPathBox").querySelectorAll(".gpPathItem"));
	}
	function itemIds() {
		return pathItems().map(function (it) { return it.dataset.id; });
	}
	function renumberChips() {
		var total = pathItems().length;
		pathItems().forEach(function (it, i) {
			var num = it.querySelector(".gpChipOrder");
			if (num) { num.textContent = String(i + 1); }
			var chip = it.querySelector(".gpChip");
			if (chip) { chip.dataset.role = (i === 0 || i === total - 1) ? "end" : "mid"; }
		});
	}
	function insertBeforeFor(clientX, clientY, draggingItem) {
		var items = pathItems().filter(function (it) { return it !== draggingItem; });
		for (var i = 0; i < items.length; i++) {
			var r = items[i].getBoundingClientRect();
			if (clientY < r.top) { return items[i]; }
			if (clientY <= r.bottom) {
				if (clientX < r.left + r.width / 2) { return items[i]; }
			}
		}
		return null;
	}

	var chipDrag = null;
	function bindChipDrag() {
		var box = $("trPathBox");

		box.addEventListener("pointerdown", function (ev) {
			if (ev.button != null && ev.button !== 0) { return; }
			if (ev.target.closest && ev.target.closest(".gpChipX")) { return; }
			var chip = ev.target.closest ? ev.target.closest(".gpChip") : null;
			if (!chip) { return; }
			chipDrag = {
				pointerId: ev.pointerId, chip: chip, item: chip.parentNode,
				startX: ev.clientX, startY: ev.clientY, active: false
			};
		});

		box.addEventListener("pointermove", function (ev) {
			var d = chipDrag;
			if (!d || ev.pointerId !== d.pointerId) { return; }
			if (!d.active) {
				if (Math.abs(ev.clientX - d.startX) < 5 && Math.abs(ev.clientY - d.startY) < 5) { return; }
				d.active = true;
				var r = d.chip.getBoundingClientRect();
				d.offX = d.startX - r.left;
				d.offY = d.startY - r.top;
				var ghost = d.chip.cloneNode(true);
				ghost.classList.add("gpChipGhost");
				ghost.removeAttribute("title");
				ghost.style.width = r.width + "px";
				d.ghost = ghost;
				document.body.appendChild(ghost);
				d.chip.classList.add("dragging");
				try { box.setPointerCapture(ev.pointerId); } catch (e) {}
			}
			d.ghost.style.left = (ev.clientX - d.offX) + "px";
			d.ghost.style.top = (ev.clientY - d.offY) + "px";
			var before = insertBeforeFor(ev.clientX, ev.clientY, d.item);
			if (before) {
				if (before !== d.item.nextSibling) { box.insertBefore(d.item, before); }
			} else if (d.item !== box.lastChild) {
				box.appendChild(d.item);
			}
			renumberChips();
			ev.preventDefault();
		});

		function endDrag(ev) {
			var d = chipDrag;
			if (!d || (ev && ev.pointerId !== d.pointerId)) { return; }
			chipDrag = null;
			if (!d.active) { return; }
			if (d.ghost && d.ghost.parentNode) { d.ghost.parentNode.removeChild(d.ghost); }
			d.chip.classList.remove("dragging");
			st.path = itemIds();
			if (st.graph) { st.graph.reorder(st.path); }
			syncAll();
			if (ev) { ev.preventDefault(); ev.stopPropagation(); }
		}
		box.addEventListener("pointerup", endDrag);
		box.addEventListener("pointercancel", endDrag);
	}

	/* ================= 快速选段 UI ================= */

	function renderPresets() {
		var host = $("trPresets");
		host.innerHTML = "";
		PRESETS.forEach(function (p, i) {
			var b = el("button", "preset-btn", p.name);
			b.type = "button";
			b.dataset.preset = String(i);
			b.addEventListener("click", function () {
				setPath(p.path.slice());
			});
			host.appendChild(b);
		});
	}

	function syncPresetPressed() {
		var key = st.path.join(">");
		[].forEach.call($("trPresets").children, function (btn) {
			var p = PRESETS[Number(btn.dataset.preset)];
			btn.setAttribute("aria-pressed", p && p.path.join(">") === key ? "true" : "false");
		});
	}

	/* 起止下拉：起点只列可作起点的节点，终点只列可作终点的节点 */
	function fillPairSelects() {
		var from = $("trFromSelect");
		var to = $("trToSelect");
		from.innerHTML = "";
		to.innerHTML = "";
		CS.NODES.forEach(function (n) {
			if (n.end !== true) {
				var o = document.createElement("option");
				o.value = n.id;
				o.textContent = n.name;
				from.appendChild(o);
			}
			if (n.start !== true) {
				var o2 = document.createElement("option");
				o2.value = n.id;
				o2.textContent = n.name;
				to.appendChild(o2);
			}
		});
	}
	function syncPairSelects() {
		var a = $("trFromSelect");
		var b = $("trToSelect");
		if (st.path.length >= 2) {
			a.value = st.path[0];
			b.value = st.path[st.path.length - 1];
		}
	}

	/* 只改了下拉、还没按「选这一段」时，把提示写在按钮上，别静默 */
	function syncPairPreview() {
		var a = $("trFromSelect").value;
		var b = $("trToSelect").value;
		var btn = $("trApplyPairBtn");
		if (!a || !b || a === b) {
			btn.disabled = true;
			btn.textContent = a === b ? "起止不能相同" : "选这一段";
			return;
		}
		btn.disabled = false;
		btn.textContent = "选这一段";
	}

	/* ================= 路径顺序：一律以你点的顺序为准 =================
	 *
	 * 绝不自动排序。理由就是使用者的原话：OLL 与 PLL 之间没有先后 ——
	 * 先翻棱、再翻角、先控棱位、棱角交叉……这些顺序都是合法的练法，
	 * 图上的「连线」只表示「这两点能连」，不表示「必须按这个方向做」。
	 *
	 * 所以：你点成什么顺序，就是什么顺序。中间插了一个节点，它也**留在你点它的位置**
	 * （= 末尾），想挪到中间就拖胶囊，那是你的决定，不是程序的决定。
	 *
	 * 唯一会拦的情况是**结构上走不通**：比如从 F2L 4 回到十字（得先把做好的槽拆掉），
	 * 或者终点选了个「不能当终点」的节点。这种才提示，且只提示，不改你的选择。 */

	/* ================= 图 / 统计 / 已存路径 ================= */

	function renderGraphLegend() {
		var host = $("trGraphLegend");
		host.innerHTML = "";
		CS.GROUPS.forEach(function (g) {
			var item = el("span", "gpLegendItem");
			var dot = el("span", "gpLegendDot");
			dot.style.background = g.color;
			item.appendChild(dot);
			item.appendChild(el("span", null, g.name));
			host.appendChild(item);
		});
		var tip = el("span", "gpLegendItem");
		tip.appendChild(el("span", null, "· 节点可拖动，布局会记住"));
		host.appendChild(tip);
	}

	function renderSaved() {
		var host = $("trSavedList");
		host.innerHTML = "";
		var list = C.SavedPaths.list();
		$("trSavedMeta").textContent = list.length ? list.length + " 条" : "";
		if (!list.length) {
			host.appendChild(el("div", "gpSavedEmpty", "选好一条路之后点「存为我的路径」，下次直接点回来。"));
			return;
		}
		list.forEach(function (item) {
			var card = el("button", "gpSavedCard");
			card.type = "button";
			var s = C.PathStats.summary(item.nodes);
			card.appendChild(el("span", "gpSavedPath", pathLabel(item.nodes)));
			var stat = "完成 " + s.count + " 次";
			if (s.best) { stat += " · 最佳 " + C.fmt(s.best) + "s"; }
			if (s.ao5) { stat += " · ao5 " + C.fmt(s.ao5) + "s"; }
			card.appendChild(el("span", "gpSavedStat", stat));
			card.addEventListener("click", function () {
				if (item.frame && /^[URFDLB]\|[URFDLB]$/.test(item.frame)) {
					var pr = item.frame.split("|");
					st.frame = { bottom: pr[0], front: pr[1] };
					st.frameAuto = false;
					renderColorRow(); renderFrontRow();
				}
				setPath(item.nodes.slice());
			});
			host.appendChild(card);
		});
	}

	/* ================= 视图切换 ================= */

	function setPath(path) {
		st.path = (path || []).slice();
		if (st.graph) { st.graph.setPath(st.path); }
		syncAll();
	}

	/* 这条路能不能开练：只按每步的**标准定义**检查（CS.validatePath ——
	 * 节点存在、不重复、起点终点合法），**完全不管方向顺序**。
	 *
	 * 用户定的口径：回退也允许，大不了两个节点同时完成、或者那一段本身就
	 * 不成立（比如已经到 F2L4 又选十字，这段一开局就已经满足），都无所谓。
	 * 判定引擎 progressIndex 本身是「按路径顺序依次查节点是否已满足」，
	 * 顺序倒过来只会让某些段变成 0 秒或瞬间完成，不会出错。 */
	function pathUsable(path) {
		return CS.validatePath(path || st.path).ok;
	}

	/* 这里没有选项卡，所以不需要「同步页签状态」。
	 * 只有一件事要跟着走：「开始训练」按钮在路径不可用时变灰。 */
	function syncStartEnabled() {
		var ok = pathUsable();
		var b = $("trStartBtn");
		if (b) { b.disabled = !ok; }
		var s = $("trSavePathBtn");
		if (s) { s.disabled = !ok; }
	}

	/* 选段页所有同步点：路径 UI / 图 / 统计 / 页头说明 */
	function syncAll() {
		updatePathUI();
		renderSaved();
		renderHeadSub();
	}

	function setView(view) {
		if (view === "train") {
			if (!pathUsable()) { return; }
			enterTrain();
			return;
		}
		backHome();
	}

	/* ================= 训练页渲染 ================= */

	function renderTarget() {
		var p = st.puzzle;
		var label = $("trTargetLabel");
		var textEl = $("trTargetText");
		if (!p) {
			textEl.textContent = "";
			label.textContent = "";
			return;
		}
		label.textContent = nodeName(st.path[0]) + " → " + nodeName(st.path[st.path.length - 1]);

		/* 公式按步拆成 span：字号自适应用它数行数，将来逐步高亮也用得上。
		 * 没有打乱公式（起点 = 魔方当前状态）时退回一句话。 */
		textEl.innerHTML = "";
		if (p.scrambleText) {
			p.scrambleText.split(/\s+/).forEach(function (tok) {
				if (!tok) { return; }
				textEl.appendChild(el("span", "scramble-step", tok));
			});
		} else {
			textEl.appendChild(el("span", "target-empty", "起点 = 魔方当前状态，没有打乱公式"));
		}
		$("trTargetNote").textContent = p.note + " · 参考系 " + frameTag();
		/* 公式换了：旧的字号记忆作废，重新量 */
		textEl.dataset.fitKey = "";
		scheduleRefit();
	}

	/* 这个右栏是「这一段」的仪表，不是 Analyzer 的实时四宫格 ——
	 * 它要回答：我走到哪了、下一个目标是什么、这条路的最好成绩是多少。 */
	function renderSegSummary() {
		var t = st.timer;
		if (!t) { return; }
		var path = t.path();
		var idx = CS.progressIndex(path, t.state.curFacelet, t.frame());
		var done = Math.max(0, Math.min(idx, path.length) - 1);
		var total = Math.max(0, path.length - 1);

		$("trSegSummary").textContent = total ? (done + "/" + total + " 段") : "";

		/* 下一个目标：走到哪一步是眼下要打的那个点 */
		var nextEl = $("trNextTarget");
		if (idx < path.length) {
			nextEl.textContent = nodeName(path[idx]);
		} else {
			nextEl.textContent = "已到终点";
		}

		/* 进度点：一段一颗，完成亮、当前粗、未到灰 */
		var box = $("trNowProgress");
		box.innerHTML = "";
		for (var i = 1; i <= total; i++) {
			var dot = el("span", "now-dot");
			dot.dataset.state = i <= done ? "done" : (i === done + 1 ? "current" : "");
			dot.title = nodeName(path[i - 1]) + " → " + nodeName(path[i]);
			box.appendChild(dot);
		}

		var s = C.PathStats.summary(st.path);
		$("trLiveBest").textContent = s.best ? C.fmt(s.best) : "—";
	}

	function renderChips() {
		var s = C.PathStats.summary(st.path);
		$("trHistoryMeta").textContent = s.count ? (s.count + " 次 · 最佳 " + (s.best ? C.fmt(s.best) + "s" : "--") +
			" · ao5 " + (s.ao5 ? C.fmt(s.ao5) + "s" : "--")) : "还没有成绩";
	}

	function relTime(at) {
		var d = Date.now() - (at || 0);
		if (d < 60e3) { return "刚刚"; }
		if (d < 3600e3) { return Math.floor(d / 60e3) + " 分钟前"; }
		if (d < 86400e3) { return Math.floor(d / 3600e3) + " 小时前"; }
		return Math.floor(d / 86400e3) + " 天前";
	}

	function renderHistory() {
		var list = $("trHistList");
		var s = C.PathStats.summary(st.path);
		list.innerHTML = "";
		if (!s.recent.length) {
			list.appendChild(el("div", "score-empty", "还没有成绩。完成第一次训练后这里会显示最近记录。"));
			return;
		}
		var n = Math.min(20, s.recent.length);
		for (var i = 0; i < n; i++) {
			var r = s.recent[i];
			var row = el("div", "score-row");
			row.appendChild(el("span", "score-idx", "#" + (s.count - i)));
			var time = el("span", "score-time", r.dnf ? "DNF" : C.fmt(r.t));
			if (r.dnf) { time.dataset.dnf = "1"; }
			row.appendChild(time);
			var segText = "";
			if (r.seg && r.seg.length) {
				segText = r.seg.map(function (v) { return v == null ? "—" : C.fmt(v); }).join(" / ");
			}
			row.appendChild(el("span", "score-segs", segText || (r.steps || 0) + " 步"));
			row.appendChild(el("span", "score-when", relTime(r.at)));
			list.appendChild(row);
		}
	}

	function renderResult() {
		var bar = $("trResult");
		var r = st.result;
		if (!r) { bar.hidden = true; bar.innerHTML = ""; return; }
		bar.hidden = false;
		bar.innerHTML = "";

		var head = el("div", "result-main");
		var main = el("span", "result-time", r.dnf ? "DNF" : C.fmt(r.t));
		if (r.dnf) { main.dataset.dnf = "1"; }
		head.appendChild(main);
		head.appendChild(el("span", "result-meta", (r.turns || 0) + " 步" + (r.tps ? " · " + r.tps.toFixed(2) + " tps" : "")));
		head.appendChild(el("span", "result-meta", r.how === "auto" ? "魔方自动停表" : "手动停表"));
		if (r.dnf) { head.appendChild(el("span", "result-meta", r.dnfReason || "未达终点")); }
		head.appendChild(el("span", "result-note", pathLabel()));
		bar.appendChild(head);

		if (r.seg && r.seg.length) {
			var splits = el("div", "result-splits");
			var acc = 0;
			st.path.forEach(function (id, i) {
				if (i === 0) { return; }
				var segT = r.seg[i - 1];
				if (segT == null) { return; }
				acc += segT;
				var box = el("div", "result-split");
				box.appendChild(el("div", "result-split-label", nodeName(st.path[i - 1]) + " → " + nodeName(id)));
				box.appendChild(el("div", "result-split-value", C.fmt(segT) + "s"));
				box.appendChild(el("div", "result-split-acc", "累计 " + C.fmt(acc) + "s"));
				splits.appendChild(box);
			});
			if (splits.children.length) { bar.appendChild(splits); }
		}
	}

	function renderLive() {
		var t = st.timer;
		if (!t) { return; }
		$("trLiveTurns").textContent = String(t.state.live.turns);
		$("trLiveTps").textContent = t.state.live.tps ? t.state.live.tps.toFixed(2) : "—";
		renderSegSummary();
	}

	function syncTrainButtons() {
		var t = st.timer;
		if (!t) { return; }
		var phase = t.state.phase;
		var running = phase === "running";
		var manual = running && t.state.timingMode === "manual";
		$("trRunBtn").disabled = running;
		$("trStopBtn").disabled = !manual;
		$("trNewBtn").disabled = running;
		$("trResetBtn").disabled = phase === "ready";
		$("trRunBtn").textContent = (phase === "ready") ? "开始" : "再来一次";
		$("trTimerStage").dataset.state = phase;
	}

	/* ================= 打乱公式 / 计时数字的字号 =================
	 *
	 * 页面改成「按内容自然排布 + 需要时整页滚动」之后，字号不再需要
	 * 依赖卡片固定高度去二分探测（那套逻辑会在窗口变化时算错、把内容裁掉）。
	 *
	 * 现在字号只由**宽度**决定，用 clamp 交给 CSS 的稳定规则：
	 *   · 计时数字：随卡片宽度缩放，有上下限，永远明显大于公式；
	 *   · 打乱公式：同样随宽度缩放，最多三行（超长就内部滚）。
	 * 不读布局、不回写、不循环 —— 同样宽度必得同样字号，绝不「乱跳」。
	 */
	var FIT = {
		TIMER_FONT_MIN: 44,
		TIMER_FONT_MAX: 150,
		SCRAMBLE_FONT_MIN: 15,
		SCRAMBLE_FONT_MAX: 42,
		SCRAMBLE_MAX_LINES: 3,
		SCRAMBLE_LH: 1.22
	};

	/* 按可用宽度算一个稳定字号（线性插值，无测量） */
	function fontForWidth(w, min, max, perChar) {
		if (!w || w <= 0) { return min; }
		return Math.max(min, Math.min(max, Math.round(w / perChar)));
	}

	/* 一次性定字号：完全由宽度决定，不涉及任何高度测量 */
	function refitTimerCard() {
		if (st.view !== "train") { return; }
		var card = document.querySelector(".timer-card");
		var val = $("trTimer");
		var el = $("trTargetText");
		if (!card || !val || !el) { return; }
		var w = cardInnerWidth(card);
		if (w <= 0) { return; }

		/* 计时数字：卡片越宽字越大；宽度 ÷ 14 ≈ 六位数字恰好占满 */
		var timerPx = fontForWidth(w, FIT.TIMER_FONT_MIN, FIT.TIMER_FONT_MAX, 14);
		/* 公式：比数字明显小，宽度 ÷ 26 */
		var scramblePx = fontForWidth(w, FIT.SCRAMBLE_FONT_MIN, FIT.SCRAMBLE_FONT_MAX, 26);
		if (timerPx < scramblePx * 2) { scramblePx = Math.max(FIT.SCRAMBLE_FONT_MIN, Math.floor(timerPx / 2)); }

		val.style.fontSize = timerPx + "px";
		el.style.fontSize = scramblePx + "px";
		el.style.lineHeight = FIT.SCRAMBLE_LH;
		/* 公式最多三行：超出就在框内滚，不裁切半行 */
		el.style.maxHeight = Math.round(scramblePx * FIT.SCRAMBLE_LH * FIT.SCRAMBLE_MAX_LINES) + "px";
		el.style.overflowY = "auto";
		el.style.overflowX = "hidden";
	}

	var refitRaf = 0;
	function scheduleRefit() {
		if (refitRaf) { cancelAnimationFrame(refitRaf); }
		refitRaf = requestAnimationFrame(function () {
			refitRaf = 0;
			refitTimerCard();
		});
	}

	/* ================= 成绩落库 ================= */

	function onFinish(r) {
		C.PathStats.record(st.path, {
			t: r.t,
			dnf: r.dnf,
			steps: r.turns,
			seg: r.segTimes,
			frame: st.frame.bottom + "|" + st.frame.front
		});
		st.result = {
			t: r.t, dnf: r.dnf, dnfReason: r.dnfReason, how: r.how,
			turns: r.turns, tps: r.tps, seg: r.segTimes
		};
		renderResult();
		renderChips();
		renderHistory();
		renderLive();
		renderSegSummary();
		syncTrainButtons();
	}

	/* ================= 蓝牙 ================= */

	function setDeviceUI() {
		var bt = window.CubeTimer.bluetooth;
		var connected = bt.isConnected();
		st.connected = connected;
		var btn = $("trConnectBtn");
		var label = $("trConnectLabel");
		var name = connected ? bt.deviceName() : "";
		if (connected) {
			btn.classList.add("connected");
			label.textContent = name;
			btn.title = name + " · 已连接，直接拧起表、到终点自动停表";
		} else {
			btn.classList.remove("connected");
			label.textContent = "连接魔方";
			btn.title = "连接智能魔方；不连也能手动计时，或在下面直接打算法";
		}
		/* 设备状态原来挂在顶栏工具条上，现在工具条没了：
		 * 连接状态归按钮自己（圆点 + 文字 + title），
		 * 「等待训练 / 设备名」归训练页右栏的「这一段」卡。 */
		var dev = $("trLiveDevice");
		if (dev) { dev.textContent = connected ? name : "未连接 · 手动计时"; }
		if (st.timer) { renderLive(); syncTrainButtons(); }
		syncConnectAvailability();
	}

	function syncConnectAvailability() {
		var bt = window.CubeTimer.bluetooth;
		var btn = $("trConnectBtn");
		if (!bt.isSupported()) {
			btn.disabled = true;
			btn.title = "当前浏览器不支持 Web Bluetooth，请用 Chrome / Edge 并通过 HTTPS 打开";
			return;
		}
		btn.disabled = false;
		btn.title = "";
	}

	function bindBluetooth() {
		var bt = window.CubeTimer.bluetooth;
		bt.on("connecting", function () {
			$("trConnectLabel").textContent = "选择设备…";
			$("trConnectBtn").classList.remove("connected");
		});
		bt.on("connect", function () { setDeviceUI(); });
		bt.on("disconnect", function () {
			setDeviceUI();
			if (st.timer) {
				st.timer.reset(st.timer.state.curFacelet);
				syncTrainButtons();
			}
		});
		bt.on("state", function (d) {
			if (!st.timer || st.view !== "train") { return; }
			st.timer.setState(d.facelet);
		});
		bt.on("move", function (d) {
			if (!st.timer || st.view !== "train") { return; }
			var t = st.timer;
			/* 尚未起表：直接拧 = 魔方起表（只认面转，整体翻转不算开始） */
			if (t.state.phase === "ready") {
				if (d.isRotation) { return; }
				t.start("state");
			}
			t.setState(d.facelet || t.state.curFacelet, true, d.move);
			renderLive();
			syncTrainButtons();
		});
		/* 空闲时预加载适配层：首次点「连接魔方」不必等一串脚本 */
		if (bt.preload) { bt.preload(); }
	}

	function toggleConnect() {
		var bt = window.CubeTimer.bluetooth;
		var btn = $("trConnectBtn");
		var label = $("trConnectLabel");
		btn.disabled = true;
		function done() {
			btn.disabled = false;
			setDeviceUI();
		}
		if (bt.isConnected()) {
			bt.disconnect().then(done, done);
			return;
		}
		/* 连接过程的状态就地写在按钮上（工具条已经没有了，不再有单独的状态位） */
		label.textContent = "选择设备…";
		btn.title = "正在选择设备…";
		bt.connect().then(done, function (e) {
			var msg = (e && e.message) || "连接失败";
			/* 用户自己取消不算错误，别把红字挂在那里 */
			label.textContent = /取消/.test(msg) ? "连接魔方" : "连接魔方";
			btn.title = msg;
			done();
		});
	}

	/* ================= 算法输入（无蓝牙时的驱动方式） =================
	 * 口径：输入框里的内容 = 「本次训练已经做的全部动作」，从本题起点算起。
	 * 所以每次都从 baseFacelet 重放整串，而不是往后追加 —— 这样用户边打字边改
	 * （退格、改一个字母）魔方与判定都跟着回到正确位置。
	 * 分段也按重放过程逐步判定，保证中途节点的时间点有真实落点。 */
	function applyInput(showHint) {
		var t = st.timer;
		if (!t || !st.puzzle) { return 0; }
		var input = $("trAlgInput");
		var text = String(input.value || "");
		var hint = $("trInputHint");

		if (!text.trim()) {
			t.setState(st.puzzle.baseFacelet);
			if (showHint) { hint.dataset.kind = ""; hint.textContent = ""; }
			renderLive();
			return 0;
		}
		var toks = F.parseAlg(text);
		if (!toks) {
			/* 整串解析失败：退到最长可解析前缀，让用户边打字边看魔方 */
			var parts = text.trim().split(/[\s,]+/);
			for (var k = parts.length - 1; k >= 1; k--) {
				var t2 = F.parseAlg(parts.slice(0, k).join(" "));
				if (t2) { toks = t2; break; }
			}
		}
		if (!toks) {
			if (showHint) {
				hint.dataset.kind = "err";
				hint.textContent = "无法识别：支持 URFDLB（小写=双层）/ MES / xyz，可带 2 或 '";
			}
			return 0;
		}

		/* 回到本题起点，逐步重放整串 —— 每步都喂给计时台，
		 * 中途节点的分段才拿得到真实时间点。 */
		t.setState(st.puzzle.baseFacelet);
		t.state.live = { turns: 0, tps: 0, moves: [] };
		var fl = st.puzzle.baseFacelet;
		for (var i = 0; i < toks.length; i++) {
			var next = F.applyToFacelet(fl, [toks[i]]);
			if (!next) { break; }
			fl = next;
			if (t.state.phase === "ready") { t.start("manual"); }
			t.setState(fl, true, toks[i]);
			if (t.state.phase !== "running") { break; }   /* 已判定结束 */
		}
		renderLive();
		syncTrainButtons();
		if (showHint) {
			hint.dataset.kind = "ok";
			hint.textContent = "已应用 " + toks.length + " 步";
		}
		return toks.length;
	}

	/* ================= 进入 / 退出训练 ================= */

	function enterTrain() {
		if (!pathUsable()) { return; }
		st.view = "train";
		$("trPick").classList.remove("active");
		$("trTrain").classList.add("active");

		/* 先出题（可能触发底色自动识别、改掉 st.frame），再建/更新计时台，
		 * 避免「参考系标签」与「本题信息」两处不一致。 */
		newPuzzle();

		if (st.timer) {
			st.timer.setPath(st.path);
			st.timer.setFrame(st.frame);
		} else {
			st.timer = window.CubeTimer.create({
				mount: {
					timer: "trTimer", timerBox: "trTimerStage", phase: "trTimerStatus",
					stageBar: "trStageBar", liveTurns: "trLiveTurns", liveTps: "trLiveTps",
					moves: "trMoves", net: "trNet"
				},
				path: st.path,
				frame: st.frame,
				startFacelet: st.puzzle.baseFacelet,
				onFinish: onFinish
			});
		}
		st.timer.setPath(st.path);
		st.timer.setFrame(st.frame);
		st.timer.reset(st.puzzle.baseFacelet);
		st.timer.setState(st.puzzle.baseFacelet);

		$("trAlgInput").value = "";
		$("trInputHint").textContent = "";
		st.result = null;
		renderTarget();
		renderResult();
		renderChips();
		renderHistory();
		renderLive();
		renderSegSummary();
		syncTrainButtons();
		syncStartEnabled();
		renderHeadSub();
		setDeviceUI();
		/* 面板刚显示出来，尺寸这帧还没落定：等一帧再量字号 */
		scheduleRefit();
	}

	function backHome() {
		st.view = "pick";
		$("trTrain").classList.remove("active");
		$("trPick").classList.add("active");
		if (st.timer) { st.timer.reset(st.puzzle ? st.puzzle.baseFacelet : F.SOLVED); }
		st.result = null;
		renderResult();
		syncAll();
		syncStartEnabled();
	}

	/* ================= 说明 ================= */

	function openHelp() {
		var mount = $("trHelpMount");
		mount.innerHTML = "";
		var mask = el("div", "help-mask");
		var box = el("div", "help-box");
		box.appendChild(el("div", "help-title", "分段训练怎么用"));
		var body = el("div", "help-body");
		body.innerHTML =
			"<h3>它练的是什么</h3>" +
			"<p>整段复原里取一段来练。选段页上有两条路：上面的<b>快速选段</b>一点即选，" +
			"下面的<b>节点图</b>点两个节点就能连成任意一条路 —— 十七个节点都在，"
			 + "中间点几下就多几段。</p>" +
			"<h3>怎么选一条路</h3>" +
			"<p>在节点图上点第一个节点 = 起点，点第二个 = 终点；之后再点别的节点会作为<b>中间分段</b>" +
			"插进这条路，内部按节点再分几段计时。点已选中的节点可取消，" +
			"拖动下方胶囊可改顺序。</p>" +
			"<h3>起停口径</h3>" +
			"<p>· <b>直接开拧</b>（连着魔方）：拧到终点节点，状态识别<b>自动停表</b>。<br>" +
			"· <b>手动起表</b>（<kbd>Space</kbd> 或「开始」）：即使连着蓝牙也<b>必须手动停表</b>，" +
			"停表后校验状态，没到终点判 DNF。<br>" +
			"· 没有魔方也能练：在输入框里打算法，回车即按步重放并判定。</p>" +
			"<h3>六色底</h3>" +
			"<p>「新打乱」时自动挑最该用的底色（枚举 24 种参考系，选离目标最近的）；" +
			"其它情况在选段页自己点底色与前面。所有判定都按你选的参考系算，与拿魔方的方向无关。</p>" +
			"<h3>数据</h3>" +
			"<p>成绩按「这条路」分开存，含每段用时；只存在本浏览器，不上传。</p>";
		box.appendChild(body);
		var foot = el("div", "help-foot");
		var close = el("button", "btn btn-primary", "知道了");
		close.type = "button";
		close.addEventListener("click", closeHelp);
		foot.appendChild(close);
		box.appendChild(foot);
		mask.addEventListener("click", closeHelp);
		mount.appendChild(mask);
		mount.appendChild(box);
	}
	function closeHelp() { $("trHelpMount").innerHTML = ""; }

	/* ================= 主题 ================= */

	function applyTheme(theme) {
		theme = theme === "dark" ? "dark" : "light";
		document.documentElement.dataset.theme = theme;
		var btn = document.getElementById("siteThemeToggle");
		if (btn) { btn.textContent = theme === "dark" ? "\u2600" : "\u263E"; }
		try { localStorage.setItem("smartCubeTheme", theme); } catch (e) {}
	}

	/* ================= 绑定 ================= */

	function bind() {
		$("trHelpBtn").addEventListener("click", openHelp);
		$("trBackBtn").addEventListener("click", backHome);
		$("trStartBtn").addEventListener("click", function () { setView("train"); });
		$("trClearPathBtn").addEventListener("click", function () { setPath([]); });
		$("trSavePathBtn").addEventListener("click", function () {
			if (!pathUsable()) { return; }
			C.SavedPaths.add(st.path, st.frame.bottom + "|" + st.frame.front);
			renderSaved();
		});
		$("trGraphReset").addEventListener("click", function () {
			if (st.graph) { st.graph.resetLayout(); }
		});

		/* 没有选项卡：选好一段点「开始训练」进来，训练页点「← 换一段」回去。
		 * 这两个按钮在 bind() 一开头就绑好了，这里不再需要页签监听。 */

		/* 快速选段的起止下拉 */
		$("trApplyPairBtn").addEventListener("click", function () {
			var a = $("trFromSelect").value;
			var b = $("trToSelect").value;
			if (a === b) { return; }
			/* 一律照你说的连，不做任何「智能重排」。
			 * 真走不通时下方提示会给一句人话，按钮也会自己变灰。 */
			setPath([a, b]);
		});

		/* 换起点/终点时把路径尾部跟着变，省得每次都要再点一下按钮 */
		$("trFromSelect").addEventListener("change", syncPairPreview);
		$("trToSelect").addEventListener("change", syncPairPreview);

		bindChipDrag();

		/* 起点来源 */
		$("trOriginRow").addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("[data-origin]") : null;
			if (!b) { return; }
			st.origin = b.dataset.origin;
			[].forEach.call($("trOriginRow").children, function (btn) {
				btn.setAttribute("aria-pressed", btn === b ? "true" : "false");
			});
			st.frameAuto = (st.origin === "scramble");
			renderColorRow();
			renderFrontRow();
			$("trFrameAuto").textContent = st.frameAuto ? "自动识别底色" : "手动指定";
			syncAll();
		});

		/* 训练页控制 */
		$("trConnectBtn").addEventListener("click", toggleConnect);
		$("trRunBtn").addEventListener("click", function () {
			var t = st.timer;
			if (!t || !st.puzzle) { return; }
			if (t.state.phase === "ready") {
				t.start("manual");
			} else {
				t.reset(st.puzzle.baseFacelet);
				t.setState(st.puzzle.baseFacelet);
				t.start("manual");
			}
			syncTrainButtons();
		});
		$("trStopBtn").addEventListener("click", function () {
			if (st.timer) { st.timer.stopManual(); }
			syncTrainButtons();
		});
		$("trNewBtn").addEventListener("click", function () {
			newPuzzle();
			st.timer.setFrame(st.frame);
			st.timer.reset(st.puzzle.baseFacelet);
			st.timer.setState(st.puzzle.baseFacelet);
			$("trAlgInput").value = "";
			$("trInputHint").textContent = "";
			st.result = null;
			renderTarget(); renderResult(); renderLive(); renderSegSummary(); syncTrainButtons();
		});
		$("trResetBtn").addEventListener("click", function () {
			st.timer.reset(st.puzzle.baseFacelet);
			st.timer.setState(st.puzzle.baseFacelet);
			$("trAlgInput").value = "";
			$("trInputHint").textContent = "";
			st.result = null;
			renderResult(); renderLive(); renderSegSummary(); syncTrainButtons();
		});
		$("trApplyBtn").addEventListener("click", function () { applyInput(true); });
		$("trAlgInput").addEventListener("keydown", function (e) {
			if (e.key === "Enter") { e.preventDefault(); applyInput(true); }
		});

		/* 窗口变了就重量一次字号（防抖到下一帧，避免 resize 期间狂算） */
		window.addEventListener("resize", function () {
			var el = $("trTargetText");
			if (el) { el.dataset.fitKey = ""; }
			var tv = $("trTimer");
			if (tv) { tv.dataset.fitKey = ""; }
			scheduleRefit();
		});

		/* 空格：起停（手动计时） */
		document.addEventListener("keydown", function (e) {
			if (e.code !== "Space" || e.repeat) { return; }
			if (st.view !== "train") { return; }
			if (/INPUT|TEXTAREA|SELECT|BUTTON/.test((document.activeElement && document.activeElement.tagName) || "")) { return; }
			e.preventDefault();
			var t = st.timer;
			if (!t) { return; }
			if (t.state.phase === "running") {
				if (t.state.timingMode === "manual") { t.stopManual(); }
			} else {
				t.start("manual");
			}
			syncTrainButtons();
		});
	}

	/* ================= 启动 ================= */

	function boot() {
		bindBluetooth();
		bind();

		/* 选段页内容 */
		renderPresets();
		renderGraphLegend();
		renderColorRow();
		renderFrontRow();
		fillPairSelects();
		syncPairPreview();

		if (!st.graph && window.CubeStageGraph) {
			st.graph = window.CubeStageGraph.create($("trGraph"), {
				onChange: function (path) {
					/* 原样接受点击顺序。这里**一个字都不改** —— 顺序是你的事。 */
					st.path = path;
					syncAll();
				}
			});
		}
		if (st.graph) { st.graph.setPath(st.path); }
		if (st.frameAuto) { $("trFrameAuto").textContent = "自动识别底色"; }

		/* 顶栏与「我的路径」等汇总 */
		syncAll();
		syncStartEnabled();
		setDeviceUI();
		renderResult();

		if (window.siteNav && typeof window.siteNav.init === "function") {
			window.siteNav.init({ setTheme: applyTheme });
		}
	}

	/* ================= 布局自检（挂到 window 供回归用） =================
	 * 在 DevTools 控制台执行 window.__trainerAudit()，返回当前尺寸下
	 * 训练页关键元素是否完整可见（没被裁切/覆盖/跑出视口）。
	 * 这是「某个窗口尺寸下东西只看得到一半」那个 bug 的回归检查。 */
	window.__trainerAudit = function () {
		var ids = ["trTargetText", "trTargetNote", "trTimer", "trTimerStatus",
			"trRunBtn", "trStopBtn", "trNewBtn", "trResetBtn",
			"trAlgInput", "trApplyBtn", "trNextTarget"];
		var vw = window.innerWidth, vh = window.innerHeight;
		var problems = [];
		ids.forEach(function (id) {
			var e = $(id);
			if (!e) { problems.push(id + ":缺失"); return; }
			var r = e.getBoundingClientRect();
			var cs = getComputedStyle(e);
			if (cs.display === "none" || cs.visibility === "hidden") { return; }
			if (r.width === 0 || r.height === 0) { problems.push(id + ":零尺寸"); return; }
			var p = e.parentElement, clipped = false;
			while (p && p !== document.body) {
				var pcs = getComputedStyle(p), pr = p.getBoundingClientRect();
				if ((pcs.overflowY === "hidden" || pcs.overflowY === "clip") &&
					(r.bottom > pr.bottom + 1 || r.top < pr.top - 1)) { clipped = true; break; }
				if ((pcs.overflowX === "hidden" || pcs.overflowX === "clip") &&
					(r.right > pr.right + 1 || r.left < pr.left - 1)) { clipped = true; break; }
				p = p.parentElement;
			}
			if (clipped) { problems.push(id + ":被裁切"); return; }
			/* 「出视口」在整页可滚模式下不算错 —— 元素在文档流里正常排布，
			 * 滚一下就能看到。只检查横向（横向不该溢出）与负坐标（跑到页面上方）。 */
			if (r.left < -1 || r.right > vw + 1 || r.top < -1) {
				problems.push(id + ":横向溢出");
			}
		});
		/* 按钮行不能被输入框盖住 */
		var ab = document.querySelector(".timer-actions");
		var ir = document.querySelector(".input-row");
		if (ab && ir && ab.getBoundingClientRect().bottom > ir.getBoundingClientRect().top + 1) {
			problems.push("按钮与输入框重叠");
		}
		return { size: vw + "x" + vh, ok: problems.length === 0, problems: problems };
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();