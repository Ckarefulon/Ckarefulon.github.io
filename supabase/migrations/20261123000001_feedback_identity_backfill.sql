-- 反馈的身份归属：补历史 + 显式授权（issue #45）
--
-- 背景：#45 报「站内登录后发的帖子仍显示为匿名」。链路上有两处会**静默降级**：
--
--   1. 用户名只从 user_profiles.username 取，而那张表只有用户自己去
--      /user/profile/ 手动点过保存才会有值。没设过的账号，user_id 记下了、
--      名字却是 null，读取时被判成「没有站内身份」⇒ 显示匿名。
--      函数的取名字逻辑已经改成「资料表 → metadata → 邮箱前缀」，
--      这里把**历史行**也按同一口径补一遍，老帖子不用重新发也能认出是谁。
--
--   2. 站内留痕与读取都走 service_role。默认权限通常够用，但一旦
--      表是别的角色建的、或默认权限被改过，就会 401/403 ——
--      而这条链路上的失败是「只记日志、不影响提交」的，表现同样是「匿名」。
--      这里显式授权，把这种静默失败的可能性去掉。

-- ① 显式授权：函数（service_role）要读要写
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_comment_authors TO service_role;

-- ② 补历史：只补姓名为空、且还留着 user_id 的行。
--    已经有名字的一律不动 —— 那是提交当时的快照，后来改名也不该篡改历史。
UPDATE public.feedback_submissions AS s
SET username = left(split_part(u.email, '@', 1), 32)
FROM auth.users AS u
WHERE s.user_id = u.id
	AND (s.username IS NULL OR btrim(s.username) = '')
	AND u.email IS NOT NULL
	AND split_part(u.email, '@', 1) <> '';

UPDATE public.feedback_comment_authors AS c
SET username = left(split_part(u.email, '@', 1), 32)
FROM auth.users AS u
WHERE c.user_id = u.id
	AND (c.username IS NULL OR btrim(c.username) = '')
	AND u.email IS NOT NULL
	AND split_part(u.email, '@', 1) <> '';

COMMENT ON COLUMN public.feedback_submissions.username IS
	'提交时的显示名快照（user_profiles.username → 注册 metadata → 邮箱前缀）；为空表示当年只记了 user_id，读取时会实时解析';
