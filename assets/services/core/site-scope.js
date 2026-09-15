(function() {
	"use strict";

	/**
	 * siteScope - 统一站点作用域
	 *
	 * 作用域一律由「当前路径」自动计算，**不再有任何兜底默认值**。
	 * 绝对不允许出现「路径没配上 → 落到 Cube-Formula」的情况：那会把别的站点的数据覆盖掉。
	 *
	 * 计算规则：
	 * 1) 别名表 SCOPE_ALIASES：少数历史命名需要把多个路径合并成同一份数据
	 *    （例如 Cube/Formula 与 Cube/Formula/Beta、Cube/Formula/Classic 共用一份）。
	 *    别名里的 scope 字符串与历史保持一致，避免已有云端数据被割裂成两份。
	 * 2) 其余全部按路径推导：取前两段目录 → "模块/子模块"
	 *    /Study/Focus/        → Study/Focus
	 *    /Study/Question/     → Study/Question
	 *    /Tools/SomeNew/      → Tools/SomeNew（新增页面自动获得自己的作用域，无需登记）
	 * 3) 路径不足以判定具体页面时返回空字符串 ""（根路径、只到模块层、非目录形态的路径）：
	 *    调用方必须据此**放弃云端读写**，宁可不同步，也不能写错作用域。
	 */

	/* 历史命名别名：前缀匹配，把同一份数据的多个路径合并到一个 scope */
	var SCOPE_ALIASES = [
		{ prefix: "/Cube/Formula", scope: "Cube-Formula" },
		{ prefix: "/Cube/Analyzer", scope: "Cube-Analyzer" },
		{ prefix: "/Cube/Cross", scope: "Cube-Cross" },
		{ prefix: "/Tools/Pulse", scope: "Tools-Pulse" },
		{ prefix: "/Tools/Relay", scope: "Tools-Relay" }
	];

	/* 非页面目录：这些路径下不会有页面，直接判定为「无作用域」，避免凭空造出 assets/xxx 之类的假作用域 */
	var NON_PAGE_DIRS = ["assets", "nav", "supabase", ".UI", ".github", ".workbuddy", ".temp", "test-results", "node_modules"];

	function normalizePathname(pathname) {
		return (pathname || "").replace(/\/+$/, "") || "/";
	}

	/**
	 * 切出「目录段」：丢掉空段与 index.html，遇到带扩展名的文件段就停止
	 * @param {string} pathname
	 * @returns {string[]}
	 */
	function pathSegments(pathname) {
		var raw = normalizePathname(pathname).split("/");
		var segs = [];
		for (var i = 0; i < raw.length; i++) {
			var s = raw[i];
			if (!s || s === "index.html") continue;
			if (s.indexOf(".") >= 0) break;
			segs.push(s);
		}
		return segs;
	}

	function matchAlias(path) {
		for (var i = 0; i < SCOPE_ALIASES.length; i++) {
			var a = SCOPE_ALIASES[i];
			if (path === a.prefix || path.indexOf(a.prefix + "/") === 0) return a;
		}
		return null;
	}

	/**
	 * 按路径计算站点作用域
	 * @param {string} [pathname] 默认取 window.location.pathname
	 * @returns {string} 作用域字符串；无法判定时返回 ""（调用方必须放弃云端读写）
	 */
	function computeSiteScope(pathname) {
		var path = normalizePathname(typeof pathname === "string" ? pathname : window.location.pathname);

		var alias = matchAlias(path);
		if (alias) return alias.scope;

		var segs = pathSegments(path);
		if (segs.length < 2) return "";
		if (NON_PAGE_DIRS.indexOf(segs[0]) >= 0) return "";
		return segs[0] + "/" + segs[1];
	}

	function getCurrentSiteScope() {
		return computeSiteScope();
	}

	/**
	 * 当前页面的站点根路径；无法判定时返回 ""
	 */
	function getCurrentSiteBasePath() {
		var path = normalizePathname(window.location.pathname);

		var alias = matchAlias(path);
		if (alias) return alias.prefix;

		var segs = pathSegments(path);
		if (segs.length < 2) return "";
		if (NON_PAGE_DIRS.indexOf(segs[0]) >= 0) return "";
		return "/" + segs[0] + "/" + segs[1];
	}

	/**
	 * 当前路径是否具备可用的站点作用域
	 * 不具备时必须禁止任何云端读写（防止覆盖到别的站点）
	 * @returns {boolean}
	 */
	function hasSiteScope() {
		return !!computeSiteScope();
	}

	/**
	 * 云端读写前的统一闸门
	 * @returns {string} 可用则返回作用域；不可用返回 ""，调用方应立即中止
	 */
	function requireSiteScope() {
		var scope = computeSiteScope();
		if (!scope) {
			console.warn("[SiteScope] 当前路径没有可用的站点作用域，已阻止云端读写：" + (window.location.pathname || ""));
		}
		return scope;
	}

	window.computeSiteScope = computeSiteScope;
	window.getCurrentSiteScope = getCurrentSiteScope;
	window.getCurrentSiteBasePath = getCurrentSiteBasePath;
	window.hasSiteScope = hasSiteScope;
	window.requireSiteScope = requireSiteScope;
	window.normalizePathname = normalizePathname;
})();
