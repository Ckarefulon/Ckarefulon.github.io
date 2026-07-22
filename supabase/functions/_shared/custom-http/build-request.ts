import type { CustomHttpConfig, HttpParam } from "./types.ts";

const DEFAULT_USER_AGENT = "Pulse-Checkin/1.0 (+https://github.com/Ckarefulon/Ckarefulon.github.io)";

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
		return !BLOCKED_HEADER_NAMES.has(lowerKey) && !lowerKey.startsWith("sec-");
	});
}

export function buildRequestOptions(config: CustomHttpConfig): FetchOptions {
	const url = new URL(config.url);

	for (const param of config.queryParams) {
		if (param.key) {
			url.searchParams.append(param.key, param.value || "");
		}
	}

	const headers: Record<string, string> = {
		"User-Agent": DEFAULT_USER_AGENT,
	};

	const filteredHeaders = filterHeaders(config.headers);
	for (const param of filteredHeaders) {
		if (param.key) {
			headers[param.key] = param.value || "";
		}
	}

	let body: string | undefined;

	if (config.method === "POST" && config.bodyType !== "none") {
		const filteredBodyFields = config.bodyFields.filter(p => p.key);
		if (config.bodyType === "json") {
			const obj: Record<string, string> = {};
			for (const param of filteredBodyFields) {
				obj[param.key] = param.value || "";
			}
			body = JSON.stringify(obj);
			headers["Content-Type"] = "application/json";
		} else if (config.bodyType === "form") {
			const form = new URLSearchParams();
			for (const param of filteredBodyFields) {
				form.append(param.key, param.value || "");
			}
			body = form.toString();
			headers["Content-Type"] = "application/x-www-form-urlencoded";
		}
	}

	return {
		url: url.toString(),
		method: config.method,
		headers,
		body,
	};
}
