(function() {
	"use strict";

	var profileManager = {
		_cache: null,
		_listeners: [],
		_ready: false,

		init: function() {
			var self = this;
			if (window.authManager) {
				window.authManager.onAuthStateChange(function(user) {
					self._cache = null;
					self._ready = true;
					self._notify(user ? self._cache : null);
				});
			} else {
				self._ready = true;
			}
		},

		isReady: function() {
			return this._ready;
		},

		getCurrentUser: function() {
			return window.authManager ? window.authManager.getUser() : null;
		},

		getOwnProfile: function() {
			var self = this;
			var user = this.getCurrentUser();
			if (!user) {
				return Promise.resolve({ success: false, message: "未登录", profile: null });
			}
			var client = window.supabaseClient;
			if (!client) {
				return Promise.resolve({ success: false, message: "Supabase 未配置", profile: null });
			}
			return client
				.from("user_profiles")
				.select("user_id, username, updated_at")
				.eq("user_id", user.id)
				.maybeSingle()
				.then(function(result) {
					if (result.error) {
						return { success: false, message: "读取资料失败", profile: null };
					}
					self._cache = result.data || null;
					return { success: true, profile: result.data || null };
				})
				.catch(function() {
					return { success: false, message: "网络错误", profile: null };
				});
		},

		getUsername: function() {
			var self = this;
			return this.getOwnProfile().then(function(result) {
				if (result.success && result.profile) {
					return { success: true, username: result.profile.username };
				}
				return { success: false, username: null };
			});
		},

		validateUsername: function(username) {
			if (typeof username !== "string") {
				return { valid: false, message: "用户名必须是字符串" };
			}
			var trimmed = username.trim();
			if (username !== trimmed) {
				return { valid: false, message: "用户名不能包含前后空格" };
			}
			if (username.length < 2 || username.length > 32) {
				return { valid: false, message: "用户名长度需在 2 到 32 个字符之间" };
			}
			if (username.indexOf("@") >= 0) {
				return { valid: false, message: "用户名不能包含 @ 符号" };
			}
			if (!/^[A-Za-z0-9._ -]+$/.test(username)) {
				return { valid: false, message: "用户名只能包含英文字母、数字、空格、-、_、." };
			}
			return { valid: true };
		},

		saveUsername: function(username) {
			var self = this;
			var user = this.getCurrentUser();
			if (!user) {
				return Promise.resolve({ success: false, message: "未登录" });
			}
			var validation = this.validateUsername(username);
			if (!validation.valid) {
				return Promise.resolve({ success: false, message: validation.message });
			}
			var client = window.supabaseClient;
			if (!client) {
				return Promise.resolve({ success: false, message: "Supabase 未配置" });
			}
			return client
				.from("user_profiles")
				.upsert({
					user_id: user.id,
					username: username,
					updated_at: new Date().toISOString()
				}, {
					onConflict: "user_id"
				})
				.then(function(result) {
					if (result.error) {
						if (result.error.code === "23505") {
							return { success: false, message: "用户名已被占用" };
						}
						return { success: false, message: "保存失败：" + (result.error.message || "未知错误") };
					}
					self._cache = {
						user_id: user.id,
						username: username,
						updated_at: new Date().toISOString()
					};
					self._notify(self._cache);
					return { success: true, message: "保存成功" };
				})
				.catch(function() {
					return { success: false, message: "网络错误，请稍后重试" };
				});
		},

		onProfileChange: function(callback) {
			if (typeof callback === "function") {
				this._listeners.push(callback);
			}
		},

		_notify: function(profile) {
			this._listeners.forEach(function(cb) {
				try { cb(profile); } catch (e) {}
			});
		}
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function() {
			profileManager.init();
		});
	} else {
		profileManager.init();
	}

	window.profileManager = profileManager;
})();
