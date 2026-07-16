(function () {
	"use strict";

	var overlayStack = [];
	var groupLabels = {
		practice: { settings: "训练设置", cube: "魔方方向", data: "公式与导入", help: "连接帮助" },
		memory: { settings: "记忆设置", cube: "魔方方向", data: "计划与数据", help: "连接帮助" },
		formula: { settings: "制作操作", cube: "录制与调整", data: "公式数据", help: "连接帮助" },
		library: { settings: "公式库操作", cube: "魔方方向", data: "公式数据", help: "连接帮助" }
	};

	function createGroup(key, label) {
		var section = document.createElement("section");
		section.className = "opGroup opGroup-" + key;
		section.setAttribute("data-action-group", key);

		var title = document.createElement("h2");
		title.className = "opGroupTitle";
		title.textContent = label;

		var body = document.createElement("div");
		body.className = "opGroupBody";
		section.append(title, body);
		return { section: section, body: body };
	}

	function organizeOps(options) {
		var view = options && options.view;
		var target = options && options.body;
		var mode = options && options.mode || "practice";
		if (!view || !target) return;

		target.replaceChildren();
		var labels = groupLabels[mode] || groupLabels.practice;
		var groups = {};

		function append(key, node) {
			if (!node) return;
			if (!groups[key]) groups[key] = createGroup(key, labels[key]);
			groups[key].body.appendChild(node);
		}

		var header = view.querySelector(":scope > .viewHead");
		if (header) header.remove();

		Array.from(view.children).forEach(function (section) {
			if (!section.classList || !section.classList.contains("viewSec")) return;
			var isImport = section.id === "formulaImport" || section.id === "stateImport";
			if (section.classList.contains("macHelp")) append("help", section);
			else if (section.querySelector("#manualMoves, #orientationMoves")) append("cube", section);
			else if (section.classList.contains("stateBox")) append("data", section);
			else if (!isImport && section.querySelector(":scope > .controls")) append("settings", section);
		});

		var importBox = view.querySelector("#formulaImport, #stateImport");
		if (importBox) {
			Array.from(importBox.children).forEach(function (child) {
				if (child.matches(".sharedGroupBar, #sharedCustomStateBtn, .importDropZone, .controls, .hiddenFileInput, .textImport, .stateOptionRow")) {
					append("data", child);
				}
			});
		}

		["settings", "cube", "data", "help"].forEach(function (key) {
			if (groups[key]) target.appendChild(groups[key].section);
		});
	}

	function mount(overlay, options) {
		options = options || {};
		if (!overlay) return function () {};
		var returnFocus = document.activeElement;
		var closed = false;
		var pointerStartedInside = false;
		var duration = Number(options.duration) || 220;

		if (!overlay.parentNode) document.body.appendChild(overlay);
		overlay.classList.add("mobileOverlayHost");
		overlayStack.push(overlay);

		function close() {
			if (closed) return;
			closed = true;
			overlay.classList.remove("isOpen");
			document.removeEventListener("keydown", onKeyDown, true);
			var index = overlayStack.indexOf(overlay);
			if (index >= 0) overlayStack.splice(index, 1);
			if (typeof options.onClose === "function") options.onClose();
			setTimeout(function () {
				if (overlay.parentNode) overlay.remove();
				if (options.restoreFocus !== false && returnFocus && returnFocus.focus) returnFocus.focus();
			}, duration);
		}

		function onKeyDown(event) {
			if (event.key !== "Escape" || overlayStack[overlayStack.length - 1] !== overlay) return;
			event.preventDefault();
			event.stopPropagation();
			close();
		}

		overlay.addEventListener("pointerdown", function (event) {
			pointerStartedInside = event.target !== overlay;
		});
		overlay.addEventListener("pointerup", function (event) {
			if (options.closeOnBackdrop !== false && event.target === overlay && !pointerStartedInside) close();
			pointerStartedInside = false;
		});
		document.addEventListener("keydown", onKeyDown, true);
		overlay.querySelectorAll(options.closeSelector || "[data-overlay-close]").forEach(function (button) {
			button.addEventListener("click", close);
		});
		overlay.mobileClose = close;
		requestAnimationFrame(function () { overlay.classList.add("isOpen"); });
		return close;
	}

	window.AppUI = {
		mount: mount,
		organizeOps: organizeOps
	};
})();

