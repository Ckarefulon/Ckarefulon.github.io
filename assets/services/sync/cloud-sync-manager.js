(function() {
	"use strict";

	/**
	 * cloudSyncManager — 手动云同步
	 *
	 * 本阶段只做手动上传/下载，不做自动同步。
	 * 所有云端读写都使用 user_id + site_scope。
	 * 只上传 cube_memory_progress、smartCubeFormulaEntries 和 smartCubeStateImportText。
	 * 不上传 smartCubeMacMap、smartCubeTheme、密码、token、Supabase session。
	 */

	var cloudSyncManager = {
		/**
		 * 判断是否就绪：已登录 + Supabase 可用 + siteScope 可用
		 * @returns {boolean}
		 */
		isReady: function() {
			return !!(window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
		},

		/**
		 * 从本地构建上传数据负载
		 * @returns {object}
		 */
		buildLocalPayload: function() {
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";
			var basePath = window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : "/Cube/Formula";
			var mem = window.storageManager ? window.storageManager.getJson("cube_memory_progress", null) : null;
			var entries = window.storageManager ? window.storageManager.getJson("smartCubeFormulaEntries", []) : [];
			var stateImportText = window.storageManager ? window.storageManager.getItem("smartCubeStateImportText", "") : "";

			return {
				exportedAt: new Date().toISOString(),
				source: "Ckarefulon",
				siteScope: scope,
				siteBasePath: basePath,
				version: 1,
				data: {
					cube_memory_progress: mem,
					smartCubeFormulaEntries: entries,
					smartCubeStateImportText: stateImportText
				}
			};
		},

		/**
		 * 获取云端数据状态
		 * @returns {Promise<{success: boolean, message: string, hasData: boolean, cloudData: object|null}>}
		 */
		getCloudStatus: function() {
			if (!cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录", hasData: false, cloudData: null });
			}

			var user = window.authManager.getUser();
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";

			return window.supabaseClient
				.from("user_data")
				.select("data, updated_at")
				.eq("user_id", user.id)
				.eq("site_scope", scope)
				.maybeSingle()
				.then(function(result) {
					if (result.error) {
						console.error("[CloudSync] 查询云端状态失败:", result.error);
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
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";
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
				// 记录已同步的数据快照（仅 data 部分），供 beforeunload 对比
				window._siteNavLastSyncedData = JSON.stringify(payload.data);
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
			return applied;
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
			var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";

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
