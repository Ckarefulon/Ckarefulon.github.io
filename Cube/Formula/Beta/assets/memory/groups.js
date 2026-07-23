(function() {
	"use strict";

	var app = window.smartCubeApp;
	var store = window.MemoryStore;
	if (!app || !store) return;

	var memory = {};
	Object.defineProperty(memory, "data", { get: store.data });
	function lib() { return store.group(); }
	function freshLibrary(name) { return store.make(name); }
	function saveData() { store.save(); }
	function loadLibraryMask() { store.loadMask(); }
	function getProgress(id) { return store.progress(id); }
	function startMemoryMode() { store.refresh(); }
app.getFormulaGroups = function() {
		if (!memory.data || !memory.data.libraries) return [];
		return Object.keys(memory.data.libraries).map(function(id) {
			var g = memory.data.libraries[id];
			return { id: id, name: g.name || id };
		});
	};

	app.getActiveGroupId = function() {
		return memory.data ? memory.data.activeLibraryId : null;
	};

	app.setActiveGroupId = function(id) {
		if (!memory.data || !memory.data.libraries || !memory.data.libraries[id]) return false;
		if (memory.data.activeLibraryId === id) return true;
		memory.data.activeLibraryId = id;
		saveData();
		loadLibraryMask();
		app._notifyActiveGroupChanged();
		return true;
	};

	app.getActiveGroupName = function() {
		var l = lib();
		return l ? (l.name || "") : "";
	};

	app.createFormulaGroup = function(name) {
		var id = "lib_" + Date.now();
		memory.data.libraries[id] = freshLibrary(name || "新组");
		memory.data.activeLibraryId = id;
		saveData();
		app._notifyGroupListChanged();
		app._notifyActiveGroupChanged();
		return id;
	};

	app.renameFormulaGroup = function(id, name) {
		var g = memory.data && memory.data.libraries ? memory.data.libraries[id] : null;
		if (!g || !name) return false;
		g.name = name;
		saveData();
		app._notifyGroupListChanged();
		if (id === memory.data.activeLibraryId) app._notifyActiveGroupChanged();
		return true;
	};

	app.deleteFormulaGroup = function(id) {
		if (!memory.data || !memory.data.libraries || !memory.data.libraries[id]) return false;
		if (Object.keys(memory.data.libraries).length <= 1) return false;
		delete memory.data.libraries[id];
		if (memory.data.activeLibraryId === id) {
			memory.data.activeLibraryId = Object.keys(memory.data.libraries)[0];
			loadLibraryMask();
		}
		saveData();
		app._notifyGroupListChanged();
		app._notifyActiveGroupChanged();
		return true;
	};

	app.getActiveGroupPlanText = function() {
		var l = lib();
		return l ? String(l.planText || "") : "";
	};

	app.setActiveGroupPlanText = function(text) {
		var l = lib();
		if (!l) return;
		var newText = String(text || "");
		l.planText = newText;
		if (!newText.trim()) {
			l.formulas = [];
			l.allFormulas = [];
			l.queue = [];
			l.todayQueue = [];
		} else {
			app._parseAndUpdateFormulas(l, newText);
		}
		saveData();
		app._notifyActiveGroupChanged();
	};

	app.setActiveGroupPlanTextQuiet = function(text) {
		var l = lib();
		if (!l) return;
		l.planText = String(text || "");
		saveData();
	};

	app.getActiveGroupFormulas = function() {
		var l = lib();
		return l ? (l.formulas || []) : [];
	};

	app.setActiveGroupFormulas = function(parsedFormulas, silent) {
		var l = lib();
		if (!l) return;
		app._replaceFormulas(l, parsedFormulas);
		saveData();
		if (!silent) app._notifyActiveGroupChanged();
	};

	app.appendTextToActiveGroup = function(text) {
		return app.appendTextToGroup(memory.data.activeLibraryId, text);
	};

	app.appendTextToGroup = function(groupId, text) {
		var g = memory.data && memory.data.libraries ? memory.data.libraries[groupId] : null;
		if (!g) return false;
		text = String(text || "").trim();
		if (!text) return false;
		var current = String(g.planText || "").replace(/\s+$/g, "");
		var newText = current ? current + "\n" + text : text;
		g.planText = newText;
		app._parseAndUpdateFormulas(g, newText);
		saveData();
		if (groupId === memory.data.activeLibraryId) {
			app._notifyActiveGroupChanged();
		}
		return true;
	};

	app.getActiveGroupCustomMask = function() {
		var l = lib();
		return l ? (l.hiddenStickerMask || {}) : {};
	};

	app.setActiveGroupCustomMask = function(mask) {
		var l = lib();
		if (!l) return false;
		l.hiddenStickerMask = (mask && typeof mask === "object") ? mask : {};
		saveData();
		loadLibraryMask();
		app._notifyActiveGroupChanged();
		return true;
	};

	app.findGroupFormulaByAlg = function(alg, groupId) {
		var g;
		if (groupId) {
			g = memory.data && memory.data.libraries ? memory.data.libraries[groupId] : null;
		} else {
			g = lib();
		}
		if (!g || !alg) return null;
		var normalized = String(alg).replace(/\s+/g, "").toUpperCase();
		var allFormulas = g.allFormulas && g.allFormulas.length ? g.allFormulas : (g.formulas || []);
		for (var i = 0; i < allFormulas.length; i++) {
			var fAlg = String(allFormulas[i].alg || allFormulas[i].formula || "").replace(/\s+/g, "").toUpperCase();
			if (fAlg === normalized) return allFormulas[i];
		}
		return null;
	};

	app.setFormulaCustomSolvedState = function(formulaId, facelet) {
		var l = lib();
		if (!l) return false;
		var allFormulas = l.allFormulas && l.allFormulas.length ? l.allFormulas : (l.formulas || []);
		for (var i = 0; i < allFormulas.length; i++) {
			if (allFormulas[i].id === formulaId) {
				allFormulas[i].customSolvedState = (facelet && String(facelet).length === 54) ? String(facelet).toUpperCase() : null;
				saveData();
				return true;
			}
		}
		return false;
	};

	app._parseAndUpdateFormulas = function(g, newText) {
		if (!newText.trim()) {
			g.formulas = [];
			g.allFormulas = [];
			g.queue = [];
			g.todayQueue = [];
			return;
		}
		if (typeof app.parseFormulaDefs !== "function") return;
		var parsed = app.parseFormulaDefs(newText);
		if (!parsed.formulas.length) return;
		app._replaceFormulas(g, parsed.formulas);
	};

	app._replaceFormulas = function(g, parsedFormulas) {
		var previous = (g.allFormulas || g.formulas || []).slice();
		function findPrevState(state) {
			var normalized = String(state.alg || "").replace(/\s+/g, "").toUpperCase();
			if (!normalized) return null;
			for (var i = 0; i < previous.length; i++) {
				var prevAlg = String(previous[i].alg || previous[i].formula || "").replace(/\s+/g, "").toUpperCase();
				if (prevAlg === normalized && previous[i].customSolvedState) {
					return previous[i].customSolvedState;
				}
			}
			return null;
		}
		var formulas = parsedFormulas.map(function(state, index) {
			var same = previous[index] && previous[index].name === state.name && previous[index].alg === state.alg ? previous[index] : null;
			var id = same ? same.id : "memory_formula_" + Date.now() + "_" + g.idSeed++;
			var existing = same || previous.find(function(p) { return p.name === state.name && p.alg === state.alg; });
			var customSolvedState = existing ? (existing.customSolvedState || null) : findPrevState(state);
			return {
				id: id,
				image: existing ? (existing.image || null) : null,
				name: state.name,
				alg: state.alg,
				formula: state.alg,
				answer: state.alg,
				moves: state.moves.slice(),
				customSolvedState: customSolvedState
			};
		});
		g.formulas = formulas;
		g.allFormulas = formulas.slice();
		g.planText = formulas.map(function(f) {
			var alg = f.alg || f.formula || '';
			if (!alg.endsWith(';')) { alg += ';'; }
			return f.name + ': ' + alg;
		}).join('\n');
		g.queue = [];
		g.todayQueue = [];
		g.undoStack = [];
		formulas.forEach(function(formula) { getProgress(formula.id); });
	};

	app.getActiveLibraryPlanText = function() { return app.getActiveGroupPlanText(); };
	app.setActiveLibraryPlanText = function(text) { app.setActiveGroupPlanText(text); };
	app.setActiveLibraryPlanTextQuiet = function(text) { app.setActiveGroupPlanTextQuiet(text); };
	app.getActiveLibraryFormulas = function() { return app.getActiveGroupFormulas(); };
	app.setActiveLibraryFormulas = function(states, silent) { app.setActiveGroupFormulas(states, silent); };
	app.findMemoryFormulaByAlg = function(alg) { return app.findGroupFormulaByAlg(alg); };

	app.getSyncEnabled = function() {
		var l = lib();
		return l ? (l.syncEnabled !== false) : true;
	};

	app.setSyncEnabled = function(enabled) {
		var l = lib();
		if (!l) return;
		l.syncEnabled = !!enabled;
		saveData();
		app._notifyActiveGroupChanged();
	};

	app.getTrainingSelectedFormulaIds = function() {
		var l = lib();
		if (!l) return {};
		if (!l.trainingSelectedFormulaIds) {
			l.trainingSelectedFormulaIds = {};
		}
		return l.trainingSelectedFormulaIds;
	};

	app.setTrainingSelectedFormulaIds = function(ids) {
		var l = lib();
		if (!l) return;
		l.trainingSelectedFormulaIds = (ids && typeof ids === "object") ? ids : {};
		saveData();
	};

	app.getAllFormulas = function() {
		var l = lib();
		return l ? (l.allFormulas && l.allFormulas.length ? l.allFormulas : (l.formulas || [])) : [];
	};

	app.setPlanFormulas = function(selectedFormulas, allFormulas) {
		var l = lib();
		if (!l) return;
		l.formulas = selectedFormulas || [];
		l.allFormulas = allFormulas || selectedFormulas || [];
		l.planText = (allFormulas || selectedFormulas || []).map(function(f) {
			var alg = f.alg || f.formula || '';
			if (!alg.endsWith(';')) { alg += ';'; }
			return f.name + ': ' + alg;
		}).join('\n');
		l.queue = [];
		l.todayQueue = [];
		l.undoStack = [];
		saveData();
		app._notifyActiveGroupChanged();
	};

	app.setActiveGroupSettings = function(settings) {
		var l = lib();
		if (!l || !settings) return;
		l.settings = Object.assign(l.settings || { dailyCount: 10, solveDetectionMode: 2 }, settings);
		saveData();
	};

	app.getActiveGroupSettings = function() {
		var l = lib();
		return l ? (l.settings || { dailyCount: 10, solveDetectionMode: 2 }) : { dailyCount: 10, solveDetectionMode: 2 };
	};

	app.getFormulaProgress = function(formulaId) {
		return getProgress(formulaId);
	};

	var _activeGroupChangeListeners = [];
	var _groupListChangeListeners = [];

	app.onActiveGroupChanged = function(callback) {
		if (typeof callback === "function" && _activeGroupChangeListeners.indexOf(callback) === -1) {
			_activeGroupChangeListeners.push(callback);
		}
	};
	app.onGroupListChanged = function(callback) {
		if (typeof callback === "function" && _groupListChangeListeners.indexOf(callback) === -1) {
			_groupListChangeListeners.push(callback);
		}
	};
	app.onActiveLibraryChanged = function(cb) { app.onActiveGroupChanged(cb); };
	app._notifyActiveLibraryChanged = function() { app._notifyActiveGroupChanged(); };
	app._notifyActiveGroupChanged = function() {
		for (var i = 0; i < _activeGroupChangeListeners.length; i++) {
			try { _activeGroupChangeListeners[i](); } catch(e) {}
		}
	};
	app.onActiveGroupChanged(function() {
		if (app.currentMode === "memory") startMemoryMode();
	});

	app._notifyGroupListChanged = function() {
		for (var i = 0; i < _groupListChangeListeners.length; i++) {
			try { _groupListChangeListeners[i](); } catch(e) {}
		}
	};
})();
