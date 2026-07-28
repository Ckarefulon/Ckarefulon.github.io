import type { CheckinAdapter, CheckinContext, CheckinResult, ValidationResult } from "./types.ts";
import type { CustomHttpConfig } from "../custom-http/types.ts";
import type { CustomHttpCredentials } from "../custom-http/merge-config.ts";
import { validateUrl, validateRedirectUrl } from "../custom-http/validate-url.ts";
import { validateCustomHttpConfig } from "../custom-http/validate-rules.ts";
import { mergeCustomHttpConfig } from "../custom-http/merge-config.ts";
import {
	buildRequestOptions,
	buildPreRequestOptions,
	extractVariables,
	containsKeywords,
} from "../custom-http/build-request.ts";
import { evaluateRules, looksLikeHtmlLoginPage } from "../custom-http/evaluate-response.ts";
import { sanitizeBodyPreview, sanitizeErrorMessage } from "../custom-http/sanitize-response.ts";

const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_NONCE_REFRESH_ATTEMPTS = 2;

interface RequestResult {
	response: Response;
	finalUrl: string;
	bodyText: string;
}

async function executeFetch(
	options: { url: string; method: string; headers: Record<string, string>; body?: string },
	allowRedirect: boolean = false
): Promise<RequestResult> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(options.url, {
			method: options.method,
			headers: options.headers,
			body: options.body,
			signal: controller.signal,
			redirect: allowRedirect ? "follow" : "manual",
		});

		let finalUrl = options.url;
		let bodyText = await readLimitedBody(response);

		// Handle redirects manually for security
		if (!allowRedirect && (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308)) {
			const location = response.headers.get("location");
			if (location) {
				const baseUrl = new URL(options.url);
				const redirectUrl = new URL(location, baseUrl);
				const redirectValidation = await validateRedirectUrl(options.url, redirectUrl.toString());
				if (redirectValidation.valid && redirectValidation.url) {
					const revalidation = await validateUrl(redirectValidation.url.toString());
					if (revalidation.valid) {
						const redirectOpts = { ...options, url: redirectValidation.url.toString() };
						const redirectResponse = await fetch(redirectOpts.url, {
							method: redirectOpts.method,
							headers: redirectOpts.headers,
							body: redirectOpts.body,
							signal: controller.signal,
							redirect: "manual",
						});
						bodyText = await readLimitedBody(redirectResponse);
						return { response: redirectResponse, finalUrl: redirectValidation.url.toString(), bodyText };
					}
				}
			}
		}

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

type ErrorCategory = "retryable" | "nonce_invalid" | "auth_failure" | "already_checked" | "fatal";

function categorizeError(
	error: unknown,
	status: number,
	bodyText: string,
	config: CustomHttpConfig
): { category: ErrorCategory; reason: string } {
	// Network/timeout errors are retryable
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (message.includes("abort") || message.includes("timeout")) {
			return { category: "retryable", reason: "请求超时" };
		}
		if (message.includes("network") || message.includes("connection") || message.includes("dns")) {
			return { category: "retryable", reason: "网络错误" };
		}
	}

	// HTTP status code checks
	if (status === 401 || status === 403) {
		return { category: "auth_failure", reason: `HTTP ${status} 授权失效` };
	}
	if (status === 429) {
		return { category: "retryable", reason: "请求过于频繁(429)" };
	}
	if (status >= 500 && status <= 599 && status !== 501) {
		return { category: "retryable", reason: `服务器错误(${status})` };
	}

	// Check nonce invalid keywords
	const nonceKeywords = config.nonceInvalidKeywords || ["nonce invalid", "非法请求", "nonce失效"];
	if (containsKeywords(bodyText, nonceKeywords)) {
		return { category: "nonce_invalid", reason: "Nonce 失效，需要重新获取" };
	}

	// Check failure rules
	const { parsed: parsedJson } = parseJsonSafely(bodyText);
	if (config.failureRules && config.failureRules.length > 0) {
		const failureResult = evaluateRules(config.failureRules, status, bodyText, parsedJson);
		if (failureResult.matched) {
			return { category: "fatal", reason: "命中失败规则" };
		}
	}

	// Check already-checked-in rules
	if (config.alreadyCheckedInRules && config.alreadyCheckedInRules.length > 0) {
		const alreadyResult = evaluateRules(config.alreadyCheckedInRules, status, bodyText, parsedJson);
		if (alreadyResult.matched) {
			return { category: "already_checked", reason: "今日已签到" };
		}
	}

	// Check auth failure rules
	if (config.authFailureRules && config.authFailureRules.length > 0) {
		const authResult = evaluateRules(config.authFailureRules, status, bodyText, parsedJson);
		if (authResult.matched) {
			return { category: "auth_failure", reason: "授权失效" };
		}
	}

	// Check for login page
	if (looksLikeHtmlLoginPage(bodyText)) {
		return { category: "auth_failure", reason: "返回登录页面" };
	}

	// Check for common auth failure keywords
	const lowerBody = bodyText.toLowerCase();
	if (
		lowerBody.includes("登录失效") ||
		lowerBody.includes("login required") ||
		lowerBody.includes("请先登录") ||
		lowerBody.includes("unauthorized") ||
		lowerBody.includes("invalid token") ||
		lowerBody.includes("token expired")
	) {
		return { category: "auth_failure", reason: "登录已失效" };
	}

	// Check for common "already checked in" keywords
	if (
		lowerBody.includes("已签到") ||
		lowerBody.includes("今日已打卡") ||
		lowerBody.includes("already checked") ||
		lowerBody.includes("already signed")
	) {
		return { category: "already_checked", reason: "今日已签到" };
	}

	// If status is not 2xx and no other category matched, it's fatal
	if (status < 200 || status >= 300) {
		return { category: "fatal", reason: `HTTP ${status}` };
	}

	return { category: "fatal", reason: "未知错误" };
}

async function executeCheckinFlow(
	config: CustomHttpConfig,
	nonceRefreshAttempt: number = 0
): Promise<CheckinResult> {
	let variables: Record<string, string> = {};

	// Step 1: Pre-request to get page and extract variables (nonce, etc.)
	if (config.preRequest?.enabled && nonceRefreshAttempt <= MAX_NONCE_REFRESH_ATTEMPTS) {
		try {
			const preRequestOpts = buildPreRequestOptions(config, variables);
			if (preRequestOpts) {
				const preResult = await executeFetch(preRequestOpts, true);
				// Extract variables from pre-request response
				if (config.extractRules && config.extractRules.length > 0) {
					variables = extractVariables(preResult.bodyText, config.extractRules);
				}
			}
		} catch (preErr) {
			// Pre-request failed, but continue without variables - will likely fail at main request
			console.warn("Pre-request failed:", preErr instanceof Error ? preErr.message : preErr);
		}
	}

	// Step 2: Build main request with extracted variables
	const mainOpts = buildRequestOptions(config, variables, true);

	// Step 3: Execute main request
	const { response, bodyText } = await executeFetch(mainOpts, false);
	const status = response.status;
	const { parsed: parsedJson, isJson } = parseJsonSafely(bodyText);

	// Validate JSON if needed
	const hasJsonRule =
		config.successRules.some(r => r.type === "json_equals") ||
		(config.alreadyCheckedInRules && config.alreadyCheckedInRules.some(r => r.type === "json_equals")) ||
		(config.authFailureRules && config.authFailureRules.some(r => r.type === "json_equals"));

	if (hasJsonRule && !isJson && !response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
		return {
			success: false,
			summary: "配置错误：响应不是 JSON，但配置了 JSON 判断规则",
			errorCode: "JSON_RULE_MISMATCH",
			retryable: false,
			sanitizedResponse: sanitizeBodyPreview(bodyText),
		};
	}

	// Categorize the result
	const { category, reason } = categorizeError(null, status, bodyText, config);

	switch (category) {
		case "auth_failure":
			return {
				success: false,
				summary: reason,
				errorCode: "UNAUTHORIZED",
				requiresReauth: true,
				retryable: false,
				sanitizedResponse: buildSanitizedResponse(response, bodyText),
			};

		case "already_checked":
			return {
				success: true,
				alreadyCheckedIn: true,
				summary: "今日已签到",
				sanitizedResponse: buildSanitizedResponse(response, bodyText),
			};

		case "nonce_invalid":
			// Try refreshing nonce if we haven't exceeded max attempts
			if (nonceRefreshAttempt < MAX_NONCE_REFRESH_ATTEMPTS) {
				return executeCheckinFlow(config, nonceRefreshAttempt + 1);
			}
			return {
				success: false,
				summary: "Nonce 失效，刷新后仍无效",
				errorCode: "NONCE_INVALID",
				retryable: true,
				sanitizedResponse: buildSanitizedResponse(response, bodyText),
			};

		case "fatal":
			// Check success rules even for "fatal" - success rules can override
			const successResult = evaluateRules(config.successRules, status, bodyText, parsedJson);
			if (successResult.matched) {
				return {
					success: true,
					summary: "签到成功",
					sanitizedResponse: buildSanitizedResponse(response, bodyText, successResult.matchedRule),
				};
			}
			return {
				success: false,
				summary: reason || "签到失败",
				errorCode: "CHECKIN_FAILED",
				retryable: false,
				sanitizedResponse: buildSanitizedResponse(response, bodyText),
			};

		case "retryable":
			// This will be handled by the retry loop in the main checkin function
			throw new Error(reason);

		default:
			// Check success rules
			const successCheck = evaluateRules(config.successRules, status, bodyText, parsedJson);
			if (successCheck.matched) {
				return {
					success: true,
					summary: "签到成功",
					sanitizedResponse: buildSanitizedResponse(response, bodyText, successCheck.matchedRule),
				};
			}
			return {
				success: false,
				summary: "未命中成功判断规则",
				errorCode: "SUCCESS_RULE_NOT_MATCHED",
				retryable: false,
				sanitizedResponse: buildSanitizedResponse(response, bodyText),
			};
	}
}

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

		const maxRetries = Math.min(
			mergedConfig.retryConfig?.maxRetries ?? DEFAULT_MAX_RETRIES,
			5
		);
		const initialDelayMs = mergedConfig.retryConfig?.initialDelayMs ?? 1000;

		let lastError: Error | null = null;
		let lastResult: CheckinResult | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const result = await executeCheckinFlow(mergedConfig, 0);
				lastResult = result;

				// If we got a non-retryable result, return immediately
				if (!result.retryable) {
					return result;
				}

				// If retryable and we have attempts left, wait and retry
				if (attempt < maxRetries) {
					const delay = initialDelayMs * Math.pow(1.5, attempt);
					await new Promise(r => setTimeout(r, delay));
					continue;
				}

				return result;
			} catch (error: unknown) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if this error is retryable
				const errorMsg = lastError.message.toLowerCase();
				const isRetryable =
					errorMsg.includes("abort") ||
					errorMsg.includes("timeout") ||
					errorMsg.includes("network") ||
					errorMsg.includes("connection") ||
					errorMsg.includes("429") ||
					errorMsg.includes("服务器错误") ||
					errorMsg.includes("请求过于频繁");

				if (!isRetryable || attempt >= maxRetries) {
					break;
				}

				// Exponential backoff
				const delay = initialDelayMs * Math.pow(1.5, attempt);
				await new Promise(r => setTimeout(r, delay));
			}
		}

		// If we got a last result, return it
		if (lastResult) return lastResult;

		const errorMessage = lastError ? sanitizeErrorMessage(lastError.message) : "未知错误";
		return {
			success: false,
			summary: "请求失败",
			errorCode: lastError?.message?.includes("abort") ? "TIMEOUT" : "REQUEST_FAILED",
			errorMessage,
			retryable: true,
		};
	},
};

export default adapter;
