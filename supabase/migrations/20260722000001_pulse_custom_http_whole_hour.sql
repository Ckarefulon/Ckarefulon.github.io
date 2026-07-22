-- Pulse 第二轮迁移：自定义 HTTP 签到 + 整点签到时间

-- ============================================
-- 1. 允许执行记录 trigger_type 为 test（测试配置）
-- ============================================
ALTER TABLE public.checkin_runs
	DROP CONSTRAINT IF EXISTS checkin_runs_trigger_type_check;

ALTER TABLE public.checkin_runs
	ADD CONSTRAINT checkin_runs_trigger_type_check
	CHECK (trigger_type IN ('scheduled', 'manual', 'retry', 'test'));


-- ============================================
-- 2. 更新 next_run_at 计算函数：规范化时间为整点
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
	v_whole_hour TIME;
	v_local_timestamp TIMESTAMP;
BEGIN
	-- 规范化为整点
	v_whole_hour := make_time(EXTRACT(HOUR FROM p_local_time)::INT, 0, 0);
	v_base_date := COALESCE(p_from_date, (now() AT TIME ZONE p_timezone)::DATE);

	FOR i IN 0..7 LOOP
		v_check_date := v_base_date + i;
		v_dow := EXTRACT(DOW FROM v_check_date)::SMALLINT;
		IF v_dow = ANY(p_days_of_week) THEN
			v_offset_days := i;
			EXIT;
		END IF;
	END LOOP;

	v_local_timestamp := (v_base_date + v_offset_days)::TIMESTAMP + v_whole_hour;
	RETURN (v_local_timestamp AT TIME ZONE p_timezone) AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER;

-- ============================================
-- 3. 更新触发器：在写入前强制把 local_time 规范化为整点
-- ============================================
CREATE OR REPLACE FUNCTION public.pulse_normalize_local_time()
RETURNS TRIGGER AS $$
BEGIN
	NEW.local_time := make_time(EXTRACT(HOUR FROM NEW.local_time)::INT, 0, 0);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pulse_normalize_local_time ON public.checkin_schedules;
CREATE TRIGGER trg_pulse_normalize_local_time
	BEFORE INSERT OR UPDATE OF local_time ON public.checkin_schedules
	FOR EACH ROW EXECUTE FUNCTION public.pulse_normalize_local_time();

-- ============================================
-- 4. 迁移现有非整点计划到下一个整点
-- ============================================
DO $$
DECLARE
	rec RECORD;
	v_new_time TIME;
	v_new_next_run TIMESTAMPTZ;
BEGIN
	FOR rec IN
		SELECT id, user_id, local_time, timezone, days_of_week
		FROM public.checkin_schedules
		WHERE EXTRACT(MINUTE FROM local_time) <> 0
		   OR EXTRACT(SECOND FROM local_time) <> 0
	LOOP
		-- 下一个整点：如果当前分钟>0 则进位到下一小时
		v_new_time := make_time(
			(EXTRACT(HOUR FROM rec.local_time)::INT + CASE WHEN EXTRACT(MINUTE FROM rec.local_time) > 0 OR EXTRACT(SECOND FROM rec.local_time) > 0 THEN 1 ELSE 0 END) % 24,
			0,
			0
		);

		UPDATE public.checkin_schedules
		SET local_time = v_new_time,
		    next_run_at = public.pulse_calculate_next_run(
				v_new_time,
				rec.timezone,
				rec.days_of_week,
				((now() AT TIME ZONE rec.timezone)::DATE + INTERVAL '1 day')::DATE
			),
		    updated_at = now()
		WHERE id = rec.id;
	END LOOP;
END $$;

-- ============================================
-- 5. 强制 local_time 只能为整点（分钟与秒均为 0）
-- ============================================
ALTER TABLE public.checkin_schedules
	DROP CONSTRAINT IF EXISTS check_local_time_whole_hour;

ALTER TABLE public.checkin_schedules
	ADD CONSTRAINT check_local_time_whole_hour
	CHECK (
		EXTRACT(MINUTE FROM local_time) = 0
		AND EXTRACT(SECOND FROM local_time) = 0
	);

-- ============================================
-- 6. 新增自定义 HTTP 配置表（只保存非敏感元数据）
-- ============================================
CREATE TABLE IF NOT EXISTS public.checkin_custom_http_configs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	target_id UUID NOT NULL REFERENCES public.checkin_targets(id) ON DELETE CASCADE,
	url TEXT NOT NULL,
	method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
	body_type TEXT NOT NULL CHECK (body_type IN ('none', 'json', 'form')),
	query_params JSONB NOT NULL DEFAULT '[]'::jsonb,
	headers JSONB NOT NULL DEFAULT '[]'::jsonb,
	body_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
	success_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
	already_checked_in_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
	auth_failure_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checkin_custom_http_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own custom http configs" ON public.checkin_custom_http_configs;
CREATE POLICY "Users can view own custom http configs"
	ON public.checkin_custom_http_configs FOR SELECT
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own custom http configs" ON public.checkin_custom_http_configs;
CREATE POLICY "Users can insert own custom http configs"
	ON public.checkin_custom_http_configs FOR INSERT
	WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own custom http configs" ON public.checkin_custom_http_configs;
CREATE POLICY "Users can update own custom http configs"
	ON public.checkin_custom_http_configs FOR UPDATE
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own custom http configs" ON public.checkin_custom_http_configs;
CREATE POLICY "Users can delete own custom http configs"
	ON public.checkin_custom_http_configs FOR DELETE
	USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_checkin_custom_http_configs_updated ON public.checkin_custom_http_configs;
CREATE TRIGGER trg_checkin_custom_http_configs_updated
	BEFORE UPDATE ON public.checkin_custom_http_configs
	FOR EACH ROW EXECUTE FUNCTION public.pulse_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_custom_http_configs_target_id
	ON public.checkin_custom_http_configs(target_id);

-- ============================================
-- 7. 自定义 HTTP 配置表权限
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkin_custom_http_configs TO authenticated;
GRANT SELECT ON public.checkin_custom_http_configs TO service_role;
