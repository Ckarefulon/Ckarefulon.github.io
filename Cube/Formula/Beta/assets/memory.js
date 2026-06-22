(function() {
	"use strict";

	var app = window.smartCubeApp;
	if (!app) {
		return;
	}

	var STORAGE_KEY = "cube_memory_progress_v1";
	var SCHEMA_VERSION = 1;
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
		confirming: false
	};

	function freshData() {
		return {
			schemaVersion: SCHEMA_VERSION,
			planText: "",
			formulas: [],
			progress: {},
			settings: { dailyCount: 10 },
			day: { studyDate: "", learnedIds: [] },
			queue: [],
			todayQueue: [],
			thresholdData: { threshold: 500, precision: 2 },
			undoStack: [],
			idSeed: 1
		};
	}

	function mergeLoadedData(value) {
		var base = freshData();
		if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.formulas) || typeof value.progress !== "object") {
			return base;
		}
		Object.keys(base).forEach(function(key) {
			if (value[key] !== undefined) {
				base[key] = value[key];
			}
		});
		base.schemaVersion = SCHEMA_VERSION;
		base.settings = Object.assign({ dailyCount: 10 }, base.settings || {});
		base.day = Object.assign({ studyDate: "", learnedIds: [] }, base.day || {});
		base.day.learnedIds = Array.isArray(base.day.learnedIds) ? base.day.learnedIds : [];
		base.queue = Array.isArray(base.queue) ? base.queue : [];
		base.todayQueue = Array.isArray(base.todayQueue) ? base.todayQueue : [];
		base.undoStack = Array.isArray(base.undoStack) ? base.undoStack : [];
		base.thresholdData = Object.assign({ threshold: 500, precision: 2 }, base.thresholdData || {});
		base.progress = base.progress || {};
		return reviveDates(base);
	}

	function loadData() {
		try {
			memory.data = mergeLoadedData(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
		} catch (error) {
			memory.data = freshData();
		}
		ensureStudyDay();
		// Same-day reinforcement is deliberately session-only. A reload releases it;
		// the already-confirmed FSRS due date remains untouched.
		memory.data.todayQueue = [];
		memory.data.queue = memory.data.queue.filter(function(item) {
			return item && !item.reinforcement && findFormula(item.id);
		});
		saveData();
	}

	function saveData() {
		if (!memory.data) {
			return;
		}
		memory.data.schemaVersion = SCHEMA_VERSION;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(memory.data));
		updatePlanCounter();
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
		if (!memory.data) {
			return;
		}
		var today = studyDate(Date.now());
		if (memory.data.day.studyDate !== today) {
			memory.data.day = { studyDate: today, learnedIds: [] };
			memory.data.queue = [];
			memory.data.todayQueue = [];
			memory.data.undoStack = [];
			memory.promptedContinue = false;
		}
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

	function getProgress(id) {
		if (!memory.data.progress[id]) {
			memory.data.progress[id] = {
				card: null,
				logs: [],
				attempts: [],
				aoTimes: [],
				dayHistory: [],
				firstLearnStudyDate: ""
			};
		}
		var progress = memory.data.progress[id];
		progress.logs = Array.isArray(progress.logs) ? progress.logs : [];
		progress.attempts = Array.isArray(progress.attempts) ? progress.attempts : [];
		progress.aoTimes = Array.isArray(progress.aoTimes) ? progress.aoTimes : [];
		progress.dayHistory = Array.isArray(progress.dayHistory) ? progress.dayHistory : [];
		return progress;
	}

	function findFormula(id) {
		return (memory.data && memory.data.formulas || []).find(function(formula) {
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
		var learned = memory.data.day.learnedIds;
		var now = Date.now();
		var due = [];
		var fresh = [];
		memory.data.formulas.forEach(function(formula) {
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
			memory.data.queue = due;
			return;
		}
		var remaining = Math.max(0, Number(memory.data.settings.dailyCount || 10) - learned.length);
		var queue = [];
		while (queue.length < remaining && (due.length || fresh.length)) {
			if (due.length) {
				queue.push(due.shift());
			}
			if (queue.length < remaining && fresh.length) {
				queue.push(fresh.shift());
			}
		}
		memory.data.queue = queue;
	}

	function remainingDueItems() {
		var learned = memory.data.day.learnedIds;
		var now = Date.now();
		return memory.data.formulas.filter(function(formula) {
			if (learned.indexOf(formula.id) >= 0) {
				return false;
			}
			var progress = getProgress(formula.id);
			var due = dueDate(progress);
			return progress.logs.length && due && due.getTime() <= now;
		});
	}

	function getMemoryPanelHtml() {
		return '<aside class="panel memoryPanel"><header class="panelHeader"><h1>记忆模式</h1></header>' +
			'<section class="panelSection"><div class="controls"><button id="connectBtn" class="button" type="button">连接魔方</button><button id="customFinalStateBtn" class="button secondary" type="button">最终状态</button></div><button id="memoryPlanBtn" class="button" type="button">规划学习</button><div class="controls"><button id="memoryImportBtn" class="button secondary" type="button">导入数据</button><button id="memoryExportBtn" class="button secondary" type="button">导出数据</button></div><input id="memoryImportFile" class="hiddenFileInput" type="file" accept=".json,application/json"></section>' +
			'<section class="memoryArea"><div id="memoryCurrent" class="memoryCurrent"><button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><button id="memoryPrompt" class="memoryPrompt" type="button">请开始还原…<br>点击此处显示答案。</button></div><div id="memoryHistory" class="memoryHistory"></div></section>' +
			app.getDiagnosticsHtml(true) + '</aside>';
	}

	function updatePlanCounter() {
		var element = document.getElementById("memoryPlanCount");
		if (element && memory.data) {
			element.textContent = "[" + memory.data.day.learnedIds.length + "]/[" + memory.data.settings.dailyCount + "]";
		}
		var input = document.getElementById("memoryDailyCount");
		if (input && memory.data && document.activeElement !== input) {
			input.value = String(memory.data.settings.dailyCount);
		}
	}

	function startMemoryMode() {
		ensureStudyDay();
		memory.promptedContinue = false;
		updatePlanCounter();
		if (!memory.data.queue.length) {
			buildDailyQueue(false);
		}
		startNextFormula();
	}

	function startNextFormula() {
		stopTimer();
		memory.currentItem = memory.data.queue[0] || null;
		memory.currentFormula = memory.currentItem ? findFormula(memory.currentItem.id) : null;
		memory.state = "hidden";
		memory.firstMoveTime = null;
		memory.attemptStartTime = null;
		memory.accumulatedSolveTime = 0;
		memory.solveTime = null;
		memory.reactionTime = null;
		memory.retried = false;
		memory.repeatedMove = false;
		memory.attemptMoves = [];
		memory.manualSelection = false;
		memory.lastAnswerMove = null;
		if (!memory.currentFormula) {
			renderIdleMemory();
			maybeOfferDueContinuation();
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
		var learnedCount = memory.data.day.learnedIds.length;
		var dailyCount = memory.data.settings.dailyCount;
		if (learnedCount >= dailyCount && dailyCount > 0) {
			renderCompletionCalendar(current);
			return;
		}
		current.innerHTML = '<button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><button id="memoryPrompt" class="memoryPrompt" type="button">请开始还原…<br>点击此处显示答案。</button>';
		var history = document.getElementById("memoryHistory");
		if (history) {
			history.innerHTML = '<div class="memoryEmptyHistory">' + (memory.data.formulas.length ? "今日没有待学习公式" : "请先规划学习公式") + '</div>';
		}
	}

	function renderCompletionCalendar(current) {
		var studyDates = {};
		var formulas = memory.data.formulas || [];
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
		var months = {};
		for (var k = 0; k < dates.length; k++) {
			var month = dates[k].slice(0, 7);
			if (!months[month]) { months[month] = {}; }
			months[month][dates[k]] = studyDates[dates[k]];
		}
		var monthKeys = Object.keys(months).sort();
		var calendarHtml = [];
		for (var m = 0; m < monthKeys.length; m++) {
			var monthKey = monthKeys[m];
			var parts = monthKey.split("-");
			var year = parseInt(parts[0], 10);
			var mon = parseInt(parts[1], 10);
			var daysInMonth = new Date(year, mon, 0).getDate();
			var firstDow = new Date(year, mon - 1, 1).getDay();
			var monthDays = months[monthKey];
			calendarHtml.push('<div class="memoryCalendarMonth"><div class="memoryCalendarTitle">' + year + '年' + mon + '月</div><div class="memoryCalendarGrid">');
			calendarHtml.push('<span class="memoryCalendarDow">日</span><span class="memoryCalendarDow">一</span><span class="memoryCalendarDow">二</span><span class="memoryCalendarDow">三</span><span class="memoryCalendarDow">四</span><span class="memoryCalendarDow">五</span><span class="memoryCalendarDow">六</span>');
			for (var d = 0; d < firstDow; d++) {
				calendarHtml.push('<span class="memoryCalendarDay isPlaceholder"></span>');
			}
			for (var day = 1; day <= daysInMonth; day++) {
				var dateKey = monthKey + "-" + String(day).padStart(2, "0");
				var isDone = !!monthDays[dateKey];
				calendarHtml.push('<span class="memoryCalendarDay' + (isDone ? ' isDone' : '') + '">' + day + '</span>');
			}
			calendarHtml.push('</div></div>');
		}
		var totalDays = dates.length;
		current.innerHTML = '<div class="memoryCompletion"><h2>今日计划已完成</h2><p class="memoryCompletionSub">累计学习 ' + totalDays + ' 天</p><div class="memoryCalendar">' + calendarHtml.join("") + '</div></div>';
		var history = document.getElementById("memoryHistory");
		if (history) { history.innerHTML = ""; }
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
		var options = labels.map(function(label, index) {
			return '<button class="memoryOption' + (index === memory.selectedRating ? ' isSelected' : '') + '" style="--memoryColor:' + RATING_COLORS[index] + '" type="button" data-memory-rating="' + index + '">' + app.escapeHtml(label) + '</button>';
		}).join("");
		current.innerHTML = '<button id="memoryBackBtn" class="memoryBack" type="button" aria-label="返回上一公式" title="返回上一公式"><span class="memoryBackChevron" aria-hidden="true"></span></button><button id="memoryFullscreenBtn" class="memoryFullscreen" type="button" aria-label="全屏" title="全屏"><span class="memoryFullscreenIcon" aria-hidden="true"></span></button><div class="memoryAnswer"><strong class="memoryAnswerName">' + app.escapeHtml(memory.currentFormula.name) + '</strong><div class="memoryAnswerFormula">' + app.escapeHtml(memory.currentFormula.answer || memory.currentFormula.alg || "") + '</div></div>' +
			'<div class="memoryTimes"><div class="memoryTime"><span>本次</span><strong>' + formatDuration(memory.solveTime) + '</strong></div><div class="memoryTime"><span>AO5</span><strong>' + stats[0] + '</strong></div><div class="memoryTime"><span>AO10</span><strong>' + stats[1] + '</strong></div><div class="memoryTime"><span>AO50</span><strong>' + stats[2] + '</strong></div></div>' +
			'<p class="memoryControlHint">(R R\') 确认；D 右移；D\' 左移。</p><div class="memoryOptions">' + options + '</div>';
	}

	function renderMemoryHistory() {
		var container = document.getElementById("memoryHistory");
		if (!container || !memory.currentFormula) {
			return;
		}
		var progress = getProgress(memory.currentFormula.id);
		var today = memory.data.day.studyDate;
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

	function handleMemorySmartMove(rawMove) {
		if (app.currentMode !== "memory" || !memory.currentFormula) {
			return;
		}
		var normalized = app.normalizeMove(rawMove);
		if (!normalized || normalized.type !== "face") {
			return;
		}
		var text = normalized.text;
		var now = performance.now();
		if (memory.state === "answer") {
			handleAnswerMove(text, now);
			return;
		}
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

	function handleAnswerMove(text, now) {
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
			if (memory.lastAnswerMove && memory.lastAnswerMove.text === "R" && now - memory.lastAnswerMove.time <= 700) {
				memory.lastAnswerMove = null;
				confirmRating();
				return;
			}
			memory.lastAnswerMove = null;
			return;
		}
		memory.lastAnswerMove = text === "R" ? { text: text, time: now } : null;
	}

	function retryCurrentFormula() {
		if (!memory.currentFormula || (memory.state !== "solving" && memory.state !== "hidden")) {
			return;
		}
		var now = performance.now();
		if (memory.attemptStartTime !== null) {
			memory.accumulatedSolveTime += Math.max(0, now - memory.attemptStartTime);
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
		memory.state = "answer";
		memory.answerReason = reason || "reveal";
		memory.selectedRating = 3;
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
		memory.state = "answer";
		memory.answerReason = "solved";
		if (memory.retried || memory.repeatedMove) {
			memory.selectedRating = 2;
		} else {
			memory.selectedRating = memory.reactionTime <= Number(memory.data.thresholdData.threshold || 500) ? 0 : 1;
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
		var virtualSolved = !!app.virtualCubie && app.isVirtualStateSolved();
		var canSolveFacelet = faceletSolved && (memory.sawUnsolvedFacelet || hadCubeMove && memory.attemptMoves.length > 0);
		var canSolveVirtual = virtualSolved && memory.sawUnsolvedVirtual && memory.attemptMoves.length > 0;
		if (memory.state === "solving" && (canSolveFacelet || canSolveVirtual)) {
			solvedCurrentFormula();
			return;
		}
		if (hasFacelet && !faceletSolved) {
			memory.sawUnsolvedFacelet = true;
		}
		if (app.virtualCubie && !virtualSolved) {
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
		var threshold = memory.data.thresholdData;
		var precision = Math.max(1, Number(threshold.precision) || 2);
		// A compact normal/normal Bayesian update. A binary Clear answer places the
		// boundary slightly above the observation; Hesitant places it below.
		var observation = Math.max(80, memory.reactionTime + (memory.selectedRating === 0 ? 125 : -125));
		threshold.threshold = Math.round((Number(threshold.threshold || 500) * precision + observation) / (precision + 1));
		threshold.precision = Math.min(40, precision + 1);
	}

	function makeCheckpoint() {
		var copy = JSON.parse(JSON.stringify(memory.data));
		delete copy.undoStack;
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
			var undoEntry = { formulaId: formula.id, checkpoint: makeCheckpoint() };
			memory.data.undoStack.push(undoEntry);
			if (memory.data.undoStack.length > 20) {
				memory.data.undoStack.shift();
			}
			updateThresholdFromManualChoice();
			if (scheduled) {
				progress.card = scheduled.card;
				progress.logs.push(scheduled.log);
			}
			progress.attempts.push({
				studyDate: memory.data.day.studyDate,
				ratingIndex: memory.selectedRating,
				solveTime: typeof memory.solveTime === "number" ? memory.solveTime : null,
				reactionTime: typeof memory.reactionTime === "number" ? memory.reactionTime : null,
				retried: memory.retried,
				reinforcement: !!item.reinforcement,
				time: new Date()
			});
			if (memory.answerReason === "solved" && typeof memory.solveTime === "number") {
				progress.aoTimes.push(memory.solveTime);
				if (progress.aoTimes.length > 200) {
					progress.aoTimes = progress.aoTimes.slice(-200);
				}
			}
			var today = memory.data.day.studyDate;
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
			if (memory.data.day.learnedIds.indexOf(formula.id) < 0) {
				memory.data.day.learnedIds.push(formula.id);
			}
			memory.data.queue.shift();
			if (item.reinforcement) {
				memory.data.todayQueue = memory.data.todayQueue.filter(function(entry) { return entry.id !== formula.id; });
			} else if (memory.selectedRating >= 2 && !memory.data.todayQueue.some(function(entry) { return entry.id === formula.id; })) {
				var repeat = { id: formula.id, reinforcement: true };
				memory.data.todayQueue.push(repeat);
				memory.data.queue.push(repeat);
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
		var stack = memory.data.undoStack || [];
		if (!stack.length) {
			showToast("没有上一公式");
			return;
		}
		var undo = stack[stack.length - 1];
		var remaining = stack.slice(0, -1);
		memory.data = mergeLoadedData(undo.checkpoint);
		memory.data.undoStack = remaining;
		saveData();
		startNextFormula();
	}

	function maybeOfferDueContinuation() {
		if (memory.currentFormula || memory.promptedContinue) {
			return;
		}
		var due = remainingDueItems();
		if (memory.data.day.learnedIds.length >= memory.data.settings.dailyCount && due.length) {
			memory.promptedContinue = true;
			openConfirmDialog("今日计划已完成", "仍有 " + due.length + " 个到期公式，是否继续学习？继续后只安排到期复习，不加入新公式。", "继续复习", function() {
				buildDailyQueue(true);
				saveData();
				startNextFormula();
			});
		}
	}

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
			showToast("未读取到有效公式，请使用“名称：公式;”格式");
			return false;
		}
		var previous = memory.data.formulas.slice();
		var formulas = parsed.states.map(function(state, index) {
			var same = previous[index] && previous[index].name === state.name && previous[index].alg === state.alg ? previous[index] : null;
			var id = same ? same.id : "memory_formula_" + Date.now() + "_" + memory.data.idSeed++;
			return {
				id: id,
				image: null,
				name: state.name,
				alg: state.alg,
				formula: state.alg,
				answer: app.invertFormulaDisplayText(state.alg || "", state.moves || []),
				moves: state.moves.slice()
			};
		});
		memory.data.planText = String(text || "");
		memory.data.formulas = formulas;
		memory.data.queue = [];
		memory.data.todayQueue = [];
		memory.data.undoStack = [];
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
		if (app.currentMode === "memory") {
			startMemoryMode();
		}
		return true;
	}

	function openPlanDialog() {
		var initial = joinPlanText(memory.data.planText, memory.pendingAutofill);
		var overlay = createOverlay('<div class="memoryDialog" role="dialog" aria-modal="true"><div class="memoryDialogHeader"><strong>规划学习</strong><button class="button secondary small" type="button" data-memory-close>关闭</button></div><p>每行或连续文本均可，沿用 TXT 的\u201c名称：公式;\u201d格式；重复公式会原样保留。</p><textarea id="memoryPlanTextarea" class="memoryPlanTextarea" spellcheck="false"></textarea><div class="memoryDialogBottom"><label class="memoryDailyLabel">每日公式数 <input id="memoryDailyCount" class="memoryDailyInput" type="number" min="1" max="999" value="' + (memory.data.settings.dailyCount || 10) + '"></label><span id="memoryPlanCount" class="memoryPlanCount">[0]/[' + (memory.data.settings.dailyCount || 10) + ']</span></div><div class="memoryDialogActions"><button class="button secondary" type="button" data-memory-close>取消</button><button id="memorySavePlanBtn" class="button" type="button">保存计划</button></div></div>');
		var textarea = overlay.querySelector("#memoryPlanTextarea");
		textarea.value = initial;
		overlay.querySelector("#memorySavePlanBtn").addEventListener("click", function() {
			if (commitPlanText(textarea.value)) {
				memory.pendingAutofill = "";
				closeOverlay(overlay);
			}
		});
		overlay.querySelector("#memoryDailyCount").addEventListener("change", function(event) {
			memory.data.settings.dailyCount = Math.max(1, Math.min(999, Math.round(Number(event.target.value) || 10)));
			saveData();
			updatePlanCounter();
		});
		updatePlanCounter();
		requestAnimationFrame(function() { textarea.focus(); });
	}

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

	function exportData() {
		var payload = JSON.stringify(memory.data, null, 2);
		var blob = new Blob([payload], { type: "application/json;charset=utf-8" });
		var url = URL.createObjectURL(blob);
		var link = document.createElement("a");
		link.href = url;
		link.download = "cube-memory-" + memory.data.day.studyDate + ".json";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	function validateImport(value) {
		return !!(value && value.schemaVersion === SCHEMA_VERSION && Array.isArray(value.formulas) && value.formulas.every(function(formula) {
			return formula && typeof formula.id === "string" && typeof formula.name === "string" && Array.isArray(formula.moves);
		}) && value.progress && typeof value.progress === "object" && value.settings && Number(value.settings.dailyCount) > 0);
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
				saveData();
				startMemoryMode();
				showToast("数据已导入");
			});
		}).catch(function(error) {
			showToast("导入失败，原数据未更改：" + String(error && error.message || error));
		});
	}

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

	var originalInit = app.init;
	app.init = function() {
		loadData();
		ensureFsrs().catch(function() {});
		originalInit.call(this);
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
				commitPlanText(joinPlanText(memory.data.planText, transfer));
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
		if (result && options && options.fromCube) {
			handleMemorySmartMove(rawMove);
		}
		return result;
	};

	var originalUpdateSolveDetection = app.updateSolveDetection;
	app.updateSolveDetection = function(facelet, hadCubeMove) {
		originalUpdateSolveDetection.call(this, facelet, hadCubeMove);
		updateMemorySolveDetection(facelet, hadCubeMove);
	};

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
})();
