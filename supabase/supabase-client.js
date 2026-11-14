(function() {
	"use strict";

	/**
	 * Supabase 统一入口（全站唯一创建客户端的地方）
	 *
	 * 三条原则：
	 *
	 * 1) **所有 Supabase 请求走同源中继 `/api/sb/`。**
	 *    部分网络按域名拦 `*.supabase.co`（TCP 通、TLS 带正确 SNI 立刻 RST），
	 *    浏览器直连只会转圈到超时。让请求变成同源、由服务器去连就绕开了。
	 *    中继代码见 netlify/functions/sb-relay.js。
	 *
	 * 2) **中继不在就静默回退直连。**
	 *    本地开发、GitHub Pages、其它平台都没有 Functions；
	 *    这时行为和以前完全一样，不会因为少一个函数就整个站不可用。
	 *    判定方式见 probeRelay()：只探一次，结果缓存在会话里。
	 *
	 * 3) **一个口子改全部。**
	 *    全站各页面都只加载这一个脚本创建 client，
	 *    `config.url` 本身也就地改写成同源地址 ——
	 *    这样即使是直接拼 `config.url + "/functions/v1/xxx"` 的老代码（如 auth-manager）
	 *    也自动走中继，不必逐页改。
	 */

	var RELAY_PREFIX = "/api/sb";
	var PROBE_KEY = "ckSupabaseRelay.v1";
	var PROBE_TTL = 10 * 60 * 1000;   // 探到「没有中继」后 10 分钟内不再重复探

	var config = window.CK_SUPABASE_CONFIG;

	if (!config || !config.url || !config.publishableKey) {
		console.warn("[Supabase] 配置未完成，请填入 Publishable key。Auth 功能不可用，游客模式继续正常使用。");
		window.supabaseClient = null;
		return;
	}

	var directUrl = String(config.url).replace(/\/+$/, "");

	/* ---------------- 中继探测 ---------------- */

	function readProbe() {
		try {
			var raw = sessionStorage.getItem(PROBE_KEY);
			if (!raw) return null;
			var v = JSON.parse(raw);
			if (!v || typeof v.at !== "number") return null;
			if (Date.now() - v.at > PROBE_TTL) return null;
			return v;
		} catch (e) { return null; }
	}

	function writeProbe(ok) {
		try {
			sessionStorage.setItem(PROBE_KEY, JSON.stringify({ ok: !!ok, at: Date.now() }));
		} catch (e) {}
	}

	/**
	 * 探一下有没有中继。
	 *
	 * 探 `/api/sb/__ping`：中继对白名单外的路径会回 JSON `{relay:false}`，
	 * 拿得到这个 JSON 就说明函数在跑；静态服务器则会回自己的 404 页面（非 JSON）。
	 * 用 HEAD/GET 都行，这里用 GET 但只看头几个字节就 abort。
	 */
	function probeRelay() {
		var cached = readProbe();
		if (cached) return Promise.resolve(cached.ok);
		if (typeof fetch !== "function") return Promise.resolve(false);

		var ctrl = typeof AbortController === "function" ? new AbortController() : null;
		var opts = { method: "GET", cache: "no-store" };
		if (ctrl) opts.signal = ctrl.signal;

		var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, 2500);

		return fetch(RELAY_PREFIX + "/__ping", opts).then(function (res) {
			clearTimeout(timer);
			if (ctrl) { try { ctrl.abort(); } catch (e) {} }
			var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
			// 中继回的一定是 JSON；静态 404 页是 HTML
			var ok = /application\/json/i.test(ct);
			writeProbe(ok);
			return ok;
		}, function () {
			clearTimeout(timer);
			writeProbe(false);
			return false;
		});
	}

	/* ---------------- 自定义 fetch ---------------- */

	function isAbsSupabase(url) {
		return typeof url === "string" && url.indexOf(directUrl) === 0;
	}

	/**
	 * 把发往 supabase.co 的请求改写成同源中继。
	 * 已经是相对路径、或指向别的主机（比如第三方 API）的，一律原样放行。
	 */
	function rewrite(url) {
		if (!isAbsSupabase(url)) return url;
		return RELAY_PREFIX + url.slice(directUrl.length);
	}

	/**
	 * 给 supabase-js 用的 fetch。
	 *
	 * 注意不能无脑改所有请求：函数还可能被用来拉 vendored 资源；
	 * 只改目标是我们这个 Supabase 项目的绝对地址。
	 */
	function relayFetch(input, init) {
		if (typeof input === "string") input = rewrite(input);
		else if (input && typeof input === "object" && typeof input.url === "string") {
			var next = rewrite(input.url);
			if (next !== input.url) input = new Request(next, input);
		}
		return fetch(input, init);
	}

	/* ---------------- 建立客户端 ---------------- */

	function buildClient(url, useRelay) {
		var options = useRelay ? { global: { fetch: relayFetch } } : undefined;
		try {
			return useRelay
				? window.supabase.createClient(url, config.publishableKey, options)
				: window.supabase.createClient(url, config.publishableKey);
		} catch (error) {
			console.error("[Supabase] 客户端初始化失败:", error);
			return null;
		}
	}

	function install(useRelay) {
		if (useRelay) {
			// 让直接拼 config.url 的老代码也走中继
			config.url = RELAY_PREFIX;
			window.supabaseClient = buildClient(RELAY_PREFIX, true);
			if (window.supabaseClient) {
				window.__ckSupabaseTransport = "relay";
				return;
			}
			// 建不起来就退回直连，别把功能一起废了
			config.url = directUrl;
		}
		window.supabaseClient = buildClient(directUrl, false);
		window.__ckSupabaseTransport = "direct";
	}

	// 先按直连把客户端建好，保证任何页面在任何网络下都有东西可用；
	// 探测到中继后再换成走同源的版本（握手很快，通常早于页面第一次真正用）。
	install(false);
	probeRelay().then(function (ok) {
		if (ok) install(true);
	});

	/** 手动重试（页面提供了「重试」时可以调用） */
	window.ckSupabaseReconnect = function () {
		try { sessionStorage.removeItem(PROBE_KEY); } catch (e) {}
		return probeRelay().then(function (ok) {
			install(ok);
			return ok;
		});
	};
})();
