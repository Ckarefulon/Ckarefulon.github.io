(function() {
	"use strict";

	/**
	 * Supabase 客户端初始化
	 *
	 * 本阶段只使用 Supabase Auth，不做云端数据同步。
	 * 如果 publishableKey 未配置或为空，supabaseClient 为 null。
	 */

	var config = window.CK_SUPABASE_CONFIG;

	if (!config || !config.url || !config.publishableKey) {
		console.warn("[Supabase] 配置未完成，请填入 Publishable key。Auth 功能不可用，游客模式继续正常使用。");
		window.supabaseClient = null;
		return;
	}

	try {
		var client = window.supabase.createClient(config.url, config.publishableKey);
		window.supabaseClient = client;
	} catch (error) {
		console.error("[Supabase] 客户端初始化失败:", error);
		window.supabaseClient = null;
	}
})();