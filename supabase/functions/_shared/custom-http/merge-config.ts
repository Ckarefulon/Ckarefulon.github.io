import type { CustomHttpConfig, HttpParam } from "./types.ts";

const SENSITIVE_PLACEHOLDER = "__PULSE_SENSITIVE__";

export interface CustomHttpCredentials {
	customHttp?: {
		queryParams?: Record<string, string>;
		headers?: Record<string, string>;
		bodyFields?: Record<string, string>;
	};
}

export function mergeCustomHttpConfig(
	config: CustomHttpConfig,
	credentials: CustomHttpCredentials
): CustomHttpConfig {
	const sensitive = credentials?.customHttp || {};

	function mergeParams(params: HttpParam[], category: "queryParams" | "headers" | "bodyFields"): HttpParam[] {
		const values = sensitive[category] || {};
		return params.map((p, index) => {
			if (p.sensitive && p.value === SENSITIVE_PLACEHOLDER) {
				const realValue = values[String(index)];
				if (realValue !== undefined) {
					return { ...p, value: realValue };
				}
			}
			return p;
		});
	}

	return {
		...config,
		queryParams: mergeParams(config.queryParams, "queryParams"),
		headers: mergeParams(config.headers, "headers"),
		bodyFields: mergeParams(config.bodyFields, "bodyFields"),
	};
}

export function extractSensitiveValues(
	config: CustomHttpConfig
): { cleanedConfig: CustomHttpConfig; credentials: CustomHttpCredentials } {
	const credentials: CustomHttpCredentials = { customHttp: {} };

	function processParams(params: HttpParam[], category: "queryParams" | "headers" | "bodyFields"): HttpParam[] {
		const values: Record<string, string> = {};
		const cleaned = params.map((p, index) => {
			if (p.sensitive) {
				const realValue = String(p.value || "").trim();
				if (realValue.length > 0 && realValue !== SENSITIVE_PLACEHOLDER) {
					values[String(index)] = realValue;
				}
				return { ...p, value: SENSITIVE_PLACEHOLDER };
			}
			return p;
		});
		if (Object.keys(values).length > 0) {
			credentials.customHttp![category] = values;
		}
		return cleaned;
	}

	const cleanedConfig: CustomHttpConfig = {
		...config,
		queryParams: processParams(config.queryParams, "queryParams"),
		headers: processParams(config.headers, "headers"),
		bodyFields: processParams(config.bodyFields, "bodyFields"),
	};

	return { cleanedConfig, credentials };
}
