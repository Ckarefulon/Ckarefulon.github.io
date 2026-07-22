(function() {
	"use strict";

	/**
	 * siteScope - ͳһվ��������
	 *
	 * ��ǰվ��ᰴ·��ӳ�䵽��Ӧ�� site scope��
	 * Cube/Formula �� Cube/Formula/Beta ���� Cube-Formula��
	 * Tools/Relay ���� Tools-Relay��
	 */

	function normalizePathname(pathname) {
		return (pathname || "").replace(/\/+$/, "") || "/";
	}

	function getCurrentSiteScope() {
		var path = normalizePathname(window.location.pathname);
		if (path.indexOf("/Tools/Pulse") === 0) {
			return "Tools-Pulse";
		}
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
		if (path.indexOf("/Tools/Pulse") === 0) {
			return "/Tools/Pulse";
		}
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
