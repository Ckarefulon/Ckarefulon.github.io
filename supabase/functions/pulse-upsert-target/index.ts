import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors, errorResponse, successResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { encryptCredentials, serializeEncryptedBlob } from "../_shared/crypto.ts";
import { validateAdapterConfig, getAdapter } from "../_shared/adapters/index.ts";
import { validateCustomHttpConfig } from "../_shared/custom-http/validate-rules.ts";
import { extractSensitiveValues } from "../_shared/custom-http/merge-config.ts";
import { validateUrl } from "../_shared/custom-http/validate-url.ts";
import type { CustomHttpConfig } from "../_shared/custom-http/types.ts";

serve(async (req: Request) => {
	const corsRes = handleCors(req);
	if (corsRes) return corsRes;

	if (req.method !== "POST") {
		return errorResponse("Method not allowed", 405);
	}

	const { user, error: authError } = await getUserFromRequest(req);
	if (authError || !user) {
		return errorResponse(authError || "未授权", 401);
	}

	let body;
	try {
		body = await req.json();
	} catch {
		return errorResponse("请求体格式错误", 400);
	}

	const {
		id: existingId,
		service_key,
		display_name,
		enabled = true,
		credentials = {},
		public_config = {},
		timezone = "Asia/Shanghai",
		local_time = "08:00",
		days_of_week = [0, 1, 2, 3, 4, 5, 6],
		retry_count = 2,
		retry_interval_minutes = 5,
		random_delay_seconds = 0,
		custom_http_config,
	} = body;

	if (!service_key || !getAdapter(service_key)) {
		return errorResponse("无效的签到服务", 400);
	}
	if (!display_name || typeof display_name !== "string" || display_name.trim().length < 1) {
		return errorResponse("请输入账号名称", 400);
	}
	if (display_name.length > 100) {
		return errorResponse("账号名称过长", 400);
	}

	const isCustomHttp = service_key === "custom-http";
	let validatedCustomHttpConfig: CustomHttpConfig | null = null;
	let extractedCustomHttpCredentials: Record<string, unknown> = {};

	if (isCustomHttp) {
		if (!custom_http_config || typeof custom_http_config !== "object") {
			return errorResponse("缺少自定义 HTTP 配置", 400);
		}
		const config = custom_http_config as CustomHttpConfig;
		const schemaValidation = validateCustomHttpConfig(config);
		if (!schemaValidation.valid) {
			return errorResponse(schemaValidation.errors.join("; "), 400);
		}

		const urlValidation = await validateUrl(config.url);
		if (!urlValidation.valid) {
			return errorResponse(urlValidation.error || "URL 验证失败", 400);
		}

		const { cleanedConfig, credentials: sensitiveCreds } = extractSensitiveValues(config);
		validatedCustomHttpConfig = cleanedConfig;
		extractedCustomHttpCredentials = sensitiveCreds as Record<string, unknown>;
	} else {
		const validation = await validateAdapterConfig(service_key, credentials, public_config);
		if (!validation.valid) {
			return errorResponse(validation.errors?.join("; ") || "配置无效", 400);
		}
	}

	const supabase = getServiceClient();

	try {
		let targetId = existingId;
		let credentialSecretId: string | null = null;
		let isNew = !existingId;

		// 整点时间校验与规范化
		const normalizeTime = (timeStr: string): string => {
			if (typeof timeStr !== "string" || !/^([01]?\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/.test(timeStr)) {
				return "08:00";
			}
			const [h] = timeStr.split(":").map(Number);
			return `${String(h).padStart(2, "0")}:00`;
		};
		const validTime = normalizeTime(local_time);

		if (isNew) {
			if (isCustomHttp) {
				const { count, error: countErr } = await supabase
					.from("checkin_targets")
					.select("id", { count: "exact", head: true })
					.eq("user_id", user.id)
					.eq("service_key", "custom-http")
					.eq("enabled", true);

				if (!countErr && (count || 0) >= 20) {
					return errorResponse("最多只能创建 20 个启用的自定义 HTTP 签到项目", 400);
				}
			}

			const { data: newTarget, error: insertErr } = await supabase
				.from("checkin_targets")
				.insert({
					user_id: user.id,
					service_key,
					display_name: display_name.trim(),
					enabled: !!enabled,
					public_config,
				})
				.select("id, credential_secret_id")
				.single();

			if (insertErr || !newTarget) {
				console.error("Insert target error:", insertErr);
				return errorResponse("创建签到项目失败", 500);
			}
			targetId = newTarget.id;
		} else {
			const { data: existing, error: fetchErr } = await supabase
				.from("checkin_targets")
				.select("id, user_id, credential_secret_id, service_key, enabled")
				.eq("id", existingId)
				.eq("user_id", user.id)
				.single();

			if (fetchErr || !existing) {
				return errorResponse("签到项目不存在", 404);
			}
			credentialSecretId = existing.credential_secret_id;

			if (isCustomHttp && enabled && !existing.enabled) {
				const { count, error: countErr } = await supabase
					.from("checkin_targets")
					.select("id", { count: "exact", head: true })
					.eq("user_id", user.id)
					.eq("service_key", "custom-http")
					.eq("enabled", true);

				if (!countErr && (count || 0) >= 20) {
					return errorResponse("最多只能创建 20 个启用的自定义 HTTP 签到项目", 400);
				}
			}

			const { error: updateErr } = await supabase
				.from("checkin_targets")
				.update({
					service_key,
					display_name: display_name.trim(),
					enabled: !!enabled,
					public_config,
					updated_at: new Date().toISOString(),
				})
				.eq("id", existingId)
				.eq("user_id", user.id);

			if (updateErr) {
				console.error("Update target error:", updateErr);
				return errorResponse("更新签到项目失败", 500);
			}
		}

		// 保存自定义 HTTP 配置
		if (isCustomHttp && validatedCustomHttpConfig) {
			const upsertData = {
				user_id: user.id,
				target_id: targetId,
				url: validatedCustomHttpConfig.url,
				method: validatedCustomHttpConfig.method,
				body_type: validatedCustomHttpConfig.bodyType,
				query_params: validatedCustomHttpConfig.queryParams,
				headers: validatedCustomHttpConfig.headers,
				body_fields: validatedCustomHttpConfig.bodyFields,
				success_rules: validatedCustomHttpConfig.successRules,
				already_checked_in_rules: validatedCustomHttpConfig.alreadyCheckedInRules,
				auth_failure_rules: validatedCustomHttpConfig.authFailureRules,
			};

			// 先查询是否已存在配置记录，再决定 insert 或 update
			const { data: existingConfig } = await supabase
				.from("checkin_custom_http_configs")
				.select("id")
				.eq("target_id", targetId)
				.eq("user_id", user.id)
				.maybeSingle();

			if (existingConfig) {
				const { error: configUpdateErr } = await supabase
					.from("checkin_custom_http_configs")
					.update({ ...upsertData, updated_at: new Date().toISOString() })
					.eq("target_id", targetId)
					.eq("user_id", user.id);
				if (configUpdateErr) {
					console.error("Update custom http config error:", configUpdateErr);
					return errorResponse("保存自定义 HTTP 配置失败", 500);
				}
			} else {
				const { error: configInsertErr } = await supabase
					.from("checkin_custom_http_configs")
					.insert(upsertData);
				if (configInsertErr) {
					console.error("Insert custom http config error:", configInsertErr);
					return errorResponse("保存自定义 HTTP 配置失败", 500);
				}
			}
		}

		// 保存凭据（含自定义 HTTP 敏感参数）
		const allCredentials = { ...credentials };
		if (isCustomHttp && Object.keys(extractedCustomHttpCredentials).length > 0) {
			allCredentials.customHttp = extractedCustomHttpCredentials;
		}

		const hasNewCredentials = Object.keys(allCredentials).some((k) => {
			const v = allCredentials[k];
			if (k === "customHttp" && v && typeof v === "object") {
				return Object.keys(v).length > 0;
			}
			return typeof v === "string" && v.length > 0;
		});

		if (hasNewCredentials) {
			const plaintext = JSON.stringify(allCredentials);
			const encryptedBlob = await encryptCredentials(plaintext);
			const encryptedBytes = serializeEncryptedBlob(encryptedBlob);
			const encryptedHex = Array.from(encryptedBytes)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			if (credentialSecretId) {
				// 编辑时合并凭据：保留旧 customHttp，除非新值明确提供
				const { data: existingSecret, error: secretFetchErr } = await supabase
					.from("checkin_secrets")
					.select("encrypted_data")
					.eq("id", credentialSecretId)
					.eq("user_id", user.id)
					.single();

				let mergedCredentials = allCredentials;
				if (!secretFetchErr && existingSecret) {
					try {
						const existingPlaintext = await decryptExistingSecret(existingSecret.encrypted_data);
						const existingCreds = JSON.parse(existingPlaintext);
						mergedCredentials = mergeCredentials(existingCreds, allCredentials);
					} catch {
						// 解密失败则使用新凭据
					}
				}

				const mergedPlaintext = JSON.stringify(mergedCredentials);
				const mergedBlob = await encryptCredentials(mergedPlaintext);
				const mergedBytes = serializeEncryptedBlob(mergedBlob);
				const mergedHex = Array.from(mergedBytes)
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");

				const { error: secretUpdateErr } = await supabase
					.from("checkin_secrets")
					.update({
						encrypted_data: `\\x${mergedHex}`,
						updated_at: new Date().toISOString(),
					})
					.eq("id", credentialSecretId)
					.eq("user_id", user.id);

				if (secretUpdateErr) {
					console.error("Update secret error:", secretUpdateErr);
					return errorResponse("保存凭据失败", 500);
				}
			} else {
				const { data: newSecret, error: secretInsertErr } = await supabase
					.from("checkin_secrets")
					.insert({
						user_id: user.id,
						target_id: targetId,
						encrypted_data: `\\x${encryptedHex}`,
					})
					.select("id")
					.single();

				if (secretInsertErr || !newSecret) {
					console.error("Insert secret error:", secretInsertErr);
					return errorResponse("保存凭据失败", 500);
				}
				credentialSecretId = newSecret.id;

				const { error: targetUpdateErr } = await supabase
					.from("checkin_targets")
					.update({ credential_secret_id: credentialSecretId })
					.eq("id", targetId)
					.eq("user_id", user.id);

				if (targetUpdateErr) {
					console.error("Update target credential_secret_id error:", targetUpdateErr);
				}
			}

			const { error: resetReauthErr } = await supabase
				.from("checkin_targets")
				.update({ requires_reauth: false, last_error_code: null, last_error_message: null })
				.eq("id", targetId)
				.eq("user_id", user.id);
			if (resetReauthErr) {
				console.warn("Reset requires_reauth error:", resetReauthErr);
			}
		}

		// 保存执行计划：先查询是否存在，不存在就 insert，存在就 update
		const { data: existingSchedule } = await supabase
			.from("checkin_schedules")
			.select("id")
			.eq("target_id", targetId)
			.eq("user_id", user.id)
			.maybeSingle();

		const scheduleData = {
			user_id: user.id,
			target_id: targetId,
			enabled: !!enabled,
			timezone: timezone || "Asia/Shanghai",
			local_time: validTime,
			days_of_week: Array.isArray(days_of_week) ? days_of_week : [0, 1, 2, 3, 4, 5, 6],
			retry_count: Math.min(5, Math.max(0, Number(retry_count) || 0)),
			retry_interval_minutes: Math.min(60, Math.max(1, Number(retry_interval_minutes) || 5)),
			random_delay_seconds: Math.min(3600, Math.max(0, Number(random_delay_seconds) || 0)),
		};

		if (existingSchedule) {
			const { error: scheduleUpdateErr } = await supabase
				.from("checkin_schedules")
				.update({ ...scheduleData, updated_at: new Date().toISOString() })
				.eq("target_id", targetId)
				.eq("user_id", user.id);

			if (scheduleUpdateErr) {
				console.error("Update schedule error:", scheduleUpdateErr);
				return errorResponse("更新执行计划失败", 500);
			}
		} else {
			const { error: scheduleErr } = await supabase
				.from("checkin_schedules")
				.insert(scheduleData);

			if (scheduleErr) {
				console.error("Insert schedule error:", scheduleErr);
				return errorResponse("保存执行计划失败", 500);
			}
		}

		const { data: savedTarget, error: fetchErr } = await supabase
			.from("checkin_targets")
			.select(`
				id, service_key, display_name, enabled, public_config,
				last_status, last_run_at, last_success_at, consecutive_success_days,
				requires_reauth, created_at, updated_at,
				credential_secret_id
			`)
			.eq("id", targetId)
			.eq("user_id", user.id)
			.single();

		const { data: savedSchedule } = await supabase
			.from("checkin_schedules")
			.select("*")
			.eq("target_id", targetId)
			.eq("user_id", user.id)
			.maybeSingle();

		let savedCustomConfig = null;
		if (isCustomHttp) {
			const { data: cfg } = await supabase
				.from("checkin_custom_http_configs")
				.select("*")
				.eq("target_id", targetId)
				.eq("user_id", user.id)
				.maybeSingle();
			savedCustomConfig = cfg;
		}

		return successResponse({
			target: savedTarget ? { ...savedTarget, has_credentials: !!savedTarget.credential_secret_id } : null,
			schedule: savedSchedule,
			custom_http_config: savedCustomConfig,
		});
	} catch (err: unknown) {
		console.error("Upsert target exception:", err);
		return errorResponse("服务器内部错误", 500);
	}
});

async function decryptExistingSecret(encryptedData: unknown): Promise<string> {
	const { decryptCredentials, deserializeEncryptedBlob } = await import("../_shared/crypto.ts");
	let encryptedBytes: Uint8Array;
	const raw = encryptedData;
	if (typeof raw === "string") {
		const hex = raw.startsWith("\\x") ? raw.substring(2) : raw;
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < hex.length; i += 2) {
			bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
		}
		encryptedBytes = bytes;
	} else {
		encryptedBytes = new Uint8Array(raw as ArrayBuffer);
	}
	const blob = deserializeEncryptedBlob(encryptedBytes);
	return decryptCredentials(blob);
}

function mergeCredentials(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...existing };
	for (const key of Object.keys(incoming)) {
		const value = incoming[key];
		if (key === "customHttp" && value && typeof value === "object") {
			const existingCustomHttp = (merged.customHttp || {}) as Record<string, unknown>;
			const incomingCustomHttp = value as Record<string, unknown>;
			const mergedCustomHttp: Record<string, unknown> = { ...existingCustomHttp };
			for (const cat of Object.keys(incomingCustomHttp)) {
				const incomingCat = incomingCustomHttp[cat] as Record<string, string> | undefined;
				const existingCat = (existingCustomHttp[cat] as Record<string, string>) || {};
				const mergedCat: Record<string, string> = { ...existingCat };
				if (incomingCat) {
					for (const idx of Object.keys(incomingCat)) {
						mergedCat[idx] = incomingCat[idx];
					}
				}
				if (Object.keys(mergedCat).length > 0) {
					mergedCustomHttp[cat] = mergedCat;
				}
			}
			merged.customHttp = mergedCustomHttp;
		} else if (typeof value === "string" && value.length > 0) {
			merged[key] = value;
		}
	}
	return merged;
}
