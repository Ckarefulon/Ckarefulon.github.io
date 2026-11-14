/**
 * Study/Focus 的 SyncCore 接入层
 *
 * 目的：这个页面以前把整份 { sessions, goal } 用 upsert 直接盖到云端，
 * 而且挂载的是「最后加载者赢」的 window.cloudSyncManager 全局。
 * 这里改为向 SyncCore 注册 profile：
 *   · 写：交给 SyncCore（CAS + 冲突合并 + 服务端历史 + 空闸门）
 *   · 读：交给 SyncCore（cloud 与本地按 id/mut 做并集合并，绝不整份覆盖）
 *
 * 依赖：sync-core.js、site-scope.js、supabase-*.js、focus-app.js
 * 加载顺序：必须排在 focus-app.js 之后（要复用它的 data / save / renderAll）
 */
(function() {
	"use strict";

	var SCOPE = "Study-Focus";
	var LS_KEY = "studyTracker.v1";

	function waitFor(cond, timeoutMs, intervalMs) {
		return new Promise(function(resolve, reject) {
			var started = Date.now();
			(function tick() {
				var ok = false;
				try { ok = !!cond(); } catch (e) { ok = false; }
				if (ok) { resolve(true); return; }
				if (Date.now() - started > (timeoutMs || 8000)) { reject(new Error("waitFor timeout")); return; }
				setTimeout(tick, intervalMs || 80);
			})();
		});
	}

	function readLocal() {
		try {
			var raw = localStorage.getItem(LS_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	}

	/**
	 * 合并：云端 ∪ 本地，按 id 取 mut 大的那条（与 focus-app.js 的 mergeFromCloud 同口径）。
	 * 这是「多设备同时记录都不丢」的关键 —— 旧代码在这里是整份替换。
	 */
	function mergeSessions(local, cloud) {
		var byId = {};
		var i;

		(cloud.sessions || []).forEach(function(s) {
			if (!s || typeof s.id !== "string" || !s.id) return;
			if (typeof s.start !== "number" || typeof s.end !== "number" || s.end <= s.start) return;
			byId[s.id] = { id: s.id, start: s.start, end: s.end, mut: Number(s.mut) || 0, del: !!s.del };
		});

		(local.sessions || []).forEach(function(s) {
			if (!s || typeof s.id !== "string" || !s.id) return;
			var other = byId[s.id];
			if (!other || (Number(s.mut) || 0) > (other.mut || 0)) {
				byId[s.id] = { id: s.id, start: s.start, end: s.end, mut: Number(s.mut) || 0, del: !!s.del };
			}
		});

		var merged = Object.keys(byId).map(function(k) { return byId[k]; });

		// goal：取 mut 更新的那个，平手用本地
		var goal = local.goal;
		var goalMut = Number(local.goalMut) || 0;
		if (typeof cloud.goal === "number" && (Number(cloud.goalMut) || 0) > goalMut) {
			goal = cloud.goal;
			goalMut = Number(cloud.goalMut) || 0;
		}

		return {
			data: { sessions: merged, goal: goal, goalMut: goalMut },
			changed: merged.length !== (local.sessions || []).length ||
				goal !== local.goal
		};
	}

	function isEmpty(block) {
		if (!block) return true;
		var sessions = Array.isArray(block.sessions) ? block.sessions : [];
		var goalDefault = !block.goal || Number(block.goal) === 120;
		return sessions.length === 0 && goalDefault;
	}

	/* ---------------------------------------------------------------
	 * 注册 profile
	 * ------------------------------------------------------------- */
	function register() {
		if (!window.SyncCore) {
			console.warn("[Focus/SyncCore] sync-core.js 未加载，保留旧同步路径");
			return false;
		}

		window.SyncCore.registerProfile(SCOPE, {
			/**
			 * 读本地。优先用 focus-app.js 的内存对象 data（它是唯一真相源，
			 * 页面上的改动立刻反映在里面），读不到才回落到 localStorage。
			 */
			buildPayload: function() {
				var app = window.__focusData;
				var block;
				if (app) {
					block = {
						sessions: app.sessions || [],
						goal: app.goal,
						goalMut: app.goalMut || 0
					};
				} else {
					block = readLocal() || { sessions: [], goal: 120, goalMut: 0 };
				}
				return {
					exportedAt: new Date().toISOString(),
					source: "Ckarefulon",
					siteScope: SCOPE,
					version: 2,
					app: "study-focus",
					data: block
				};
			},

			/**
			 * 写回本地。云端数据是 { sessions, goal, goalMut } 这一层。
			 * 写完必须让页面重新渲染，否则用户看到的还是旧数字。
			 */
			applyPayload: function(block) {
				var app = window.__focusData;
				if (!app) {
					localStorage.setItem(LS_KEY, JSON.stringify(block));
					return { storageOnly: true };
				}

				app.sessions = Array.isArray(block.sessions) ? block.sessions : [];
				app.goal = typeof block.goal === "number" ? block.goal : app.goal;
				app.goalMut = Number(block.goalMut) || 0;

				try { localStorage.setItem(LS_KEY, JSON.stringify(app)); } catch (e) { /* 配额满不阻断 */ }
				if (typeof window.__focusRerender === "function") {
					try { window.__focusRerender(); } catch (e) { /* ignore */ }
				}
				return { sessions: true, goal: true };
			},

			isEmpty: isEmpty,
			merge: mergeSessions,

			/** 这些 key 一变就算脏，触发自动上传 */
			storageKeys: [LS_KEY]
		});

		return true;
	}

	/* ---------------------------------------------------------------
	 * 把旧路径切断：focus-app.js 里的 pushFocus / pullFocus 不再自己发包
	 * ------------------------------------------------------------- */
	function patchLegacy() {
		if (typeof window.pushFocus === "function") {
			window.pushFocus = function() {
				if (!window.SyncCore || !window.SyncCore.hasProfile(SCOPE)) return;
				window.SyncCore.scheduleUpload(800, SCOPE);
			};
		}
		if (typeof window.pullFocus === "function") {
			window.pullFocus = function() {
				if (!window.SyncCore || !window.SyncCore.hasProfile(SCOPE)) return;
				window.SyncCore.pull({ reason: "登录后对齐" }).then(function(r) {
					if (r.success && r.changed && typeof window.__focusRerender === "function") {
						try { window.__focusRerender(); } catch (e) { /* ignore */ }
					}
				});
			};
		}
	}

	/* ---------------------------------------------------------------
	 * 启动：等页面数据就绪 → 注册 → 登录后拉取
	 * ------------------------------------------------------------- */
	function boot() {
		if (!register()) return;

		waitFor(function() { return !!(window.__focusData && window.authManager); }, 8000)
			.then(function() {
				patchLegacy();

				if (window.authManager.isLoggedIn && window.authManager.isLoggedIn()) {
					return window.SyncCore.pull({ reason: "页面载入对齐" }).then(function(r) {
						// 云端为空（第一次用）⇒ 把本地推上去，保证云端建行
						if (!r.success && r.empty) {
							return window.SyncCore.save({ reason: "首次上传" });
						}
					});
				}
			})
			.catch(function(err) {
				console.warn("[Focus/SyncCore] 启动对齐失败，本地功能不受影响:", err && err.message);
			});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
