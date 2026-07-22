-- Pulse 第二轮修复：为 checkin_custom_http_configs 补充分 service_role 写入权限
-- pulse-upsert-target 使用 service_role 插入/更新自定义 HTTP 配置

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkin_custom_http_configs TO service_role;
