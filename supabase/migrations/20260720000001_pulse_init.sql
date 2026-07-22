-- Pulse Auto Check-in System - Initial Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- 签到目标表
-- ============================================
CREATE TABLE IF NOT EXISTS public.checkin_targets (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	service_key TEXT NOT NULL,
	display_name TEXT NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT true,
	credential_secret_id UUID,
	public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
	last_status TEXT,
	last_run_at TIMESTAMPTZ,
	last_success_at TIMESTAMPTZ,
	last_error_code TEXT,
	last_error_message TEXT,
	consecutive_success_days INTEGER NOT NULL DEFAULT 0,
	requires_reauth BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 签到计划表
-- ============================================
CREATE TABLE IF NOT EXISTS public.checkin_schedules (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	target_id UUID NOT NULL REFERENCES public.checkin_targets(id) ON DELETE CASCADE,
	enabled BOOLEAN NOT NULL DEFAULT true,
	timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
	local_time TIME NOT NULL DEFAULT '08:00',
	days_of_week SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
	retry_count SMALLINT NOT NULL DEFAULT 2,
	retry_interval_minutes SMALLINT NOT NULL DEFAULT 5,
	random_delay_seconds INTEGER NOT NULL DEFAULT 0,
	next_run_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 加密凭据表（仅 service role 可访问）
-- ============================================
CREATE TABLE IF NOT EXISTS public.checkin_secrets (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	target_id UUID NOT NULL REFERENCES public.checkin_targets(id) ON DELETE CASCADE,
	encrypted_data BYTEA NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 签到执行记录表
-- ============================================
CREATE TABLE IF NOT EXISTS public.checkin_runs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	target_id UUID NOT NULL REFERENCES public.checkin_targets(id) ON DELETE CASCADE,
	schedule_id UUID REFERENCES public.checkin_schedules(id) ON DELETE SET NULL,
	trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual', 'retry')),
	scheduled_for TIMESTAMPTZ,
	started_at TIMESTAMPTZ,
	finished_at TIMESTAMPTZ,
	status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'skipped', 'retrying')),
	attempt SMALLINT NOT NULL DEFAULT 1,
	duration_ms INTEGER,
	result_summary TEXT,
	error_code TEXT,
	error_message TEXT,
	response_excerpt TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_checkin_targets_user_id ON public.checkin_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_targets_enabled ON public.checkin_targets(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_checkin_schedules_user_id ON public.checkin_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_schedules_target_id ON public.checkin_schedules(target_id);
CREATE INDEX IF NOT EXISTS idx_checkin_schedules_next_run ON public.checkin_schedules(next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_checkin_runs_user_id ON public.checkin_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_runs_target_id ON public.checkin_runs(target_id);
CREATE INDEX IF NOT EXISTS idx_checkin_runs_status ON public.checkin_runs(status);
CREATE INDEX IF NOT EXISTS idx_checkin_runs_created_at ON public.checkin_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkin_secrets_user_id ON public.checkin_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_secrets_target_id ON public.checkin_secrets(target_id);

-- ============================================
-- 唯一约束：防止同一目标同一时间重复执行
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_runs_unique_scheduled
	ON public.checkin_runs(target_id, scheduled_for)
	WHERE scheduled_for IS NOT NULL AND trigger_type = 'scheduled';

-- ============================================
-- RLS - 启用行级安全
-- ============================================
ALTER TABLE public.checkin_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_secrets ENABLE ROW LEVEL SECURITY;

-- checkin_targets: 用户只能看/改自己的
DROP POLICY IF EXISTS "Users can view own targets" ON public.checkin_targets;
CREATE POLICY "Users can view own targets"
	ON public.checkin_targets FOR SELECT
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own targets" ON public.checkin_targets;
CREATE POLICY "Users can insert own targets"
	ON public.checkin_targets FOR INSERT
	WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own targets" ON public.checkin_targets;
CREATE POLICY "Users can update own targets"
	ON public.checkin_targets FOR UPDATE
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own targets" ON public.checkin_targets;
CREATE POLICY "Users can delete own targets"
	ON public.checkin_targets FOR DELETE
	USING (auth.uid() = user_id);

-- checkin_schedules: 用户只能看/改自己的
DROP POLICY IF EXISTS "Users can view own schedules" ON public.checkin_schedules;
CREATE POLICY "Users can view own schedules"
	ON public.checkin_schedules FOR SELECT
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own schedules" ON public.checkin_schedules;
CREATE POLICY "Users can insert own schedules"
	ON public.checkin_schedules FOR INSERT
	WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own schedules" ON public.checkin_schedules;
CREATE POLICY "Users can update own schedules"
	ON public.checkin_schedules FOR UPDATE
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own schedules" ON public.checkin_schedules;
CREATE POLICY "Users can delete own schedules"
	ON public.checkin_schedules FOR DELETE
	USING (auth.uid() = user_id);

-- checkin_runs: 用户只能看自己的，不能通过客户端直接修改执行记录
DROP POLICY IF EXISTS "Users can view own runs" ON public.checkin_runs;
CREATE POLICY "Users can view own runs"
	ON public.checkin_runs FOR SELECT
	USING (auth.uid() = user_id);

-- checkin_secrets: 完全禁止前端直接访问（仅 Edge Function service role 可访问）
DROP POLICY IF EXISTS "No direct access to secrets" ON public.checkin_secrets;
CREATE POLICY "No direct access to secrets"
	ON public.checkin_secrets FOR ALL
	USING (false)
	WITH CHECK (false);

-- ============================================
-- 自动更新 updated_at 的触发器函数
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_checkin_targets_updated ON public.checkin_targets;
CREATE TRIGGER trg_checkin_targets_updated
	BEFORE UPDATE ON public.checkin_targets
	FOR EACH ROW EXECUTE FUNCTION public.pulse_set_updated_at();

DROP TRIGGER IF EXISTS trg_checkin_schedules_updated ON public.checkin_schedules;
CREATE TRIGGER trg_checkin_schedules_updated
	BEFORE UPDATE ON public.checkin_schedules
	FOR EACH ROW EXECUTE FUNCTION public.pulse_set_updated_at();

DROP TRIGGER IF EXISTS trg_checkin_secrets_updated ON public.checkin_secrets;
CREATE TRIGGER trg_checkin_secrets_updated
	BEFORE UPDATE ON public.checkin_secrets
	FOR EACH ROW EXECUTE FUNCTION public.pulse_set_updated_at();

-- ============================================
-- RPC: 计算下次运行时间
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_calculate_next_run(
	p_local_time TIME,
	p_timezone TEXT,
	p_days_of_week SMALLINT[],
	p_from_date DATE DEFAULT NULL
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
	v_base_date DATE;
	v_check_date DATE;
	v_dow SMALLINT;
	v_offset_days INTEGER := 0;
	v_local_timestamp TIMESTAMP;
BEGIN
	v_base_date := COALESCE(p_from_date, (now() AT TIME ZONE p_timezone)::DATE);

	FOR i IN 0..7 LOOP
		v_check_date := v_base_date + i;
		v_dow := EXTRACT(DOW FROM v_check_date)::SMALLINT;
		IF v_dow = ANY(p_days_of_week) THEN
			v_offset_days := i;
			EXIT;
		END IF;
	END LOOP;

	v_local_timestamp := (v_base_date + v_offset_days)::TIMESTAMP + p_local_time;
	RETURN (v_local_timestamp AT TIME ZONE p_timezone) AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER;

-- ============================================
-- RPC: 初始化新计划的 next_run_at
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_init_schedule_next_run()
RETURNS TRIGGER AS $$
BEGIN
	IF NEW.next_run_at IS NULL THEN
		NEW.next_run_at := public.pulse_calculate_next_run(
			NEW.local_time,
			NEW.timezone,
			NEW.days_of_week,
			(now() AT TIME ZONE NEW.timezone)::DATE
		);
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pulse_init_schedule ON public.checkin_schedules;
CREATE TRIGGER trg_pulse_init_schedule
	BEFORE INSERT ON public.checkin_schedules
	FOR EACH ROW EXECUTE FUNCTION public.pulse_init_schedule_next_run();

-- 为现有schedule更新next_run_at的触发器（update时）
CREATE OR REPLACE FUNCTION public.pulse_update_schedule_next_run()
RETURNS TRIGGER AS $$
BEGIN
	IF NEW.local_time <> OLD.local_time 
		OR NEW.timezone <> OLD.timezone 
		OR NEW.days_of_week <> OLD.days_of_week
		OR NEW.enabled <> OLD.enabled THEN
		IF NEW.enabled THEN
			NEW.next_run_at := public.pulse_calculate_next_run(
				NEW.local_time,
				NEW.timezone,
				NEW.days_of_week,
				(now() AT TIME ZONE NEW.timezone)::DATE
			);
		ELSE
			NEW.next_run_at := NULL;
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pulse_update_schedule ON public.checkin_schedules;
CREATE TRIGGER trg_pulse_update_schedule
	BEFORE UPDATE ON public.checkin_schedules
	FOR EACH ROW EXECUTE FUNCTION public.pulse_update_schedule_next_run();

-- ============================================
-- RPC: 原子领取待执行任务（供调度器使用，service role 调用）
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_claim_due_tasks(batch_size INTEGER DEFAULT 5)
RETURNS TABLE (
	schedule_id UUID,
	target_id UUID,
	user_id UUID,
	service_key TEXT,
	display_name TEXT,
	locale_time TIME,
	tz TEXT,
	retry_count SMALLINT,
	retry_interval_minutes SMALLINT,
	random_delay_seconds INTEGER,
	day_of_week SMALLINT
) AS $$
DECLARE
BEGIN
	CREATE TEMP TABLE _claimed_tasks ON COMMIT DROP AS
	WITH due_schedules AS (
		SELECT
			s.id AS sched_id,
			s.target_id AS tgt_id,
			t.user_id AS uid,
			t.service_key AS svc_key,
			t.display_name AS dn,
			s.local_time AS lt,
			s.timezone AS tz_name,
			s.retry_count AS rc,
			s.retry_interval_minutes AS rim,
			s.random_delay_seconds AS rds,
			EXTRACT(DOW FROM (now() AT TIME ZONE s.timezone))::SMALLINT AS dow
		FROM public.checkin_schedules s
		JOIN public.checkin_targets t ON t.id = s.target_id
		WHERE s.enabled = true
			AND t.enabled = true
			AND t.requires_reauth = false
			AND s.next_run_at IS NOT NULL
			AND s.next_run_at <= now()
		ORDER BY s.next_run_at ASC
		LIMIT batch_size
		FOR UPDATE SKIP LOCKED
	)
	SELECT * FROM due_schedules;

	RETURN QUERY
	SELECT
		ct.sched_id,
		ct.tgt_id,
		ct.uid,
		ct.svc_key,
		ct.dn,
		ct.lt,
		ct.tz_name,
		ct.rc,
		ct.rim,
		ct.rds,
		ct.dow
	FROM _claimed_tasks ct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: 任务完成后更新下次运行时间
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_complete_schedule(
	p_schedule_id UUID,
	p_status TEXT,
	p_retry_after_minutes INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
	v_schedule RECORD;
BEGIN
	SELECT s.*, t.enabled AS target_enabled, t.requires_reauth
	INTO v_schedule
	FROM public.checkin_schedules s
	JOIN public.checkin_targets t ON t.id = s.target_id
	WHERE s.id = p_schedule_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RETURN;
	END IF;

	IF NOT v_schedule.enabled OR NOT v_schedule.target_enabled OR v_schedule.requires_reauth THEN
		RETURN;
	END IF;

	IF p_retry_after_minutes IS NOT NULL AND p_retry_after_minutes > 0 THEN
		UPDATE public.checkin_schedules
		SET next_run_at = now() + (p_retry_after_minutes || ' minutes')::INTERVAL
		WHERE id = p_schedule_id;
	ELSE
		UPDATE public.checkin_schedules
		SET next_run_at = public.pulse_calculate_next_run(
			local_time,
			timezone,
			days_of_week,
			((now() AT TIME ZONE timezone)::DATE + INTERVAL '1 day')::DATE
		)
		WHERE id = p_schedule_id;
	END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: 设置下次运行时间为指定延迟后（用于手动重试等）
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_schedule_retry(
	p_target_id UUID,
	p_delay_minutes INTEGER
)
RETURNS VOID AS $$
BEGIN
	UPDATE public.checkin_schedules
	SET next_run_at = now() + (p_delay_minutes || ' minutes')::INTERVAL
	WHERE target_id = p_target_id
		AND enabled = true
		AND user_id = (SELECT user_id FROM public.checkin_targets WHERE id = p_target_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: 获取用户今日统计（供前端 Dashboard 使用，自动获取当前用户）
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_get_today_stats()
RETURNS JSONB AS $$
DECLARE
	v_today_start TIMESTAMPTZ;
	v_today_end TIMESTAMPTZ;
	v_user_id UUID;
	v_result JSONB;
BEGIN
	v_user_id := auth.uid();
	IF v_user_id IS NULL THEN
		RETURN jsonb_build_object(
			'total', 0, 'success', 0, 'failed', 0, 'pending', 0,
			'requires_reauth', 0, 'total_targets', 0, 'active_targets', 0
		);
	END IF;

	v_today_start := date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
	v_today_end := v_today_start + INTERVAL '1 day';

	SELECT jsonb_build_object(
		'total', (
			SELECT COUNT(*) FROM public.checkin_runs
			WHERE user_id = v_user_id
				AND created_at >= v_today_start
				AND created_at < v_today_end
		),
		'success', (
			SELECT COUNT(*) FROM public.checkin_runs
			WHERE user_id = v_user_id
				AND created_at >= v_today_start
				AND created_at < v_today_end
				AND status = 'success'
		),
		'failed', (
			SELECT COUNT(*) FROM public.checkin_runs
			WHERE user_id = v_user_id
				AND created_at >= v_today_start
				AND created_at < v_today_end
				AND status = 'failed'
		),
		'pending', (
			SELECT COUNT(*) FROM public.checkin_schedules s
			JOIN public.checkin_targets t ON t.id = s.target_id
			WHERE s.user_id = v_user_id
				AND s.enabled = true
				AND t.enabled = true
		),
		'requires_reauth', (
			SELECT COUNT(*) FROM public.checkin_targets
			WHERE user_id = v_user_id
				AND requires_reauth = true
		),
		'total_targets', (
			SELECT COUNT(*) FROM public.checkin_targets
			WHERE user_id = v_user_id
		),
		'active_targets', (
			SELECT COUNT(*) FROM public.checkin_targets
			WHERE user_id = v_user_id AND enabled = true
		)
	) INTO v_result;

	RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.pulse_get_today_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pulse_calculate_next_run(TIME, TEXT, SMALLINT[], DATE) TO authenticated;

-- ============================================
-- Realtime 发布（用于前端实时更新）
-- ============================================
DROP PUBLICATION IF EXISTS pulse_realtime;
CREATE PUBLICATION pulse_realtime FOR TABLE public.checkin_targets, public.checkin_runs, public.checkin_schedules;

-- 确保replica identity完整以便Realtime发送旧数据
ALTER TABLE public.checkin_targets REPLICA IDENTITY FULL;
ALTER TABLE public.checkin_runs REPLICA IDENTITY FULL;
ALTER TABLE public.checkin_schedules REPLICA IDENTITY FULL;