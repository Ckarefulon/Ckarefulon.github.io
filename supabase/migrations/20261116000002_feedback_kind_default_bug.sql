-- 反馈类型的默认值从 others 改为 bug
--
-- 与前端弹窗一致：新建反馈默认选中 Bug（多数反馈本来就是报问题），
-- 函数在 type 缺失/不认识时也按 bug 处理，不再悄悄落到 Others 分类。
-- DEFAULT 只是兜底（函数每次都会显式写 kind），改它是为了让「直接插表」的路径也一致。

ALTER TABLE public.feedback_submissions
	ALTER COLUMN kind SET DEFAULT 'bug';

COMMENT ON COLUMN public.feedback_submissions.kind IS
	'反馈类型：bug / feature / question / chat / others；默认 bug。';
