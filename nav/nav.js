(function() {
	"use strict";

	function detectSiteScope() {
		if (window.getCurrentSiteScope) {
			return window.getCurrentSiteScope();
		}
		var path = window.location.pathname || "/";
		var segments = path.split("/").filter(function(s) { return s && s !== "index.html"; });
		if (segments.length === 0) {
			return "home";
		}
		var scopeSegments = segments.slice(0, 2);
		return scopeSegments.join("-");
	}

	var NAV_HTML = [
		'<header class="siteHeader">',
		'	<div class="siteHeaderLeft">',
		'		<img class="siteHeaderLogo" src="/favicon.svg?v=0349" alt="Logo" aria-hidden="true">',
		'		<span class="siteHeaderName">Ckarefulon</span>',
		'	</div>',
		'	<div class="siteHeaderRight">',
		'		<button id="siteThemeToggle" class="siteHeaderBtn siteHeaderBtnTheme" type="button" title="切换主题">☀</button>',
		'		<div class="donateEntry" id="donateEntry">',
		'			<button id="siteDonateBtn" class="siteHeaderBtn siteDonateBtn" type="button" title="捐赠">',
		'				<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
		'				<span class="donateBtnLabel">捐赠</span>',
		'			</button>',
		'			<div id="donateMenu" class="donateMenu">',
'				<div class="donateImageWrap" title="微信赞赏码">',
'					<object class="donateImage" type="image/svg+xml" data="/nav/Reward.svg"></object>',
'					<span class="donateImageOverlay"></span>',
		'				</div>',
		'				<div class="donateText">君之分文，亦为至劲之励！</div>',
		'			</div>',
		'		</div>',
		'		<div class="guestEntry" id="guestEntry">',
		'			<button id="siteLoginBtn" class="siteHeaderBtn" type="button">登录</button>',
		'			<div id="guestTooltip" class="guestTooltip">',
		'				<div class="guestTooltipTitle">当前为游客模式</div>',
		'				<ul class="guestTooltipList">',
		'					<li>可以正常使用网站</li>',
		'					<li>个人数据需自行保存</li>',
		'				</ul>',
		'				<button id="siteDownloadBtn" class="siteHeaderBtn" type="button">下载数据</button>',
		'				<button id="siteImportBtn" class="siteHeaderBtn" type="button">导入数据</button>',
		'			</div>',
		'		</div>',
		'		<div class="guestEntry" id="userEntry" style="display:none">',
		'			<button id="siteAvatar" class="siteAvatar" type="button" title="账户菜单" aria-label="账户菜单" aria-haspopup="true" aria-expanded="false"><img id="siteAvatarImage" class="siteAvatarImage" alt="" hidden><span id="siteAvatarFallback">?</span></button>',
		'			<div id="accountMenu" class="accountMenu">',
		'				<div class="accountMenuEmail" id="accountMenuEmail"></div>',
		'				<div class="accountMenuScope" id="accountMenuScope"></div>',
		'				<button id="siteProfileBtn" class="siteHeaderBtn accountMenuProfileBtn" type="button">个人资料</button>',
		'				<button id="siteSignOutBtn" class="siteHeaderBtn" type="button">退出登录</button>',
		'				<div class="accountMenuCloud" id="accountMenuCloud">',
		'					<div class="accountMenuDivider"></div>',
		'					<div class="accountMenuCloudTitle">云端数据</div>',
		'					<div class="accountMenuCloudStatus" id="cloudStatus">暂无可恢复的覆盖前状态</div>',
		'					<div class="accountMenuCloudActions">',
		'						<button id="cloudRollbackBtn" class="cloudIconBtn" type="button" title="回到未覆盖前状态" aria-label="回到未覆盖前状态"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20a9 9 0 0 0-9-11H4"/></svg></button>',
		'						<button id="cloudUploadBtn" class="cloudIconBtn" type="button" title="上传本地数据到云端"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>',
		'						<button id="cloudDownloadBtn" class="cloudIconBtn" type="button" title="从云端恢复到本地"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>',
		'						<button id="cloudSaveLocalBtn" class="cloudIconBtn" type="button" title="下载数据自行保存"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg></button>',
		'						<button id="cloudImportLocalBtn" class="cloudIconBtn" type="button" title="导入自行保存的数据"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 12 15 15"/></svg></button>',
		'					</div>',
		'				</div>',
		'			</div>',
		'		</div>',
		'	</div>',
		'</header>',
		'<div class="loginOverlay" id="loginOverlay">',
		'	<div class="loginPanel">',
		'		<div class="loginPanelTitle">',
		'			登录',
		'			<button class="loginPanelClose" id="loginPanelClose" type="button" title="关闭">&times;</button>',
		'		</div>',
		'		<div class="loginField">',
		'			<label for="loginAccount">邮箱 / 用户名</label>',
		'			<input type="text" id="loginAccount" placeholder="请输入邮箱或用户名" autocomplete="username" autocapitalize="off" spellcheck="false">',
		'		</div>',
		'		<div class="loginField">',
		'			<label for="loginPassword">密码</label>',
		'			<input type="password" id="loginPassword" placeholder="请输入密码" autocomplete="current-password">',
		'		</div>',
		'		<div class="loginActions">',
		'			<button id="loginSubmitBtn" class="siteHeaderBtn loginBtnPrimary" type="button">登录</button>',
		'			<button id="loginRegisterBtn" class="siteHeaderBtn" type="button">注册</button>',
		'		</div>',
		'		<div class="loginStatus" id="loginStatus"></div>',
		'	</div>',
		'</div>',
		'<div class="confirmOverlay" id="confirmOverlay">',
		'	<div class="confirmPanel">',
		'		<div class="confirmTitle" id="confirmTitle"></div>',
		'		<div class="confirmMessage" id="confirmMessage"></div>',
		'		<div class="confirmActions">',
		'			<button id="confirmCancelBtn" class="siteHeaderBtn" type="button">取消</button>',
		'			<button id="confirmOkBtn" class="siteHeaderBtn confirmDangerBtn" type="button">确认</button>',
		'		</div>',
		'	</div>',
		'</div>',
		'<input type="file" id="siteImportFileInput" accept=".json,application/json" hidden>'
	].join("");

	function renderNav() {
		if (document.querySelector(".siteHeader")) {
			return;
		}
		var wrapper = document.createElement("div");
		var fragment = document.createDocumentFragment();
		wrapper.innerHTML = NAV_HTML;
		while (wrapper.firstChild) {
			fragment.appendChild(wrapper.firstChild);
		}
		document.body.insertBefore(fragment, document.body.firstChild);
	}

	function init(app) {
		renderNav();
		if (document.body.dataset.siteNavBound === "1") {
			return;
		}
		document.body.dataset.siteNavBound = "1";
		bindNav(app || {});
	}

	function bindNav(app) {
		var siteThemeBtn = document.getElementById("siteThemeToggle");
		if (siteThemeBtn) {
			var currentTheme = document.documentElement.dataset.theme || "light";
			siteThemeBtn.textContent = currentTheme === "dark" ? "☀" : "☾";
			siteThemeBtn.addEventListener("click", function() {
				var now = document.documentElement.dataset.theme || "light";
				if (typeof app.setTheme === "function") {
					app.setTheme(now === "dark" ? "light" : "dark");
				}
			});
		}

		var loginOverlay = document.getElementById("loginOverlay");
		var loginAccount = document.getElementById("loginAccount");
		var loginPassword = document.getElementById("loginPassword");
		var loginStatus = document.getElementById("loginStatus");
		var loginSubmitBtn = document.getElementById("loginSubmitBtn");
		var loginRegisterBtn = document.getElementById("loginRegisterBtn");
		var loginPanelClose = document.getElementById("loginPanelClose");

		function openLoginPanel() {
			if (loginOverlay) { loginOverlay.classList.add("isVisible"); }
			if (loginStatus) { loginStatus.textContent = ""; loginStatus.className = "loginStatus"; }
			if (loginAccount) { loginAccount.value = ""; }
			if (loginPassword) { loginPassword.value = ""; }
			if (loginAccount) { setTimeout(function() { loginAccount.focus(); }, 100); }
		}

		function closeLoginPanel() {
			if (loginOverlay) { loginOverlay.classList.remove("isVisible"); }
		}

		function setLoginStatus(text, type) {
			if (!loginStatus) return;
			loginStatus.textContent = text;
			loginStatus.className = "loginStatus" + (type ? " is" + type.charAt(0).toUpperCase() + type.slice(1) : "");
		}

		function doAuth(action) {
			var account = (loginAccount && loginAccount.value || "").trim();
			var password = loginPassword && loginPassword.value || "";
			if (!account || !password) {
				setLoginStatus(action === "signUp" ? "请输入邮箱和密码" : "请输入账号和密码", "Error");
				return;
			}
			if (!window.authManager) {
				setLoginStatus("Supabase 配置未完成", "Error");
				return;
			}
			if (action === "signUp" && account.indexOf("@") < 0) {
				setLoginStatus("注册请使用邮箱地址", "Error");
				return;
			}
			setLoginStatus("请稍候...", "");
			if (action === "signUp") {
				window.authManager.signUp(account, password).then(function(result) {
					setLoginStatus(result.message, result.success ? "Success" : "Error");
					if (result.success) {
						setTimeout(closeLoginPanel, 1500);
					}
				});
			} else {
				var isEmail = account.indexOf("@") >= 0;
				var loginPromise = isEmail
					? window.authManager.signIn(account, password)
					: window.authManager.signInWithUsername(account, password);
				loginPromise.then(function(result) {
					setLoginStatus(result.message, result.success ? "Success" : "Error");
					if (result.success) {
						setTimeout(closeLoginPanel, 1000);
					}
				});
			}
		}

		if (loginSubmitBtn) {
			loginSubmitBtn.addEventListener("click", function() { doAuth("signIn"); });
		}
		if (loginRegisterBtn) {
			loginRegisterBtn.addEventListener("click", function() { doAuth("signUp"); });
		}
		if (loginPanelClose) {
			loginPanelClose.addEventListener("click", closeLoginPanel);
		}
		if (loginOverlay) {
			loginOverlay.addEventListener("click", function(e) {
				if (e.target === loginOverlay) { closeLoginPanel(); }
			});
		}
		if (loginPassword) {
			loginPassword.addEventListener("keydown", function(e) {
				if (e.key === "Enter") { doAuth("signIn"); }
			});
		}

		var loginBtn = document.getElementById("siteLoginBtn");
		var tooltip = document.getElementById("guestTooltip");
		var hideTimer = null;

		function showTooltip() {
			if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
			if (tooltip) { tooltip.classList.add("isVisible"); }
		}

		function hideTooltip() {
			hideTimer = setTimeout(function() {
				if (tooltip) { tooltip.classList.remove("isVisible"); }
			}, 200);
		}

		function cancelHide() {
			if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
		}

		if (loginBtn) {
			loginBtn.addEventListener("click", openLoginPanel);
			loginBtn.addEventListener("mouseenter", showTooltip);
			loginBtn.addEventListener("mouseleave", hideTooltip);
			loginBtn.addEventListener("touchstart", function(e) {
				e.stopPropagation();
				if (tooltip && !tooltip.classList.contains("isVisible")) {
					showTooltip();
				} else {
					hideTooltip();
				}
			}, { passive: false });
		}

		if (tooltip) {
			tooltip.addEventListener("mouseenter", cancelHide);
			tooltip.addEventListener("mouseleave", hideTooltip);
		}

	var avatar = document.getElementById("siteAvatar");
	var accountMenu = document.getElementById("accountMenu");
	var signOutBtn = document.getElementById("siteSignOutBtn");
	var profileBtn = document.getElementById("siteProfileBtn");

	function goToProfile() {
		window.location.href = "/user/profile/";
	}

	function showAccountMenu() {
		if (accountMenu) {
			accountMenu.classList.add("isVisible");
			if (avatar) { avatar.setAttribute("aria-expanded", "true"); }
		}
	}

	// cloudStatus 为 Warning / Error 时强制保持菜单展开，
	// 外部点击与 Esc 不能关闭；头像点击可强制关闭并清空待办状态。
	var _menuLocked = false;

	function hideAccountMenu(force) {
		var wasLocked = _menuLocked;
		// 非强制关闭（外部点击 / Esc）时，锁定状态下保持菜单展开
		// 强制关闭（头像点击 force=true）可突破锁定
		if (!force && _menuLocked) {
			showAccountMenu();
			return;
		}
		if (accountMenu) {
			accountMenu.classList.remove("isVisible");
			if (avatar) { avatar.setAttribute("aria-expanded", "false"); }
		}
		_menuLocked = false;
		// 仅在从锁定状态（Warning/Error）强制关闭时，清空待办并恢复 cloudStatus 为中性文案
		// 普通关闭不动 cloudStatus，保留 Success 等正常状态文案
		if (force && wasLocked && typeof refreshRollbackAvailability === "function") {
			refreshRollbackAvailability(true);
		}
	}

	function toggleAccountMenu() {
		if (accountMenu && accountMenu.classList.contains("isVisible")) {
			hideAccountMenu(true);
		} else {
			showAccountMenu();
		}
	}

	if (avatar) {
		avatar.addEventListener("click", function(e) {
			e.stopPropagation();
			// 关闭其他下拉菜单，保证同一时间只有一个打开
			if (donateMenu && donateMenu.classList.contains("isVisible")) {
				donateMenu.classList.remove("isVisible");
			}
			toggleAccountMenu();
		});
	}

	if (profileBtn) {
		profileBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			hideAccountMenu();
			goToProfile();
		});
	}

	if (accountMenu) {
		accountMenu.addEventListener("click", function(e) {
			e.stopPropagation();
		});
	}

		var donateBtn = document.getElementById("siteDonateBtn");
		var donateMenu = document.getElementById("donateMenu");

		if (donateBtn) {
			donateBtn.addEventListener("click", function(e) {
				e.stopPropagation();
				// 关闭账户菜单，保证同一时间只有一个下拉打开
				hideAccountMenu();
				if (_menuLocked) return;
				if (donateMenu) {
					donateMenu.classList.toggle("isVisible");
				}
			});
		}

		if (donateMenu) {
			donateMenu.addEventListener("click", function(e) {
				e.stopPropagation();
			});
		}

	document.addEventListener("click", function(e) {
		// 头像与账户菜单内部点击已 stopPropagation，到这里的都是“外部点击”
		if (accountMenu && accountMenu.classList.contains("isVisible")) {
			hideAccountMenu();
		}
		if (donateMenu && donateMenu.classList.contains("isVisible")) {
			if (e.target !== donateBtn && !donateMenu.contains(e.target)) {
				donateMenu.classList.remove("isVisible");
			}
		}
	});

	// Esc 键关闭所有下拉菜单（尊重锁定；确认对话框自身有独立 Esc 处理且优先）
	document.addEventListener("keydown", function(e) {
		if (e.key === "Escape") {
			// 确认对话框打开时，Esc 只关对话框，不关菜单
			var confirmOv = document.getElementById("confirmOverlay");
			if (confirmOv && confirmOv.classList.contains("isVisible")) return;
			hideAccountMenu(); // 尊重 _menuLocked
			if (donateMenu) { donateMenu.classList.remove("isVisible"); }
		}
	});

		if (signOutBtn) {
			signOutBtn.addEventListener("click", function() {
				if (window.authManager) {
					window.authManager.signOut();
				}
			});
		}

		var accountMenuScope = document.getElementById("accountMenuScope");
		if (accountMenuScope) {
			var currentScope = detectSiteScope();
			accountMenuScope.textContent = "站点作用域：" + currentScope;
		}

		var cloudStatusEl = document.getElementById("cloudStatus");
		var cloudRollbackBtn = document.getElementById("cloudRollbackBtn");
		var cloudUploadBtn = document.getElementById("cloudUploadBtn");
		var cloudDownloadBtn = document.getElementById("cloudDownloadBtn");
		var PRE_OVERWRITE_PREFIX = "__siteNav_preOverwrite_v1:";
		var SKIP_AUTO_DOWNLOAD_PREFIX = "__siteNav_skipAutoDownloadOnce_v1:";

	function getSiteStorageKey(prefix) {
		return prefix + encodeURIComponent(detectSiteScope());
	}
	function skipNextAutomaticDownload() {
		try {
			sessionStorage.setItem(getSiteStorageKey(SKIP_AUTO_DOWNLOAD_PREFIX), "1");
		} catch (e) {}
	}

	function consumeAutomaticDownloadSkip() {
		try {
			var key = getSiteStorageKey(SKIP_AUTO_DOWNLOAD_PREFIX);
			if (sessionStorage.getItem(key) !== "1") return false;
			sessionStorage.removeItem(key);
			return true;
		} catch (e) {
			return false;
		}
	}

	function buildCurrentLocalPayload() {
		if (window.cloudSyncManager && typeof window.cloudSyncManager.buildLocalPayload === "function") {
			return window.cloudSyncManager.buildLocalPayload();
		}
		var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";
		var basePath = window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : "/Cube/Formula";
		var mem = window.storageManager ? window.storageManager.getJson("cube_memory_progress", null) : null;
		var entries = window.storageManager ? window.storageManager.getJson("smartCubeFormulaEntries", []) : [];
		var stateImportText = window.storageManager ? window.storageManager.getItem("smartCubeStateImportText", "") : "";
		return {
			exportedAt: new Date().toISOString(),
			source: "Ckarefulon",
			siteScope: scope,
			siteBasePath: basePath,
			version: 1,
			data: {
				cube_memory_progress: mem,
				smartCubeFormulaEntries: entries,
				smartCubeStateImportText: stateImportText
			}
		};
	}

	function getPreOverwriteSnapshot() {
		try {
			var raw = localStorage.getItem(getSiteStorageKey(PRE_OVERWRITE_PREFIX));
			if (!raw) return null;
			var snapshot = JSON.parse(raw);
			if (!snapshot || !snapshot.payload || !snapshot.payload.data) return null;
			if (snapshot.siteScope && snapshot.siteScope !== detectSiteScope()) return null;
			return snapshot;
		} catch (e) {
			return null;
		}
	}

	// 在任何本地覆盖发生前保存完整站点数据。快照放在 localStorage，刷新后仍可恢复。
	function prepareLocalOverwrite(reason, replacementData, details) {
		try {
			var currentPayload = buildCurrentLocalPayload();
			if (replacementData && JSON.stringify(currentPayload.data) === JSON.stringify(replacementData)) {
				return { success: true, saved: false };
			}
			var snapshot = {
				version: 1,
				savedAt: new Date().toISOString(),
				reason: reason || "数据覆盖",
				details: details || null,
				siteScope: currentPayload.siteScope || detectSiteScope(),
				payload: currentPayload
			};
			localStorage.setItem(getSiteStorageKey(PRE_OVERWRITE_PREFIX), JSON.stringify(snapshot));
			refreshRollbackAvailability(false);
			return { success: true, saved: true, snapshot: snapshot };
		} catch (e) {
			console.error("[Nav] 保存覆盖前状态失败:", e);
			return { success: false, saved: false, message: "无法保存覆盖前状态，已取消覆盖以防止数据丢失" };
		}
	}

	// cloudStatus 统一状态文案 + 可点击的待办动作
	// 用法：setCloudStatus("文案", "Warning", { dialog:{...}, onConfirm:fn })
	//   type 为 "Warning" / "Error" 时自动展开并锁定菜单
	//   传入 action 后，cloudStatus 文字变为可点击，点击弹出确认对话框
	var _cloudStatusAction = null;
	// 各按钮与 key 的映射，用于在待办激活时给对应按钮加黄色 warning 标记
	var _cloudBtnByKey = {
		rollback: cloudRollbackBtn,
		upload: cloudUploadBtn,
		download: cloudDownloadBtn,
		import: null // import 按钮在 cloudImportLocalBtn 绑定时已知，稍后注入
	};

	function setCloudStatus(text, type, action) {
		if (!cloudStatusEl) return;
		cloudStatusEl.textContent = text;
		cloudStatusEl.className = "accountMenuCloudStatus" + (type ? " is" + type.charAt(0).toUpperCase() + type.slice(1) : "");
		// 先清除所有按钮的 warning 标记
		Object.keys(_cloudBtnByKey).forEach(function(k) {
			var btn = _cloudBtnByKey[k];
			if (btn) { btn.classList.remove("isPendingConfirm"); }
		});
		_cloudStatusAction = action || null;
		if (_cloudStatusAction) {
			cloudStatusEl.classList.add("isActionable");
			// 给对应原始按钮加黄色 warning 标记
			var targetBtn = _cloudStatusAction.key && _cloudBtnByKey[_cloudStatusAction.key];
			if (targetBtn) { targetBtn.classList.add("isPendingConfirm"); }
		} else {
			cloudStatusEl.classList.remove("isActionable");
		}
		// Warning / Error 锁定菜单；其它状态解锁
		_menuLocked = (type === "Warning" || type === "Error");
		if (_menuLocked) {
			showAccountMenu();
		}
	}
	function refreshRollbackAvailability(updateStatus) {
		var snapshot = getPreOverwriteSnapshot();
		if (cloudRollbackBtn) {
			cloudRollbackBtn.disabled = !snapshot;
			cloudRollbackBtn.title = snapshot ? "回到未覆盖前状态" : "暂无可恢复的覆盖前状态";
		}
		if (updateStatus) {
			setCloudStatus(snapshot ? "已保留覆盖前状态" : "暂无可恢复的覆盖前状态", snapshot ? "Success" : "");
		}
		return snapshot;
	}

	window._siteNavPrepareOverwrite = prepareLocalOverwrite;
	window._siteNavConsumeAutoDownloadSkip = consumeAutomaticDownloadSkip;
	window._siteNavSetCloudStatus = setCloudStatus;
	refreshRollbackAvailability(true);

	if (cloudStatusEl) {
		cloudStatusEl.addEventListener("click", function(e) {
			e.stopPropagation();
			// 单击文字 → 弹对话框显示详情（对话框里点确认按钮也能执行）
			if (_cloudStatusAction && _cloudStatusAction.dialog) {
				openConfirmDialog(_cloudStatusAction.dialog, _cloudStatusAction.onConfirm);
			}
		});
	}

	// 清空待办状态并执行回调（按钮再次单击时调用）
	function consumeCloudStatusAction() {
		if (!_cloudStatusAction) return null;
		var act = _cloudStatusAction;
		_cloudStatusAction = null;
		if (cloudStatusEl) { cloudStatusEl.classList.remove("isActionable"); }
		// 清除对应按钮的 warning 标记
		var targetBtn = act.key && _cloudBtnByKey[act.key];
		if (targetBtn) { targetBtn.classList.remove("isPendingConfirm"); }
		_menuLocked = false;
		return act;
	}

	function doCloudUpload() {
		setCloudStatus("正在上传...", "");
		window.cloudSyncManager.uploadLocalToCloud().then(function(result) {
			setCloudStatus(result.message, result.success ? "Success" : "Error");
			if (result.success) {
				if (typeof window._siteNavSetDirty === "function") {
					window._siteNavSetDirty(false);
				}
				if (typeof window._siteNavOnUploadSuccess === "function") {
					window._siteNavOnUploadSuccess();
				}
			}
		});
	}

	function doCloudDownload() {
		setCloudStatus("正在读取...", "");
		window.cloudSyncManager.downloadCloudToLocal().then(function(result) {
			setCloudStatus(result.message, result.success ? "Success" : "Error");
			if (result.success) {
				// 下载完成：清掉 dirty 标志并记录当前数据快照，
				// 避免接下来的 location.reload() 被 beforeunload 拦截
				if (typeof window._siteNavSetDirty === "function") {
					window._siteNavSetDirty(false);
				}
				if (window.cloudSyncManager && typeof window.cloudSyncManager.buildLocalPayload === "function") {
					var refreshed = window.cloudSyncManager.buildLocalPayload();
					window._siteNavLastSyncedData = JSON.stringify(refreshed.data);
				}
				// 用 setTimeout(0) 让状态文字先 paint 再刷新，不再等 1500ms
				setTimeout(function() {
					location.reload();
				}, 0);
			}
		});
	}

	if (cloudRollbackBtn) {
		cloudRollbackBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			var pending = consumeCloudStatusAction();
			if (pending && pending.key === "rollback") {
				pending.onConfirm();
				return;
			}
			var snapshot = refreshRollbackAvailability(false);
			if (!snapshot) {
				setCloudStatus("暂无可恢复的覆盖前状态", "");
				return;
			}
			var savedAt = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString() : "未知";
			var reason = snapshot.reason || "数据覆盖";
			setCloudStatus("再次单击 确认舍弃当前数据", "Warning", {
				key: "rollback",
				dialog: {
					title: "回到未覆盖前状态",
					message: "将舍弃当前数据，恢复到上次覆盖发生前的本地状态。\n\n覆盖来源：" + reason + "\n恢复点时间：" + savedAt + "\n\n恢复点保存在本机，刷新页面不会丢失。确认后页面将自动刷新。",
					confirmText: "确认舍弃并恢复"
				},
				onConfirm: function() {
					var latest = getPreOverwriteSnapshot();
					if (!latest || !latest.payload || !latest.payload.data) {
						setCloudStatus("恢复点已不存在", "Error");
						refreshRollbackAvailability(false);
						return;
					}
					try {
						if (window.cloudSyncManager && typeof window.cloudSyncManager.applyDataToLocalStorage === "function") {
							window.cloudSyncManager.applyDataToLocalStorage(latest.payload.data);
						} else {
							if (latest.payload.data.cube_memory_progress !== undefined && window.storageManager) {
								window.storageManager.setJson("cube_memory_progress", latest.payload.data.cube_memory_progress);
							}
							if (latest.payload.data.smartCubeFormulaEntries !== undefined && window.storageManager) {
								window.storageManager.setJson("smartCubeFormulaEntries", latest.payload.data.smartCubeFormulaEntries);
							}
						}
						localStorage.removeItem(getSiteStorageKey(PRE_OVERWRITE_PREFIX));
					} catch (error) {
						setCloudStatus("恢复失败：" + (error && error.message || error), "Error");
						return;
					}
					if (typeof window._siteNavSetDirty === "function") {
						window._siteNavSetDirty(true);
					}
					window._siteNavAllowUnloadOnce = true;
					skipNextAutomaticDownload();
					setCloudStatus("已恢复，正在刷新...", "Success");
					setTimeout(function() { location.reload(); }, 0);
				}
			});
		});
	}
	if (cloudUploadBtn) {
		cloudUploadBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			if (!window.cloudSyncManager) {
				setCloudStatus("云同步模块未加载", "Error");
				return;
			}
			// 再次单击 = 确认覆盖
			var pending = consumeCloudStatusAction();
			if (pending && pending.key === "upload") {
				pending.onConfirm();
				return;
			}
			// 先检查云端是否有数据
			setCloudStatus("正在检查...", "");
			window.cloudSyncManager.getCloudStatus().then(function(status) {
				if (status.hasData) {
					var timeStr = status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "未知";
					setCloudStatus("再次单击 确认覆盖云端数据", "Warning", {
						key: "upload",
						dialog: {
							title: "⚠ 覆盖警告",
							message: "云端已有数据（更新时间：" + timeStr + "）。\n上传将覆盖云端数据，此操作不可撤销。\n\n确认继续？",
							confirmText: "确认覆盖"
						},
						onConfirm: doCloudUpload
					});
				} else {
					doCloudUpload();
				}
			});
		});
	}

	if (cloudDownloadBtn) {
		cloudDownloadBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			if (!window.cloudSyncManager) {
				setCloudStatus("云同步模块未加载", "Error");
				return;
			}
			// 再次单击 = 确认覆盖
			var pending = consumeCloudStatusAction();
			if (pending && pending.key === "download") {
				pending.onConfirm();
				return;
			}
			setCloudStatus("正在检查...", "");
			window.cloudSyncManager.getCloudStatus().then(function(status) {
				if (status.hasData) {
					var timeStr = status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "未知";
					setCloudStatus("再次单击 确认覆盖本地数据", "Warning", {
						key: "download",
						dialog: {
							title: "⚠ 覆盖警告",
							message: "将从云端恢复数据并覆盖本地。覆盖前状态会保存在本机，可从头像菜单恢复。\n\n云端更新时间：" + timeStr + "\n\n确认后页面将自动刷新。",
							confirmText: "确认覆盖"
						},
						onConfirm: doCloudDownload
					});
				} else {
					setCloudStatus("云端暂无数据，无法恢复", "Error");
				}
			});
		});
	}

	// 导出本地数据为 JSON 文件自行保存（游客下载按钮 / 已登录菜单内下载按钮共用）
	// 优先委托给当前站点注册的 cloudSyncManager.buildLocalPayload()，保证按站点作用域
	// 导出正确的 storage key（Cube/Formula 导出 cube_memory_progress 等，Relay 导出 relay_* 等）。
	// 仅当 cloudSyncManager 未加载时，才回退到 Cube/Formula 默认逻辑。
	function downloadLocalBackup() {
		var now = new Date();
		var pad = function(n) { return String(n).padStart(2, "0"); };
		var dateStr = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());

		var payload = buildCurrentLocalPayload();

		// 文件名按 payload 里的 siteScope 命名，便于区分不同站点备份
		var fileScope = (payload && payload.siteScope) ? payload.siteScope : "Site";
		var json = JSON.stringify(payload, null, "\t");
		var blob = new Blob([json], { type: "application/json" });
		var url = URL.createObjectURL(blob);
		var a = document.createElement("a");
		a.href = url;
		a.download = fileScope + "_LocalData_" + dateStr + ".json";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	var downloadBtn = document.getElementById("siteDownloadBtn");
	if (downloadBtn) {
		downloadBtn.addEventListener("click", downloadLocalBackup);
	}

	var cloudSaveLocalBtn = document.getElementById("cloudSaveLocalBtn");
	if (cloudSaveLocalBtn) {
		cloudSaveLocalBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			hideAccountMenu();
			downloadLocalBackup();
		});
	}

	// 通用确认对话框（红色覆盖警告样式）
	// 用法：openConfirmDialog({ title, message, confirmText }, onConfirm)
	var _confirmCallback = null;
	function openConfirmDialog(opts, onConfirm) {
		var overlay = document.getElementById("confirmOverlay");
		var titleEl = document.getElementById("confirmTitle");
		var msgEl = document.getElementById("confirmMessage");
		var okBtn = document.getElementById("confirmOkBtn");
		var cancelBtn = document.getElementById("confirmCancelBtn");
		if (!overlay || !titleEl || !msgEl || !okBtn || !cancelBtn) return;
		titleEl.textContent = (opts && opts.title) || "确认操作";
		msgEl.textContent = (opts && opts.message) || "";
		okBtn.textContent = (opts && opts.confirmText) || "确认";
		_confirmCallback = onConfirm;
		overlay.classList.add("isVisible");
		setTimeout(function() { okBtn.focus(); }, 50);
	}

	function closeConfirmDialog(confirmed) {
		var overlay = document.getElementById("confirmOverlay");
		if (overlay) { overlay.classList.remove("isVisible"); }
		var cb = _confirmCallback;
		_confirmCallback = null;
		if (confirmed && typeof cb === "function") {
			try { cb(); } catch (e) { console.error("[Nav] 确认回调异常:", e); }
		}
	}

	// 导入用户自行保存的 JSON 备份，覆盖本地数据
	// 已登录（账户菜单可见）：在 cloudStatus 显示警告，点击提示文字再弹对话框
	// 游客（账户菜单不可见）：直接弹对话框
	function importLocalBackup(file) {
		if (!file) return;
		var importInput = document.getElementById("siteImportFileInput");
		file.text().then(function(text) {
			var parsed;
			try {
				parsed = JSON.parse(text);
			} catch (e) {
				_reportImportError("文件不是有效的 JSON 格式");
				return;
			}
			if (!parsed || typeof parsed !== "object") {
				_reportImportError("数据格式不正确");
				return;
			}
			var dataBlock = parsed.data;
			if (!dataBlock || typeof dataBlock !== "object") {
				_reportImportError("缺少 data 数据块，可能是错误的文件");
				return;
			}

			var fileScope = parsed.siteScope || "未知站点";
			var exportTime = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : "未知时间";
			var inMenu = accountMenu && accountMenu.classList.contains("isVisible");

			var doWrite = function() {
				var guard = prepareLocalOverwrite("本地备份导入", dataBlock, {
					source: fileScope,
					exportedAt: parsed.exportedAt || null
				});
				if (!guard.success) {
					_reportImportError(guard.message);
					return;
				}
				try {
					if (window.cloudSyncManager && typeof window.cloudSyncManager.applyDataToLocalStorage === "function") {
						window.cloudSyncManager.applyDataToLocalStorage(dataBlock);
					} else {
						if (dataBlock.cube_memory_progress !== undefined && window.storageManager) {
							window.storageManager.setJson("cube_memory_progress", dataBlock.cube_memory_progress);
						}
						if (dataBlock.smartCubeFormulaEntries !== undefined && window.storageManager) {
							window.storageManager.setJson("smartCubeFormulaEntries", dataBlock.smartCubeFormulaEntries);
						}
					}
				} catch (e) {
					_reportImportError("写入本地存储时出错：" + (e && e.message || e));
					return;
				}
				// 导入内容尚未上传云端，持久标记为 dirty；本次程序刷新单独放行。
				if (typeof window._siteNavSetDirty === "function") {
					window._siteNavSetDirty(true);
				}
				window._siteNavAllowUnloadOnce = true;
					skipNextAutomaticDownload();
				if (inMenu) {
					setCloudStatus("导入成功，正在刷新...", "Success");
				}
				setTimeout(function() { location.reload(); }, 600);
			};

		if (inMenu) {
			// 菜单内：cloudStatus 显示“再次单击”提示，单击文字弹对话框看详情，再次单击导入按钮确认
			setCloudStatus("再次单击 确认覆盖当前数据", "Warning", {
				key: "import",
				dialog: {
					title: "⚠ 覆盖警告",
					message: "即将从备份导入数据并覆盖当前本地数据。覆盖前状态会保存在本机，可从头像菜单恢复。\n\n备份来源：" + fileScope + "\n导出时间：" + exportTime + "\n\n确认后页面将自动刷新。",
					confirmText: "确认覆盖"
				},
				onConfirm: doWrite
			});
		} else {
				// 游客：直接弹对话框
				openConfirmDialog({
					title: "⚠ 覆盖警告",
					message: "即将从备份导入数据并覆盖当前本地数据。覆盖前状态会保存在本机，可从头像菜单恢复。\n\n备份来源：" + fileScope + "\n导出时间：" + exportTime + "\n\n确认后页面将自动刷新。",
					confirmText: "确认覆盖"
				}, doWrite);
			}
		}).catch(function(error) {
			_reportImportError("读取文件失败：" + (error && error.message || error));
		}).then(function() {
			if (importInput) { importInput.value = ""; }
		});
	}

	// 导入错误提示：菜单内走 cloudStatus(Error)，游客走对话框
	function _reportImportError(msg) {
		var inMenu = accountMenu && accountMenu.classList.contains("isVisible");
		if (inMenu) {
			setCloudStatus("导入失败：" + msg, "Error");
		} else {
			openConfirmDialog({
				title: "导入失败",
				message: msg,
				confirmText: "知道了"
			}, function() {});
		}
	}

	// 绑定确认对话框按钮
	(function bindConfirmDialog() {
		var overlay = document.getElementById("confirmOverlay");
		var okBtn = document.getElementById("confirmOkBtn");
		var cancelBtn = document.getElementById("confirmCancelBtn");
		if (okBtn) {
			okBtn.addEventListener("click", function() { closeConfirmDialog(true); });
		}
		if (cancelBtn) {
			cancelBtn.addEventListener("click", function() { closeConfirmDialog(false); });
		}
		if (overlay) {
			// 点击遮罩空白处 = 取消
			overlay.addEventListener("click", function(e) {
				if (e.target === overlay) { closeConfirmDialog(false); }
			});
		}
		// Esc 键关闭（视为取消）
		document.addEventListener("keydown", function(e) {
			if (e.key === "Escape" && overlay && overlay.classList.contains("isVisible")) {
				closeConfirmDialog(false);
			}
		});
	})();

	function triggerImportFile() {
		var importInput = document.getElementById("siteImportFileInput");
		if (importInput) { importInput.click(); }
	}

	var siteImportBtn = document.getElementById("siteImportBtn");
	if (siteImportBtn) {
		siteImportBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			triggerImportFile();
		});
	}

	var cloudImportLocalBtn = document.getElementById("cloudImportLocalBtn");
	if (cloudImportLocalBtn) {
		_cloudBtnByKey.import = cloudImportLocalBtn;
		cloudImportLocalBtn.addEventListener("click", function(e) {
			e.stopPropagation();
			// 再次单击 = 确覆盖导入
			var pending = consumeCloudStatusAction();
			if (pending && pending.key === "import") {
				pending.onConfirm();
				return;
			}
			triggerImportFile();
		});
	}

	var siteImportFileInput = document.getElementById("siteImportFileInput");
	if (siteImportFileInput) {
		siteImportFileInput.addEventListener("change", function() {
			if (siteImportFileInput.files && siteImportFileInput.files[0]) {
				importLocalBackup(siteImportFileInput.files[0]);
			}
		});
	}

		var _currentProfile = null;
		var _profileListenerBound = false;
		var _currentAuthUser = null;

		function updateMenuDisplay(profile) {
			var nameEl = document.getElementById("accountMenuEmail");
			var avatarEl = document.getElementById("siteAvatar");
			var imageEl = document.getElementById("siteAvatarImage");
			var fallbackEl = document.getElementById("siteAvatarFallback");
			var user = _currentAuthUser;
			if (!nameEl || !user) return;
			var username = profile && profile.username ? profile.username : null;
			var displayName = username || user.email || "";
			nameEl.textContent = displayName;
			var initial = displayName ? displayName.charAt(0).toUpperCase() : "?";
			if (fallbackEl) {
				fallbackEl.textContent = initial;
				fallbackEl.hidden = false;
			}
			if (avatarEl) {
				avatarEl.title = displayName;
			}
			var avatarUrl = profile && profile.avatar_path && window.profileManager
				? window.profileManager.getAvatarUrl(profile.avatar_path, profile.updated_at)
				: null;
			if (!imageEl) return;
			if (!avatarUrl) {
				imageEl.dataset.avatarUrl = "";
				imageEl.hidden = true;
				imageEl.removeAttribute("src");
				return;
			}
			imageEl.dataset.avatarUrl = avatarUrl;
			imageEl.hidden = true;
			imageEl.onload = function() {
				if (imageEl.dataset.avatarUrl !== avatarUrl) return;
				imageEl.hidden = false;
				if (fallbackEl) fallbackEl.hidden = true;
			};
			imageEl.onerror = function() {
				if (imageEl.dataset.avatarUrl !== avatarUrl) return;
				imageEl.hidden = true;
				if (fallbackEl) fallbackEl.hidden = false;
			};
			imageEl.src = avatarUrl;
		}

		function fetchAndDisplayProfile() {
			var user = _currentAuthUser;
			if (!user) {
				_currentProfile = null;
				return;
			}
			if (window.profileManager && typeof window.profileManager.getOwnProfile === "function") {
				if (!_profileListenerBound && typeof window.profileManager.onProfileChange === "function") {
					_profileListenerBound = true;
					window.profileManager.onProfileChange(function(profile) {
						_currentProfile = profile || null;
						updateMenuDisplay(_currentProfile);
					});
				}
				window.profileManager.getOwnProfile().then(function(result) {
					// 只在成功时才更新，失败则保留当前头像，避免标签页切回前台时
					// 因网络请求失败导致头像被重置为占位符
					if (result.success) {
						_currentProfile = result.profile;
					}
					updateMenuDisplay(_currentProfile);
				});
			} else {
				_currentProfile = null;
				updateMenuDisplay(null);
			}
		}

		function updateAuthUI(user) {
			var guestEntry = document.getElementById("guestEntry");
			var userEntry = document.getElementById("userEntry");
			// 判断是否是同一用户重新触发（标签页切回前台时 Supabase 会重新派发 auth 事件）
			var sameUser = _currentAuthUser && user && _currentAuthUser.id === user.id;
			_currentAuthUser = user;

			if (user) {
				if (guestEntry) { guestEntry.style.display = "none"; }
				if (userEntry) { userEntry.style.display = ""; }
				// 同一用户不再重置头像，避免切回前台时短暂闪烁成邮箱占位符
				if (!sameUser) {
					updateMenuDisplay(null);
				}
				fetchAndDisplayProfile();
			} else {
				if (guestEntry) { guestEntry.style.display = ""; }
				if (userEntry) { userEntry.style.display = "none"; }
				_currentProfile = null;
			}
		}

		window._siteNavQuickUpload = function() {
			if (!window.cloudSyncManager || !window.cloudSyncManager.isReady()) {
				return Promise.resolve({ success: false, message: "请先登录" });
			}
			setCloudStatus("正在上传...", "");
			return window.cloudSyncManager.uploadLocalToCloud().then(function(result) {
				setCloudStatus(result.message, result.success ? "Success" : "Error");
				if (result.success) {
					if (typeof window._siteNavSetDirty === "function") {
						window._siteNavSetDirty(false);
					}
					if (typeof window._siteNavOnUploadSuccess === "function") {
						window._siteNavOnUploadSuccess();
					}
				}
				return result;
			});
		};

		window._siteNavSetDirty = function(dirty) {
			window._siteNavDataDirty = !!dirty;
		};

		window.addEventListener("keydown", function(e) {
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
				e.preventDefault();
				if (typeof window._siteNavQuickUpload === "function") {
					window._siteNavQuickUpload();
				}
			}
		});

		window.addEventListener("beforeunload", function(e) {
			if (window._siteNavAllowUnloadOnce) {
				window._siteNavAllowUnloadOnce = false;
				return;
			}
			if (window._siteNavDataDirty && window.authManager && window.authManager.isLoggedIn()) {
				// 二次确认：对比当前数据与上次成功上传的数据（仅对比 data 部分，忽略 exportedAt 时间戳）
				var hasActualChanges = true;
				if (window._siteNavLastSyncedData && window.cloudSyncManager && typeof window.cloudSyncManager.buildLocalPayload === "function") {
					var currentPayload = window.cloudSyncManager.buildLocalPayload();
					hasActualChanges = (JSON.stringify(currentPayload.data) !== window._siteNavLastSyncedData);
				}
				if (hasActualChanges) {
					e.preventDefault();
					e.returnValue = "您未上传数据";
					return "您未上传数据";
				}
			}
		});

		// 页面生命周期：刷新、bfcache 或后台标签页丢弃前保存临时表单状态。
		(function() {
			if (typeof document.wasDiscarded !== "undefined" && document.wasDiscarded) {
				window._siteNavWasDiscarded = true;
			}

			function saveStateToSession() {
				try {
					var state = {
						path: window.location.pathname,
						savedAt: Date.now(),
						scrollX: window.scrollX,
						scrollY: window.scrollY,
						formData: {}
					};
					document.querySelectorAll("input, textarea, select").forEach(function(el) {
						var key = el.id || el.name;
						var type = (el.type || "").toLowerCase();
						if (key && type !== "password" && type !== "file") {
							state.formData[key] = {
								value: el.value,
								checked: (type === "checkbox" || type === "radio") ? el.checked : undefined
							};
						}
					});
					sessionStorage.setItem("__siteNav_savedState", JSON.stringify(state));
				} catch (e) {}
			}

			function restoreStateFromSession() {
				try {
					var raw = sessionStorage.getItem("__siteNav_savedState");
					if (!raw) return;
					var state = JSON.parse(raw);
					if (state.path && state.path !== window.location.pathname) return;
					if (state.scrollX !== undefined && state.scrollY !== undefined) {
						window.scrollTo(state.scrollX, state.scrollY);
					}
					if (state.formData) {
						Object.keys(state.formData).forEach(function(key) {
							var el = document.getElementById(key) || document.querySelector("[name='" + key + "']");
							var saved = state.formData[key];
							if (!saved || typeof saved !== "object") saved = { value: saved };
							if (el && el.value === "" && saved.value) {
								el.value = saved.value;
								el.dispatchEvent(new Event("input", { bubbles: true }));
							}
							if (el && typeof saved.checked === "boolean") {
								el.checked = saved.checked;
							}
						});
					}
					sessionStorage.removeItem("__siteNav_savedState");
				} catch (e) {}
			}

			document.addEventListener("visibilitychange", function() {
				if (document.hidden) saveStateToSession();
			});
			window.addEventListener("pagehide", saveStateToSession);
			window.addEventListener("beforeunload", saveStateToSession);
			window.addEventListener("pageshow", function() {
				setTimeout(restoreStateFromSession, 100);
			});
		})();
		if (window.authManager) {
			window.authManager.init();
			window.authManager.onAuthStateChange(updateAuthUI);
		} else {
			updateAuthUI(null);
		}
	}

	window.siteNav = {
		init: init,
		render: renderNav
	};
})();
