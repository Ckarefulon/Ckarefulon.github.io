-- 反馈提交记录：把 GitHub 讨论与站内提交者关联起来
--
-- 为什么不把用户名写进 GitHub 正文：那是公开的，等于把「站内谁提的」
-- 广播给所有人。所以：
--   · GitHub 上：作者是 bot，正文里只有「联系方式」这个用户自愿填的字段；
--   · 站内：这张表记住 discussion_number ↔ user_id，只有本人和管理员能看。
--
-- RLS：本人可读写自己的记录；服务端（service_role）可读全部。

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	-- GitHub 讨论编号（与仓库内唯一）
	discussion_number integer NOT NULL,
	-- 提交者：登录用户才有；游客提交为 null
	user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
	-- 提交时快照的用户名（user_profiles.username），方便展示与稽核；
	-- 用户名后来改了也不影响历史记录的真实性
	username text,
	-- 反馈类型：bug / feature / question / chat / others
	kind text NOT NULL DEFAULT 'others',
	title text,
	-- 站点路径（便于按页面归类）
	page text,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (discussion_number)
);

CREATE INDEX IF NOT EXISTS feedback_submissions_user_idx
	ON public.feedback_submissions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_submissions_created_idx
	ON public.feedback_submissions (created_at DESC);

COMMENT ON TABLE public.feedback_submissions IS
	'站点反馈与 GitHub 讨论的映射；仅站内可见，不写入 GitHub。';

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

-- 本人可读自己的提交记录
DROP POLICY IF EXISTS feedback_submissions_select_own ON public.feedback_submissions;
CREATE POLICY feedback_submissions_select_own
	ON public.feedback_submissions
	FOR SELECT
	TO authenticated
	USING (auth.uid() = user_id);

-- 本人可写入（服务端以 service_role 写入时会绕过 RLS，这里主要给自助场景兜底）
DROP POLICY IF EXISTS feedback_submissions_insert_own ON public.feedback_submissions;
CREATE POLICY feedback_submissions_insert_own
	ON public.feedback_submissions
	FOR INSERT
	TO authenticated
	WITH CHECK (auth.uid() = user_id);

-- 不允许客户端改历史记录
DROP POLICY IF EXISTS feedback_submissions_no_update ON public.feedback_submissions;
CREATE POLICY feedback_submissions_no_update
	ON public.feedback_submissions
	FOR UPDATE
	TO authenticated
	USING (false);

DROP POLICY IF EXISTS feedback_submissions_no_delete ON public.feedback_submissions;
CREATE POLICY feedback_submissions_no_delete
	ON public.feedback_submissions
	FOR DELETE
	TO authenticated
	USING (false);
