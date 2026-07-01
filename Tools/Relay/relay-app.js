(function() {
	"use strict";

	var RELAY_DATA_KEY = "relay_text";
	var RELAY_REALTIME_KEY = "relay_realtime_enabled";
	var RELAY_INTERVAL_KEY = "relay_interval_seconds";
	var LOCAL_STORAGE_PREFIX = "relay_";

	var cloudSyncManager = {
		isReady: function() {
			return !!(window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
		},

		buildLocalPayload: function() {
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Tools-Relay";
			var basePath = window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : "/Tools/Relay";
			var text = window.storageManager ? window.storageManager.getItem(LOCAL_STORAGE_PREFIX + RELAY_DATA_KEY, "") : "";
			var realtimeEnabled = window.storageManager ? window.storageManager.getItem(LOCAL_STORAGE_PREFIX + RELAY_REALTIME_KEY, "false") === "true" : false;
			var intervalSeconds = window.storageManager ? parseInt(window.storageManager.getItem(LOCAL_STORAGE_PREFIX + RELAY_INTERVAL_KEY, "0"), 10) : 0;
			if (isNaN(intervalSeconds) || intervalSeconds < 0) intervalSeconds = 0;

			return {
				exportedAt: new Date().toISOString(),
				source: "Ckarefulon",
				siteScope: scope,
				siteBasePath: basePath,
				version: 1,
				data: {
					relay_text: text,
					relay_realtime_enabled: realtimeEnabled,
					relay_interval_seconds: intervalSeconds
				}
			};
		},

		getCloudStatus: function() {
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录", hasData: false, cloudData: null });
			}

			var user = window.authManager.getUser();
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Tools-Relay";

			return window.supabaseClient
				.from("user_data")
				.select("data, updated_at")
				.eq("user_id", user.id)
				.eq("site_scope", scope)
				.maybeSingle()
				.then(function(result) {
					if (result.error) {
						console.error("[RelayCloud] 查询云端状态失败:", result.error);
						return { success: false, message: "查询云端状态失败", hasData: false, cloudData: null };
					}
					if (!result.data) {
						return { success: true, message: "云端暂无数据", hasData: false, cloudData: null };
					}
					return {
						success: true,
						message: "云端已有数据",
						hasData: true,
						cloudData: result.data.data,
						updatedAt: result.data.updated_at
					};
				})
				.catch(function(error) {
					console.error("[RelayCloud] 查询云端状态异常:", error);
					return { success: false, message: "查询云端状态失败", hasData: false, cloudData: null };
				});
		},

		uploadLocalToCloud: function() {
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录" });
			}

			var user = window.authManager.getUser();
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Tools-Relay";
			var payload = cloudSyncManager.buildLocalPayload();

			return window.supabaseClient
				.from("user_data")
				.upsert({
					user_id: user.id,
					site_scope: scope,
					data: payload,
					updated_at: new Date().toISOString()
				}, {
					onConflict: "user_id,site_scope"
				})
				.then(function(result) {
					if (result.error) {
						console.error("[RelayCloud] 上传失败:", result.error);
						return { success: false, message: "上传失败，请稍后重试" };
					}
					return { success: true, message: "上传成功" };
				})
				.catch(function(error) {
					console.error("[RelayCloud] 上传异常:", error);
					return { success: false, message: "上传失败，请稍后重试" };
				});
		},

		downloadCloudToLocal: function() {
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录" });
			}

			var user = window.authManager.getUser();
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Tools-Relay";

			return window.supabaseClient
				.from("user_data")
				.select("data")
				.eq("user_id", user.id)
				.eq("site_scope", scope)
				.maybeSingle()
				.then(function(result) {
					if (result.error) {
						console.error("[RelayCloud] 读取云端数据失败:", result.error);
						return { success: false, message: "读取云端数据失败" };
					}
					if (!result.data || !result.data.data) {
						return { success: false, message: "云端暂无数据" };
					}

					var cloudData = result.data.data;
					var dataBlock = cloudData.data;
					if (!dataBlock) {
						return { success: false, message: "云端数据格式不正确" };
					}

					if (dataBlock.relay_text !== undefined) {
						window.storageManager.setItem(LOCAL_STORAGE_PREFIX + RELAY_DATA_KEY, dataBlock.relay_text);
					}

					var prefs = {};
					if (typeof dataBlock.relay_realtime_enabled === "boolean") {
						prefs.realtimeEnabled = dataBlock.relay_realtime_enabled;
						window.storageManager.setItem(LOCAL_STORAGE_PREFIX + RELAY_REALTIME_KEY, dataBlock.relay_realtime_enabled ? "true" : "false");
					}
					if (typeof dataBlock.relay_interval_seconds === "number" && !isNaN(dataBlock.relay_interval_seconds) && dataBlock.relay_interval_seconds >= 0) {
						prefs.intervalSeconds = Math.floor(dataBlock.relay_interval_seconds);
						window.storageManager.setItem(LOCAL_STORAGE_PREFIX + RELAY_INTERVAL_KEY, String(prefs.intervalSeconds));
					}

					return { success: true, message: "同步成功", text: dataBlock.relay_text || "", prefs: prefs };
				})
				.catch(function(error) {
					console.error("[RelayCloud] 恢复异常:", error);
					return { success: false, message: "同步失败，请稍后重试" };
				});
		}
	};

	window.cloudSyncManager = cloudSyncManager;

	var state = {
		isLoggedIn: false,
		realtimeEnabled: false,
		intervalSeconds: 0,
		intervalTimer: null,
		isSyncing: false,
		lastUploadTime: 0,
		debounceTimer: null,
		ignoreNextInput: false,
		undoStack: [],
		undoDebounceTimer: null,
		undoLastSnapshot: null,
		MAX_UNDO: 50,
		dataDirty: false
	};

	var elements = {};

	function $(id) {
		return document.getElementById(id);
	}

	function setStatus(text, type) {
		if (!elements.syncStatus) return;
		elements.syncStatus.textContent = text;
		elements.syncStatus.className = "relayStatus" + (type ? " is" + type.charAt(0).toUpperCase() + type.slice(1) : "");
	}

	function markDirty() {
		state.dataDirty = true;
		if (typeof window._siteNavSetDirty === "function") {
			window._siteNavSetDirty(true);
		}
	}

	function markClean() {
		state.dataDirty = false;
		if (typeof window._siteNavSetDirty === "function") {
			window._siteNavSetDirty(false);
		}
	}

	function updateMutualExclusionUI() {
		var rtOn = state.realtimeEnabled;
		var ivOn = state.intervalSeconds > 0;

		if (elements.realtimeToggle) {
			elements.realtimeToggle.classList.toggle("isActive", rtOn);
			elements.realtimeToggle.classList.toggle("relayHide", ivOn && !rtOn);
		}
		if (elements.intervalToggle) {
			elements.intervalToggle.classList.toggle("isActive", ivOn);
			elements.intervalToggle.classList.toggle("relayHide", rtOn && !ivOn);
		}
		if (elements.intervalWrap) {
			elements.intervalWrap.classList.toggle("isOpen", ivOn);
		}
	}

	function getLocalText() {
		return window.storageManager ? window.storageManager.getItem(LOCAL_STORAGE_PREFIX + RELAY_DATA_KEY, "") : "";
	}

	function setLocalText(text) {
		if (window.storageManager) {
			window.storageManager.setItem(LOCAL_STORAGE_PREFIX + RELAY_DATA_KEY, text);
		}
	}

	function pushUndoState(text) {
		if (text == null) return;
		var stack = state.undoStack;
		if (stack.length > 0 && stack[stack.length - 1] === text) return;
		stack.push(text);
		if (stack.length > state.MAX_UNDO) {
			stack.shift();
		}
		updateUndoButton();
	}

	function updateUndoButton() {
		if (!elements.undoBtn) return;
		var canUndo = state.undoStack.length > 0;
		elements.undoBtn.disabled = !canUndo || !state.isLoggedIn;
	}

	function performUndo() {
		if (state.undoStack.length === 0) return;
		var prev = state.undoStack.pop();
		var currentText = elements.textarea ? elements.textarea.value : getLocalText();

		state.undoLastSnapshot = prev;
		setLocalText(prev);
		applyTextToTextarea(prev, true);
		updateUndoButton();
		markDirty();

		if (state.realtimeEnabled && state.isLoggedIn) {
			scheduleRealtimeUpload();
		}
		setStatus("已恢复上一版本 " + new Date().toLocaleTimeString(), "success");
	}

	function scheduleUndoSnapshot() {
		if (state.undoDebounceTimer) {
			clearTimeout(state.undoDebounceTimer);
		}
		state.undoDebounceTimer = setTimeout(function() {
			state.undoDebounceTimer = null;
			var current = elements.textarea ? elements.textarea.value : "";
			if (state.undoLastSnapshot !== current) {
				pushUndoState(state.undoLastSnapshot != null ? state.undoLastSnapshot : "");
				state.undoLastSnapshot = current;
			}
		}, 1000);
	}

	function flushUndoSnapshot() {
		if (state.undoDebounceTimer) {
			clearTimeout(state.undoDebounceTimer);
			state.undoDebounceTimer = null;
		}
		var current = elements.textarea ? elements.textarea.value : "";
		if (state.undoLastSnapshot !== null && state.undoLastSnapshot !== current) {
			pushUndoState(state.undoLastSnapshot);
		}
		state.undoLastSnapshot = current;
	}

	function getLocalPrefs() {
		var prefs = { realtimeEnabled: false, intervalSeconds: 0 };
		if (window.storageManager) {
			prefs.realtimeEnabled = window.storageManager.getItem(LOCAL_STORAGE_PREFIX + RELAY_REALTIME_KEY, "false") === "true";
			var iv = parseInt(window.storageManager.getItem(LOCAL_STORAGE_PREFIX + RELAY_INTERVAL_KEY, "0"), 10);
			prefs.intervalSeconds = (isNaN(iv) || iv < 0) ? 0 : iv;
		}
		return prefs;
	}

	function saveRealtimePref(enabled) {
		if (window.storageManager) {
			window.storageManager.setItem(LOCAL_STORAGE_PREFIX + RELAY_REALTIME_KEY, enabled ? "true" : "false");
		}
	}

	function saveIntervalPref(seconds) {
		if (window.storageManager) {
			window.storageManager.setItem(LOCAL_STORAGE_PREFIX + RELAY_INTERVAL_KEY, String(seconds));
		}
	}

	function applyPrefs(prefs) {
		if (prefs.realtimeEnabled !== undefined) {
			state.realtimeEnabled = !!prefs.realtimeEnabled;
			if (state.realtimeEnabled) {
				state.intervalSeconds = 0;
				clearIntervalTimer();
			}
		}
		if (prefs.intervalSeconds !== undefined) {
			var secs = prefs.intervalSeconds;
			if (isNaN(secs) || secs < 0) secs = 0;
			state.intervalSeconds = secs;
			if (secs > 0) {
				state.realtimeEnabled = false;
				if (state.debounceTimer) {
					clearTimeout(state.debounceTimer);
					state.debounceTimer = null;
				}
			}
			if (elements.intervalInput) {
				elements.intervalInput.value = secs > 0 ? String(secs) : "";
			}
			setupIntervalTimer();
		}
		updateMutualExclusionUI();
	}

	function applyTextToTextarea(text, fromCloud) {
		if (!elements.textarea) return;
		state.ignoreNextInput = !!fromCloud;
		elements.textarea.value = text;
	}

	function uploadNow() {
		if (state.isSyncing || !state.isLoggedIn) {
			return Promise.resolve({ success: false });
		}
		state.isSyncing = true;
		setStatus("正在上传...", "syncing");

		return cloudSyncManager.uploadLocalToCloud().then(function(result) {
			state.isSyncing = false;
			if (result.success) {
				state.lastUploadTime = Date.now();
				markClean();
				setStatus("已同步 " + new Date().toLocaleTimeString(), "success");
			} else {
				setStatus(result.message, "error");
			}
			return result;
		});
	}

	function downloadNow(silent) {
		if (state.isSyncing || !state.isLoggedIn) {
			return Promise.resolve({ success: false });
		}
		state.isSyncing = true;
		if (!silent) {
			setStatus("正在下载...", "syncing");
		}

		return cloudSyncManager.downloadCloudToLocal().then(function(result) {
			state.isSyncing = false;
			if (result.success) {
				var cloudText = result.text || "";
				var currentText = elements.textarea ? elements.textarea.value : getLocalText();

				if (currentText !== cloudText) {
					flushUndoSnapshot();
					pushUndoState(currentText);
				}

				setLocalText(cloudText);
				applyTextToTextarea(cloudText, true);
				state.undoLastSnapshot = cloudText;

				if (result.prefs) {
					applyPrefs(result.prefs);
				}

				markClean();
				setStatus("已同步 " + new Date().toLocaleTimeString(), "success");
			} else {
				if (!silent) {
					setStatus(result.message, "error");
				}
			}
			return result;
		});
	}

	function scheduleRealtimeUpload() {
		if (state.debounceTimer) {
			clearTimeout(state.debounceTimer);
		}
		state.debounceTimer = setTimeout(function() {
			state.debounceTimer = null;
			uploadNow();
		}, 800);
	}

	function clearIntervalTimer() {
		if (state.intervalTimer) {
			clearInterval(state.intervalTimer);
			state.intervalTimer = null;
		}
	}

	function setupIntervalTimer() {
		clearIntervalTimer();
		var seconds = parseInt(state.intervalSeconds, 10);
		if (isNaN(seconds) || seconds <= 0) {
			return;
		}
		state.intervalTimer = setInterval(function() {
			downloadNow(true);
		}, seconds * 1000);
	}

	function onTextareaInput() {
		if (state.ignoreNextInput) {
			state.ignoreNextInput = false;
			return;
		}
		var text = elements.textarea ? elements.textarea.value : "";
		setLocalText(text);
		scheduleUndoSnapshot();
		markDirty();

		if (state.realtimeEnabled && state.isLoggedIn) {
			scheduleRealtimeUpload();
		}
	}

	function onTextareaKeydown(e) {
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
			if (state.undoStack.length > 0) {
				e.preventDefault();
				flushUndoSnapshot();
				performUndo();
			}
		}
	}

	function onTextareaBlur() {
		flushUndoSnapshot();
	}

	function onRealtimeToggle() {
		if (state.realtimeEnabled) {
			state.realtimeEnabled = false;
			saveRealtimePref(false);
			if (state.debounceTimer) {
				clearTimeout(state.debounceTimer);
				state.debounceTimer = null;
			}
			setStatus("实时同步已关闭", "");
		} else {
			state.realtimeEnabled = true;
			state.intervalSeconds = 0;
			saveRealtimePref(true);
			saveIntervalPref(0);
			clearIntervalTimer();
			setStatus("实时同步已开启", "");
			if (elements.intervalInput) {
				elements.intervalInput.value = "";
			}
			if (state.isLoggedIn) {
				uploadNow();
			}
		}
		updateMutualExclusionUI();
		if (state.isLoggedIn && !state.realtimeEnabled) {
			uploadNow();
		}
	}

	function onIntervalToggle() {
		var ivOn = state.intervalSeconds > 0;
		if (ivOn) {
			state.intervalSeconds = 0;
			saveIntervalPref(0);
			clearIntervalTimer();
			if (elements.intervalInput) {
				elements.intervalInput.value = "";
			}
			setStatus("定时同步已关闭", "");
		} else {
			state.realtimeEnabled = false;
			saveRealtimePref(false);
			if (state.debounceTimer) {
				clearTimeout(state.debounceTimer);
				state.debounceTimer = null;
			}
			var defaultSecs = 5;
			state.intervalSeconds = defaultSecs;
			saveIntervalPref(defaultSecs);
			if (elements.intervalInput) {
				elements.intervalInput.value = String(defaultSecs);
			}
			setupIntervalTimer();
			setStatus("定时同步：每 " + defaultSecs + " 秒", "");
			if (state.isLoggedIn) {
				uploadNow();
			}
		}
		updateMutualExclusionUI();
		if (state.isLoggedIn && ivOn) {
			uploadNow();
		}
	}

	function commitIntervalValue() {
		if (!elements.intervalInput) return;
		var val = elements.intervalInput.value;
		var seconds = parseInt(val, 10);
		if (isNaN(seconds) || seconds < 1) {
			seconds = 0;
		}
		if (seconds === 0) {
			state.intervalSeconds = 0;
			saveIntervalPref(0);
			clearIntervalTimer();
			if (elements.intervalInput) {
				elements.intervalInput.value = "";
			}
			updateMutualExclusionUI();
			setStatus("定时同步已关闭", "");
			if (state.isLoggedIn) {
				uploadNow();
			}
			return;
		}
		state.intervalSeconds = seconds;
		saveIntervalPref(seconds);
		if (elements.intervalInput) {
			elements.intervalInput.value = String(seconds);
		}
		setupIntervalTimer();
		setStatus("定时同步：每 " + seconds + " 秒", "");
		if (state.isLoggedIn) {
			uploadNow();
		}
	}

	function onIntervalKeypress(e) {
		if (e.key === "Enter") {
			e.preventDefault();
			elements.intervalInput.blur();
		}
	}

	function onIntervalFocus() {
		clearIntervalTimer();
	}

	function onManualSync() {
		if (!state.isLoggedIn) {
			setStatus("请先登录后再同步", "error");
			return;
		}
		if (elements.manualSyncBtn) {
			elements.manualSyncBtn.classList.add("isSyncing");
		}
		uploadNow().then(function(uploadResult) {
			if (uploadResult.success) {
				setTimeout(function() {
					downloadNow().then(function() {
						if (elements.manualSyncBtn) {
							elements.manualSyncBtn.classList.remove("isSyncing");
						}
					});
				}, 500);
			} else {
				if (elements.manualSyncBtn) {
					elements.manualSyncBtn.classList.remove("isSyncing");
				}
			}
		});
	}

	function onUndo() {
		if (state.undoStack.length === 0) return;
		flushUndoSnapshot();
		performUndo();
	}

	function onClear() {
		if (!elements.textarea) return;
		var currentText = elements.textarea.value;
		if (!currentText) return;
		flushUndoSnapshot();
		pushUndoState(currentText);
		setLocalText("");
		applyTextToTextarea("", true);
		state.undoLastSnapshot = "";
		markDirty();
		setStatus("已清空 " + new Date().toLocaleTimeString(), "success");
		if (state.realtimeEnabled && state.isLoggedIn) {
			scheduleRealtimeUpload();
		}
		elements.textarea.focus();
	}

	function onAuthStateChange(user) {
		state.isLoggedIn = !!user;

		if (elements.textarea) {
			elements.textarea.disabled = !state.isLoggedIn;
		}
		if (elements.realtimeToggle) {
			elements.realtimeToggle.disabled = !state.isLoggedIn;
		}
		if (elements.intervalToggle) {
			elements.intervalToggle.disabled = !state.isLoggedIn;
		}
		if (elements.intervalInput) {
			elements.intervalInput.disabled = !state.isLoggedIn;
		}
		if (elements.manualSyncBtn) {
			elements.manualSyncBtn.disabled = !state.isLoggedIn;
		}
		if (elements.clearBtn) {
			elements.clearBtn.disabled = !state.isLoggedIn;
		}
		updateUndoButton();

		if (state.isLoggedIn) {
			state.undoStack = [];
			state.undoLastSnapshot = null;
			updateUndoButton();

			setStatus("登录成功，正在加载云端数据...", "syncing");
			var localText = getLocalText();
			applyTextToTextarea(localText, true);
			state.undoLastSnapshot = localText;

			var localPrefs = getLocalPrefs();
			applyPrefs(localPrefs);

			setTimeout(function() {
				downloadNow().then(function(result) {
					if (!result.success && result.message === "云端暂无数据") {
						if (localText || state.realtimeEnabled || state.intervalSeconds > 0) {
							uploadNow();
						} else {
							setStatus("就绪，请输入文字", "");
						}
					}
				});
			}, 300);
		} else {
			clearIntervalTimer();
			if (state.debounceTimer) {
				clearTimeout(state.debounceTimer);
				state.debounceTimer = null;
			}
			if (state.undoDebounceTimer) {
				clearTimeout(state.undoDebounceTimer);
				state.undoDebounceTimer = null;
			}
			markClean();
			setStatus("请登录以使用云端同步", "error");
		}
	}

	function initTheme() {
		var saved = null;
		try { saved = localStorage.getItem("smartCubeTheme"); } catch(e) {}
		var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
		var theme = saved || (prefersDark ? "dark" : "light");
		applyTheme(theme, false);
	}

	function applyTheme(theme, save) {
		theme = theme === "dark" ? "dark" : "light";
		document.documentElement.dataset.theme = theme;
		var themeBtn = document.getElementById("siteThemeToggle");
		if (themeBtn) {
			themeBtn.textContent = theme === "dark" ? "☀" : "☾";
		}
		if (save !== false) {
			try { localStorage.setItem("smartCubeTheme", theme); } catch(e) {}
			if (window.globalDataManager && window.globalDataManager.isReady()) {
				window.globalDataManager.saveThemePreference(theme).catch(function(error) {
					console.warn("[Theme] 云端主题同步失败:", error);
				});
			}
		}
	}

	function waitForServices(callback) {
		var checks = 0;
		var maxChecks = 100;

		function check() {
			checks++;
			if (window.authManager && window.storageManager && window.supabaseClient !== undefined) {
				callback();
				return;
			}
			if (checks >= maxChecks) {
				setStatus("服务加载失败，请刷新页面", "error");
				return;
			}
			setTimeout(check, 50);
		}
		check();
	}

	function init() {
		initTheme();

		elements.realtimeToggle = $("realtimeToggle");
		elements.intervalToggle = $("intervalToggle");
		elements.intervalWrap = $("intervalWrap");
		elements.intervalInput = $("intervalInput");
		elements.manualSyncBtn = $("manualSyncBtn");
		elements.undoBtn = $("undoBtn");
		elements.clearBtn = $("clearBtn");
		elements.syncStatus = $("syncStatus");
		elements.textarea = $("relayTextarea");

		if (elements.textarea) {
			elements.textarea.addEventListener("input", onTextareaInput);
			elements.textarea.addEventListener("keydown", onTextareaKeydown);
			elements.textarea.addEventListener("blur", onTextareaBlur);
		}
		if (elements.realtimeToggle) {
			elements.realtimeToggle.addEventListener("click", onRealtimeToggle);
		}
		if (elements.intervalToggle) {
			elements.intervalToggle.addEventListener("click", onIntervalToggle);
		}
		if (elements.intervalInput) {
			elements.intervalInput.addEventListener("focus", onIntervalFocus);
			elements.intervalInput.addEventListener("blur", commitIntervalValue);
			elements.intervalInput.addEventListener("keydown", onIntervalKeypress);
		}
		if (elements.manualSyncBtn) {
			elements.manualSyncBtn.addEventListener("click", onManualSync);
		}
		if (elements.undoBtn) {
			elements.undoBtn.addEventListener("click", onUndo);
		}
		if (elements.clearBtn) {
			elements.clearBtn.addEventListener("click", onClear);
		}

		updateUndoButton();

		waitForServices(function() {
			if (window.siteNav && typeof window.siteNav.init === "function") {
				window.siteNav.init({
					setTheme: function(theme) {
						applyTheme(theme, true);
					}
				});
			}

			window._siteNavQuickUpload = function() {
				if (!state.isLoggedIn) {
					setStatus("请先登录", "error");
					return Promise.resolve({ success: false });
				}
				return uploadNow();
			};
			markClean();

			if (window.authManager) {
				window.authManager.init();
				window.authManager.onAuthStateChange(function(user) {
					onAuthStateChange(user);
					if (user && window.globalDataManager) {
						window.globalDataManager.applyCloudThemeIfLoggedIn();
					}
				});
			} else {
				onAuthStateChange(null);
			}
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
