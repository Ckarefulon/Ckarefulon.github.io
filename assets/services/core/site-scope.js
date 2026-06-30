(function() {
	"use strict";

	/**
	 * siteScope - 统一站点作用域
	 *
	 * 当前站点会按路径映射到对应的 site scope。
	 * Cube/Formula 和 Cube/Formula/Beta 共用 Cube-Formula。
	 * Tools/Relay 共用 Tools-Relay。
	 */

	function normalizePathname(pathname) {
		return (pathname || "").replace(/\/+$/, "") || "/";
	}

	function getCurrentSiteScope() {
		var path = normalizePathname(window.location.pathname);
		if (path.indexOf("/Tools/Relay") === 0) {
			return "Tools-Relay";
		}
		if (path === "/Cube/Formula" || path === "/Cube/Formula/Beta") {
			return "Cube-Formula";
		}
		return "Cube-Formula";
	}

	function getCurrentSiteBasePath() {
		var path = normalizePathname(window.location.pathname);
		if (path.indexOf("/Tools/Relay") === 0) {
			return "/Tools/Relay";
		}
		if (path === "/Cube/Formula" || path === "/Cube/Formula/Beta") {
			return "/Cube/Formula";
		}
		return "/Cube/Formula";
	}

	window.getCurrentSiteScope = getCurrentSiteScope;
	window.getCurrentSiteBasePath = getCurrentSiteBasePath;
	window.normalizePathname = normalizePathname;
})();
