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

	/**
	 * 窄屏分类图标（issue #36）。桌面显示文字，窄屏只留图标 ——
	 * 完整单词在手机上会把标题挤没，但完全不给标签又分不出类型。
	 * 统一 24 网格、stroke 走 currentColor，颜色由各自的 fbBadge-* 决定。
	 */
	var TYPE_ICONS = {
		bug: '<circle cx="12" cy="13" r="4"/><path d="M12 9V6"/><path d="M8.5 11.5 5 9.5"/><path d="M15.5 11.5 19 9.5"/><path d="M8.5 15 5 17"/><path d="M15.5 15 19 17"/>',
		feature: '<path d="M12 4l1.7 4.8L18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.2z"/>',
		question: '<path d="M9.2 9.3a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1-1.3 1.9v.4"/><circle cx="12" cy="17.6" r="1"/>',
		chat: '<path d="M20 15a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
		others: '<circle cx="6.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="17.5" cy="12" r="1.2"/>'
	};

	/**
	 * 跟进状态（issue #37 / #29）。顺序即界面上复选框的顺序。
	 *
	 * 判定在后端做（只有它能读到评论作者），前端只负责显示与筛选；
	 * key 必须与 supabase/functions/feedback 里的 FollowState 一字不差。
	 */
	var STATES = [
		{ key: "open", label: "已反馈", hint: "还没人跟进的原始反馈",
			icon: '<circle cx="12" cy="12" r="7"/>' },
		{ key: "followed", label: "已跟进", hint: "维护者已经在评论里回复过",
			icon: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>' },
		{ key: "planned", label: "已计划", hint: "维护者已把它链接到某个 Issue",
			icon: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M8.5 14l2.5 2.5 4-4.5"/>' },
		{ key: "complete", label: "已完成", hint: "已完成的反馈，讨论已关闭",
			icon: '<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>' },
		{ key: "duplicate", label: "重复", hint: "与已有讨论重复，已关闭",
			icon: '<rect x="8.5" y="3.5" width="12" height="12" rx="2"/><path d="M15.5 15.5v3a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3"/>' },
		{ key: "not_planned", label: "不计划", hint: "暂不打算做，已关闭",
			icon: '<circle cx="12" cy="12" r="7.5"/><path d="M8.5 12h7"/>' }
	];

	/** 默认只看还没了结的三种；已关闭的默认折叠起来 */
	var DEFAULT_STATES = { open: true, followed: true, planned: true, complete: false, duplicate: false, not_planned: false };

	var PAGE_SIZE_FIRST = 20;   // 首屏一次性拉 20 条
	var PAGE_SIZE_MORE = 20;    // 之后每批也是 20 条
	var AUTO_FILL_MAX = 4;      // 筛选后一条都没有时，最多再自动补拉几页

	var els = {};
	var currentType = "bug";
	var currentFilter = "all";
	var activeStates = null;    // key → 是否勾选（null 表示还没从 DOM 读）
	var allDiscussions = [];
	var nextCursor = null;
	var typeMap = {};          // type → 仓库里实际分类名
	var prewarmed = false;
	var submitting = false;
	/**
	 * 每次打开弹窗 +1。提交请求可能跨越「关掉→重新打开」：
	 * 回调回来时如果这个号变了，说明它属于上一份表单，结果和提示一律丢弃 ——
	 * 否则「已提交，谢谢！」会写进用户刚打开的新表单里。
	 */
	var modalSession = 0;
	var modalOpen = false;
	var detailNumber = null;   // 当前打开的讨论编号（null = 列表视图）
	var currentDetail = null;
	var replying = false;
	var listIdentity = null;   // 后端告诉我们当前用的是 App(bot) 还是 PAT
	var listMaintainer = null; // 后端下发的维护者登录名（用于「管理员」标签与状态口径）
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
			page: (els.page && els.page.value || "").trim(),
			attach: attachSnapshot()
		};
	}

	/**
	 * 草稿只在「表单已经开始被用户操作」之后才写。
	 * 启动时 setType() 会走一次 saveDraft，那时表单还是空的，
	 * 放行就会把上一次的历史直接抹掉。所以启动完成前一律不写盘。
	 */
	var draftReady = false;
	/** 正在往表单里灌历史内容：这期间 setType() 引起的 saveDraft() 必须跳过 */
	var restoring = false;

	function saveDraft() {
		if (!draftReady || restoring) return;
		try {
			var d = payloadDraft();
			if (!d.body && !d.contact && !d.title) { localStorage.removeItem(DRAFT_KEY); refreshRestoreBtn(); return; }
			d.at = Date.now();
			localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
			refreshRestoreBtn();
		} catch (e) {}
	}

	/**
	 * 读出草稿（不落进表单）。
	 * 超过 7 天视为过期，顺手清掉。没有可用内容返回 null。
	 */
	function readDraft() {
		var raw = null;
		try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
		if (!raw) return null;
		var d = null;
		try { d = JSON.parse(raw); } catch (e) { return null; }
		if (!d || typeof d !== "object") return null;
		if (d.at && Date.now() - d.at > 7 * 24 * 3600 * 1000) { clearDraft(); return null; }
		if (!d.body && !d.contact && !d.title) return null;
		return d;
	}

	/**
	 * 把上次的内容恢复进表单。**只在用户点「恢复上次内容」时调用** ——
	 * 打开新建对话框始终是空白的（见 issue #20），内容一直留着。
	 */
	function restoreDraft() {
		var d = readDraft();
		if (!d) return false;
		// 填值期间一律不写盘：setType() 会触发 saveDraft()，
		// 那一刻字段还是空的，放行就会把刚要恢复的这条历史当场删掉。
		restoring = true;
		try {
			if (d.title && els.title) els.title.value = d.title;
			if (d.body && els.body) els.body.value = d.body;
			if (d.contact && els.contact) els.contact.value = d.contact;
			if (d.page && els.page) els.page.value = d.page;
			// 附带项也跟着回来：上次特意取消勾选的，恢复时不该又勾上
			applyAttach(d.attach);
			// 最后再定类型：此时表单已有内容，setType 顺手存回去也是对的
			if (d.type) setType(d.type);
		} finally {
			restoring = false;
		}
		return true;
	}

	/** 「恢复上次内容」：有历史才显示，没历史就藏起来 */
	function refreshRestoreBtn() {
		if (!els.restoreBtn) return;
		els.restoreBtn.hidden = !readDraft();
	}

	function clearDraft() {
		try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
		refreshRestoreBtn();
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

	/**
	 * 把路径还原成站点里的真实大小写。
	 *
	 * Netlify 会把网址强制小写（/Cube/Formula/ → /cube/formula/），所以
	 * `?from=`、`document.referrer`、`location.pathname` 拿到的都是小写。
	 * 顶栏 nav.js 里有一张登记表（PATH_LABELS）记着真实目录名，优先借它；
	 * nav.js 还没加载完就先用本地这份兜底表（只收含大写的路径）。
	 */
	var FROM_CASE_FALLBACK = {
		"cube": "Cube",
		"cube/formula": "Cube/Formula",
		"cube/formula/classic": "Cube/Formula/Classic",
		"cube/formula - 副本": "Cube/Formula - 副本",
		"cube/analyzer": "Cube/Analyzer",
		"cube/cross": "Cube/Cross",
		"cube/music": "Cube/Music",
		"cube/trainer": "Cube/Trainer",
		"study": "Study",
		"study/focus": "Study/Focus",
		"study/merit": "Study/Merit",
		"study/merit/beta-qwen": "Study/Merit/beta-Qwen",
		"study/merit/beta-step": "Study/Merit/beta-step",
		"study/question": "Study/Question",
		"study/timer": "Study/Timer",
		"tools": "Tools",
		"tools/darkpdf": "Tools/DarkPDF",
		"tools/kgenesis": "Tools/KGenesis",
		"tools/pulse": "Tools/Pulse",
		"tools/relay": "Tools/Relay",
		"tools/roster": "Tools/Roster",
		"tools/speed": "Tools/Speed",
		"jump/onedrive": "jump/OneDrive"
	};

	function trueCasePath(pathname) {
		var nav = window.siteNav;
		if (nav && typeof nav.trueCasePath === "function") {
			try { return nav.trueCasePath(pathname); } catch (e) {}
		}
		var input = String(pathname == null ? "" : pathname);
		if (!input) return input;
		var trailing = /\/$/.test(input) ? "/" : "";
		var body = trailing ? input.slice(0, -1) : input;
		var head = body.charAt(0) === "/" ? "/" : "";
		if (head) body = body.slice(1);
		if (!body) return head || "/";

		var segs = body.split("/");
		var out = [];
		var i = 0;
		while (i < segs.length) {
			var found = null;
			var foundLen = 0;
			for (var len = segs.length - i; len >= 1; len--) {
				var key = segs.slice(i, i + len).join("/").toLowerCase();
				if (Object.prototype.hasOwnProperty.call(FROM_CASE_FALLBACK, key)) {
					found = FROM_CASE_FALLBACK[key];
					foundLen = len;
					break;
				}
			}
			if (found) {
				out = out.concat(found.split("/"));
				i += foundLen;
			} else {
				out.push(segs[i]);
				i += 1;
			}
		}
		return head + out.join("/") + trailing;
	}

	/** 规范化：补前导斜杠，去掉零宽/控制字符，只留路径（丢 query / hash），最长 300 */
	function normalizeFrom(value) {
		if (!isSitePath(value)) return "";
		var s = String(value).replace(/[\u0000-\u001F\u007F]/g, "").trim();
		// 去掉 query 与 hash：?from= 里只会是路径，留着反而把一次性参数带进反馈表
		s = s.split("#")[0].split("?")[0];
		if (!s) return "";
		if (s.charAt(0) !== "/") s = "/" + s;
		return trueCasePath(s).slice(0, 300);
	}

	/** 反馈页自己的路径不算「来源」 */
	function isFeedbackPath(pathname) {
		return /^\/feedback\/?$/.test(String(pathname || ""));
	}

	/**
	 * 按**当前上下文**算出「来源页面」，不读任何历史存储。
	 *
	 * 优先级：
	 *   ① URL 上的 ?from=（nav 图标在每一页就地拼好，最准）
	 *   ② document.referrer（同源、且不是反馈页自己）
	 *   ③ 兜底：浏览广场时点的「新建」⇒ /feedback/
	 *
	 * ⚠️ 这里**绝不**去看 localStorage 里存过的旧值。半小时内先在
	 * /Cube/Formula/ 点过反馈、再回广场点「新建」，读旧值就会把
	 * /Cube/Formula/ 又吐出来 —— 那正是「保留上次结果」。
	 */
	function currentFrom() {
		var from = "";
		try {
			from = normalizeFrom(new URLSearchParams(window.location.search).get("from"));
		} catch (e) {}
		if (from) return from;
		var ref = document.referrer || "";
		if (ref) {
			try {
				var u = new URL(ref);
				if (u.origin === window.location.origin && !isFeedbackPath(u.pathname)) {
					from = normalizeFrom(u.pathname);
				}
			} catch (e) {}
		}
		if (from) return from;
		// 直接打开 /feedback/ 点「新建」：来源就是广场本身
		return isFeedbackPath(window.location.pathname) ? "/feedback/" : "";
	}

	/**
	 * 记录来源页面。两个来源：
	 *   ① URL 上的 ?from=（nav 图标在每一页就地拼好，最准）
	 *   ② document.referrer（直接粘链接、或旧页面进来的兜底）
	 * 拿到就存进 localStorage：草稿还没写完时刷新/换标签也不会丢。
	 */
	function captureFrom() {
		var from = currentFrom();
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
	 * 把来源写进「来源页面」输入框。
	 *
	 * `force = true`（打开新建对话框时用）：**无条件覆盖** —— 先清空再写当前算出来的值，
	 *   这样上一次留下的路径不会赖在框里。
	 * `force = false`（启动时用）：只在空值时才填，不覆盖任何已有内容。
	 */
	function applyFrom(value, force) {
		if (!els.page) return "";
		var from = normalizeFrom(value) || (force ? currentFrom() : storedFrom());
		if (force && !from) {
			els.page.value = "";
			return "";
		}
		if (!from) return "";
		if (force || !els.page.value.trim()) els.page.value = from;
		var hint = $("fbPageHint");
		if (hint) hint.textContent = "已自动填入进入反馈页前所在的页面，可改。「/feedback/」表示浏览广场时点的反馈。";
		return from;
	}

	/* ---------------- 环境信息 ---------------- */

	/**
	 * 「一并提交」勾选项（issue #18）。
	 *
	 * 以前是全都塞进去，用户没法选 —— 有人不想暴露浏览器或屏幕，也有人觉得噪音太大。
	 * 现在每一项独立勾选，勾上的才出现在正文的「环境信息」折叠块里。
	 * 来源页面**不在这里**：它写在表单最上面那个框里，并且一定放在正文顶部。
	 */
	var ATTACH = [
		{ key: "viewport", label: "视口与屏幕" },
		{ key: "ua", label: "浏览器标识" },
		{ key: "page", label: "完整页面地址" },
		{ key: "theme", label: "当前主题" },
		{ key: "referrer", label: "来源网址" }
	];

	var attachPicked = null;

	/** 读一遍勾选状态；没渲染出来时按「全默认」处理 */
	function readAttach() {
		var out = {};
		var box = els.attach;
		if (box) {
			var inputs = box.querySelectorAll("input[data-attach]");
			for (var i = 0; i < inputs.length; i++) {
				out[inputs[i].getAttribute("data-attach")] = !!inputs[i].checked;
			}
		} else {
			for (var j = 0; j < ATTACH.length; j++) out[ATTACH[j].key] = true;
		}
		attachPicked = out;
		return out;
	}

	/**
	 * 按勾选拼环境信息。**一行都不勾就返回空串** ——
	 * 后端拿到的 meta 为空时，正文里连 `环境信息` 折叠块都不会出现。
	 */
	function metaLines() {
		var picked = attachPicked || readAttach();
		var nav = window.navigator || {};
		var lines = [];
		if (picked.page) lines.push("页面: " + (window.location.href || ""));
		if (picked.referrer) lines.push("来源: " + (document.referrer || "（直接打开）"));
		if (picked.viewport) {
			var screenSize = (window.screen && window.screen.width && window.screen.height)
				? window.screen.width + "x" + window.screen.height : "?";
			lines.push("视口: " + (window.innerWidth || 0) + "x" + (window.innerHeight || 0)
				+ " @dpr " + (window.devicePixelRatio || 1) + "（屏幕 " + screenSize + "）");
		}
		if (picked.ua) lines.push("UA: " + (nav.userAgent || "?"));
		if (picked.ua) lines.push("语言: " + (nav.language || "?"));
		if (picked.theme) lines.push("主题: " + (document.documentElement.dataset.theme || "light"));
		return lines.join("\n");
	}

	/** 把当前的附带项选择记进草稿，重开页面还能记住上一次的勾法 */
	function attachSnapshot() {
		var picked = readAttach();
		var out = {};
		for (var k in picked) if (Object.prototype.hasOwnProperty.call(picked, k)) out[k] = picked[k];
		return out;
	}

	function applyAttach(saved) {
		if (!saved) return;
		var box = els.attach;
		if (!box) return;
		var inputs = box.querySelectorAll("input[data-attach]");
		for (var i = 0; i < inputs.length; i++) {
			var key = inputs[i].getAttribute("data-attach");
			if (key in saved) inputs[i].checked = !!saved[key];
		}
		readAttach();
	}

	/** 复位到默认勾选（打开新建弹窗时用，与「每次打开都是空白表单」一致） */
	function resetAttach() {
		var box = els.attach;
		if (!box) return;
		var inputs = box.querySelectorAll("input[data-attach]");
		for (var i = 0; i < inputs.length; i++) {
			var key = inputs[i].getAttribute("data-attach");
			inputs[i].checked = key === "viewport" || key === "ua" || key === "page";
		}
		readAttach();
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

	/** 状态定义；后端给了不认识的值就当「已反馈」，别把条目凭空藏掉 */
	function stateDef(key) {
		for (var i = 0; i < STATES.length; i++) if (STATES[i].key === key) return STATES[i];
		return STATES[0];
	}

	/**
	 * 讨论的跟进状态。
	 *
	 * 后端算好的值是唯一权威（只有它读得到评论作者）。但**后端还没升级时没有 state 字段**，
	 * 这里不能静默当成「已反馈」—— 那正是「明明有维护者回复、还标已反馈」的成因。
	 * 所以：
	 *   · 有 state → 用；
	 *   · 没有 state 但知道 closed → 至少能分出已关闭（按 complete 显示）；
	 *   · 什么都没有 → 返回 null，调用方不画状态标签，也不让它被状态筛选误伤。
	 */
	function stateOf(d) {
		if (d && typeof d.state === "string" && d.state) {
			for (var i = 0; i < STATES.length; i++) if (STATES[i].key === d.state) return STATES[i].key;
		}
		if (d && typeof d.closed === "boolean") return d.closed ? "complete" : null;
		return null;
	}

	/**
	 * 后端到底给没给状态。整个列表一条都没有 state 字段 ⇒ 是旧的函数版本
	 * （或者自己算不出来），这时状态筛选应当整体失效，而不是把条目全过滤掉。
	 */
	function statesAvailable() {
		for (var i = 0; i < allDiscussions.length; i++) {
			if (typeof allDiscussions[i].state === "string" && allDiscussions[i].state) return true;
		}
		return false;
	}

	/** 维护者登录名：后端下发，拿不到就用默认值，与函数端保持同一口径 */
	function maintainerLogin() {
		return listMaintainer || "Ckarefulon";
	}

	/**
	 * 作者显示：bot（站点代发）、维护者（管理员）与真人分开标注，不冒用账号名。
	 *
	 * 管理员标签（issue #38）只认登录名，不认「这个人回得多」之类的推断 ——
	 * 名字来自后端 FEEDBACK_MAINTAINER，换人不用改前端。
	 */
	function authorLabel(author, identity) {
		// 列表里作者是字符串（login），详情里是 {login, avatarUrl}
		var login = typeof author === "string" ? author : (author && author.login ? author.login : "");
		if (!login) return "匿名";
		var admin = isMaintainer(login)
			? '<span class="fbAuthorAdmin" title="该站点的维护者">管理员</span>' : "";
		// GitHub App 的 bot 账号名形如 "xxx[bot]"
		if (/\[bot\]$/.test(login)) {
			return '<span class="fbAuthorBot">站点代发</span>' + admin;
		}
		if (identity && identity.mode === "pat") {
			// 用 PAT 时所有提交都挂在维护者名下 —— 标注出来，别让人以为是提交者本人
			return escapeHtml("@" + login) + admin + '<span class="fbAuthorNote">（维护者账号代发）</span>';
		}
		return escapeHtml("@" + login) + admin;
	}

	/** 是不是维护者本人（大小写不敏感，GitHub 登录名本身也不区分大小写） */
	function isMaintainer(login) {
		return String(login || "").toLowerCase() === String(maintainerLogin()).toLowerCase();
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
		els.main.hidden = true;
		els.detail.hidden = false;
		window.scrollTo(0, 0);
		loadDetail(detailNumber);
	}

	function closeDetail() {
		if (!els.detail) return;
		els.detail.hidden = true;
		els.main.hidden = false;
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
				// 详情也带维护者名：直接点开深链接（?d=3）时列表可能还没回来，
				// 不接这一份「管理员」标签就不显示
				if (data.maintainer) listMaintainer = String(data.maintainer);
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
		var state = stateOf(d);
		var body = stripMeta(d.body);
		// 来源页面已经从正文里剥出去了，单独在头部展示（issue #18）
		var from = extractFrom(d.body);

		els.detailBody.innerHTML = ''
			+ '<article class="fbPost">'
			+ '	<header class="fbPostHead">'
			+ badgeHtml(type, d.category ? d.category.name : "未分类")
			+ stateBadgeHtml(state)
			+ '		<span class="fbPostMeta">#' + escapeHtml(d.number) + " · " + authorLabel(d.author, identity)
			+ " · " + escapeHtml(fmtDate(d.createdAt)) + "</span>"
			+ "	</header>"
			+ '	<h1 class="fbPostTitle">' + escapeHtml(d.title) + "</h1>"
			+ (from ? '	<div class="fbPostFrom">来源页面：<code>' + escapeHtml(from) + "</code></div>" : "")
			+ '	<div class="fbPostBody">' + markdownLite(body) + "</div>"
			+ "</article>"
			+ '<h2 class="fbCommentsTitle">回复 <span class="fbCommentsCount">' + escapeHtml(data.totalComments || 0) + "</span></h2>"
			+ '<div class="fbComments">' + renderComments(data.comments || [], identity) + "</div>"
			+ renderReplyForm(identity);
	}

	/** 从正文顶部取出 `**来源页面**：/xxx/`（issue #18 起写在正文最上面） */
	function extractFrom(body) {
		var m = String(body || "").match(/^\s*\*\*来源页面\*\*[：:]\s*(\S+)/);
		return m ? m[1] : "";
	}

	/** 去掉我们附加的环境信息与签名，正文只留用户写的内容 */
	function stripMeta(body) {
		var text = String(body || "");
		// 来源页面是我们加在最上面的一行，已由 extractFrom 单独展示，正文里去掉
		text = text.replace(/^\s*\*\*来源页面\*\*[：:][^\n]*(\r?\n)+/, "");
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

	/** 当前勾选的状态集合；没读过 DOM 时按默认三项 */
	function readStates() {
		if (activeStates) return activeStates;
		var box = els.statesPanel;
		if (!box) { activeStates = copyStates(DEFAULT_STATES); return activeStates; }
		var out = {};
		var inputs = box.querySelectorAll("input[data-state]");
		for (var i = 0; i < inputs.length; i++) {
			out[inputs[i].getAttribute("data-state")] = !!inputs[i].checked;
		}
		activeStates = out;
		return out;
	}

	function copyStates(src) {
		var out = {};
		for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = !!src[k];
		return out;
	}

	/** 一项都没勾时不应该「什么都看不见」，而是提示一下 */
	function noStateChecked() {
		var s = readStates();
		for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && s[k]) return false;
		return true;
	}

	/**
	 * 状态筛选是否真的在起作用。
	 * 后端一条 state 都没给（旧函数版本）时整体失效 —— 否则每条都 `stateOf()===null`，
	 * 会被过滤成「一条都没有」，看着像广场空了。
	 */
	function stateFilterActive() {
		if (noStateChecked()) return false;
		if (!statesAvailable()) return false;
		return true;
	}

	/** 过一个筛选：类型 + 状态两道都过才算 */
	function filterItems() {
		var items = allDiscussions;
		if (currentFilter !== "all") {
			items = items.filter(function (d) {
				return slugToType(d.category && d.category.slug) === currentFilter;
			});
		}
		if (stateFilterActive()) {
			var states = readStates();
			items = items.filter(function (d) { return !!states[stateOf(d)]; });
		}
		return items;
	}

	/**
	 * 状态筛选用下拉框装着（issue #37 / #29）：六项横铺一屏太占地方，
	 * 而它又不是每次都要动的东西。点外面、按 Esc 都收起。
	 */
	function openStatesDrop() {
		if (!els.statesBtn || !els.statesPanel) return;
		els.statesPanel.hidden = false;
		els.statesBtn.setAttribute("aria-expanded", "true");
		if (els.statesDrop) els.statesDrop.classList.add("isOpen");
	}

	function closeStatesDrop() {
		if (!els.statesBtn || !els.statesPanel) return;
		els.statesPanel.hidden = true;
		els.statesBtn.setAttribute("aria-expanded", "false");
		if (els.statesDrop) els.statesDrop.classList.remove("isOpen");
	}

	function toggleStatesDrop() {
		if (!els.statesPanel) return;
		if (els.statesPanel.hidden) openStatesDrop(); else closeStatesDrop();
	}

	/** 按钮上写「状态」还是「状态 3/6」：让人一眼知道被过滤过 */
	function refreshStatesBtn() {
		if (!els.statesBtn || !els.statesBtnText) return;
		var picked = readStates();
		var total = 0;
		var on = 0;
		for (var k in picked) {
			if (!Object.prototype.hasOwnProperty.call(picked, k)) continue;
			total += 1;
			if (picked[k]) on += 1;
		}
		// 后端没给 state 时筛选其实不生效，就别装作在筛选
		if (!statesAvailable() || on === total) {
			els.statesBtnText.textContent = "状态";
			els.statesBtn.removeAttribute("data-filtered");
			return;
		}
		els.statesBtnText.textContent = on === 0 ? "状态 0/" + total : "状态 " + on + "/" + total;
		els.statesBtn.setAttribute("data-filtered", "1");
	}

	/** 空列表时说什么：分了三种情况，别一句「这里还没有内容」糊弄过去 */
	function emptyHint() {
		// 还有没拉过的讨论：说明只是这一屏没命中，指路「加载更多」
		if (nextCursor) return "已载入的这部分里没有符合的，点「加载更多」继续往后找。";
		// 一条讨论都没有：真的空
		if (!allDiscussions.length) return "你是第一个，点「新建」说点什么吧。";
		// 全都拉完了还是没有：是筛选的问题，告诉他换个筛选
		if (currentFilter !== "all" || activeStates) {
			return "已载入的 " + allDiscussions.length + " 条里没有符合当前筛选的，换个分类或把状态勾全试试。";
		}
		return "这个分类下暂时没有讨论。";
	}

	function renderList() {
		if (!els.list) return;
		var items = filterItems();
		refreshStatesBtn();

		// 只在「状态筛选真的能起作用」时才提示「没勾任何状态」。
		// 后端没给 state 时筛选整体失效，这里不该弹这句话吓人。
		if (noStateChecked() && statesAvailable()) {
			els.list.innerHTML = "";
			var none = document.createElement("div");
			none.className = "fbEmpty";
			none.innerHTML = '<div class="fbEmptyTitle">没有选中任何状态</div>'
				+ '<div class="fbEmptyText">状态筛选里全部取消了勾选，随便勾一个就能看到对应的反馈。</div>';
			els.list.appendChild(none);
			return;
		}

		if (!items.length) {
			els.list.innerHTML = "";
			var empty = document.createElement("div");
			empty.className = "fbEmpty";
			empty.innerHTML = '<div class="fbEmptyTitle">这里还没有内容</div>'
				+ '<div class="fbEmptyText">' + emptyHint() + "</div>";
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

	/** 分类徽标：桌面是彩色胶囊 + 文字，窄屏靠 CSS 换成图标（issue #36） */
	function badgeHtml(type, catName) {
		var icon = TYPE_ICONS[type] || TYPE_ICONS.others;
		return '<span class="fbItemBadge fbBadge-' + escapeHtml(type) + '" title="' + escapeHtml(catName) + '">'
			+ '<svg class="fbBadgeIcon" viewBox="0 0 24 24" width="14" height="14" fill="none" '
			+ 'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" '
			+ 'aria-hidden="true">' + icon + "</svg>"
			+ '<span class="fbBadgeText">' + escapeHtml(catName) + "</span>"
			+ "</span>";
	}

	/** 状态徽标：桌面文字 + 图标，窄屏只留图标（title 里仍有全称）；没有状态就不画 */
	function stateBadgeHtml(key) {
		if (!key) return "";
		var def = stateDef(key);
		return '<span class="fbStateTag fbState-' + escapeHtml(def.key) + '" title="' + escapeHtml(def.hint) + '">'
			+ '<svg class="fbStateIcon" viewBox="0 0 24 24" width="13" height="13" fill="none" '
			+ 'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" '
			+ 'aria-hidden="true">' + def.icon + "</svg>"
			+ '<span class="fbStateText">' + escapeHtml(def.label) + "</span>"
			+ "</span>";
	}

	function renderItem(d) {
		var type = slugToType(d.category && d.category.slug);
		var catName = d.category ? d.category.name : "未分类";
		return ''
			+ '<a class="fbItem" href="?d=' + escapeHtml(d.number) + '" data-number="' + escapeHtml(d.number) + '">'
			+ '	<span class="fbItemTags">'
			+ badgeHtml(type, catName)
			+ stateBadgeHtml(stateOf(d))
			+ "	</span>"
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

	/**
	 * 拉列表。
	 *
	 * 首屏只要 7 条（issue #39）—— 一进页面就等三十条渲染完，手机上很肉；
	 * 而且绝大多数人只看最上面几条。之后每次多拉一些，靠「加载更多」往后。
	 *
	 * 但「筛选之后一条都不剩」不能只显示一句空的：那会让人以为真没有。
	 * 所以 `ensureFiltered()` 会自动再往后翻，直到筛出内容或者翻完为止。
	 */
	function loadList(reset) {
		if (reset) {
			allDiscussions = [];
			nextCursor = null;
		}
		var url = endpoint();
		if (!url) {
			setListStatus("站点后端未配置，无法加载列表；可直接到 GitHub 查看", "Error");
			renderList();
			return Promise.resolve(false);
		}

		setListStatus(allDiscussions.length ? "正在加载更多…" : "正在加载…", "");
		if (els.loadMore) els.loadMore.disabled = true;

		var first = allDiscussions.length ? PAGE_SIZE_MORE : PAGE_SIZE_FIRST;
		var listUrl = url + "?action=list&first=" + first
			+ (nextCursor ? "&after=" + encodeURIComponent(nextCursor) : "");
		return getJson(listUrl, 20000).then(function (data) {
			if (data && data.configure) {
				setListStatus("反馈服务尚未配置，可直接到 GitHub Discussions 查看", "Warning");
				renderList();
				return false;
			}
			if (!data || !data.success) {
				setListStatus((data && data.message) || "加载失败，请稍后再试", "Error");
				renderList();
				return false;
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
			if (data.maintainer) listMaintainer = String(data.maintainer);

			var added = data.discussions || [];
			allDiscussions = allDiscussions.concat(added);
			nextCursor = data.pageInfo && data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
			setListStatus(listStatusText());
			renderList();
			if (els.loadMore) {
				els.loadMore.hidden = !nextCursor;
				els.loadMore.disabled = false;
			}
			return added.length > 0;
		}).catch(function () {
			// 中继和直连都没通：说清楚是网络问题，并给重试
			setListStatus("连不上反馈服务（网络异常）。可以点「重试」，或直接到 GitHub Discussions 查看。", "Error");
			renderList();
			showRetryButton();
			return false;
		});
	}

	function listStatusText() {
		var shown = filterItems().length;
		if (!allDiscussions.length) return "";
		var base = "共 " + allDiscussions.length + " 条";
		if (shown !== allDiscussions.length) base = "已载入 " + allDiscussions.length + " 条，符合筛选 " + shown + " 条";
		return base + (nextCursor ? "（还有更多）" : "");
	}

	/**
	 * 筛选后是空的，但后面还有没拉过的讨论 → 自动继续翻几页。
	 *
	 * 上限 AUTO_FILL_MAX 页，避免「筛选一个冷门组合 + 几百条讨论」时
	 * 一口气把 GitHub 接口打爆；翻到上限就交给「加载更多」。
	 */
	var autoFilling = false;
	function ensureFiltered(depth) {
		if (autoFilling) return Promise.resolve();
		if (!nextCursor) return Promise.resolve();
		if (filterItems().length > 0) return Promise.resolve();
		if (noStateChecked()) return Promise.resolve();
		if ((depth || 0) >= AUTO_FILL_MAX) return Promise.resolve();
		autoFilling = true;
		return loadList(false).then(function (got) {
			autoFilling = false;
			if (got) return ensureFiltered((depth || 0) + 1);
		}, function () { autoFilling = false; });
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
		// 新一次表单：作废还在飞的提交/恢复回调（见 modalSession 的说明）
		modalSession += 1;
		// 上一次提交可能还在飞：它的按钮状态不能带到这一份表单上
		submitting = false;
		if (els.submit) {
			els.submit.disabled = false;
			els.submit.textContent = els.submitFallbackText || "提交";
		}
		// 打开始终是空白表单：每个字段都不保留上次的值（含来源页面），
		// 来源页面按**当前**上下文重新算一遍，不沿用之前的任何结果。
		// 只有点「恢复上次内容」才把历史灌回来。
		// 清空期间暂停写盘，免得把正在清空的空值当成新草稿存回去。
		restoring = true;
		try {
			if (els.title) els.title.value = "";
			if (els.body) els.body.value = "";
			if (els.contact) els.contact.value = "";
			if (els.page) els.page.value = "";
			// 附带项也回到默认：每次打开都是全新表单
			resetAttach();
			// 类型复位到默认，避免带上次的选项
			setType("bug");
		} finally {
			restoring = false;
		}
		// 来源页面：按当前页重新计算并强制写入（force=true 会覆盖，不吃旧值）
		applyFrom(currentFrom(), true);
		// 状态栏也要清干净：上次「已恢复上次的内容」/「提交失败」之类的提示
		// 不能跟着进新一次的表单，否则看着像这次操作的结果。
		setStatus("");
		// 收起状态下拉，别让上一份表单的选择浮在这一次上面
		closeStatesDrop();
		// 按钮可见性按「此刻」的草稿重新判定 —— 草稿可能在 boot 之后才产生
		// （用户写着写着就有了），不刷新就会一直停留在启动时的 hidden 状态。
		refreshRestoreBtn();
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
		// 关掉就作废这一次表单：还在飞的提交回调回来时会被丢弃，
		// 不会把「已提交，谢谢！」写进下一次打开的空白表单里。
		modalSession += 1;
		submitting = false;
		// 提示条、按钮文案、下拉都归位。不归位的话，下次打开会看见上次的残影。
		setStatus("");
		if (els.submit) {
			els.submit.disabled = false;
			els.submit.textContent = els.submitFallbackText || "提交";
		}
		closeStatesDrop();
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
	 * 讨论标题。与函数端 completeTitleBody / buildTitle 严格同口径，列表里立刻显示不跳字：
	 *   · 用户填了标题 → 补上「[类型] 」前缀（已经自己写了 [xxx] 的不重复加）
	 *   · 没填 → 退回「[类型] 内容首行」（超 60 字截断）
	 * 前提是标题与正文已经互补过（见 completeTitleBody）。
	 */
	function buildTitle(payload) {
		var def = typeDef(payload.type);
		var typed = String(payload.title || "").trim().slice(0, 120);
		if (typed) return typed.charAt(0) === "[" ? typed : "[" + def.github + "] " + typed;
		var line = firstLine(payload.body);
		if (line.length > 60) line = line.slice(0, 60) + "…";
		return "[" + def.github + "] " + line;
	}

	/**
	 * 标题与正文互补（issue #31）。
	 * 只填了标题时，把标题当正文用 —— 而不是用「内容太短」把人挡回去。
	 * 两者都空返回 null。
	 */
	function completeTitleBody(payload) {
		var title = String(payload.title || "").trim();
		var body = String(payload.body || "").trim();
		if (!title && !body) return null;
		if (!body) body = title;
		return { title: title, body: body };
	}

	function githubUrl(payload) {
		var def = typeDef(payload.type);
		var base = "https://github.com/" + REPO + "/discussions/new";
		var params = ["category=" + encodeURIComponent(typeMap[payload.type] || def.github)];
		params.push("title=" + encodeURIComponent(buildTitle(payload)));
		var body = payload.body;
		// 来源页面放最上面（issue #18）：与函数端 buildBody 同一顺序
		if (payload.page) body = "**来源页面**：" + payload.page + "\n\n" + body;
		if (payload.contact) body += "\n\n**联系方式**：" + payload.contact;
		var meta = metaLines();
		if (meta) body += "\n\n<details><summary>环境信息</summary>\n\n```\n" + meta + "\n```\n\n</details>";
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
		var filled = completeTitleBody(p);
		if (!filled) { setStatus("标题和内容至少填一个", "Error"); if (els.body) els.body.focus(); return; }
		if (filled.body.length < 4) { setStatus("请再多写几个字", "Error"); if (els.body) els.body.focus(); return; }
		p.title = filled.title;
		p.body = filled.body;
		// 「新建」类链接只能在真 GitHub 上做（镜像站登录不了）—— 直接打开即可；
		// 打不开也不影响：站内「提交」走的是 Supabase，草稿还在本机。
		openGithubUrl(githubUrl(p));
	}

	function submit() {
		if (submitting) return;
		var p = payloadDraft();

		// 标题与正文互相补齐（issue #31）：只有一个也能提交
		var filled = completeTitleBody(p);
		if (!filled) {
			setStatus("标题和内容至少填一个", "Error");
			if (els.body) els.body.focus();
			return;
		}
		if (filled.body.length < 4) {
			setStatus("请再多写几个字", "Error");
			if (els.body) els.body.focus();
			return;
		}
		p.title = filled.title;
		p.body = filled.body;

		var url = endpoint();
		if (!url) {
			setStatus("站点后端未配置，已改用 GitHub 提交", "Warning");
			openGithub();
			return;
		}

		submitting = true;
		var session = modalSession;   // 记下这次提交属于哪一份表单
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
			// 只有勾上的项才进这个串；一项没勾就是空串，正文里不会有环境信息块
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
			// 提交期间用户可能已经关掉弹窗、又开了新的一份：这一份的结果不该出现。
			// 内容其实已经提交成功了，所以只丢弃「提示与字段清空」，不重试、不报错。
			var stale = session !== modalSession;

			if (data && data.success) {
				if (!stale) {
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
				}
				// 列表里立刻跟上这条（不等重新拉取）：这一条对列表是无害的，无论是否 stale
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
						closed: false,
						state: "open",
						excerpt: firstLine(p.body)
					});
					renderList();
				}
				return;
			}

			if (data && data.configure) {
				if (!stale) {
					setStatus("自动提交未配置，已改用 GitHub 提交", "Warning");
					openGithub();
				}
				return;
			}
			if (!stale) setStatus((data && data.message) || "提交失败，请稍后再试", "Error");
		}).catch(function (err) {
			if (timer) clearTimeout(timer);
			finish();
			// 同上：这份表单已经不在了，错误提示也不该落到新表单上
			if (session !== modalSession) return;
			var aborted = err && err.name === "AbortError";
			// 草稿一直在本机，重试不会丢字
			setStatus(aborted
				? "提交超时：反馈服务没响应。内容已保存为草稿，可稍后重试。"
				: "网络异常：连不上反馈服务。内容已保存为草稿，可稍后重试。", "Error");
		});

		function finish() {
			submitting = false;
			// 按钮属于「当前这份表单」才复位；否则会把新表单的按钮从「提交中…」改回来
			if (session !== modalSession) return;
			if (els.submit) { els.submit.disabled = false; els.submit.textContent = els.submitFallbackText || "提交"; }
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
			if (data && data.maintainer) listMaintainer = String(data.maintainer);
			if (data && data.configure) {
				if (els.submit) els.submit.textContent = "在 GitHub 中提交";
			}
		}).catch(function () {});
	}

	/* ---------------- 启动 ---------------- */

	function boot() {
		els = {
			// ⚠️ 容器与输入框必须分键：els.page 是「来源页面」输入框，
			// 容器另叫 main。混用会把输入框当容器隐藏，列表视图永远关不掉。
			main: $("fbPageMain"),
			detail: $("fbPageDetail"),
			detailBody: $("fbDetailBody"),
			backBtn: $("fbBackBtn"),
			list: $("fbList"),
			listStatus: $("fbListStatus"),
			loadMore: $("fbLoadMore"),
			filters: $("fbFilters"),
			statesDrop: $("fbStatesDrop"),
			statesBtn: $("fbStatesBtn"),
			statesBtnText: $("fbStatesBtnText"),
			statesPanel: $("fbStatesPanel"),
			attach: $("fbAttach"),
			newBtn: $("fbNewBtn"),
			overlay: $("fbOverlay"),
			modalClose: $("fbComposeClose"),
			restoreBtn: $("fbRestoreBtn"),
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
				els.main.hidden = false;
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
				setListStatus(listStatusText());
				renderList();
				// 这个分类在已载入的部分里没有 → 自动往后翻，别让人对着空屏猜
				ensureFiltered(0);
			});
		}

		// 状态筛选（issue #37 / #29）：下拉，勾选变了就地重渲染，不重新请求
		if (els.statesBtn) {
			els.statesBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				toggleStatesDrop();
			});
		}
		if (els.statesPanel) {
			els.statesPanel.addEventListener("change", function (e) {
				var input = e.target;
				if (!input || !input.getAttribute || !input.getAttribute("data-state")) return;
				// 失效缓存，下次读 DOM
				activeStates = null;
				readStates();
				setListStatus(listStatusText());
				renderList();
				ensureFiltered(0);
			});
			// 点面板内部不该把面板关掉
			els.statesPanel.addEventListener("click", function (e) { e.stopPropagation(); });
		}
		// 点别处 / 按 Esc 收起下拉
		document.addEventListener("click", function () { closeStatesDrop(); });

		// 附带信息勾选（issue #18）：只关系到提交内容，顺手存进草稿
		if (els.attach) {
			els.attach.addEventListener("change", function () {
				readAttach();
				saveDraft();
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
				// 来源页面交给 openModal 按当前上下文统一算，这里不再自己填
				openModal(true);
			});
		}
		if (els.modalClose) els.modalClose.addEventListener("click", closeModal);
		if (els.restoreBtn) {
			els.restoreBtn.addEventListener("click", function () {
				if (!restoreDraft()) {
					refreshRestoreBtn();
					setStatus("没有可恢复的历史内容", "Warning");
					return;
				}
				setStatus("已恢复上次的内容", "Success");
				// 恢复完焦点落在正文，方便接着写
				try { (els.body || els.title).focus({ preventScroll: true }); } catch (e) {}
			});
		}
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
			if (e.key === "Escape" && els.statesPanel && !els.statesPanel.hidden) {
				e.stopPropagation();
				closeStatesDrop();
				return;
			}
			if (!modalOpen) return;
			if (e.key === "Escape") { e.stopPropagation(); closeModal(); return; }
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
		}, true);

		// 初始类型。**不自动回填草稿**（#20）：打开对话框始终空白，
		// 上次内容由标题旁的「恢复上次内容」按钮按需取回。
		setType(currentType);

		// 状态筛选：先从 DOM 读一遍（默认勾选写在 HTML 上），保证内存与界面一致
		readStates();
		// 附带信息勾选：同样读一遍
		readAttach();

		// 来源页面：先就地捕获（?from= / referrer），再补进输入框（只填空值）
		var captured = captureFrom();
		applyFrom(captured);

		// 表单初始化完毕，之后才允许写草稿（否则 setType 那一次就把历史抹了）
		draftReady = true;
		refreshRestoreBtn();

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
