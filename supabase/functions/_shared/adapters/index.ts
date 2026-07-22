import type { CheckinAdapter, CheckinContext, CheckinResult } from "./types.ts";
import testEchoAdapter from "./test-echo.ts";

const adapters: Map<string, CheckinAdapter> = new Map();

function registerAdapter(adapter: CheckinAdapter) {
	adapters.set(adapter.serviceKey, adapter);
}

registerAdapter(testEchoAdapter);

export function getAdapter(serviceKey: string): CheckinAdapter | null {
	return adapters.get(serviceKey) || null;
}

export function getServiceDefinitions() {
	const services: Array<{
		serviceKey: string;
		displayName: string;
		description: string;
		credentialFields: Array<{
			key: string;
			label: string;
			type: "text" | "password" | "textarea" | "checkbox" | "number";
			placeholder?: string;
			required: boolean;
			helpText?: string;
		}>;
		publicConfigFields: Array<{
			key: string;
			label: string;
			type: "text" | "select" | "number" | "checkbox" | "boolean";
			placeholder?: string;
			defaultValue?: unknown;
			options?: { value: string; label: string }[];
			required?: boolean;
			helpText?: string;
		}>;
	}> = [];
	adapters.forEach((adapter) => {
		services.push({
			serviceKey: adapter.serviceKey,
			displayName: adapter.serviceName,
			description: adapter.description,
			credentialFields: adapter.credentialFields.map(f => ({
				...f,
				type: f.type === "password" ? "password" : (f.type === "text" ? "text" : "text")
			})),
			publicConfigFields: adapter.publicConfigFields.map(f => ({
				...f,
				type: f.type === "boolean" ? "checkbox" : f.type
			})),
		});
	});
	return services;
}

export async function executeCheckin(
	serviceKey: string,
	context: CheckinContext
): Promise<CheckinResult> {
	const adapter = getAdapter(serviceKey);
	if (!adapter) {
		return {
			success: false,
			summary: "未知的签到服务",
			errorCode: "UNKNOWN_SERVICE",
			errorMessage: `服务 ${serviceKey} 未注册`,
			retryable: false,
		};
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 30000);

	try {
		const result = await Promise.race([
			adapter.checkin(context),
			new Promise<CheckinResult>((_, reject) => {
				controller.signal.addEventListener("abort", () => {
					reject(new Error("TIMEOUT"));
				});
			}),
		]);
		clearTimeout(timeoutId);
		return result;
	} catch (error: unknown) {
		clearTimeout(timeoutId);
		const message = error instanceof Error ? error.message : String(error);
		if (message === "TIMEOUT" || message.includes("abort")) {
			return {
				success: false,
				summary: "签到请求超时",
				errorCode: "TIMEOUT",
				errorMessage: "签到请求超时（30秒）",
				retryable: true,
			};
		}
		return {
			success: false,
			summary: "签到执行异常",
			errorCode: "EXECUTION_ERROR",
			errorMessage: message.substring(0, 200),
			retryable: false,
		};
	}
}

export async function validateAdapterConfig(
	serviceKey: string,
	credentials: Record<string, string>,
	publicConfig: Record<string, unknown>
) {
	const adapter = getAdapter(serviceKey);
	if (!adapter) {
		return { valid: false, errors: ["未知的签到服务"] };
	}
	return adapter.validateConfig(credentials, publicConfig);
}
