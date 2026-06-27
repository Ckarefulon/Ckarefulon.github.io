(function() {
	"use strict";

	/**
	 * authManager — Supabase Auth 登录状态管理
	 *
	 * 本阶段只做登录/注册/退出，不做云端数据同步。
	 * 不读写 public.user_data，不上传/拉取本地数据。
	 * 登录/退出不会删除 localStorage 数据。
	 */

	var authManager = {
		_user: null,
		_listeners: [],

		/**
		 * 初始化：检测当前 session，监听状态变化
		 */
		init: function() {
			var client = window.supabaseClient;
			if (!client) {
				// Supabase 未配置，静默降级，游客模式正常使用
				authManager._notify(null);
				return;
			}

			// 检测当前 session
			client.auth.getSession().then(function(result) {
				if (result.error) {
					console.warn("[Auth] 获取 session 失败:", result.error.message);
					authManager._user = null;
				} else {
					authManager._user = result.data && result.data.session ? result.data.session.user : null;
				}
				authManager._notify(authManager._user);
			}).catch(function(error) {
				console.warn("[Auth] 获取 session 异常:", error);
				authManager._user = null;
				authManager._notify(null);
			});

			// 监听状态变化
			client.auth.onAuthStateChange(function(event, session) {
				authManager._user = session ? session.user : null;
				authManager._notify(authManager._user);
			});
		},

		/**
		 * 注册
		 * @param {string} email
		 * @param {string} password
		 * @returns {Promise<{success: boolean, message: string, user: object|null}>}
		 */
		signUp: function(email, password) {
			var client = window.supabaseClient;
			if (!client) {
				return Promise.resolve({ success: false, message: "Supabase 配置未完成", user: null });
			}
			return client.auth.signUp({ email: email, password: password }).then(function(result) {
				if (result.error) {
					return { success: false, message: authManager._translateError(result.error.message), user: null };
				}
				if (result.data.user && result.data.user.identities && result.data.user.identities.length === 0) {
					return { success: false, message: "该邮箱已被注册", user: null };
				}
				if (result.data.session) {
					authManager._user = result.data.user;
					authManager._notify(authManager._user);
					return { success: true, message: "注册成功", user: result.data.user };
				}
				// 需要邮箱确认
				return { success: true, message: "注册成功，请检查邮箱", user: result.data.user };
			}).catch(function(error) {
				return { success: false, message: "注册失败，请稍后重试", user: null };
			});
		},

		/**
		 * 登录
		 * @param {string} email
		 * @param {string} password
		 * @returns {Promise<{success: boolean, message: string, user: object|null}>}
		 */
		signIn: function(email, password) {
			var client = window.supabaseClient;
			if (!client) {
				return Promise.resolve({ success: false, message: "Supabase 配置未完成", user: null });
			}
			return client.auth.signInWithPassword({ email: email, password: password }).then(function(result) {
				if (result.error) {
					return { success: false, message: authManager._translateError(result.error.message), user: null };
				}
				authManager._user = result.data.user;
				authManager._notify(authManager._user);
				return { success: true, message: "登录成功", user: result.data.user };
			}).catch(function(error) {
				return { success: false, message: "登录失败，请稍后重试", user: null };
			});
		},

		/**
		 * 用户名登录（通过 Edge Function）
		 * @param {string} username
		 * @param {string} password
		 * @returns {Promise<{success: boolean, message: string, user: object|null}>}
		 */
		signInWithUsername: function(username, password) {
			var client = window.supabaseClient;
			var config = window.CK_SUPABASE_CONFIG;
			if (!client || !config) {
				return Promise.resolve({ success: false, message: "Supabase 配置未完成", user: null });
			}

			var functionUrl = config.url + "/functions/v1/username-login";
			var apikey = config.publishableKey;

			return fetch(functionUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"apikey": apikey,
					"Authorization": "Bearer " + apikey
				},
				body: JSON.stringify({ username: username, password: password })
			}).then(function(response) {
				return response.json().catch(function() {
					return { success: false };
				}).then(function(data) {
					if (!response.ok || !data.success || !data.session) {
						return { success: false, message: "账号或密码错误", user: null };
					}
					var session = data.session;
					return client.auth.setSession({
						access_token: session.access_token,
						refresh_token: session.refresh_token
					}).then(function(setResult) {
						if (setResult.error) {
							return { success: false, message: "账号或密码错误", user: null };
						}
						authManager._user = setResult.data.user;
						authManager._notify(authManager._user);
						return { success: true, message: "登录成功", user: setResult.data.user };
					});
				});
			}).catch(function() {
				return { success: false, message: "账号或密码错误", user: null };
			});
		},

		/**
		 * 退出登录
		 * @returns {Promise<{success: boolean, message: string}>}
		 */
		signOut: function() {
			var client = window.supabaseClient;
			if (!client) {
				return Promise.resolve({ success: false, message: "Supabase 配置未完成" });
			}
			return client.auth.signOut().then(function(result) {
				authManager._user = null;
				authManager._notify(null);
				return { success: true, message: "退出成功" };
			}).catch(function(error) {
				return { success: false, message: "退出失败，请稍后重试" };
			});
		},

		/**
		 * 获取当前用户
		 * @returns {object|null}
		 */
		getUser: function() {
			return authManager._user;
		},

		/**
		 * 是否已登录
		 * @returns {boolean}
		 */
		isLoggedIn: function() {
			return !!authManager._user;
		},

		/**
		 * 注册状态变化回调
		 * @param {function} callback - 参数为 user 对象或 null
		 */
		onAuthStateChange: function(callback) {
			if (typeof callback === "function") {
				authManager._listeners.push(callback);
				// 立即回调当前状态
				callback(authManager._user);
			}
		},

		/**
		 * 通知所有监听器
		 */
		_notify: function(user) {
			authManager._listeners.forEach(function(cb) {
				try { cb(user); } catch (e) {}
			});
		},

		/**
		 * 翻译错误信息为中文
		 */
		_translateError: function(message) {
			if (!message) return "操作失败";
			var lower = message.toLowerCase();
			if (lower.indexOf("invalid login credentials") >= 0) return "账号或密码错误";
			if (lower.indexOf("email not confirmed") >= 0) return "请先确认邮箱";
			if (lower.indexOf("user already registered") >= 0) return "该邮箱已被注册";
			if (lower.indexOf("password") >= 0 && lower.indexOf("length") >= 0) return "密码长度不足（至少 6 位）";
			if (lower.indexOf("rate limit") >= 0) return "请求过于频繁，请稍后重试";
			if (lower.indexOf("network") >= 0) return "网络错误，请检查连接";
			return "登录失败";
		}
	};

	window.authManager = authManager;
})();