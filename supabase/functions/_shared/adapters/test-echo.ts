import type { CheckinAdapter, CheckinContext, CheckinResult, ValidationResult } from "./types.ts";

const adapter: CheckinAdapter = {
	serviceKey: "test-echo",
	serviceName: "测试服务 (Echo)",
	description: "用于测试的模拟签到服务",
	credentialFields: [
		{ key: "username", label: "用户名", type: "text", placeholder: "任意用户名", required: false },
		{ key: "token", label: "测试令牌", type: "password", placeholder: "任意字符串", required: false, helpText: "测试用，不实际发送请求" },
	],
	publicConfigFields: [
		{ key: "shouldFail", label: "模拟失败", type: "checkbox", defaultValue: false, helpText: "勾选后模拟签到失败，用于测试重试逻辑" },
		{ key: "message", label: "自定义消息", type: "text", placeholder: "签到成功！", required: false, defaultValue: "签到成功" },
	],

	async validateConfig(credentials, publicConfig): Promise<ValidationResult> {
		return { valid: true };
	},

	async checkin(context: CheckinContext): Promise<CheckinResult> {
		const { publicConfig, attempt } = context;
		const shouldFail = publicConfig.shouldFail === true || publicConfig.shouldFail === "true";
		const message = (publicConfig.message as string) || "签到成功";

		await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

		if (shouldFail) {
			if (attempt >= 3) {
				return {
					success: false,
					summary: "重试多次后仍然失败",
					errorCode: "SIMULATED_FAILURE",
					errorMessage: "模拟失败（已耗尽重试次数）",
					retryable: false,
					sanitizedResponse: "Simulated failure after retries",
				};
			}
			return {
				success: false,
				summary: "模拟失败（可重试）",
				errorCode: "SIMULATED_RETRYABLE",
				errorMessage: "模拟的临时网络错误",
				retryable: true,
				sanitizedResponse: "Simulated temporary error",
			};
		}

		return {
			success: true,
			summary: message,
			sanitizedResponse: JSON.stringify({ ok: true, message: message, attempt: attempt }),
		};
	},
};

export default adapter;
