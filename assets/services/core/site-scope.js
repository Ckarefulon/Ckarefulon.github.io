(function() {
	"use strict";

	/**
	 * siteScope - 统一站点作用域
	 *
	 * 作用域 = 登记表里登记的「站点名」，用 "-" 连接（例：Study-Focus、Cube-Formula）。
	 *
	 * 三条铁律：
	 * 1) **大小写以登记表为准，绝不用 location.pathname 推导。**
	 *    Netlify 会把 URL 强制小写（/Cube/Formula/ → /cube/formula/），
	 *    照抄网址会算成 cube-formula，与已有云端数据 Cube-Formula 对不上。
	 * 2) **没有兜底默认值。** 未登记的路径一律返回 ""，调用方必须放弃云端读写。
	 *    绝对不允许「路径没配上 → 落到 Cube-Formula」：那会把别的站点的数据覆盖掉。
	 * 3) 新增子站时在下面的 SCOPE_REGISTRY 补一行（与 nav.js 的 PATH_LABELS 同步）。
	 *
	 * 键   = 网址路径的小写形式（便于跟地址栏对照；网址本身就是小写）
	 * 值   = { scope: 作用域名（"-" 连接，含真实大小写）, path: 站点根路径（含真实大小写） }
	 *
	 * 取前两段作为作用域名（与 nav 顶栏显示口径一致）：
	 *    /study/focus/        → Study-Focus
	 *    /tools/kgenesis/     → Tools-KGenesis
	 *    /music/chord/diatonic/ → Music-Chord
	 * 需要把多个路径合并成同一份数据的（历史命名），显式写同一个 scope：
	 *    cube/formula 与 cube/formula/classic → Cube-Formula
	 */

	var SCOPE_REGISTRY = {
		"cube/formula":         { scope: "Cube-Formula",   path: "/Cube/Formula" },
		"cube/formula/classic": { scope: "Cube-Formula",   path: "/Cube/Formula/Classic" },
		"cube/analyzer":        { scope: "Cube-Analyzer",  path: "/Cube/Analyzer" },
		"cube/cross":           { scope: "Cube-Cross",     path: "/Cube/Cross" },
		"cube/music":           { scope: "Cube-Music",     path: "/Cube/Music" },
		"study/focus":          { scope: "Study-Focus",    path: "/Study/Focus" },
		"study/question":       { scope: "Study-Question", path: "/Study/Question" },
		"study/timer":          { scope: "Study-Timer",    path: "/Study/Timer" },
		"tools/kgenesis":       { scope: "Tools-KGenesis", path: "/Tools/KGenesis" },
		"tools/pulse":          { scope: "Tools-Pulse",    path: "/Tools/Pulse" },
		"tools/relay":          { scope: "Tools-Relay",    path: "/Tools/Relay" },
		"music/chord/diatonic": { scope: "Music-Chord",    path: "/Music/Chord/Diatonic" },
		"jump/onedrive":        { scope: "Jump-OneDrive",  path: "/Jump/OneDrive" },
		"linkage":              { scope: "linkage",        path: "/linkage" },
		"user/profile":         { scope: "user-profile",   path: "/user/profile" }
	};

	function normalizePathname(pathname) {
		var p = String(pathname || "");
		if (p.charAt(0) !== "/") p = "/" + p;
		return p.replace(/\/+$/, "") || "/";
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

	/**
	 * 查登记表：先按完整路径，再逐级去掉末尾段（这样 /Cube/Formula/Classic/ 命中
	 * 自己那条，Cube/Formula 下的其他子路径回落到 /Cube/Formula）
	 * 键统一小写比对，**返回的结果大小写来自登记表**，与网址大小写无关。
	 * @param {string[]} segs
	 * @returns {{scope:string, path:string}|null}
	 */
	function lookup(segs) {
		for (var i = segs.length; i >= 1; i--) {
			var key = segs.slice(0, i).join("/").toLowerCase();
			if (Object.prototype.hasOwnProperty.call(SCOPE_REGISTRY, key)) return SCOPE_REGISTRY[key];
		}
		return null;
	}

	/**
	 * 按路径查站点作用域
	 * @param {string} [pathname] 默认取 window.location.pathname
	 * @returns {string} 作用域字符串；未登记时返回 ""（调用方必须放弃云端读写）
	 */
	function computeSiteScope(pathname) {
		var entry = lookup(pathSegments(typeof pathname === "string" ? pathname : window.location.pathname));
		return entry ? entry.scope : "";
	}

	/**
	 * 按路径查站点根路径（含真实大小写）
	 * @param {string} [pathname] 默认取 window.location.pathname
	 * @returns {string} 例 "/Study/Focus"；未登记时返回 ""
	 */
	function computeSiteBasePath(pathname) {
		var entry = lookup(pathSegments(typeof pathname === "string" ? pathname : window.location.pathname));
		return entry ? entry.path : "";
	}

	function getCurrentSiteScope() {
		return computeSiteScope();
	}

	function getCurrentSiteBasePath() {
		return computeSiteBasePath();
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
			console.warn("[SiteScope] 当前路径没有登记的站点作用域，已阻止云端读写：" + (window.location.pathname || ""));
		}
		return scope;
	}

	/* 供核对用：登记表本身（测试会拿它跟 nav 顶栏显示的大小写对齐） */
	function getScopeRegistry() {
		return SCOPE_REGISTRY;
	}

	window.computeSiteScope = computeSiteScope;
	window.computeSiteBasePath = computeSiteBasePath;
	window.getCurrentSiteScope = getCurrentSiteScope;
	window.getCurrentSiteBasePath = getCurrentSiteBasePath;
	window.hasSiteScope = hasSiteScope;
	window.requireSiteScope = requireSiteScope;
	window.getScopeRegistry = getScopeRegistry;
	window.normalizePathname = normalizePathname;
})();
