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
	var currentType = "bug";
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

	/**
	 * 后端地址。
	 *
	 * **首选同源中继 `/api/sb/…`**，而不是直连 `<ref>.supabase.co`：
	 * 部分网络会按域名拦掉 supabase.co（TCP 通、TLS 带正确 SNI 立刻被 RST），
	 * 那种网络里直连只会转圈到超时。站点的静态文件却能打开 ——
	 * 所以只要让请求变成同源，由服务器去连 Supabase，这条路就能用。
	 *
	 * 中继不可用时（本地开发、非 Netlify 部署）自动退回直连，两者路由一致。
	 */
	function relayBase() {
		// 同源相对路径；末尾的 /api/sb 由 Netlify 重写到函数
		return "/api/sb";
	}

	/** 直连地址（中继不可用时的退路） */
	function directBase() {
		var cfg = window.CK_SUPABASE_CONFIG;
		if (!cfg || !cfg.url) return "";
		return String(cfg.url).replace(/\/+$/, "");
	}

	/** 当前用哪条链路：先中继，失败后置为 direct，后续请求不再白等一次 */
	var transport = "relay";

	function endpoint() {
		var base = transport === "relay" ? relayBase() : directBase();
		return base ? base + FN_PATH : "";
	}

	/**
	 * 直连是否值得一试。
	 * 没配 url 就没得退；本地开发（localhost）一般中继不存在，也可以省掉那一跳。
	 */
	function canFallback() {
		return !!directBase();
	}

	/**
	 * 判定一次失败该不该换直连重试。
	 *
	 * 只对「网络层没通」的情况切换：中继函数没部署 / 上游超时 / 连接被拒。
	 * 业务错误（400 正文太短、429 太频繁）绝不切换 —— 那换条路也一样，白跑一趟。
	 *
	 * **判据是这条 URL 本身走没走中继**，不是全局 transport 状态：
	 * 预热和列表是并发发出的，两个请求都可能带着中继地址出发；
	 * 先失败的那个把 transport 切成 direct 之后，后到的那个如果还看全局状态，
	 * 就会以为「已经切过了」而放弃重试，然后拿中继的 404 当业务错误报出来。
	 */
	function shouldFallbackToDirect(url, err, status) {
		if (!canFallback()) return false;
		if (!isRelayUrl(url)) return false;          // 本来就是直连，没得退
		if (err) return true;                        // fetch 本身失败：网络层问题
		if (status === 502 || status === 504 || status === 404) return true;
		return false;
	}

	/** 这条 URL 是不是中继地址 */
	function isRelayUrl(url) {
		return String(url || "").indexOf(relayBase() + "/") === 0;
	}

	function switchToDirect() {
		if (transport === "relay") {
			transport = "direct";
			return true;
		}
		return false;
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

	/**
	 * 取当前 access_token。**不依赖 window.supabaseClient**：
	 * 本页不再首屏加载 Supabase（顶栏登录由 nav.js 按需拉），
	 * 所以这里直接从 localStorage 里读 supabase-js 存下的会话，
	 * 既省一次初始化，也让「游客提出来的能认得回来」这件事照旧成立。
	 */
	function currentAccessToken() {
		try {
			// 1) supabase-js 已加载并已登录：最可信
			var auth = window.authManager;
			if (auth && typeof auth.isLoggedIn === "function" && auth.isLoggedIn()) {
				var client = window.supabaseClient;
				if (!client) return null;
			}
			// 2) 从存储里找 sb-<ref>-auth-token（有 token 就说明是登录态）
			var raw = null;
			var parsed = null;
			try {
				for (var i = 0; i < localStorage.length; i++) {
					var key = localStorage.key(i);
					if (!key || key.indexOf("sb-") !== 0 || key.indexOf("-auth-token") < 0) continue;
					raw = localStorage.getItem(key);
					if (raw) break;
				}
			} catch (e) { return null; }
			if (!raw) return null;
			try { parsed = JSON.parse(raw); } catch (e) { return null; }
			// 结构可能是 {access_token} 或 {currentSession:{access_token}}
			if (parsed && parsed.access_token) return parsed.access_token;
			if (parsed && parsed.currentSession && parsed.currentSession.access_token) {
				return parsed.currentSession.access_token;
			}
		} catch (e) {}
		return null;
	}

	/**
	 * GET 一条并解析 JSON。
	 *
	 * 中继链路失败（函数没部署 / 上游不通）时**自动换直连重试一次**，
	 * 这样本地开发和换平台部署都不会因为少一个 Functions 就直接报错。
	 * 业务错误不重试，原样把响应对象交回调用方判断。
	 */
	function getJson(url, timeoutMs, retried) {
		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = controller && timeoutMs ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
		// 这里**不能**用 no-store：函数已经按 10–15 秒给了 Cache-Control，
		// 强制绕过缓存等于把服务端辛苦省的 GitHub 往返又还回去。
		var options = { method: "GET", headers: headers() };
		if (controller) options.signal = controller.signal;

		return fetch(url, options).then(function (res) {
			if (timer) clearTimeout(timer);
			// 中继没到位：换直连再试一次（同一份请求，换主机而已）
			if (shouldFallbackToDirect(url, null, res.status) && !retried) {
				switchToDirect();
				return getJson(rewriteToDirect(url), timeoutMs, true);
			}
			return res.json().catch(function () { return { success: false, message: "响应解析失败（HTTP " + res.status + "）" }; });
		}, function (err) {
			if (timer) clearTimeout(timer);
			// 网络层失败：换直连再试一次
			if (shouldFallbackToDirect(url, err) && !retried) {
				switchToDirect();
				return getJson(rewriteToDirect(url), timeoutMs, true);
			}
			throw err;
		});
	}

	/** 把 `/api/sb/functions/v1/...` 换成直连前缀 */
	function rewriteToDirect(url) {
		var direct = directBase();
		if (!direct) return url;
		var marker = relayBase();
		var s = String(url || "");
		if (s.indexOf(marker) === 0) return direct + s.slice(marker.length);
		return s;
	}

	/**
	 * POST 一条并解析 JSON，失败时同样换直连重试一次。
	 *
	 * 写操作重试要小心：只在「请求根本没到服务器」时才重试。
	 * 中继返回 502/504 说明它自己没连上上游，重复提交不会造成两条；
	 * 而 4xx（正文太短、限流）一律不重试。
	 */
	function postJson(url, options, timeoutMs, retried) {
		var target = url;
		var opts = {
			method: options.method || "POST",
			headers: options.headers,
			body: options.body,
			cache: "no-store"
		};
		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = controller && timeoutMs ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
		if (controller) opts.signal = controller.signal;

		return fetch(target, opts).then(function (res) {
			if (timer) clearTimeout(timer);
			if (shouldFallbackToDirect(target, null, res.status) && !retried) {
				switchToDirect();
				return postJson(rewriteToDirect(target), options, timeoutMs, true);
			}
			return res.json().catch(function () {
				return { success: false, message: "反馈服务返回异常（HTTP " + res.status + "）" };
			});
		}, function (err) {
			if (timer) clearTimeout(timer);
			if (shouldFallbackToDirect(target, err) && !retried) {
				switchToDirect();
				return postJson(rewriteToDirect(target), options, timeoutMs, true);
			}
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
			title: (els.title && els.title.value || "").trim(),
			body: (els.body && els.body.value || "").trim(),
			contact: (els.contact && els.contact.value || "").trim(),
			page: (els.page && els.page.value || "").trim()
		};
	}

	function saveDraft() {
		try {
			var d = payloadDraft();
			if (!d.body && !d.contact && !d.title) { localStorage.removeItem(DRAFT_KEY); return; }
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
		if (d.title && els.title) els.title.value = d.title;
		if (d.body && els.body) els.body.value = d.body;
		if (d.contact && els.contact) els.contact.value = d.contact;
		if (d.page && els.page) els.page.value = d.page;
		return !!(d.body || d.contact || d.title);
	}

	function clearDraft() {
		try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
	}

	/* ---------------- 来源页面（从哪一页点进来的） ---------------- */

	var FROM_KEY = "__feedbackFrom_v1";
	var FROM_TTL = 30 * 60 * 1000;

	/** 只接受站内路径：外部地址、伪协议一律丢掉 */
	function isSitePath(value) {
		var s = String(value || "").trim();
		if (!s) return false;
		// 允许 "/xxx"、"xxx/yyy"；拒绝 "//host"、"http://…"、"javascript:…"
		if (s.indexOf("//") === 0) return false;
		if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false;
		return true;
	}

	/** 规范化：补前导斜杠，去掉零宽/控制字符，只留路径（丢 query / hash），最长 300 */
	function normalizeFrom(value) {
		if (!isSitePath(value)) return "";
		var s = String(value).replace(/[\u0000-\u001F\u007F]/g, "").trim();
		// 去掉 query 与 hash：?from= 里只会是路径，留着反而把一次性参数带进反馈表
		s = s.split("#")[0].split("?")[0];
		if (!s) return "";
		if (s.charAt(0) !== "/") s = "/" + s;
		return s.slice(0, 300);
	}

	/** 反馈页自己的路径不算「来源」 */
	function isFeedbackPath(pathname) {
		return /^\/feedback\/?$/.test(String(pathname || ""));
	}

	/**
	 * 记录来源页面。两个来源：
	 *   ① URL 上的 ?from=（nav 图标在每一页就地拼好，最准）
	 *   ② document.referrer（直接粘链接、或旧页面进来的兜底）
	 * 拿到就存进 localStorage：草稿还没写完时刷新/换标签也不会丢。
	 */
	function captureFrom() {
		var from = "";
		try {
			from = normalizeFrom(new URLSearchParams(window.location.search).get("from"));
		} catch (e) {}
		if (!from) {
			var ref = document.referrer || "";
			if (ref) {
				try {
					var u = new URL(ref);
					if (u.origin === window.location.origin && !isFeedbackPath(u.pathname)) {
						from = normalizeFrom(u.pathname);
					}
				} catch (e) {}
			}
		}
		if (!from) return "";
		try { localStorage.setItem(FROM_KEY, JSON.stringify({ from: from, at: Date.now() })); } catch (e) {}
		return from;
	}

	/** 取已记录的来源：先看本页刚捕获的，再看 localStorage（30 分钟内有效） */
	function storedFrom() {
		try {
			var raw = localStorage.getItem(FROM_KEY);
			if (!raw) return "";
			var d = JSON.parse(raw);
			if (!d || !d.from) return "";
			if (d.at && Date.now() - d.at > FROM_TTL) { localStorage.removeItem(FROM_KEY); return ""; }
			return normalizeFrom(d.from);
		} catch (e) { return ""; }
	}

	/**
	 * 把来源写进「来源页面」输入框。只填空值 —— 用户自己改过的、或草稿里存着的，
	 * 一律不覆盖（否则他填完又被自动值盖掉，等于白填）。
	 */
	function applyFrom(value) {
		var from = normalizeFrom(value) || storedFrom();
		if (!from || !els.page) return "";
		if (!els.page.value.trim()) els.page.value = from;
		var hint = $("fbPageHint");
		if (hint) hint.textContent = "已自动填入进入反馈页前所在的页面，可改。「/feedback/」表示浏览广场时点的反馈。";
		return from;
	}

	/* ---------------- 环境信息 ---------------- */

	function metaLines() {
		var nav = window.navigator || {};
		var from = (els.page && els.page.value || "").trim();
		var screenSize = (window.screen && window.screen.width && window.screen.height)
			? window.screen.width + "x" + window.screen.height : "?";
		return [
			"页面: " + (window.location.href || ""),
			"来源页面: " + (from || "（未记录）"),
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

		postJson(url, options, SUBMIT_TIMEOUT).then(function (data) {
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
			setStatus(aborted ? "发布超时，可稍后重试" : "网络异常：连不上反馈服务，可稍后重试", "Error");
		});

		function done() {
			replying = false;
			if (btn) { btn.disabled = false; btn.textContent = "发布回复"; }
		}
	}

	function openGithubForReply(body) {
		var target = currentDetail && currentDetail.discussion ? currentDetail.discussion.url : ("https://github.com/" + REPO + "/discussions");
		openGithubUrl(target);
	}

	/** 所有「跳去 GitHub」统一走这里：普通新标签打开即可 */
	function openGithubUrl(url) {
		window.open(url, "_blank", "noopener,noreferrer");
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
			// 中继和直连都没通：说清楚是网络问题，并给重试
			setListStatus("连不上反馈服务（网络异常）。可以点「重试」，或直接到 GitHub Discussions 查看。", "Error");
			renderList();
			showRetryButton();
		});
	}

	/** 列表加载失败时给一个「重试」按钮，别让用户只能刷新整页 */
	function showRetryButton() {
		if (!els.loadMore) return;
		els.loadMore.hidden = false;
		els.loadMore.disabled = false;
		els.loadMore.textContent = "重试";
		els.loadMore.setAttribute("data-retry", "1");
	}

	/* ---------------- 新建弹窗 ---------------- */

	function openModal(focusBody) {
		if (!els.overlay) return;
		modalOpen = true;
		els.overlay.classList.add("isVisible");
		updateTypeHint();
		if (focusBody !== false) {
			setTimeout(function () {
				// 标题是第一个字段：空着就先落在标题上（写标题的顺序也在前），
				// 已经有标题（草稿恢复）才落正文
				var target = (els.title && !els.title.value.trim()) ? els.title : (els.body || null);
				try { if (target) target.focus({ preventScroll: true }); } catch (e) {}
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

	/**
	 * 讨论标题。与函数端 defaultTitle / buildTitle 严格同口径，列表里立刻显示不跳字：
	 *   · 用户填了标题 → 补上「[类型] 」前缀（已经自己写了 [xxx] 的不重复加）
	 *   · 没填 → 退回「[类型] 内容首行」（超 60 字截断）
	 */
	function buildTitle(payload) {
		var def = typeDef(payload.type);
		var typed = String(payload.title || "").trim().slice(0, 120);
		if (typed) return typed.charAt(0) === "[" ? typed : "[" + def.github + "] " + typed;
		var line = firstLine(payload.body);
		if (line.length > 60) line = line.slice(0, 60) + "…";
		return "[" + def.github + "] " + line;
	}

	function githubUrl(payload) {
		var def = typeDef(payload.type);
		var base = "https://github.com/" + REPO + "/discussions/new";
		var params = ["category=" + encodeURIComponent(typeMap[payload.type] || def.github)];
		params.push("title=" + encodeURIComponent(buildTitle(payload)));
		var body = payload.body;
		if (payload.page) body = "**来源页面**：" + payload.page + "\n\n" + body;
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
		// 「新建」类链接只能在真 GitHub 上做（镜像站登录不了）—— 直接打开即可；
		// 打不开也不影响：站内「提交」走的是 Supabase，草稿还在本机。
		openGithubUrl(githubUrl(p));
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
		var postBody = JSON.stringify({
			type: p.type,
			title: p.title,
			body: p.body,
			contact: p.contact,
			hp: (els.hp && els.hp.value || "").trim(),
			meta: metaLines(),
			page: p.page || window.location.pathname || "/feedback/"
		});
		var options = {
			method: "POST",
			headers: headers(),
			body: postBody,
			cache: "no-store"
		};
		if (controller) options.signal = controller.signal;

		postJson(url, options, SUBMIT_TIMEOUT).then(function (data) {
			if (timer) clearTimeout(timer);
			finish();

			if (data && data.success) {
				clearDraft();
				if (els.title) els.title.value = "";
				if (els.body) els.body.value = "";
				if (els.contact) els.contact.value = "";
				if (els.page) els.page.value = "";
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
						title: data.title || buildTitle(p),
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
			// 草稿一直在本机，重试不会丢字
			setStatus(aborted
				? "提交超时：反馈服务没响应。内容已保存为草稿，可稍后重试。"
				: "网络异常：连不上反馈服务。内容已保存为草稿，可稍后重试。", "Error");
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
			title: $("fbTitle"),
			body: $("fbBody"),
			contact: $("fbContact"),
			page: $("fbPage"),
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
					openGithubUrl(target, $("fbReplyStatus"));
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
			els.loadMore.addEventListener("click", function () {
				// 失败后这个按钮是「重试」：重置链路（中继可能刚部署好）并从头拉
				if (els.loadMore.getAttribute("data-retry") === "1") {
					els.loadMore.removeAttribute("data-retry");
					els.loadMore.textContent = "加载更多";
					transport = "relay";
					loadList(true);
					return;
				}
				loadList(false);
			});

		}

		// 新建
		if (els.newBtn) {
			els.newBtn.addEventListener("click", function () {
				// 在广场上点「新建」：来源页面就是广场本身（浏览器返回也回到这儿）
				if (els.page && !els.page.value.trim()) els.page.value = "/feedback/";
				openModal(true);
			});
		}
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
		if (els.title) {
			els.title.addEventListener("input", saveDraft);
			els.title.addEventListener("focus", prewarm, { once: true });
		}
		if (els.body) {
			els.body.addEventListener("input", saveDraft);
			els.body.addEventListener("focus", prewarm, { once: true });
		}
		if (els.contact) els.contact.addEventListener("input", saveDraft);
		if (els.page) els.page.addEventListener("input", saveDraft);

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

		// 来源页面：先就地捕获（?from= / referrer），再补进输入框（只填空值）
		var captured = captureFrom();
		applyFrom(captured);

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
