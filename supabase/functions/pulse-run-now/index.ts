import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors, errorResponse, successResponse, jsonResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";
import { performCheckin } from "../_shared/perform-checkin.ts";

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

	const targetId = body.target_id;
	if (!targetId) {
		return errorResponse("缺少目标ID", 400);
	}

	const triggerType = body.trigger_type === "test" ? "test" : "manual";
	const isTest = triggerType === "test";
	const customHttpConfig = isTest ? body.custom_http_config : undefined;

	const supabase = getServiceClient();

	// 1 分钟冷却：对同一目标的 manual/test 触发分别限制
	const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
	const { data: recentRun } = await supabase
		.from("checkin_runs")
		.select("id, status, created_at")
		.eq("target_id", targetId)
		.eq("user_id", user.id)
		.eq("trigger_type", triggerType)
		.gte("created_at", oneMinuteAgo)
		.in("status", ["queued", "running"])
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (recentRun) {
		return errorResponse("请稍候再试，该项目刚刚被触发过", 429, "COOLDOWN");
	}

	// 普通手动签到额外检查一分钟内是否有任意 manual 运行（执行完成后也防连点）
	if (!isTest) {
		const { data: recentAnyManual } = await supabase
			.from("checkin_runs")
			.select("id, status, created_at")
			.eq("target_id", targetId)
			.eq("user_id", user.id)
			.eq("trigger_type", "manual")
			.gte("created_at", oneMinuteAgo)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (recentAnyManual) {
			return errorResponse("请稍候再试，一分钟内已触发过手动签到", 429, "COOLDOWN");
		}
	}

	try {
		const result = await performCheckin(
			supabase,
			targetId,
			user.id,
			triggerType,
			1,
			undefined,
			undefined,
			undefined,
			false,
			undefined,
			customHttpConfig
		);
		if (result.success) {
			return successResponse({ run_id: result.runId, message: result.message });
		} else {
			return jsonResponse({
				success: false,
				message: result.message,
				run_id: result.runId,
				requires_reauth: result.requiresReauth,
			}, 200);
		}
	} catch (err: unknown) {
		console.error("Run now exception:", err);
		return errorResponse("执行签到时出错", 500);
	}
});
