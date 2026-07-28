(function() {
	'use strict';

	const SUPABASE_CONFIG = window.CK_SUPABASE_CONFIG || {};
	const FUNCTIONS_URL = `${SUPABASE_CONFIG.url}/functions/v1`;
	const supabase = window.supabaseClient;

	let appState = {
		user: null,
		targets: [],
		schedules: new Map(),
		runs: [],
		editingTargetId: null,
		customHttpConfig: null,
		refreshTimer: null,
		realtimeSubscriptions: [],
		eventsBound: false
	};

	function $(id) { return document.getElementById(id); }
	function qs(sel, parent) { return (parent || document).querySelector(sel); }
	function qsa(sel, parent) { return Array.from((parent || document).querySelectorAll(sel)); }

	function escapeHtml(str) {
		if (str === null || str === undefined) return '';
		const div = document.createElement('div');
		div.textContent = String(str);
		return div.innerHTML;
	}

	function getDisplayTimezone() {
		// 默认跟随浏览器时区；选择具体时区时固定显示
		try {
			const tz = localStorage.getItem('pulseTimezone') || 'auto';
			return tz === 'auto' ? undefined : tz;
		} catch (e) {
			return undefined;
		}
	}

	function formatTime(isoString) {
		if (!isoString) return '-';
		try {
			const d = new Date(isoString);
			const opts = {
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit'
			};
			const tz = getDisplayTimezone();
			if (tz) opts.timeZone = tz;
			return d.toLocaleString('zh-CN', opts);
		} catch { return isoString; }
	}

	function formatDuration(ms) {
		if (!ms && ms !== 0) return '-';
		if (ms < 1000) return ms + 'ms';
		return (ms / 1000).toFixed(1) + 's';
	}

	function getStatusDisplay(status) {
		const map = {
			success: { label: '成功', class: 'status-success' },
			failed: { label: '失败', class: 'status-failed' },
			running: { label: '执行中', class: 'status-running' },
			pending: { label: '待执行', class: 'status-pending' },
			paused: { label: '已暂停', class: 'status-paused' },
			skipped: { label: '跳过', class: 'status-skipped' },
			reauth: { label: '需重新授权', class: 'status-reauth' },
			queued: { label: '排队中', class: 'status-pending' }
		};
		return map[status] || { label: status || '未知', class: 'status-paused' };
	}

	function showToast(message, type) {
		const toast = $('pulseToast');
		toast.textContent = message;
		toast.className = 'pulseToast isVisible' + (type ? ' is' + type.charAt(0).toUpperCase() + type.slice(1) : '');
		setTimeout(() => {
			toast.classList.remove('isVisible');
		}, 3000);
	}

	async function getAuthHeaders() {
		if (!appState.user || !supabase) return {};
		try {
			const { data } = await supabase.auth.getSession();
			const session = data.session;
			if (!session) return {};
			return {
				'Authorization': `Bearer ${session.access_token}`,
				'Content-Type': 'application/json'
			};
		} catch {
			return {};
		}
	}

	async function callEdgeFunction(name, body, method) {
		const headers = await getAuthHeaders();
		if (!headers.Authorization) {
			throw new Error('未登录');
		}
		const url = `${FUNCTIONS_URL}/${name}`;
		const opts = {
			method: method || 'POST',
			headers,
			body: body ? JSON.stringify(body) : undefined
		};
		const res = await fetch(url, opts);
		let data;
		try {
			data = await res.json();
		} catch {
			data = { success: false, message: '响应解析失败' };
		}
		if (!res.ok || (data && data.success === false)) {
			throw new Error(data.message || `请求失败 (${res.status})`);
		}
		return data;
	}

	function showScreen(screen) {
		$('pulseLoading').style.display = screen === 'loading' ? 'flex' : 'none';
		$('pulseMain').style.display = screen === 'main' || screen === 'guest' ? 'flex' : 'none';
		$('pulseMain').classList.toggle('isGuest', screen === 'guest');
		const guestHint = $('pulseGuestHint');
		if (guestHint) {
			guestHint.style.display = screen === 'guest' ? 'flex' : 'none';
		}
	}

	function switchTab(tabName) {
		qsa('.pulseSidebarItem').forEach(tab => {
			tab.classList.toggle('isActive', tab.dataset.tab === tabName);
		});
		qsa('.pulseTabPanel').forEach(panel => {
			panel.classList.toggle('isActive', panel.id === 'panel-' + tabName);
		});
		if (tabName === 'runs') {
			loadRuns();
		}
	}

	function waitForServices(callback) {
		let checks = 0;
		const maxChecks = 100;
		function check() {
			checks++;
			if (window.authManager && window.storageManager && window.supabaseClient !== undefined) {
				callback();
				return;
			}
			if (checks >= maxChecks) {
				showToast('服务加载失败，请刷新页面', 'error');
				showScreen('guest');
				return;
			}
			setTimeout(check, 50);
		}
		check();
	}

	function initTheme() {
		let saved = null;
		try { saved = localStorage.getItem('smartCubeTheme'); } catch(e) {}
		const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		const theme = saved || (prefersDark ? 'dark' : 'light');
		applyTheme(theme, false);
	}

	function applyTheme(theme, save) {
		theme = theme === 'dark' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		const themeBtn = document.getElementById('siteThemeToggle');
		if (themeBtn) {
			themeBtn.textContent = theme === 'dark' ? '☀' : '☾';
		}
		if (save !== false) {
			try { localStorage.setItem('smartCubeTheme', theme); } catch(e) {}
			if (window.globalDataManager && window.globalDataManager.isReady()) {
				window.globalDataManager.saveThemePreference(theme).catch(function(error) {
					console.warn('[Theme] 云端主题同步失败:', error);
				});
			}
		}
	}

	function initApp() {
		initTheme();
		if (!appState.eventsBound) {
			bindEvents();
			appState.eventsBound = true;
		}

		showScreen('loading');

		waitForServices(() => {
			if (window.siteNav && typeof window.siteNav.init === 'function') {
				window.siteNav.init({
					setTheme: function(theme) {
						applyTheme(theme, true);
					}
				});
			}

			if (window.authManager) {
				window.authManager.onAuthStateChange((user) => {
					onAuthStateChange(user);
				});
				if (!window.authManager._siteNavInitialized) {
					window.authManager._siteNavInitialized = true;
					window.authManager.init();
				}
				if (window.authManager.isLoggedIn()) {
					onAuthStateChange(window.authManager.getUser());
				} else {
					onAuthStateChange(null);
				}
			} else {
				onAuthStateChange(null);
			}
		});
	}

	function onAuthStateChange(user) {
		appState.user = user || null;
		if (appState.user) {
			showScreen('main');
			onLoggedIn();
		} else {
			clearRefreshTimer();
			if (appState.realtimeSubscriptions) {
				appState.realtimeSubscriptions.forEach(sub => {
					if (sub && sub.unsubscribe) sub.unsubscribe();
				});
				appState.realtimeSubscriptions = [];
			}
			showScreen('guest');
		}
	}

	async function onLoggedIn() {
		await loadAllData();
		setupRefreshTimer();
		setupRealtime();
		if (typeof window._siteNavInitialSyncComplete === 'function') {
			window._siteNavInitialSyncComplete();
		}
	}

	// ========== 自定义 HTTP 表单 ==========
	const SENSITIVE_PLACEHOLDER = '__PULSE_SENSITIVE__';

	function createEmptyCustomHttpConfig() {
		return {
			url: '',
			method: 'GET',
			bodyType: 'none',
			queryParams: [],
			headers: [],
			bodyFields: [],
			successRules: [{ type: 'status_range' }],
			alreadyCheckedInRules: [],
			authFailureRules: [],
			failureRules: [],
			preRequest: {
				enabled: false,
				url: '',
				method: 'GET',
				includeCookies: true,
				extraHeaders: []
			},
			extractRules: [],
			browserEmulation: {
				enabled: false,
				userAgent: '',
				referer: '',
				origin: '',
				acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
				xRequestedWith: true,
				accept: 'application/json, text/javascript, */*; q=0.01',
				cacheControl: 'no-cache',
				pragma: 'no-cache',
				secChUa: '',
				secChUaMobile: '?0',
				secChUaPlatform: '"Windows"',
				secFetchDest: 'empty',
				secFetchMode: 'cors',
				secFetchSite: 'same-origin',
				secFetchUser: '?1',
				upgradeInsecureRequests: '1'
			},
			nonceInvalidKeywords: ['nonce invalid', '非法请求']
		};
	}

	function normalizeCustomHttpConfig(dbConfig) {
		if (!dbConfig) return createEmptyCustomHttpConfig();
		const defaultCfg = createEmptyCustomHttpConfig();
		return {
			url: dbConfig.url || '',
			method: dbConfig.method || 'GET',
			bodyType: dbConfig.body_type || 'none',
			queryParams: Array.isArray(dbConfig.query_params) ? dbConfig.query_params : [],
			headers: Array.isArray(dbConfig.headers) ? dbConfig.headers : [],
			bodyFields: Array.isArray(dbConfig.body_fields) ? dbConfig.body_fields : [],
			successRules: Array.isArray(dbConfig.success_rules) && dbConfig.success_rules.length > 0
				? dbConfig.success_rules : [{ type: 'status_range' }],
			alreadyCheckedInRules: Array.isArray(dbConfig.already_checked_in_rules) ? dbConfig.already_checked_in_rules : [],
			authFailureRules: Array.isArray(dbConfig.auth_failure_rules) ? dbConfig.auth_failure_rules : [],
			failureRules: Array.isArray(dbConfig.failure_rules) ? dbConfig.failure_rules : [],
			preRequest: dbConfig.pre_request ? { ...defaultCfg.preRequest, ...dbConfig.pre_request, extraHeaders: dbConfig.pre_request.extraHeaders || dbConfig.pre_request.extra_headers || [] } : defaultCfg.preRequest,
			extractRules: Array.isArray(dbConfig.extract_rules) ? dbConfig.extract_rules : [],
			browserEmulation: dbConfig.browser_emulation ? { ...defaultCfg.browserEmulation, ...dbConfig.browser_emulation } : defaultCfg.browserEmulation,
			nonceInvalidKeywords: Array.isArray(dbConfig.nonce_invalid_keywords) ? dbConfig.nonce_invalid_keywords : defaultCfg.nonceInvalidKeywords
		};
	}

	function getDefaultRuleValue(type) {
		if (type === 'status_code') return { type, statusCode: 200 };
		if (type === 'status_range') return { type };
		if (type === 'text_contains') return { type, text: '' };
		if (type === 'text_not_contains') return { type, text: '' };
		if (type === 'json_equals') return { type, jsonPath: '', jsonValue: '' };
		return { type };
	}

	function renderExtractRuleRow(rule, index) {
		return `
			<div class="pulseExtractRow" data-index="${index}">
				<input type="text" class="extract-varname" placeholder="变量名，如 nonce" value="${escapeHtml(rule.variableName || '')}" style="width:120px;">
				<input type="text" class="extract-pattern" placeholder="正则表达式，如 ajax_nonce\\s*=\\s*'([^']+)'" value="${escapeHtml(rule.pattern || '')}">
				<input type="text" class="extract-flags" placeholder="flags" value="${escapeHtml(rule.flags || 'i')}" style="width:50px;" title="正则标志，如 i(忽略大小写) g(全局)">
				<input type="number" class="extract-group" placeholder="分组" value="${rule.groupIndex ?? 1}" min="0" style="width:60px;" title="捕获组索引，通常为1">
				<button type="button" class="pulseRemoveBtn remove-extract">&times;</button>
			</div>
		`;
	}

	function renderParamRow(param, category, index) {
		const isSensitive = param.sensitive ? 'checked' : '';
		const valueDisplay = param.sensitive && param.value === SENSITIVE_PLACEHOLDER
			? '已配置'
			: escapeHtml(param.value || '');
		const valuePlaceholder = param.sensitive ? '•••••••• (留空不修改)' : '参数值';
		const sensitiveClass = param.sensitive && param.value === SENSITIVE_PLACEHOLDER ? 'pulseSensitivePlaceholder' : '';
		return `
			<div class="pulseParamRow" data-category="${category}" data-index="${index}">
				<input type="text" class="param-key" placeholder="参数名" value="${escapeHtml(param.key || '')}">
				<input type="text" class="param-value ${sensitiveClass}" placeholder="${valuePlaceholder}" value="${valueDisplay}" data-sensitive="${param.sensitive ? '1' : '0'}">
				<label><input type="checkbox" class="param-sensitive" ${isSensitive}> 敏感</label>
				<button type="button" class="pulseRemoveBtn remove-param">&times;</button>
			</div>
		`;
	}

	function renderRuleRow(rule, category, index) {
		const typeOptions = [
			{ value: 'status_range', label: '200-299' },
			{ value: 'status_code', label: '状态码等于' },
			{ value: 'text_contains', label: '文本包含' },
			{ value: 'text_not_contains', label: '文本不包含' },
			{ value: 'json_equals', label: 'JSON 字段等于' }
		];
		const typeSelect = typeOptions.map(opt =>
			`<option value="${opt.value}" ${rule.type === opt.value ? 'selected' : ''}>${opt.label}</option>`
		).join('');

		let valueInputs = '';
		if (rule.type === 'status_code') {
			valueInputs = `<input type="number" class="rule-status-code" placeholder="状态码" value="${rule.statusCode ?? ''}" min="100" max="599">`;
		} else if (rule.type === 'text_contains' || rule.type === 'text_not_contains') {
			valueInputs = `<input type="text" class="rule-text" placeholder="匹配文本" value="${escapeHtml(rule.text || '')}">`;
		} else if (rule.type === 'json_equals') {
			valueInputs = `
				<input type="text" class="rule-json-path" placeholder="字段路径，如 data.success" value="${escapeHtml(rule.jsonPath || '')}">
				<input type="text" class="rule-json-value" placeholder="期望值" value="${escapeHtml(String(rule.jsonValue ?? ''))}">
			`;
		} else {
			valueInputs = `<input type="text" disabled placeholder="200-299" value="200-299">`;
		}

		return `
			<div class="pulseRuleRow" data-category="${category}" data-index="${index}">
				<select class="rule-type">${typeSelect}</select>
				${valueInputs}
				<button type="button" class="pulseRemoveBtn remove-rule">&times;</button>
			</div>
		`;
	}

	function renderCustomHttpForm() {
		const cfg = appState.customHttpConfig || createEmptyCustomHttpConfig();

		$('customUrl').value = cfg.url || '';
		$('customMethod').value = cfg.method || 'GET';
		$('customBodyType').value = cfg.bodyType || 'none';

		$('queryParams').innerHTML = (cfg.queryParams || []).map((p, i) => renderParamRow(p, 'queryParams', i)).join('');
		$('headerParams').innerHTML = (cfg.headers || []).map((p, i) => renderParamRow(p, 'headers', i)).join('');
		$('bodyParams').innerHTML = (cfg.bodyFields || []).map((p, i) => renderParamRow(p, 'bodyFields', i)).join('');

		$('successRules').innerHTML = (cfg.successRules || []).map((r, i) => renderRuleRow(r, 'successRules', i)).join('');
		$('alreadyCheckedInRules').innerHTML = (cfg.alreadyCheckedInRules || []).map((r, i) => renderRuleRow(r, 'alreadyCheckedInRules', i)).join('');
		$('authFailureRules').innerHTML = (cfg.authFailureRules || []).map((r, i) => renderRuleRow(r, 'authFailureRules', i)).join('');
		$('failureRules').innerHTML = (cfg.failureRules || []).map((r, i) => renderRuleRow(r, 'failureRules', i)).join('');

		// 浏览器伪装
		const browserCfg = cfg.browserEmulation || {};
		$('browserEmulationEnabled').checked = !!browserCfg.enabled;
		$('browserEmulationFields').style.display = browserCfg.enabled ? 'block' : 'none';
		$('browserUserAgent').value = browserCfg.userAgent || '';
		$('browserReferer').value = browserCfg.referer || '';
		$('browserOrigin').value = browserCfg.origin || '';
		$('browserAcceptLanguage').value = browserCfg.acceptLanguage || 'zh-CN,zh;q=0.9,en;q=0.8';
		$('browserXRequestedWith').checked = browserCfg.xRequestedWith !== false;
		$('browserSecChUa').value = browserCfg.secChUa || '';
		$('browserSecChUaMobile').value = browserCfg.secChUaMobile || '?0';
		$('browserSecChUaPlatform').value = browserCfg.secChUaPlatform || '"Windows"';
		$('browserSecFetchDest').value = browserCfg.secFetchDest || 'empty';
		$('browserSecFetchMode').value = browserCfg.secFetchMode || 'cors';
		$('browserSecFetchSite').value = browserCfg.secFetchSite || 'same-origin';
		$('browserUpgradeInsecure').value = browserCfg.upgradeInsecureRequests || '1';

		// 前置请求
		const preReqCfg = cfg.preRequest || {};
		$('preRequestEnabled').checked = !!preReqCfg.enabled;
		$('preRequestFields').style.display = preReqCfg.enabled ? 'block' : 'none';
		$('preRequestUrl').value = preReqCfg.url || '';
		$('preRequestHeaders').innerHTML = (preReqCfg.extraHeaders || []).map((p, i) => renderParamRow(p, 'preRequestHeaders', i)).join('');

		// 提取规则
		$('extractRules').innerHTML = (cfg.extractRules || []).map((r, i) => renderExtractRuleRow(r, i)).join('');

		// Nonce失效关键词
		const nonceKeywords = (cfg.nonceInvalidKeywords || []).join(',');
		const kwInput = qs('#nonceInvalidKeywords input');
		if (kwInput) kwInput.value = nonceKeywords || 'nonce invalid,非法请求';

		updateBodyFieldsVisibility();
	}

	function updateBodyFieldsVisibility() {
		const bodyType = $('customBodyType').value;
		const method = $('customMethod').value;
		const section = $('bodyFieldsSection');
		if (method === 'GET' || bodyType === 'none') {
			section.style.display = 'none';
		} else {
			section.style.display = 'block';
		}
	}

	function collectCustomHttpConfig() {
		function collectParams(container) {
			return qsa('.pulseParamRow', container).map(row => {
				const keyInput = qs('.param-key', row);
				const valueInput = qs('.param-value', row);
				const sensitiveInput = qs('.param-sensitive', row);
				let value = valueInput.value;
				const isSensitive = sensitiveInput ? sensitiveInput.checked : false;
				if (isSensitive && value === '已配置') {
					value = SENSITIVE_PLACEHOLDER;
				}
				return {
					key: keyInput.value.trim(),
					value: value,
					sensitive: isSensitive
				};
			});
		}

		function collectRules(container) {
			return qsa('.pulseRuleRow', container).map(row => {
				const type = qs('.rule-type', row).value;
				const rule = { type };
				if (type === 'status_code') {
					rule.statusCode = parseInt(qs('.rule-status-code', row)?.value) || 200;
				} else if (type === 'text_contains' || type === 'text_not_contains') {
					rule.text = qs('.rule-text', row)?.value || '';
				} else if (type === 'json_equals') {
					rule.jsonPath = qs('.rule-json-path', row)?.value || '';
					const valInput = qs('.rule-json-value', row);
					let val = valInput?.value;
					if (val === 'true') val = true;
					else if (val === 'false') val = false;
					else if (!isNaN(Number(val)) && val !== '') val = Number(val);
					rule.jsonValue = val;
				}
				return rule;
			});
		}

		function collectExtractRules() {
			return qsa('.pulseExtractRow', $('extractRules')).map(row => {
				return {
					variableName: qs('.extract-varname', row)?.value.trim() || '',
					pattern: qs('.extract-pattern', row)?.value || '',
					flags: qs('.extract-flags', row)?.value || 'i',
					groupIndex: parseInt(qs('.extract-group', row)?.value) || 1
				};
			}).filter(r => r.variableName && r.pattern);
		}

		// Nonce失效关键词
		const kwInput = qs('#nonceInvalidKeywords input');
		const nonceKeywords = kwInput
			? kwInput.value.split(/[,，]/).map(k => k.trim()).filter(k => k)
			: ['nonce invalid', '非法请求'];

		return {
			url: $('customUrl').value.trim(),
			method: $('customMethod').value,
			bodyType: $('customBodyType').value,
			queryParams: collectParams($('queryParams')),
			headers: collectParams($('headerParams')),
			bodyFields: collectParams($('bodyParams')),
			successRules: collectRules($('successRules')),
			alreadyCheckedInRules: collectRules($('alreadyCheckedInRules')),
			authFailureRules: collectRules($('authFailureRules')),
			failureRules: collectRules($('failureRules')),
			preRequest: {
				enabled: $('preRequestEnabled').checked,
				url: $('preRequestUrl').value.trim(),
				method: 'GET',
				includeCookies: true,
				extraHeaders: collectParams($('preRequestHeaders'))
			},
			extractRules: collectExtractRules(),
			browserEmulation: {
				enabled: $('browserEmulationEnabled').checked,
				userAgent: $('browserUserAgent').value.trim(),
				referer: $('browserReferer').value.trim(),
				origin: $('browserOrigin').value.trim(),
				acceptLanguage: $('browserAcceptLanguage').value.trim() || 'zh-CN,zh;q=0.9,en;q=0.8',
				xRequestedWith: $('browserXRequestedWith').checked,
				accept: 'application/json, text/javascript, */*; q=0.01',
				cacheControl: 'no-cache',
				pragma: 'no-cache',
				secChUa: $('browserSecChUa').value.trim(),
				secChUaMobile: $('browserSecChUaMobile').value.trim() || '?0',
				secChUaPlatform: $('browserSecChUaPlatform').value.trim() || '"Windows"',
				secFetchDest: $('browserSecFetchDest').value.trim() || 'empty',
				secFetchMode: $('browserSecFetchMode').value.trim() || 'cors',
				secFetchSite: $('browserSecFetchSite').value.trim() || 'same-origin',
				secFetchUser: '?1',
				upgradeInsecureRequests: $('browserUpgradeInsecure').value.trim() || '1'
			},
			nonceInvalidKeywords: nonceKeywords
		};
	}

	function showCustomHttpForm() {
		if (!appState.customHttpConfig) {
			appState.customHttpConfig = createEmptyCustomHttpConfig();
		}
		renderCustomHttpForm();
		updateBodyFieldsVisibility();
		updateTestButtonState();
	}

	function populateTargetFilter() {
		const filterSelect = $('runFilterTarget');
		if (!filterSelect) return;
		const currentVal = filterSelect.value;
		filterSelect.innerHTML = '<option value="">全部项目</option>';
		appState.targets.forEach(t => {
			const opt = document.createElement('option');
			opt.value = t.id;
			opt.textContent = t.display_name;
			filterSelect.appendChild(opt);
		});
		filterSelect.value = currentVal;
	}

	async function loadAllData() {
		await Promise.all([
			loadTargets(),
			loadTodayStats()
		]);
	}

	async function loadTargets() {
		try {
			let query = supabase
				.from('checkin_targets')
				.select(`
					*,
					checkin_schedules (*),
					checkin_custom_http_configs (*)
				`)
				.order('created_at', { ascending: true });

			const { data, error } = await query;
			if (error) throw error;

			appState.targets = data || [];
			appState.schedules.clear();
			(data || []).forEach(t => {
				if (t.checkin_schedules && t.checkin_schedules.length > 0) {
					appState.schedules.set(t.id, t.checkin_schedules[0]);
				}
				if (t.checkin_custom_http_configs && t.checkin_custom_http_configs.length > 0) {
					t.custom_http_config = t.checkin_custom_http_configs[0];
				}
			});

			populateTargetFilter();
			renderDashboard();
			renderTargetGrid();
		} catch (err) {
			console.error('Load targets error:', err);
			showToast('加载签到项目失败', 'error');
		}
	}

	async function loadTodayStats() {
		try {
			const { data, error } = await supabase
				.rpc('pulse_get_today_stats');
			if (error) {
				console.warn('RPC error, calculating client-side:', error);
				await calculateStatsClientSide();
				return;
			}
			updateStats(data || {});
		} catch (err) {
			console.warn('Stats load error, client-side:', err);
			await calculateStatsClientSide();
		}
	}

	async function calculateStatsClientSide() {
		try {
			const today = new Date();
			const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
			const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

			const enabledTargets = appState.targets.filter(t => t.enabled);
			const { data: todayRuns } = await supabase
				.from('checkin_runs')
				.select('*')
				.gte('created_at', startOfDay)
				.lt('created_at', endOfDay);

			const runs = todayRuns || [];
			const success = runs.filter(r => r.status === 'success').length;
			const failed = runs.filter(r => r.status === 'failed').length;
			const running = runs.filter(r => r.status === 'running' || r.status === 'queued').length;
			const pending = Math.max(0, enabledTargets.length - success - failed - running);

			updateStats({
				total: enabledTargets.length,
				success,
				failed,
				pending
			});
		} catch (err) {
			console.error('Client-side stats error:', err);
		}
	}

	function updateStats(stats) {
		$('statTotal').textContent = stats.total ?? 0;
		$('statSuccess').textContent = stats.success ?? 0;
		$('statFailed').textContent = stats.failed ?? 0;
		$('statPending').textContent = stats.pending ?? 0;
	}

	function renderDashboard() {
		const listEl = $('dashboardTargetList');
		if (appState.targets.length === 0) {
			listEl.innerHTML = '<div class="pulseEmpty">还没有签到项目，点击"添加项目"开始使用</div>';
		} else {
			listEl.innerHTML = appState.targets.map(t => renderTargetListItem(t)).join('');
		}

		loadRecentRuns();
		bindTargetActions(listEl);
	}

	function renderTargetListItem(target) {
		const schedule = appState.schedules.get(target.id);
		const status = getTargetStatus(target);
		const streak = target.consecutive_success_days || 0;

		return `
			<div class="pulseTargetListItem" data-id="${target.id}">
				<div class="pulseTargetListItemInfo">
					<div class="pulseTargetListItemName">${escapeHtml(target.display_name)}</div>
					<div class="pulseTargetListItemMeta">
						${escapeHtml(getServiceName(target.service_key))} · ${schedule ? schedule.local_time : '--:--'}
						${streak > 0 ? ` · <span class="pulseTargetStreak">🔥 ${streak}天</span>` : ''}
						${target.requires_reauth ? ' · <span style="color:var(--orange)">需重新授权</span>' : ''}
					</div>
				</div>
				<span class="pulseTargetStatus ${status.class}">${status.label}</span>
				<button class="pulseBtn pulseBtnSm run-now-btn" data-id="${target.id}" title="立即签到">
					<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
				</button>
			</div>
		`;
	}

	function renderTargetGrid() {
		const grid = $('targetGrid');
		if (appState.targets.length === 0) {
			grid.innerHTML = '<div class="pulseEmpty">还没有签到项目，点击上方按钮添加</div>';
			return;
		}

		grid.innerHTML = appState.targets.map(t => renderTargetCard(t)).join('');
		bindTargetActions(grid);
	}

	function renderTargetCard(target) {
		const schedule = appState.schedules.get(target.id);
		const status = getTargetStatus(target);
		const daysMap = ['日', '一', '二', '三', '四', '五', '六'];
		const daysText = schedule && schedule.days_of_week
			? schedule.days_of_week.map(d => daysMap[d] || '').join(' ')
			: '每天';

		return `
			<div class="pulseTargetCard" data-id="${target.id}">
				<div class="pulseTargetHeader">
					<div class="pulseTargetInfo">
						<div class="pulseTargetName">${escapeHtml(target.display_name)}</div>
						<div class="pulseTargetService">
							<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
							${escapeHtml(getServiceName(target.service_key))}
						</div>
					</div>
					<span class="pulseTargetStatus ${status.class}">${status.label}</span>
				</div>
				<div class="pulseTargetMeta">
					<div class="pulseTargetMetaItem">
						<span class="pulseTargetMetaLabel">签到时间</span>
						<span class="pulseTargetMetaValue">${schedule ? schedule.local_time : '--:--'}</span>
					</div>
					<div class="pulseTargetMetaItem">
						<span class="pulseTargetMetaLabel">上次成功</span>
						<span class="pulseTargetMetaValue">${formatTime(target.last_success_at)}</span>
					</div>
					<div class="pulseTargetMetaItem">
						<span class="pulseTargetMetaLabel">连续成功</span>
						<span class="pulseTargetMetaValue">
							${target.consecutive_success_days > 0
								? `<span class="pulseTargetStreak">🔥 ${target.consecutive_success_days}天</span>`
								: '-'}
						</span>
					</div>
					<div class="pulseTargetMetaItem">
						<span class="pulseTargetMetaLabel">执行星期</span>
						<span class="pulseTargetMetaValue" style="font-size:11px">${daysText}</span>
					</div>
				</div>
				${target.requires_reauth ? `
					<div style="padding:8px 12px;margin-bottom:12px;border-radius:6px;background:color-mix(in srgb,var(--orange) 12%,var(--controlBg));border:1px solid color-mix(in srgb,var(--orange) 30%,var(--controlBorder));color:var(--orange);font-size:12px;">
						⚠️ 凭据可能已失效，需要重新授权
					</div>
				` : ''}
				${target.last_error_message ? `
					<div style="padding:8px 12px;margin-bottom:12px;border-radius:6px;background:rgba(232,93,106,0.08);border:1px solid rgba(232,93,106,0.2);color:var(--red);font-size:12px;word-break:break-word;">
						${escapeHtml(target.last_error_message)}
					</div>
				` : ''}
				<div class="pulseTargetActions">
					<button class="pulseBtn run-now-btn" data-id="${target.id}">
						<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
						立即签到
					</button>
					<button class="pulseBtn edit-btn" data-id="${target.id}">编辑</button>
					<button class="pulseBtn toggle-btn" data-id="${target.id}">
						${target.enabled ? '暂停' : '启用'}
					</button>
					<button class="pulseBtn pulseBtnDanger delete-btn" data-id="${target.id}">删除</button>
				</div>
			</div>
		`;
	}

	function getTargetStatus(target) {
		if (target.requires_reauth) return { label: '需重新授权', class: 'status-reauth' };
		if (!target.enabled) return { label: '已暂停', class: 'status-paused' };
		if (target.last_status === 'success') return { label: '正常', class: 'status-success' };
		if (target.last_status === 'failed') return { label: '失败', class: 'status-failed' };
		if (target.last_status === 'running') return { label: '执行中', class: 'status-running' };
		return { label: '待执行', class: 'status-pending' };
	}

	function getServiceName(serviceKey) {
		if (serviceKey === 'custom-http') return '自定义 HTTP 签到';
		return serviceKey;
	}

	async function loadRecentRuns() {
		try {
			const { data, error } = await supabase
				.from('checkin_runs')
				.select(`
					*,
					checkin_targets (display_name)
				`)
				.order('created_at', { ascending: false })
				.limit(10);

			if (error) throw error;
			const runs = data || [];

			const listEl = $('recentRuns');
			if (runs.length === 0) {
				listEl.innerHTML = '<div class="pulseEmpty">暂无执行记录</div>';
				return;
			}

			listEl.innerHTML = runs.map(r => `
				<div class="pulseRunItem">
					<span class="pulseRunTime">${formatTime(r.created_at)}</span>
					<span class="pulseRunTarget">${escapeHtml(r.checkin_targets?.display_name || '未知项目')}</span>
					<span class="pulseRunStatus status-${r.status}">${getStatusDisplay(r.status).label}</span>
					<span class="pulseRunDuration">${formatDuration(r.duration_ms)}</span>
					<span class="pulseRunMessage">${escapeHtml(r.result_summary || r.error_message || '-')}</span>
				</div>
			`).join('');
		} catch (err) {
			console.error('Load recent runs error:', err);
		}
	}

	async function loadRuns() {
		try {
			const targetFilter = $('runFilterTarget').value;
			const statusFilter = $('runFilterStatus').value;

			let query = supabase
				.from('checkin_runs')
				.select(`
					*,
					checkin_targets (display_name)
				`)
				.order('created_at', { ascending: false })
				.limit(50);

			if (targetFilter) {
				query = query.eq('target_id', targetFilter);
			}
			if (statusFilter) {
				query = query.eq('status', statusFilter);
			}

			const { data, error } = await query;
			if (error) throw error;

			const tbody = $('runTableBody');
			const runs = data || [];

			if (runs.length === 0) {
				tbody.innerHTML = '<tr><td colspan="6" class="pulseEmpty" style="text-align:center;">暂无记录</td></tr>';
				return;
			}

			tbody.innerHTML = runs.map(r => `
				<tr>
					<td>${formatTime(r.created_at)}</td>
					<td>${escapeHtml(r.checkin_targets?.display_name || '未知')}</td>
					<td>${r.trigger_type === 'manual' ? '手动' : r.trigger_type === 'scheduled' ? '定时' : r.trigger_type}</td>
					<td><span class="pulseRunStatus status-${r.status}">${getStatusDisplay(r.status).label}</span></td>
					<td>${formatDuration(r.duration_ms)}</td>
					<td class="pulseRunMessageCell" title="${escapeHtml(r.error_message || r.result_summary || '')}">
						${escapeHtml(r.result_summary || r.error_message || '-')}
					</td>
				</tr>
			`).join('');
		} catch (err) {
			console.error('Load runs error:', err);
			$('runTableBody').innerHTML = '<tr><td colspan="6" class="pulseEmpty" style="text-align:center;color:var(--red);">加载失败</td></tr>';
		}
	}

	function openAddModal() {
		appState.editingTargetId = null;
		$('modalTitle').textContent = '添加签到项目';
		$('credentialHint').style.display = 'none';
		resetForm();
		$('targetModal').style.display = 'flex';
		updateTestButtonState();
		setTimeout(() => {
			$('customUrl').focus();
		}, 100);
	}

	function openEditModal(targetId) {
		const target = appState.targets.find(t => t.id === targetId);
		if (!target) return;

		appState.editingTargetId = targetId;
		$('modalTitle').textContent = '编辑签到项目';
		$('credentialHint').style.display = target.credential_secret_id ? 'flex' : 'none';

		$('formDisplayName').value = target.display_name;
		$('formEnabled').checked = target.enabled;

		appState.customHttpConfig = normalizeCustomHttpConfig(target.custom_http_config);
		renderCustomHttpForm();

		const schedule = appState.schedules.get(targetId);
		if (schedule) {
			$('formLocalTime').value = schedule.local_time || '08:00';
			$('formTimezone').value = schedule.timezone || 'Asia/Shanghai';
			$('formRetryCount').value = schedule.retry_count ?? 2;
			$('formRetryInterval').value = schedule.retry_interval_minutes ?? 5;
			$('formRandomDelay').value = schedule.random_delay_seconds ?? 0;

			const dayChecks = qsa('#formDaysOfWeek input');
			const days = schedule.days_of_week || [0,1,2,3,4,5,6];
			dayChecks.forEach(cb => {
				cb.checked = days.includes(parseInt(cb.value));
			});
		}

		updateTestButtonState();
		$('targetModal').style.display = 'flex';
	}

	function closeModal() {
		$('targetModal').style.display = 'none';
		appState.editingTargetId = null;
	}

	function resetForm() {
		appState.customHttpConfig = createEmptyCustomHttpConfig();
		$('formDisplayName').value = '';
		$('formLocalTime').value = '08:00';
		$('formTimezone').value = 'Asia/Shanghai';
		$('formRetryCount').value = 2;
		$('formRetryInterval').value = 5;
		$('formRandomDelay').value = 0;
		$('formEnabled').checked = true;
		qsa('#formDaysOfWeek input').forEach(cb => cb.checked = true);
		renderCustomHttpForm();
		$('customAdvancedSection').style.display = 'none';
		const toggleIcon = qs('#toggleAdvancedBtn svg');
		if (toggleIcon) toggleIcon.style.transform = '';
	}

	async function saveTarget() {
		const serviceKey = 'custom-http';
		const displayName = $('formDisplayName').value.trim();
		const enabled = $('formEnabled').checked;
		const localTime = $('formLocalTime').value;
		const timezone = $('formTimezone').value;
		const retryCount = parseInt($('formRetryCount').value) || 0;
		const retryInterval = parseInt($('formRetryInterval').value) || 5;
		const randomDelay = parseInt($('formRandomDelay').value) || 0;
		const dayChecks = qsa('#formDaysOfWeek input:checked');
		const daysOfWeek = dayChecks.map(cb => parseInt(cb.value));

		if (!displayName) {
			showToast('请输入账号名称', 'error');
			return;
		}
		if (!/^([01]?\d|2[0-3]):00$/.test(localTime)) {
			showToast('请选择整点时间', 'error');
			return;
		}
		if (daysOfWeek.length === 0) {
			showToast('请至少选择一天', 'error');
			return;
		}

		const customHttpConfig = collectCustomHttpConfig();
		if (!customHttpConfig.url || !customHttpConfig.url.startsWith('https://')) {
			showToast('请输入有效的 HTTPS 签到接口 URL', 'error');
			return;
		}
		if (!customHttpConfig.successRules || customHttpConfig.successRules.length === 0) {
			showToast('请至少配置一条成功判断规则', 'error');
			return;
		}

		const saveBtn = $('saveFormBtn');
		saveBtn.disabled = true;
		saveBtn.textContent = '保存中...';

		try {
			const body = {
				id: appState.editingTargetId,
				service_key: serviceKey,
				display_name: displayName,
				enabled,
				timezone,
				local_time: localTime,
				days_of_week: daysOfWeek,
				retry_count: Math.min(5, Math.max(0, retryCount)),
				retry_interval_minutes: Math.min(60, Math.max(1, retryInterval)),
				random_delay_seconds: Math.min(3600, Math.max(0, randomDelay)),
				custom_http_config: customHttpConfig
			};

			console.log('[saveTarget] 发送的完整请求体:', JSON.stringify(body, null, 2));
			const response = await callEdgeFunction('pulse-upsert-target', body);
			console.log('[saveTarget] 后端响应:', JSON.stringify(response, null, 2));
			showToast(appState.editingTargetId ? '已更新' : '已添加', 'success');
			closeModal();
			await loadAllData();
		} catch (err) {
			console.error('Save target error:', err);
			showToast(err.message || '保存失败', 'error');
		} finally {
			saveBtn.disabled = false;
			saveBtn.textContent = '保存';
		}
	}

	async function toggleTarget(targetId) {
		const target = appState.targets.find(t => t.id === targetId);
		if (!target) return;

		const newEnabled = !target.enabled;
		try {
			const { error } = await supabase
				.from('checkin_targets')
				.update({ enabled: newEnabled })
				.eq('id', targetId)
				.eq('user_id', appState.user.id);
			if (error) throw error;

			await supabase
				.from('checkin_schedules')
				.update({ enabled: newEnabled })
				.eq('target_id', targetId)
				.eq('user_id', appState.user.id);

			showToast(newEnabled ? '已启用' : '已暂停', 'success');
			await loadAllData();
		} catch (err) {
			console.error('Toggle error:', err);
			showToast('操作失败', 'error');
		}
	}

	async function deleteTarget(targetId) {
		if (!confirm('确定要删除这个签到项目吗？相关的执行记录也会被删除，此操作不可撤销。')) {
			return;
		}

		try {
			await callEdgeFunction('pulse-delete-target', { target_id: targetId }, 'DELETE');
			showToast('已删除', 'success');
			await loadAllData();
		} catch (err) {
			console.error('Delete error:', err);
			showToast(err.message || '删除失败', 'error');
		}
	}

	async function runNow(targetId, btnEl) {
		if (btnEl) {
			btnEl.classList.add('isRunning');
			btnEl.disabled = true;
		}

		try {
			showToast('已加入队列...', 'success');
			const result = await callEdgeFunction('pulse-run-now', { target_id: targetId });
			showToast(result.message || '签到已执行', 'success');

			setTimeout(() => loadAllData(), 1000);
			setTimeout(() => loadAllData(), 3000);
			setTimeout(() => loadAllData(), 6000);
		} catch (err) {
			console.error('Run now error:', err);
			showToast(err.message || '签到失败', 'error');
		} finally {
			if (btnEl) {
				btnEl.classList.remove('isRunning');
				btnEl.disabled = false;
			}
		}
	}

	function bindTargetActions(container) {
		qsa('.run-now-btn', container).forEach(btn => {
			btn.onclick = (e) => {
				e.stopPropagation();
				runNow(btn.dataset.id, btn);
			};
		});
		qsa('.edit-btn', container).forEach(btn => {
			btn.onclick = (e) => {
				e.stopPropagation();
				openEditModal(btn.dataset.id);
			};
		});
		qsa('.toggle-btn', container).forEach(btn => {
			btn.onclick = (e) => {
				e.stopPropagation();
				toggleTarget(btn.dataset.id);
			};
		});
		qsa('.delete-btn', container).forEach(btn => {
			btn.onclick = (e) => {
				e.stopPropagation();
				deleteTarget(btn.dataset.id);
			};
		});
	}

	function setupRefreshTimer() {
		clearRefreshTimer();
		const interval = parseInt($('settingsRefreshInterval')?.value || '30') * 1000;
		if (interval > 0) {
			appState.refreshTimer = setInterval(() => {
				loadAllData();
			}, interval);
		}
	}

	// 获取浏览器当前时区的可读名称（优先中文）
	function getBrowserTimezoneName() {
		try {
			const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
			const now = new Date();
			let names = [];
			try {
				const dtf = new Intl.DateTimeFormat('zh-CN', { timeZoneName: 'long' });
				names = dtf.formatToParts(now)
					.filter(p => p.type === 'timeZoneName')
					.map(p => p.value);
			} catch (e) {}
			const zhName = names[0] || '';
			if (zhName) {
				return resolved ? `自动：${zhName}（${resolved}）` : `自动：${zhName}`;
			}
			return resolved ? `自动：${resolved}` : '自动：浏览器时区';
		} catch (e) {
			return '自动：浏览器时区';
		}
	}

	// 「默认时区」设置：控制所有时间的显示（默认跟随浏览器时区）
	function loadTimezoneSetting() {
		const tzEl = $('settingsTimezone');
		if (!tzEl) return;
		// 动态填充“自动”选项的浏览器时区名
		const autoOpt = $('tzAutoOption');
		if (autoOpt) autoOpt.textContent = getBrowserTimezoneName();
		let tz = 'auto';
		try {
			tz = localStorage.getItem('pulseTimezone') || 'auto';
		} catch (e) {}
		tzEl.value = tz;
	}

	function saveTimezoneSetting() {
		const tzEl = $('settingsTimezone');
		if (!tzEl) return;
		const tz = tzEl.value || 'auto';
		try {
			localStorage.setItem('pulseTimezone', tz);
		} catch (e) {}
		// 时区变更后立即刷新展示
		loadAllData();
	}

	function clearRefreshTimer() {
		if (appState.refreshTimer) {
			clearInterval(appState.refreshTimer);
			appState.refreshTimer = null;
		}
	}

	function setupRealtime() {
		try {
			appState.realtimeSubscriptions.forEach(sub => {
				if (sub && sub.unsubscribe) sub.unsubscribe();
			});
			appState.realtimeSubscriptions = [];

			if (!appState.user) return;

			const channel = supabase.channel('pulse-changes')
				.on('postgres_changes', {
					event: '*',
					schema: 'public',
					table: 'checkin_runs',
					filter: `user_id=eq.${appState.user.id}`
				}, () => {
					loadAllData();
					const activePanel = qs('.pulseTabPanel.isActive');
					if (activePanel && activePanel.id === 'panel-runs') {
						loadRuns();
					}
				})
				.on('postgres_changes', {
					event: '*',
					schema: 'public',
					table: 'checkin_targets',
					filter: `user_id=eq.${appState.user.id}`
				}, () => {
					loadAllData();
				})
				.subscribe();

			appState.realtimeSubscriptions.push(channel);
		} catch (err) {
			console.warn('Realtime setup failed, using polling:', err);
		}
	}

	async function handleLogout() {
		try {
			clearRefreshTimer();
			appState.realtimeSubscriptions.forEach(sub => {
				if (sub && sub.unsubscribe) sub.unsubscribe();
			});
			appState.realtimeSubscriptions = [];
			if (window.authManager) {
				await window.authManager.signOut();
			}
		} catch (err) {
			console.error('Logout error:', err);
		}
	}

	// ========== 自定义 HTTP 事件处理 ==========
	function updateTestButtonState() {
		const btn = $('testConfigBtn');
		if (!btn) return;
		btn.style.display = 'inline-flex';
		btn.disabled = !appState.editingTargetId;
		btn.title = appState.editingTargetId ? '使用当前配置测试一次' : '保存后才能测试';
	}

	function addParam(category) {
		if (!appState.customHttpConfig) {
			appState.customHttpConfig = createEmptyCustomHttpConfig();
		}
		if (category === 'preRequestHeaders') {
			if (!appState.customHttpConfig.preRequest) {
				appState.customHttpConfig.preRequest = createEmptyCustomHttpConfig().preRequest;
			}
			appState.customHttpConfig.preRequest.extraHeaders.push({ key: '', value: '', sensitive: false });
		} else {
			appState.customHttpConfig[category].push({ key: '', value: '', sensitive: false });
		}
		renderCustomHttpForm();
	}

	function removeParam(row) {
		const category = row.dataset.category;
		const index = parseInt(row.dataset.index);
		if (!appState.customHttpConfig || !category) return;
		if (category === 'preRequestHeaders') {
			if (appState.customHttpConfig.preRequest && appState.customHttpConfig.preRequest.extraHeaders) {
				appState.customHttpConfig.preRequest.extraHeaders.splice(index, 1);
			}
		} else {
			appState.customHttpConfig[category].splice(index, 1);
		}
		renderCustomHttpForm();
	}

	function addExtractRule() {
		if (!appState.customHttpConfig) {
			appState.customHttpConfig = createEmptyCustomHttpConfig();
		}
		appState.customHttpConfig.extractRules.push({
			variableName: 'nonce',
			pattern: "ajax_nonce\\s*=\\s*'([^']+)'",
			flags: 'i',
			groupIndex: 1
		});
		renderCustomHttpForm();
	}

	function removeExtractRule(row) {
		const index = parseInt(row.dataset.index);
		if (!appState.customHttpConfig || isNaN(index)) return;
		appState.customHttpConfig.extractRules.splice(index, 1);
		renderCustomHttpForm();
	}

	function addRule(category, type) {
		if (!appState.customHttpConfig) {
			appState.customHttpConfig = createEmptyCustomHttpConfig();
		}
		appState.customHttpConfig[category].push(getDefaultRuleValue(type || 'status_range'));
		renderCustomHttpForm();
	}

	function removeRule(row) {
		const category = row.dataset.category;
		const index = parseInt(row.dataset.index);
		if (!appState.customHttpConfig || !category) return;
		appState.customHttpConfig[category].splice(index, 1);
		renderCustomHttpForm();
	}

	function addQuickAuth(type) {
		if (!appState.customHttpConfig) {
			appState.customHttpConfig = createEmptyCustomHttpConfig();
		}
		const headers = appState.customHttpConfig.headers;
		const existingIndex = headers.findIndex(h => h.key.toLowerCase() === type.toLowerCase());
		if (existingIndex >= 0) {
			headers[existingIndex].sensitive = true;
		} else {
			let label = type;
			if (type === 'authorization') label = 'Authorization';
			else if (type === 'cookie') label = 'Cookie';
			else if (type === 'x-api-key') label = 'X-API-Key';
			else if (type === 'token') label = 'Token';
			headers.push({ key: label, value: '', sensitive: true });
		}
		renderCustomHttpForm();
		$('customAdvancedSection').style.display = 'block';
		const toggleIcon = qs('#toggleAdvancedBtn svg');
		if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
	}

	function toggleAdvanced() {
		const section = $('customAdvancedSection');
		const icon = qs('#toggleAdvancedBtn svg');
		const isHidden = section.style.display === 'none';
		section.style.display = isHidden ? 'block' : 'none';
		if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : '';
	}

	async function testConfig() {
		if (!appState.editingTargetId) {
			showToast('请先保存项目，再点击测试', 'error');
			return;
		}
		const customHttpConfig = collectCustomHttpConfig();
		if (!customHttpConfig.url || !customHttpConfig.url.startsWith('https://')) {
			showToast('请输入有效的 HTTPS 签到接口 URL', 'error');
			return;
		}
		if (!customHttpConfig.successRules || customHttpConfig.successRules.length === 0) {
			showToast('请至少配置一条成功判断规则', 'error');
			return;
		}

		const btn = $('testConfigBtn');
		btn.disabled = true;
		btn.textContent = '测试中...';

		try {
			const result = await callEdgeFunction('pulse-run-now', {
				target_id: appState.editingTargetId,
				trigger_type: 'test',
				custom_http_config: customHttpConfig
			});
			showToast(result.message || '测试成功', 'success');
			loadAllData();
		} catch (err) {
			console.error('Test config error:', err);
			showToast(err.message || '测试失败', 'error');
		} finally {
			btn.disabled = false;
			btn.textContent = '测试配置';
		}
	}

	function handleRuleTypeChange(row, newType) {
		appState.customHttpConfig = collectCustomHttpConfig();
		const category = row.dataset.category;
		const index = parseInt(row.dataset.index);
		if (!appState.customHttpConfig || !category || isNaN(index)) return;
		appState.customHttpConfig[category][index] = getDefaultRuleValue(newType);
		renderCustomHttpForm();
	}

	function handleParamSensitiveChange(row, checked) {
		appState.customHttpConfig = collectCustomHttpConfig();
		const category = row.dataset.category;
		const index = parseInt(row.dataset.index);
		if (!appState.customHttpConfig || !category || isNaN(index)) return;
		appState.customHttpConfig[category][index].sensitive = checked;
		renderCustomHttpForm();
	}

	function bindEvents() {
		qsa('.pulseSidebarItem').forEach(item => {
			item.onclick = () => switchTab(item.dataset.tab);
		});

		loadTimezoneSetting();

		$('addTargetBtn').onclick = openAddModal;
		$('addTargetBtn2').onclick = openAddModal;
		$('closeModalBtn').onclick = closeModal;
		$('cancelFormBtn').onclick = closeModal;
		$('saveFormBtn').onclick = saveTarget;

		$('targetModal').onclick = (e) => {
			if (e.target === $('targetModal')) closeModal();
		};

		$('runFilterTarget').onchange = loadRuns;
		$('runFilterStatus').onchange = loadRuns;

		$('logoutBtn').onclick = handleLogout;
		$('refreshNowBtn').onclick = () => {
			loadAllData();
			showToast('已刷新', 'success');
		};

		$('settingsRefreshInterval').onchange = setupRefreshTimer;
		$('settingsTimezone').onchange = saveTimezoneSetting;

		// 自定义 HTTP 表单事件
		$('customMethod').onchange = updateBodyFieldsVisibility;
		$('customBodyType').onchange = updateBodyFieldsVisibility;

		$('toggleAdvancedBtn').onclick = toggleAdvanced;
		$('testConfigBtn').onclick = testConfig;

		qsa('[data-add-param]').forEach(btn => {
			btn.onclick = () => {
				const paramType = btn.dataset.addParam;
				if (paramType === 'query') addParam('queryParams');
				else if (paramType === 'header') addParam('headers');
				else if (paramType === 'body') addParam('bodyFields');
				else if (paramType === 'preRequestHeader') addParam('preRequestHeaders');
			};
		});

		$('addSuccessRuleBtn').onclick = () => addRule('successRules', 'status_range');
		$('addAlreadyCheckedInRuleBtn').onclick = () => addRule('alreadyCheckedInRules', 'text_contains');
		$('addAuthFailureRuleBtn').onclick = () => addRule('authFailureRules', 'status_code');
		$('addFailureRuleBtn').onclick = () => addRule('failureRules', 'text_contains');
		$('addExtractRuleBtn').onclick = addExtractRule;

		// 浏览器伪装开关
		$('browserEmulationEnabled').onchange = (e) => {
			$('browserEmulationFields').style.display = e.target.checked ? 'block' : 'none';
		};

		// 前置请求开关
		$('preRequestEnabled').onchange = (e) => {
			$('preRequestFields').style.display = e.target.checked ? 'block' : 'none';
		};

		qsa('#quickAuthButtons button').forEach(btn => {
			btn.onclick = () => addQuickAuth(btn.dataset.auth);
		});

		const customFields = $('customHttpFields');
		if (customFields) {
			customFields.onclick = (e) => {
				const removeBtn = e.target.closest('.remove-param');
				if (removeBtn) {
					const row = removeBtn.closest('.pulseParamRow');
					if (row) removeParam(row);
					return;
				}
				const removeRuleBtn = e.target.closest('.remove-rule');
				if (removeRuleBtn) {
					const row = removeRuleBtn.closest('.pulseRuleRow');
					if (row) removeRule(row);
					return;
				}
				const removeExtractBtn = e.target.closest('.remove-extract');
				if (removeExtractBtn) {
					const row = removeExtractBtn.closest('.pulseExtractRow');
					if (row) removeExtractRule(row);
					return;
				}
			};

			customFields.onchange = (e) => {
				const ruleSelect = e.target.closest('.rule-type');
				if (ruleSelect) {
					const row = ruleSelect.closest('.pulseRuleRow');
					if (row) handleRuleTypeChange(row, ruleSelect.value);
					return;
				}
				const sensitiveCheck = e.target.closest('.param-sensitive');
				if (sensitiveCheck) {
					const row = sensitiveCheck.closest('.pulseParamRow');
					if (row) handleParamSensitiveChange(row, sensitiveCheck.checked);
				}
			};
		}

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				if ($('targetModal').style.display === 'flex') {
					closeModal();
				}
			}
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initApp);
	} else {
		initApp();
	}
})();
