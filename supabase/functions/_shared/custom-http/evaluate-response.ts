import type { HttpMatchRule } from "./types.ts";

function getJsonValue(obj: unknown, path: string): unknown {
	if (!obj || typeof obj !== "object") return undefined;
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a === "boolean" || typeof b === "boolean") {
		return Boolean(a) === Boolean(b);
	}
	if (typeof a === "number" || typeof b === "number") {
		return Number(a) === Number(b);
	}
	if (a === null || a === undefined || b === null || b === undefined) {
		return false;
	}
	return String(a) === String(b);
}

function evaluateSingleRule(rule: HttpMatchRule, status: number, bodyText: string, parsedJson: unknown): boolean {
	if (rule.type === "status_range") {
		return status >= 200 && status <= 299;
	}
	if (rule.type === "status_code") {
		return status === rule.statusCode;
	}
	if (rule.type === "text_contains") {
		return bodyText.includes(rule.text || "");
	}
	if (rule.type === "json_equals") {
		const value = getJsonValue(parsedJson, rule.jsonPath || "");
		return valuesEqual(value, rule.jsonValue);
	}
	return false;
}

export interface EvaluationResult {
	matched: boolean;
	matchedRule?: HttpMatchRule;
}

export function evaluateRules(
	rules: HttpMatchRule[],
	status: number,
	bodyText: string,
	parsedJson: unknown
): EvaluationResult {
	for (const rule of rules) {
		if (evaluateSingleRule(rule, status, bodyText, parsedJson)) {
			return { matched: true, matchedRule: rule };
		}
	}
	return { matched: false };
}

export function looksLikeHtmlLoginPage(bodyText: string): boolean {
	const lower = bodyText.toLowerCase();
	const hasForm = lower.includes("<form") && (lower.includes("password") || lower.includes("login"));
	const hasLoginText = lower.includes("登录") || lower.includes("login") || lower.includes("sign in") || lower.includes("密码");
	return hasForm && hasLoginText;
}
