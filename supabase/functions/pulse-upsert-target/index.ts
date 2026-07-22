import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors, errorResponse, successResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { encryptCredentials, serializeEncryptedBlob } from "../_shared/crypto.ts";
import { validateAdapterConfig, getAdapter } from "../_shared/adapters/index.ts";

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

	const validation = await validateAdapterConfig(service_key, credentials, public_config);
	if (!validation.valid) {
		return errorResponse(validation.errors?.join("; ") || "配置无效", 400);
	}

	const supabase = getServiceClient();

	try {
		let targetId = existingId;
		let credentialSecretId: string | null = null;
		let isNew = !existingId;

		if (isNew) {
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
				.select("id, user_id, credential_secret_id")
				.eq("id", existingId)
				.eq("user_id", user.id)
				.single();

			if (fetchErr || !existing) {
				return errorResponse("签到项目不存在", 404);
			}
			credentialSecretId = existing.credential_secret_id;

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

		const hasNewCredentials = credentials && Object.keys(credentials).some(
			(k) => credentials[k] && typeof credentials[k] === "string" && credentials[k].length > 0
		);

		if (hasNewCredentials) {
			const plaintext = JSON.stringify(credentials);
			const encryptedBlob = await encryptCredentials(plaintext);
			const encryptedBytes = serializeEncryptedBlob(encryptedBlob);
			const encryptedHex = Array.from(encryptedBytes)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			if (credentialSecretId) {
				const { error: secretUpdateErr } = await supabase
					.from("checkin_secrets")
					.update({
						encrypted_data: `\\x${encryptedHex}`,
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

		if (isNew) {
			const timeStr = typeof local_time === "string" ? local_time : "08:00";
			const validTime = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(timeStr) ? timeStr : "08:00";

			const { error: scheduleErr } = await supabase
				.from("checkin_schedules")
				.insert({
					user_id: user.id,
					target_id: targetId,
					enabled: !!enabled,
					timezone: timezone || "Asia/Shanghai",
					local_time: validTime,
					days_of_week: Array.isArray(days_of_week) ? days_of_week : [0, 1, 2, 3, 4, 5, 6],
					retry_count: Math.min(5, Math.max(0, Number(retry_count) || 0)),
					retry_interval_minutes: Math.min(60, Math.max(1, Number(retry_interval_minutes) || 5)),
					random_delay_seconds: Math.min(3600, Math.max(0, Number(random_delay_seconds) || 0)),
				});

			if (scheduleErr) {
				console.error("Insert schedule error:", scheduleErr);
			}
		} else {
			const { error: scheduleUpdateErr } = await supabase
				.from("checkin_schedules")
				.update({
					enabled: !!enabled,
					timezone: timezone || "Asia/Shanghai",
					local_time: typeof local_time === "string" && /^([01]?\d|2[0-3]):([0-5]\d)$/.test(local_time) ? local_time : "08:00",
					days_of_week: Array.isArray(days_of_week) ? days_of_week : [0, 1, 2, 3, 4, 5, 6],
					retry_count: Math.min(5, Math.max(0, Number(retry_count) || 0)),
					retry_interval_minutes: Math.min(60, Math.max(1, Number(retry_interval_minutes) || 5)),
					random_delay_seconds: Math.min(3600, Math.max(0, Number(random_delay_seconds) || 0)),
					updated_at: new Date().toISOString(),
				})
				.eq("target_id", existingId)
				.eq("user_id", user.id);

			if (scheduleUpdateErr) {
				console.error("Update schedule error:", scheduleUpdateErr);
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

		return successResponse({
			target: savedTarget ? { ...savedTarget, has_credentials: !!savedTarget.credential_secret_id } : null,
			schedule: savedSchedule,
		});
	} catch (err: unknown) {
		console.error("Upsert target exception:", err);
		return errorResponse("服务器内部错误", 500);
	}
});
