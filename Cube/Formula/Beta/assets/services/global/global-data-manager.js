(function() {
	"use strict";

	/**
	 * globalDataManager — 全站用户数据管理
	 *
	 * 用于管理 user_global_data 表，不区分 site_scope。
	 * 一名用户只有一份全站数据，用于昵称、头像、全站设置、全站主题偏好等。
	 * 不读写 user_data 表，不影响路径级数据同步。
	 */

	var globalDataManager = {
		_ready: false,
		_cachedData: null,
		_cacheLoaded: false,
		_listeners: [],

		/**
		 * 初始化：监听登录状态变化
		 */
		init: function() {
			if (globalDataManager._ready) {
				return;
			}
			globalDataManager._ready = true;

			if (window.authManager && typeof window.authManager.onAuthStateChange === "function") {
				window.authManager.onAuthStateChange(function(user) {
					globalDataManager._cacheLoaded = false;
					globalDataManager._cachedData = null;
					if (user) {
						globalDataManager.applyCloudThemeIfLoggedIn();
					}
					globalDataManager._notify(user);
				});
			}
		},

		/**
		 * 判断是否就绪：已登录 + Supabase 可用
		 * @returns {boolean}
		 */
		isReady: function() {
			return !!(window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
		},

		/**
		 * 获取当前用户全站数据
		 * @returns {Promise<{success: boolean, message: string, data: object|null}>}
		 */
		getGlobalData: function() {
			if (!globalDataManager.isReady()) {
				return Promise.resolve({ success: false, message: "未登录", data: null });
			}

			if (globalDataManager._cacheLoaded) {
				return Promise.resolve({ success: true, message: "OK", data: globalDataManager._cachedData });
			}

			var user = window.authManager.getUser();

			return window.supabaseClient
				.from("user_global_data")
				.select("data, updated_at")
				.eq("user_id", user.id)
				.maybeSingle()
				.then(function(result) {
					if (result.error) {
						console.warn("[GlobalData] 读取全站数据失败:", result.error);
						return { success: false, message: "读取全站数据失败", data: null };
					}
					var data = result.data && result.data.data ? result.data.data : {};
					globalDataManager._cachedData = data;
					globalDataManager._cacheLoaded = true;
					return { success: true, message: "OK", data: data };
				})
				.catch(function(error) {
					console.warn("[GlobalData] 读取全站数据异常:", error);
					return { success: false, message: "读取全站数据失败", data: null };
				});
		},

		/**
		 * 保存全站数据（整体 upsert）
		 * @param {object} data - 完整的 data jsonb 对象
		 * @returns {Promise<{success: boolean, message: string}>}
		 */
		saveGlobalData: function(data) {
			if (!globalDataManager.isReady()) {
				return Promise.resolve({ success: false, message: "未登录" });
			}

			var user = window.authManager.getUser();
			var dataToSave = data && typeof data === "object" ? data : {};

			return window.supabaseClient
				.from("user_global_data")
				.upsert({
					user_id: user.id,
					data: dataToSave,
					updated_at: new Date().toISOString()
				}, {
					onConflict: "user_id"
				})
				.then(function(result) {
					if (result.error) {
						console.warn("[GlobalData] 保存全站数据失败:", result.error);
						return { success: false, message: "保存失败，请稍后重试" };
					}
					globalDataManager._cachedData = dataToSave;
					globalDataManager._cacheLoaded = true;
					return { success: true, message: "保存成功" };
				})
				.catch(function(error) {
					console.warn("[GlobalData] 保存全站数据异常:", error);
					return { success: false, message: "保存失败，请稍后重试" };
				});
		},

		/**
		 * 获取主题偏好
		 * @returns {Promise<{success: boolean, theme: string|null}>}
		 */
		getThemePreference: function() {
			return globalDataManager.getGlobalData().then(function(result) {
				if (!result.success || !result.data) {
					return { success: false, theme: null };
				}
				var theme = result.data.preferences && result.data.preferences.theme;
				if (theme === "dark" || theme === "light") {
					return { success: true, theme: theme };
				}
				return { success: true, theme: null };
			});
		},

		/**
		 * 保存主题偏好（合并到现有 data，不覆盖其他字段）
		 * @param {string} theme - "dark" 或 "light"
		 * @returns {Promise<{success: boolean, message: string}>}
		 */
		saveThemePreference: function(theme) {
			if (theme !== "dark" && theme !== "light") {
				return Promise.resolve({ success: false, message: "无效的主题值" });
			}
			if (!globalDataManager.isReady()) {
				return Promise.resolve({ success: false, message: "未登录" });
			}

			return globalDataManager.getGlobalData().then(function(result) {
				var existingData = result.success && result.data ? result.data : {};
				var nextData = {};

				for (var key in existingData) {
					if (Object.prototype.hasOwnProperty.call(existingData, key)) {
						nextData[key] = existingData[key];
					}
				}

				if (!nextData.preferences || typeof nextData.preferences !== "object") {
					nextData.preferences = {};
				} else {
					var prefsCopy = {};
					for (var pKey in nextData.preferences) {
						if (Object.prototype.hasOwnProperty.call(nextData.preferences, pKey)) {
							prefsCopy[pKey] = nextData.preferences[pKey];
						}
					}
					nextData.preferences = prefsCopy;
				}

				nextData.preferences.theme = theme;

				return globalDataManager.saveGlobalData(nextData);
			});
		},

		/**
		 * 登录后应用云端主题（如果有）
		 * 如果云端没有主题偏好，则保持当前本地主题
		 */
		applyCloudThemeIfLoggedIn: function() {
			if (!globalDataManager.isReady()) {
				return Promise.resolve({ success: false, theme: null, applied: false });
			}

			return globalDataManager.getThemePreference().then(function(result) {
				if (!result.success || !result.theme) {
					return { success: false, theme: null, applied: false };
				}

				var cloudTheme = result.theme;
				var currentTheme = document.documentElement.dataset.theme || "light";

				if (currentTheme !== cloudTheme) {
					if (window.smartCubeApp && typeof window.smartCubeApp.setTheme === "function") {
						window.smartCubeApp.setTheme(cloudTheme, false);
					} else {
						document.documentElement.dataset.theme = cloudTheme;
						var siteThemeBtn = document.getElementById("siteThemeToggle");
						if (siteThemeBtn) {
							siteThemeBtn.textContent = cloudTheme === "dark" ? "☀" : "☾";
						}
					}
					try {
						localStorage.setItem("smartCubeTheme", cloudTheme);
					} catch(e) {}
				}

				return { success: true, theme: cloudTheme, applied: currentTheme !== cloudTheme };
			}).catch(function(error) {
				console.warn("[GlobalData] 应用云端主题异常:", error);
				return { success: false, theme: null, applied: false };
			});
		},

		/**
		 * 注册登录状态变化监听器
		 * @param {function} callback - 参数为 user 对象或 null
		 */
		onAuthStateChange: function(callback) {
			if (typeof callback === "function") {
				globalDataManager._listeners.push(callback);
				var user = window.authManager ? window.authManager.getUser() : null;
				callback(user);
			}
		},

		/**
		 * 通知所有监听器
		 */
		_notify: function(user) {
			globalDataManager._listeners.forEach(function(cb) {
				try { cb(user); } catch (e) {}
			});
		}
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function() {
			globalDataManager.init();
		});
	} else {
		globalDataManager.init();
	}

	window.globalDataManager = globalDataManager;
})();