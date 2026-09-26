(function() {
	"use strict";

	/**
	 * storageManager — 统一的本地存储封装层
	 *
	 * 当前阶段内部仅使用 localStorage。
	 * 后续接入 Supabase 时，只需在此模块内扩展，不改变外部调用方。
	 */

	var storageManager = {
		/**
		 * 读取字符串
		 * @param {string} key
		 * @param {string|null} fallback
		 * @returns {string|null}
		 */
		getItem: function(key, fallback) {
			if (!storageManager.isAvailable()) {
				return fallback !== undefined ? fallback : null;
			}
			try {
				var value = localStorage.getItem(key);
				return value !== null ? value : (fallback !== undefined ? fallback : null);
			} catch (error) {
				return fallback !== undefined ? fallback : null;
			}
		},

		/**
		 * 写入字符串
		 * @param {string} key
		 * @param {string} value
		 */
		setItem: function(key, value) {
			if (!storageManager.isAvailable()) {
				storageManager.lastError = storageManager.lastError || new Error("localStorage unavailable");
				return false;
			}
			try {
				localStorage.setItem(key, value);
				return true;
			} catch (error) {
				// 不再静默：配额满 / 被禁用时记录错误并返回 false，调用方据此提示用户。
				// （静默吞掉会让数据无声丢失：内存里有、刷新就没。）
				storageManager.lastError = error;
				console.error("[storageManager] 写入失败", key, (error && error.name) || error, "size=" + (typeof value === "string" ? value.length : -1));
				return false;
			}
		},

		/**
		 * 删除
		 * @param {string} key
		 */
		removeItem: function(key) {
			if (!storageManager.isAvailable()) {
				return;
			}
			try {
				localStorage.removeItem(key);
			} catch (error) {
				// 静默降级
			}
		},

		/**
		 * 读取 JSON 对象
		 * @param {string} key
		 * @param {*} fallback
		 * @returns {*}
		 */
		getJson: function(key, fallback) {
			if (!storageManager.isAvailable()) {
				return fallback !== undefined ? fallback : null;
			}
			try {
				var raw = localStorage.getItem(key);
				if (raw === null) {
					return fallback !== undefined ? fallback : null;
				}
				return JSON.parse(raw);
			} catch (error) {
				return fallback !== undefined ? fallback : null;
			}
		},

		/**
		 * 写入 JSON 对象
		 * @param {string} key
		 * @param {*} value
		 */
		setJson: function(key, value) {
			if (!storageManager.isAvailable()) {
				storageManager.lastError = storageManager.lastError || new Error("localStorage unavailable");
				return false;
			}
			try {
				localStorage.setItem(key, JSON.stringify(value));
				return true;
			} catch (error) {
				storageManager.lastError = error;
				console.error("[storageManager] 写入失败", key, (error && error.name) || error);
				return false;
			}
		},

		/**
		 * 检查 localStorage 是否可用
		 * @returns {boolean}
		 */
		isAvailable: function() {
			if (storageManager._available !== undefined) {
				return storageManager._available;
			}
			try {
				var testKey = "__storage_test__";
				localStorage.setItem(testKey, "1");
				localStorage.removeItem(testKey);
				storageManager._available = true;
			} catch (error) {
				// 配额满 ≠ 存储不可用：仅「不可用」才判死。若把配额满误判为不可用并缓存，
				// 此后本会话所有读写都会静默空转（已有数据也读不回来）。
				storageManager.lastError = error;
				storageManager._available = !(error && /QuotaExceeded/i.test(error.name || ""));
			}
			return storageManager._available;
		},

		// 缓存可用性检测结果
		_available: undefined,
		// 最近一次读写失败原因（调用方可据此提示用户，如「存储已满」）
		lastError: null
	};

	window.storageManager = storageManager;
})();