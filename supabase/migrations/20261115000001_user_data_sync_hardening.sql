-- ============================================================
-- user_data 同步加固：乐观并发（rev）+ 服务端自动历史 + 合并式 RPC
--
-- 解决的问题：
--   1) 现状所有站点都是 upsert(onConflict: 'user_id,site_scope') 整份盲写，
--      没有版本号 ⇒ 两个标签页/两台设备同时写，后写者赢，先写者整份消失且无历史。
--   2) updated_at 由客户端赋值 ⇒ 设备时钟不准就写出错误时间，且无法反映真实先后。
--   3) 云端没有任何历史版本 ⇒ 一旦被覆盖不可恢复。
--
-- 设计要点：
--   · rev 由服务端触发器自增，客户端永远不写 rev。
--   · updated_at 由服务端强制 now()，客户端传什么都盖掉。
--   · 任何写入路径（包括尚未改造的旧前端直连 upsert）都会自动进历史表。
--   · user_data_save 提供 CAS 语义：expected_rev 不符 ⇒ 直接返回 conflict + 云端现状，
--     由客户端合并后重试，绝不静默覆盖。
--
-- 幂等：全部 IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1. user_data 基础表（已存在则不动，只补列）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_data (
	user_id    UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	site_scope TEXT    NOT NULL,
	data       JSONB   NOT NULL DEFAULT '{}'::jsonb,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_data ADD COLUMN IF NOT EXISTS rev         BIGINT      NOT NULL DEFAULT 1;
ALTER TABLE public.user_data ADD COLUMN IF NOT EXISTS device_id   TEXT;
ALTER TABLE public.user_data ADD COLUMN IF NOT EXISTS data_hash   TEXT;
ALTER TABLE public.user_data ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- 唯一键自愈：旧代码的 onConflict:'user_id,site_scope' 以及下面的 RPC 都依赖它。
-- 只有当库里确实不存在等价的唯一索引时才创建，避免重复建冗余索引。
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_index i
		WHERE i.indrelid = 'public.user_data'::regclass
		  AND i.indisunique
		  AND i.indnkeyatts = 2
		  AND (
			SELECT array_agg(a.attname ORDER BY a.attname)
			FROM pg_attribute a
			WHERE a.attrelid = 'public.user_data'::regclass
			  AND a.attnum = ANY (i.indkey)
		  ) = ARRAY['site_scope', 'user_id']::name[]
	) THEN
		CREATE UNIQUE INDEX user_data_user_scope_key
			ON public.user_data (user_id, site_scope);
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_data_user_updated
	ON public.user_data (user_id, updated_at DESC);

-- ------------------------------------------------------------
-- 2. 历史快照表：每次内容真正变化时留一份，按 hash 去重
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_data_history (
	id         BIGSERIAL   PRIMARY KEY,
	user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	site_scope TEXT        NOT NULL,
	rev        BIGINT      NOT NULL,
	data       JSONB       NOT NULL,
	data_hash  TEXT        NOT NULL,
	bytes      INTEGER     NOT NULL DEFAULT 0,
	device_id  TEXT,
	reason     TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_data_history_lookup
	ON public.user_data_history (user_id, site_scope, id DESC);

-- ------------------------------------------------------------
-- 3. BEFORE 写入触发器：服务端管理 rev / updated_at / data_hash
--    这一段是「旧前端也受益」的关键 —— 它们什么都不改也会拿到版本号和历史
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_data_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
	-- 服务端时间为准，客户端传来的 updated_at 一律覆盖（设备时钟不可信）
	NEW.updated_at := now();

	IF TG_OP = 'INSERT' THEN
		NEW.rev        := 1;
		NEW.created_at := COALESCE(NEW.created_at, now());
	ELSE
		NEW.rev        := COALESCE(OLD.rev, 0) + 1;
		NEW.created_at := COALESCE(OLD.created_at, now());
	END IF;

	NEW.data_hash := md5(COALESCE(NEW.data::text, ''));
	RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_user_data_before_write ON public.user_data;
CREATE TRIGGER trg_user_data_before_write
	BEFORE INSERT OR UPDATE ON public.user_data
	FOR EACH ROW EXECUTE FUNCTION public.user_data_before_write();

-- ------------------------------------------------------------
-- 4. AFTER 写入触发器：自动留历史（SECURITY DEFINER 才能绕过 history 的只读 RLS）
--    保留策略：单份超过 2MB 的只留 4 份，其余留 12 份 —— 防止免费额度被历史撑爆
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_data_after_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	v_keep      INTEGER;
	v_last_hash TEXT;
	v_bytes     INTEGER;
BEGIN
	IF NEW.data IS NULL OR NEW.data = 'null'::jsonb THEN
		RETURN NEW;
	END IF;

	v_bytes := octet_length(NEW.data::text);

	-- 内容没变（例如只刷新了时间戳）不重复记历史
	SELECT h.data_hash INTO v_last_hash
	FROM public.user_data_history h
	WHERE h.user_id = NEW.user_id AND h.site_scope = NEW.site_scope
	ORDER BY h.id DESC
	LIMIT 1;

	IF v_last_hash IS NOT DISTINCT FROM NEW.data_hash THEN
		RETURN NEW;
	END IF;

	INSERT INTO public.user_data_history
		(user_id, site_scope, rev, data, data_hash, bytes, device_id, reason)
	VALUES
		(NEW.user_id, NEW.site_scope, NEW.rev, NEW.data, NEW.data_hash, v_bytes,
		 NEW.device_id, NULLIF(current_setting('app.sync_reason', true), ''));

	v_keep := CASE WHEN v_bytes > 2097152 THEN 4 ELSE 12 END;

	DELETE FROM public.user_data_history h
	WHERE h.user_id = NEW.user_id
	  AND h.site_scope = NEW.site_scope
	  AND h.id NOT IN (
		SELECT k.id
		FROM public.user_data_history k
		WHERE k.user_id = NEW.user_id AND k.site_scope = NEW.site_scope
		ORDER BY k.id DESC
		LIMIT v_keep
	  );

	RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_user_data_after_write ON public.user_data;
CREATE TRIGGER trg_user_data_after_write
	AFTER INSERT OR UPDATE ON public.user_data
	FOR EACH ROW EXECUTE FUNCTION public.user_data_after_write();

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------
ALTER TABLE public.user_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_data_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_data_select_own" ON public.user_data;
CREATE POLICY "user_data_select_own"
	ON public.user_data FOR SELECT
	TO authenticated
	USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_data_insert_own" ON public.user_data;
CREATE POLICY "user_data_insert_own"
	ON public.user_data FOR INSERT
	TO authenticated
	WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_data_update_own" ON public.user_data;
CREATE POLICY "user_data_update_own"
	ON public.user_data FOR UPDATE
	TO authenticated
	USING (auth.uid() = user_id)
	WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_data_delete_own" ON public.user_data;
CREATE POLICY "user_data_delete_own"
	ON public.user_data FOR DELETE
	TO authenticated
	USING (auth.uid() = user_id);

-- 历史表：用户只读，写入只允许上面的 SECURITY DEFINER 触发器
DROP POLICY IF EXISTS "user_data_history_select_own" ON public.user_data_history;
CREATE POLICY "user_data_history_select_own"
	ON public.user_data_history FOR SELECT
	TO authenticated
	USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.user_data_history FROM anon, authenticated;
GRANT  SELECT ON public.user_data_history TO authenticated;
GRANT  USAGE ON SEQUENCE public.user_data_history_id_seq TO authenticated;

-- ------------------------------------------------------------
-- 6. RPC：带 CAS 的保存
--    p_expected_rev = NULL  ⇒ 强制覆盖（手动上传 / 历史恢复），但会先留一份旧值历史
--    p_expected_rev = N     ⇒ 仅当云端 rev 仍是 N 时才写，否则返回 conflict + 云端现状
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_data_save(
	p_scope        TEXT,
	p_data         JSONB,
	p_expected_rev BIGINT DEFAULT NULL,
	p_device_id    TEXT   DEFAULT NULL,
	p_reason       TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
	v_uid UUID := auth.uid();
	v_row public.user_data%ROWTYPE;
BEGIN
	IF v_uid IS NULL THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
	END IF;
	IF p_scope IS NULL OR btrim(p_scope) = '' THEN
		RETURN jsonb_build_object('ok', false, 'error', 'missing_scope');
	END IF;
	IF p_data IS NULL THEN
		RETURN jsonb_build_object('ok', false, 'error', 'missing_data');
	END IF;

	IF p_reason IS NOT NULL AND p_reason <> '' THEN
		PERFORM set_config('app.sync_reason', p_reason, true);
	END IF;

	-- FOR UPDATE：同一 (user, scope) 的并发保存在这里串行化
	SELECT * INTO v_row
	FROM public.user_data
	WHERE user_id = v_uid AND site_scope = p_scope
	FOR UPDATE;

	IF FOUND THEN
		IF p_expected_rev IS NOT NULL AND v_row.rev <> p_expected_rev THEN
			RETURN jsonb_build_object(
				'ok',         false,
				'conflict',   true,
				'rev',        v_row.rev,
				'updated_at', v_row.updated_at,
				'device_id',  v_row.device_id,
				'data',       v_row.data
			);
		END IF;

		UPDATE public.user_data
		   SET data = p_data, device_id = p_device_id
		 WHERE user_id = v_uid AND site_scope = p_scope
		RETURNING * INTO v_row;
	ELSE
		-- 云端还没有这一行，但客户端以为有 ⇒ 说明别处删了，按冲突处理让上层重新合并
		IF p_expected_rev IS NOT NULL AND p_expected_rev <> 0 THEN
			RETURN jsonb_build_object('ok', false, 'conflict', true, 'rev', 0, 'data', NULL);
		END IF;

		INSERT INTO public.user_data (user_id, site_scope, data, device_id)
		VALUES (v_uid, p_scope, p_data, p_device_id)
		RETURNING * INTO v_row;
	END IF;

	RETURN jsonb_build_object(
		'ok',         true,
		'rev',        v_row.rev,
		'updated_at', v_row.updated_at,
		'hash',       v_row.data_hash,
		'bytes',      octet_length(v_row.data::text)
	);
EXCEPTION
	WHEN unique_violation THEN
		-- 两个请求同时 INSERT：另一个赢了，让上层按冲突重试
		RETURN jsonb_build_object('ok', false, 'conflict', true);
END $$;

-- ------------------------------------------------------------
-- 7. RPC：读取（可直接拿 rev + hash，避免「为了看一眼状态就下载整份数据」）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_data_get(
	p_scope      TEXT,
	p_with_data  BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
	v_uid UUID := auth.uid();
	v_row public.user_data%ROWTYPE;
BEGIN
	IF v_uid IS NULL THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
	END IF;
	IF p_scope IS NULL OR btrim(p_scope) = '' THEN
		RETURN jsonb_build_object('ok', false, 'error', 'missing_scope');
	END IF;

	SELECT * INTO v_row
	FROM public.user_data
	WHERE user_id = v_uid AND site_scope = p_scope;

	IF NOT FOUND THEN
		RETURN jsonb_build_object('ok', true, 'exists', false, 'rev', 0);
	END IF;

	RETURN jsonb_build_object(
		'ok',         true,
		'exists',     true,
		'rev',        v_row.rev,
		'updated_at', v_row.updated_at,
		'hash',       v_row.data_hash,
		'bytes',      octet_length(v_row.data::text),
		'device_id',  v_row.device_id,
		'data',       CASE WHEN p_with_data THEN v_row.data ELSE NULL END
	);
END $$;

-- ------------------------------------------------------------
-- 8. RPC：历史列表 / 单份内容 / 恢复
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_data_history_list(
	p_scope TEXT,
	p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
	v_uid  UUID := auth.uid();
	v_list JSONB;
BEGIN
	IF v_uid IS NULL THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
	END IF;

	SELECT COALESCE(jsonb_agg(
			jsonb_build_object(
				'id',         h.id,
				'rev',        h.rev,
				'bytes',      h.bytes,
				'hash',       h.data_hash,
				'device_id',  h.device_id,
				'reason',     h.reason,
				'created_at', h.created_at
			) ORDER BY h.id DESC
		), '[]'::jsonb)
	INTO v_list
	FROM (
		SELECT *
		FROM public.user_data_history
		WHERE user_id = v_uid AND site_scope = p_scope
		ORDER BY id DESC
		LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
	) h;

	RETURN jsonb_build_object('ok', true, 'items', v_list);
END $$;

CREATE OR REPLACE FUNCTION public.user_data_history_get(p_history_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
	v_uid UUID := auth.uid();
	v_row public.user_data_history%ROWTYPE;
BEGIN
	IF v_uid IS NULL THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
	END IF;

	SELECT * INTO v_row
	FROM public.user_data_history
	WHERE id = p_history_id AND user_id = v_uid;

	IF NOT FOUND THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_found');
	END IF;

	RETURN jsonb_build_object(
		'ok',         true,
		'id',         v_row.id,
		'rev',        v_row.rev,
		'site_scope', v_row.site_scope,
		'bytes',      v_row.bytes,
		'created_at', v_row.created_at,
		'reason',     v_row.reason,
		'data',       v_row.data
	);
END $$;

CREATE OR REPLACE FUNCTION public.user_data_history_restore(
	p_history_id   BIGINT,
	p_expected_rev BIGINT DEFAULT NULL,
	p_device_id    TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
	v_uid   UUID := auth.uid();
	v_hist  public.user_data_history%ROWTYPE;
	v_saved JSONB;
BEGIN
	IF v_uid IS NULL THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
	END IF;

	SELECT * INTO v_hist
	FROM public.user_data_history
	WHERE id = p_history_id AND user_id = v_uid;

	IF NOT FOUND THEN
		RETURN jsonb_build_object('ok', false, 'error', 'not_found');
	END IF;

	-- 恢复本身必须留痕：先给「当前值」打一个历史点，否则恢复一次就把被恢复的那份也顶掉了
	v_saved := public.user_data_save(
		v_hist.site_scope,
		v_hist.data,
		p_expected_rev,
		p_device_id,
		'历史恢复 #' || v_hist.id || '（原 rev ' || v_hist.rev || '）'
	);

	RETURN v_saved;
END $$;

-- ------------------------------------------------------------
-- 9. 授权：只给已登录用户
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.user_data_save(TEXT, JSONB, BIGINT, TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_data_get(TEXT, BOOLEAN)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_data_history_list(TEXT, INTEGER)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_data_history_get(BIGINT)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_data_history_restore(BIGINT, BIGINT, TEXT)        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_data_save(TEXT, JSONB, BIGINT, TEXT, TEXT)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_data_get(TEXT, BOOLEAN)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_data_history_list(TEXT, INTEGER)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_data_history_get(BIGINT)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_data_history_restore(BIGINT, BIGINT, TEXT)     FROM anon;
