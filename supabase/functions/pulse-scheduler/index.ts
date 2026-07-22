import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { performCheckin } from "../_shared/perform-checkin.ts";

function secureEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);

	if (leftBytes.length !== rightBytes.length) {
		return false;
	}

	let difference = 0;

	for (let index = 0; index < leftBytes.length; index++) {
		difference |= leftBytes[index] ^ rightBytes[index];
	}

	return difference === 0;
}

const MAX_CONCURRENT = 3;
const BATCH_SIZE = 5;

interface ScheduledTask {
	schedule_id: string;
	target_id: string;
	user_id: string;
	service_key: string;
	display_name: string;
	locale_time: string;
	tz: string;
	retry_count: number;
	retry_interval_minutes: number;
	random_delay_seconds: number;
	day_of_week: number;
}

async function runSingleTask(supabase: any, task: ScheduledTask) {
	if (task.random_delay_seconds > 0) {
		const delay = Math.floor(Math.random() * task.random_delay_seconds * 1000);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	const { data: target, error: targetErr } = await supabase
		.from("checkin_targets")
		.select("id, enabled, requires_reauth")
		.eq("id", task.target_id)
		.eq("user_id", task.user_id)
		.single();

	if (targetErr || !target || !target.enabled) {
		console.log("[Scheduler] Target disabled or not found, skipping");
		try {
			await supabase.rpc("pulse_complete_schedule", {
				p_schedule_id: task.schedule_id,
				p_status: "skipped",
				p_retry_after_minutes: null
			});
		} catch {}
		return;
	}

	if (target.requires_reauth) {
		console.log("[Scheduler] Target requires reauth, skipping");
		try {
			await supabase.rpc("pulse_complete_schedule", {
				p_schedule_id: task.schedule_id,
				p_status: "auth_required",
				p_retry_after_minutes: null
			});
		} catch {}
		return;
	}

	const result = await performCheckin(
		supabase,
		task.target_id,
		task.user_id,
		"scheduled",
		1,
		undefined,
		task.schedule_id,
		new Date().toISOString(),
		true,
		task.retry_interval_minutes
	);

	if (result.success) {
		console.log(`[Scheduler] Task ${task.target_id} succeeded`);
	} else {
		console.log(`[Scheduler] Task ${task.target_id} failed: ${result.message} (retryable=${result.retryable})`);
	}
}

async function runBatchWithConcurrency(supabase: any, tasks: ScheduledTask[], concurrency: number) {
	let index = 0;
	async function worker() {
		while (index < tasks.length) {
			const taskIndex = index++;
			const task = tasks[taskIndex];
			try {
				await runSingleTask(supabase, task);
			} catch (err) {
				console.error("[Scheduler] Task error:", task.target_id, err);
				try {
					await supabase.rpc("pulse_complete_schedule", {
						p_schedule_id: task.schedule_id,
						p_status: "error",
						p_retry_after_minutes: null
					});
				} catch {}
			}
		}
	}

	const workers: Promise<void>[] = [];
	for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
		workers.push(worker());
	}
	await Promise.allSettled(workers);
}

serve(async (req: Request) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	const expectedSecret = (
		Deno.env.get("PULSE_CRON_SECRET") ?? ""
	).trim();

	const providedSecret = (
		req.headers.get("x-pulse-cron-secret") ?? ""
	).trim();

	const authorized =
		expectedSecret.length > 0 &&
		secureEqual(providedSecret, expectedSecret);

	if (!authorized) {
		return new Response(
			JSON.stringify({
				success: false,
				message: "未授权",
				version: "pulse-scheduler-auth-v2",
			}),
			{
				status: 401,
				headers: {
					...corsHeaders,
					"Content-Type": "application/json",
				},
			},
		);
	}

	// 只有完成专用密钥验证后，才创建管理员客户端。
	const supabase = getServiceClient();

	try {
		const { data: tasks, error: claimErr } = await supabase.rpc("pulse_claim_due_tasks", {
			batch_size: BATCH_SIZE,
		});

		if (claimErr) {
			console.error("[Scheduler] Claim tasks error:", claimErr);
			return new Response(JSON.stringify({ success: false, message: "领取任务失败" }), {
				status: 500,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}

		const taskList = (tasks || []) as ScheduledTask[];

		if (taskList.length > 0) {
			console.log(`[Scheduler] Claimed ${taskList.length} tasks, executing with concurrency ${MAX_CONCURRENT}`);
			await runBatchWithConcurrency(supabase, taskList, MAX_CONCURRENT);
		}

		return new Response(JSON.stringify({
			success: true,
			processed: taskList.length,
			timestamp: new Date().toISOString(),
			version: "pulse-scheduler-auth-v2",
		}), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch (err: unknown) {
		console.error("[Scheduler] Fatal error:", err);
		return new Response(JSON.stringify({ success: false, message: "调度器异常" }), {
			status: 500,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}
});