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
				return;
			}
			try {
				localStorage.setItem(key, value);
			} catch (error) {
				// 静默降级，不阻塞页面
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
				return;
			}
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch (error) {
				// 静默降级
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
				storageManager._available = false;
			}
			return storageManager._available;
		},

		// 缓存可用性检测结果
		_available: undefined
	};

	window.storageManager = storageManager;
})();