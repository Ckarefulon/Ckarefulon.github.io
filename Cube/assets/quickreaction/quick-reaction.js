/*
 * Formula 练习辅助（原 Quick Reaction 三件套收口后的残留）
 * ---------------------------------------------------------------------------
 * 案例（OLL/PLL）**不再作为 Formula 的题源** —— 它们已并入站点公式库
 * （Cube/Formula/assets/DB.txt 的 <OLL> / <PLL> 段），走「公式库」入口即可练习。
 * 本文件因此只剩一件与练习无关的通用工具：节拍器面板。
 *
 * 节拍器真身：Cube/assets/metronome/（Trainer 与本页共用同一份）
 * 这里只做面板 UI，并挂进既有「操作」面板的「魔方方向」组。
 */
(function () {
	"use strict";

	var app = window.smartCubeApp;
	if (!app) { return; }

	function el(tag, cls, text) {
		var d = document.createElement(tag);
		if (cls) { d.className = cls; }
		if (text != null) { d.textContent = text; }
		return d;
	}

	function buildMetroPanel() {
		var sec = el("section", "viewSec");
		sec.setAttribute("data-metro-panel", "1");

		var controls = el("div", "controls metroControls");
		controls.setAttribute("aria-label", "节拍器");
		sec.appendChild(controls);

		controls.appendChild(el("span", "metroTitle", "节拍器"));

		var range = document.createElement("input");
		range.type = "range";
		range.className = "metroRange";
		range.min = "0.5";
		range.max = "8";
		range.step = "0.25";
		range.value = "2";
		range.setAttribute("aria-label", "节拍器速度");
		controls.appendChild(range);

		var tps = el("span", "metroTps", "2.00");
		controls.appendChild(tps);

		var beat = el("span", "metroBeat", "·");
		controls.appendChild(beat);

		var btn = el("button", "metroBtn", "开始");
		btn.type = "button";
		controls.appendChild(btn);

		var beatTimer = 0;
		function stopIt() {
			if (window.CubeMetronome) { window.CubeMetronome.stop(); }
			btn.textContent = "开始";
			beat.textContent = "·";
			beat.classList.remove("isBeat");
		}

		btn.addEventListener("click", function () {
			var M = window.CubeMetronome;
			if (!M) { return; }
			if (M.isRunning()) { stopIt(); return; }
			M.start(Number(range.value) || 2, function (idx) {
				beat.textContent = String((idx % 4) + 1);
				beat.classList.add("isBeat");
				if (beatTimer) { clearTimeout(beatTimer); }
				beatTimer = setTimeout(function () {
					beat.classList.remove("isBeat");
					beatTimer = 0;
				}, 90);
			});
			btn.textContent = "停止";
		});

		range.addEventListener("input", function () {
			var v = Number(range.value) || 2;
			tps.textContent = v.toFixed(2);
			if (window.CubeMetronome && window.CubeMetronome.isRunning()) {
				window.CubeMetronome.setTps(v);
			}
		});

		return sec;
	}

	/* 幂等补挂：视图是整块 outerHTML 重绘的 */
	function ensureMounted() {
		var view = document.querySelector("aside.practiceView");
		if (!view || view.querySelector("[data-metro-panel]")) { return; }
		view.appendChild(buildMetroPanel());
	}

	function boot() {
		/* renderMode 顺序：重建视图 → bindModeUI → def.enter → organizeOps。
		 * 必须在 enter 里补挂，节点才能被 organizeOps 收进「操作」面板。 */
		var practice = app.modeDefs.practice;
		if (practice) {
			var prevEnter = practice.enter;
			practice.enter = function () {
				if (typeof prevEnter === "function") { prevEnter.call(this); }
				ensureMounted();
			};
		}
		app.addInit(ensureMounted);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
