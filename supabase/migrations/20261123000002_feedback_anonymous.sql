-- 「匿名」与「游客」分开：登录用户可以自己选择匿名提交 / 匿名回复
--
-- 三种身份对前端的显示口径：
--
--   | 身份                     | 显示 | 楼主 |
--   | ------------------------ | ---- | ---- |
--   | 游客（未登录）           | 游客 | 不标 |
--   | 登录用户勾了「匿名」     | 匿名 | 照标 |
--   | 登录用户实名             | 名字 | 照标 |
--
-- 关键点：匿名**不等于不记录**。匿名行仍然写 user_id（只不写 username），
-- 这样服务端才能比出「这条回复和主帖是同一个人」，从而给匿名的帖子也标上楼主；
-- 而 user_id 永远不下发给浏览器，响应里只有 { anonymous: true } 与 op: true/false。
--
-- 这两列默认 false，历史行自动按「实名 / 游客」处理，行为不变。

ALTER TABLE public.feedback_submissions
	ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;

ALTER TABLE public.feedback_comment_authors
	ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.feedback_submissions.anonymous IS
	'提交者勾了「匿名提交」：只记 user_id（用于判楼主），username 为空，前端显示「匿名」';
COMMENT ON COLUMN public.feedback_comment_authors.anonymous IS
	'回复者勾了「匿名回复」：只记 user_id（用于判楼主），username 为空，前端显示「匿名」';
