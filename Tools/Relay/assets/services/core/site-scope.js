(function() {
	"use strict";

	/**
	 * siteScope — Relay 站点作用域
	 *
	 * siteScope = "Tools-Relay"（基于路径名，/Tools/Relay → Tools-Relay）
	 * 用于 Supabase 云端存储，按 user_id + site_scope 区分不同网站数据。
	 */

	function normalizePathname(pathname) {
		return (pathname || "").replace(/\/+$/, "") || "/";
	}

	function getCurrentSiteScope() {
		var path = normalizePathname(window.location.pathname);
		if (path.indexOf("/Tools/Relay") === 0) return "Tools-Relay";
		return "Tools-Relay";
	}

	function getCurrentSiteBasePath() {
		return "/Tools/Relay";
	}

	window.getCurrentSiteScope = getCurrentSiteScope;
	window.getCurrentSiteBasePath = getCurrentSiteBasePath;
	window.normalizePathname = normalizePathname;
})();
