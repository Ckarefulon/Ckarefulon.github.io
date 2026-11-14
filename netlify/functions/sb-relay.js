/*
 * Supabase 同源中继（Netlify Function）
 *
 * 为什么需要它：
 *   浏览器不能直接访问 `https://<ref>.supabase.co` 的网络里，
 *   TCP 能通但 TLS 带正确域名就被重置（实测 224ms 连上、立刻 ECONNRESET），
 *   于是反馈页「一直转圈，最后报网络异常」。这不是 Supabase 慢，
 *   是请求根本没发出去。
 *
 * 做法：把请求改成同源 `/api/sb/*`，由这台服务器去连 Supabase。
 *   浏览器只跟自己的域名说话 —— 站点文件能打开，这条链路就能用。
 *
 * 安全（**必须**，否则等于开了个公共代理）：
 *   · 目标主机写死，不接受调用方指定 —— 只能去我们自己那个项目
 *   · 路径白名单，只放行 functions / rest / auth 三段
 *   · 不转发 Host / X-Forwarded-* 等会干扰上游的请求头
 *   · 只允许 GET / POST / OPTIONS，不做任意方法透传
 *
 * 环境变量（可选）：
 *   SUPABASE_PROJECT_URL   覆盖目标地址，默认用下面的 ref 拼出来
 */

const DEFAULT_PROJECT_URL = "https://sekbhrzxblaxvgspyjxa.supabase.co";

/** 只放行这三段；多了就等于开放代理，会被拿去干别的 */
const ALLOWED_PREFIXES = [
	"/functions/v1/",
	"/rest/v1/",
	"/auth/v1/"
];

const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];

/** 上游超时：Edge Function 冷启动偶尔要几秒，给足但别无限等 */
const UPSTREAM_TIMEOUT_MS = 20000;

function projectUrl() {
	const fromEnv = process.env.SUPABASE_PROJECT_URL;
	const raw = String(fromEnv || DEFAULT_PROJECT_URL).trim().replace(/\/+$/, "");
	return raw;
}

function json(statusCode, payload) {
	return {
		statusCode,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		},
		body: JSON.stringify(payload)
	};
}

/** 从 `/api/sb/functions/v1/feedback` 里切出 `/functions/v1/feedback` */
function targetPath(event) {
	const raw = event.path || "";
	const marker = "/api/sb";
	let rest = raw;
	const idx = raw.indexOf(marker);
	if (idx >= 0) rest = raw.slice(idx + marker.length);
	if (!rest) rest = "/";
	// 有些部署会把路径放在 query 里（rawUrl 形式），兜底再试一次
	if (rest === "/" && event.queryStringParameters && event.queryStringParameters.__p) {
		rest = "/" + String(event.queryStringParameters.__p).replace(/^\/+/, "");
	}
	if (!rest.startsWith("/")) rest = "/" + rest;
	// 带 `..` 的路径直接判死：折叠后可能正好落进白名单，
	// 虽然不算越权，但没有理由放行一个刻意的穿越写法。
	if (hasTraversal(rest)) return null;
	return normalizePath(rest);
}

/** 解码后仍含 `..` 段即视为穿越（`%2e%2e`、`..%2f` 都要抓到） */
function hasTraversal(p) {
	let s = String(p || "");
	try { s = decodeURIComponent(s); } catch (e) { /* 非法编码按原样 */ }
	return s.split("/").some((seg) => seg === ".." || seg === ".");
}

/**
 * 折叠 `.` / `..`，并解码一次百分号编码。
 * `%2e%2e` 也是路径穿越的常见写法，必须先解码再判断。
 */
function normalizePath(p) {
	let s = String(p || "/");
	try { s = decodeURIComponent(s); } catch (e) { /* 非法编码就按原样处理 */ }
	const segs = [];
	for (const seg of s.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") { segs.pop(); continue; }
		segs.push(seg);
	}
	return "/" + segs.join("/");
}

function isAllowed(path) {
	// 规范化后再判断：前缀必须完整落在白名单里
	for (const p of ALLOWED_PREFIXES) {
		if (path.indexOf(p) === 0) {
			// `/functions/v1/a/../../../rest` 已经在上一步被折叠，这里再做一次兜底
			if (normalizePath(path).indexOf(p) !== 0) return false;
			return true;
		}
	}
	return false;
}

/** 只带该带的头：调用方的 Host / 传输层头一律不转 */
function forwardHeaders(event) {
	const src = event.headers || {};
	const out = {};
	for (const key of Object.keys(src)) {
		const k = key.toLowerCase();
		if (k === "host" || k === "connection" || k === "content-length" ||
			k === "accept-encoding" || k.startsWith("x-forwarded-") ||
			k.startsWith("x-nf-") || k === "x-real-ip" || k === "x-bb-ab" ||
			k === "x-bb-ip" || k === "client-ip") {
			continue;
		}
		out[k] = src[key];
	}
	return out;
}

export async function handler(event) {
	const method = (event.httpMethod || "GET").toUpperCase();

	if (!ALLOWED_METHODS.includes(method)) {
		return json(405, { success: false, message: "不支持的方法" });
	}

	// 同源请求不该有预检；真有也直接放行
	if (method === "OPTIONS") {
		return {
			statusCode: 204,
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-headers": "authorization, apikey, content-type",
				"access-control-allow-methods": "GET, POST, OPTIONS",
				"access-control-max-age": "7200"
			},
			body: ""
		};
	}

	const path = targetPath(event);
	if (path === null || !isAllowed(path)) {
		// 这个 404 + relay:false 同时是给前端的信号：中继没配好/不认这条，请回退直连
		return json(404, {
			success: false,
			relay: false,
			message: path === null ? "中继拒绝可疑路径" : ("中继路径不在白名单内：" + path)
		});
	}

	const base = projectUrl();
	const query = event.rawQuery ? ("?" + event.rawQuery) : "";
	const url = base + path + query;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

	try {
		const init = {
			method,
			headers: forwardHeaders(event),
			signal: controller.signal,
			redirect: "follow"
		};
		if (method === "POST") {
			init.body = event.isBase64Encoded
				? Buffer.from(event.body || "", "base64")
				: (event.body || "");
		}

		const upstream = await fetch(url, init);
		const text = await upstream.text();
		clearTimeout(timer);

		const headers = { "cache-control": "no-store" };
		const ct = upstream.headers.get("content-type");
		if (ct) headers["content-type"] = ct;
		// 把 Supabase 的限流提示透出去，便于前端显示「太频繁」
		const retryAfter = upstream.headers.get("retry-after");
		if (retryAfter) headers["retry-after"] = retryAfter;

		return { statusCode: upstream.status, headers, body: text };
	} catch (err) {
		clearTimeout(timer);
		const aborted = err && err.name === "AbortError";
		return json(aborted ? 504 : 502, {
			success: false,
			relay: false,
			message: aborted
				? "中继连接 Supabase 超时"
				: ("中继连接 Supabase 失败：" + String((err && err.message) || err))
		});
	}
}
