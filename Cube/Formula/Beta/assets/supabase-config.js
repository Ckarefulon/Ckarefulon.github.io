(function() {
	"use strict";

	/**
	 * Supabase 配置
	 *
	 * 本阶段只使用 Supabase Auth，不做云端数据同步。
	 * 后续云同步时，将按 user_id + site_scope 区分不同网站数据。
	 */

	window.CK_SUPABASE_CONFIG = {
		url: "https://sekbhrzxblaxvgspyjxa.supabase.co",
		publishableKey: "sb_publishable_ARBg-NY0bMtgd_UnQz6biQ_rGBK5HFK"
	};
})();