import { decryptCredentials, deserializeEncryptedBlob } from "./crypto.ts";
import { executeCheckin } from "./adapters/index.ts";

export async function performCheckin(
	supabase: any,
	targetId: string,
	userId: string,
	triggerType: "manual" | "scheduled" | "retry",
	attempt: number = 1,
	existingRunId?: string,
	scheduleId?: string,
	scheduledFor?: string,
	updateSchedule: boolean = false,
	retryIntervalMinutes?: number
) {
	const startedAt = new Date().toISOString();
	let runId = existingRunId;

	if (!runId) {
		const { data: newRun, error: runInsertErr } = await supabase
			.from("checkin_runs")
			.insert({
				user_id: userId,
				target_id: targetId,
				schedule_id: scheduleId || null,
				trigger_type: triggerType,
				scheduled_for: scheduledFor || null,
				started_at: startedAt,
				status: "running",
				attempt: attempt,
			})
			.select("id")
			.single();

		if (runInsertErr || !newRun) {
			console.error("Insert run error:", runInsertErr);
			return { success: false, message: "创建执行记录失败" };
		}
		runId = newRun.id;
	} else {
		await supabase
			.from("checkin_runs")
			.update({
				status: "running",
				started_at: startedAt,
				attempt: attempt,
			})
			.eq("id", runId)
			.eq("user_id", userId);
	}

	const { data: target, error: targetErr } = await supabase
		.from("checkin_targets")
		.select("id, user_id, service_key, display_name, public_config, credential_secret_id, requires_reauth")
		.eq("id", targetId)
		.eq("user_id", userId)
		.single();

	if (targetErr || !target) {
		await supabase.from("checkin_runs").update({
			status: "failed",
			finished_at: new Date().toISOString(),
			error_code: "TARGET_NOT_FOUND",
			error_message: "签到项目不存在",
		}).eq("id", runId);
		return { success: false, message: "签到项目不存在", runId };
	}

	if (target.requires_reauth) {
		await supabase.from("checkin_runs").update({
			status: "failed",
			finished_at: new Date().toISOString(),
			error_code: "REAUTH_REQUIRED",
			error_message: "需要重新授权",
		}).eq("id", runId);
		return { success: false, message: "该项目需要重新授权", runId, requiresReauth: true };
	}

	let credentials: Record<string, string> = {};
	if (target.credential_secret_id) {
		const { data: secretRow, error: secretErr } = await supabase
			.from("checkin_secrets")
			.select("encrypted_data")
			.eq("id", target.credential_secret_id)
			.eq("user_id", userId)
			.single();

		if (secretErr || !secretRow) {
			await supabase.from("checkin_runs").update({
				status: "failed",
				finished_at: new Date().toISOString(),
				error_code: "CREDENTIAL_NOT_FOUND",
				error_message: "凭据不存在，请重新配置",
			}).eq("id", runId);
			await supabase.from("checkin_targets").update({ requires_reauth: true }).eq("id", targetId);
			return { success: false, message: "凭据不存在", runId, requiresReauth: true };
		}

		try {
			let encryptedBytes: Uint8Array;
			const raw = secretRow.encrypted_data;
			if (typeof raw === "string") {
				const hex = raw.startsWith("\\x") ? raw.substring(2) : raw;
				const bytes = new Uint8Array(hex.length / 2);
				for (let i = 0; i < hex.length; i += 2) {
					bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
				}
				encryptedBytes = bytes;
			} else {
				encryptedBytes = new Uint8Array(raw);
			}
			const blob = deserializeEncryptedBlob(encryptedBytes);
			const plaintext = await decryptCredentials(blob);
			credentials = JSON.parse(plaintext);
		} catch (decryptErr) {
			console.error("Decrypt error:", decryptErr);
			await supabase.from("checkin_runs").update({
				status: "failed",
				finished_at: new Date().toISOString(),
				error_code: "DECRYPT_FAILED",
				error_message: "凭据解密失败",
			}).eq("id", runId);
			return { success: false, message: "凭据解密失败", runId };
		}
	}

	const startTime = Date.now();
	const result = await executeCheckin(target.service_key, {
		credentials,
		publicConfig: target.public_config || {},
		targetId: target.id,
		userId: target.user_id,
		attempt: attempt,
		scheduledFor: scheduledFor,
	});
	const durationMs = Date.now() - startTime;
	const finishedAt = new Date().toISOString();

	if (result.success) {
		await supabase.from("checkin_runs").update({
			status: "success",
			finished_at: finishedAt,
			duration_ms: durationMs,
			result_summary: result.summary,
			response_excerpt: result.sanitizedResponse ? result.sanitizedResponse.substring(0, 500) : null,
		}).eq("id", runId);

		const lastSuccessAt = finishedAt;
		let consecutiveDays = 0;
		const { data: prevTarget } = await supabase
			.from("checkin_targets")
			.select("last_success_at, consecutive_success_days")
			.eq("id", targetId)
			.single();

		if (prevTarget && prevTarget.last_success_at) {
			const lastDate = new Date(prevTarget.last_success_at);
			const today = new Date(finishedAt);
			const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
			const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			const diffDays = Math.round((todayDay.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24));
			if (diffDays === 0) {
				consecutiveDays = prevTarget.consecutive_success_days || 0;
			} else if (diffDays === 1) {
				consecutiveDays = (prevTarget.consecutive_success_days || 0) + 1;
			} else {
				consecutiveDays = 1;
			}
		} else {
			consecutiveDays = 1;
		}

		await supabase.from("checkin_targets").update({
			last_status: "success",
			last_run_at: finishedAt,
			last_success_at: lastSuccessAt,
			last_error_code: null,
			last_error_message: null,
			consecutive_success_days: consecutiveDays,
			requires_reauth: false,
		}).eq("id", targetId);

		if (updateSchedule && scheduleId) {
			try {
				await supabase.rpc("pulse_complete_schedule", {
					p_schedule_id: scheduleId,
					p_status: "success",
					p_retry_after_minutes: null
				});
			} catch (e) {
				console.warn("Complete schedule error:", e);
			}
		}

		return { success: true, message: result.summary, runId };
	} else {
		const isAuthError = result.requiresReauth ||
			result.errorCode === "UNAUTHORIZED" ||
			result.errorCode === "INVALID_CREDENTIALS" ||
			result.errorCode === "LOGIN_REQUIRED" ||
			(result.errorMessage && (
				result.errorMessage.includes("cookie") ||
				result.errorMessage.includes("token") && result.errorMessage.includes("expired") ||
				result.errorMessage.includes("登录") ||
				result.errorMessage.includes("授权失效")
			));

		await supabase.from("checkin_runs").update({
			status: "failed",
			finished_at: finishedAt,
			duration_ms: durationMs,
			result_summary: result.summary,
			error_code: result.errorCode || "CHECKIN_FAILED",
			error_message: (result.errorMessage || result.summary).substring(0, 500),
			response_excerpt: result.sanitizedResponse ? result.sanitizedResponse.substring(0, 500) : null,
		}).eq("id", runId);

		await supabase.from("checkin_targets").update({
			last_status: "failed",
			last_run_at: finishedAt,
			last_error_code: result.errorCode || "CHECKIN_FAILED",
			last_error_message: (result.errorMessage || result.summary).substring(0, 200),
			requires_reauth: isAuthError,
		}).eq("id", targetId);

		if (updateSchedule && scheduleId) {
			try {
				let retryAfter: number | null = null;
				if (result.retryable && !isAuthError && retryIntervalMinutes) {
					retryAfter = retryIntervalMinutes;
				}
				await supabase.rpc("pulse_complete_schedule", {
					p_schedule_id: scheduleId,
					p_status: isAuthError ? "auth_failed" : "failed",
					p_retry_after_minutes: retryAfter
				});
			} catch (e) {
				console.warn("Complete schedule error:", e);
			}
		}

		return {
			success: false,
			message: result.summary,
			runId,
			retryable: result.retryable,
			requiresReauth: isAuthError,
			errorCode: result.errorCode,
		};
	}
}