(function() {
	"use strict";

	var NAV_HTML = [
		'<header class="siteHeader">',
		'	<div class="siteHeaderLeft">',
		'		<img class="siteHeaderLogo" src="/favicon.svg?v=0349" alt="Logo" aria-hidden="true">',
		'		<span class="siteHeaderName">Ckarefulon</span>',
		'	</div>',
		'	<div class="siteHeaderRight">',
		'		<button id="siteThemeToggle" class="siteHeaderBtn siteHeaderBtnTheme" type="button" title="切换主题">☀</button>',
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
		'			<button id="siteAvatar" class="siteAvatar" type="button">?</button>',
		'			<div id="accountMenu" class="accountMenu">',
		'				<div class="accountMenuEmail" id="accountMenuEmail"></div>',
		'				<div class="accountMenuScope" id="accountMenuScope"></div>',
		'				<div class="accountMenuCloud" id="accountMenuCloud">',
		'					<div class="accountMenuDivider"></div>',
		'					<div class="accountMenuCloudTitle">云端数据</div>',
		'					<div class="accountMenuCloudStatus" id="cloudStatus">未检查</div>',
		'					<div class="accountMenuCloudActions">',
		'						<button id="cloudCheckBtn" class="siteHeaderBtn" type="button">检查云端状态</button>',
		'						<button id="cloudUploadBtn" class="siteHeaderBtn" type="button">上传本地数据到云端</button>',
		'						<button id="cloudDownloadBtn" class="siteHeaderBtn" type="button">从云端恢复到本地</button>',
		'					</div>',
		'				</div>',
		'				<button id="siteSignOutBtn" class="siteHeaderBtn" type="button">退出登录</button>',
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
		'			<label for="loginEmail">邮箱</label>',
		'			<input type="email" id="loginEmail" placeholder="请输入邮箱" autocomplete="email">',
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
		var loginEmail = document.getElementById("loginEmail");
		var loginPassword = document.getElementById("loginPassword");
		var loginStatus = document.getElementById("loginStatus");
		var loginSubmitBtn = document.getElementById("loginSubmitBtn");
		var loginRegisterBtn = document.getElementById("loginRegisterBtn");
		var loginPanelClose = document.getElementById("loginPanelClose");

		function openLoginPanel() {
			if (loginOverlay) { loginOverlay.classList.add("isVisible"); }
			if (loginStatus) { loginStatus.textContent = ""; loginStatus.className = "loginStatus"; }
			if (loginEmail) { loginEmail.value = ""; }
			if (loginPassword) { loginPassword.value = ""; }
			if (loginEmail) { setTimeout(function() { loginEmail.focus(); }, 100); }
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
			var email = (loginEmail && loginEmail.value || "").trim();
			var password = loginPassword && loginPassword.value || "";
			if (!email || !password) {
				setLoginStatus("请输入邮箱和密码", "Error");
				return;
			}
			if (!window.authManager) {
				setLoginStatus("Supabase 配置未完成", "Error");
				return;
			}
			setLoginStatus("请稍候...", "");
			var method = action === "signUp" ? "signUp" : "signIn";
			window.authManager[method](email, password).then(function(result) {
				setLoginStatus(result.message, result.success ? "Success" : "Error");
				if (result.success) {
					setTimeout(closeLoginPanel, 1500);
				}
			});
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
		var accountHideTimer = null;

		function showAccountMenu() {
			if (accountHideTimer) { clearTimeout(accountHideTimer); accountHideTimer = null; }
			if (accountMenu) { accountMenu.classList.add("isVisible"); }
		}

		function hideAccountMenu() {
			accountHideTimer = setTimeout(function() {
				if (accountMenu) { accountMenu.classList.remove("isVisible"); }
			}, 200);
		}

		function cancelAccountHide() {
			if (accountHideTimer) { clearTimeout(accountHideTimer); accountHideTimer = null; }
		}

		if (avatar) {
			avatar.addEventListener("click", function() {
				if (accountMenu && accountMenu.classList.contains("isVisible")) {
					hideAccountMenu();
				} else {
					showAccountMenu();
				}
			});
			avatar.addEventListener("mouseenter", showAccountMenu);
			avatar.addEventListener("mouseleave", hideAccountMenu);
		}

		if (accountMenu) {
			accountMenu.addEventListener("mouseenter", cancelAccountHide);
			accountMenu.addEventListener("mouseleave", hideAccountMenu);
		}

		if (signOutBtn) {
			signOutBtn.addEventListener("click", function() {
				if (window.authManager) {
					window.authManager.signOut();
				}
			});
		}

		var accountMenuScope = document.getElementById("accountMenuScope");
		if (accountMenuScope) {
			var currentScope = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "Cube-Formula";
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
				var mem = window.storageManager ? window.storageManager.getJson("cube_memory_progress_v1", null) : null;
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
						cube_memory_progress_v1: mem,
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

		function updateAuthUI(user) {
			var guestEntry = document.getElementById("guestEntry");
			var userEntry = document.getElementById("userEntry");
			var avatarEl = document.getElementById("siteAvatar");
			var accountMenuEmail = document.getElementById("accountMenuEmail");

			if (user) {
				if (guestEntry) { guestEntry.style.display = "none"; }
				if (userEntry) { userEntry.style.display = ""; }
				if (avatarEl) {
					var email = user.email || "";
					avatarEl.textContent = email.charAt(0).toUpperCase() || "?";
					avatarEl.title = email;
				}
				if (accountMenuEmail) {
					accountMenuEmail.textContent = user.email || "";
				}
			} else {
				if (guestEntry) { guestEntry.style.display = ""; }
				if (userEntry) { userEntry.style.display = "none"; }
			}
		}

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
