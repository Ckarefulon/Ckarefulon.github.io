(function() {
	"use strict";

	var app = window.smartCubeApp;
	if (!app) {
		return;
	}

	var STORAGE_KEY = "cube_memory_progress";
	var SCHEMA_VERSION = 2;
	var FSRS_URL = "https://cdn.jsdelivr.net/npm/ts-fsrs/+esm";
	var RATING_COLORS = ["#24F0EA", "#35D68A", "#E6B84A", "#E85D6A"];
	var RATING_NAMES = ["清晰", "犹豫", "模糊", "遗忘"];
	var memory = {
		data: null,
		fsrsModule: null,
		scheduler: null,
		fsrsPromise: null,
		state: "idle",
		currentItem: null,
		currentFormula: null,
		stateShownTime: null,
		firstMoveTime: null,
		attemptStartTime: null,
		accumulatedSolveTime: 0,
		accumulatedReactionTime: 0,
		solveTime: null,
		reactionTime: null,
		retried: false,
		repeatedMove: false,
		attemptMoves: [],
		selectedRating: 0,
		manualSelection: false,
		answerReason: "",
		timerFrame: null,
		lastAnswerMove: null,
		skipNextDetection: false,
		promptedContinue: false,
		pendingAutofill: "",
		confirming: false,
		// 仅 UI 层“返回再点开答案默认选中上次选择”用，不进 memory.data、不被 undo 回滚。
		lastChoiceByFormula: {},
		justReturned: false,
		lastChoiceShown: null
	};

	/* ---------- Data structure ---------- */

	function freshLibrary(name) {
		return {
			name: name || "默认库",
			planText: "",
			formulas: [],
			allFormulas: [],
			progress: {},
			settings: { dailyCount: 10 },
			day: { studyDate: "", learnedIds: [] },
			queue: [],
			todayQueue: [],
			thresholdData: { threshold: 500, precision: 2 },
			undoStack: [],
			idSeed: 1,
			hiddenStickerMask: {}
		};
	}

	function freshData() {
		return {
			schemaVersion: SCHEMA_VERSION,
			activeLibraryId: "lib_default",
			libraries: {
				"lib_default": freshLibrary("默认库")
			}
		};
	}

	function lib() {
		if (!memory.data || !memory.data.libraries) {
			return null;
		}
		return memory.data.libraries[memory.data.activeLibraryId] || null;
	}

	function reviveDates(value) {
		if (!value || typeof value !== "object") {
			return value;
		}
		if (Array.isArray(value)) {
			value.forEach(reviveDates);
			return value;
		}
		Object.keys(value).forEach(function(key) {
			var item = value[key];
			if ((key === "due" || key === "last_review" || key === "review") && typeof item === "string" && !isNaN(Date.parse(item))) {
				value[key] = new Date(item);
			} else {
				reviveDates(item);
			}
		});
		return value;
	}

	function mergeLoadedData(value) {
		var base = freshData();
		if (!value || typeof value !== "object") {
			return reviveDates(base);
		}

		/* v1 → v2 migration */
		if (value.schemaVersion === 1 && Array.isArray(value.formulas) && typeof value.progress === "object") {
			var migrated = freshLibrary("默认库");
			migrated.planText = String(value.planText || "");
			migrated.formulas = Array.isArray(value.formulas) ? value.formulas : [];
			migrated.allFormulas = Array.isArray(value.allFormulas) ? value.allFormulas : [];
			migrated.progress = value.progress || {};
			migrated.settings = Object.assign({ dailyCount: 10 }, value.settings || {});
			migrated.day = Object.assign({ studyDate: "", learnedIds: [] }, value.day || {});
			migrated.day.learnedIds = Array.isArray(migrated.day.learnedIds) ? migrated.day.learnedIds : [];
			migrated.queue = Array.isArray(value.queue) ? value.queue : [];
			migrated.todayQueue = Array.isArray(value.todayQueue) ? value.todayQueue : [];
			migrated.undoStack = Array.isArray(value.undoStack) ? value.undoStack : [];
			migrated.thresholdData = Object.assign({ threshold: 500, precision: 2 }, value.thresholdData || {});
			migrated.idSeed = Number(value.idSeed) || 1;
			migrated.hiddenStickerMask = {};
			base.libraries["lib_default"] = migrated;
			base.activeLibraryId = "lib_default";
			return reviveDates(base);
		}

		/* v2 */
		if (value.schemaVersion !== SCHEMA_VERSION || !value.libraries || typeof value.libraries !== "object") {
			return reviveDates(base);
		}

		base.activeLibraryId = value.activeLibraryId || Object.keys(value.libraries)[0] || "lib_default";
		Object.keys(value.libraries).forEach(function(lid) {
			var src = value.libraries[lid];
			if (!src || typeof src !== "object") {
				return;
			}
			var dest = freshLibrary(src.name || lid);
			dest.name = src.name || dest.name;
			dest.planText = String(src.planText || "");
			dest.formulas = Array.isArray(src.formulas) ? src.formulas : [];
			dest.allFormulas = Array.isArray(src.allFormulas) ? src.allFormulas : [];
			dest.progress = src.progress || {};
			dest.settings = Object.assign({ dailyCount: 10 }, src.settings || {});
			dest.day = Object.assign({ studyDate: "", learnedIds: [] }, src.day || {});
			dest.day.learnedIds = Array.isArray(dest.day.learnedIds) ? dest.day.learnedIds : [];
			dest.queue = Array.isArray(src.queue) ? src.queue : [];
			dest.todayQueue = Array.isArray(src.todayQueue) ? src.todayQueue : [];
			dest.undoStack = Array.isArray(src.undoStack) ? src.undoStack : [];
			dest.thresholdData = Object.assign({ threshold: 500, precision: 2 }, src.thresholdData || {});
			dest.idSeed = Number(src.idSeed) || 1;
			dest.hiddenStickerMask = (src.hiddenStickerMask && typeof src.hiddenStickerMask === "object" && !Array.isArray(src.hiddenStickerMask)) ? src.hiddenStickerMask : {};
			base.libraries[lid] = dest;
		});
		if (!base.libraries[base.activeLibraryId]) {
			base.activeLibraryId = Object.keys(base.libraries)[0];
		}
		return reviveDates(base);
	}

	function stripTransientState(data) {
		if (!data || !data.libraries) {
			return data;
		}
		Object.keys(data.libraries).forEach(function(lid) {
			var lib = data.libraries[lid];
			if (lib) {
				lib.todayQueue = [];
				if (Array.isArray(lib.queue)) {
					lib.queue = lib.queue.filter(function(item) {
						return item && !item.reinforcement;
					});
				}
			}
		});
		return data;
	}

	function loadData() {
		try {
			memory.data = mergeLoadedData(storageManager.getJson(STORAGE_KEY, null));
		} catch (error) {
			memory.data = freshData();
		}
		var hadDayChange = ensureStudyDay();
		var needsCleanup = false;
		var memLibs = memory.data && memory.data.libraries;
		if (memLibs) {
			Object.keys(memLibs).forEach(function(lid) {
				var l = memLibs[lid];
				if (l) {
					if (l.todayQueue && l.todayQueue.length > 0) {
						needsCleanup = true;
					}
					if (Array.isArray(l.queue) && l.queue.some(function(item) { return item && item.reinforcement; })) {
						needsCleanup = true;
					}
				}
			});
		}
		stripTransientState(memory.data);
		var l = lib();
		if (l) {
			l.queue = l.queue.filter(function(item) {
				return item && findFormula(item.id);
			});
		}
		loadLibraryMask();
		if (hadDayChange || needsCleanup) {
			window._siteNavApplyingCloudData = true;
			try {
				saveData();
			} finally {
				setTimeout(function() { window._siteNavApplyingCloudData = false; }, 0);
			}
		}
	}

	function saveData() {
		if (!memory.data) {
			return;
		}
		memory.data.schemaVersion = SCHEMA_VERSION;
		var saved = JSON.parse(JSON.stringify(memory.data));
		stripTransientState(saved);
		storageManager.setJson(STORAGE_KEY, saved);
		updatePlanCounter();
	}

	function studyDate(value) {
		var shifted = new Date((value instanceof Date ? value.getTime() : Number(value) || Date.now()) - 4 * 60 * 60 * 1000);
		return [shifted.getFullYear(), String(shifted.getMonth() + 1).padStart(2, "0"), String(shifted.getDate()).padStart(2, "0")].join("-");
	}

	function daysBetween(from, to) {
		if (!from || !to) {
			return 0;
		}
		var a = new Date(from + "T12:00:00");
		var b = new Date(to + "T12:00:00");
		return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
	}

	function ensureStudyDay() {
		var l = lib();
		if (!l) {
			return false;
		}
		var today = studyDate(Date.now());
		if (l.day.studyDate !== today) {
			l.day = { studyDate: today, learnedIds: [] };
			l.queue = [];
			l.todayQueue = [];
			l.undoStack = [];
			memory.promptedContinue = false;
			return true;
		}
		return false;
	}

	function ensureFsrs() {
		if (memory.fsrsPromise) {
			return memory.fsrsPromise;
		}
		memory.fsrsPromise = import(FSRS_URL).then(function(module) {
			memory.fsrsModule = module;
			memory.scheduler = module.fsrs();
			return module;
		}).catch(function(error) {
			memory.fsrsPromise = null;
			throw error;
		});
		return memory.fsrsPromise;
	}

	/* ---------- Library management ---------- */

	function switchLibrary(id) {
		if (!memory.data.libraries[id] || id === memory.data.activeLibraryId) {
			return;
		}
		memory.data.activeLibraryId = id;
		saveData();
		loadLibraryMask();
		app._notifyActiveLibraryChanged();
	}

	function createLibrary(name) {
		var id = "lib_" + Date.now();
		memory.data.libraries[id] = freshLibrary(name || "新库");
		memory.data.activeLibraryId = id;
		saveData();
		app._notifyActiveLibraryChanged();
		return id;
	}

	function deleteLibrary(id) {
		if (Object.keys(memory.data.libraries).length <= 1) {
			return;
		}
		delete memory.data.libraries[id];
		if (memory.data.activeLibraryId === id) {
			memory.data.activeLibraryId = Object.keys(memory.data.libraries)[0];
		}
		saveData();
		app._notifyActiveLibraryChanged();
	}

	function renameLibrary(id, name) {
		if (memory.data.libraries[id] && name) {
			memory.data.libraries[id].name = name;
			saveData();
			app._notifyActiveLibraryChanged();
		}
	}

	function loadLibraryMask() {
		var l = lib();
		if (l && typeof app.cloneStickerMask === "function") {
			app.hiddenStickerMask = app.cloneStickerMask(l.hiddenStickerMask || {});
			if (app.twistyScene && typeof app.applyHiddenStickerMask === "function") {
				app.applyHiddenStickerMask(app.twistyScene, app.hiddenStickerMask);
			}
		}
	}

	function saveLibraryMask() {
		var l = lib();
		if (l && typeof app.cloneStickerMask === "function") {
			l.hiddenStickerMask = app.cloneStickerMask(app.hiddenStickerMask || {});
			saveData();
		}
	}

	/* ---------- Progress & queue ---------- */

	function getProgress(id) {
		var l = lib();
		if (!l) {
			return { card: null, logs: [], attempts: [], aoTimes: [], dayHistory: [], firstLearnStudyDate: "" };
		}
		if (!l.progress[id]) {
			l.progress[id] = {
				card: null,
				logs: [],
				attempts: [],
				aoTimes: [],
				dayHistory: [],
				firstLearnStudyDate: ""
			};
		}
		var progress = l.progress[id];
		progress.logs = Array.isArray(progress.logs) ? progress.logs : [];
		progress.attempts = Array.isArray(progress.attempts) ? progress.attempts : [];
		progress.aoTimes = Array.isArray(progress.aoTimes) ? progress.aoTimes : [];
		progress.dayHistory = Array.isArray(progress.dayHistory) ? progress.dayHistory : [];
		return progress;
	}

	function findFormula(id) {
		var l = lib();
		return (l && l.formulas || []).find(function(formula) {
			return formula.id === id;
		}) || null;
	}

	function isNewFormula(id) {
		var progress = getProgress(id);
		return !progress.logs.length;
	}

	function dueDate(progress) {
		if (!progress || !progress.card || !progress.card.due) {
			return null;
		}
		var due = progress.card.due instanceof Date ? progress.card.due : new Date(progress.card.due);
		return isNaN(due.getTime()) ? null : due;
	}

	function buildDailyQueue(dueOnly) {
		ensureStudyDay();
		var l = lib();
		if (!l) {
			return;
		}
		var learned = l.day.learnedIds;
		var now = Date.now();
		var due = [];
		var fresh = [];
		l.formulas.forEach(function(formula) {
			if (learned.indexOf(formula.id) >= 0) {
				return;
			}
			var progress = getProgress(formula.id);
			var scheduled = dueDate(progress);
			if (progress.logs.length && scheduled && scheduled.getTime() <= now) {
				due.push({ id: formula.id, reinforcement: false });
			} else if (!dueOnly && !progress.logs.length) {
				fresh.push({ id: formula.id, reinforcement: false });
			}
		});
		if (dueOnly) {
			l.queue = due;
			return;
		}
		var remaining = Math.max(0, Number(l.settings.dailyCount || 10) - learned.length);
		var queue = [];
		while (queue.length < remaining && (due.length || fresh.length)) {
			if (due.length) {
				queue.push(due.shift());
			}
			if (queue.length < remaining && fresh.length) {
				queue.push(fresh.shift());
			}
		}
		l.queue = queue;
	}

	function remainingDueItems() {
		var l = lib();
		if (!l) {
			return [];
		}
		var learned = l.day.learnedIds;
		var now = Date.now();
		return l.formulas.filter(function(formula) {
			if (learned.indexOf(formula.id) >= 0) {
				return false;
			}
			var progress = getProgress(formula.id);
			var due = dueDate(progress);
			return progress.logs.length && due && due.getTime() <= now;
		});
	}

	/* ---------- Panel HTML ---------- */

	function getMemoryPanelHtml() {
		var seamlessActive = app.seamlessMode ? " isActive" : "";
		return '<aside class="panel memoryPanel"><header class="panelHeader"><h1>记忆模式</h1><button id="memorySeamlessBtn" class="seamlessToggle' + seamlessActive + '" type="button" aria-pressed="' + (app.seamlessMode ? "true" : "false") + '"><span class="toggleSwitch"></span><span class="toggleLabel">无缝</span></button></header>' +
			'<section class="panelSection"><div class="controls"><button id="connectBtn" class="button" type="button">连接魔方</button><button id="customFinalStateBtn" class="button secondary" type="button">复原状态</button></div><button id="memoryPlanBtn" class="button" type="button">规划学习</button><div class="controls"><button id="memoryImportBtn" class="button secondary" type="button">导入数据</button><button id="memoryExportBtn" class="button secondary" type="button">导出数据</button></div><input id="memoryImportFile" class="hiddenFileInput" type="file" accept=".json,application/json"></section>' +
			'<section class="memoryArea"><div id="memoryCurrent" class="memoryCurrent"><button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><button id="memoryPrompt" class="memoryPrompt" type="button">请开始还原…<br>点击此处显示答案。</button></div><div id="memoryHistory" class="memoryHistory"></div></section>' +
			app.getDiagnosticsHtml(true) + '</aside>';
	}

	function updatePlanCounter() {
		var element = document.getElementById("memoryPlanCount");
		var l = lib();
		if (element && l) {
			element.textContent = "[" + l.day.learnedIds.length + "]/[" + l.settings.dailyCount + "]";
		}
		var input = document.getElementById("memoryDailyCount");
		if (input && l && document.activeElement !== input) {
			input.value = String(l.settings.dailyCount);
		}
	}

	/* ---------- Memory mode ---------- */

	function startMemoryMode() {
		ensureStudyDay();
		loadLibraryMask();
		memory.promptedContinue = false;
		updatePlanCounter();
		showHistoryPanel();
		var l = lib();
		if (l && !l.queue.length) {
			buildDailyQueue(false);
		}
		startNextFormula();
	}

	function hideHistoryPanel() {
		var history = document.getElementById("memoryHistory");
		if (history) { history.classList.add("isHidden"); }
	}

	function showHistoryPanel() {
		var history = document.getElementById("memoryHistory");
		if (history) { history.classList.remove("isHidden"); }
	}

	function startNextFormula() {
		stopTimer();
		showHistoryPanel();
		var l = lib();
		memory.currentItem = (l && l.queue[0]) || null;
		memory.currentFormula = memory.currentItem ? findFormula(memory.currentItem.id) : null;
		memory.state = "hidden";
		memory.firstMoveTime = null;
		memory.attemptStartTime = null;
		memory.accumulatedSolveTime = 0;
		memory.accumulatedReactionTime = 0;
		memory.solveTime = null;
		memory.reactionTime = null;
		memory.retried = false;
		memory.repeatedMove = false;
		memory.attemptMoves = [];
		memory.manualSelection = false;
		memory.lastAnswerMove = null;
		memory.lastChoiceShown = null;
		if (!memory.currentFormula) {
			renderIdleMemory();
			return;
		}
		applyMemoryFormula();
		renderHiddenMemory(false);
		renderMemoryHistory();
		saveData();
	}

	function applyMemoryFormula() {
		if (!memory.currentFormula) {
			return;
		}
		var yaw = app.viewYaw || 0;
		var pitch = app.viewPitch || 0;
		app.moveHistory = [];
		app.moveCount = 0;
		app.movesSinceState = 0;
		app.initTwisty();
		app.setViewDrag(yaw, pitch);
		app.resetVirtualState();
		var moves = app.buildTwistyMoves(memory.currentFormula.moves || [], true, true);
		if (moves.length) {
			app.twistyScene.applyMoves(moves);
		}
		app.renderMoves();
		if (app.elements.moveCount) {
			app.elements.moveCount.textContent = "0";
		}
		memory.sawUnsolvedVirtual = !app.isVirtualStateSolved();
		memory.sawUnsolvedFacelet = false;
		memory.stateShownTime = performance.now();
	}

	function renderIdleMemory() {
		var current = document.getElementById("memoryCurrent");
		if (!current) {
			return;
		}
		var l = lib();
		if (!l) {
			return;
		}
		var learnedCount = l.day.learnedIds.length;
		var dailyCount = l.settings.dailyCount;
		var due = remainingDueItems();
		var hasDue = due.length > 0;
		var planDone = learnedCount >= dailyCount && dailyCount > 0;
		hideHistoryPanel();

		if (planDone && !hasDue) {
			renderCompletionCheck(current, "已完成所有学习任务！", "完成签到", function() {
				renderCompletionCalendar(current);
			});
			return;
		}
		if (planDone && hasDue) {
			renderCompletionCheck(current, "已完成规划学习任务！<br/>但仍有公式今日到期。", "继续学习", function() {
				renderDueContinuationPanel(current, due);
			}, "直接签到", function() {
				renderCompletionCalendar(current);
			});
			return;
		}
		if (!planDone && !l.queue.length && !hasDue && l.formulas.length > 0) {
			renderCompletionCheck(current, "已完成复习学习任务！<br/>但未达今日规划目标。", "加入公式", function() {
				openPlanDialog();
			}, "直接签到", function() {
				renderCompletionCalendar(current);
			});
			return;
		}
		current.innerHTML = '<button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><button id="memoryPrompt" class="memoryPrompt" type="button">请开始还原…<br>点击此处显示答案。</button>';
		var history = document.getElementById("memoryHistory");
		if (history) {
			history.innerHTML = '<div class="memoryEmptyHistory">' + (l.formulas.length ? "今日没有待学习公式" : "请先规划学习公式") + '</div>';
		}
	}

	function renderCompletionCheck(current, message, buttonText, buttonAction, secondaryText, secondaryAction) {
		var html = '<div class="memoryCompletion"><div class="memoryCompletionCheck" aria-hidden="true"></div><p class="memoryCompletionText">' + message + '</p>';
		if (buttonText && buttonAction) {
			html += '<button id="memoryCompletionBtn" class="button" type="button">' + app.escapeHtml(buttonText) + '</button>';
		}
		if (secondaryText && secondaryAction) {
			html += '<button id="memoryCompletionSecondaryBtn" class="button secondary" type="button">' + app.escapeHtml(secondaryText) + '</button>';
		}
		html += '</div>';
		current.innerHTML = html;
		var history = document.getElementById("memoryHistory");
		if (history) { history.innerHTML = ""; }
		if (buttonText && buttonAction) {
			document.getElementById("memoryCompletionBtn").addEventListener("click", buttonAction);
		}
		if (secondaryText && secondaryAction) {
			document.getElementById("memoryCompletionSecondaryBtn").addEventListener("click", secondaryAction);
		}
	}

	function renderDueContinuationPanel(current, due) {
		var dueCount = due.length;
		var presets = [5, 10, 20, 50, 70];
		var html = '<div class="memoryDuePanel"><p class="memoryDueTitle">选择要加入的公式数量</p><div class="memoryDueGrid">';
		for (var i = 0; i < presets.length; i++) {
			html += '<button class="memoryDueBtn" type="button" data-count="' + presets[i] + '">' + presets[i] + '</button>';
		}
		html += '<button class="memoryDueBtn" type="button" data-count="' + dueCount + '">全部(' + dueCount + ')</button></div>';
		html += '<div class="memoryDueCustomRow"><input id="memoryDueCustomInput" class="memoryDueCustom" type="number" min="1" max="' + dueCount + '" placeholder="自定义" value=""><button id="memoryDueSubmit" class="memoryDueSubmit" type="button" title="提交" aria-label="提交"><span class="memoryDueCheckIcon" aria-hidden="true"></span></button></div></div>';
		current.innerHTML = html;

		function addDue(count) {
			var n = Math.min(count, dueCount);
			buildDailyQueue(true);
			lib().queue = lib().queue.slice(0, n);
			saveData();
			startNextFormula();
		}

		var grid = current.querySelector(".memoryDueGrid");
		grid.addEventListener("click", function(e) {
			var btn = e.target.closest(".memoryDueBtn");
			if (!btn) return;
			var count = parseInt(btn.getAttribute("data-count"), 10);
			if (count > 0) addDue(count);
		});

		var submitBtn = current.querySelector("#memoryDueSubmit");
		submitBtn.addEventListener("click", function() {
			var input = document.getElementById("memoryDueCustomInput");
			var val = parseInt(input.value, 10);
			if (!val || val < 1) {
				showToast("请输入有效的数量");
				return;
			}
			addDue(val);
		});

		var customInput = current.querySelector("#memoryDueCustomInput");
		customInput.addEventListener("keydown", function(e) {
			if (e.key === "Enter") {
				e.preventDefault();
				submitBtn.click();
			}
		});
		customInput.focus();
	}

	function renderCompletionCalendar(current, focusYear, focusMonth) {
		var l = lib();
		if (!l) {
			return;
		}
		var studyDates = {};
		var formulas = l.formulas || [];
		for (var i = 0; i < formulas.length; i++) {
			var progress = getProgress(formulas[i].id);
			var attempts = progress.attempts || [];
			for (var j = 0; j < attempts.length; j++) {
				var date = attempts[j].studyDate;
				if (date) {
					studyDates[date] = (studyDates[date] || 0) + 1;
				}
			}
		}
		var dates = Object.keys(studyDates).sort();
		if (!dates.length) {
			current.innerHTML = '<div class="memoryCompletion"><h2>今日计划已完成</h2><p>暂无学习记录</p></div>';
			var history = document.getElementById("memoryHistory");
			if (history) { history.innerHTML = ""; }
			return;
		}
		var totalDays = dates.length;
		if (focusYear == null) {
			var lastDate = dates[dates.length - 1];
			focusYear = parseInt(lastDate.slice(0, 4), 10);
			focusMonth = parseInt(lastDate.slice(5, 7), 10);
		}
		var monthKey = focusYear + "-" + String(focusMonth).padStart(2, "0");
		var daysInMonth = new Date(focusYear, focusMonth, 0).getDate();
		var firstDow = new Date(focusYear, focusMonth - 1, 1).getDay();
		var monthDays = {};
		dates.forEach(function(d) {
			if (d.slice(0, 7) === monthKey) {
				monthDays[d] = studyDates[d];
			}
		});
		var calendarHtml = [];
		calendarHtml.push('<div class="memoryCalendarNav">');
		calendarHtml.push('<button class="memoryCalendarNavBtn" type="button" data-year="' + (focusYear - 1) + '" data-month="' + focusMonth + '" aria-label="上一年" title="上一年"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" stroke="#24f0ea" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 3L9 8l5 5" stroke="#24f0ea" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>');
		calendarHtml.push('<button class="memoryCalendarNavBtn" type="button" data-year="' + (focusMonth === 1 ? focusYear - 1 : focusYear) + '" data-month="' + (focusMonth === 1 ? 12 : focusMonth - 1) + '" aria-label="上月" title="上月"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" stroke="#24f0ea" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>');
		calendarHtml.push('<span class="memoryCalendarTitle">' + focusYear + '年' + focusMonth + '月</span>');
		calendarHtml.push('<button class="memoryCalendarNavBtn" type="button" data-year="' + (focusMonth === 12 ? focusYear + 1 : focusYear) + '" data-month="' + (focusMonth === 12 ? 1 : focusMonth + 1) + '" aria-label="下月" title="下月"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" stroke="#24f0ea" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>');
		calendarHtml.push('<button class="memoryCalendarNavBtn" type="button" data-year="' + (focusYear + 1) + '" data-month="' + focusMonth + '" aria-label="下一年" title="下一年"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" stroke="#24f0ea" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 3l5 5-5 5" stroke="#24f0ea" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>');
		calendarHtml.push('</div>');
		calendarHtml.push('<div class="memoryCalendarGrid">');
		calendarHtml.push('<span class="memoryCalendarDow">日</span><span class="memoryCalendarDow">一</span><span class="memoryCalendarDow">二</span><span class="memoryCalendarDow">三</span><span class="memoryCalendarDow">四</span><span class="memoryCalendarDow">五</span><span class="memoryCalendarDow">六</span>');
		for (var d = 0; d < firstDow; d++) {
			calendarHtml.push('<span class="memoryCalendarDay isPlaceholder"></span>');
		}
		for (var day = 1; day <= daysInMonth; day++) {
			var dateKey = monthKey + "-" + String(day).padStart(2, "0");
			var isDone = !!monthDays[dateKey];
			calendarHtml.push('<span class="memoryCalendarDay' + (isDone ? ' isDone' : '') + '">' + day + '</span>');
		}
		calendarHtml.push('</div>');
		current.innerHTML = '<div class="memoryCompletion"><h2>今日计划已完成</h2><p class="memoryCompletionSub">累计学习 ' + totalDays + ' 天</p><div class="memoryCalendar">' + calendarHtml.join("") + '</div></div>';
		var history = document.getElementById("memoryHistory");
		if (history) { history.innerHTML = ""; }
		var navBtns = current.querySelectorAll(".memoryCalendarNavBtn");
		for (var nb = 0; nb < navBtns.length; nb++) {
			navBtns[nb].addEventListener("click", function(e) {
				var btn = e.currentTarget;
				renderCompletionCalendar(current, parseInt(btn.getAttribute("data-year"), 10), parseInt(btn.getAttribute("data-month"), 10));
			});
		}
	}

	function renderHiddenMemory(solving) {
		var current = document.getElementById("memoryCurrent");
		if (!current) {
			return;
		}
		var text = solving ? "正在还原…<br>重新尝试：任意面转一周、按下 Backspace或点击此处" : "请开始还原…<br>点击此处显示答案。";
		current.innerHTML = '<button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><button id="memoryPrompt" class="memoryPrompt" type="button">' + text + '</button>';
	}

	function optionLabels() {
		var fourth = memory.currentFormula && isNewFormula(memory.currentFormula.id) ? "不会" : "遗忘";
		return ["清晰", "犹豫", "模糊", fourth];
	}

	function averageOf(times, count) {
		if (!Array.isArray(times) || times.length < count) {
			return null;
		}
		var sample = times.slice(times.length - count).filter(function(value) {
			return typeof value === "number" && isFinite(value);
		});
		if (sample.length < count) {
			return null;
		}
		sample.sort(function(a, b) { return a - b; });
		var trim = Math.max(1, Math.ceil(count * 0.05));
		var middle = sample.slice(trim, sample.length - trim);
		return middle.reduce(function(sum, value) { return sum + value; }, 0) / middle.length;
	}

	function formatDuration(value) {
		if (typeof value !== "number" || !isFinite(value)) {
			return "--";
		}
		return (value / 1000).toFixed(2) + "s";
	}

	function renderAnswerMemory() {
		var current = document.getElementById("memoryCurrent");
		if (!current || !memory.currentFormula) {
			return;
		}
		var progress = getProgress(memory.currentFormula.id);
		var previewTimes = progress.aoTimes.slice();
		if (typeof memory.solveTime === "number") {
			previewTimes.push(memory.solveTime);
		}
		var stats = [5, 10, 50].map(function(count) {
			return formatDuration(averageOf(previewTimes, count));
		});
		var labels = optionLabels();
		var lastRating = (typeof memory.lastChoiceShown === "number") ? memory.lastChoiceShown : null;
		var options = labels.map(function(label, index) {
			var cls = "memoryOption";
			if (index === memory.selectedRating) {
				cls += " isSelected";
			}
			if (lastRating !== null && index === lastRating) {
				cls += " isLastChoice";
			}
			return '<button class="' + cls + '" style="--memoryColor:' + RATING_COLORS[index] + '" type="button" data-memory-rating="' + index + '">' + app.escapeHtml(label) + '</button>';
		}).join("");
		current.innerHTML = '<button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><div class="memoryAnswer"><strong class="memoryAnswerName">' + app.escapeHtml(memory.currentFormula.name) + '</strong><div class="memoryAnswerFormula">' + app.escapeHtml(memory.currentFormula.answer || memory.currentFormula.alg || "") + '</div></div>' +
			'<div class="memoryTimes"><div class="memoryTime"><span>反应</span><strong>' + formatDuration(memory.reactionTime) + '</strong></div><div class="memoryTime"><span>AO5</span><strong>' + stats[0] + '</strong></div><div class="memoryTime"><span>AO10</span><strong>' + stats[1] + '</strong></div><div class="memoryTime"><span>AO50</span><strong>' + stats[2] + '</strong></div></div>' +
			'<p class="memoryControlHint">(R R\') 确认；D 右移；D\' 左移。</p><div class="memoryOptions">' + options + '</div>';
	}

	function renderMemoryHistory() {
		var container = document.getElementById("memoryHistory");
		if (!container || !memory.currentFormula) {
			return;
		}
		var l = lib();
		if (!l) {
			return;
		}
		var progress = getProgress(memory.currentFormula.id);
		var today = l.day.studyDate;
		var blocks = progress.dayHistory.map(function(record) {
			var index = Math.max(0, Math.min(3, Number(record.ratingIndex) || 0));
			return '<div class="memoryDay" style="--dayColor:' + RATING_COLORS[index] + '"><strong>Day' + Number(record.dayNumber || 1) + '</strong><span>' + app.escapeHtml(record.label || RATING_NAMES[index]) + '</span></div>';
		});
		var first = progress.firstLearnStudyDate || today;
		var currentDay = daysBetween(first, today) + 1;
		var due = dueDate(progress);
		var scheduled = due ? studyDate(due.getTime()) : "";
		var overdue = scheduled && scheduled < today ? daysBetween(scheduled, today) : 0;
		var statusLabel = overdue ? '逾期' + overdue + '天' : (isNewFormula(memory.currentFormula.id) ? '新学' : '复习');
		blocks.push('<div class="memoryDay isStatus' + (overdue ? ' isOverdue' : '') + '" style="--dayColor:#5d4ea8"><strong>Day' + currentDay + '</strong><span>' + app.escapeHtml(statusLabel) + '</span></div>');
		container.innerHTML = '<div class="memoryHistoryTitle">历史</div><div class="memoryDayList">' + blocks.join("") + '</div>';
		requestAnimationFrame(function() {
			container.scrollTop = container.scrollHeight;
		});
	}

	/* ---------- Timer ---------- */

	function startTimer() {
		stopTimer();
		var tick = function() {
			if (memory.state !== "solving") {
				return;
			}
			memory.timerFrame = requestAnimationFrame(tick);
		};
		memory.timerFrame = requestAnimationFrame(tick);
	}

	function stopTimer() {
		if (memory.timerFrame) {
			cancelAnimationFrame(memory.timerFrame);
			memory.timerFrame = null;
		}
	}

	function beginSolve(now) {
		memory.state = "solving";
		memory.firstMoveTime = now;
		memory.attemptStartTime = now;
		memory.reactionTime = Math.max(0, now - memory.stateShownTime);
		renderHiddenMemory(true);
		startTimer();
	}

	/* ---------- Move handling ---------- */

	function areAdjacentInverse(a, b) {
		var first = /^([URFDLB])('?)$/.exec(a || "");
		var second = /^([URFDLB])('?)$/.exec(b || "");
		return !!(first && second && first[1] === second[1] && first[2] !== second[2]);
	}

	function isFullTurn(moves) {
		if (moves.length < 4) {
			return false;
		}
		var last = moves.slice(-4);
		var match = /^([URFDLB])('?)$/.exec(last[0]);
		return !!(match && last.every(function(move) { return move === last[0]; }));
	}

	function memoryControlTextFromMove(move) {
		if (!move || move.type !== "face") {
			return "";
		}
		var face = typeof app.unmapUiFace === "function" ? app.unmapUiFace(move.face) : move.face;
		return app.formatMoveText(face, move.pow);
	}

	function handleMemorySmartMove(playedMove) {
		if (app.currentMode !== "memory" || !memory.currentFormula) {
			return;
		}
		var normalized = playedMove && playedMove.type ? playedMove : app.normalizeMove(playedMove);
		if (!normalized || normalized.type !== "face") {
			return;
		}
		var text = memoryControlTextFromMove(normalized);
		if (!text) {
			return;
		}
		if (memory.state === "answer") {
			handleAnswerMove(text);
			return;
		}
		var now = performance.now();
		if (memory.state === "hidden") {
			beginSolve(now);
		}
		if (memory.state !== "solving") {
			return;
		}
		var previous = memory.attemptMoves[memory.attemptMoves.length - 1];
		memory.attemptMoves.push(text);
		if (areAdjacentInverse(previous, text)) {
			memory.repeatedMove = true;
		}
		if (isFullTurn(memory.attemptMoves)) {
			memory.repeatedMove = true;
			retryCurrentFormula();
		}
	}

	function handleAnswerMove(text) {
		if (text === "D") {
			selectRating((memory.selectedRating + 1) % 4, true);
			memory.lastAnswerMove = null;
			return;
		}
		if (text === "D'") {
			selectRating((memory.selectedRating + 3) % 4, true);
			memory.lastAnswerMove = null;
			return;
		}
		if (text === "R'") {
			if (memory.lastAnswerMove === "R") {
				memory.lastAnswerMove = null;
				confirmRating();
				return;
			}
			memory.lastAnswerMove = null;
			return;
		}
		memory.lastAnswerMove = text === "R" ? "R" : null;
	}

	function retryCurrentFormula() {
		if (!memory.currentFormula || (memory.state !== "solving" && memory.state !== "hidden")) {
			return;
		}
		var now = performance.now();
		if (memory.attemptStartTime !== null) {
			memory.accumulatedSolveTime += Math.max(0, now - memory.attemptStartTime);
		}
		if (typeof memory.reactionTime === "number") {
			memory.accumulatedReactionTime += memory.reactionTime;
		}
		memory.retried = true;
		memory.state = "hidden";
		memory.firstMoveTime = null;
		memory.attemptStartTime = null;
		memory.reactionTime = null;
		memory.attemptMoves = [];
		memory.skipNextDetection = true;
		stopTimer();
		applyMemoryFormula();
		renderHiddenMemory(false);
	}

	function showAnswer(reason) {
		if (!memory.currentFormula || memory.state === "answer") {
			return;
		}
		var now = performance.now();
		if (memory.state === "solving" && memory.attemptStartTime !== null) {
			memory.accumulatedSolveTime += Math.max(0, now - memory.attemptStartTime);
			memory.solveTime = memory.accumulatedSolveTime;
		} else {
			memory.solveTime = null;
		}
		if (typeof memory.reactionTime === "number") {
			memory.reactionTime = memory.accumulatedReactionTime + memory.reactionTime;
		}
		memory.state = "answer";
		memory.answerReason = reason || "reveal";
		// 原先正常默认选择逻辑保持不变（=3）。
		memory.selectedRating = 3;
		memory.lastChoiceShown = null;
		// 仅当“返回先前的公式后再点开答案”时，才用上次选择覆盖默认。
		if (memory.justReturned) {
			memory.justReturned = false;
			var stored = memory.lastChoiceByFormula[memory.currentFormula.id];
			if (typeof stored === "number" && stored >= 0 && stored <= 3) {
				memory.selectedRating = stored;
				memory.lastChoiceShown = stored;
			}
		}
		memory.manualSelection = false;
		stopTimer();
		renderAnswerMemory();
		renderMemoryHistory();
	}

	function solvedCurrentFormula() {
		if (memory.state !== "solving") {
			return;
		}
		var now = performance.now();
		memory.accumulatedSolveTime += Math.max(0, now - memory.attemptStartTime);
		memory.solveTime = memory.accumulatedSolveTime;
		if (typeof memory.reactionTime === "number") {
			memory.reactionTime = memory.accumulatedReactionTime + memory.reactionTime;
		}
		memory.state = "answer";
		memory.answerReason = "solved";
		// 解题直接出答案走原有反应时默认逻辑，不应用“返回再点开”的上次选择覆盖。
		memory.justReturned = false;
		memory.lastChoiceShown = null;
		var l = lib();
		if (memory.retried || memory.repeatedMove) {
			memory.selectedRating = 2;
		} else {
			memory.selectedRating = memory.reactionTime <= Number((l && l.thresholdData.threshold) || 500) ? 0 : 1;
		}
		memory.manualSelection = false;
		stopTimer();
		renderAnswerMemory();
		renderMemoryHistory();
	}

	function updateMemorySolveDetection(facelet, hadCubeMove) {
		if (app.currentMode !== "memory" || !memory.currentFormula || memory.state === "answer") {
			return;
		}
		if (memory.skipNextDetection) {
			memory.skipNextDetection = false;
			return;
		}
		var normalized = String(facelet || "").toUpperCase().replace(/[^URFDLB]/g, "");
		var hasFacelet = normalized.length === 54;
		var faceletSolved = hasFacelet && app.isFaceletSolved(normalized);
		var hasVirtual = !!app.virtualCubie;
		var virtualSolved = hasVirtual && app.isVirtualStateSolved();
		var canSolveFacelet = !hasVirtual && faceletSolved && memory.sawUnsolvedFacelet && hadCubeMove && memory.attemptMoves.length > 0;
		var canSolveVirtual = hasVirtual && virtualSolved && memory.sawUnsolvedVirtual && memory.attemptMoves.length > 0;
		if (memory.state === "solving" && (canSolveFacelet || canSolveVirtual)) {
			solvedCurrentFormula();
			return;
		}
		if (hasFacelet && !faceletSolved) {
			memory.sawUnsolvedFacelet = true;
		}
		if (hasVirtual && !virtualSolved) {
			memory.sawUnsolvedVirtual = true;
		}
	}

	function selectRating(index, manual) {
		if (memory.state !== "answer") {
			return;
		}
		memory.selectedRating = ((Number(index) % 4) + 4) % 4;
		if (manual) {
			memory.manualSelection = true;
		}
		renderAnswerMemory();
	}

	function updateThresholdFromManualChoice() {
		if (!memory.manualSelection || memory.selectedRating > 1 || typeof memory.reactionTime !== "number") {
			return;
		}
		var l = lib();
		if (!l) {
			return;
		}
		var threshold = l.thresholdData;
		var precision = Math.max(1, Number(threshold.precision) || 2);
		var observation = Math.max(80, memory.reactionTime + (memory.selectedRating === 0 ? 125 : -125));
		threshold.threshold = Math.round((Number(threshold.threshold || 500) * precision + observation) / (precision + 1));
		threshold.precision = Math.min(40, precision + 1);
	}

	/* ---------- Checkpoint & undo ---------- */

	function makeCheckpoint() {
		var copy = JSON.parse(JSON.stringify(memory.data));
		Object.keys(copy.libraries || {}).forEach(function(lid) {
			delete copy.libraries[lid].undoStack;
		});
		return copy;
	}

	function scheduleResult(module, progress, rating) {
		var card = progress.card ? reviveDates(progress.card) : module.createEmptyCard(new Date());
		var now = new Date();
		var result = typeof memory.scheduler.next === "function" ? memory.scheduler.next(card, now, rating) : memory.scheduler.repeat(card, now)[rating];
		return { card: result.card, log: result.log };
	}

	function confirmRating() {
		if (memory.state !== "answer" || memory.confirming || !memory.currentFormula || !memory.currentItem) {
			return;
		}
		// UI 层记录本次选择，供“返回上一公式再点开答案”默认选中；不进 memory.data、不被 undo 回滚。
		memory.lastChoiceByFormula[memory.currentFormula.id] = memory.selectedRating;
		memory.justReturned = false;
		memory.confirming = true;
		ensureFsrs().then(function(module) {
			var formula = memory.currentFormula;
			var item = memory.currentItem;
			var progress = getProgress(formula.id);
			var wasNew = isNewFormula(formula.id);
			var ratings = [module.Rating.Easy, module.Rating.Good, module.Rating.Hard, module.Rating.Again];
			var scheduled = null;
			if (!item.reinforcement) {
				scheduled = scheduleResult(module, progress, ratings[memory.selectedRating]);
			}
			var l = lib();
			var undoEntry = { formulaId: formula.id, checkpoint: makeCheckpoint() };
			l.undoStack.push(undoEntry);
			if (l.undoStack.length > 20) {
				l.undoStack.shift();
			}
			updateThresholdFromManualChoice();
			if (scheduled) {
				progress.card = scheduled.card;
				progress.logs.push(scheduled.log);
			}
			progress.attempts.push({
				studyDate: l.day.studyDate,
				ratingIndex: memory.selectedRating,
				solveTime: typeof memory.solveTime === "number" ? memory.solveTime : null,
				reactionTime: typeof memory.reactionTime === "number" ? memory.reactionTime : null,
				retried: memory.retried,
				reinforcement: !!item.reinforcement,
				time: new Date()
			});
			if (memory.answerReason === "solved" && typeof memory.reactionTime === "number") {
				progress.aoTimes.push(memory.reactionTime);
				if (progress.aoTimes.length > 200) {
					progress.aoTimes = progress.aoTimes.slice(-200);
				}
			}
			var today = l.day.studyDate;
			if (wasNew && !progress.firstLearnStudyDate) {
				progress.firstLearnStudyDate = today;
			}
			var dayNumber = daysBetween(progress.firstLearnStudyDate || today, today) + 1;
			var existingDay = progress.dayHistory.find(function(record) { return record.studyDate === today; });
			var confirmedLabels = ["清晰", "犹豫", "模糊", wasNew ? "不会" : "遗忘"];
			var dayRecord = { studyDate: today, dayNumber: dayNumber, ratingIndex: memory.selectedRating, label: confirmedLabels[memory.selectedRating] };
			if (existingDay) {
				Object.assign(existingDay, dayRecord);
			} else {
				progress.dayHistory.push(dayRecord);
			}
			if (l.day.learnedIds.indexOf(formula.id) < 0) {
				l.day.learnedIds.push(formula.id);
			}
			l.queue.shift();
			if (item.reinforcement) {
				l.todayQueue = l.todayQueue.filter(function(entry) { return entry.id !== formula.id; });
			} else if (memory.selectedRating >= 2 && !l.todayQueue.some(function(entry) { return entry.id === formula.id; })) {
				var repeat = { id: formula.id, reinforcement: true };
				l.todayQueue.push(repeat);
				l.queue.push(repeat);
			}
			saveData();
			memory.confirming = false;
			startNextFormula();
		}).catch(function(error) {
			memory.confirming = false;
			showToast("FSRS 加载失败，未保存本次选择：" + String(error && error.message || error));
		});
	}

	function goBackPrevious() {
		var l = lib();
		if (!l) {
			return;
		}
		var stack = l.undoStack || [];
		if (!stack.length) {
			showToast("没有上一公式");
			return;
		}
		var undo = stack[stack.length - 1];
		var remaining = stack.slice(0, -1);
		memory.data = mergeLoadedData(undo.checkpoint);
		lib().undoStack = remaining;
		saveData();
		// 标记本次加载来自“返回上一公式”，供点开答案时用上次选择覆盖默认。
		memory.justReturned = true;
		startNextFormula();
	}

	function maybeOfferDueContinuation() {
		if (memory.currentFormula || memory.promptedContinue) {
			return;
		}
		var l = lib();
		if (!l) {
			return;
		}
		var due = remainingDueItems();
		if (l.day.learnedIds.length >= l.settings.dailyCount && due.length) {
			memory.promptedContinue = true;
			openConfirmDialog("今日计划已完成", "仍有 " + due.length + " 个到期公式，是否继续学习？继续后只安排到期复习，不加入新公式。", "继续复习", function() {
				buildDailyQueue(true);
				saveData();
				startNextFormula();
			});
		}
	}

	/* ---------- Plan dialog ---------- */

	function collectModeTransferText(sourceMode) {
		var pieces = [];
		var textarea = document.getElementById("stateTextInput");
		if (textarea && textarea.value.trim()) {
			pieces.push(textarea.value.trim());
		} else if (app.stateImportText && String(app.stateImportText).trim()) {
			pieces.push(String(app.stateImportText).trim());
		}
		if (sourceMode === "formula" && app.buildFormulaExportText) {
			var made = app.buildFormulaExportText();
			if (made && made.trim()) {
				pieces.push(made.trim());
			}
		}
		if (sourceMode === "library" && app.buildSelectedLibraryExportText) {
			var selected = app.buildSelectedLibraryExportText();
			if (selected && selected.trim()) {
				pieces.push(selected.trim());
			}
		}
		return pieces.join("\n");
	}

	function joinPlanText(first, second) {
		var left = String(first || "").trim();
		var right = String(second || "").trim();
		return left && right ? left + "\n" + right : left || right;
	}

	function commitPlanText(text) {
		var parsed = app.parseStateDefinitions(text || "");
		if (!parsed.states.length && String(text || "").trim()) {
			showToast("未读取到有效公式，请使用\u201c名称：公式;\u201d格式");
			return false;
		}
		var l = lib();
		if (!l) {
			return false;
		}
		var previous = (l.allFormulas || l.formulas || []).slice();
		function findPreviousCustomState(state) {
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
		var formulas = parsed.states.map(function(state, index) {
			var same = previous[index] && previous[index].name === state.name && previous[index].alg === state.alg ? previous[index] : null;
			var id = same ? same.id : "memory_formula_" + Date.now() + "_" + l.idSeed++;
			var existing = same || previous.find(function(p) { return p.name === state.name && p.alg === state.alg; });
			var customSolvedState = existing ? (existing.customSolvedState || null) : findPreviousCustomState(state);
			return {
				id: id,
				image: existing ? (existing.image || null) : null,
				name: state.name,
				alg: state.alg,
				formula: state.alg,
				answer: app.invertFormulaDisplayText(state.alg || "", state.moves || []),
				moves: state.moves.slice(),
				customSolvedState: customSolvedState
			};
		});
		l.planText = String(text || "");
		l.formulas = formulas;
		l.allFormulas = formulas.slice();
		l.queue = [];
		l.todayQueue = [];
		l.undoStack = [];
		formulas.forEach(function(formula) { getProgress(formula.id); });
		saveData();
		ensureFsrs().then(function(module) {
			formulas.forEach(function(formula) {
				var progress = getProgress(formula.id);
				if (!progress.card) {
					progress.card = module.createEmptyCard(new Date());
				}
			});
			saveData();
		}).catch(function() {});
		app._notifyActiveLibraryChanged();
		if (app.currentMode === "memory") {
			startMemoryMode();
		}
		return true;
	}

	function openPlanDialog() {
		if (memory.pendingAutofill) {
			commitPlanText(joinPlanText((lib() || {}).planText || "", memory.pendingAutofill));
			memory.pendingAutofill = "";
		}

		var l = lib();
		if (!l) { showToast("数据库错误，请刷新页面"); return; }

		var allFormulas = (l.allFormulas && l.allFormulas.length ? l.allFormulas : (l.formulas || [])).slice();
		var selectedIds = {};
		(l.formulas || []).forEach(function(f) { selectedIds[f.id] = true; });

		function renderFormulaList(container) {
			var html = '';
			allFormulas.forEach(function(f) {
				var learned = !isNewFormula(f.id);
				var checked = selectedIds[f.id];
				var checkClass = 'memoryFormulaCheck';
				if (checked) {
					checkClass += learned ? ' isLearned' : ' isSelected';
				}
				var displayName = f.name || '';
				var displayAlg = (f.alg || f.formula || '').replace(/\s+/g, ' ');
				html += '<div class="memoryFormulaRow" data-formula-id="' + app.escapeHtml(f.id) + '">' +
					'<span class="' + checkClass + '" role="checkbox" aria-checked="' + (checked ? 'true' : 'false') + '"></span>' +
					'<span class="memoryFormulaLabel"><strong>' + app.escapeHtml(displayName) + ': </strong>' + app.escapeHtml(displayAlg) + '</span>' +
					'</div>';
			});
			container.innerHTML = html;
		}

		function updateCheckVisual(row, checked) {
			var check = row.querySelector('.memoryFormulaCheck');
			var fid = row.getAttribute('data-formula-id');
			var learned = !isNewFormula(fid);
			check.className = 'memoryFormulaCheck';
			if (checked) {
				check.classList.add(learned ? 'isLearned' : 'isSelected');
			}
			check.setAttribute('aria-checked', checked ? 'true' : 'false');
		}

		function reloadLibraryContent() {
			var nl = lib();
			allFormulas = (nl.allFormulas && nl.allFormulas.length ? nl.allFormulas : (nl.formulas || [])).slice();
			selectedIds = {};
			(nl.formulas || []).forEach(function(f) { selectedIds[f.id] = true; });
			renderFormulaList(listContainer);
			var dailyInput = overlay.querySelector("#memoryDailyCount");
			if (dailyInput && document.activeElement !== dailyInput) {
				dailyInput.value = String(nl.settings.dailyCount || 10);
			}
			updatePlanCounter();
		}

	function renderLibrarySelector() {
		var textEl = document.getElementById("memoryLibraryCurrentText");
		var menu = document.getElementById("memoryLibraryMenu");
		var lid = memory.data.activeLibraryId;
		if (textEl) {
			textEl.textContent = (memory.data.libraries[lid] || {}).name || lid;
		}
		if (menu) {
			menu.innerHTML = Object.keys(memory.data.libraries).filter(function(libId) {
				return libId !== lid;
			}).map(function(libId) {
				var libName = memory.data.libraries[libId].name || libId;
				return '<button class="memoryLibraryOption" type="button" data-library-id="' + app.escapeHtml(libId) + '">' + app.escapeHtml(libName) + '</button>';
			}).join('');
		}
	}

	function closeLibraryMenu() {
		var selector = document.getElementById("memoryLibrarySelector");
		if (selector) selector.classList.remove("isOpen");
	}

		var overlay = createOverlay('<div class="memoryDialog memoryPlanDialog" role="dialog" aria-modal="true"><div class="memoryDialogHeader"><strong>规划学习</strong><button class="button secondary small" type="button" data-memory-close>关闭</button></div><div class="memoryLibraryBar"><div id="memoryLibrarySelector" class="memoryLibrarySelector"><button id="memoryLibraryCurrent" class="memoryLibraryCurrent" type="button" aria-haspopup="true" aria-expanded="false"><span id="memoryLibraryCurrentText" class="memoryLibraryCurrentText"></span><span class="memoryLibraryChevron"></span></button><div id="memoryLibraryMenu" class="memoryLibraryMenu"></div></div><input id="memoryLibraryNameInput" class="memoryLibraryNameInput" type="text" maxlength="30"><button id="memoryLibraryAddBtn" class="memoryLibraryIconBtn" type="button" title="新建公式库"><svg class="memoryIconPlus" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><svg class="memoryIconAddCheck" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none"><path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="memoryLibraryRenameBtn" class="memoryLibraryIconBtn" type="button" title="重命名当前库"><svg class="memoryIconPencil" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5L13.5 4.5L5 13L2 14L3 11L11.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 4.5L11.5 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><svg class="memoryIconCheck" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none"><path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="memoryLibraryDeleteBtn" class="memoryLibraryIconBtn" type="button" title="删除当前库"><svg class="memoryIconTrash" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><svg class="memoryIconClose" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div><div class="memoryFormulaListWrap"><div class="memoryFormulaList"></div><button id="memoryEditPlanBtn" class="memoryEditPlanBtn" type="button" title="编辑公式文本" aria-label="编辑公式文本"></button></div><div class="memoryDialogBottom"><label class="memoryDailyLabel">每日公式数 <input id="memoryDailyCount" class="memoryDailyInput" type="number" min="1" max="999" value="' + (l.settings.dailyCount || 10) + '"></label><span id="memoryPlanCount" class="memoryPlanCount">[0]/[' + (l.settings.dailyCount || 10) + ']</span></div><div class="memoryDialogActions"><button class="button secondary" type="button" data-memory-close>取消</button><button id="memorySavePlanBtn" class="button" type="button">保存计划</button></div></div>');

		var listContainer = overlay.querySelector('.memoryFormulaList');
		renderFormulaList(listContainer);
		renderLibrarySelector();

		/* Library selector toggle */
		overlay.querySelector("#memoryLibraryCurrent").addEventListener("click", function() {
			var selector = document.getElementById("memoryLibrarySelector");
			if (selector) selector.classList.toggle("isOpen");
		});

		/* Library menu selection */
		overlay.querySelector("#memoryLibraryMenu").addEventListener("click", function(e) {
			var option = e.target.closest(".memoryLibraryOption");
			if (!option) return;
			var newId = option.getAttribute("data-library-id");
			if (!newId || newId === memory.data.activeLibraryId) return;
			memory.data.activeLibraryId = newId;
			saveData();
			loadLibraryMask();
			closeLibraryMenu();
			renderLibrarySelector();
			reloadLibraryContent();
		});

		/* Close library menu when clicking outside */
		document.addEventListener("mousedown", function(e) {
			var selector = document.getElementById("memoryLibrarySelector");
			if (selector && selector.classList.contains("isOpen") && !selector.contains(e.target)) {
				closeLibraryMenu();
			}
		});

		var libraryBar = overlay.querySelector(".memoryLibraryBar");
		var nameInput = overlay.querySelector("#memoryLibraryNameInput");

		function enterEditing(mode) {
			if (libraryBar.classList.contains("isEditing") || libraryBar.classList.contains("isCreating")) return;
			var addBtn = overlay.querySelector("#memoryLibraryAddBtn");
			var renameBtn = overlay.querySelector("#memoryLibraryRenameBtn");
			var deleteBtn = overlay.querySelector("#memoryLibraryDeleteBtn");
			if (mode === "create") {
				nameInput.value = "";
				nameInput.placeholder = "输入公式库名称";
				libraryBar.classList.add("isCreating");
				if (addBtn) addBtn.title = "确认新建";
				if (renameBtn) renameBtn.title = "重命名当前库";
				if (deleteBtn) deleteBtn.title = "取消新建";
			} else {
				nameInput.value = (lib() || {}).name || "";
				nameInput.placeholder = "";
				libraryBar.classList.add("isEditing");
				if (addBtn) addBtn.title = "新建公式库";
				if (renameBtn) renameBtn.title = "保存名称";
				if (deleteBtn) deleteBtn.title = "删除当前库";
			}
			nameInput.focus();
			nameInput.select();
		}

		function exitEditing() {
			libraryBar.classList.remove("isEditing", "isCreating");
			var addBtn = overlay.querySelector("#memoryLibraryAddBtn");
			var renameBtn = overlay.querySelector("#memoryLibraryRenameBtn");
			var deleteBtn = overlay.querySelector("#memoryLibraryDeleteBtn");
			if (addBtn) addBtn.title = "新建公式库";
			if (renameBtn) renameBtn.title = "重命名当前库";
			if (deleteBtn) deleteBtn.title = "删除当前库";
		}

		function commitEditing() {
			var isCreating = libraryBar.classList.contains("isCreating");
			var newName = nameInput.value.trim();
			exitEditing();
			if (isCreating) {
				if (newName) {
					createLibrary(newName);
					loadLibraryMask();
					reloadLibraryContent();
					renderLibrarySelector();
				}
			} else {
				if (newName) {
					renameLibrary(memory.data.activeLibraryId, newName);
					renderLibrarySelector();
				}
			}
		}

		overlay.querySelector("#memoryLibraryAddBtn").addEventListener("click", function() {
			if (libraryBar.classList.contains("isCreating")) {
				commitEditing();
			} else {
				enterEditing("create");
			}
		});

		overlay.querySelector("#memoryLibraryRenameBtn").addEventListener("click", function() {
			if (libraryBar.classList.contains("isEditing")) {
				commitEditing();
			} else {
				enterEditing("rename");
			}
		});

		nameInput.addEventListener("keydown", function(e) {
			if (e.key === "Enter") {
				e.preventDefault();
				commitEditing();
			}
			if (e.key === "Escape") {
				exitEditing();
			}
		});

		nameInput.addEventListener("blur", function(e) {
			var relatedTarget = e.relatedTarget;
			var isDeleteBtn = relatedTarget && relatedTarget.closest("#memoryLibraryDeleteBtn");
			var isAddBtn = relatedTarget && relatedTarget.closest("#memoryLibraryAddBtn");
			var isRenameBtn = relatedTarget && relatedTarget.closest("#memoryLibraryRenameBtn");
			if (libraryBar.classList.contains("isCreating") && (isDeleteBtn || isAddBtn)) {
				return;
			}
			if (libraryBar.classList.contains("isEditing") && isRenameBtn) {
				return;
			}
			setTimeout(function() {
				if (libraryBar.classList.contains("isEditing") || libraryBar.classList.contains("isCreating")) {
					commitEditing();
				}
			}, 150);
		});

		overlay.querySelector("#memoryLibraryDeleteBtn").addEventListener("click", function() {
			if (libraryBar.classList.contains("isCreating")) {
				exitEditing();
				return;
			}
			if (Object.keys(memory.data.libraries).length <= 1) {
				showToast("至少保留一个公式库");
				return;
			}
			var currentName = lib().name || "";
			openConfirmDialog("删除公式库", "确定删除「" + currentName + "」？该库的所有公式和记忆数据将被永久删除。", "删除", function() {
				deleteLibrary(memory.data.activeLibraryId);
				loadLibraryMask();
				reloadLibraryContent();
				renderLibrarySelector();
			});
		});

		/* Save plan */
		overlay.querySelector("#memorySavePlanBtn").addEventListener("click", function() {
			var kept = allFormulas.filter(function(f) { return selectedIds[f.id]; });
			if (kept.length === 0) {
				showToast("请至少选择一个公式");
				return;
			}
			var sl = lib();
			sl.formulas = kept;
			sl.allFormulas = allFormulas.slice();
			sl.planText = formulasToPlanText(allFormulas);
			sl.queue = [];
			sl.todayQueue = [];
			sl.undoStack = [];
			memory.pendingAutofill = "";
			saveData();
			if (app.currentMode === "memory") {
				startMemoryMode();
			}
			closeOverlay(overlay);
		});

		/* Daily count */
		overlay.querySelector("#memoryDailyCount").addEventListener("change", function(event) {
			lib().settings.dailyCount = Math.max(1, Math.min(999, Math.round(Number(event.target.value) || 10)));
			saveData();
			updatePlanCounter();
		});

		/* Edit plan */
		overlay.querySelector("#memoryEditPlanBtn").addEventListener("click", function() {
			openPlanEditDialog(allFormulas, selectedIds, function() {
				allFormulas = lib().allFormulas.slice();
				allFormulas.forEach(function(f) {
					if (!(f.id in selectedIds)) {
						selectedIds[f.id] = true;
					}
				});
				renderFormulaList(listContainer);
				updatePlanCounter();
			});
		});

		/* Formula list interactions */
		listContainer.addEventListener("click", function(event) {
			var check = event.target.closest('.memoryFormulaCheck');
			if (!check) return;
			var row = check.closest('.memoryFormulaRow');
			if (!row) return;
			var fid = row.getAttribute('data-formula-id');
			var currentlyChecked = selectedIds[fid];
			if (currentlyChecked && !isNewFormula(fid)) {
				openConfirmDialog("取消学习", "该公式已开始学习，确定取消选择？", "确认取消", function() {
					selectedIds[fid] = false;
					updateCheckVisual(row, false);
				});
			} else {
				selectedIds[fid] = !currentlyChecked;
				updateCheckVisual(row, selectedIds[fid]);
			}
		});

		listContainer.addEventListener("dblclick", function(event) {
			var check = event.target.closest('.memoryFormulaCheck');
			if (!check) return;
			var row = check.closest('.memoryFormulaRow');
			if (!row) return;
			var fid = row.getAttribute('data-formula-id');
			var targetChecked = !selectedIds[fid];
			var rows = listContainer.querySelectorAll('.memoryFormulaRow');
			var found = false;
			var hasLearnedToUncheck = false;
			if (!targetChecked) {
				for (var i = 0; i < rows.length; i++) {
					var r = rows[i];
					var rfid = r.getAttribute('data-formula-id');
					if (rfid === fid) { found = true; }
					if (found && selectedIds[rfid] && !isNewFormula(rfid)) {
						hasLearnedToUncheck = true;
						break;
					}
				}
			}
			if (hasLearnedToUncheck) {
				openConfirmDialog("批量取消学习", "包含已开始学习的公式，确定批量取消选择？", "确认取消", function() {
					doBatchToggle(listContainer, fid, targetChecked);
				});
			} else {
				doBatchToggle(listContainer, fid, targetChecked);
			}
		});

		function doBatchToggle(container, startId, targetChecked) {
			var rows = container.querySelectorAll('.memoryFormulaRow');
			var found = false;
			for (var i = 0; i < rows.length; i++) {
				var r = rows[i];
				var rfid = r.getAttribute('data-formula-id');
				if (rfid === startId) { found = true; }
				if (found) {
					if (targetChecked && !selectedIds[rfid]) {
						selectedIds[rfid] = true;
						updateCheckVisual(r, true);
					} else if (!targetChecked && selectedIds[rfid]) {
						selectedIds[rfid] = false;
						updateCheckVisual(r, false);
					}
				}
			}
		}

		updatePlanCounter();
	}

	function formulasToPlanText(formulas) {
		return formulas.map(function(f) {
			var alg = f.alg || f.formula || '';
			if (!alg.endsWith(';')) {
				alg += ';';
			}
			return f.name + ': ' + alg;
		}).join('\n');
	}

	function openPlanEditDialog(formulas, selectedIds, onSaved) {
		var currentText = formulasToPlanText(formulas);
		var editOverlay = createOverlay('<div class="memoryDialog" role="dialog" aria-modal="true"><div class="memoryDialogHeader"><strong>编辑公式</strong><button class="button secondary small" type="button" data-memory-close>关闭</button></div><p>每行或连续文本均可，沿用 TXT 的"名称: 公式;"格式；重复公式会原样保留。</p><textarea id="memoryPlanEditTextarea" class="memoryPlanTextarea" spellcheck="false"></textarea><div class="memoryDialogActions"><button class="button secondary" type="button" data-memory-close>取消</button><button id="memoryEditSaveBtn" class="button" type="button">保存</button></div></div>');
		var textarea = editOverlay.querySelector("#memoryPlanEditTextarea");
		textarea.value = currentText;
		editOverlay.querySelector("#memoryEditSaveBtn").addEventListener("click", function() {
			if (commitPlanText(textarea.value)) {
				closeOverlay(editOverlay);
				if (onSaved) onSaved();
			}
		});
		requestAnimationFrame(function() { textarea.focus(); });
	}

	/* ---------- Overlay utilities ---------- */

	function createOverlay(html) {
		var overlay = document.createElement("div");
		overlay.className = "memoryOverlay";
		overlay.innerHTML = html;
		document.body.appendChild(overlay);
		overlay.querySelectorAll("[data-memory-close]").forEach(function(button) {
			button.addEventListener("click", function() { closeOverlay(overlay); });
		});
		var pressedInsideDialog = false;
		overlay.addEventListener("mousedown", function(event) {
			pressedInsideDialog = event.target !== overlay;
		});
		overlay.addEventListener("mouseup", function(event) {
			if (event.target === overlay && !pressedInsideDialog) {
				closeOverlay(overlay);
			}
		});
		requestAnimationFrame(function() { overlay.classList.add("isOpen"); });
		return overlay;
	}

	function closeOverlay(overlay) {
		if (!overlay) {
			return;
		}
		overlay.classList.remove("isOpen");
		setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 170);
	}

	function openConfirmDialog(title, message, confirmText, onConfirm, onCancel) {
		var overlay = createOverlay('<div class="memoryDialog" role="dialog" aria-modal="true"><div class="memoryDialogHeader"><strong>' + app.escapeHtml(title) + '</strong></div><p>' + app.escapeHtml(message) + '</p><div class="memoryDialogActions"><button id="memoryDialogCancel" class="button secondary" type="button">取消</button><button id="memoryDialogConfirm" class="button" type="button">' + app.escapeHtml(confirmText || "确认") + '</button></div></div>');
		overlay.querySelector("#memoryDialogCancel").addEventListener("click", function() {
			closeOverlay(overlay);
			if (onCancel) onCancel();
		});
		overlay.querySelector("#memoryDialogConfirm").addEventListener("click", function() {
			closeOverlay(overlay);
			if (onConfirm) onConfirm();
		});
	}

	function showToast(message) {
		var old = document.querySelector(".memoryToast");
		if (old) old.remove();
		var toast = document.createElement("div");
		toast.className = "memoryToast";
		toast.textContent = message;
		document.body.appendChild(toast);
		setTimeout(function() { if (toast.parentNode) toast.remove(); }, 2600);
	}

	/* ---------- Import / Export ---------- */

	function exportData() {
		var payload = JSON.stringify(memory.data, null, 2);
		var blob = new Blob([payload], { type: "application/json;charset=utf-8" });
		var url = URL.createObjectURL(blob);
		var link = document.createElement("a");
		link.href = url;
		var l = lib();
		link.download = "cube-memory-" + (l && l.day.studyDate || "export") + ".json";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	function validateImport(value) {
		if (!value) {
			return false;
		}
		/* v1 */
		if (value.schemaVersion === 1 && Array.isArray(value.formulas) && value.formulas.every(function(formula) {
			return formula && typeof formula.id === "string" && typeof formula.name === "string" && Array.isArray(formula.moves);
		}) && value.progress && typeof value.progress === "object" && value.settings && Number(value.settings.dailyCount) > 0) {
			return true;
		}
		/* v2 */
		if (value.schemaVersion === 2 && value.libraries && typeof value.libraries === "object" && !Array.isArray(value.libraries)) {
			return Object.keys(value.libraries).every(function(lid) {
				var libObj = value.libraries[lid];
				return libObj && typeof libObj === "object" && Array.isArray(libObj.formulas);
			});
		}
		return false;
	}

	function importFile(file) {
		if (!file) {
			return;
		}
		file.text().then(function(text) {
			var parsed = JSON.parse(text);
			if (!validateImport(parsed)) {
				throw new Error("数据结构或版本无效");
			}
			var replacement = mergeLoadedData(parsed);
			openConfirmDialog("替换记忆数据", "导入会替换当前全部记忆模式数据，是否继续？", "替换", function() {
				memory.data = replacement;
				ensureStudyDay();
				loadLibraryMask();
				saveData();
				startMemoryMode();
				showToast("数据已导入");
			});
		}).catch(function(error) {
			showToast("导入失败，原数据未更改：" + String(error && error.message || error));
		});
	}

	/* ---------- Panel binding ---------- */

	function bindMemoryPanel() {
		var root = document.querySelector(".memoryPanel");
		if (!root || root.dataset.memoryBound) {
			return;
		}
		root.dataset.memoryBound = "1";
		root.addEventListener("click", function(event) {
			var rating = event.target.closest("[data-memory-rating]");
			if (rating) {
				selectRating(Number(rating.getAttribute("data-memory-rating")), true);
				confirmRating();
				return;
			}
			if (event.target.closest("#memoryBackBtn")) {
				goBackPrevious();
				return;
			}
			if (event.target.closest("#memoryFullscreenBtn")) {
				event.preventDefault();
				var target = document.documentElement;
				if (!document.fullscreenElement && !document.webkitFullscreenElement) {
					(target.requestFullscreen || target.webkitRequestFullscreen || function() {}).call(target);
				} else {
					(document.exitFullscreen || document.webkitExitFullscreen || function() {}).call(document);
				}
				return;
			}
			if (event.target.closest("#memoryPrompt")) {
				if (!memory.currentFormula) {
					showToast("请先规划学习公式");
				} else if (memory.state === "solving") {
					retryCurrentFormula();
				} else {
					showAnswer("reveal");
				}
			}
		});
		var seamlessBtn = root.querySelector("#memorySeamlessBtn");
		if (seamlessBtn) {
			seamlessBtn.addEventListener("click", function() {
				app.toggleSeamlessMode();
				if (app.seamlessMode) {
					seamlessBtn.classList.add("isActive");
				} else {
					seamlessBtn.classList.remove("isActive");
				}
			});
		}
		root.querySelector("#memoryPlanBtn").addEventListener("click", openPlanDialog);
		root.querySelector("#memoryExportBtn").addEventListener("click", exportData);
		var importButton = root.querySelector("#memoryImportBtn");
		var importInput = root.querySelector("#memoryImportFile");
		importButton.addEventListener("click", function() { importInput.click(); });
		importInput.addEventListener("change", function() {
			importFile(importInput.files && importInput.files[0]);
			importInput.value = "";
		});
		["dragenter", "dragover"].forEach(function(type) {
			importButton.addEventListener(type, function(event) {
				event.preventDefault();
				importButton.classList.add("memoryDropActive");
			});
		});
		["dragleave", "drop"].forEach(function(type) {
			importButton.addEventListener(type, function(event) {
				event.preventDefault();
				importButton.classList.remove("memoryDropActive");
				if (type === "drop") importFile(event.dataTransfer && event.dataTransfer.files[0]);
			});
		});
		updatePlanCounter();
	}

	/* ---------- App patches ---------- */

	var originalInit = app.init;
	app.init = function() {
		loadData();
		ensureFsrs().catch(function() {});
		originalInit.call(this);
	};

	app.reloadMemoryData = function() {
		loadData();
		loadLibraryMask();
		if (app.currentMode === "memory") {
			startMemoryMode();
		}
	};

	var originalGetModeMeta = app.getModeMeta;
	app.getModeMeta = function(mode) {
		if (mode === "memory") {
			return { label: "记忆模式", icon: "memoryIcon", title: "记忆模式" };
		}
		return originalGetModeMeta.call(this, mode);
	};

	app.setModeChrome = function(mode) {
		var meta = this.getModeMeta(mode);
		var modes = {
			learn: { label: "学习模式", icon: "learnIcon" },
			practice: { label: "训练模式", icon: "trainIcon" },
			memory: { label: "记忆模式", icon: "memoryIcon" },
			formula: { label: "公式制作", icon: "formulaModeIcon" },
			library: { label: "公式库", icon: "libraryIcon" }
		};
		document.title = meta.title;
		this.elements.modeLabel.textContent = meta.label;
		this.elements.modeIcon.className = "modeIcon " + meta.icon;
		this.elements.modeMenu.innerHTML = ["learn", "practice", "memory", "formula", "library"].filter(function(item) { return item !== mode; }).map(function(item) {
			return '<button class="modeOption" type="button" data-mode="' + item + '" role="menuitem"><span class="modeIcon ' + modes[item].icon + '" aria-hidden="true"></span><span class="modeText">' + modes[item].label + '</span></button>';
		}).join("");
	};

	var originalSwitchMode = app.switchMode;
	app.switchMode = function(mode) {
		var sourceMode = this.currentMode;
		var transfer = mode === "memory" && sourceMode !== "memory" ? collectModeTransferText(sourceMode) : "";
		originalSwitchMode.call(this, mode);
		if (mode === "memory" && transfer) {
			memory.pendingAutofill = transfer;
			openConfirmDialog("导入公式到记忆计划", "检测到当前模式中的公式，是否追加到记忆计划？重复公式会保留。", "追加公式", function() {
				commitPlanText(joinPlanText((lib() || {}).planText || "", transfer));
				memory.pendingAutofill = "";
			}, function() {
				memory.pendingAutofill = "";
			});
		}
	};

	var originalGetPanelHtml = app.getPanelHtml;
	app.getPanelHtml = function(mode) {
		return mode === "memory" ? getMemoryPanelHtml() : originalGetPanelHtml.call(this, mode);
	};

	var originalRenderModePanel = app.renderModePanel;
	app.renderModePanel = function(mode) {
		originalRenderModePanel.call(this, mode);
		this.isMemoryMode = mode === "memory";
		if (this.isMemoryMode) {
			bindMemoryPanel();
			startMemoryMode();
		} else {
			stopTimer();
		}
	};

	var originalPlayMove = app.playMove;
	app.playMove = function(rawMove, source, timestamp, options) {
		var result = originalPlayMove.call(this, rawMove, source, timestamp, options);
		if (result && options && options.fromCube && !options.noCount) {
			handleMemorySmartMove(result);
		}
		return result;
	};

	var originalUpdateSolveDetection = app.updateSolveDetection;
	app.updateSolveDetection = function(facelet, hadCubeMove) {
		originalUpdateSolveDetection.call(this, facelet, hadCubeMove);
		updateMemorySolveDetection(facelet, hadCubeMove);
	};

	/* Monkey-patch openCustomStateDialog to persist mask per library */
	var originalOpenCustomStateDialog = app.openCustomStateDialog;
	if (originalOpenCustomStateDialog) {
		app.openCustomStateDialog = function() {
			originalOpenCustomStateDialog.call(this);
			if (app.currentMode === "memory") {
				var confirmBtn = document.getElementById("confirmCustomStateBtn");
				if (confirmBtn) {
					confirmBtn.addEventListener("click", function() {
						saveLibraryMask();
					});
				}
			}
		};
	}

	/* ---------- Keyboard ---------- */

	document.addEventListener("keydown", function(event) {
		var overlay = document.querySelector(".memoryOverlay");
		if (overlay) {
			if (event.key === "Escape") {
				closeOverlay(overlay);
			}
			event.stopImmediatePropagation();
			return;
		}
		if (app.currentMode !== "memory" || /INPUT|TEXTAREA/.test(event.target && event.target.tagName || "")) {
			return;
		}
		if (event.key === "Escape" && (document.fullscreenElement || document.webkitFullscreenElement)) {
			return;
		}
		if (memory.state === "answer" && event.key === "ArrowLeft") {
			event.preventDefault();
			selectRating((memory.selectedRating + 3) % 4, true);
			return;
		}
		if (memory.state === "answer" && event.key === "ArrowRight") {
			event.preventDefault();
			selectRating((memory.selectedRating + 1) % 4, true);
			return;
		}
		if (memory.state === "answer" && event.key === "Enter") {
			event.preventDefault();
			confirmRating();
			return;
		}
		if (event.key !== "Backspace") {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		if (memory.state === "answer") {
			goBackPrevious();
		} else {
			retryCurrentFormula();
		}
	}, true);

	/* ---------- Fullscreen ---------- */

	function syncFullscreenMode() {
		var isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
		document.body.classList.toggle("memoryFullscreenMode", isFullscreen);
		var btn = document.getElementById("memoryFullscreenBtn");
		if (btn) {
			btn.classList.toggle("isFullscreen", isFullscreen);
		}
	}
	document.addEventListener("fullscreenchange", syncFullscreenMode);
	document.addEventListener("webkitfullscreenchange", syncFullscreenMode);

	/* ---------- Shared formula API for learn/practice modes ---------- */

	app.getActiveLibraryPlanText = function() {
		var l = lib();
		return l ? String(l.planText || "") : "";
	};

	app.setActiveLibraryPlanText = function(text) {
		var l = lib();
		if (!l) return;
		var newText = String(text || "");
		if (newText === String(l.planText || "")) {
			return;
		}
		l.planText = newText;
		if (!newText.trim()) {
			l.formulas = [];
			l.allFormulas = [];
			saveData();
			app._notifyActiveLibraryChanged();
			return;
		}
		if (typeof app.parseStateDefinitions === "function") {
			var parsed = app.parseStateDefinitions(newText);
			if (parsed.states.length) {
				var previous = (l.allFormulas || l.formulas || []).slice();
				function findPreviousCustomState(state) {
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
				var formulas = parsed.states.map(function(state, index) {
					var same = previous[index] && previous[index].name === state.name && previous[index].alg === state.alg ? previous[index] : null;
					var id = same ? same.id : "memory_formula_" + Date.now() + "_" + l.idSeed++;
					var existing = same || previous.find(function(p) { return p.name === state.name && p.alg === state.alg; });
					var customSolvedState = existing ? (existing.customSolvedState || null) : findPreviousCustomState(state);
					return {
						id: id,
						image: existing ? (existing.image || null) : null,
						name: state.name,
						alg: state.alg,
						formula: state.alg,
						answer: app.invertFormulaDisplayText ? app.invertFormulaDisplayText(state.alg || "", state.moves || []) : state.alg,
						moves: state.moves.slice(),
						customSolvedState: customSolvedState
					};
				});
				l.formulas = formulas;
				l.allFormulas = formulas.slice();
				formulas.forEach(function(formula) { getProgress(formula.id); });
			}
		}
		saveData();
		app._notifyActiveLibraryChanged();
	};

	app.setActiveLibraryPlanTextQuiet = function(text) {
		var l = lib();
		if (!l) return;
		l.planText = String(text || "");
		saveData();
	};

	app.getActiveLibraryFormulas = function() {
		var l = lib();
		return l ? (l.formulas || []) : [];
	};

	app.setActiveLibraryFormulasFromStates = function(parsedStates, silent) {
		var l = lib();
		if (!l) return;
		var previous = (l.allFormulas || l.formulas || []).slice();
		var formulas = parsedStates.map(function(state, index) {
			var same = previous[index] && previous[index].name === state.name && previous[index].alg === state.alg ? previous[index] : null;
			var id = same ? same.id : "memory_formula_" + Date.now() + "_" + l.idSeed++;
			var existing = same || previous.find(function(p) { return p.name === state.name && p.alg === state.alg; });
			return {
				id: id,
				image: existing ? (existing.image || null) : null,
				name: state.name,
				alg: state.alg,
				formula: state.alg,
				answer: app.invertFormulaDisplayText ? app.invertFormulaDisplayText(state.alg || "", state.moves || []) : state.alg,
				moves: state.moves.slice(),
				customSolvedState: existing ? (existing.customSolvedState || null) : null
			};
		});
		l.formulas = formulas;
		l.allFormulas = formulas.slice();
		l.planText = formulas.map(function(f) {
			var alg = f.alg || f.formula || '';
			if (!alg.endsWith(';')) { alg += ';'; }
			return f.name + ': ' + alg;
		}).join('\n');
		l.queue = [];
		l.todayQueue = [];
		l.undoStack = [];
		formulas.forEach(function(formula) { getProgress(formula.id); });
		saveData();
		if (!silent) {
			app._notifyActiveLibraryChanged();
		}
	};

	app.findMemoryFormulaByAlg = function(alg) {
		var l = lib();
		if (!l || !alg) return null;
		var normalized = String(alg).replace(/\s+/g, "").toUpperCase();
		var allFormulas = l.allFormulas && l.allFormulas.length ? l.allFormulas : (l.formulas || []);
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

	var _activeLibraryChangeListeners = [];
	app.onActiveLibraryChanged = function(callback) {
		if (typeof callback === "function" && _activeLibraryChangeListeners.indexOf(callback) === -1) {
			_activeLibraryChangeListeners.push(callback);
		}
	};
	app._notifyActiveLibraryChanged = function() {
		for (var i = 0; i < _activeLibraryChangeListeners.length; i++) {
			try { _activeLibraryChangeListeners[i](); } catch(e) {}
		}
	};
})();
