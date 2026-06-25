(function() {
	"use strict";

	/**
	 * siteScope — 统一站点作用域
	 *
	 * 当前 siteScope = "Cube-Formula"。
	 * 后续也用于 Supabase 云端存储，按 user_id + site_scope 区分不同网站数据。
	 * 本阶段不实现云端读写。
	 */

	function normalizePathname(pathname) {
		return (pathname || "").replace(/\/+$/, "") || "/";
	}

	function getCurrentSiteScope() {
		var path = normalizePathname(window.location.pathname);
		// 显式白名单映射，不自动将 /Cube/Formula/... 归入 Cube-Formula
		var scopeMap = {
			"/Cube/Formula": "Cube-Formula",
			"/Cube/Formula/Beta": "Cube-Formula"
		};
		return scopeMap[path] || "Cube-Formula";
	}

	function getCurrentSiteBasePath() {
		var path = normalizePathname(window.location.pathname);
		var basePathMap = {
			"/Cube/Formula": "/Cube/Formula",
			"/Cube/Formula/Beta": "/Cube/Formula"
		};
		return basePathMap[path] || "/Cube/Formula";
	}

	window.getCurrentSiteScope = getCurrentSiteScope;
	window.getCurrentSiteBasePath = getCurrentSiteBasePath;
	window.normalizePathname = normalizePathname;
})();