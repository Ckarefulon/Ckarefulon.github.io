-- 回复的作者归属（issue #33）
--
-- 为什么需要这张表：帖子在 GitHub 上都是由站点自己的 App 代发的（作者一律是 bot），
-- 光看 GitHub 数据分不出「这条回复是谁写的」，也就无法判断谁才是「楼主」。
-- 所以在这里记一笔：**只记站内登录用户**发的回复，游客回复不记（那本来也没有身份）。
--
-- 只存「谁写的」，不存回复内容 —— 内容仍在 GitHub，这里不做第二份副本。
CREATE TABLE IF NOT EXISTS public.feedback_comment_authors (
	-- GitHub DiscussionComment 的 node id（形如 DC_kwDO…）
	comment_id text PRIMARY KEY,
	-- 所属讨论编号，便于按帖清理与排查
	discussion_number integer NOT NULL,
	user_id uuid,
	-- 提交时的用户名快照（user_profiles.username）；后来改名不影响历史
	username text,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_comment_authors_discussion_idx
	ON public.feedback_comment_authors (discussion_number);

-- 与 feedback_submissions 同一套策略：只有 service_role（Edge Function）能读写，
-- 浏览器端不直接碰这两张表。
ALTER TABLE public.feedback_comment_authors ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.feedback_comment_authors IS
	'站内用户回复的归属记录：GitHub 上是 bot 代发，这里补上真实作者，用于「楼主」判定与显示本人名字/头像';
