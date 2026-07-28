import type { CustomHttpConfig, HttpParam, BrowserEmulationConfig } from "./types.ts";

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const BLOCKED_HEADER_NAMES = new Set([
	"host",
	"content-length",
	"transfer-encoding",
	"connection",
	"upgrade",
	"proxy-authorization",
	"proxy-connection",
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-real-ip",
	"cf-connecting-ip",
]);

export interface FetchOptions {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

function filterHeaders(headers: HttpParam[]): HttpParam[] {
	return headers.filter(h => {
		const lowerKey = h.key.toLowerCase();
		return !BLOCKED_HEADER_NAMES.has(lowerKey);
	});
}

function applyHeadersToMap(headers: Record<string, string>, params: HttpParam[], variables: Record<string, string>): void {
	for (const param of filterHeaders(params)) {
		if (param.key) {
			const value = applyVariableSubstitution(param.value || "", variables);
			headers[param.key] = value;
		}
	}
}

function findCookieValue(config: CustomHttpConfig): string | undefined {
	for (const h of config.headers) {
		if (h.key.toLowerCase() === "cookie" && h.value) {
			return h.value;
		}
	}
	return undefined;
}

function applyVariableSubstitution(text: string, variables: Record<string, string>): string {
	if (!text || Object.keys(variables).length === 0) return text;
	return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, varName) => {
		return variables[varName] !== undefined ? variables[varName] : match;
	});
}

function buildBrowserEmulationHeaders(
	config: BrowserEmulationConfig | undefined,
	targetUrl: string
): Record<string, string> {
	const headers: Record<string, string> = {};
	if (!config || !config.enabled) return headers;

	try {
		const url = new URL(targetUrl);
		const origin = config.origin || url.origin;
		const referer = config.referer || `${url.origin}/`;

		headers["User-Agent"] = config.userAgent || DEFAULT_USER_AGENT;
		headers["Referer"] = referer;
		headers["Origin"] = origin;
		headers["Accept-Language"] = config.acceptLanguage || "zh-CN,zh;q=0.9,en;q=0.8";

		if (config.accept) headers["Accept"] = config.accept;
		if (config.cacheControl) headers["Cache-Control"] = config.cacheControl;
		if (config.pragma) headers["Pragma"] = config.pragma;

		if (config.xRequestedWith !== false) {
			headers["X-Requested-With"] = "XMLHttpRequest";
		}

		// Sec-CH-UA headers (these are now allowed since Cloudflare checks them)
		if (config.secChUa) headers["sec-ch-ua"] = config.secChUa;
		if (config.secChUaMobile) headers["sec-ch-ua-mobile"] = config.secChUaMobile;
		if (config.secChUaPlatform) headers["sec-ch-ua-platform"] = config.secChUaPlatform;
		if (config.secFetchDest) headers["Sec-Fetch-Dest"] = config.secFetchDest;
		if (config.secFetchMode) headers["Sec-Fetch-Mode"] = config.secFetchMode;
		if (config.secFetchSite) headers["Sec-Fetch-Site"] = config.secFetchSite;
		if (config.secFetchUser) headers["Sec-Fetch-User"] = config.secFetchUser;
		if (config.upgradeInsecureRequests) headers["Upgrade-Insecure-Requests"] = config.upgradeInsecureRequests;
	} catch {
		// URL parse failed, skip browser headers
	}

	return headers;
}

export function buildRequestOptions(
	config: CustomHttpConfig,
	variables: Record<string, string> = {},
	includeBrowserHeaders: boolean = true
): FetchOptions {
	const url = new URL(config.url);

	for (const param of config.queryParams) {
		if (param.key) {
			const value = applyVariableSubstitution(param.value || "", variables);
			url.searchParams.append(param.key, value);
		}
	}

	const headers: Record<string, string> = {};

	if (includeBrowserHeaders) {
		const browserHeaders = buildBrowserEmulationHeaders(config.browserEmulation, config.url);
		Object.assign(headers, browserHeaders);
	} else {
		headers["User-Agent"] = "Pulse-Checkin/1.0 (+https://github.com/Ckarefulon/Ckarefulon.github.io)";
	}

	applyHeadersToMap(headers, config.headers, variables);

	let body: string | undefined;

	if (config.method === "POST" && config.bodyType !== "none") {
		const filteredBodyFields = config.bodyFields.filter(p => p.key);
		if (config.bodyType === "json") {
			const obj: Record<string, string> = {};
			for (const param of filteredBodyFields) {
				const value = applyVariableSubstitution(param.value || "", variables);
				obj[param.key] = value;
			}
			body = JSON.stringify(obj);
			if (!headers["Content-Type"]) {
				headers["Content-Type"] = "application/json";
			}
		} else if (config.bodyType === "form") {
			const form = new URLSearchParams();
			for (const param of filteredBodyFields) {
				const value = applyVariableSubstitution(param.value || "", variables);
				form.append(param.key, value);
			}
			body = form.toString();
			if (!headers["Content-Type"]) {
				headers["Content-Type"] = "application/x-www-form-urlencoded";
			}
		}
	}

	return {
		url: url.toString(),
		method: config.method,
		headers,
		body,
	};
}

export function buildPreRequestOptions(
	config: CustomHttpConfig,
	variables: Record<string, string> = {}
): FetchOptions | null {
	if (!config.preRequest || !config.preRequest.enabled) return null;

	const preUrl = config.preRequest.url || config.url;
	const url = new URL(preUrl);

	const headers: Record<string, string> = {};

	const browserHeaders = buildBrowserEmulationHeaders(config.browserEmulation, preUrl);
	Object.assign(headers, browserHeaders);

	if (config.preRequest.includeCookies !== false) {
		const cookieValue = findCookieValue(config);
		if (cookieValue) {
			headers["Cookie"] = applyVariableSubstitution(cookieValue, variables);
		}
	}

	if (config.preRequest.extraHeaders) {
		applyHeadersToMap(headers, config.preRequest.extraHeaders, variables);
	}

	if (!headers["Accept"]) {
		headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
	}

	return {
		url: url.toString(),
		method: config.preRequest.method || "GET",
		headers,
	};
}

export function extractVariables(
	html: string,
	rules: { variableName: string; pattern: string; flags?: string; groupIndex?: number }[]
): Record<string, string> {
	const variables: Record<string, string> = {};
	if (!rules || rules.length === 0) return variables;

	for (const rule of rules) {
		if (!rule.variableName || !rule.pattern) continue;
		try {
			const regex = new RegExp(rule.pattern, rule.flags || "i");
			const match = html.match(regex);
			if (match) {
				const groupIdx = rule.groupIndex ?? 1;
				variables[rule.variableName] = match[groupIdx] || match[0] || "";
			}
		} catch {
			// Invalid regex, skip
		}
	}

	return variables;
}

export function containsKeywords(text: string, keywords: string[]): boolean {
	if (!text || !keywords || keywords.length === 0) return false;
	const lower = text.toLowerCase();
	return keywords.some(kw => kw && lower.includes(kw.toLowerCase()));
}

export { DEFAULT_USER_AGENT };
