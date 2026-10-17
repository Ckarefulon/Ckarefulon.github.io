/*
 * Trainer 训练场（页面主逻辑）
 * ---------------------------------------------------------------------------
 * 训练场的本质：在整个复原过程中「取一段」来练。
 *
 *   1. 首页是一张节点图（点 = 复原中可打点的层级），用户点两个节点连成一条路。
 *      节点不按解法流派分组路线 —— CFOP、Roux、以及各种自创顺序都能连出来。
 *      中间节点会被当成内部再分段点，将来与 Analyzer 融合时用得上。
 *   2. 打乱之后，魔方当前状态的层级就是这条路「起点节点」的判定基准；
 *      用户拧到「终点节点」的条件满足就结束计时 —— 计时只覆盖选中的这一段。
 *   3. 起停口径：直接开拧（魔方起表）→ 魔方状态到终点自动停；
 *      手动起表（空格/按钮）→ 必须手动停表，停表后校验，没到终点判 DNF。
 *   4. 六色底：完整打乱态自动识别底色；其它情况由用户在首页选择。
 *
 * 依赖：TrainerCommon / CubeStages / CubeStageGraph / CubeTimer / CubeNet /
 *       QR_CASES / mathlib / FormulaCore（index.html 保证顺序）。
 */
(function () {
	'use strict';

	var C = window.TrainerCommon;
	var CS = window.CubeStages;
	var F = C && C.FaceletUtil;

	if (!C || !CS || !F || !window.mathlib || !window.CubeNet || !window.CubeTimer || !window.FormulaCore) {
		return;
	}

	function $(id) { return document.getElementById(id); }
	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) { e.className = cls; }
		if (text != null) { e.textContent = text; }
		return e;
	}
	function esc(s) {
		return String(s).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}

	/* ================= 状态 ================= */

	var st = {
		view: "home",                 /* home | train */
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
		{ name: "十字",       path: ["scramble", "cross"] },
		{ name: "全部 F2L",   path: ["scramble", "cross", "f2l4"] },
		{ name: "只练 OLL",   path: ["scramble", "f2l4", "oll"] },
		{ name: "只练 PLL",   path: ["scramble", "f2l4", "oll", "pll"] },
		{ name: "十字+F2L+OLL", path: ["scramble", "cross", "f2l4", "oll"] },
		{ name: "完整 CFOP",  path: ["scramble", "cross", "f2l1", "f2l2", "f2l3", "f2l4", "oll", "pll"] },
		{ name: "先翻棱再翻角", path: ["scramble", "f2l4", "ollEdge", "ollCorner", "oll"] },
		{ name: "先翻角再翻棱", path: ["scramble", "f2l4", "ollCorner", "oll"] },
		{ name: "先控棱位再翻角", path: ["scramble", "f2l4", "pllEdge", "oll"] },
		{ name: "棱/角交叉四步", path: ["scramble", "f2l4", "pllEdge", "ollCorner", "pllCorner", "ollEdge"] },
		{ name: "CB 控棱（F3 直入）", path: ["scramble", "cross", "f2l3", "ollEdge", "oll", "pll"] },
		{ name: "右桥",       path: ["scramble", "fb", "sb"] },
		{ name: "CMLL+LSE",   path: ["scramble", "sb", "cmll", "lse"] },
		{ name: "完整 Roux",  path: ["scramble", "fb", "sb", "cmll", "lse"] }
	];

	/* ================= 底色 ================= */

	var COLOR_OF = { U: "#f5f5f5", R: "#c62828", F: "#2e9e4b", D: "#f5c518", L: "#ef6c1a", B: "#1565c0" };
	var COLOR_NAME = { U: "白", R: "红", F: "绿", D: "黄", L: "橙", B: "蓝" };
	/* 前面按底面顺时针邻接顺序给：底面的邻面（不含对面） */
	function frontOptions(bottom) {
		var opp = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" }[bottom];
		return CS.FACES.filter(function (f) { return f !== bottom && f !== opp; });
	}

	function renderColorRow() {
		var row = $("trColorRow");
		row.innerHTML = "";
		CS.FACES.forEach(function (face) {
			var b = el("button", "trColorBtn");
			b.type = "button";
			b.dataset.face = face;
			b.title = COLOR_NAME[face] + "底";
			b.setAttribute("aria-pressed", st.frame.bottom === face ? "true" : "false");
			b.style.setProperty("--swatch", COLOR_OF[face]);
			b.appendChild(el("span", "trColorSwatch"));
			b.appendChild(el("span", "trColorLabel", COLOR_NAME[face]));
			b.addEventListener("click", function () {
				st.frameAuto = false;
				st.frame.bottom = face;
				if (st.frame.front === face || st.frame.front === ({ U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" }[face])) {
					st.frame.front = frontOptions(face)[0];
				}
				renderColorRow();
				renderFrontRow();
				updatePathUI();
			});
			row.appendChild(b);
		});
	}

	/* 前面选择：底面定了之后，前面只需要在 4 个邻面里选 */
	function renderFrontRow() {
		var host = $("trFrontRow");
		if (!host) { return; }
		host.innerHTML = "";
		frontOptions(st.frame.bottom).forEach(function (face) {
			var b = el("button", "trColorBtn sm");
			b.type = "button";
			b.dataset.face = face;
			b.setAttribute("aria-pressed", st.frame.front === face ? "true" : "false");
			b.style.setProperty("--swatch", COLOR_OF[face]);
			b.title = COLOR_NAME[face] + "朝前";
			b.appendChild(el("span", "trColorSwatch"));
			b.appendChild(el("span", "trColorLabel", COLOR_NAME[face]));
			b.addEventListener("click", function () {
				st.frameAuto = false;
				st.frame.front = face;
				renderFrontRow();
				updatePathUI();
			});
			host.appendChild(b);
		});
	}

	/* 自动识别底色：只有在「新打乱」的完整打乱态下才有意义 */
	function autoDetectFrame(facelet) {
		var best = CS.bestFrame(facelet);
		st.frame = { bottom: best.frame.bottom, front: best.frame.front };
		st.frameAuto = true;
		/* 同时选一个朝向：识别出来的 frame 本身已经定了前面 */
		renderColorRow();
		renderFrontRow();
		return best;
	}

	/* ================= 出题 ================= */

	function scrambleFacelet(len) {
		var sc = C.Scramble.randomRange(len || 20, (len || 20) + 5);
		return { moves: sc, text: sc.join(" "), facelet: F.applyToFacelet(F.SOLVED, sc) };
	}

	/* 造一道题：起点状态 + 打乱文本 */
	function newPuzzle() {
		var p;
		if (st.origin === "current" && st.connected && window.CubeTimer.bluetooth.facelet()) {
			var fl = window.CubeTimer.bluetooth.facelet();
			p = {
				baseFacelet: fl,
				scrambleText: "",
				note: "起点 = 蓝牙魔方的当前状态"
			};
			/* 用当前状态定底色 */
			var best = CS.bestFrame(fl);
			if (st.frameAuto) { st.frame = { bottom: best.frame.bottom, front: best.frame.front }; renderColorRow(); renderFrontRow(); }
		} else {
			var sc = scrambleFacelet(20);
			p = {
				baseFacelet: sc.facelet,
				scrambleText: sc.text,
				note: "打乱态已直接显示在左侧魔方上"
			};
			if (st.frameAuto) { autoDetectFrame(sc.facelet); }
		}
		st.puzzle = p;
		st.result = null;
		return p;
	}

	/* ================= 路径 UI ================= */

	function nodeName(id) {
		var n = CS.nodeById(id);
		return n ? n.name : id;
	}

	function updatePathUI() {
		var box = $("trPathBox");
		var hint = $("trPathHint");
		box.innerHTML = "";

		if (!st.path.length) {
			box.appendChild(el("span", "gpPathEmpty", "还没有选择。在图上点起点，再点终点。"));
		} else {
			st.path.forEach(function (id, i) {
				if (i > 0) { box.appendChild(el("span", "gpArrow", "\u2192")); }
				var chip = el("span", "gpChip");
				chip.dataset.role = (i === 0 || i === st.path.length - 1) ? "end" : "mid";
				var ord = el("span", "gpChipOrder", String(i + 1));
				chip.appendChild(ord);
				chip.appendChild(el("span", null, nodeName(id)));
				var x = el("button", "gpChipX", "\u00d7");
				x.type = "button";
				x.title = "从这条路里去掉";
				x.addEventListener("click", function () {
					var at = st.path.indexOf(id);
					if (at >= 0) { st.path.splice(at, 1); }
					if (st.graph) { st.graph.setPath(st.path); }
					updatePathUI();
				});
				chip.appendChild(x);
				box.appendChild(chip);
			});
		}

		var v = CS.validatePath(st.path);
		var segCount = st.path.length >= 2 ? st.path.length - 1 : 0;
		if (!st.path.length) {
			hint.textContent = "先点一个节点当起点，再点一个当终点。";
			hint.dataset.kind = "";
		} else if (!v.ok) {
			hint.textContent = v.reason;
			hint.dataset.kind = "err";
		} else {
			hint.textContent = "共 " + segCount + " 段" + (segCount > 1 ? "（中间节点会自动分段计时）" : "") +
				" · 计时范围：" + nodeName(st.path[0]) + " → " + nodeName(st.path[st.path.length - 1]);
			hint.dataset.kind = "ok";
		}

		$("trStartBtn").disabled = !v.ok;
		$("trSavePathBtn").disabled = !v.ok;
	}

	function renderPresets() {
		var host = $("trPresets");
		host.innerHTML = "";
		PRESETS.forEach(function (p) {
			var b = el("button", "gpPresetBtn", p.name);
			b.type = "button";
			b.addEventListener("click", function () {
				st.path = p.path.slice();
				if (st.graph) { st.graph.setPath(st.path); }
				updatePathUI();
			});
			host.appendChild(b);
		});
	}

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
		if (!list.length) {
			host.appendChild(el("div", "gpSavedEmpty", "还没有保存的路径。选好一条路之后点「存为我的路径」。"));
			return;
		}
		list.forEach(function (item) {
			var card = el("button", "gpSavedCard");
			card.type = "button";
			var s = C.PathStats.summary(item.nodes);
			card.appendChild(el("span", "gpSavedPath", item.nodes.map(nodeName).join(" \u2192 ")));
			var stat = "完成 " + s.count + " 次";
			if (s.best) { stat += " · 最佳 " + C.fmt(s.best) + "s"; }
			if (s.ao5) { stat += " · ao5 " + C.fmt(s.ao5) + "s"; }
			card.appendChild(el("span", "gpSavedStat", stat));
			if (item.frame) {
				card.appendChild(el("span", "gpSavedStat", "底色 " + item.frame));
			}
			card.addEventListener("click", function () {
				st.path = item.nodes.slice();
				if (item.frame && /^[URFDLB]\|[URFDLB]$/.test(item.frame)) {
					var pr = item.frame.split("|");
					st.frame = { bottom: pr[0], front: pr[1] };
					st.frameAuto = false;
					renderColorRow(); renderFrontRow();
				}
				if (st.graph) { st.graph.setPath(st.path); }
				updatePathUI();
			});
			host.appendChild(card);
		});
	}

	function renderStatsStrip() {
		var strip = $("trStatsStrip");
		strip.innerHTML = "";
		var paths = C.PathStats.list();
		var totalRuns = 0, done = 0;
		paths.forEach(function (p) {
			totalRuns += p.count;
			if (p.count > 0) { done++; }
		});
		function item(label, value) {
			var w = el("div", "trStatItem");
			w.appendChild(el("div", "trStatLabel", label));
			w.appendChild(el("div", "trStatValue", value));
			return w;
		}
		strip.appendChild(item("已练路径", String(done)));
		strip.appendChild(item("总局数", String(totalRuns)));
		strip.appendChild(item("节点总数", String(CS.NODES.length)));
		strip.appendChild(item("可选底色", "6"));
	}

	/* ================= 首页 ================= */

	function renderHome() {
		renderPresets();
		renderGraphLegend();
		renderColorRow();
		renderFrontRow();
		renderSaved();
		renderStatsStrip();
		updatePathUI();
		if (!st.graph && window.CubeStageGraph) {
			st.graph = window.CubeStageGraph.create($("trGraph"), {
				onChange: function (path) {
					st.path = path;
					updatePathUI();
				}
			});
		}
		if (st.graph) { st.graph.setPath(st.path); }
	}

	/* ================= 训练页 ================= */

	/* 右侧目标/打乱信息 */
	function renderTarget() {
		var box = $("trTarget");
		var p = st.puzzle;
		if (!p) { box.innerHTML = ""; return; }
		var html = '<div class="ctTargetLabel">' +
			(nodeName(st.path[0]) + " \u2192 " + nodeName(st.path[st.path.length - 1])) + "</div>";
		if (p.scrambleText) {
			html += '<div class="ctTargetText">' + esc(p.scrambleText) + "</div>";
		} else {
			html += '<div class="ctTargetText">（起点 = 魔方当前状态）</div>';
		}
		html += '<div class="ctTargetNote">' + esc(p.note) +
			" · 底色 " + COLOR_NAME[st.frame.bottom] + "底 / " + COLOR_NAME[st.frame.front] + "前</div>";
		box.innerHTML = html;
	}

	function renderNetHint() {
		var hint = $("trNetHint");
		var t = st.timer;
		if (!t) { hint.innerHTML = ""; return; }
		var stt = t.state;
		var path = t.path();
		var idx = CS.progressIndex(path, stt.curFacelet, t.frame());
		var lines = [];
		lines.push("<b>" + esc(nodeName(path[0])) + "</b> \u2192 " + esc(nodeName(path[path.length - 1])) +
			" · 已完成 " + Math.min(idx, path.length - 1) + "/" + (path.length - 1) + " 段");
		if (idx < path.length) {
			lines.push("下一个目标：<b>" + esc(nodeName(path[idx])) + "</b>");
		} else {
			lines.push("已经到达终点节点。");
		}
		if (st.connected) { lines.push("起表：直接拧（魔方自动停表）或按「开始」手动计时"); }
		hint.innerHTML = lines.join("<br>");
	}

	function renderChips() {
		var box = $("trChips");
		var s = C.PathStats.summary(st.path);
		box.innerHTML = "";
		function chip(text) { return el("span", "ctChip", text); }
		box.appendChild(chip("完成 " + s.count + " 次"));
		box.appendChild(chip("有效 " + s.validCount + " 次"));
		box.appendChild(chip("最佳 " + (s.best ? C.fmt(s.best) + "s" : "--")));
		box.appendChild(chip("ao5 " + (s.ao5 ? C.fmt(s.ao5) + "s" : "--")));
	}

	function renderHistory() {
		var list = $("trHistList");
		var meta = $("trHistoryMeta");
		var s = C.PathStats.summary(st.path);
		list.innerHTML = "";
		meta.textContent = st.path.map(nodeName).join(" → ") + " · 共 " + s.count + " 次";
		if (!s.recent.length) {
			list.appendChild(el("div", "ctHistEmpty", "还没有成绩。完成第一次训练后这里会显示最近记录（含分段）。"));
			return;
		}
		var n = Math.min(12, s.recent.length);
		for (var i = 0; i < n; i++) {
			var r = s.recent[i];
			var row = el("div", "ctHistRow");
			row.appendChild(el("span", "ctHistIdx", "#" + (s.count - i)));
			var time = el("span", "ctHistTime" + (r.dnf ? "" : ""), r.dnf ? "DNF" : C.fmt(r.t) + "s");
			if (r.dnf) { time.dataset.dnf = "1"; }
			row.appendChild(time);
			row.appendChild(el("span", "ctHistSteps", (r.steps || 0) + " 步"));
			/* 分段（只显示真实存在的段） */
			if (r.seg && r.seg.length) {
				var segBox = el("span", "ctHistSegs");
				for (var k = 1; k < r.nodes.length; k++) {
					var sv = r.seg[k - 1];
					if (sv == null) { continue; }
					segBox.appendChild(el("span", "ctHistSeg", C.fmt(sv) + "s"));
				}
				if (segBox.children.length) { row.appendChild(segBox); }
			}
			row.appendChild(el("span", "ctHistWhen", relTime(r.at)));
			list.appendChild(row);
		}
	}

	function renderResult() {
		var bar = $("trResult");
		var r = st.result;
		if (!r) { bar.hidden = true; $("trSplitsWrap").hidden = true; return; }
		bar.innerHTML = "";
		bar.hidden = false;
		var main = el("span", "ctResultMain", r.dnf ? "DNF" : C.fmt(r.t) + "s");
		if (r.dnf) { main.dataset.dnf = "1"; }
		bar.appendChild(main);
		bar.appendChild(el("span", "ctResultMeta", r.turns + " 步" + (r.tps ? " · " + r.tps.toFixed(2) + " tps" : "")));
		if (r.how === "auto") { bar.appendChild(C.Badge("魔方自动停表", "", "由智能魔方状态识别结束")); }
		else { bar.appendChild(C.Badge("手动停表", "", "手动停表后校验状态")); }
		if (r.dnf) { bar.appendChild(C.Badge(r.dnfReason || "未达终点", "dnf", "停表时状态没到终点节点")); }
		var note = el("span", "ctResultNote", st.path.map(nodeName).join(" → "));
		bar.appendChild(note);

		/* 分段明细 */
		var wrap = $("trSplitsWrap");
		wrap.innerHTML = "";
		if (r.seg && r.seg.length) {
			wrap.hidden = false;
			var table = el("table", "ctSplits");
			var thead = el("thead");
			var tr = el("tr");
			["段", "用时", "累计"].forEach(function (h) { tr.appendChild(el("th", null, h)); });
			thead.appendChild(tr);
			table.appendChild(thead);
			var tbody = el("tbody");
			var acc = 0;
			st.path.forEach(function (id, i) {
				if (i === 0) { return; }
				var segT = r.seg[i - 1];
				if (segT == null) { return; }
				acc += segT;
				var row = el("tr");
				var td0 = el("td", "ctSplitsStage", nodeName(st.path[i - 1]) + " \u2192 " + nodeName(id));
				row.appendChild(td0);
				row.appendChild(el("td", "ctSplitsTime", C.fmt(segT) + "s"));
				row.appendChild(el("td", null, C.fmt(acc) + "s"));
				tbody.appendChild(row);
			});
			table.appendChild(tbody);
			wrap.appendChild(table);
		} else {
			wrap.hidden = true;
		}
	}

	function renderLive() {
		var t = st.timer;
		if (!t) { return; }
		$("trLiveTurns").textContent = String(t.state.live.turns);
		$("trLiveTps").textContent = t.state.live.tps ? t.state.live.tps.toFixed(2) : "—";
		var path = t.path();
		var idx = CS.progressIndex(path, t.state.curFacelet, t.frame());
		$("trLiveSegs").textContent = Math.min(idx, path.length - 1) + "/" + (path.length - 1);
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
		$("trRunBtn").textContent = phase === "ready" ? "开始" : (phase === "done" || phase === "dnf" ? "再来一次" : "开始");
		$("trAlgInput").disabled = false;
	}

	/* ================= 提交成绩 ================= */

	function onFinish(r) {
		var steps = r.turns;
		var badge = "", badgeText = "";
		/* 与参考（如果是纯 OLL/PLL 案例）对照可以后续加，这里先记录原始结果 */
		C.PathStats.record(st.path, {
			t: r.t,
			dnf: r.dnf,
			steps: steps,
			seg: r.segTimes,
			frame: st.frame.bottom + "|" + st.frame.front,
			badge: badge,
			badgeText: badgeText
		});
		st.result = {
			t: r.t,
			dnf: r.dnf,
			dnfReason: r.dnfReason,
			how: r.how,
			turns: r.turns,
			tps: r.tps,
			seg: r.segTimes
		};
		renderResult();
		renderChips();
		renderHistory();
		renderNetHint();
		renderLive();
		syncTrainButtons();
	}

	/* ================= 蓝牙 ================= */

	function setDeviceUI() {
		var bt = window.CubeTimer.bluetooth;
		var connected = bt.isConnected();
		st.connected = connected;
		var btn = $("trConnectBtn");
		var label = $("trConnectLabel");
		var status = $("trDeviceStatus");
		if (connected) {
			btn.classList.add("connected");
			label.textContent = bt.deviceName();
			status.textContent = "已连接 · 直接拧即可起表，到终点自动停表";
		} else {
			btn.classList.remove("connected");
			label.textContent = "连接魔方";
			status.textContent = "未连接 · 可手动计时（空格起停）";
		}
		if (st.timer) { renderNetHint(); syncTrainButtons(); }
	}

	function bindBluetooth() {
		var bt = window.CubeTimer.bluetooth;
		bt.on("connect", function () { setDeviceUI(); });
		bt.on("disconnect", function () {
			setDeviceUI();
			if (st.timer) { st.timer.reset(st.timer.state.curFacelet); syncTrainButtons(); }
		});
		bt.on("state", function (d) {
			if (!st.timer || st.view !== "train") { return; }
			/* 魔方状态更新：喂给计时台（不计数转动） */
			st.timer.setState(d.facelet);
		});
		bt.on("move", function (d) {
			if (!st.timer || st.view !== "train") { return; }
			var t = st.timer;
			/* 尚未起表：直接拧 = 魔方起表 */
			if (t.state.phase === "ready") {
				t.start("state");
			}
			t.setState(d.facelet || t.state.curFacelet, true, d.move);
			renderLive();
			syncTrainButtons();
		});
	}

	function toggleConnect() {
		var bt = window.CubeTimer.bluetooth;
		var btn = $("trConnectBtn");
		btn.disabled = true;
		var done = function () { btn.disabled = false; setDeviceUI(); };
		if (bt.isConnected()) {
			bt.disconnect().then(done, done);
			return;
		}
		$("trConnectLabel").textContent = "选择设备…";
		$("trDeviceStatus").textContent = "正在连接";
		bt.connect().then(done, function (e) {
			$("trDeviceStatus").textContent = "连接失败";
			window.alert("连接失败：" + (e.message || e));
			done();
		});
	}

	/* ================= 算法输入（无蓝牙时的驱动方式） =================
	 * 口径：输入框里的内容 = 「本次训练已经做的全部动作」，从本题起点算起。
	 * 因此每次都从 baseFacelet 重放整串，而不是往后追加 ——
	 * 这样用户边打字边改（退格、改一个字母）魔方与判定都跟着回到正确位置。
	 * 分段也按重放过程逐步判定，保证中途节点的时间点有真实落点。 */
	function applyInput(showHint) {
		var t = st.timer;
		if (!t) { return 0; }
		var input = $("trAlgInput");
		var text = String(input.value || "");
		var hint = $("trInputHint");

		if (!text.trim()) {
			t.setState(st.puzzle.baseFacelet);
			if (showHint) { hint.dataset.kind = ""; hint.textContent = ""; }
			return 0;
		}
		var toks = F.parseAlg(text);
		if (!toks) {
			/* 整串解析失败：回退到最长可解析前缀，让边打字边看魔方 */
			var parts = text.trim().split(/[\s,]+/);
			for (var k = parts.length - 1; k >= 1; k--) {
				var t2 = F.parseAlg(parts.slice(0, k).join(" "));
				if (t2) { toks = t2; break; }
			}
		}
		if (!toks) {
			if (showHint) {
				hint.dataset.kind = "err";
				hint.textContent = "无法识别：仅支持 URFDLB（大小写均可，小写=双层）/ MES / xyz + 2 或 ′";
			}
			return 0;
		}

		/* 回到本题起点，然后逐步重放整串 —— 每步都喂给计时台，
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
		renderNetHint();
		syncTrainButtons();
		if (showHint) {
			hint.dataset.kind = "ok";
			hint.textContent = "已应用 " + toks.length + " 步";
		}
		return toks.length;
	}

	/* ================= 视图切换 ================= */

	function enterTrain() {
		var v = CS.validatePath(st.path);
		if (!v.ok) { window.alert(v.reason); return; }
		st.view = "train";
		$("trHome").hidden = true;
		$("trTrain").hidden = false;
		$("trPathName").textContent = nodeName(st.path[0]) + " \u2192 " + nodeName(st.path[st.path.length - 1]);

		/* 先出题（这一步可能触发底色自动识别，改掉 st.frame），
		 * 再建/更新计时台与所有显示，避免出现「底色标签」与「本题信息」两处不一致。 */
		newPuzzle();

		if (st.timer) {
			st.timer.setPath(st.path);
		} else {
			st.timer = window.CubeTimer.create({
				mount: {
					timer: "trTimer", timerBox: "trTimerBox", phase: "trPhase",
					stageBar: "trStageBar", liveTurns: "trLiveTurns", liveTps: "trLiveTps",
					moves: "trMoves", net: "trNet", keys: "trKeys"
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

		$("trFrameTag").textContent = "底色 " + COLOR_NAME[st.frame.bottom] + "底 / " + COLOR_NAME[st.frame.front] + "前";
		$("trFrameTag").hidden = false;

		$("trAlgInput").value = "";
		$("trInputHint").textContent = "";
		renderTarget();
		renderResult();
		renderChips();
		renderHistory();
		renderNetHint();
		renderLive();
		syncTrainButtons();
		setDeviceUI();
	}

	function backHome() {
		st.view = "home";
		C.Metronome.stop();
		if (st.timer) { st.timer.reset(st.puzzle ? st.puzzle.baseFacelet : F.SOLVED); }
		$("trHome").hidden = false;
		$("trTrain").hidden = true;
		renderSaved();
		renderStatsStrip();
	}

	/* ================= 说明 ================= */

	function openHelp() {
		var mount = $("trHelpMount");
		mount.innerHTML = "";
		var mask = el("div", "trHelpMask");
		var box = el("div", "trHelpBox");
		box.appendChild(el("div", "trHelpTitle", "训练场说明"));
		var body = el("div", "trHelpBody");
		body.innerHTML =
			"<p><b>它是干什么的</b><br>训练场的本质是「在整段复原里取一段来练」。" +
			"首页是一张节点图，节点就是复原过程中可以打点的各个层级；" +
			"点两个节点连成一条路，计时就只覆盖这一段。</p>" +
			"<p><b>怎么选路</b><br>点第一个节点 = 起点，点第二个 = 终点；" +
			"之后再点别的节点，会作为<b>中间分段</b>插进这条路上（内部按节点再分几段计时）。" +
			"点已选中的节点可取消。直线只是导航参考，任何两点都能连 —— " +
			"比如先做 OLL 棱、再做 OLL 角，或者先 PLL 角、再 PLL 棱，都连得出来。</p>" +
			"<p><b>起停口径</b><br>· 直接开拧（智能魔方起表）：拧到终点节点，<b>状态识别自动停表</b>。<br>" +
			"· 手动起表（空格或「开始」）：即使连着蓝牙也<b>必须手动停表</b>；停表后校验状态，没到终点判 DNF。</p>" +
			"<p><b>六色底</b><br>「新打乱」时自动识别最该用的底色（枚举 24 种朝向，挑离目标最近的）；" +
			"其它情况请自己点底色与前面。所有判定都按你选的参考系算，与持握方向无关。</p>" +
			"<p><b>数据</b>：成绩按「这条路」分开存，含每段用时，只存在本浏览器 localStorage，不上传。</p>";
		box.appendChild(body);
		var foot = el("div", "trHelpFoot");
		var close = el("button", "trBtn primary", "知道了");
		close.type = "button";
		close.addEventListener("click", closeHelp);
		foot.appendChild(close);
		box.appendChild(foot);
		mask.addEventListener("click", closeHelp);
		mount.appendChild(mask);
		mount.appendChild(box);
	}
	function closeHelp() { $("trHelpMount").innerHTML = ""; }

	/* ================= 工具 ================= */

	function relTime(at) {
		var d = Date.now() - (at || 0);
		if (d < 60e3) { return "刚刚"; }
		if (d < 3600e3) { return Math.floor(d / 60e3) + " 分钟前"; }
		if (d < 86400e3) { return Math.floor(d / 3600e3) + " 小时前"; }
		return Math.floor(d / 86400e3) + " 天前";
	}

	/* ================= 绑定 ================= */

	function bind() {
		$("trBack").addEventListener("click", backHome);
		$("trHelpBtn").addEventListener("click", openHelp);
		$("trStartBtn").addEventListener("click", enterTrain);
		$("trClearPathBtn").addEventListener("click", function () {
			st.path = [];
			if (st.graph) { st.graph.clear(); }
			updatePathUI();
		});
		$("trSavePathBtn").addEventListener("click", function () {
			var v = CS.validatePath(st.path);
			if (!v.ok) { return; }
			C.SavedPaths.add(st.path, st.frame.bottom + "|" + st.frame.front);
			renderSaved();
		});
		$("trGraphReset").addEventListener("click", function () {
			if (st.graph) { st.graph.resetLayout(); }
		});

		/* 起点来源 */
		$("trOriginRow").addEventListener("click", function (e) {
			var b = e.target.closest ? e.target.closest("[data-origin]") : null;
			if (!b) { return; }
			st.origin = b.dataset.origin;
			var all = $("trOriginRow").querySelectorAll(".trOriginBtn");
			for (var i = 0; i < all.length; i++) {
				all[i].setAttribute("aria-pressed", all[i] === b ? "true" : "false");
			}
			st.frameAuto = (st.origin === "scramble");
			renderColorRow(); renderFrontRow();
		});

		/* 训练页控制 */
		$("trConnectBtn").addEventListener("click", toggleConnect);
		$("trRunBtn").addEventListener("click", function () {
			var t = st.timer;
			if (!t) { return; }
			if (t.state.phase === "ready") { t.start("manual"); }
			else if (t.state.phase === "done" || t.state.phase === "dnf") {
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
			renderTarget(); renderResult(); renderNetHint(); renderLive(); syncTrainButtons();
		});
		$("trResetBtn").addEventListener("click", function () {
			st.timer.reset(st.puzzle.baseFacelet);
			st.timer.setState(st.puzzle.baseFacelet);
			$("trAlgInput").value = "";
			$("trInputHint").textContent = "";
			renderResult(); renderNetHint(); renderLive(); syncTrainButtons();
		});
		$("trApplyBtn").addEventListener("click", function () { applyInput(true); });
		$("trAlgInput").addEventListener("keydown", function (e) {
			if (e.key === "Enter") { e.preventDefault(); applyInput(true); }
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
		renderHome();
		setDeviceUI();

		function applyTheme(theme) {
			theme = theme === "dark" ? "dark" : "light";
			document.documentElement.dataset.theme = theme;
			var btn = document.getElementById("siteThemeToggle");
			if (btn) { btn.textContent = theme === "dark" ? "\u2600" : "\u263E"; }
			try { localStorage.setItem("smartCubeTheme", theme); } catch (e) {}
		}
		if (window.siteNav && typeof window.siteNav.init === "function") {
			window.siteNav.init({ setTheme: applyTheme });
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
