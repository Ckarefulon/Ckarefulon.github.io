(function() {
	"use strict";

	var skipSel = [
		"button", "input", "textarea", "select", "a", "label",
		"[contenteditable]", "[draggable='true']",
		"#cubeStage", "#customCubeStage", ".keyDrawer", ".panelDrawer",
		".modeNav", ".statePreview", ".formulaRow", ".libraryFormula"
	].join(",");

	function isBlocked(node) {
		if (!node || node.closest(skipSel)) return true;
		for (var el = node; el && el !== document.body; el = el.parentElement) {
			var css = getComputedStyle(el);
			var xScroll = /(auto|scroll)/.test(css.overflowX) && el.scrollWidth > el.clientWidth + 1;
			var yScroll = /(auto|scroll)/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 1;
			if (xScroll || yScroll) return true;
		}
		return false;
	}

	function bind(app) {
		if (!app || document.documentElement.dataset.swipeBound) return;
		document.documentElement.dataset.swipeBound = "1";
		var start = null;

		document.addEventListener("touchstart", function(event) {
			if (event.touches.length !== 1 || isBlocked(event.target)) {
				start = null;
				return;
			}
			var touch = event.touches[0];
			start = { x: touch.clientX, y: touch.clientY };
		}, { passive: true });

		document.addEventListener("touchmove", function(event) {
			if (!start || event.touches.length !== 1) return;
			var touch = event.touches[0];
			var dx = touch.clientX - start.x;
			var dy = touch.clientY - start.y;
			var portrait = matchMedia("(orientation: portrait)").matches;
			var main = portrait ? dx : dy;
			var cross = portrait ? dy : dx;
			if (Math.abs(main) < 64 || Math.abs(main) < Math.abs(cross) * 1.25) return;
			event.preventDefault();
			var order = app.modeOrder.filter(function(id) { return app.getModeMeta(id); });
			var index = order.indexOf(app.currentMode);
			if (index < 0) return;
			var next = main < 0 ? index + 1 : index - 1;
			if (next >= 0 && next < order.length) app.switchMode(order[next]);
			start = null;
		}, { passive: false });

		document.addEventListener("touchend", function() { start = null; }, { passive: true });
		document.addEventListener("touchcancel", function() { start = null; }, { passive: true });
	}

	window.ModeSwipe = { bind: bind };
	bind(window.smartCubeApp);
})();
