(function() {
	"use strict";

	/**
	 * cloudSyncManager — 手动云同步
	 *
	 * 本阶段只做手动上传/下载，不做自动同步。
	 * 所有云端读写都使用 user_id + site_scope。
	 * 只上传 cube_memory_progress、smartCubeFormulaEntries 和 smartCubePracticeStats。
	 * 不上传 smartCubeMacMap、smartCubeTheme、密码、token、Supabase session。
	 * smartCubeStateImportText 已合并到 cube_memory_progress 中（planText 字段）。
	 */

/* 没有可用站点作用域时的统一提示：宁可不同步，也不准写到别的作用域 */
var NO_SCOPE_MESSAGE = "当前路径没有可用的站点作用域，已阻止云端读写";

/* 自动上传防抖定时器 */
var autoSyncTimer = null;

/**
 * payload 数据块是否包含有意义的内容（任一字段非空即算有）
 * 用于空数据闸门：本地空 + 云端有 ⇒ 拒绝自动上传，防止空状态覆盖云端备份
 * @param {object} data - payload.data
 * @returns {boolean}
 */
function hasPayloadData(data) {
	if (!data || typeof data !== "object") return false;
	var keys = ["cube_memory_progress", "smartCubeFormulaEntries", "smartCubePracticeStats"];
	for (var i = 0; i < keys.length; i++) {
		var v = data[keys[i]];
		if (v == null) continue;
		if (Array.isArray(v)) { if (v.length > 0) return true; continue; }
		if (typeof v === "object") { if (Object.keys(v).length > 0) return true; continue; }
		if (typeof v === "string") { if (v) return true; continue; }
		return true;
	}
	return false;
}

/**
 * 生成 payload 的指纹块（随 data 一起上传）
 * 有了它，云端只需 select data->meta 几百字节就能判断「数据变没变」，不必下载整份数据
 * @param {object} data - payload.data（不含 meta）
 * @returns {object}
 */
function buildMeta(data) {
	var itemCount = 0;
	Object.keys(data || {}).forEach(function(k) {
		if (k === "meta") return;
		var v = data[k];
		if (v == null) return;
		if (Array.isArray(v)) { if (v.length) { itemCount++; } return; }
		if (typeof v === "object") { if (Object.keys(v).length) { itemCount++; } return; }
		if (v !== "") { itemCount++; }
	});
	var bytes = 0;
	try { bytes = JSON.stringify(data).length; } catch (e) { bytes = 0; }
	return {
		bytes: bytes,
		items: itemCount,
		hash: typeof window._siteNavPayloadHash === "function" ? window._siteNavPayloadHash(data) : ""
	};
}

/**
 * 云端到底有没有真数据：优先用轻量指纹块判断，没有指纹时退回解析完整数据
 * @param {object} status - getCloudStatus 的返回值
 * @returns {boolean}
 */
function cloudHasMeaningfulData(status) {
	if (status && status.cloudMeta) { return Number(status.cloudMeta.items) > 0; }
	var d = status && status.cloudData && status.cloudData.data;
	return hasPayloadData(d);
}

	/**
	 * 取当前站点作用域；取不到返回 ""
	 * 绝不兜底到 Cube-Formula —— 那会覆盖别站点的数据
	 * @returns {string}
	 */
	function resolveScope() {
		var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "";
		if (!scope) {
			console.warn("[CloudSync] " + NO_SCOPE_MESSAGE + "：" + (window.location.pathname || ""));
		}
		return scope || "";
	}

	var cloudSyncManager = {
		/**
		 * 判断是否就绪：已登录 + Supabase 可用
		 * 注意：是否具备站点作用域请单独用 hasScope() 判断（读写前都会强制校验）
		 * @returns {boolean}
		 */
		isReady: function() {
			return !!(window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
		},

		/**
		 * 当前路径是否具备可用的站点作用域
		 * @returns {boolean}
		 */
		hasScope: function() {
			return !!resolveScope();
		},

		/**
		 * 自动同步：防抖后上传本地数据（登录且作用域可用时才生效）
		 * 空数据闸门：本地无有效数据而云端有备份时，拒绝自动上传（手动上传不受限）
		 * @param {number} [delay=1200] 防抖毫秒数
		 */
		scheduleUpload: function(delay) {
			if (autoSyncTimer) { clearTimeout(autoSyncTimer); }
			autoSyncTimer = setTimeout(function() {
				autoSyncTimer = null;
				if (!cloudSyncManager.isReady()) return;
				var scope = resolveScope();
				if (!scope) return;

				var proceed = function() {
					if (typeof window._siteNavSetCloudStatus === "function") {
						window._siteNavSetCloudStatus("正在自动保存...", "");
					}
				cloudSyncManager.uploadLocalToCloud().then(function(result) {
					if (result.success && typeof window._siteNavSetDirty === "function") {
						window._siteNavSetDirty(false);
					}
					if (typeof window._siteNavSetCloudStatus === "function") {
						window._siteNavSetCloudStatus(result.success ? "已自动保存到云端" : result.message, result.success ? "Success" : "Error");
					}
				});
				};

				var payload = cloudSyncManager.buildLocalPayload();
				if (!hasPayloadData(payload.data)) {
					// 本地为空：确认云端确实没数据才允许上传空行（走轻量指纹，不下载整份数据）
					var decide = function(status) {
						if (status.success && status.hasData && cloudHasMeaningfulData(status)) {
							if (typeof window._siteNavSetCloudStatus === "function") {
								window._siteNavSetCloudStatus("本地暂无数据，已跳过自动上传（保护云端备份）", "Warning");
							}
							return;
						}
						proceed();
					};
					cloudSyncManager.getCloudStatus({ light: true }).then(function(status) {
						if (status.success && status.hasData && !status.cloudMeta) {
							// 云端是旧的、还没有指纹块的数据 ⇒ 退回完整查询，闸门语义不弱化
							return cloudSyncManager.getCloudStatus().then(decide);
						}
						decide(status);
					}).catch(function() { proceed(); });
					return;
				}
				proceed();
			}, typeof delay === "number" ? delay : 1200);
		},

		/**
		 * 从本地构建上传数据负载
		 * @returns {object}
		 */
		buildLocalPayload: function() {
			var scope = resolveScope();
			var basePath = window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : "";
			var mem = window.storageManager ? window.storageManager.getJson("cube_memory_progress", null) : null;
			var entries = window.storageManager ? window.storageManager.getJson("smartCubeFormulaEntries", []) : [];
			var practiceStats = window.storageManager ? window.storageManager.getJson("smartCubePracticeStats", null) : null;

			var data = {
				cube_memory_progress: mem,
				smartCubeFormulaEntries: entries,
				smartCubePracticeStats: practiceStats
			};
			data.meta = buildMeta(data);

			return {
				exportedAt: new Date().toISOString(),
				source: "Ckarefulon",
				siteScope: scope,
				siteBasePath: basePath,
				version: 1,
				data: data
			};
		},

		/**
		 * 获取云端数据状态
		 * @param {object} [opts]
		 * @param {boolean} [opts.light] 只取 updated_at + data->meta（几百字节），不下载整份数据
		 * @returns {Promise<{success: boolean, message: string, hasData: boolean, cloudData: object|null, cloudMeta?: object|null}>}
		 */
		getCloudStatus: function(opts) {
			var light = !!(opts && opts.light);
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录", hasData: false, cloudData: null });
			}

			var user = window.authManager.getUser();
			var scope = resolveScope();
			if (!scope) {
				return Promise.resolve({ success: false, message: NO_SCOPE_MESSAGE, hasData: false, cloudData: null });
			}

			var query = function(cols) {
				return window.supabaseClient
					.from("user_data")
					.select(cols)
					.eq("user_id", user.id)
					.eq("site_scope", scope)
					.maybeSingle();
			};

			return query(light ? "updated_at,data->meta" : "data, updated_at")
				.then(function(result) {
					if (light && result.error) {
						// 轻量投影不被支持 ⇒ 退回完整查询，宁可这次多传点，也不能让状态检查直接失败
						console.warn("[CloudSync] 轻量投影不可用，回退完整查询:", result.error.message || result.error);
						return query("data, updated_at").then(function(full) {
							if (full.error) {
								console.error("[CloudSync] 查询云端状态失败:", full.error);
								return { success: false, message: "查询云端状态失败", hasData: false, cloudData: null };
							}
							if (!full.data) {
								return { success: true, message: "云端暂无数据", hasData: false, cloudData: null };
							}
							return { success: true, message: "云端已有数据", hasData: true, cloudData: full.data.data, updatedAt: full.data.updated_at };
						});
					}
					if (result.error) {
						console.error("[CloudSync] 查询云端状态失败:", result.error);
						return { success: false, message: "查询云端状态失败", hasData: false, cloudData: null };
					}
					if (!result.data) {
						return { success: true, message: "云端暂无数据", hasData: false, cloudData: null };
					}
					if (light) {
						var row = result.data || {};
						var meta = row.meta !== undefined ? row.meta : ((row.data && row.data.meta) || null);
						return { success: true, message: "云端已有数据", hasData: true, light: true, cloudMeta: meta, updatedAt: row.updated_at, cloudData: null };
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
					console.error("[CloudSync] 查询云端状态异常:", error);
					return { success: false, message: "查询云端状态失败", hasData: false, cloudData: null };
				});
		},

		/**
		 * 上传本地数据到云端
		 * @returns {Promise<{success: boolean, message: string}>}
		 */
		uploadLocalToCloud: function() {
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录" });
			}

			var user = window.authManager.getUser();
			var scope = resolveScope();
			if (!scope) {
				return Promise.resolve({ success: false, message: NO_SCOPE_MESSAGE });
			}
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
					console.error("[CloudSync] 上传失败:", result.error);
					return { success: false, message: "上传失败，请稍后重试" };
				}
				if (typeof window._siteNavMarkAsSynced === "function") {
					try { window._siteNavMarkAsSynced(); } catch(e) {}
				}
				return { success: true, message: "上传成功" };
			})
				.catch(function(error) {
					console.error("[CloudSync] 上传异常:", error);
					return { success: false, message: "上传失败，请稍后重试" };
				});
		},

		/**
		 * 将数据块写回本地存储（覆盖对应字段）
		 * 供云端恢复 / 文件导入共用。
		 * @param {object} dataBlock - payload.data
		 * @returns {object} 实际写入的字段名集合，便于上层提示
		 */
		applyDataToLocalStorage: function(dataBlock) {
			if (!dataBlock || typeof dataBlock !== "object") {
				return {};
			}
			window._siteNavApplyingCloudData = true;
			try {
				var applied = {};
				if (dataBlock.cube_memory_progress !== undefined) {
					window.storageManager.setJson("cube_memory_progress", dataBlock.cube_memory_progress);
					applied.cube_memory_progress = true;
				}
				if (dataBlock.smartCubeFormulaEntries !== undefined) {
					window.storageManager.setJson("smartCubeFormulaEntries", dataBlock.smartCubeFormulaEntries);
					applied.smartCubeFormulaEntries = true;
				}
				if (dataBlock.smartCubeStateImportText !== undefined) {
					window.storageManager.setItem("smartCubeStateImportText", dataBlock.smartCubeStateImportText || "");
					applied.smartCubeStateImportText = true;
				}
				if (dataBlock.smartCubePracticeStats !== undefined) {
					window.storageManager.setJson("smartCubePracticeStats", dataBlock.smartCubePracticeStats);
					applied.smartCubePracticeStats = true;
				}
				return applied;
			} finally {
				setTimeout(function() { window._siteNavApplyingCloudData = false; }, 0);
			}
		},

		/**
		 * 从云端恢复到本地
		 * @returns {Promise<{success: boolean, message: string, data: object|null}>}
		 */
		downloadCloudToLocal: function() {
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录", data: null });
			}

			var user = window.authManager.getUser();
			var scope = resolveScope();
			if (!scope) {
				return Promise.resolve({ success: false, message: NO_SCOPE_MESSAGE, data: null });
			}

			return window.supabaseClient
				.from("user_data")
				.select("data")
				.eq("user_id", user.id)
				.eq("site_scope", scope)
				.maybeSingle()
				.then(function(result) {
					if (result.error) {
						console.error("[CloudSync] 读取云端数据失败:", result.error);
						return { success: false, message: "读取云端数据失败", data: null };
					}
					if (!result.data || !result.data.data) {
						return { success: false, message: "云端暂无数据", data: null };
					}

					var cloudData = result.data.data;
					var dataBlock = cloudData.data;
					if (!dataBlock) {
						return { success: false, message: "云端数据格式不正确", data: null };
					}

					if (typeof window._siteNavPrepareOverwrite === "function") {
						var guard = window._siteNavPrepareOverwrite("云端数据恢复", dataBlock);
						if (!guard.success) {
							return { success: false, message: guard.message, data: null };
						}
					}
					cloudSyncManager.applyDataToLocalStorage(dataBlock);

					return { success: true, message: "恢复成功", data: dataBlock };
				})
				.catch(function(error) {
					console.error("[CloudSync] 恢复异常:", error);
					return { success: false, message: "恢复失败，请稍后重试", data: null };
				});
		}
	};

	window.cloudSyncManager = cloudSyncManager;
})();
