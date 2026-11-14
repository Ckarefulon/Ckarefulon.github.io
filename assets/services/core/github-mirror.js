/*
 * GitHub 线路（github-mirror.js）—— 让「打不开 GitHub」有台阶下
 *
 * 设计三条原则：
 *
 * 1) **不绑死镜像站。** 公共镜像会集体失效，而且失效方式很杂
 *    （实测：kkgithub 证书过期、bgithub / hub.nuaa.cf 连接超时、
 *    githubfast 只允许 git/CLI、github.ur1.fun 部署暂停；
 *    gh-proxy.com 这类「前缀代理」只加速 raw / release，**不代理 HTML 页面**，
 *    拿它开讨论页只会回到代理站自己的首页）。
 *    所以线路是**一张可以在运行时替换的表**（`window.CK_GITHUB_MIRRORS`），
 *    不是写死的一个域名。
 *
 * 2) **站内优先，线路只是出口。** 反馈页的浏览、提交、回复都不需要 GitHub；
 *    只有「去 GitHub 看原文」「在 GitHub 里新建」才需要走出去。
 *    所以线路全部失效时的兜底是**复制链接**，而不是一条死路。
 *
 * 3) **按用途分流。** 页面级镜像只代理「看」，代理不了「新建 / 登录」——
 *    在镜像域名上建 Discussion 会落在镜像站的身份体系里，必然出错。
 *    因此 `kind: "compose"` 的链接只走直连 + 复制，不往镜像上导。
 *
 * 用法：
 *   githubMirror.open(url)                     // 自动选线路打开，新标签
 *   githubMirror.resolve(url)                  // 只算线路，不打开
 *   githubMirror.routes()                      // 可选线路表
 *   githubMirror.getPreference() / setPreference(id)
 *   githubMirror.downloadUrl(rawOrReleaseUrl)  // 下载类走前缀代理
 */
(function () {
	"use strict";

	var STORAGE_KEY = "ckGithubRoute.v1";
	var PROBE_TTL = 10 * 60 * 1000;   // 探测结果 10 分钟内复用
	var PROBE_TIMEOUT = 3500;

	var AUTO = "auto";
	var DIRECT = "direct";

	/**
	 * 页面级镜像：直接替换 github.com 的域名，能浏览仓库 / Issues / Discussions。
	 * 顺序即「探测全部失败时的兜底优先级」，靠前的更常用。
	 */
	var DEFAULT_PAGE_ROUTES = [
		{ id: "kkgithub", label: "KKGitHub", host: "kkgithub.com" },
		{ id: "bgithub", label: "BGitHub", host: "bgithub.xyz" },
		{ id: "nuaa", label: "NUAA Hub", host: "hub.nuaa.cf" },
		{ id: "fastgit", label: "FastGit", host: "hub.fastgit.xyz" },
		{ id: "githubfast", label: "GitHubFast", host: "githubfast.com" },
		{ id: "kgithub", label: "KGitHub", host: "kgithub.com" },
		{ id: "ur1", label: "GitHub UR1", host: "github.ur1.fun" },
		{ id: "gitclone", label: "GitClone", host: "gitclone.com", pathPrefix: "/github.com" }
	];

	/**
	 * 前缀代理：`https://<代理>/<完整 GitHub 链接>`。
	 * **只能代理文件下载**（raw / archive / release），不代理 HTML 页面，
	 * 所以它在页面线路里不出现，只给 downloadUrl 用。
	 */
	var DOWNLOAD_PROXIES = [
		"https://gh-proxy.com/",
		"https://gh-proxy.org/",
		"https://ghproxy.net/",
		"https://ghfast.top/",
		"https://gh.llkk.cc/"
	];

	/* ---------------- 线路表 ---------------- */

	function normalizeMirrorEntry(entry, index) {
		if (!entry) return null;
		if (typeof entry === "string") {
			var host = entry.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
			if (!host) return null;
			return { id: "m" + index, label: host, host: host };
		}
		var h = String(entry.host || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
		if (!h) return null;
		return {
			id: String(entry.id || ("m" + index)),
			label: String(entry.label || h),
			host: h,
			pathPrefix: entry.pathPrefix ? String(entry.pathPrefix) : ""
		};
	}

	/** 页面线路表：页面若通过 window.CK_GITHUB_MIRRORS 给了自己的表，就整表替换 */
	function pageRoutes() {
		var custom = window.CK_GITHUB_MIRRORS;
		var list = [];
		if (Object.prototype.toString.call(custom) === "[object Array]" && custom.length) {
			for (var i = 0; i < custom.length; i++) {
				var n = normalizeMirrorEntry(custom[i], i);
				if (n) list.push(n);
			}
		}
		if (!list.length) {
			for (var j = 0; j < DEFAULT_PAGE_ROUTES.length; j++) list.push(DEFAULT_PAGE_ROUTES[j]);
		}
		return list;
	}

	/** 给界面用：自动 / 直连 / 各个镜像 */
	function routes() {
		var out = [
			{ id: AUTO, label: "自动（推荐）", kind: AUTO },
			{ id: DIRECT, label: "直连 github.com", kind: DIRECT }
		];
		var pages = pageRoutes();
		for (var i = 0; i < pages.length; i++) {
			out.push({ id: pages[i].id, label: pages[i].label, kind: "page", host: pages[i].host });
		}
		return out;
	}

	function findRoute(id) {
		if (!id || id === AUTO) return null;
		if (id === DIRECT) return { id: DIRECT, label: "直连 github.com", kind: DIRECT };
		var pages = pageRoutes();
		for (var i = 0; i < pages.length; i++) if (pages[i].id === id) return pages[i];
		return null;
	}

	/* ---------------- 偏好（记住用户选的线路） ---------------- */

	function getPreference() {
		try {
			var v = localStorage.getItem(STORAGE_KEY);
			if (!v) return AUTO;
			if (v === AUTO || v === DIRECT) return v;
			return findRoute(v) ? v : AUTO;   // 镜像被表换掉了就退回自动
		} catch (e) { return AUTO; }
	}

	function setPreference(id) {
		var v = id || AUTO;
		if (v !== AUTO && v !== DIRECT && !findRoute(v)) v = AUTO;
		try { localStorage.setItem(STORAGE_KEY, v); } catch (e) {}
		probeCache = null;   // 换了偏好，之前的探测结论不再作数
		return v;
	}

	/* ---------------- URL 判定与改写 ---------------- */

	var GITHUB_HOSTS = { "github.com": 1, "www.github.com": 1 };

	/** 解析出我们要处理的 GitHub 链接；不认识的返回 null */
	function parse(url) {
		var u;
		try { u = new URL(String(url || ""), window.location.href); } catch (e) { return null; }
		if (u.protocol !== "https:" && u.protocol !== "http:") return null;
		if (!GITHUB_HOSTS[u.hostname.toLowerCase()]) return null;
		// 「新建」类：讨论 / issue 的新建页
		var compose = /\/discussions\/new$/.test(u.pathname) || /\/issues\/new$/.test(u.pathname);
		return { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash, kind: compose ? "compose" : "view" };
	}

	function buildUrl(route, parsed) {
		if (!route || route.kind === DIRECT) return parsed.href;
		return "https://" + route.host + (route.pathPrefix || "") + parsed.pathname + parsed.search + parsed.hash;
	}

	/* ---------------- 探测 ---------------- */

	var probeCache = null;   // { at, best, list }

	function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

	/**
	 * 探一条线路 —— **只测「够不够得着」，不测「打开好不好用」**。
	 *
	 * 这里必须把话说清楚，否则界面会骗人：
	 * 跨域下 JS **拿不到**镜像站页面的状态码（`fetch(mode:"no-cors")` 只回一个 opaque 响应，
	 * 403 / 402 / 404 全都看起来一样）。实测过的假活：githubfast 回 403「只允许 git/CLI」、
	 * github.ur1.fun 回 402「Deployment Paused」，在这里都会被算成「通」。
	 * 也试过拿 `/favicon.ico` 用 `<img>` 判真活 —— 镜像站大多没有这个文件，误报更多，放弃。
	 *
	 * 所以结论只作为**排序依据**：快且够得着的排前面。
	 * 真正的兜底不靠探测，靠「一键换线路」和「复制链接」。
	 */
	function probeRoute(route, timeoutMs) {
		var base = route.kind === DIRECT
			? "https://github.com/"
			: "https://" + route.host + (route.pathPrefix || "") + "/";
		var t0 = now();
		return new Promise(function (resolve) {
			var ctrl = typeof AbortController === "function" ? new AbortController() : null;
			var done = false;
			var timer = setTimeout(function () {
				if (done) return;
				done = true;
				if (ctrl) { try { ctrl.abort(); } catch (e) {} }
				resolve({ route: route, ok: false, ms: Math.round(now() - t0) });
			}, timeoutMs);

			var options = { method: "GET", mode: "no-cors", cache: "no-store", redirect: "follow" };
			if (ctrl) options.signal = ctrl.signal;

			fetch(base + "?_r=" + Date.now(), options).then(function () {
				if (done) return;
				done = true;
				clearTimeout(timer);
				var ms = Math.round(now() - t0);
				if (ctrl) { try { ctrl.abort(); } catch (e) {} }   // 响应体不要了
				resolve({ route: route, ok: true, ms: ms });
			}, function () {
				if (done) return;
				done = true;
				clearTimeout(timer);
				resolve({ route: route, ok: false, ms: Math.round(now() - t0) });
			});
		});
	}

	/**
	 * 全部探一遍，按到达时间排序。
	 * 直连给小权重：同等速度下优先直连（它是唯一能登录、能新建的线路），
	 * 但明显更慢时就让镜像先上。
	 */
	function probeAll(options) {
		var opts = options || {};
		var timeout = opts.timeout || PROBE_TIMEOUT;
		var cands = [{ id: DIRECT, label: "直连 github.com", kind: DIRECT }].concat(pageRoutes());
		return Promise.all(cands.map(function (r) { return probeRoute(r, timeout); })).then(function (list) {
			function score(x) {
				return x.ms + (x.route.kind === DIRECT ? 150 : 0);
			}
			var good = list.filter(function (x) { return x.ok; }).sort(function (a, b) { return score(a) - score(b); });
			var bad = list.filter(function (x) { return !x.ok; });
			var result = {
				at: Date.now(),
				list: good.concat(bad),
				best: good.length ? good[0] : null
			};
			probeCache = result;
			return result;
		});
	}

	function cachedProbe() {
		if (!probeCache) return null;
		if (Date.now() - probeCache.at > PROBE_TTL) return null;
		return probeCache;
	}

	/* ---------------- 选路 ---------------- */

	/**
	 * 「这条线路刚才打不开」—— 用户自己说的，比任何探测都可信。
	 *
	 * 公共镜像的通病是**连接很快、页面是错的**（403/402/暂停页），
	 * 而 JS 跨域看不到状态码，所以机器判断不了，只能让用户一句话反馈。
	 * 记进同一份缓存里，让它下次排到最后，并在 TTL 内不再被自动选上。
	 */
	function markRouteBad(id) {
		if (!probeCache || !probeCache.list) return;
		for (var i = 0; i < probeCache.list.length; i++) {
			var item = probeCache.list[i];
			var rid = item.route.kind === DIRECT ? DIRECT : item.route.id;
			if (rid === id) item.ok = false;
		}
		var rest = probeCache.list.filter(function (x) { return x.ok; });
		probeCache.best = rest.length ? rest[0] : null;
	}

	/** 当前自动模式下会选的线路 id（给「换一条」用） */
	function currentAutoId() {
		var cp = cachedProbe();
		if (!cp || !cp.best) return null;
		return cp.best.route.kind === DIRECT ? DIRECT : cp.best.route.id;
	}

	/**
	 * 自动模式下换下一条候选线路：把当前这条标成坏，返回新的 best。
	 * @returns {Promise<{route:object|null, url:string|null}>}
	 */
	function nextRoute(url) {
		var parsed = parse(url);
		var cur = currentAutoId();
		if (cur) markRouteBad(cur);
		var cp = cachedProbe();
		if (cp && cp.best) {
			return Promise.resolve({
				route: cp.best.route,
				url: parsed ? buildUrl(cp.best.route, parsed) : null
			});
		}
		// 缓存里没别的了：重新探一轮（把刚才那条也重探，说不定是偶发）
		return probeAll({ timeout: PROBE_TIMEOUT }).then(function (res) {
			if (res.best) {
				return { route: res.best.route, url: parsed ? buildUrl(res.best.route, parsed) : null };
			}
			return { route: null, url: parsed ? parsed.href : null };
		});
	}

	/**
	 * 给定链接算出最终要打开的地址。
	 * @returns {Promise<{url:string, route:object, ms:number|null, kind:string, candidates:number}>}
	 */
	function resolve(url, options) {
		var parsed = parse(url);
		if (!parsed) {
			// 不是 GitHub 链接：原样放行
			return Promise.resolve({ url: String(url || ""), route: null, ms: null, kind: "external", candidates: 0 });
		}

		var pref = getPreference();

		// 「新建」只能在真 GitHub 上做（镜像上登录不了），所以只认直连
		if (parsed.kind === "compose") {
			return Promise.resolve({
				url: parsed.href,
				route: { id: DIRECT, label: "直连 github.com", kind: DIRECT },
				ms: null, kind: "compose", candidates: 1, forced: true
			});
		}

		// 用户手选了一条：直接用，不探测
		if (pref !== AUTO) {
			var fixed = findRoute(pref);
			if (fixed) {
				return Promise.resolve({
					url: buildUrl(fixed, parsed), route: fixed, ms: null,
					kind: "view", candidates: 1, forced: true
				});
			}
		}

		// 自动：优先用探测缓存
		var cached = cachedProbe();
		if (cached && cached.best) {
			return Promise.resolve({
				url: buildUrl(cached.best.route, parsed), route: cached.best.route,
				ms: cached.best.ms, kind: "view", candidates: cached.list.length, cached: true
			});
		}

		var timeout = (options && options.timeout) || PROBE_TIMEOUT;
		return probeAll({ timeout: timeout }).then(function (res) {
			if (res.best) {
				return {
					url: buildUrl(res.best.route, parsed), route: res.best.route, ms: res.best.ms,
					kind: "view", candidates: res.list.length
				};
			}
			// 全都没响应：直连照样给出去（也许只是探测被拦），同时让调用方提示复制
			return {
				url: parsed.href, route: { id: DIRECT, label: "直连 github.com", kind: DIRECT },
				ms: null, kind: "view", candidates: res.list.length, degraded: true
			};
		});
	}

	/* ---------------- 打开 ---------------- */

	function placeholderHtml(title, note) {
		var t = String(title || "正在连接 GitHub…").replace(/[<>&]/g, "");
		var n = String(note || "").replace(/[<>&]/g, "");
		return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
			+ '<meta name="viewport" content="width=device-width,initial-scale=1">'
			+ "<title>" + t + "</title><style>"
			+ "html,body{height:100%;margin:0;background:#0d1117;color:#c9d1d9;"
			+ "font:15px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif}"
			+ ".w{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center}"
			+ ".d{width:22px;height:22px;border-radius:50%;border:2px solid #30363d;border-top-color:#58a6ff;animation:s .8s linear infinite}"
			+ "@keyframes s{to{transform:rotate(360deg)}}.n{color:#8b949e;font-size:13px;max-width:26em}"
			+ "@media(prefers-color-scheme:light){html,body{background:#fff;color:#1f2328}.n{color:#656d76}.d{border-color:#d0d7de;border-top-color:#0969da}}"
			+ "</style></head><body><div class=\"w\"><div class=\"d\"></div><div>" + t + "</div>"
			+ (n ? '<div class="n">' + n + "</div>" : "") + "</div></body></html>";
	}

	function fillWindow(win, title, note) {
		try {
			win.document.open();
			win.document.write(placeholderHtml(title, note));
			win.document.close();
		} catch (e) {}
	}

	/**
	 * 打开一个 GitHub 链接。
	 *
	 * @param {string} url
	 * @param {object} [opts]
	 *   opts.onStatus({phase, route, ms, url, degraded})  过程回话，便于界面显示
	 *   opts.newTab    默认 true
	 * @returns {Promise<{opened:boolean, blocked:boolean, url:string, route:object|null, degraded?:boolean}>}
	 */
	function open(url, opts) {
		var options = opts || {};
		var report = typeof options.onStatus === "function" ? options.onStatus : function () {};
		var parsed = parse(url);

		// 不是 GitHub 链接，或用户已经手选了线路 / 有新鲜缓存：
		// 同步打开，不闪占位页
		var pref = getPreference();
		var instant = !parsed
			|| pref !== AUTO
			|| parsed.kind === "compose"
			|| !!cachedProbe();

		if (instant) {
			var route = null;
			if (parsed) {
				if (parsed.kind === "compose") {
					route = { id: DIRECT, label: "直连 github.com", kind: DIRECT };
				} else if (pref !== AUTO) {
					route = findRoute(pref);
				} else {
					var cp = cachedProbe();
					if (cp && cp.best) route = cp.best.route;
				}
			}
			var target = parsed ? buildUrl(route, parsed) : String(url || "");
			var win = openWindow(target, options.newTab !== false);
			report({ phase: win ? "opened" : "blocked", route: route, url: target, ms: null });
			return Promise.resolve({
				opened: !!win, blocked: !win, url: target, route: route,
				kind: parsed ? parsed.kind : "external"
			});
		}

		// 自动 + 没缓存：先开空白页保住用户手势，再探测、再跳
		var holder = openWindow("", options.newTab !== false);
		if (!holder) {
			report({ phase: "blocked", route: null, url: parsed.href });
			return resolve(url).then(function (r) {
				report({ phase: "blocked", route: r.route, url: r.url, degraded: r.degraded });
				return { opened: false, blocked: true, url: r.url, route: r.route, degraded: r.degraded };
			});
		}
		fillWindow(holder, "正在选择 GitHub 线路…", "首次打开会挑一条能通的线路，之后就直连。");

		return resolve(url).then(function (r) {
			try {
				holder.location.replace(r.url);
			} catch (e) {
				try { holder.location.href = r.url; } catch (e2) {}
			}
			report({ phase: "opened", route: r.route, ms: r.ms, url: r.url, degraded: r.degraded });
			return { opened: true, blocked: false, url: r.url, route: r.route, degraded: r.degraded };
		});
	}

	/**
	 * 同步开一个标签页并把句柄拿回来。
	 *
	 * 这里**不能用** features 里的 `noopener`：带 noopener 时 window.open 返回 null，
	 * 就拿不到句柄写占位页、也没法探测完再跳。改为开完立刻断掉 opener，
	 * 既保住用户手势（必须同步调用，异步会被拦），又不给目标页反向控制本站的机会。
	 */
	function openWindow(target, newTab) {
		try {
			if (newTab === false) { window.location.href = target; return window; }
			var w = window.open(target || "about:blank", "_blank");
			if (!w) return null;
			try { w.opener = null; } catch (e) {}
			return w;
		} catch (e) { return null; }
	}

	/**
	 * 后台预热：空闲时把线路探一遍，让用户第一次点击就能立刻打开。
	 * 失败无所谓，真正的兜底在点击那一刻。
	 */
	function prewarm(options) {
		if (cachedProbe()) return Promise.resolve(probeCache);
		return probeAll({ timeout: (options && options.timeout) || PROBE_TIMEOUT });
	}

	/**
	 * 稳一点的新标签打开：优先用临时 <a target="_blank">，
	 * 这样 `noopener` 生效、也不会被 window.open 的返回值语义坑到。
	 * @returns {boolean} 是否发起了打开（无法判断最终是否成功）
	 */
	function openAnchor(url) {
		try {
			var a = document.createElement("a");
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			a.style.display = "none";
			document.body.appendChild(a);
			a.click();
			setTimeout(function () {
				if (a.parentNode) a.parentNode.removeChild(a);
			}, 0);
			return true;
		} catch (e) { return false; }
	}

	/* ---------------- 复制 ---------------- */

	function legacyCopy(text) {
		try {
			var ta = document.createElement("textarea");
			ta.value = text;
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.top = "-9999px";
			document.body.appendChild(ta);
			ta.select();
			var ok = document.execCommand("copy");
			document.body.removeChild(ta);
			return !!ok;
		} catch (e) { return false; }
	}

	function copyText(text) {
		var s = String(text || "");
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return legacyCopy(s); });
		}
		return Promise.resolve(legacyCopy(s));
	}

	/* ---------------- 下载类加速 ---------------- */

	/**
	 * raw / archive / release 这类**文件下载**的加速地址。
	 *
	 * 只对文件生效。GitHub 的 HTML 页面**不能**这样拼：前缀代理不做页面代理，
	 * 实测 `gh-proxy.com/https://github.com/<owner>/<repo>/discussions` 回 404，
	 * 打开后落到代理站自己的首页，等于把用户扔到错误的地方。
	 * 页面要加速请走 resolve()（整域名替换的镜像站）。
	 */
	function downloadUrl(url, index) {
		var u;
		try { u = new URL(String(url || ""), window.location.href); } catch (e) { return String(url || ""); }
		var host = u.hostname.toLowerCase();
		var isFile = /(^|\.)githubusercontent\.com$/.test(host)
			|| /(^|\.)githubassets\.com$/.test(host)
			// 仓库 / Releases 里的文件路径，排除讨论、issue、pr 这些页面
			|| (/^github\.com$/.test(host) && /\/(releases\/download|archive|raw)\//.test(u.pathname));
		if (!isFile) return u.href;
		var i = typeof index === "number" ? index : 0;
		if (i < 0 || i >= DOWNLOAD_PROXIES.length) return u.href;
		return DOWNLOAD_PROXIES[i] + u.href;
	}

	window.githubMirror = {
		AUTO: AUTO,
		DIRECT: DIRECT,
		routes: routes,
		pageRoutes: pageRoutes,
		downloadProxies: function () { return DOWNLOAD_PROXIES.slice(); },
		getPreference: getPreference,
		setPreference: setPreference,
		parse: parse,
		buildUrl: buildUrl,
		resolve: resolve,
		probeAll: probeAll,
		probeRoute: probeRoute,
		open: open,
		openAnchor: openAnchor,
		prewarm: prewarm,
		nextRoute: nextRoute,
		markRouteBad: markRouteBad,
		currentAutoId: currentAutoId,
		copyText: copyText,
		downloadUrl: downloadUrl
	};
})();
