import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors, errorResponse, successResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

serve(async (req: Request) => {
	const corsRes = handleCors(req);
	if (corsRes) return corsRes;

	if (req.method !== "DELETE" && req.method !== "POST") {
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
		body = {};
	}

	const targetId = body.target_id || body.id;
	if (!targetId) {
		return errorResponse("缺少目标ID", 400);
	}

	const supabase = getServiceClient();

	try {
		const { data: existing, error: fetchErr } = await supabase
			.from("checkin_targets")
			.select("id, user_id")
			.eq("id", targetId)
			.eq("user_id", user.id)
			.single();

		if (fetchErr || !existing) {
			return errorResponse("签到项目不存在或无权操作", 404);
		}

		const { error: deleteRunsErr } = await supabase
			.from("checkin_runs")
			.delete()
			.eq("target_id", targetId)
			.eq("user_id", user.id);

		if (deleteRunsErr) {
			console.warn("Delete runs warning:", deleteRunsErr);
		}

		const { error: deleteScheduleErr } = await supabase
			.from("checkin_schedules")
			.delete()
			.eq("target_id", targetId)
			.eq("user_id", user.id);

		if (deleteScheduleErr) {
			console.warn("Delete schedule warning:", deleteScheduleErr);
		}

		const { error: deleteSecretErr } = await supabase
			.from("checkin_secrets")
			.delete()
			.eq("target_id", targetId)
			.eq("user_id", user.id);

		if (deleteSecretErr) {
			console.warn("Delete secret warning:", deleteSecretErr);
		}

		const { error: deleteTargetErr } = await supabase
			.from("checkin_targets")
			.delete()
			.eq("id", targetId)
			.eq("user_id", user.id);

		if (deleteTargetErr) {
			console.error("Delete target error:", deleteTargetErr);
			return errorResponse("删除失败", 500);
		}

		return successResponse({ deleted: true });
	} catch (err: unknown) {
		console.error("Delete target exception:", err);
		return errorResponse("服务器内部错误", 500);
	}
});
