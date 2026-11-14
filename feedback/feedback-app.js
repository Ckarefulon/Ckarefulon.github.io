/*
 * 反馈广场 —— /feedback/
 *
 * 页面 = 讨论列表（广场）+ 新建弹窗。两种进入方式：
 *   · 从 nav 图标进来（URL 带 ?new=1）→ 直接展开新建弹窗，关掉就回广场
 *   · 直接访问 /feedback/            → 先看广场，点「新建」才开弹窗
 *
 * 后端是 Supabase Edge Function `feedback`：
 *   GET  ?action=list  取讨论列表
 *   GET  (无 action)   预热，拿分类映射
 *   POST               按 type 建 Discussion（PAT 只在服务端）
 */
(function () {
	"use strict";

	var FN_PATH = "/functions/v1/feedback";
	var REPO = "Ckarefulon/Ckarefulon.github.io";
	var SUBMIT_TIMEOUT = 20000;
	var DRAFT_KEY = "__feedbackDraft_v1";

	/** 五个类型；value 即提交给函数的 type，label 是界面显示 */
	var TYPES = [
		{ type: "bug", label: "Bug", github: "Bug", hint: "有东西坏了、报错了、表现不对" },
		{ type: "feature", label: "Feature", github: "Feature", hint: "希望新增或改进某个功能" },
		{ type: "question", label: "Question", github: "Question", hint: "使用方法上的疑问" },
		{ type: "chat", label: "Chat", github: "Chat", hint: "随便聊聊、想法交流" },
		{ type: "others", label: "Others", github: "Other", hint: "不属于以上几类的其他内容" }
	];

	var els = {};
	var currentType = "others";
	var currentFilter = "all";
	var allDiscussions = [];
	var nextCursor = null;
	var typeMap = {};          // type → 仓库里实际分类名
	var prewarmed = false;
	var submitting = false;
	var modalOpen = false;
	var detailNumber = null;   // 当前打开的讨论编号（null = 列表视图）
	var currentDetail = null;
	var replying = false;
	var listIdentity = null;   // 后端告诉我们当前用的是 App(bot) 还是 PAT
	var viewer = null;         // 站内当前查看者（是否登录）

	function $(id) { return document.getElementById(id); }

	/* ---------------- 后端地址 ---------------- */

	function endpoint() {
		var cfg = window.CK_SUPABASE_CONFIG;
		if (!cfg || !cfg.url) return "";
		return String(cfg.url).replace(/\/+$/, "") + FN_PATH;
	}

	/**
	 * 请求头。
	 *
	 * 已登录时用**用户自己的 JWT**做 Authorization：后端据此把这条反馈
	 * 记到 feedback_submissions（站内可见，GitHub 上仍是 bot 匿名）。
	 * 未登录则退回 publishable key —— 游客也能提，只是站内不留痕。
	 */
	function headers() {
		var cfg = window.CK_SUPABASE_CONFIG || {};
		var h = { "Content-Type": "application/json" };
		if (cfg.publishableKey) h.apikey = cfg.publishableKey;

		var token = currentAccessToken();
		if (token) {
			h.Authorization = "Bearer " + token;
		} else if (cfg.publishableKey) {
			h.Authorization = "Bearer " + cfg.publishableKey;
		}
		return h;
	}

	/** 从 supabase-js 已建立的会话里取 access_token（不额外发请求） */
	function currentAccessToken() {
		try {
			var auth = window.authManager;
			if (auth && typeof auth.isLoggedIn === "function" && auth.isLoggedIn()) {
				var client = window.supabaseClient;
				if (!client) return null;
				// supabase-js v2 把会话存在 localStorage，键名形如 sb-<ref>-auth-token
				var cfg = window.CK_SUPABASE_CONFIG || {};
				var ref = "";
				try { ref = new URL(cfg.url).hostname.split(".")[0]; } catch (e) {}
				var raw = localStorage.getItem("sb-" + ref + "-auth-token");
				if (raw) {
					var parsed = JSON.parse(raw);
					// 结构可能是 {access_token} 或 {currentSession:{access_token}}
					if (parsed && parsed.access_token) return parsed.access_token;
					if (parsed && parsed.currentSession && parsed.currentSession.access_token) {
						return parsed.currentSession.access_token;
					}
				}
			}
		} catch (e) {}
		return null;
	}

	function getJson(url, timeoutMs) {
		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = controller && timeoutMs ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
		var options = { method: "GET", headers: headers(), cache: "no-store" };
		if (controller) options.signal = controller.signal;
		return fetch(url, options).then(function (res) {
			if (timer) clearTimeout(timer);
			return res.json().catch(function () { return { success: false, message: "响应解析失败（HTTP " + res.status + "）" }; });
		}, function (err) {
			if (timer) clearTimeout(timer);
			throw err;
		});
	}

	/* ---------------- 类型与分类提示 ---------------- */

	function typeDef(type) {
		for (var i = 0; i < TYPES.length; i++) if (TYPES[i].type === type) return TYPES[i];
		return TYPES[TYPES.length - 1];
	}

	function setType(type) {
		currentType = typeDef(type).type;
		if (els.types) {
			var items = els.types.querySelectorAll(".fbType");
			for (var i = 0; i < items.length; i++) {
				var active = items[i].getAttribute("data-type") === currentType;
				items[i].classList.toggle("isActive", active);
				items[i].setAttribute("aria-selected", active ? "true" : "false");
			}
		}
		updateTypeHint();
		saveDraft();
	}

	function updateTypeHint() {
		if (!els.typeHint) return;
		var def = typeDef(currentType);
		var real = typeMap[currentType];
		var parts = [def.hint];
		if (real) parts.push("提交到「" + real + "」");
		// 隐私口径要写清楚：GitHub 上是匿名 bot，站内才会记住是谁
		if (viewer && viewer.loggedIn) {
			parts.push("站内会记录是你提交的（GitHub 上不显示）");
		} else {
			parts.push("未登录：GitHub 上匿名，站内也不留痕");
		}
		els.typeHint.textContent = parts.join(" · ");
		els.typeHint.className = "fbTypeHint";
	}

	/* ---------------- 草稿 ---------------- */

	function payloadDraft() {
		return {
			type: currentType,
			body: (els.body && els.body.value || "").trim(),
			contact: (els.contact && els.contact.value || "").trim()
		};
	}

	function saveDraft() {
		try {
			var d = payloadDraft();
			if (!d.body && !d.contact) { localStorage.removeItem(DRAFT_KEY); return; }
			d.at = Date.now();
			localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
		} catch (e) {}
	}

	function restoreDraft() {
		var raw = null;
		try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
		if (!raw) return false;
		var d = null;
		try { d = JSON.parse(raw); } catch (e) { return false; }
		if (!d || typeof d !== "object") return false;
		if (d.at && Date.now() - d.at > 7 * 24 * 3600 * 1000) { clearDraft(); return false; }
		if (d.type) setType(d.type);
		if (d.body && els.body) els.body.value = d.body;
		if (d.contact && els.contact) els.contact.value = d.contact;
		return !!(d.body || d.contact);
	}

	function clearDraft() {
		try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
	}

	/* ---------------- 环境信息 ---------------- */

	function metaLines() {
		var nav = window.navigator || {};
		var screenSize = (window.screen && window.screen.width && window.screen.height)
			? window.screen.width + "x" + window.screen.height : "?";
		return [
			"页面: " + (window.location.href || ""),
			"来源: " + (document.referrer || "（直接打开）"),
			"视口: " + (window.innerWidth || 0) + "x" + (window.innerHeight || 0)
				+ " @dpr " + (window.devicePixelRatio || 1) + "（屏幕 " + screenSize + "）",
			"UA: " + (nav.userAgent || "?"),
			"语言: " + (nav.language || "?"),
			"主题: " + (document.documentElement.dataset.theme || "light")
		].join("\n");
	}

	/* ---------------- 列表 ---------------- */

	function setListStatus(text, kind) {
		if (!els.listStatus) return;
		els.listStatus.textContent = text || "";
		els.listStatus.className = "fbListStatus" + (kind ? " is" + kind.charAt(0).toUpperCase() + kind.slice(1) : "");
	}

	function fmtDate(iso) {
		if (!iso) return "";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		var diff = Date.now() - d.getTime();
		var min = Math.round(diff / 60000);
		if (min < 1) return "刚刚";
		if (min < 60) return min + " 分钟前";
		var hour = Math.round(min / 60);
		if (hour < 24) return hour + " 小时前";
		var day = Math.round(hour / 24);
		if (day < 30) return day + " 天前";
		return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
	}

	/** 讨论的分类 slug → 我们的 type（用于筛选） */
	function slugToType(slug) {
		if (!slug) return "others";
		var s = String(slug).toLowerCase();
		for (var i = 0; i < TYPES.length; i++) {
			var def = TYPES[i];
			if (s === def.type) return def.type;
			if (def.type === "bug" && (s === "bugs")) return "bug";
			if (def.type === "feature" && (s === "features" || s === "idea" || s === "ideas")) return "feature";
			if (def.type === "question" && (s === "questions" || s === "q-a" || s === "qa")) return "question";
			if (def.type === "chat" && (s === "general" || s === "discussion")) return "chat";
			if (def.type === "others" && (s === "other" || s === "misc")) return "others";
		}
		return "others";
	}

	/** 作者显示：bot 身份（站点代发）与真人分开标注，不冒用账号名 */
	function authorLabel(author, identity) {
		// 列表里作者是字符串（login），详情里是 {login, avatarUrl}
		var login = typeof author === "string" ? author : (author && author.login ? author.login : "");
		if (!login) return "匿名";
		// GitHub App 的 bot 账号名形如 "xxx[bot]"
		if (/\[bot\]$/.test(login)) {
			return '<span class="fbAuthorBot">站点代发</span>';
		}
		if (identity && identity.mode === "pat") {
			// 用 PAT 时所有提交都挂在维护者名下 —— 标注出来，别让人以为是提交者本人
			return escapeHtml("@" + login) + '<span class="fbAuthorNote">（维护者账号代发）</span>';
		}
		return escapeHtml("@" + login);
	}

	/* ---------------- 详情视图 ---------------- */

	function openDetail(number) {
		if (!els.detail) return;
		detailNumber = number;
		if (history.pushState) {
			history.pushState({ detail: number }, "", "?d=" + number);
		}
		showDetail();
	}

	function showDetail() {
		if (!els.detail) return;
		els.page.hidden = true;
		els.detail.hidden = false;
		window.scrollTo(0, 0);
		loadDetail(detailNumber);
	}

	function closeDetail() {
		if (!els.detail) return;
		els.detail.hidden = true;
		els.page.hidden = false;
		detailNumber = null;
		if (history.pushState) {
			history.pushState(null, "", window.location.pathname);
		}
		window.scrollTo(0, 0);
	}

	function loadDetail(number, onDone) {
		if (!els.detailBody) return;
		els.detailBody.innerHTML = '<div class="fbDetailLoading">正在加载…</div>';
		var url = endpoint();
		if (!url) {
			els.detailBody.innerHTML = '<div class="fbDetailError">站点后端未配置，无法加载详情</div>';
			return;
		}
		getJson(url + "?action=detail&number=" + encodeURIComponent(number) + "&first=40", 20000)
			.then(function (data) {
				if (data && data.configure) {
					els.detailBody.innerHTML = '<div class="fbDetailError">反馈服务尚未配置，可到 GitHub 查看原讨论</div>';
					return;
				}
				if (!data || !data.success || !data.discussion) {
					els.detailBody.innerHTML = '<div class="fbDetailError">'
						+ escapeHtml((data && data.message) || "加载失败") + "</div>";
					return;
				}
				if (data.identity) listIdentity = data.identity;
				currentDetail = data;
				renderDetail(data);
				if (typeof onDone === "function") onDone();
			})
			.catch(function () {
				els.detailBody.innerHTML = '<div class="fbDetailError">网络异常，加载失败</div>';
			});
	}

	function renderDetail(data) {
		var d = data.discussion;
		var identity = data.identity || null;
		var type = slugToType(d.category && d.category.slug);

		els.detailBody.innerHTML = ''
			+ '<article class="fbPost">'
			+ '	<header class="fbPostHead">'
			+ '		<span class="fbItemBadge fbBadge-' + escapeHtml(type) + '">' + escapeHtml(d.category ? d.category.name : "未分类") + "</span>"
			+ '		<span class="fbPostMeta">#' + escapeHtml(d.number) + " · " + authorLabel(d.author, identity)
			+ " · " + escapeHtml(fmtDate(d.createdAt)) + "</span>"
			+ "	</header>"
			+ '	<h1 class="fbPostTitle">' + escapeHtml(d.title) + "</h1>"
			+ '	<div class="fbPostBody">' + markdownLite(stripMeta(d.body)) + "</div>"
			+ "</article>"
			+ '<h2 class="fbCommentsTitle">回复 <span class="fbCommentsCount">' + escapeHtml(data.totalComments || 0) + "</span></h2>"
			+ '<div class="fbComments">' + renderComments(data.comments || [], identity) + "</div>"
			+ renderReplyForm(identity);
	}

	/** 去掉我们附加的环境信息与签名，正文只留用户写的内容 */
	function stripMeta(body) {
		var text = String(body || "");
		var env = text.indexOf("<details><summary>环境信息");
		if (env > 0) text = text.slice(0, env);
		var sign = text.lastIndexOf("> 由站点反馈广场提交");
		if (sign > 0) text = text.slice(0, sign);
		var contact = text.indexOf("**联系方式**");
		if (contact > 0) text = text.slice(0, contact);
		return text.trim();
	}

	function renderComments(comments, identity) {
		if (!comments.length) {
			return '<div class="fbNoComments">还没有回复。</div>';
		}
		var html = "";
		for (var i = 0; i < comments.length; i++) {
			var c = comments[i];
			html += '<div class="fbComment">'
				+ '<div class="fbCommentHead">'
				+ '<span class="fbCommentAuthor">' + authorLabel(c.author, identity) + "</span>"
				+ '<span class="fbCommentDate">' + escapeHtml(fmtDate(c.createdAt)) + "</span>"
				+ (c.isAnswer ? '<span class="fbAnswerTag">已采纳</span>' : "")
				+ "</div>"
				+ '<div class="fbCommentBody">' + markdownLite(c.body) + "</div>";
			if (c.replies && c.replies.length) {
				html += '<div class="fbReplies">';
				for (var j = 0; j < c.replies.length; j++) {
					var r = c.replies[j];
					html += '<div class="fbReply">'
						+ '<div class="fbCommentHead">'
						+ '<span class="fbCommentAuthor">' + authorLabel(r.author, identity) + "</span>"
						+ '<span class="fbCommentDate">' + escapeHtml(fmtDate(r.createdAt)) + "</span>"
						+ "</div>"
						+ '<div class="fbCommentBody">' + markdownLite(r.body) + "</div>"
						+ "</div>";
				}
				html += "</div>";
			}
			html += "</div>";
		}
		return html;
	}

	function renderReplyForm(identity) {
		var hint = "";
		if (identity && identity.mode === "app" && identity.bot) {
			hint = "回复将以 " + escapeHtml(identity.bot) + " 的身份发布";
		} else if (identity) {
			hint = "回复将以维护者账号发布（如需显示为站点代发，请配置 GitHub App）";
		}
		return ''
			+ '<div class="fbReplyForm">'
			+ '	<label class="fbLabel" for="fbReplyBody">写回复</label>'
			+ '	<textarea class="fbBody fbReplyBody" id="fbReplyBody" rows="4" maxlength="8000" '
			+ 'placeholder="补充说明、追问、或者回答别人的问题…"></textarea>'
			+ '	<input class="fbHp" id="fbReplyHp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">'
			+ '	<div class="fbReplyFoot">'
			+ '		<span class="fbReplyHint">' + hint + "</span>"
			+ '		<div class="fbReplyBtns">'
			+ '			<button class="siteHeaderBtn" id="fbReplyGithubBtn" type="button">在 GitHub 回复</button>'
			+ '			<button class="siteHeaderBtn loginBtnPrimary fbSubmit" id="fbReplySubmitBtn" type="button">发布回复</button>'
			+ "		</div>"
			+ "	</div>"
			+ '	<div class="fbStatus" id="fbReplyStatus"></div>'
			+ "</div>";
	}

	function postReply() {
		if (replying) return;
		var box = $("fbReplyBody");
		var hp = $("fbReplyHp");
		var status = $("fbReplyStatus");
		var btn = $("fbReplySubmitBtn");
		var ghBtn = $("fbReplyGithubBtn");

		function setStatus(text, kind) {
			if (!status) return;
			status.textContent = text || "";
			status.className = "fbStatus" + (kind ? " is" + kind.charAt(0).toUpperCase() + kind.slice(1) : "");
		}

		var body = (box && box.value || "").trim();
		if (body.length < 2) { setStatus("回复太短了", "Error"); return; }

		var url = endpoint();
		if (!url) {
			setStatus("站点后端未配置，已改用 GitHub 回复", "Warning");
			openGithubForReply(body);
			return;
		}

		replying = true;
		if (btn) { btn.disabled = true; btn.textContent = "发布中…"; }
		setStatus("正在发布…", "");

		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = controller ? setTimeout(function () { controller.abort(); }, SUBMIT_TIMEOUT) : null;
		var options = {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				action: "comment",
				number: detailNumber,
				body: body,
				hp: (hp && hp.value || "").trim()
			}),
			cache: "no-store"
		};
		if (controller) options.signal = controller.signal;

		fetch(url, options).then(function (res) {
			return res.json().catch(function () { return { success: false, message: "返回异常" }; });
		}).then(function (data) {
			if (timer) clearTimeout(timer);
			done();
			if (data && data.success) {
				if (box) box.value = "";
				// 重新拉详情会重建整块 DOM，提示要等重建之后再落回去
				loadDetail(detailNumber, function () {
					var s = $("fbReplyStatus");
					if (!s) return;
					s.textContent = "已发布，谢谢！";
					s.className = "fbStatus isSuccess";
				});
				return;
			}
			if (data && data.configure) {
				setStatus("自动回复未配置，已改用 GitHub", "Warning");
				openGithubForReply(body);
				return;
			}
			setStatus((data && data.message) || "发布失败，请稍后再试", "Error");
		}).catch(function (err) {
			if (timer) clearTimeout(timer);
			done();
			var aborted = err && err.name === "AbortError";
			setStatus(aborted ? "发布超时，可稍后重试" : "网络异常，可稍后重试", "Error");
		});

		function done() {
			replying = false;
			if (btn) { btn.disabled = false; btn.textContent = "发布回复"; }
		}
	}

	function openGithubForReply(body) {
		var target = currentDetail && currentDetail.discussion ? currentDetail.discussion.url : ("https://github.com/" + REPO + "/discussions");
		window.open(target, "_blank", "noopener,noreferrer");
	}

	/** 极简 Markdown：够用即可（代码块、行内代码、粗体、链接、换行） */
	function markdownLite(text) {
		var html = escapeHtml(String(text || ""));
		// ```code```
		html = html.replace(/```([\s\S]*?)```/g, function (_m, code) {
			return '<pre class="fbCode">' + code.replace(/^\n+|\n+$/g, "") + "</pre>";
		});
		html = html.replace(/`([^`\n]+)`/g, '<code class="fbInlineCode">$1</code>');
		html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
		html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
			'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
		// 段落：两个换行分段，单换行成 <br>
		var paras = html.split(/\n{2,}/).map(function (p) {
			if (/^<pre/.test(p.trim())) return p;
			return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
		});
		return paras.join("");
	}

	function renderList() {
		if (!els.list) return;
		var items = allDiscussions;
		if (currentFilter !== "all") {
			items = items.filter(function (d) {
				return slugToType(d.category && d.category.slug) === currentFilter;
			});
		}

		if (!items.length) {
			els.list.innerHTML = "";
			var empty = document.createElement("div");
			empty.className = "fbEmpty";
			empty.innerHTML = '<div class="fbEmptyTitle">这里还没有内容</div>'
				+ '<div class="fbEmptyText">' + (currentFilter === "all"
					? "你是第一个，点「新建」说点什么吧。" : "这个分类下暂时没有讨论。") + "</div>";
			els.list.appendChild(empty);
			return;
		}

		var html = "";
		for (var i = 0; i < items.length; i++) {
			html += renderItem(items[i]);
		}
		els.list.innerHTML = html;
	}

	function escapeHtml(s) {
		return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}

	function renderItem(d) {
		var type = slugToType(d.category && d.category.slug);
		var catName = d.category ? d.category.name : "未分类";
		return ''
			+ '<a class="fbItem" href="?d=' + escapeHtml(d.number) + '" data-number="' + escapeHtml(d.number) + '">'
			+ '	<span class="fbItemBadge fbBadge-' + escapeHtml(type) + '">' + escapeHtml(catName) + "</span>"
			+ '	<span class="fbItemMain">'
			+ '		<span class="fbItemTitle">' + escapeHtml(d.title) + "</span>"
			+ (d.excerpt ? '	<span class="fbItemExcerpt">' + escapeHtml(d.excerpt) + "</span>" : "")
			+ '		<span class="fbItemMeta">'
			+ "			#" + escapeHtml(d.number) + " · " + authorLabel(d.author, listIdentity)
			+ " · " + escapeHtml(fmtDate(d.updatedAt || d.createdAt))
			+ (d.comments ? " · " + d.comments + " 条回复" : "")
			+ (d.mine ? '<span class="fbMineTag">我提的</span>' : "")
			+ "		</span>"
			+ "	</span>"
			+ "</a>";
	}

	function loadList(reset) {
		if (reset) {
			allDiscussions = [];
			nextCursor = null;
		}
		var url = endpoint();
		if (!url) {
			setListStatus("站点后端未配置，无法加载列表；可直接到 GitHub 查看", "Error");
			renderList();
			return Promise.resolve();
		}

		setListStatus(allDiscussions.length ? "正在加载更多…" : "正在加载…", "");
		if (els.loadMore) els.loadMore.disabled = true;

		var listUrl = url + "?action=list&first=30" + (nextCursor ? "&after=" + encodeURIComponent(nextCursor) : "");
		return getJson(listUrl, 20000).then(function (data) {
			if (data && data.configure) {
				setListStatus("反馈服务尚未配置，可直接到 GitHub Discussions 查看", "Warning");
				renderList();
				return;
			}
			if (!data || !data.success) {
				setListStatus((data && data.message) || "加载失败，请稍后再试", "Error");
				renderList();
				return;
			}

			if (Array.isArray(data.types)) {
				typeMap = {};
				for (var i = 0; i < data.types.length; i++) {
					var t = data.types[i];
					if (t && t.type && t.category) typeMap[t.type] = t.category;
				}
				updateTypeHint();
			}
			if (data.identity) listIdentity = data.identity;
			if (data.viewer) viewer = data.viewer;

			allDiscussions = allDiscussions.concat(data.discussions || []);
			nextCursor = data.pageInfo && data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
			setListStatus(allDiscussions.length
				? "共 " + allDiscussions.length + " 条" + (nextCursor ? "（还有更多）" : "")
				: "", "");
			renderList();
			if (els.loadMore) {
				els.loadMore.hidden = !nextCursor;
				els.loadMore.disabled = false;
			}
		}).catch(function () {
			setListStatus("网络异常，加载失败；可直接到 GitHub Discussions 查看", "Error");
			renderList();
		});
	}

	/* ---------------- 新建弹窗 ---------------- */

	function openModal(focusBody) {
		if (!els.overlay) return;
		modalOpen = true;
		els.overlay.classList.add("isVisible");
		updateTypeHint();
		if (focusBody !== false) {
			setTimeout(function () {
				try { (els.body || {}).focus({ preventScroll: true }); } catch (e) {}
			}, 80);
		}
	}

	function closeModal() {
		if (!els.overlay) return;
		modalOpen = false;
		els.overlay.classList.remove("isVisible");
		// 从 nav 图标进来的：关掉弹窗就把 URL 上的 ?new=1 去掉，避免刷新又弹
		if (history.replaceState) {
			var u = new URL(window.location.href);
			if (u.searchParams.has("new")) {
				u.searchParams.delete("new");
				history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
			}
		}
	}

	function setStatus(text, kind) {
		if (!els.status) return;
		els.status.textContent = text || "";
		els.status.className = "fbStatus" + (kind ? " is" + kind.charAt(0).toUpperCase() + kind.slice(1) : "");
	}

	function githubUrl(payload) {
		var def = typeDef(payload.type);
		var base = "https://github.com/" + REPO + "/discussions/new";
		var params = ["category=" + encodeURIComponent(typeMap[payload.type] || def.github)];
		var title = "[" + def.github + "] " + firstLine(payload.body).slice(0, 60);
		params.push("title=" + encodeURIComponent(title));
		var body = payload.body;
		if (payload.contact) body += "\n\n**联系方式**：" + payload.contact;
		body += "\n\n<details><summary>环境信息</summary>\n\n```\n" + metaLines() + "\n```\n\n</details>";
		params.push("body=" + encodeURIComponent(body));
		return base + "?" + params.join("&");
	}

	function firstLine(text) {
		var arr = String(text || "").split("\n").map(function (s) { return s.trim(); })
			.filter(function (s) { return s.length; });
		return arr[0] || "站点反馈";
	}

	function openGithub() {
		var p = payloadDraft();
		if (p.body.length < 4) { setStatus("请再多写几个字", "Error"); return; }
		window.open(githubUrl(p), "_blank", "noopener,noreferrer");
	}

	function submit() {
		if (submitting) return;
		var p = payloadDraft();

		if (p.body.length < 4) {
			setStatus("请再多写几个字", "Error");
			if (els.body) els.body.focus();
			return;
		}

		var url = endpoint();
		if (!url) {
			setStatus("站点后端未配置，已改用 GitHub 提交", "Warning");
			openGithub();
			return;
		}

		submitting = true;
		if (els.submit) { els.submit.disabled = true; els.submit.textContent = "提交中…"; }
		setStatus("正在提交…", "");

		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = controller ? setTimeout(function () { controller.abort(); }, SUBMIT_TIMEOUT) : null;
		var options = {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				type: p.type,
				body: p.body,
				contact: p.contact,
				hp: (els.hp && els.hp.value || "").trim(),
				meta: metaLines(),
				page: window.location.pathname || "/feedback/"
			}),
			cache: "no-store"
		};
		if (controller) options.signal = controller.signal;

		fetch(url, options).then(function (res) {
			return res.json().catch(function () {
				return { success: false, message: "反馈服务返回异常（HTTP " + res.status + "）" };
			});
		}).then(function (data) {
			if (timer) clearTimeout(timer);
			finish();

			if (data && data.success) {
				clearDraft();
				if (els.body) els.body.value = "";
				if (els.contact) els.contact.value = "";
				setStatus("已提交，谢谢！", "Success");
				if (data.url) {
					var a = document.createElement("a");
					a.className = "fbOpenLink";
					a.href = data.url;
					a.target = "_blank";
					a.rel = "noopener noreferrer";
					a.textContent = " 查看讨论" + (data.number ? " #" + data.number : "") + " ↗";
					if (els.status) els.status.appendChild(a);
				}
				// 列表里立刻跟上这条（不等重新拉取）
				if (data.number) {
					allDiscussions.unshift({
						number: data.number,
						title: "[" + typeDef(p.type).github + "] " + firstLine(p.body).slice(0, 60),
						url: data.url,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						category: { name: data.category || typeMap[p.type] || typeDef(p.type).github, slug: p.type },
						author: null,
						comments: 0,
						upvotes: 0,
						excerpt: firstLine(p.body)
					});
					renderList();
				}
				return;
			}

			if (data && data.configure) {
				setStatus("自动提交未配置，已改用 GitHub 提交", "Warning");
				openGithub();
				return;
			}
			setStatus((data && data.message) || "提交失败，请稍后再试", "Error");
		}).catch(function (err) {
			if (timer) clearTimeout(timer);
			finish();
			var aborted = err && err.name === "AbortError";
			setStatus(aborted ? "提交超时，可稍后重试或改用 GitHub 打开"
				: "网络异常，可稍后重试或改用 GitHub 打开", "Error");
		});

		function finish() {
			submitting = false;
			if (els.submit) { els.submit.disabled = false; els.submit.textContent = "提交"; }
		}
	}

	/* ---------------- 预热（进页就做，把冷启动挪到用户还在这页） ---------------- */

	function prewarm() {
		if (prewarmed) return;
		var url = endpoint();
		if (!url) return;
		getJson(url, 12000).then(function (data) {
			prewarmed = !!(data && data.success);
			if (data && Array.isArray(data.types)) {
				for (var i = 0; i < data.types.length; i++) {
					var t = data.types[i];
					if (t && t.type && t.category) typeMap[t.type] = t.category;
				}
				updateTypeHint();
			}
			if (data && data.configure) {
				if (els.submit) els.submit.textContent = "在 GitHub 中提交";
			}
		}).catch(function () {});
	}

	/* ---------------- 启动 ---------------- */

	function boot() {
		els = {
			page: $("fbPageMain"),
			detail: $("fbPageDetail"),
			detailBody: $("fbDetailBody"),
			backBtn: $("fbBackBtn"),
			list: $("fbList"),
			listStatus: $("fbListStatus"),
			loadMore: $("fbLoadMore"),
			filters: $("fbFilters"),
			newBtn: $("fbNewBtn"),
			overlay: $("fbOverlay"),
			modalClose: $("fbComposeClose"),
			types: $("fbTypes"),
			typeHint: $("fbTypeHint"),
			body: $("fbBody"),
			contact: $("fbContact"),
			hp: $("fbHp"),
			status: $("fbStatus"),
			submit: $("fbSubmitBtn"),
			github: $("fbGithubBtn")
		};

		// 列表项：站内打开详情（新标签打开则是真链接，方便分享）
		if (els.list) {
			els.list.addEventListener("click", function (e) {
				var item = e.target && e.target.closest ? e.target.closest(".fbItem") : null;
				if (!item) return;
				// Ctrl/Cmd/中键：交给浏览器开新标签
				if (e.ctrlKey || e.metaKey || e.button === 1) return;
				var num = Number(item.getAttribute("data-number") || 0);
				if (!num) return;
				e.preventDefault();
				openDetail(num);
			});
		}

		if (els.backBtn) els.backBtn.addEventListener("click", closeDetail);

		// 详情里的回复表单是动态插入的，用事件委托
		if (els.detailBody) {
			els.detailBody.addEventListener("click", function (e) {
				var submit = e.target && e.target.closest ? e.target.closest("#fbReplySubmitBtn") : null;
				if (submit) { postReply(); return; }
				var gh = e.target && e.target.closest ? e.target.closest("#fbReplyGithubBtn") : null;
				if (gh) {
					var target = currentDetail && currentDetail.discussion
						? currentDetail.discussion.url
						: ("https://github.com/" + REPO + "/discussions");
					window.open(target, "_blank", "noopener,noreferrer");
				}
			});
		}

		// 浏览器前进/后退：在列表与详情之间切换
		window.addEventListener("popstate", function () {
			var n = new URLSearchParams(window.location.search).get("d");
			if (n) {
				detailNumber = Number(n);
				showDetail();
			} else if (els.detail && !els.detail.hidden) {
				els.detail.hidden = true;
				els.page.hidden = false;
				detailNumber = null;
			}
		});

		// 分类筛选
		if (els.filters) {
			els.filters.addEventListener("click", function (e) {
				var btn = e.target && e.target.closest ? e.target.closest(".fbFilter") : null;
				if (!btn) return;
				currentFilter = btn.getAttribute("data-filter") || "all";
				var items = els.filters.querySelectorAll(".fbFilter");
				for (var i = 0; i < items.length; i++) {
					var active = items[i] === btn;
					items[i].classList.toggle("isActive", active);
					items[i].setAttribute("aria-selected", active ? "true" : "false");
				}
				renderList();
			});
		}

		if (els.loadMore) {
			els.loadMore.addEventListener("click", function () { loadList(false); });
		}

		// 新建
		if (els.newBtn) els.newBtn.addEventListener("click", function () { openModal(true); });
		if (els.modalClose) els.modalClose.addEventListener("click", closeModal);
		if (els.overlay) {
			els.overlay.addEventListener("click", function (e) {
				if (e.target === els.overlay) closeModal();
			});
		}

		// 类型
		if (els.types) {
			els.types.addEventListener("click", function (e) {
				var btn = e.target && e.target.closest ? e.target.closest(".fbType") : null;
				if (btn) setType(btn.getAttribute("data-type") || "others");
			});
		}

		// 草稿
		if (els.body) {
			els.body.addEventListener("input", saveDraft);
			els.body.addEventListener("focus", prewarm, { once: true });
		}
		if (els.contact) els.contact.addEventListener("input", saveDraft);

		if (els.submit) els.submit.addEventListener("click", submit);
		if (els.github) els.github.addEventListener("click", openGithub);

		document.addEventListener("keydown", function (e) {
			if (!modalOpen) return;
			if (e.key === "Escape") { e.stopPropagation(); closeModal(); return; }
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
		}, true);

		// 恢复草稿 + 初始类型
		restoreDraft();
		setType(currentType);

		// 进页即预热（列表请求同时也把分类映射带回来）
		prewarm();
		loadList(true);

		// 从 nav 图标进来（?new=1）→ 直接开新建弹窗
		var params = new URLSearchParams(window.location.search);
		if (params.get("new") === "1") {
			openModal(true);
		}
		// 深链接：?d=12 直接打开某条讨论
		var deep = params.get("d");
		if (deep) {
			detailNumber = Number(deep);
			if (detailNumber) showDetail();
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
