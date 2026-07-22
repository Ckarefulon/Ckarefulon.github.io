import type { CustomHttpConfig, HttpMatchRule, HttpMethod, HttpBodyType } from "./types.ts";

const VALID_METHODS: HttpMethod[] = ["GET", "POST"];
const VALID_BODY_TYPES: HttpBodyType[] = ["none", "json", "form"];
const VALID_RULE_TYPES = ["status_code", "status_range", "text_contains", "json_equals"] as const;

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

function isValidJsonPath(path: string): boolean {
	if (!path || typeof path !== "string") return false;
	if (path.length > 200) return false;
	// 只支持简单的点路径，如 data.success
	return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(path);
}

function validateRule(rule: HttpMatchRule, index: number, category: string): string[] {
	const errors: string[] = [];
	if (!rule || typeof rule !== "object") {
		errors.push(`${category}[${index}] 格式错误`);
		return errors;
	}
	if (!VALID_RULE_TYPES.includes(rule.type as typeof VALID_RULE_TYPES[number])) {
		errors.push(`${category}[${index}] 不支持的判断类型`);
	}
	if (rule.type === "status_code") {
		if (typeof rule.statusCode !== "number" || rule.statusCode < 100 || rule.statusCode > 599) {
			errors.push(`${category}[${index}] 状态码必须在 100-599 之间`);
		}
	}
	if (rule.type === "text_contains") {
		if (typeof rule.text !== "string" || rule.text.trim().length === 0) {
			errors.push(`${category}[${index}] 文本匹配内容不能为空`);
		}
		if (rule.text && rule.text.length > 500) {
			errors.push(`${category}[${index}] 文本匹配内容过长`);
		}
	}
	if (rule.type === "json_equals") {
		if (!isValidJsonPath(rule.jsonPath || "")) {
			errors.push(`${category}[${index}] JSON 字段路径格式错误`);
		}
		if (rule.jsonValue === undefined) {
			errors.push(`${category}[${index}] JSON 字段值不能为空`);
		}
	}
	return errors;
}

function validateParam(param: { key?: string; value?: string; sensitive?: boolean }, index: number, category: string): string[] {
	const errors: string[] = [];
	if (!param || typeof param !== "object") {
		errors.push(`${category}[${index}] 格式错误`);
		return errors;
	}
	if (typeof param.key !== "string" || param.key.trim().length === 0) {
		errors.push(`${category}[${index}] 参数名不能为空`);
	}
	if (param.key && param.key.length > 200) {
		errors.push(`${category}[${index}] 参数名过长`);
	}
	if (typeof param.value !== "string") {
		errors.push(`${category}[${index}] 参数值必须是字符串`);
	}
	if (param.value && param.value.length > 5000) {
		errors.push(`${category}[${index}] 参数值过长`);
	}
	return errors;
}

export function validateCustomHttpConfig(config: CustomHttpConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!config || typeof config !== "object") {
		return { valid: false, errors: ["配置不能为空"] };
	}

	if (!VALID_METHODS.includes(config.method)) {
		errors.push("请求方法必须是 GET 或 POST");
	}

	if (!VALID_BODY_TYPES.includes(config.bodyType)) {
		errors.push("请求数据类型无效");
	}

	if (config.method === "GET" && config.bodyType !== "none") {
		errors.push("GET 请求不能设置请求体");
	}

	if (!Array.isArray(config.queryParams)) {
		errors.push("Query 参数必须是数组");
	} else if (config.queryParams.length > 50) {
		errors.push("Query 参数过多");
	} else {
		config.queryParams.forEach((p, i) => errors.push(...validateParam(p, i, "Query 参数")));
	}

	if (!Array.isArray(config.headers)) {
		errors.push("Header 必须是数组");
	} else if (config.headers.length > 50) {
		errors.push("Header 过多");
	} else {
		config.headers.forEach((p, i) => {
			errors.push(...validateParam(p, i, "Header"));
			const lowerKey = p.key?.toLowerCase();
			if (lowerKey && BLOCKED_HEADER_NAMES.has(lowerKey)) {
				errors.push(`Header[${i}] ${p.key} 不允许用户设置`);
			}
			if (lowerKey && lowerKey.startsWith("sec-")) {
				errors.push(`Header[${i}] ${p.key} 不允许用户设置`);
			}
		});
	}

	if (!Array.isArray(config.bodyFields)) {
		errors.push("Body 参数必须是数组");
	} else if (config.bodyFields.length > 50) {
		errors.push("Body 参数过多");
	} else {
		config.bodyFields.forEach((p, i) => errors.push(...validateParam(p, i, "Body 参数")));
	}

	if (!Array.isArray(config.successRules) || config.successRules.length === 0) {
		errors.push("请至少配置一条成功判断规则");
	} else if (config.successRules.length > 10) {
		errors.push("成功判断规则过多");
	} else {
		config.successRules.forEach((r, i) => errors.push(...validateRule(r, i, "成功判断")));
	}

	if (Array.isArray(config.alreadyCheckedInRules)) {
		if (config.alreadyCheckedInRules.length > 5) {
			errors.push("已签到判断规则过多");
		} else {
			config.alreadyCheckedInRules.forEach((r, i) => errors.push(...validateRule(r, i, "已签到判断")));
		}
	}

	if (Array.isArray(config.authFailureRules)) {
		if (config.authFailureRules.length > 5) {
			errors.push("授权失效判断规则过多");
		} else {
			config.authFailureRules.forEach((r, i) => errors.push(...validateRule(r, i, "授权失效判断")));
		}
	}

	return { valid: errors.length === 0, errors };
}

export function sanitizeCustomHttpConfigForClient(config: CustomHttpConfig): CustomHttpConfig {
	const SENSITIVE_PLACEHOLDER = "__PULSE_SENSITIVE__";
	function sanitizeParams(params: { key: string; value: string; sensitive?: boolean }[]) {
		return params.map(p => ({
			key: p.key,
			value: p.sensitive && p.value === SENSITIVE_PLACEHOLDER ? SENSITIVE_PLACEHOLDER : p.value,
			sensitive: !!p.sensitive,
		}));
	}

	return {
		...config,
		queryParams: sanitizeParams(config.queryParams),
		headers: sanitizeParams(config.headers),
		bodyFields: sanitizeParams(config.bodyFields),
	};
}
