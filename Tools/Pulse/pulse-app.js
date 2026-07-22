(function() {
	'use strict';

	const SUPABASE_CONFIG = window.CK_SUPABASE_CONFIG || {};
	const FUNCTIONS_URL = `${SUPABASE_CONFIG.url}/functions/v1`;
	const supabase = window.supabaseClient;

	let appState = {
		user: null,
		services: [],
		targets: [],
		schedules: new Map(),
		runs: [],
		editingTargetId: null,
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

	function formatTime(isoString) {
		if (!isoString) return '-';
		try {
			const d = new Date(isoString);
			return d.toLocaleString('zh-CN', {
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit'
			});
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
		$('pulseLoading').style.display = 'none';
		$('pulseLogin').style.display = screen === 'login' ? 'flex' : 'none';
		$('pulseMain').style.display = screen === 'main' ? 'block' : 'none';
	}

	function switchTab(tabName) {
		qsa('.pulseTab').forEach(tab => {
			tab.classList.toggle('isActive', tab.dataset.tab === tabName);
		});
		qsa('.pulseTabPanel').forEach(panel => {
			panel.classList.toggle('isActive', panel.id === 'panel-' + tabName);
		});
		if (tabName === 'runs') {
			loadRuns();
		}
	}

	async function initApp() {
		try {
			if (!supabase) {
				setTimeout(initApp, 100);
				return;
			}

			if (!appState.eventsBound) {
				bindEvents();
				appState.eventsBound = true;
			}

			supabase.auth.onAuthStateChange((event, session) => {
				if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
					appState.user = session?.user || null;
					if (appState.user) {
						onLoggedIn();
					}
				} else if (event === 'SIGNED_OUT') {
					appState.user = null;
					clearRefreshTimer();
					if (appState.realtimeSubscriptions) {
						appState.realtimeSubscriptions.forEach(sub => {
							if (sub && sub.unsubscribe) sub.unsubscribe();
						});
						appState.realtimeSubscriptions = [];
					}
					showScreen('login');
				}
			});

			const { data: { session } } = await supabase.auth.getSession();
			appState.user = session?.user || null;

			if (appState.user) {
				onLoggedIn();
			} else {
				showScreen('login');
			}
		} catch (err) {
			console.error('Init error:', err);
			showScreen('login');
		}
	}

	async function onLoggedIn() {
		showScreen('main');
		await loadServices();
		await loadAllData();
		loadProfile();
		setupRefreshTimer();
		setupRealtime();
	}

	async function loadServices() {
		try {
			const data = await callEdgeFunction('pulse-get-services', null, 'GET');
			if (data && data.services) {
				appState.services = data.services;
				populateServiceSelect();
			}
		} catch (err) {
			console.error('Load services error:', err);
			appState.services = [{
				serviceKey: 'test-echo',
				displayName: '测试服务 (Echo)',
				description: '用于测试的模拟签到服务',
				credentialFields: [
					{ key: 'username', label: '用户名', type: 'text', placeholder: '任意用户名', required: true },
					{ key: 'shouldFail', label: '模拟失败', type: 'checkbox', required: false }
				],
				publicConfigFields: []
			}];
			populateServiceSelect();
		}
	}

	function populateServiceSelect() {
		const selects = [$('formService')];
		selects.forEach(sel => {
			if (!sel) return;
			sel.innerHTML = '<option value="">请选择服务</option>';
			appState.services.forEach(svc => {
				const opt = document.createElement('option');
				opt.value = svc.serviceKey;
				opt.textContent = svc.displayName;
				sel.appendChild(opt);
			});
		});

		const filterSelect = $('runFilterTarget');
		if (filterSelect) {
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
	}

	function renderServiceFields(serviceKey, existingCredentials, existingPublicConfig, isEdit) {
		const container = $('serviceFields');
		container.innerHTML = '';
		const svc = appState.services.find(s => s.serviceKey === serviceKey);
		if (!svc) return;

		(svc.credentialFields || []).forEach(field => {
			const fieldDiv = document.createElement('div');
			fieldDiv.className = 'pulseField';
			const label = document.createElement('label');
			label.textContent = field.label + (field.required ? ' *' : '');
			fieldDiv.appendChild(label);

			let input;
			if (field.type === 'textarea') {
				input = document.createElement('textarea');
				input.className = 'pulseInput';
				input.rows = 3;
			} else if (field.type === 'checkbox') {
				input = document.createElement('input');
				input.type = 'checkbox';
				input.style.width = 'auto';
				input.style.height = 'auto';
			} else {
				input = document.createElement('input');
				input.type = field.type === 'password' ? 'password' : (field.type || 'text');
				input.className = 'pulseInput';
			}
			input.id = 'cred_' + field.key;
			input.name = field.key;
			input.placeholder = field.placeholder || '';
			input.dataset.fieldType = 'credential';

			if (isEdit && field.type !== 'checkbox') {
				input.placeholder = '•••••••• (留空不修改)';
			}
			if (existingCredentials && existingCredentials[field.key] !== undefined && field.type === 'checkbox') {
				input.checked = !!existingCredentials[field.key];
			}

			fieldDiv.appendChild(input);
			container.appendChild(fieldDiv);
		});

		(svc.publicConfigFields || []).forEach(field => {
			const fieldDiv = document.createElement('div');
			fieldDiv.className = 'pulseField';
			const label = document.createElement('label');
			label.textContent = field.label + (field.required ? ' *' : '');
			fieldDiv.appendChild(label);

			let input;
			if (field.type === 'select') {
				input = document.createElement('select');
				input.className = 'pulseSelect';
				(field.options || []).forEach(opt => {
					const option = document.createElement('option');
					option.value = opt.value;
					option.textContent = opt.label;
					input.appendChild(option);
				});
			} else if (field.type === 'checkbox') {
				input = document.createElement('input');
				input.type = 'checkbox';
				input.style.width = 'auto';
				input.style.height = 'auto';
			} else {
				input = document.createElement('input');
				input.type = field.type || 'text';
				input.className = 'pulseInput';
			}
			input.id = 'pub_' + field.key;
			input.name = field.key;
			input.placeholder = field.placeholder || '';
			input.dataset.fieldType = 'public';
			if (existingPublicConfig && existingPublicConfig[field.key] !== undefined) {
				if (field.type === 'checkbox') {
					input.checked = !!existingPublicConfig[field.key];
				} else {
					input.value = existingPublicConfig[field.key];
				}
			} else if (field.defaultValue !== undefined) {
				if (field.type === 'checkbox') {
					input.checked = !!field.defaultValue;
				} else {
					input.value = field.defaultValue;
				}
			}
			fieldDiv.appendChild(input);
			container.appendChild(fieldDiv);
		});
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
					checkin_schedules (*)
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
		const svc = appState.services.find(s => s.serviceKey === serviceKey);
		return svc ? svc.displayName : serviceKey;
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
		setTimeout(() => $('formService').focus(), 100);
	}

	function openEditModal(targetId) {
		const target = appState.targets.find(t => t.id === targetId);
		if (!target) return;

		appState.editingTargetId = targetId;
		$('modalTitle').textContent = '编辑签到项目';
		$('credentialHint').style.display = target.credential_secret_id ? 'flex' : 'none';

		$('formService').value = target.service_key;
		$('formDisplayName').value = target.display_name;
		renderServiceFields(target.service_key, {}, target.public_config || {}, true);
		$('formEnabled').checked = target.enabled;

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

		$('targetModal').style.display = 'flex';
	}

	function closeModal() {
		$('targetModal').style.display = 'none';
		appState.editingTargetId = null;
	}

	function resetForm() {
		$('formService').value = '';
		$('formDisplayName').value = '';
		$('serviceFields').innerHTML = '';
		$('formLocalTime').value = '08:00';
		$('formTimezone').value = 'Asia/Shanghai';
		$('formRetryCount').value = 2;
		$('formRetryInterval').value = 5;
		$('formRandomDelay').value = 0;
		$('formEnabled').checked = true;
		qsa('#formDaysOfWeek input').forEach(cb => cb.checked = true);
	}

	async function saveTarget() {
		const serviceKey = $('formService').value;
		const displayName = $('formDisplayName').value.trim();
		const enabled = $('formEnabled').checked;
		const localTime = $('formLocalTime').value;
		const timezone = $('formTimezone').value;
		const retryCount = parseInt($('formRetryCount').value) || 0;
		const retryInterval = parseInt($('formRetryInterval').value) || 5;
		const randomDelay = parseInt($('formRandomDelay').value) || 0;
		const dayChecks = qsa('#formDaysOfWeek input:checked');
		const daysOfWeek = dayChecks.map(cb => parseInt(cb.value));

		if (!serviceKey) {
			showToast('请选择签到服务', 'error');
			return;
		}
		if (!displayName) {
			showToast('请输入账号名称', 'error');
			return;
		}
		if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(localTime)) {
			showToast('请输入有效的时间', 'error');
			return;
		}
		if (daysOfWeek.length === 0) {
			showToast('请至少选择一天', 'error');
			return;
		}

		const credentials = {};
		const publicConfig = {};
		qsa('#serviceFields input, #serviceFields textarea, #serviceFields select').forEach(input => {
			const key = input.name;
			const isCredential = input.dataset.fieldType === 'credential';
			if (input.type === 'checkbox') {
				if (isCredential) {
					credentials[key] = input.checked;
				} else {
					publicConfig[key] = input.checked;
				}
			} else {
				const val = input.value;
				if (val && val.length > 0) {
					if (isCredential) {
						credentials[key] = val;
					} else {
						publicConfig[key] = val;
					}
				}
			}
		});

		const saveBtn = $('saveFormBtn');
		saveBtn.disabled = true;
		saveBtn.textContent = '保存中...';

		try {
			const body = {
				id: appState.editingTargetId,
				service_key: serviceKey,
				display_name: displayName,
				enabled,
				credentials,
				public_config: publicConfig,
				timezone,
				local_time: localTime,
				days_of_week: daysOfWeek,
				retry_count: Math.min(5, Math.max(0, retryCount)),
				retry_interval_minutes: Math.min(60, Math.max(1, retryInterval)),
				random_delay_seconds: Math.min(3600, Math.max(0, randomDelay))
			};

			await callEdgeFunction('pulse-upsert-target', body);
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

	async function loadProfile() {
		try {
			if (appState.user) {
				$('settingsEmail').textContent = appState.user.email || '-';

				const { data: profile } = await supabase
					.from('user_profiles')
					.select('username')
					.eq('user_id', appState.user.id)
					.maybeSingle();

				if (profile && profile.username) {
					$('settingsUsername').value = profile.username;
				}
			}
		} catch (err) {
			console.log('Profile load:', err);
		}
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

	async function saveUsername() {
		const username = $('settingsUsername').value.trim();
		const saveBtn = $('saveUsernameBtn');

		try {
			const { error } = await supabase
				.from('user_profiles')
				.upsert({
					user_id: appState.user.id,
					username: username || null,
					updated_at: new Date().toISOString()
				}, {
					onConflict: 'user_id'
				});
			if (error) throw error;
			showToast('用户名已保存', 'success');
			saveBtn.disabled = true;
		} catch (err) {
			console.error('Save username error:', err);
			showToast('保存失败', 'error');
		}
	}

	async function handleLogin(e) {
		e.preventDefault();
		const email = $('loginEmail').value.trim();
		const password = $('loginPassword').value;
		const statusEl = $('loginStatus');
		const loginBtn = $('loginBtn');

		if (!email || !password) {
			statusEl.textContent = '请输入邮箱和密码';
			statusEl.className = 'pulseLoginStatus isError';
			return;
		}

		loginBtn.disabled = true;
		statusEl.textContent = '登录中...';
		statusEl.className = 'pulseLoginStatus';

		try {
			const { data, error } = await supabase.auth.signInWithPassword({
				email, password
			});
			if (error) throw error;
			if (data.user) {
				statusEl.textContent = '登录成功';
				statusEl.className = 'pulseLoginStatus isSuccess';
			}
		} catch (err) {
			console.error('Login error:', err);
			statusEl.textContent = err.message || '登录失败';
			statusEl.className = 'pulseLoginStatus isError';
		} finally {
			loginBtn.disabled = false;
		}
	}

	async function handleSignup(e) {
		e.preventDefault();
		const email = $('loginEmail').value.trim();
		const password = $('loginPassword').value;
		const statusEl = $('loginStatus');
		const loginBtn = $('loginBtn');

		if (!email || !password) {
			statusEl.textContent = '请输入邮箱和密码';
			statusEl.className = 'pulseLoginStatus isError';
			return;
		}
		if (password.length < 6) {
			statusEl.textContent = '密码至少6位';
			statusEl.className = 'pulseLoginStatus isError';
			return;
		}

		loginBtn.disabled = true;
		statusEl.textContent = '注册中...';
		statusEl.className = 'pulseLoginStatus';

		try {
			const { data, error } = await supabase.auth.signUp({ email, password });
			if (error) throw error;
			statusEl.textContent = '注册成功，请检查邮箱验证后登录';
			statusEl.className = 'pulseLoginStatus isSuccess';
		} catch (err) {
			console.error('Signup error:', err);
			statusEl.textContent = err.message || '注册失败';
			statusEl.className = 'pulseLoginStatus isError';
		} finally {
			loginBtn.disabled = false;
		}
	}

	async function handleLogout() {
		try {
			clearRefreshTimer();
			appState.realtimeSubscriptions.forEach(sub => {
				if (sub && sub.unsubscribe) sub.unsubscribe();
			});
			appState.realtimeSubscriptions = [];
			await supabase.auth.signOut();
		} catch (err) {
			console.error('Logout error:', err);
		}
	}

	async function handleForgotPassword(e) {
		e.preventDefault();
		const email = $('loginEmail').value.trim();
		const statusEl = $('loginStatus');
		if (!email) {
			statusEl.textContent = '请先输入邮箱';
			statusEl.className = 'pulseLoginStatus isError';
			return;
		}
		try {
			const { error } = await supabase.auth.resetPasswordForEmail(email);
			if (error) throw error;
			statusEl.textContent = '重置密码邮件已发送，请检查邮箱';
			statusEl.className = 'pulseLoginStatus isSuccess';
		} catch (err) {
			statusEl.textContent = err.message || '发送失败';
			statusEl.className = 'pulseLoginStatus isError';
		}
	}

	function bindEvents() {
		$('loginBtn').onclick = handleLogin;
		$('signupLink').onclick = handleSignup;
		$('forgotPasswordLink').onclick = handleForgotPassword;

		qsa('.pulseTab').forEach(tab => {
			tab.onclick = () => switchTab(tab.dataset.tab);
		});

		$('addTargetBtn').onclick = openAddModal;
		$('addTargetBtn2').onclick = openAddModal;
		$('closeModalBtn').onclick = closeModal;
		$('cancelFormBtn').onclick = closeModal;
		$('saveFormBtn').onclick = saveTarget;

		$('targetModal').onclick = (e) => {
			if (e.target === $('targetModal')) closeModal();
		};

		$('formService').onchange = () => {
			const svcKey = $('formService').value;
			renderServiceFields(svcKey, {}, {}, !!appState.editingTargetId);
		};

		$('runFilterTarget').onchange = loadRuns;
		$('runFilterStatus').onchange = loadRuns;

		$('logoutBtn').onclick = handleLogout;
		$('refreshNowBtn').onclick = () => {
			loadAllData();
			showToast('已刷新', 'success');
		};
		$('saveUsernameBtn').onclick = saveUsername;

		$('settingsUsername').oninput = () => {
			const original = '';
			$('saveUsernameBtn').disabled = $('settingsUsername').value.trim() === original;
		};

		$('settingsRefreshInterval').onchange = setupRefreshTimer;

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
