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
	 * 2) **先测速，再选链路 —— 不假设中继一定更好。**
	 *    直连 Supabase 有时相当快（实测本机 792ms 起），而中继要多绕一跳服务器，
	 *    未必更快。所以两边各测一次健康端点，谁快用谁；
	 *    直连被域名拦截（长尾超时 / 直接失败）时，中继才成为唯一选择。
	 *    见 chooseTransport()。结论缓存在会话里，不每页重测。
	 *
	 * 3) **中继不可用时静默回退直连。**
	 *    本地开发、GitHub Pages、其它平台都没有 Functions；
	 *    这时行为和以前完全一样，不会因为少一个函数就整个站不可用。
	 *
	 * 4) **一个口子改全部。**
	 *    全站各页面都只加载这一个脚本创建 client，
	 *    `config.url` 本身也就地改写成同源地址 ——
	 *    这样即使是直接拼 `config.url + "/functions/v1/xxx"` 的老代码（如 auth-manager）
	 *    也自动走中继，不必逐页改。
	 */

	var RELAY_PREFIX = "/api/sb";
	var PROBE_KEY = "ckSupabaseRelay.v2";
	var PROBE_TTL = 10 * 60 * 1000;   // 测速结论 10 分钟内复用

	var config = window.CK_SUPABASE_CONFIG;

	if (!config || !config.url || !config.publishableKey) {
		console.warn("[Supabase] 配置未完成，请填入 Publishable key。Auth 功能不可用，游客模式继续正常使用。");
		window.supabaseClient = null;
		return;
	}

	var directUrl = String(config.url).replace(/\/+$/, "");

	/* ---------------- 测速选路 ---------------- */

	/**
	 * 候选探测端点：`/auth/v1/health` 是 Supabase 最轻的公开端点之一
	 * （只回一个极小的 JSON），带 apikey 能返 200，适合用来比速度。
	 */
	var HEALTH_PATH = "/auth/v1/health";

	/**
	 * **先测速，再选链路。**
	 *
	 * 直连 Supabase 有时候相当快（实测本机 792ms 起），没理由一律走中继 ——
	 * 中继多一跳服务器，未必更快。所以两边各探一次健康端点，谁快用谁；
	 * 中继干脆不可达时直连直接胜出，连比较都省了。
	 *
	 * 判据只看「到达时间」，不看状态码对不对：
	 * 401 也说明链路活着、够快，比等一个 200 更有代表性（也要一次往返）。
	 *
	 * @param {number} [budgetMs] 单次探测超时，默认 3.5s
	 * @returns {Promise<{transport: 'relay'|'direct', directMs: number|null, relayMs: number|null, reason: string}>}
	 */
	function chooseTransport(budgetMs) {
		var budget = budgetMs || 3500;
		if (typeof fetch !== "function") {
			return Promise.resolve({ transport: "direct", directMs: null, relayMs: null, reason: "no-fetch" });
		}

		var headers = {};
		if (config.publishableKey) headers.apikey = config.publishableKey;

		function timeOne(url, withHeaders) {
			var ctrl = typeof AbortController === "function" ? new AbortController() : null;
			var opts = { method: "GET", cache: "no-store", headers: withHeaders ? headers : {} };
			if (ctrl) opts.signal = ctrl.signal;
			var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
			var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, budget);

			return fetch(url, opts).then(function (res) {
				clearTimeout(timer);
				var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
				// 中继如果根本没部署，静态服务器会用自己的 404 页来「快速应答」，
				// 那 5ms 的假快不能算 —— 必须确认回的是 JSON（Supabase/中继的形态）。
				var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
				if (!/application\/json/i.test(ct)) {
					return { ms: null, ok: false };
				}
				return { ms: Math.round(ms), ok: true };
			}, function () {
				clearTimeout(timer);
				var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
				return { ms: Math.round(ms), ok: false };
			});
		}

		return Promise.all([
			timeOne(directUrl + HEALTH_PATH, true),
			timeOne(RELAY_PREFIX + HEALTH_PATH, true),
		]).then(function (r) {
			var direct = r[0], relay = r[1];

			var result;
			if (!relay.ok) {
				result = { transport: "direct", reason: "relay-unavailable" };
			} else if (!direct.ok) {
				// 直连不通（就是被域名拦截的那种情况）—— 中继是唯一选择
				result = { transport: "relay", reason: "direct-unavailable" };
			} else if (direct.ms <= relay.ms) {
				// 直连不慢于中继就用直连：少一跳，也少依赖一个函数
				result = { transport: "direct", reason: "direct-faster" };
			} else {
				result = { transport: "relay", reason: "relay-faster" };
			}

			return {
				transport: result.transport,
				directMs: direct.ok ? direct.ms : null,
				relayMs: relay.ok ? relay.ms : null,
				reason: result.reason,
			};
		});
	}

	/** 读缓存里的测速结论（没测过或过期则 null） */
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

	function writeProbe(decision) {
		try {
			sessionStorage.setItem(PROBE_KEY, JSON.stringify({
				transport: decision.transport,
				directMs: decision.directMs,
				relayMs: decision.relayMs,
				reason: decision.reason,
				at: Date.now(),
			}));
		} catch (e) {}
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

	/**
	 * 装上客户端。
	 * @param {'relay'|'direct'} transport
	 */
	function install(transport) {
		if (transport === "relay") {
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

	/**
	 * 按测速结论装好客户端。
	 * 同一次会话里测过就不再测，直接用上次的结论。
	 */
	function applyBestTransport(force) {
		var cached = force ? null : readProbe();
		if (cached && (cached.transport === "relay" || cached.transport === "direct")) {
			install(cached.transport);
			window.__ckSupabaseDecision = cached;
			return Promise.resolve(cached);
		}
		return chooseTransport().then(function (decision) {
			writeProbe(decision);
			install(decision.transport);
			window.__ckSupabaseDecision = decision;
			return decision;
		});
	}

	// 先按直连把客户端建好，保证任何页面在任何网络下立刻有东西可用；
	// 测完速再换成更快的那条（通常早于页面第一次真正用）。
	install("direct");
	applyBestTransport(false);

	/**
	 * 手动重连 / 重新测速。
	 * 换网络后（比如从校园网切到热点）可以让它重新比一次。
	 * @returns {Promise<boolean>} 现在是否走中继
	 */
	window.ckSupabaseReconnect = function () {
		try { sessionStorage.removeItem(PROBE_KEY); } catch (e) {}
		return applyBestTransport(true).then(function (d) {
			return d.transport === "relay";
		});
	};

	/**
	 * 当前的选路结论（调试 / 界面显示用）。
	 * 用 getter 而不是在加载时就赋值 —— 测速是异步的，加载那一刻还是空的。
	 */
	try {
		Object.defineProperty(window, "ckSupabaseDecision", {
			get: function () { return window.__ckSupabaseDecision || null; },
			configurable: true,
		});
	} catch (e) {
		window.ckSupabaseDecision = null;
	}
})();
