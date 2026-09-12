(function() {
	"use strict";

	/**
	 * siteScope - 统一站点作用域
	 *
	 * 当前站点按路径映射到对应的 site scope。
	 * Cube/Formula 及 Cube/Formula/Beta 归入 Cube-Formula。
	 * Cube/Analyzer 归入 Cube-Analyzer，Cube/Cross 归入 Cube-Cross。
	 * Tools/Relay 归入 Tools-Relay，Tools/Pulse 归入 Tools-Pulse。
	 * Study/Focus 归入 Study/Focus。
	 */

	function normalizePathname(pathname) {
		return (pathname || "").replace(/\/+$/, "") || "/";
	}

	function getCurrentSiteScope() {
		var path = normalizePathname(window.location.pathname);
		if (path === "/Study/Focus" || path.indexOf("/Study/Focus/") === 0) {
			return "Study/Focus";
		}
		if (path.indexOf("/Tools/Pulse") === 0) {
			return "Tools-Pulse";
		}
		if (path.indexOf("/Tools/Relay") === 0) {
			return "Tools-Relay";
		}
		if (path.indexOf("/Cube/Cross") === 0) {
			return "Cube-Cross";
		}
		if (path.indexOf("/Cube/Analyzer") === 0) {
			return "Cube-Analyzer";
		}
		if (path === "/Cube/Formula" || path === "/Cube/Formula/Beta") {
			return "Cube-Formula";
		}
		return "Cube-Formula";
	}

	function getCurrentSiteBasePath() {
		var path = normalizePathname(window.location.pathname);
		if (path === "/Study/Focus" || path.indexOf("/Study/Focus/") === 0) {
			return "/Study/Focus";
		}
		if (path.indexOf("/Tools/Pulse") === 0) {
			return "/Tools/Pulse";
		}
		if (path.indexOf("/Tools/Relay") === 0) {
			return "/Tools/Relay";
		}
		if (path.indexOf("/Cube/Cross") === 0) {
			return "/Cube/Cross";
		}
		if (path.indexOf("/Cube/Analyzer") === 0) {
			return "/Cube/Analyzer";
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
