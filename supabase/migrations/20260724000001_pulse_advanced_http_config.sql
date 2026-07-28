-- Pulse 第三轮迁移：高级 HTTP 签到配置（前置请求、Nonce 提取、浏览器伪装、失败关键词、重试配置）

-- ============================================
-- 为 checkin_custom_http_configs 添加新字段
-- ============================================
ALTER TABLE public.checkin_custom_http_configs
	ADD COLUMN IF NOT EXISTS failure_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
	ADD COLUMN IF NOT EXISTS pre_request JSONB,
	ADD COLUMN IF NOT EXISTS extract_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
	ADD COLUMN IF NOT EXISTS browser_emulation JSONB,
	ADD COLUMN IF NOT EXISTS nonce_invalid_keywords JSONB NOT NULL DEFAULT '["nonce invalid","非法请求"]'::jsonb,
	ADD COLUMN IF NOT EXISTS retry_config JSONB;
