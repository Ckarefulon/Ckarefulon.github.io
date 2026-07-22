import type { CheckinAdapter, CheckinContext, CheckinResult, ValidationResult } from "./types.ts";
import type { CustomHttpConfig } from "../custom-http/types.ts";
import type { CustomHttpCredentials } from "../custom-http/merge-config.ts";
import { validateUrl, validateRedirectUrl } from "../custom-http/validate-url.ts";
import { validateCustomHttpConfig } from "../custom-http/validate-rules.ts";
import { mergeCustomHttpConfig } from "../custom-http/merge-config.ts";
import { buildRequestOptions } from "../custom-http/build-request.ts";
import { evaluateRules, looksLikeHtmlLoginPage } from "../custom-http/evaluate-response.ts";
import { sanitizeBodyPreview, sanitizeErrorMessage } from "../custom-http/sanitize-response.ts";

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

async function fetchWithSSRFProtection(
	config: CustomHttpConfig,
	allowRedirect = false
): Promise<{ response: Response; finalUrl: string; bodyText: string }> {
	const validation = await validateUrl(config.url);
	if (!validation.valid || !validation.url) {
		throw new Error(validation.error || "URL 验证失败");
	}

	const options = buildRequestOptions(config);
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(options.url, {
			method: options.method,
			headers: options.headers,
			body: options.body,
			signal: controller.signal,
			redirect: allowRedirect ? "manual" : "manual",
		});

		let finalUrl = options.url;

		if (allowRedirect && (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308)) {
			const location = response.headers.get("location");
			if (location) {
				const redirectValidation = await validateRedirectUrl(validation.url, location);
				if (!redirectValidation.valid || !redirectValidation.url) {
					throw new Error(redirectValidation.error || "重定向地址验证失败");
				}
				// 重新解析并验证重定向后的域名（DNS rebinding 防护）
				const revalidation = await validateUrl(redirectValidation.url.toString());
				if (!revalidation.valid) {
					throw new Error(revalidation.error || "重定向地址重新验证失败");
				}
				// 不允许把敏感 Header 发送到不同域名（已在 validateRedirectUrl 中检查 hostname）
				const redirectOptions = buildRequestOptions({ ...config, url: redirectValidation.url.toString() });
				const redirectResponse = await fetch(redirectOptions.url, {
					method: redirectOptions.method,
					headers: redirectOptions.headers,
					body: redirectOptions.body,
					signal: controller.signal,
					redirect: "manual",
				});
				finalUrl = redirectValidation.url.toString();
				const redirectBody = await readLimitedBody(redirectResponse);
				return { response: redirectResponse, finalUrl, bodyText: redirectBody };
			}
		}

		const bodyText = await readLimitedBody(response);
		return { response, finalUrl, bodyText };
	} finally {
		clearTimeout(timeoutId);
	}
}

async function readLimitedBody(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return "";

	const chunks: Uint8Array[] = [];
	let totalLength = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				const chunk = value.length > MAX_RESPONSE_BYTES - totalLength
					? value.slice(0, MAX_RESPONSE_BYTES - totalLength)
					: value;
				chunks.push(chunk);
				totalLength += chunk.length;
				if (totalLength >= MAX_RESPONSE_BYTES) break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	const allBytes = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		allBytes.set(chunk, offset);
		offset += chunk.length;
	}

	return new TextDecoder("utf-8", { fatal: false }).decode(allBytes);
}

function parseJsonSafely(text: string): { parsed: unknown; isJson: boolean } {
	const trimmed = text.trim();
	if (!trimmed) return { parsed: undefined, isJson: false };
	if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
		try {
			return { parsed: JSON.parse(text), isJson: true };
		} catch {
			return { parsed: undefined, isJson: false };
		}
	}
	return { parsed: undefined, isJson: false };
}

function isRetryableError(error: unknown, status?: number): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (message.includes("abort") || message.includes("timeout")) return true;
		if (message.includes("network") || message.includes("connection") || message.includes("dns")) return true;
	}
	if (status === 429) return true;
	if (status && status >= 500 && status <= 599 && status !== 501) return true;
	return false;
}

const adapter: CheckinAdapter = {
	serviceKey: "custom-http",
	serviceName: "自定义 HTTP 签到",
	description: "通过配置 HTTP 请求参数对支持明确签到接口的网站进行签到",
	credentialFields: [],
	publicConfigFields: [],

	async validateConfig(): Promise<ValidationResult> {
		return { valid: true };
	},

	async checkin(context: CheckinContext): Promise<CheckinResult> {
		const config = context.customHttpConfig as CustomHttpConfig | undefined;
		if (!config) {
			return {
				success: false,
				summary: "缺少自定义 HTTP 配置",
				errorCode: "MISSING_CUSTOM_HTTP_CONFIG",
				retryable: false,
			};
		}

		const mergedConfig = mergeCustomHttpConfig(config, (context.credentials || {}) as CustomHttpCredentials);

		const schemaValidation = validateCustomHttpConfig(mergedConfig);
		if (!schemaValidation.valid) {
			return {
				success: false,
				summary: "配置无效: " + schemaValidation.errors.join("; "),
				errorCode: "INVALID_CONFIG",
				retryable: false,
			};
		}

		let lastError: Error | null = null;
		let lastStatus = 0;
		let lastBodyText = "";
		let lastContentType = "";

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const { response, finalUrl, bodyText } = await fetchWithSSRFProtection(mergedConfig, true);
				lastStatus = response.status;
				lastBodyText = bodyText;
				lastContentType = response.headers.get("Content-Type") || "";

				const { parsed: parsedJson, isJson } = parseJsonSafely(bodyText);

				// 如果配置了 JSON 判断但响应不是 JSON，返回配置错误
				const hasJsonRule =
					mergedConfig.successRules.some(r => r.type === "json_equals") ||
					mergedConfig.alreadyCheckedInRules.some(r => r.type === "json_equals") ||
					mergedConfig.authFailureRules.some(r => r.type === "json_equals");

				if (hasJsonRule && !isJson && !lastContentType.toLowerCase().includes("application/json")) {
					return {
						success: false,
						summary: "配置错误：响应不是 JSON，但配置了 JSON 判断规则",
						errorCode: "JSON_RULE_MISMATCH",
						retryable: false,
						sanitizedResponse: sanitizeBodyPreview(bodyText),
					};
				}

				// 授权失效判断
				const authFailureResult = evaluateRules(mergedConfig.authFailureRules, response.status, bodyText, parsedJson);
				if (authFailureResult.matched) {
					return {
						success: false,
						summary: "授权失效，请重新配置凭据",
						errorCode: "UNAUTHORIZED",
						requiresReauth: true,
						retryable: false,
						sanitizedResponse: buildSanitizedResponse(response, bodyText, authFailureResult.matchedRule),
					};
				}

				// 如果状态码是 401/403，标记需要重新授权
				if (response.status === 401 || response.status === 403) {
					return {
						success: false,
						summary: `HTTP ${response.status}，授权失效`,
						errorCode: "UNAUTHORIZED",
						requiresReauth: true,
						retryable: false,
						sanitizedResponse: buildSanitizedResponse(response, bodyText),
					};
				}

				// HTML 登录页面识别
				if (looksLikeHtmlLoginPage(bodyText)) {
					return {
						success: false,
						summary: "响应为登录页面，授权可能已失效",
						errorCode: "LOGIN_REQUIRED",
						requiresReauth: true,
						retryable: false,
						sanitizedResponse: buildSanitizedResponse(response, bodyText),
					};
				}

				// 今日已签到判断
				const alreadyCheckedInResult = evaluateRules(mergedConfig.alreadyCheckedInRules, response.status, bodyText, parsedJson);
				if (alreadyCheckedInResult.matched) {
					return {
						success: true,
						alreadyCheckedIn: true,
						summary: "今日已签到",
						sanitizedResponse: buildSanitizedResponse(response, bodyText, alreadyCheckedInResult.matchedRule),
					};
				}

				// 成功判断
				const successResult = evaluateRules(mergedConfig.successRules, response.status, bodyText, parsedJson);
				if (successResult.matched) {
					return {
						success: true,
						summary: "签到成功",
						sanitizedResponse: buildSanitizedResponse(response, bodyText, successResult.matchedRule),
					};
				}

				// 未命中任何成功规则
				return {
					success: false,
					summary: "未命中成功判断规则",
					errorCode: "SUCCESS_RULE_NOT_MATCHED",
					retryable: false,
					sanitizedResponse: buildSanitizedResponse(response, bodyText),
				};
			} catch (error: unknown) {
				lastError = error instanceof Error ? error : new Error(String(error));
				const retryable = isRetryableError(error, lastStatus);
				if (!retryable || attempt >= MAX_RETRIES) {
					break;
				}
				// 简单线性退避
				await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
			}
		}

		const errorMessage = lastError ? sanitizeErrorMessage(lastError.message) : "未知错误";
		const errorCode = lastError?.message?.includes("abort") ? "TIMEOUT" : "REQUEST_FAILED";
		const retryable = isRetryableError(lastError, lastStatus);

		return {
			success: false,
			summary: retryable ? "请求失败，可重试" : "请求失败",
			errorCode,
			errorMessage: errorMessage,
			retryable,
			sanitizedResponse: lastBodyText ? sanitizeBodyPreview(lastBodyText) : undefined,
		};
	},
};

function buildSanitizedResponse(response: Response, bodyText: string, matchedRule?: { type?: string }): string {
	const contentType = response.headers.get("Content-Type") || "";
	const preview = sanitizeBodyPreview(bodyText, 500);
	let summary = `状态码: ${response.status}; Content-Type: ${contentType}; 长度: ${bodyText.length}`;
	if (matchedRule?.type) {
		summary += `; 命中规则: ${matchedRule.type}`;
	}
	if (preview) {
		summary += `; 响应摘要: ${preview}`;
	}
	return summary;
}

export default adapter;
