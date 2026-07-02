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
		'			</div>',
		'		</div>',
		'		<div class="guestEntry" id="userEntry" style="display:none">',
		'			<button id="siteMobileMenuBtn" class="siteHeaderBtn siteMobileMenuBtn" type="button" title="菜单" aria-label="打开菜单">',
		'				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
		'			</button>',
		'			<button id="siteAvatar" class="siteAvatar" type="button"><img id="siteAvatarImage" class="siteAvatarImage" alt="" hidden><span id="siteAvatarFallback">?</span></button>',
		'			<div id="accountMenu" class="accountMenu">',
		'				<div class="accountMenuEmail" id="accountMenuEmail"></div>',
		'				<div class="accountMenuScope" id="accountMenuScope"></div>',
		'				<button id="siteProfileBtn" class="siteHeaderBtn accountMenuProfileBtn" type="button">个人资料</button>',
		'				<button id="siteSignOutBtn" class="siteHeaderBtn" type="button">退出登录</button>',
		'				<div class="accountMenuCloud" id="accountMenuCloud">',
		'					<div class="accountMenuDivider"></div>',
		'					<div class="accountMenuCloudTitle">云端数据</div>',
		'					<div class="accountMenuCloudStatus" id="cloudStatus">未检查</div>',
		'					<div class="accountMenuCloudActions">',
		'						<button id="cloudCheckBtn" class="cloudIconBtn" type="button" title="检查云端状态"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button>',
		'						<button id="cloudUploadBtn" class="cloudIconBtn" type="button" title="上传本地数据到云端"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>',
		'						<button id="cloudDownloadBtn" class="cloudIconBtn" type="button" title="从云端恢复到本地"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>',
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
		'</div>'
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
		var accountHideTimer = null;
		var touchOpened = false;

		function goToProfile() {
			window.location.href = "/user/profile/";
		}

		function showAccountMenu() {
			if (accountHideTimer) { clearTimeout(accountHideTimer); accountHideTimer = null; }
			if (accountMenu) { accountMenu.classList.add("isVisible"); }
		}

		function hideAccountMenu() {
			accountHideTimer = setTimeout(function() {
				if (accountMenu) { accountMenu.classList.remove("isVisible"); }
				touchOpened = false;
			}, 200);
		}

		function cancelAccountHide() {
			if (accountHideTimer) { clearTimeout(accountHideTimer); accountHideTimer = null; }
		}

		if (avatar) {
			avatar.addEventListener("click", function() {
				if (touchOpened) {
					touchOpened = false;
					showAccountMenu();
					return;
				}
				goToProfile();
			});
			avatar.addEventListener("mouseenter", function() {
				if (!touchOpened) {
					showAccountMenu();
				}
			});
			avatar.addEventListener("mouseleave", hideAccountMenu);
			avatar.addEventListener("touchstart", function(e) {
				touchOpened = true;
			}, { passive: true });
		}

		if (profileBtn) {
			profileBtn.addEventListener("click", function(e) {
				e.stopPropagation();
				goToProfile();
			});
		}

		if (accountMenu) {
			accountMenu.addEventListener("mouseenter", cancelAccountHide);
			accountMenu.addEventListener("mouseleave", hideAccountMenu);
			accountMenu.addEventListener("click", function(e) {
				e.stopPropagation();
			});
		}

		var mobileMenuBtn = document.getElementById("siteMobileMenuBtn");

		if (mobileMenuBtn) {
			mobileMenuBtn.addEventListener("click", function(e) {
				e.stopPropagation();
				if (accountMenu && accountMenu.classList.contains("isVisible")) {
					accountMenu.classList.remove("isVisible");
					touchOpened = false;
				} else {
					touchOpened = true;
					showAccountMenu();
				}
			});
		}

		var donateBtn = document.getElementById("siteDonateBtn");
		var donateMenu = document.getElementById("donateMenu");

		if (donateBtn) {
			donateBtn.addEventListener("click", function(e) {
				e.stopPropagation();
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
			if (accountMenu && accountMenu.classList.contains("isVisible")) {
				if (e.target !== avatar && e.target !== mobileMenuBtn && !accountMenu.contains(e.target)) {
					accountMenu.classList.remove("isVisible");
					touchOpened = false;
				}
			}
			if (donateMenu && donateMenu.classList.contains("isVisible")) {
				if (e.target !== donateBtn && !donateMenu.contains(e.target)) {
					donateMenu.classList.remove("isVisible");
				}
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
		var cloudCheckBtn = document.getElementById("cloudCheckBtn");
		var cloudUploadBtn = document.getElementById("cloudUploadBtn");
		var cloudDownloadBtn = document.getElementById("cloudDownloadBtn");

		function setCloudStatus(text, type) {
			if (!cloudStatusEl) return;
			cloudStatusEl.textContent = text;
			cloudStatusEl.className = "accountMenuCloudStatus" + (type ? " is" + type.charAt(0).toUpperCase() + type.slice(1) : "");
		}

		if (cloudCheckBtn) {
			cloudCheckBtn.addEventListener("click", function() {
				if (!window.cloudSyncManager) {
					setCloudStatus("云同步模块未加载", "Error");
					return;
				}
				setCloudStatus("正在检查...", "");
				window.cloudSyncManager.getCloudStatus().then(function(result) {
					if (result.success && result.hasData) {
						var timeStr = result.updatedAt ? new Date(result.updatedAt).toLocaleString() : "未知";
						setCloudStatus("云端已有数据（" + timeStr + "）", "Success");
					} else if (result.success && !result.hasData) {
						setCloudStatus("云端暂无数据", "");
					} else {
						setCloudStatus(result.message, "Error");
					}
				});
			});
		}

		if (cloudUploadBtn) {
			cloudUploadBtn.addEventListener("click", function() {
				if (!window.cloudSyncManager) {
					setCloudStatus("云同步模块未加载", "Error");
					return;
				}
				window.cloudSyncManager.getCloudStatus().then(function(status) {
					if (status.hasData) {
						if (!confirm("云端已有数据，继续上传会覆盖云端数据，是否继续？")) {
							return;
						}
					}
					setCloudStatus("正在上传...", "");
					window.cloudSyncManager.uploadLocalToCloud().then(function(result) {
						setCloudStatus(result.message, result.success ? "Success" : "Error");
					});
				});
			});
		}

		if (cloudDownloadBtn) {
			cloudDownloadBtn.addEventListener("click", function() {
				if (!window.cloudSyncManager) {
					setCloudStatus("云同步模块未加载", "Error");
					return;
				}
				if (!confirm("这会用云端数据覆盖当前本地数据，是否继续？")) {
					return;
				}
				setCloudStatus("正在读取...", "");
				window.cloudSyncManager.downloadCloudToLocal().then(function(result) {
					setCloudStatus(result.message, result.success ? "Success" : "Error");
					if (result.success) {
						setTimeout(function() {
							location.reload();
						}, 1500);
					}
				});
			});
		}

		var downloadBtn = document.getElementById("siteDownloadBtn");
		if (downloadBtn) {
			downloadBtn.addEventListener("click", function() {
				var scope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";
				var basePath = window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : "/Cube/Formula";
				var mem = window.storageManager ? window.storageManager.getJson("cube_memory_progress", null) : null;
				var entries = window.storageManager ? window.storageManager.getJson("smartCubeFormulaEntries", []) : [];

				var now = new Date();
				var pad = function(n) { return String(n).padStart(2, "0"); };
				var dateStr = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());

				var payload = {
					exportedAt: now.toISOString(),
					source: "Ckarefulon",
					siteScope: scope,
					siteBasePath: basePath,
					version: 1,
					data: {
						cube_memory_progress: mem,
						smartCubeFormulaEntries: entries
					}
				};

				var json = JSON.stringify(payload, null, "\t");
				var blob = new Blob([json], { type: "application/json" });
				var url = URL.createObjectURL(blob);
				var a = document.createElement("a");
				a.href = url;
				a.download = scope + "_LocalData_" + dateStr + ".json";
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
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
					_currentProfile = result.success ? result.profile : null;
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
			_currentAuthUser = user;

			if (user) {
				if (guestEntry) { guestEntry.style.display = "none"; }
				if (userEntry) { userEntry.style.display = ""; }
				updateMenuDisplay(null);
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
			if (window._siteNavDataDirty && window.authManager && window.authManager.isLoggedIn()) {
				e.preventDefault();
				e.returnValue = "您未上传数据";
				return "您未上传数据";
			}
		});

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
