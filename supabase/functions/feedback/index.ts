/**
 * feedback —— 站点反馈广场 + 提交到 GitHub Discussions
 *
 * 一个函数干两件事（共用同一份 PAT 与同一份 ID 缓存，少一次冷启动）：
 *
 *   GET  /functions/v1/feedback            预热：解析仓库/分类 ID，返回分类可用情况
 *   GET  /functions/v1/feedback?action=list 广场：列出讨论（分页，带跟进状态）
 *   POST /functions/v1/feedback            新建：按 type 选分类，建一条 Discussion
 *
 * 分类口径（五个 type，与 GitHub 里的 Category 名逐一对应）：
 *   bug / feature / question / chat / others
 * 仓库里的分类叫什么都可以，这里按「slug 或名字」不区分大小写匹配；
 * 名字跟默认不一样时，用配置 DISCUSSIONS_CATEGORIES 显式映射：
 *   DISCUSSIONS_CATEGORIES='{"bug":"Bugs","feature":"Ideas"}'
 *
 * 配置（Supabase → Edge Functions → Secrets）：
 *   DISCUSSIONS_TOKEN        必填。GitHub PAT，需能读+写 Discussion
 *   FEEDBACK_REPO            选填，默认 Ckarefulon/Ckarefulon.github.io
 *   FEEDBACK_MAINTAINER      选填，默认 Ckarefulon。列表里据此判断「已跟进 / 已计划」，
 *                            并给这个账号打「管理员」标签
 *   DISCUSSIONS_CATEGORIES   选填，type → 仓库分类名的 JSON
 *   APP_ID / APP_PRIVATE_KEY / APP_INSTALLATION_ID
 *                            选填。配了就走 GitHub App（作者显示为 xxx[bot]），
 *                            否则退回 DISCUSSIONS_TOKEN（作者是 PAT 主人）
 *
 * ⚠️ 以上名字都**不能**以 GITHUB_ 开头 —— 那是 GitHub 保留前缀，
 *    GitHub 侧根本建不出这种名字的 Secret / Variable。
 *
 * 没配 token 时不会 500：GET 返回 { success:false, configure:true }，
 * 前端据此把「新建」让位给「在 GitHub 中打开」。
 */

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const DEFAULT_REPO = "Ckarefulon/Ckarefulon.github.io";

/**
 * 图片上传走 GitHub 自己的 user-attachments 通道（issue #11）。
 *
 * ⚠️ 这是一个**未文档化**的端点：GitHub 到今天都没有公开
 * 「给 issue / PR / discussion 上传附件」的 REST 或 GraphQL API，
 * 网页里拖图走的就是这个域名，而且用的是浏览器 session cookie。
 *
 * 实测（2026-11-22）：
 *   · 用 App installation token 或 PAT 直接打，**能成功**，返回
 *     { url: "https://github.com/user-attachments/assets/<uuid>" }
 *   · 允许的类型只有 png / jpeg / gif / webp；svg 与 pdf/txt 一律 422
 *   · 上传后、**被帖子引用之前**，这个 URL 是 404；一旦写进正文就变成 302 → S3 CDN。
 *     所以顺序必须是「先上传 → 再创建/编辑帖子」，不能反过来。
 *   · 单张上限 10 MB
 *
 * 因为它未文档化，随时可能变。所以：上传失败时**不阻断提交** ——
 * 正文照发，只是把「图片没传上去」如实告诉前端，让人还能用 GitHub 手动补图。
 */
const GITHUB_UPLOAD = "https://uploads.github.com/user-attachments/assets";
const IMAGE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 上传接口只收二进制，所以图片改用 base64 从前端传过来；4 张 × 10MB 的 base64 太大，收窄到 12M 字符 */
const MAX_IMAGE_B64 = 12 * 1024 * 1024;

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Max-Age": "7200",
};

const CACHE_TTL_MS = 10 * 60 * 1000;

/** 五个反馈类型；candidates 按优先级从前往后匹配仓库里真实存在的分类 */
const TYPES = [
	{ type: "bug", candidates: ["bug", "bugs", "问题", "错误", "故障"] },
	{ type: "feature", candidates: ["feature", "features", "feature requests", "idea", "ideas", "建议", "功能"] },
	{ type: "question", candidates: ["question", "questions", "q&a", "问答", "提问", "help"] },
	{ type: "chat", candidates: ["chat", "general", "discussion", "闲聊", "讨论", "show and tell"] },
	{ type: "others", candidates: ["others", "other", "misc", "其他"] },
];

interface Category {
	id: string;
	name: string;
	slug: string;
}

interface RepoCache {
	repo: string;
	/** GraphQL node id（`R_kg…`）——createDiscussion 要这个 */
	repoId: string;
	/**
	 * **数字** 仓库 id（`659772435`）。
	 *
	 * ⚠️ 附件上传接口 `uploads.github.com/user-attachments/assets?repository_id=`
	 * 只认这个数字 id；传 GraphQL 的 node id 会得到 404 ——
	 * 看起来像「没权限 / 仓库不存在」，其实只是 id 形式不对。
	 */
	repoDbId: string;
	categories: Category[];
	/** type → 实际使用的分类；仓库里没有对应分类时为 null */
	byType: Record<string, Category | null>;
	missing: string[];
	at: number;
}

let cache: RepoCache | null = null;

/**
 * 列表结果的短缓存（同一隔离实例内共享）。
 *
 * 为什么需要：每次 `?action=list` 都要现场去 `api.github.com/graphql` 往返一次，
 * 实测 TTFB 830–1190ms 几乎全是这一步，响应体本身只要 0–1ms。
 * 广场是「进来就看」的页面，而这几十秒内内容基本不会变 —— 缓存 30 秒能把反复进出
 * 页面的等待直接压掉，同时不至于让新提交太久看不见。
 */
const LIST_TTL_MS = 30 * 1000;
let listCache: { key: string; at: number; payload: any } | null = null;

/* ---------------- 小工具 ---------------- */

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
	const headers: Record<string, string> = {
		...CORS_HEADERS,
		"Content-Type": "application/json; charset=utf-8",
	};
	if (extraHeaders) Object.assign(headers, extraHeaders);
	return new Response(JSON.stringify(data), { status, headers });
}

function clip(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function clientIp(req: Request): string {
	const fwd = req.headers.get("x-forwarded-for") || "";
	return fwd.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

function typeDef(type: string) {
	return TYPES.find((t) => t.type === type) || TYPES[TYPES.length - 1];
}

/* ---------------- 限流 / 去重（实例内存，挡顺手刷屏足够） ---------------- */

const WINDOW_MS = 60 * 1000;
const WRITE_MAX = 5;
const READ_MAX = 90;
const writeHits = new Map<string, number[]>();
const readHits = new Map<string, number[]>();
const recent = new Map<string, number>();

function overLimit(map: Map<string, number[]>, key: string, max: number, now: number): boolean {
	const list = (map.get(key) || []).filter((t) => now - t < WINDOW_MS);
	if (list.length >= max) {
		map.set(key, list);
		return true;
	}
	list.push(now);
	map.set(key, list);
	if (map.size > 5000) {
		for (const [k, v] of map) {
			if (!v.some((t) => now - t < WINDOW_MS)) map.delete(k);
		}
	}
	return false;
}

function duplicated(fingerprint: string, now: number): boolean {
	for (const [key, at] of recent) {
		if (now - at > 10 * 60 * 1000) recent.delete(key);
	}
	if (recent.has(fingerprint)) return true;
	recent.set(fingerprint, now);
	return false;
}

/* ---------------- GitHub GraphQL ---------------- */

async function gh(
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<{ data?: Record<string, any>; errors?: Array<{ message?: string; type?: string }> }> {
	const res = await fetch(GITHUB_GRAPHQL, {
		method: "POST",
		headers: {
			"Authorization": `bearer ${token}`,
			"Content-Type": "application/json",
			"Accept": "application/json",
			"User-Agent": "ckarefulon-feedback",
		},
		body: JSON.stringify({ query, variables }),
	});
	const text = await res.text();
	if (res.status === 401) throw new Error("TOKEN_INVALID");
	let payload: any = null;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error(`GitHub 返回了非 JSON 内容（HTTP ${res.status}）`);
	}
	return payload;
}

/** type 覆盖配置：DISCUSSIONS_CATEGORIES='{"bug":"Bugs"}' */
function parseOverrides(): Record<string, string> {
	const raw = (Deno.env.get("DISCUSSIONS_CATEGORIES") || "").trim();
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: Record<string, string> = {};
		for (const key of Object.keys(parsed)) {
			const value = parsed[key];
			if (typeof value === "string" && value.trim()) out[key.trim()] = value.trim();
		}
		return out;
	} catch {
		return {};
	}
}

/* ---------------- 身份：GitHub App（bot）优先，PAT 兜底 ---------------- */

/**
 * 为什么要有 App：用 PAT 时，所有从站点提交的讨论与回复都记在 PAT 主人名下，
 * 广场里的「作者」就全是同一个人。换成 GitHub App 后作者显示为 `xxxx[bot]`，
 * 一眼能看出「这条是站点代发的」，也不会冒用维护者身份。
 *
 * 配置（配了就用 App，没配就退回 PAT）：
 *   APP_ID              App 的 numeric ID
 *   APP_PRIVATE_KEY     App 私钥（PEM，可含 \n 转义）
 *   APP_INSTALLATION_ID Installation ID（省一次查询；不填则用 App JWT 现查）
 *   DISCUSSIONS_TOKEN   PAT（仅作兜底）
 */
interface Identity {
	token: string;
	/** 用于界面提示：app = 站点代发（bot 身份），pat = 维护者本人 */
	mode: "app" | "pat";
	botName: string | null;
}

/** installation token 缓存：GitHub 给的 token 有效期 1 小时，这里提前 5 分钟续 */
let installationToken: { token: string; expiresAt: number; appId: string } | null = null;
let appIdentity: { name: string; appId: string } | null = null;

/**
 * 把 Secret 里存的私钥文本还原成标准 PEM。
 *
 * 真实世界里这串东西会长成各种样子：
 *   · GitHub Secret 里粘贴的原文（换行是真实 \n，Windows 下常是 \r\n）
 *   · 被转义成字面量 "\\n" 的一行（CI / dotenv 常见）
 *   · 有的工具会在末尾补一个换行，或被编辑器加了空格
 *   · 偶尔外层还带引号
 * 所以这里统一清洗，而不是只处理一种情况。
 */
function normalizePem(raw: string): string {
	let s = String(raw || "").trim();

	// 去掉最外层的引号（有人会把整个 PEM 用引号包起来存）
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		s = s.slice(1, -1).trim();
	}
	// 去 BOM
	s = s.replace(/^\uFEFF/, "");

	// 字面量 \n / \r\n → 真实换行（GitHub Secret 里粘贴单行版时就是这样）
	if (s.includes("\\n")) s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
	// 字面量 \r 残留
	s = s.replace(/\\r/g, "\r");

	return s;
}

/**
 * 从 PEM 里取出 Base64 主体。
 * 只保留 A-Za-z0-9+/=，其余（换行、空格、\r）全部丢掉 ——
 * 少一个字符和残留一个 \r 都会让 atob 产出错的 DER，最后报成 ASN.1 语法错误，
 * 那种错误对排查毫无帮助。
 */
function pemBody(pem: string): string {
	return normalizePem(pem)
		.replace(/-----BEGIN [^-]+-----/g, "")
		.replace(/-----END [^-]+-----/g, "")
		.replace(/[^A-Za-z0-9+/=]/g, "");
}

/** 把 PEM（PKCS#8 或 PKCS#1）转成 WebCrypto 可用的 CryptoKey */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const body = pemBody(pem);

	// 空密钥是最常见的配置失误（Secret 没填 / 名字写错 / 值为空）。
	// 提前拦下来，给出能直接照做的提示，而不是把 atob/DER 的底层错误抛给用户。
	if (!body) {
		throw new Error(
			"APP_PRIVATE_KEY 为空或无法识别。" +
			"请把 GitHub App 下载的 .pem 文件**全文**（含 -----BEGIN PRIVATE KEY----- 与 -----END PRIVATE KEY-----）" +
			"粘进 Secret，不要只填文件名或路径。",
		);
	}

	let der: Uint8Array;
	try {
		der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
	} catch {
		throw new Error("APP_PRIVATE_KEY 的 Base64 部分无法解码，请确认粘贴的是完整 .pem 全文。");
	}

	if (der.length === 0) {
		throw new Error("APP_PRIVATE_KEY 解码后为空，请重新粘贴 .pem 全文。");
	}

	// 两种私钥都是合法的，都要能签：
	//   PKCS#8  -----BEGIN PRIVATE KEY-----       （WebCrypto 直接认）
	//   PKCS#1  -----BEGIN RSA PRIVATE KEY-----   （需要在外面包一层 PKCS#8 头）
	// 以前只认 PKCS#8、把 PKCS#1 直接拒掉，是拿实现限制当规则了 ——
	// GitHub App 页面下载到的 .pem 完全可能是 PKCS#1。
	const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(pem);
	const pkcs8Der = isPkcs1 ? wrapPkcs1InPkcs8(der) : der;

	try {
		return await crypto.subtle.importKey(
			"pkcs8",
			pkcs8Der.buffer as ArrayBuffer,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["sign"],
		);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(
			`APP_PRIVATE_KEY 无法作为 RSA 私钥导入（${detail}）。` +
			"常见原因：粘贴时缺了行、混入了多余字符，或用的不是 GitHub App 的私钥。",
		);
	}
}

/**
 * 把 PKCS#1 的 RSAPrivateKey DER 包成 PKCS#8 的 PrivateKeyInfo。
 *
 * PKCS#8 只是在 PKCS#1 外面套了固定的算法标识：
 *
 *   SEQUENCE {
 *     INTEGER 0                                     -- version
 *     SEQUENCE { OID rsaEncryption, NULL }          -- algorithmIdentifier
 *     OCTET STRING { <PKCS#1 的 DER 原样塞进来> }
 *   }
 *
 * 所以不需要引第三方 ASN.1 库，按长度自己拼就行。
 * 唯一要小心的是长度编码：DER 的长形式（0x81/0x82…）。
 */
function wrapPkcs1InPkcs8(pkcs1: Uint8Array): Uint8Array {
	// 算法标识固定 15 字节：OID 1.2.840.113549.1.1.1 + NULL
	const ALG_ID = new Uint8Array([
		0x30, 0x0d,                               // SEQUENCE, 13 字节
		0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,  // rsaEncryption
		0x05, 0x00,                               // NULL
	]);
	const VERSION = new Uint8Array([0x02, 0x01, 0x00]);   // INTEGER 0

	// OCTET STRING 包住 PKCS#1
	const inner = derWrap(0x04, pkcs1);

	// 拼 body = version + algId + octetString，再整体包一层 SEQUENCE
	const bodyParts = [VERSION, ALG_ID, inner];
	const bodyLen = bodyParts.reduce((n, p) => n + p.length, 0);
	const outer = derLength(0x30, bodyLen);

	const out = new Uint8Array(outer.length + bodyLen);
	let o = 0;
	out.set(outer, o); o += outer.length;
	for (const p of bodyParts) { out.set(p, o); o += p.length; }
	return out;
}

/** DER 长度编码（短形式 / 0x81 / 0x82） */
function derLength(tag: number, len: number): Uint8Array {
	if (len < 0x80) return new Uint8Array([tag, len]);
	if (len <= 0xff) return new Uint8Array([tag, 0x81, len]);
	if (len <= 0xffff) return new Uint8Array([tag, 0x82, (len >> 8) & 0xff, len & 0xff]);
	// RSA 私钥不可能这么长；真到了说明数据异常
	throw new Error("私钥长度异常（DER 长度超过 0xFFFF）");
}

/** 用指定 tag 包一段 DER（长度自动编码） */
function derWrap(tag: number, content: Uint8Array): Uint8Array {
	const head = derLength(tag, content.length);
	const out = new Uint8Array(head.length + content.length);
	out.set(head, 0);
	out.set(content, head.length);
	return out;
}

/** 极简 base64url 编码（Deno 自带 btoa，字符串都是 ASCII） */
function b64url(input: string): string {
	return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlBytes(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return b64url(binary);
}

/** App JWT：GitHub 要求 RS256、iat 提前 60s、exp ≤ 10 分钟 */
async function appJwt(appId: string, privateKeyPem: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
	const data = `${header}.${payload}`;

	const key = await importPrivateKey(privateKeyPem);
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(data),
	);
	return `${data}.${b64urlBytes(new Uint8Array(signature))}`;
}

/** 用 App JWT 调 GitHub API（非 GraphQL） */
async function appApi(jwt: string, path: string, init?: RequestInit): Promise<any> {
	const res = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			"Authorization": `Bearer ${jwt}`,
			"Accept": "application/vnd.github+json",
			"User-Agent": "ckarefulon-feedback",
			...(init && init.headers ? init.headers as Record<string, string> : {}),
		},
	});
	const text = await res.text();
	let payload: any = null;
	try { payload = JSON.parse(text); } catch { payload = null; }
	if (!res.ok) {
		throw new Error(`GitHub App 接口失败（HTTP ${res.status}）${payload && payload.message ? "：" + payload.message : ""}`);
	}
	return payload;
}

/* ---------------- 站内身份：把提交者记在自己库里，绝不写进 GitHub ---------------- */

/**
 * 设计要点：
 *   GitHub 那边是 bot 匿名（谁都能看），站内这边要能查到「谁提的」。
 *   所以提交者身份只写进 `feedback_submissions` 表，正文里一个字都不带。
 *
 * 为什么不用 supabase-js：函数刻意零外部依赖（冷启动最短），
 * 这里直接打 Supabase 的 REST 接口，够用且不多下载一个 SDK。
 */

interface Submitter {
	userId: string;
	username: string | null;
	/** 头像 URL（Storage 公开桶）；拿不到为 null，前端退回剪影图标 */
	avatarUrl: string | null;
	/** 邮箱：只用于 FEEDBACK_ADMINS 名单比对，**不下发**给前端 */
	email?: string;
}

function supabaseBase(): string {
	return (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
}

function serviceKey(): string {
	// 新版 Supabase 是 SUPABASE_SECRET_KEYS（JSON），老版是 SUPABASE_SERVICE_ROLE_KEY
	const raw = (Deno.env.get("SUPABASE_SECRET_KEYS") || "").trim();
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const preferred = parsed.default;
				if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
				for (const value of Object.values(parsed)) {
					if (typeof value === "string" && value.trim()) return value.trim();
				}
			}
		} catch {
			if (raw) return raw;
		}
	}
	return (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
}

/* ---- 名字回退链（issue #45 的核心） ---- */

/**
 * 从一堆候选里挑一个能显示的名字。
 *
 * ⚠️ 为什么要「回退」：以前只读 `user_profiles.username`，而那张表
 * **只有用户自己跑到 /user/profile/ 手动点保存**才会有值。绝大多数账号从没设过，
 * 于是登录态、user_id 全都记下了，唯独 username 是 null ——
 * 读取时 `lookupAuthorProfile()` 见名字为空就直接返回 null ⇒ 页面显示「匿名」。
 * 用户看到的就是「我明明登录了，发出来还是匿名」，也就是 issue #45。
 *
 * 现在的顺序：资料表用户名 → 注册时填的 metadata 名字 → 邮箱 @ 前面那段。
 * 邮箱是 Auth 的必有字段，所以**任何真实账号都能得到一个可读名字**，
 * 不再是「没手动设过用户名就永远匿名」。
 */
function pickName(...candidates: Array<unknown>): string | null {
	for (const raw of candidates) {
		if (typeof raw !== "string") continue;
		const name = raw.trim().replace(/^@+/, "").trim();
		if (!name) continue;
		return name.slice(0, 32);
	}
	return null;
}

/** 邮箱 → 可读名字（@ 前面那段）。连着两个账号同名前缀也无所谓，只用于显示 */
function nameFromEmail(email: unknown): string | null {
	if (typeof email !== "string") return null;
	const raw = email.trim();
	const at = raw.indexOf("@");
	if (at <= 0) return null;
	return pickName(raw.slice(0, at));
}

/** 把 user_profiles 的一行变成「名字 + 头像 URL」；与前端 profileManager 同一口径 */
function profileFromRow(row: any, base: string): {
	username: string | null;
	avatarPath: string | null;
	avatarUrl: string | null;
} {
	const username = pickName(row && row.username);
	const avatarPath = row && typeof row.avatar_path === "string" && row.avatar_path
		? row.avatar_path
		: null;
	let avatarUrl: string | null = null;
	if (avatarPath) {
		avatarUrl = `${base}/storage/v1/object/public/avatars/${avatarPath}`;
		const ver = row && row.updated_at ? encodeURIComponent(String(row.updated_at)) : "";
		if (ver) avatarUrl += `?v=${ver}`;
	}
	return { username, avatarPath, avatarUrl };
}

/** 取某个 user_id 的资料行（service key）；没有行 / 出错都返回 null */
async function profileRowFor(userId: string): Promise<any | null> {
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key || !userId) return null;
	try {
		const q = `${base}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}`
			+ `&select=user_id,username,avatar_path,updated_at&limit=1`;
		const res = await fetch(q, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
		if (!res.ok) return null;
		const rows = await res.json();
		return Array.isArray(rows) && rows[0] ? rows[0] : null;
	} catch {
		return null;
	}
}

/** 用 Auth 管理接口拿邮箱，再从邮箱取名字（资料表没名字时的最后一步） */
async function nameFromAuth(userId: string): Promise<string | null> {
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key || !userId) return null;
	try {
		const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
			headers: { "apikey": key, "Authorization": `Bearer ${key}` },
		});
		if (!res.ok) return null;
		const user = await res.json();
		return nameFromEmail(user && user.email);
	} catch {
		return null;
	}
}

/**
 * 某个 user_id 现在该显示成什么名字。
 * 读取历史记录时用：老行可能只记了 user_id、username 是空的。
 */
async function displayNameFor(userId: string | null): Promise<string | null> {
	if (!userId) return null;
	const row = await profileRowFor(userId);
	const fromProfile = pickName(row && row.username);
	if (fromProfile) return fromProfile;
	return await nameFromAuth(userId);
}

/**
 * 从 Authorization 里取用户。
 * 未登录时前端会把 publishable key 当 Bearer 传过来，那是拿不到用户的 —— 视为游客，
 * 不报错（游客也该能提反馈）。
 *
 * 判断「这是不是用户 JWT」不要靠格式猜：
 *   · 早先按 `split(".").length === 3` 判断，一旦 key 格式变化就会误判；
 *   · Supabase 的 publishable key 以 `sb_publishable_` / `sb_secret_` 开头，
 *     直接按前缀识别更稳，也不会把将来的新格式（如三段式 key）当成 JWT。
 * 剩下的情况交给服务端校验：不是合法 JWT 时 /auth/v1/user 会返回非 2xx，
 * 我们按游客处理即可。
 */
async function resolveSubmitter(req: Request): Promise<Submitter | null> {
	const auth = req.headers.get("Authorization") || "";
	if (!auth.startsWith("Bearer ")) return null;
	const token = auth.slice(7).trim();
	if (!token) return null;

	// Supabase 的 API key 不是用户身份，直接按游客处理，省一次网络往返
	if (/^sb_(publishable|secret)_/i.test(token)) return null;
	// 明显不是 JWT 形状的（没有点分段），也当游客
	if (token.split(".").length !== 3) return null;

	const base = supabaseBase();
	const key = serviceKey();
	if (!base) return null;

	try {
		const res = await fetch(`${base}/auth/v1/user`, {
			headers: {
				"Authorization": `Bearer ${token}`,
				"apikey": key || token,
			},
		});
		if (!res.ok) return null;
		const user = await res.json();
		if (!user || !user.id) return null;

		const userId = String(user.id);
		const meta = user.user_metadata || {};

		// 名字优先级：资料表（用户自己设的，最权威）→ 注册时带的 metadata → 邮箱前缀
		const row = await profileRowFor(userId);
		const prof = profileFromRow(row, base);
		const username = prof.username
			|| pickName(meta.username, meta.display_name, meta.name, meta.full_name, meta.nickname)
			|| nameFromEmail(user.email);

		return { userId, username, avatarUrl: prof.avatarUrl, email: user.email || "" };
	} catch {
		return null;
	}
}

/** 记录 discussion_number ↔ 提交者；失败只记日志，不能让提交本身失败 */
async function recordSubmission(input: {
	number: number;
	submitter: Submitter | null;
	kind: string;
	title: string;
	page: string;
	/** 登录用户勾了「匿名提交」：记 user_id（判楼主），不记名字 */
	anonymous?: boolean;
}): Promise<boolean> {
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key) {
		console.warn("[feedback] 站内留痕跳过：缺少 SUPABASE_URL / service key");
		return false;
	}
	try {
		// on_conflict 必须写：不写的话 PostgREST 按主键（id）判冲突，
		// 撞上 discussion_number 的唯一约束就会 409，而这里又是「失败只记日志」，
		// 表现就是「提交成功但站内没记住是谁」。
		const res = await fetch(`${base}/rest/v1/feedback_submissions?on_conflict=discussion_number`, {
			method: "POST",
			headers: {
				"apikey": key,
				"Authorization": `Bearer ${key}`,
				"Content-Type": "application/json",
				"Prefer": "resolution=merge-duplicates,return=minimal",
			},
			body: JSON.stringify({
				discussion_number: input.number,
				user_id: input.submitter ? input.submitter.userId : null,
				// 勾了匿名：只留 user_id（判楼主用），名字一个字都不落
				username: input.submitter && input.anonymous !== true ? input.submitter.username : null,
				anonymous: input.submitter ? input.anonymous === true : false,
				kind: input.kind,
				title: input.title.slice(0, 300),
				page: input.page.slice(0, 300),
			}),
		});
		if (!res.ok) {
			// 留痕失败不能挡住提交，但一定要能在日志里查出来是哪一步坏了
			const detail = await res.text().catch(() => "");
			console.warn(`[feedback] 站内留痕失败 HTTP ${res.status}: ${detail.slice(0, 300)}`);
		}
		return res.ok;
	} catch (err) {
		console.warn("[feedback] 站内留痕异常:", (err as Error)?.message || err);
		return false;
	}
}

/** 批量查某几条讨论分别是谁提的（只有站内可见，因此只给已登录的调用方） */
async function lookupSubmissions(numbers: number[]): Promise<Record<string, { username: string | null }>> {
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key || !numbers.length) return {};
	const list = numbers.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
	if (!list.length) return {};
	try {
		const query = `${base}/rest/v1/feedback_submissions?discussion_number=in.(${list.join(",")})&select=discussion_number,username`;
		const res = await fetch(query, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
		if (!res.ok) return {};
		const rows = await res.json();
		const out: Record<string, { username: string | null }> = {};
		if (Array.isArray(rows)) {
			for (const row of rows) {
				if (!row || row.discussion_number == null) continue;
				out[String(row.discussion_number)] = {
					username: typeof row.username === "string" ? row.username : null,
				};
			}
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * 站内作者「该怎么显示」的三种状态（用户此刻的口径）：
 *
 *   · 游客（没有任何站内身份）      → 前端写「游客」，**整帖不出现楼主**
 *   · 登录用户勾了「匿名」          → 前端写「匿名」，但**照常标楼主**
 *   · 登录用户实名                  → 显示名字 + 头像，标楼主
 *
 * 后两种在库里都只有 `user_id`（匿名那行的 username 是 null 且 anonymous=true），
 * 所以「是不是楼主」只能由服务端比 `user_id`，前端拿到的只是 `op: true`。
 */
interface AuthorBadge {
	username?: string;
	avatarUrl?: string | null;
	/** 登录用户自己勾了匿名：不显示名字与头像 */
	anonymous?: boolean;
	/** 这个站内账号是否管理员（在 FEEDBACK_ADMINS 名单里）→ 前端据此打「管理员」标签 */
	admin?: boolean;
}

/**
 * 某个站内用户名/邮箱算不算管理员。
 * 与 isListedAdmin 同一口径，只是这里只有一个名字、没有 JWT。
 */
function isAdminName(name?: string | null, mail?: string | null): boolean {
	const list = adminAllowlist();
	if (!list.length) return false;
	const n = String(name || "").toLowerCase();
	const m = String(mail || "").toLowerCase();
	// 维护者本人有「站内昵称」和「GitHub 登录名」两种写法（Careful S. / Ckarefulon），
	// 名单里写任一种都该认出他来 —— 否则用 PAT 发出来的回复作者是 Ckarefulon，
	// 就判不出管理员，标签会丢。
	const aliases = [n];
	if (n) {
		const norm = n.replace(/[\s.]+/g, "");
		const maintNorm = maintainerLogin().toLowerCase().replace(/[\s.]+/g, "");
		if (norm === "carefuls" || n === maintainerLogin().toLowerCase()) {
			aliases.push(maintainerLogin().toLowerCase(), "careful s.");
		}
	}
	return aliases.some((a) => !!a && list.includes(a)) || (!!m && list.includes(m));
}

/**
 * 取「这条讨论是哪个站内用户提的」。
 *
 * 为什么要在服务端做：头像存在 Supabase Storage 的 `avatars` 桶里，
 * 路径是 `user_profiles.avatar_path`，公开 URL 要用项目 Storage 地址拼出来。
 * 前端自己拼也可以，但它拿不到 user_id（GitHub 那边是 bot 匿名），
 * 所以这里用 service key 反查一次。
 *
 * 拿不到（游客提交）时返回 null，前端就显示「游客」。
 * 勾了匿名的行返回 `{ anonymous: true }`：不透露名字，但 user_id 仍留着判楼主。
 *
 * ⚠️ 两类「老记录」要能救回来（issue #45）：
 *   · 当年只记了 user_id、username 是空的行 —— 用 user_id 现在去解析名字；
 *   · 提交者从没在 /user/profile/ 设过用户名的行 —— 回退到邮箱前缀。
 * 只要行里还留着 user_id，就该认出是谁（匿名勾过的除外）。
 */
async function lookupSubmissionAuthor(discussionNumber: number): Promise<{
	badge: AuthorBadge | null;
	userId: string | null;
}> {
	const none = { badge: null as AuthorBadge | null, userId: null as string | null };
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key) return none;
	try {
		const q = `${base}/rest/v1/feedback_submissions?discussion_number=eq.${discussionNumber}`
			+ `&select=user_id,username,anonymous&limit=1`;
		const res = await fetch(q, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
		if (!res.ok) return none;
		const rows = await res.json();
		const row = Array.isArray(rows) ? rows[0] : null;
		if (!row) return none;

		const userId = row.user_id ? String(row.user_id) : "";
		// 勾了匿名：认得出「是不是同一个人」就够了，名字一个字都不给
		if (row.anonymous === true) {
			return { badge: { anonymous: true }, userId: userId || null };
		}

		// 名字：快照优先（历史真实），没了就用 user_id 现在解析出来的
		const username = pickName(row.username) || (userId ? await displayNameFor(userId) : null);
		if (!username) return { badge: null, userId: userId || null };

		// 头像路径在资料表里（feedback_submissions 没存它）
		const prof = userId ? profileFromRow(await profileRowFor(userId), base) : null;
		return {
			badge: {
				username,
				avatarUrl: prof ? prof.avatarUrl : null,
				admin: isAdminName(username, null),
			},
			userId: userId || null,
		};
	} catch {
		return none;
	}
}

/**
 * 记下「这条回复是哪个站内用户写的」。
 *
 * 为什么需要：GitHub 上的回复一律由站点 App 代发，作者都是 bot，
 * 光看 GitHub 数据分不出谁写的，也就判不出「楼主」是谁。
 * 失败只记日志，不让回复本身失败 —— 归属信息是锦上添花，不能挡住发言。
 */
async function recordCommentAuthor(input: {
	commentId: string;
	number: number;
	submitter: Submitter;
	/** 勾了「匿名回复」：只记「是同一个人」，不记名字（仍然要能认出楼主） */
	anonymous?: boolean;
}): Promise<boolean> {
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key) return false;
	if (!input.commentId) return false;
	try {
		const anonymous = input.anonymous === true;
		const res = await fetch(`${base}/rest/v1/feedback_comment_authors`, {
			method: "POST",
			headers: {
				"apikey": key,
				"Authorization": `Bearer ${key}`,
				"Content-Type": "application/json",
				"Prefer": "resolution=merge-duplicates,return=minimal",
			},
			body: JSON.stringify({
				comment_id: input.commentId,
				discussion_number: input.number,
				user_id: input.submitter.userId,
				// 匿名回复：不落名字快照，只留 user_id 用来判「是不是楼主」
				username: anonymous ? null : input.submitter.username,
				anonymous,
			}),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * 批量取一批回复的站内作者。
 *
 * 只查登录用户写过的那些；游客回复不在表里，返回的 map 里就没有它们，
 * 前端据此显示「游客」。
 *
 * 返回值里带 `userId` **只给服务端自己用**（判「是不是楼主」），
 * 拼响应前必须剥掉，绝不能下发给浏览器。
 */
async function lookupCommentAuthors(
	commentIds: string[],
): Promise<Record<string, { badge: AuthorBadge; userId: string | null }>> {
	const base = supabaseBase();
	const key = serviceKey();
	const ids = commentIds.filter((id) => typeof id === "string" && id).slice(0, 200);
	if (!base || !key || !ids.length) return {};
	try {
		const list = ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",");
		const q = `${base}/rest/v1/feedback_comment_authors?comment_id=in.(${list})`
			+ `&select=comment_id,user_id,username,anonymous`;
		const res = await fetch(q, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
		if (!res.ok) return {};
		const rows = await res.json();
		if (!Array.isArray(rows) || !rows.length) return {};

		// 一次把这些用户的名字与头像查出来（避免 N 次往返）
		const userIds = [...new Set(rows.map((r: any) => r && r.user_id).filter(Boolean))];
		const avatars: Record<string, string> = {};
		const names: Record<string, string> = {};
		if (userIds.length) {
			try {
				const inList = userIds.map((u) => `"${String(u).replace(/"/g, "")}"`).join(",");
				const pq = `${base}/rest/v1/user_profiles?user_id=in.(${inList})`
					+ `&select=user_id,username,avatar_path,updated_at`;
				const pr = await fetch(pq, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
				if (pr.ok) {
					const prows = await pr.json();
					for (const p of Array.isArray(prows) ? prows : []) {
						if (!p) continue;
						const prof = profileFromRow(p, base);
						if (prof.avatarUrl) avatars[String(p.user_id)] = prof.avatarUrl;
						if (prof.username) names[String(p.user_id)] = prof.username;
					}
				}
			} catch { /* 头像拿不到不影响显示名字 */ }
		}

		// 名字兜底：老记录（含 issue #45 之前提交的）只有 user_id、没有用户名快照。
		// 逐个补一次，但设上限 —— 一条帖子的回复里不该为了显示名字打十几次 Auth 接口。
		let budget = 5;
		for (const uid of userIds) {
			const id = String(uid);
			if (names[id]) continue;
			if (budget <= 0) break;
			budget -= 1;
			const fallback = await nameFromAuth(id);
			if (fallback) names[id] = fallback;
		}

		const out: Record<string, { badge: AuthorBadge; userId: string | null }> = {};
		for (const r of rows) {
			if (!r || typeof r.comment_id !== "string") continue;
			const uid = r.user_id ? String(r.user_id) : "";
		 // 勾了匿名：同样只回「有这么个人」，名字与头像一律不给
			if (r.anonymous === true) {
				out[r.comment_id] = { badge: { anonymous: true }, userId: uid || null };
				continue;
			}
			const username = pickName(r.username) || (uid ? names[uid] : null);
			if (!username) continue;
			out[r.comment_id] = {
				badge: { username, avatarUrl: avatars[uid] || null, admin: isAdminName(username, null) },
				userId: uid || null,
			};
		}
		return out;
	} catch {
		return {};
	}
}

/** 解析当前该用哪个身份；配了 App 就先换 installation token */
async function resolveIdentity(repo: string): Promise<Identity | null> {
	const appId = (Deno.env.get("APP_ID") || "").trim();
	const rawKey = Deno.env.get("APP_PRIVATE_KEY") || "";
	const privateKey = normalizePem(rawKey);
	const pat = (Deno.env.get("DISCUSSIONS_TOKEN") || "").trim();

	// 「配了 APP_ID 但私钥为空/全是空白」最容易踩：不能当成「没配 App」而静默退回 PAT
	// （那会把内容挂到维护者名下），也不能只说「配置不完整」（会让人以为自己是漏填，
	// 其实是填了但内容无效）。
	if (appId && !privateKey) {
		throw new Error(
			rawKey.trim()
				? "APP_PRIVATE_KEY 去空白后为空，请确认粘贴的是 .pem 全文而不是文件路径或文件名。"
				: "APP_ID 已配置，但 APP_PRIVATE_KEY 为空。请粘贴 GitHub App 下载的 .pem 全文。",
		);
	}
	if (!appId && privateKey) {
		throw new Error("APP_PRIVATE_KEY 已配置，但缺少 APP_ID。两者需同时提供。");
	}

	if (!appId) {
		return pat ? { token: pat, mode: "pat", botName: null } : null;
	}

	// 配了 App 就必须用 App：下面任何失败都往上抛，绝不回退到 PAT。
	const now = Date.now();
	if (installationToken && installationToken.appId === appId && installationToken.expiresAt - 5 * 60 * 1000 > now) {
		return { token: installationToken.token, mode: "app", botName: appIdentity ? appIdentity.name : null };
	}

	const jwt = await appJwt(appId, privateKey);

	// installation id：配置优先，否则按仓库现查
	let installationId = (Deno.env.get("APP_INSTALLATION_ID") || "").trim();
	if (!installationId) {
		const found = await appApi(jwt, `/repos/${repo}/installation`);
		installationId = found && found.id ? String(found.id) : "";
		if (!installationId) throw new Error("这个仓库没有安装该 GitHub App");
	}

	const created = await appApi(jwt, `/app/installations/${installationId}/access_tokens`, { method: "POST" });
	if (!created || typeof created.token !== "string" || !created.token) {
		throw new Error("无法获取 App installation token");
	}

	// ⚠️ 不要对 token 做任何长度/前缀假设。
	//    GitHub 已宣布 installation token 将改用新的无状态格式（ghs_…），
	//    长度可能涨到约 520 字符。历史上也有过格式调整。
	//    这里只把它当成不透明字符串：能拿到、能塞进 Authorization 头就够了。
	//    （日志里只记长度，方便真出问题时确认收到了完整值，绝不记录内容。）
	const tokenValue = created.token;
	console.log(`[feedback] installation token ok (${tokenValue.length} chars)`);

	// token 有效期 1 小时；GitHub 返回 ISO 时间，解析失败就按 50 分钟算
	let expiresAt = now + 50 * 60 * 1000;
	if (created.expires_at) {
		const parsed = Date.parse(created.expires_at);
		if (!Number.isNaN(parsed)) expiresAt = parsed;
	}

	// bot 显示名：App 名 + [bot]，同时记一次（失败不影响主流程）
	if (!appIdentity || appIdentity.appId !== appId) {
		let name: string | null = null;
		try {
			const me = await appApi(jwt, "/app");
			if (me && me.slug) name = `${me.slug}[bot]`;
			else if (me && me.name) name = `${me.name}[bot]`;
		} catch { /* 取不到就留 null，前端退化成「站点代发」 */ }
		appIdentity = { name: name || "", appId };
	}

	installationToken = { token: tokenValue, expiresAt, appId };
	return { token: tokenValue, mode: "app", botName: appIdentity.name || null };
}

function matchCategory(categories: Category[], wanted: string): Category | null {
	const needle = wanted.trim().toLowerCase();
	if (!needle) return null;
	return categories.find((c) => c.name.toLowerCase() === needle || c.slug.toLowerCase() === needle) || null;
}

async function resolveRepo(token: string, repo: string): Promise<RepoCache> {
	if (cache && cache.repo === repo && Date.now() - cache.at < CACHE_TTL_MS) return cache;

	const slash = repo.indexOf("/");
	if (slash <= 0) throw new Error("REPO_INVALID");
	const owner = repo.slice(0, slash);
	const name = repo.slice(slash + 1);

	const result = await gh(
		token,
		`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id databaseId hasDiscussionsEnabled discussionCategories(first:50){nodes{id name slug}}}}`,
		{ owner, name },
	);

	const node = result.data?.repository;
	if (!node) {
		throw new Error((result.errors && result.errors[0] && result.errors[0].message) || "找不到仓库");
	}
	if (node.hasDiscussionsEnabled === false) throw new Error("DISCUSSIONS_DISABLED");

	const categories: Category[] = (node.discussionCategories?.nodes || []).map((c: any) => ({
		id: String(c.id),
		name: String(c.name),
		slug: String(c.slug),
	}));
	if (!categories.length) throw new Error("CATEGORY_MISSING");

	const overrides = parseOverrides();
	const byType: Record<string, Category | null> = {};
	const missing: string[] = [];

	for (const def of TYPES) {
		let picked: Category | null = null;
		// ① 显式映射优先
		if (overrides[def.type]) picked = matchCategory(categories, overrides[def.type]);
		// ② 按候选名/slug 逐个试
		if (!picked) {
			for (const candidate of def.candidates) {
				picked = matchCategory(categories, candidate);
				if (picked) break;
			}
		}
		byType[def.type] = picked;
		if (!picked) missing.push(def.type);
	}

	const built: RepoCache = {
		repo,
		repoId: String(node.id),
		repoDbId: node.databaseId != null ? String(node.databaseId) : "",
		categories,
		byType,
		missing,
		at: Date.now(),
	};
	cache = built;
	return built;
}

/** 给前端的类型清单：每个 type 对应到仓库里哪个分类 */
function describeTypes(rc: RepoCache) {
	return TYPES.map((def) => {
		const cat = rc.byType[def.type];
		return {
			type: def.type,
			category: cat ? cat.name : null,
			categorySlug: cat ? cat.slug : null,
			// 仓库里没有这个分类时，提交会落到 fallback（第一个可用分类）
			fallback: cat ? null : (rc.categories[0] ? rc.categories[0].name : null),
		};
	});
}

/* ---------------- 正文拼装 / 摘要 ---------------- */

/**
 * 拼 GitHub 正文。
 *
 * 顺序有讲究（issue #18）：**来源页面放最上面** ——
 * 一条反馈「在哪一页出的问题」比什么都重要，现在它只是详情页里一个字段，
 * 读到讨论的人看不见。所以正文第一段就是它。
 *
 * 环境信息仍然是 <details> 折叠块，并且由前端按用户勾选决定要不要发过来；
 * 联系方式只在这个人自己填了的时候才有。
 */
function buildBody(input: {
	body: string;
	contact: string;
	meta: string;
	page?: string;
	images?: UploadedImage[];
}): string {
	const parts: string[] = [];
	if (input.page) parts.push(`**来源页面**：${input.page}`);
	parts.push(input.body);
	// 图片贴在正文后面、附加信息前面。
	// ⚠️ 位置很关键：前端的 stripMeta 是在「> 由站点反馈广场提交」那一行截断的，
	// 图如果排在签名之后就会被当成附加信息整段剥掉，详情页里一张也看不见。
	const imgs = imageMarkdown(input.images || []);
	if (imgs) parts.push(imgs.trim());
	if (input.contact) parts.push(`**联系方式**：${input.contact}`);
	if (input.meta) {
		parts.push(`<details><summary>环境信息</summary>\n\n\`\`\`\n${input.meta}\n\`\`\`\n\n</details>`);
	}
	parts.push(`> 由站点反馈广场提交 · ${new Date().toISOString()}`);
	return parts.join("\n\n");
}

/**
 * 讨论标题。
 *
 * GitHub Discussions **必须有标题**（GraphQL 的 createDiscussion 不接受空 title，
 * 少于 4 个字符也会被拒），所以标题不能靠「可选」：
 *   · 用户填了 → 用用户的，补上「[类型] 」前缀（自己已经写了 [xxx] 的不重复加）
 *   · 没填     → 退回「[类型] 内容首行」（超 60 字截断）
 *
 * 前端 feedback-app.js 的 buildTitle 与这里逐字同口径，列表里立刻插入的那条不会跳字。
 */
function buildTitle(type: string, rawTitle: unknown, body: string): string {
	const def = typeDef(type);
	const labels: Record<string, string> = {
		bug: "Bug",
		feature: "Feature",
		question: "Question",
		chat: "Chat",
		others: "Other",
	};
	const prefix = `[${labels[def.type] || "Feedback"}]`;
	const typed = clip(rawTitle, 120);
	if (typed) return typed.startsWith("[") ? typed : `${prefix} ${typed}`;

	const firstLine = body.split("\n").map((s) => s.trim()).find((s) => s.length > 0) || "站点反馈";
	const head = firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
	return `${prefix} ${head}`;
}

/**
 * 标题与正文互补（issue #31）。
 *
 * 两个都填了 → 各用各的。
 * 只填了正文   → 标题留空，交给 buildTitle 取正文首行（老行为）。
 * 只填了标题   → 正文就用标题内容顶上，而不是拿「正文太短」把这次反馈打回去。
 *
 * 返回 null 表示两者都空，调用方按 400 处理。
 */
function completeTitleBody(
	rawTitle: unknown,
	rawBody: unknown,
): { title: string; body: string } | null {
	const title = clip(rawTitle, 120);
	const body = clip(rawBody, 8000);
	if (!title && !body) return null;
	if (body) return { title, body };
	// 只有标题：正文顶上去
	return { title, body: title };
}

/** 兼容旧入口：只给类型与正文时的标题 */
function defaultTitle(type: string, body: string): string {
	return buildTitle(type, "", body);
}

/** 列表摘要：去掉我们附加的环境信息块，压掉多余空白 */
function excerpt(bodyText: unknown, max = 180): string {
	let text = typeof bodyText === "string" ? bodyText : "";
	// 按我们固定附加的段落切：<details> 整块 → 签名行 → 联系方式行 → 来源页面行
	const detailsAt = text.indexOf("<details>");
	if (detailsAt > 0) text = text.slice(0, detailsAt);
	const quote = text.lastIndexOf("> 由站点反馈广场提交");
	if (quote > 0) text = text.slice(0, quote);
	const contact = text.indexOf("**联系方式**");
	if (contact > 0) text = text.slice(0, contact);
	// 来源页面是我们加在正文最上面的一行（issue #18），摘要里不重复它
	text = text.replace(/^\s*\*\*来源页面\*\*[：:].*(\r?\n)+/, "");
	text = text.replace(/```[\s\S]*?```/g, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? text.slice(0, max) + "…" : text;
}

/* ---------------- 详情 + 回复 ---------------- */

const DETAIL_QUERY = `query($owner:String!,$name:String!,$number:Int!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    discussion(number:$number){
      id number title url body bodyText createdAt updatedAt upvoteCount
      closed stateReason
      category{name slug}
      author{login avatarUrl}
      reactions(first:100){ nodes{ content user{login} } }
      comments(first:$first, after:$after){
        totalCount
        pageInfo{hasNextPage endCursor}
        nodes{
          id body bodyText createdAt upvoteCount isAnswer
          author{login avatarUrl}
          reactions(first:100){ nodes{ content user{login} } }
          replies(first:20){
            nodes{
              id bodyText createdAt isAnswer
              author{login avatarUrl}
              reactions(first:100){ nodes{ content user{login} } }
            }
          }
        }
      }
    }
  }
}`;

/**
 * 把 GraphQL 的 reactions 节点压成「每种表情几个人」。
 *
 * 为什么读全文而不是只读汇总：GraphQL 的 reactionGroups 需要 viewer 身份才有意义
 * （viewerHasReacted 是按「谁在查」算的），而函数用的是 bot/PAT 身份，
 * 那个字段反映的不是页面上这个访客。所以这里只统计**总数**，
 * 「我自己点没点」由前端在前端侧自己记（点过就打亮，刷新后复位）。
 */
function tallyReactions(react: any): Record<string, number> {
	const out: Record<string, number> = {};
	const nodes = react && Array.isArray(react.nodes) ? react.nodes : [];
	for (const n of nodes) {
		if (!n || typeof n.content !== "string") continue;
		out[n.content] = (out[n.content] || 0) + 1;
	}
	return out;
}


interface CommentNode {
	id: string;
	body: string;
	createdAt: string;
	author: { login: string; avatarUrl: string } | null;
	isAnswer: boolean;
	upvotes: number;
	/** 每种表情有几个人点过：{ THUMBS_UP: 2, HEART: 1 } */
	reactions: Record<string, number>;
	replies: Array<{
		id: string;
		body: string;
		createdAt: string;
		author: { login: string; avatarUrl: string } | null;
		isAnswer: boolean;
		reactions: Record<string, number>;
	}>;
}

function shapeComment(c: any): CommentNode {
	return {
		id: String(c.id || ""),
		body: typeof c.body === "string" ? c.body : (typeof c.bodyText === "string" ? c.bodyText : ""),
		createdAt: c.createdAt || "",
		author: c.author
			? { login: String(c.author.login || ""), avatarUrl: String(c.author.avatarUrl || "") }
			: null,
		isAnswer: !!c.isAnswer,
		upvotes: typeof c.upvoteCount === "number" ? c.upvoteCount : 0,
		reactions: tallyReactions(c.reactions),
		replies: (c.replies?.nodes || []).filter((r: any) => r).map((r: any) => ({
			id: String(r.id || ""),
			body: typeof r.bodyText === "string" ? r.bodyText : "",
			createdAt: r.createdAt || "",
			author: r.author
				? { login: String(r.author.login || ""), avatarUrl: String(r.author.avatarUrl || "") }
				: null,
			isAnswer: !!r.isAnswer,
			reactions: tallyReactions(r.reactions),
		})),
	};
}

async function fetchDiscussion(
	token: string,
	repo: string,
	number: number,
	first: number,
	after: string | null,
) {
	const slash = repo.indexOf("/");
	const result = await gh(token, DETAIL_QUERY, {
		owner: repo.slice(0, slash),
		name: repo.slice(slash + 1),
		number,
		first,
		after: after || null,
	});

	const node = result.data?.repository?.discussion;
	if (!node) {
		const first = result.errors && result.errors[0];
		if (first && /not found/i.test(String(first.message || ""))) throw new Error("NOT_FOUND");
		throw new Error((first && first.message) || "读取讨论失败");
	}

	const comments = node.comments || {};
	return {
		discussion: {
			id: String(node.id || ""),
			number: node.number,
			title: node.title || "",
			url: node.url,
			body: typeof node.body === "string" ? node.body : "",
			bodyText: typeof node.bodyText === "string" ? node.bodyText : "",
			createdAt: node.createdAt || "",
			updatedAt: node.updatedAt || "",
			upvotes: typeof node.upvoteCount === "number" ? node.upvoteCount : 0,
			// 真实的表情统计（issue #33 二轮）：前端据此只显示「真的有人点过」的那几个
			reactions: tallyReactions(node.reactions),
			closed: !!node.closed,
			// 详情页也显示状态标签，与列表同一套判定
			state: followState(
				!!node.closed,
				node.stateReason,
				(comments.nodes || []).filter((c: any) => c).map((c: any) => ({
					author: c.author, body: c.body,
				})),
				maintainerLogin(),
			),
			category: node.category ? { name: node.category.name, slug: node.category.slug } : null,
			author: node.author
				? { login: String(node.author.login || ""), avatarUrl: String(node.author.avatarUrl || "") }
				: null,
		},
		comments: (comments.nodes || []).filter((c: any) => c).map(shapeComment),
		totalComments: typeof comments.totalCount === "number" ? comments.totalCount : 0,
		pageInfo: comments.pageInfo || { hasNextPage: false, endCursor: null },
	};
}

/** 回复：先按 discussion number 取 node id，再 addDiscussionComment */
const ADD_COMMENT = `mutation($discussionId:ID!,$body:String!){
  addDiscussionComment(input:{discussionId:$discussionId, body:$body}){
    comment{ id url createdAt }
  }
}`;

const DISCUSSION_ID_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){ discussion(number:$number){ id } }
}`;

async function addComment(token: string, repo: string, number: number, body: string) {
	const slash = repo.indexOf("/");
	const idResult = await gh(token, DISCUSSION_ID_QUERY, {
		owner: repo.slice(0, slash),
		name: repo.slice(slash + 1),
		number,
	});
	const discussionId = idResult.data?.repository?.discussion?.id;
	if (!discussionId) {
		const first = idResult.errors && idResult.errors[0];
		if (first && /not found/i.test(String(first.message || ""))) throw new Error("NOT_FOUND");
		throw new Error((first && first.message) || "找不到讨论");
	}

	const result = await gh(token, ADD_COMMENT, { discussionId, body });
	const comment = result.data?.addDiscussionComment?.comment;
	if (!comment) {
		const first = result.errors && result.errors[0];
		throw new Error((first && first.message) || "回复失败");
	}
	return { id: String(comment.id || ""), url: comment.url || "", createdAt: comment.createdAt || "" };
}

/* ---------------- 图片上传（issue #11） ---------------- */

interface UploadedImage {
	url: string;
	name: string;
}

/**
 * 图片上传**必须用一个用户身份**的 token。
 *
 * ⚠️ 这是实测踩出来的：user-attachments 端点对 **GitHub App 的 installation token
 * 一律返回 404**，同一个仓库、同一个请求，把 token 换成人的 PAT 就成功。
 * 原因不难猜 —— 这个端点建立的是「某个用户上传的附件」，而 App 没有用户身份。
 *
 * 所以这里不复用 resolveIdentity() 的结果，而是专门挑一个「人」：
 *   · 优先 DISCUSSIONS_TOKEN（就是维护者本人的 PAT）
 *   · 只有 App 没配 PAT 时，才拿 App token 试一次
 *     （将来的 GitHub 版本放宽了就成了，成不了也只是图片失败，正文照发）
 */
function uploadToken(): string | null {
	const pat = (Deno.env.get("DISCUSSIONS_TOKEN") || "").trim();
	return pat || null;
}

/**
 * 附件接口要的候选 token，按优先级排列。
 *
 * ⚠️ 纠正一个早先的错误结论：这个接口**不是只认人**。
 * 之前一直报 404，真正的原因是 `repository_id` 传错了 ——
 * 它要**数字**仓库 id（`659772435`），而代码传的是 GraphQL 的 node id（`R_kg…`）。
 * 文档里写着「`gh repo view --json id` 返回 node id，在这里会失败」，我漏了这行。
 *
 * 现在按顺序试：PAT → App installation token。
 * 谁成功就用谁；全都 404/403 时把每个的失败原因都带回去，方便一眼看出是权限还是 id 问题。
 */
function uploadTokens(appToken: string | null): string[] {
	const out: string[] = [];
	const pat = (Deno.env.get("DISCUSSIONS_TOKEN") || "").trim();
	if (pat) out.push(pat);
	if (appToken && appToken !== pat) out.push(appToken);
	return out;
}

/**
 * 把一张 base64 图片传到 GitHub 的附件通道，返回可在 Markdown 里引用的 URL。
 *
 * 入参约定（前端负责把 File 读成 dataURL）：
 *   { name: "截图.png", data: "data:image/png;base64,...." }
 * 只认 IMAGE_TYPES 里的类型；其它一律拒绝，避免把 GitHub 不支持的东西发过去再吃 422。
 */
async function uploadImage(
	tokens: string[],
	repoDbId: string,
	image: { name?: unknown; data?: unknown },
): Promise<UploadedImage> {
	const dataUrl = String(image?.data || "");
	const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!m) throw new Error("IMAGE_INVALID");
	const mime = m[1].toLowerCase();
	const ext = IMAGE_TYPES[mime];
	if (!ext) throw new Error("IMAGE_TYPE");

	// base64 → 二进制。atob 比手写表快，且 Deno 自带
	let bytes: Uint8Array;
	try {
		const binary = atob(m[2]);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	} catch {
		throw new Error("IMAGE_INVALID");
	}
	if (!bytes.length) throw new Error("IMAGE_INVALID");
	if (bytes.length > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
	if (!repoDbId || !/^\d+$/.test(repoDbId)) throw new Error("REPO_DB_ID_MISSING");

	// 文件名只用来给 URL 定扩展名，不参与展示；用户给的名字可能带奇怪字符，统一重命名
	const safeName = `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
	const qs = new URLSearchParams({
		repository_id: repoDbId,
		name: safeName,
		content_type: mime,
	});

	const failures: string[] = [];
	for (const token of tokens) {
		const res = await fetch(`${GITHUB_UPLOAD}?${qs.toString()}`, {
			method: "POST",
			headers: {
				"Authorization": `bearer ${token}`,
				"Accept": "application/vnd.github+json",
				"Content-Type": mime,
				"User-Agent": "ckarefulon-feedback",
			},
			body: bytes,
		});
		const text = await res.text();
		let payload: any = null;
		try { payload = JSON.parse(text); } catch { payload = null; }
		if (res.ok && payload && typeof payload.url === "string") {
			// 保留用户给的原名，用作 Markdown 的 alt（读屏与图片加载失败时能看到）
			const label = clip(image?.name, 80).replace(/[\[\]\\]/g, "") || "截图";
			return { url: payload.url, name: label };
		}
		// 记下这次的失败原因，继续试下一个 token
		const why = payload && payload.errors && payload.errors[0] && payload.errors[0].message;
		failures.push(`HTTP ${res.status}${why ? "：" + why : ""}`);
	}

	// 全失败：把原因汇总成一句话，别只丢一个状态码
	const hint = failures.some((f) => f.includes("404"))
		? "（附件接口要求 token 对仓库有写权限；classic PAT 需勾 repo）"
		: "";
	throw new Error(`图片上传失败 ${failures.join(" / ")}${hint}`);
}

/** 把图片拼成 Markdown 块，附在正文末尾 */
function imageMarkdown(images: UploadedImage[]): string {
	if (!images.length) return "";
	return "\n\n" + images.map((img) => `![${img.name}](${img.url})`).join("\n\n");
}

/**
 * 收集并上传本次提交带的图片。
 *
 * 设计原则：**图片失败不能连累正文**。用户写的那段字才是主体，
 * 图没传上去只该降级提示，不该让他整条都发不出去。
 * 所以这里返回 { images, error }，而不是抛异常。
 */
async function collectImages(
	token: string,
	raw: any,
	repo: string,
): Promise<{ images: UploadedImage[]; error: string | null }> {
	const list = Array.isArray(raw?.images) ? raw.images.slice(0, MAX_IMAGES) : [];
	if (!list.length) return { images: [], error: null };

	const tokens = uploadTokens(token);
	if (!tokens.length) return { images: [], error: "还没有配置上传用的令牌（DISCUSSIONS_TOKEN）" };

	let totalChars = 0;
	for (const item of list) totalChars += String(item?.data || "").length;
	if (totalChars > MAX_IMAGE_B64) {
		return { images: [], error: "图片总大小超出限制" };
	}

	const rc = await resolveRepo(token, repo);
	const images: UploadedImage[] = [];
	for (let i = 0; i < list.length; i++) {
		try {
			images.push(await uploadImage(tokens, rc.repoDbId, list[i]));
		} catch (err) {
			// 这里给用户看的必须是「能读懂的一句话」，不能把内部错误码抛出去
			const why = describe(err);
			return { images, error: `第 ${i + 1} 张图没能上传（${why}）` };
		}
	}
	return { images, error: null };
}

/* ---------------- 帖子操作与互动（issue #33） ---------------- */

/**
 * 编辑 / 关闭 / 删除 / 表情。
 *
 * 「支持（upvote）」在 GitHub 上没有实现路径：addUpvote 按**凭证类型**拒绝，
 * 只要是 App 或 token 身份一律 FORBIDDEN（Resource not accessible by integration），
 * 没有任何权限能解锁，只有真人用浏览器点才有效。所以这里不做 upvote，
 * 只做 addReaction —— 表情本身（👍 等）用 token 是能正常加的。
 */

const DISCUSSION_ID_BY_NUMBER = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    discussion(number:$number){ id closed title body }
  }
}`;

async function discussionNode(token: string, repo: string, number: number) {
	const slash = repo.indexOf("/");
	const result = await gh(token, DISCUSSION_ID_BY_NUMBER, {
		owner: repo.slice(0, slash),
		name: repo.slice(slash + 1),
		number,
	});
	const node = result.data?.repository?.discussion;
	if (!node) {
		const first = result.errors && result.errors[0];
		if (first && /not found/i.test(String(first.message || ""))) throw new Error("NOT_FOUND");
		throw new Error((first && first.message) || "找不到讨论");
	}
	return node as { id: string; closed: boolean; title: string; body: string };
}

const UPDATE_DISCUSSION = `mutation($id:ID!,$title:String,$body:String){
  updateDiscussion(input:{discussionId:$id, title:$title, body:$body}){
    discussion{ id title body updatedAt }
  }
}`;

async function editDiscussion(
	token: string,
	repo: string,
	number: number,
	input: { title?: string; body?: string },
) {
	const node = await discussionNode(token, repo, number);
	const result = await gh(token, UPDATE_DISCUSSION, {
		id: node.id,
		title: input.title ?? null,
		body: input.body ?? null,
	});
	const updated = result.data?.updateDiscussion?.discussion;
	if (!updated) {
		const first = result.errors && result.errors[0];
		throw new Error((first && first.message) || "修改失败");
	}
	return { title: updated.title || "", body: updated.body || "", updatedAt: updated.updatedAt || "" };
}

const CLOSE_DISCUSSION = `mutation($id:ID!,$reason:DiscussionCloseReason!){
  closeDiscussion(input:{discussionId:$id, reason:$reason}){ discussion{ id closed stateReason } }
}`;
const REOPEN_DISCUSSION = `mutation($id:ID!){
  reopenDiscussion(input:{discussionId:$id}){ discussion{ id closed stateReason } }
}`;

async function setDiscussionClosed(token: string, repo: string, number: number, closed: boolean) {
	const node = await discussionNode(token, repo, number);
	const result = closed
		? await gh(token, CLOSE_DISCUSSION, { id: node.id, reason: "RESOLVED" })
		: await gh(token, REOPEN_DISCUSSION, { id: node.id });
	const out = closed
		? result.data?.closeDiscussion?.discussion
		: result.data?.reopenDiscussion?.discussion;
	if (!out) {
		const first = result.errors && result.errors[0];
		throw new Error((first && first.message) || (closed ? "关闭失败" : "重开失败"));
	}
	return { closed: !!out.closed, stateReason: out.stateReason || null };
}

const DELETE_DISCUSSION = `mutation($id:ID!){ deleteDiscussion(input:{id:$id}){ clientMutationId } }`;

async function deleteDiscussion(token: string, repo: string, number: number) {
	const node = await discussionNode(token, repo, number);
	const result = await gh(token, DELETE_DISCUSSION, { id: node.id });
	if (result.errors && result.errors.length) {
		throw new Error(result.errors[0].message || "删除失败");
	}
	return { deleted: true };
}

/** GitHub 支持的七种表情；前端只开放这几个，别的名字直接拒掉（别让上游替我们校验） */
const REACTIONS = new Set([
	"THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "HEART", "ROCKET", "EYES",
]);

const ADD_REACTION = `mutation($subjectId:ID!,$content:ReactionContent!){
  addReaction(input:{subjectId:$subjectId, content:$content}){ reaction{ content } }
}`;
const REMOVE_REACTION = `mutation($subjectId:ID!,$content:ReactionContent!){
  removeReaction(input:{subjectId:$subjectId, content:$content}){ reaction{ content } }
}`;

async function toggleReaction(
	token: string,
	subjectId: string,
	content: string,
	remove: boolean,
) {
	if (!REACTIONS.has(content)) throw new Error("表情类型无效");
	const result = await gh(token, remove ? REMOVE_REACTION : ADD_REACTION, { subjectId, content });
	if (result.errors && result.errors.length) {
		throw new Error(result.errors[0].message || (remove ? "取消表情失败" : "添加表情失败"));
	}
	return { content, active: !remove };
}

/** 详情里一条评论（或回复）的 node id → 用来给评论加表情 */
const COMMENT_ID_QUERY = `query($id:ID!){ node(id:$id){ ... on DiscussionComment { id } } }`;

async function assertComment(token: string, id: string) {
	const result = await gh(token, COMMENT_ID_QUERY, { id });
	if (!result.data?.node?.id) throw new Error("找不到这条回复");
	return String(result.data.node.id);
}

/* ---------------- 跟进状态（列表标签 / 筛选） ---------------- */

/**
 * 维护者登录名。列表里据此判断「已跟进 / 已计划」，前端也用它给这个账号
 * 打「管理员」标签 —— 两边口径必须同一个来源，不能各写一份。
 */
function maintainerLogin(): string {
	return (Deno.env.get("FEEDBACK_MAINTAINER") || "Ckarefulon").trim() || "Ckarefulon";
}

/**
 * 拦住「谁能看到编辑 / 关闭 / 删除」。
 *
 * 曾经写成「站内用户名 == GitHub 登录名」，结果是**谁都看不到按钮** ——
 * 站点用户名来自 user_profiles 或邮箱前缀，和 GitHub 登录名没有任何绑定关系，
 * 永远比不中。用户反馈「编辑删除都没有」，根因就是这三行。
 *
 * 现在的口径：
 *   · 没登录 → false（按钮不给游客看）
 *   · 配了 FEEDBACK_ADMINS（逗号分隔的站内用户名）→ 只认名单里的人
 *   · 没配 → **任何登录用户都可以**（默认放行，站点自己的账号能用）
 *
 * ⚠️ 这只是 UI 开关，不是安全边界：真正的写权限在 token 那侧，
 *    函数里每个写动作都要过 resolveIdentity()。要收紧就配 FEEDBACK_ADMINS。
 */
function adminAllowlist(): string[] {
	const raw = (Deno.env.get("FEEDBACK_ADMINS") || "").trim();
	if (!raw) return [];
	return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function viewerCanManage(viewer: Submitter | null): boolean {
	if (!viewer) return false;
	if (!adminAllowlist().length) return true;   // 没配名单：登录即可管理
	return isAdminName(viewer.username, viewer.email);
}

/**
 * 严格版：**必须显式配了名单并且命中**才算管理员。
 *
 * 用于「用维护者的 PAT 代替某人发言」这种敏感动作 —— 那个动作会在 GitHub 上
 * 以站长的账号出现，绝不能顺手给任何登录用户。名单没配就一律 false。
 */
function isListedAdmin(viewer: Submitter | null): boolean {
	if (!viewer) return false;
	if (!adminAllowlist().length) return false;
	return isAdminName(viewer.username, viewer.email);
}

/** 六种状态；前端按这个顺序渲染标签与筛选框 */
type FollowState = "open" | "followed" | "planned" | "complete" | "duplicate" | "not_planned";

/**
 * 一条讨论的跟进状态，规则按 issue #37：
 *   · 维护者在评论里出现过            → 已跟进（followed）
 *   · 其中还有「已链接到 Issue」的评论 → 已计划（planned，覆盖 followed）
 *   · 讨论已关闭                      → 按关闭原因 complete / duplicate / not_planned
 *
 * 关闭优先于评论：已关闭的讨论再看「有没有维护者留言」没有意义，
 * 而且关闭后自动留言里本身就带维护者名字，会把状态骗成「已跟进」。
 */
function followState(
	closed: boolean,
	stateReason: unknown,
	comments: Array<{ author?: { login?: string } | null; body?: string }>,
	maintainer: string,
): FollowState {
	if (closed) {
		const reason = String(stateReason || "").toUpperCase();
		if (reason === "DUPLICATE") return "duplicate";
		if (reason === "OUTDATED") return "not_planned";
		// RESOLVED / REOPENED / 没给原因：都算完成（GitHub 关闭 Discussion 默认 RESOLVED）
		return "complete";
	}
	const needle = maintainer.toLowerCase();
	let followed = false;
	let planned = false;
	for (const c of comments) {
		const login = c && c.author ? String(c.author.login || "") : "";
		if (!login || login.toLowerCase() !== needle) continue;
		followed = true;
		// 与 .github/workflows/discussion-issue-link.yml 留言格式一致
		if (/已链接到\s*Issue/i.test(String(c.body || ""))) { planned = true; break; }
	}
	if (planned) return "planned";
	if (followed) return "followed";
	return "open";
}

/* ---------------- 列表查询 ---------------- */

const LIST_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    discussions(first:$first, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url createdAt updatedAt bodyText upvoteCount
        closed stateReason
        category{name slug}
        author{login}
        comments(first:50){
          totalCount
          nodes{ author{login} body }
        }
      }
    }
  }
}`;

async function fetchDiscussions(token: string, repo: string, first: number, after: string | null) {
	const slash = repo.indexOf("/");
	const owner = repo.slice(0, slash);
	const name = repo.slice(slash + 1);

	const result = await gh(token, LIST_QUERY, { owner, name, first, after: after || null });
	const node = result.data?.repository;
	if (!node) {
		throw new Error((result.errors && result.errors[0] && result.errors[0].message) || "读取讨论失败");
	}

	const maintainer = maintainerLogin();
	const discussions = (node.discussions?.nodes || [])
		.filter((d: any) => d)
		.map((d: any) => {
			const closed = !!d.closed;
			return {
				number: d.number,
				title: d.title || "",
				url: d.url,
				createdAt: d.createdAt,
				updatedAt: d.updatedAt,
				category: d.category ? { name: d.category.name, slug: d.category.slug } : null,
				author: d.author ? d.author.login : null,
				comments: d.comments ? d.comments.totalCount : 0,
				upvotes: typeof d.upvoteCount === "number" ? d.upvoteCount : 0,
				excerpt: excerpt(d.bodyText),
				closed,
				state: followState(closed, d.stateReason, (d.comments?.nodes || []).filter((c: any) => c), maintainer),
			};
		});

	return {
		discussions,
		pageInfo: node.discussions?.pageInfo || { hasNextPage: false, endCursor: null },
	};
}

/* ---------------- 入口 ---------------- */

Deno.serve(async (req: Request) => {
	if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

	const repo = (Deno.env.get("FEEDBACK_REPO") || DEFAULT_REPO).trim() || DEFAULT_REPO;
	const now = Date.now();
	const ip = clientIp(req);
	const url = new URL(req.url);

	/** 统一取身份：App 优先（bot 作者），否则 PAT；都没有则视为未配置 */
	async function identity(): Promise<Identity | null> {
		try {
			return await resolveIdentity(repo);
		} catch (err) {
			throw err;
		}
	}

	/* ---------- 读：预热 / 广场列表 / 详情 ---------- */
	if (req.method === "GET") {
		if (overLimit(readHits, ip, READ_MAX, now)) {
			return json({ success: false, message: "请求太频繁了，请稍后再试" }, 429);
		}

		const action = url.searchParams.get("action") || "warm";
		let ident: Identity | null = null;
		try {
			ident = await identity();
		} catch (err) {
			return json({ success: false, ready: false, message: describe(err), repo }, 502);
		}
		if (!ident) {
			return json({ success: false, configure: true, message: "反馈服务尚未配置", repo });
		}

		const token = ident.token;
		const who = { mode: ident.mode, bot: ident.botName };

		try {
			const rc = await resolveRepo(token, repo);

			if (action === "list") {
				const firstRaw = Number(url.searchParams.get("first") || 30);
				const first = Math.min(Math.max(Number.isFinite(firstRaw) ? firstRaw : 30, 1), 50);
				const after = url.searchParams.get("after");

				// 只有「游客看第一页」才吃缓存：
				// 登录用户要看「我提的」标记，翻页要看后面的内容，都不能拿旧结果糊弄。
				const viewer0 = await resolveSubmitter(req);
				const cacheKey = `${repo}|${first}|${after || ""}`;
				const cacheable = !viewer0 && !after;
				if (cacheable && listCache && listCache.key === cacheKey
					&& Date.now() - listCache.at < LIST_TTL_MS) {
					return json(listCache.payload, 200, {
						// 浏览器也存 10 秒：连点两次页面不必再打一趟
						"Cache-Control": "public, max-age=10, stale-while-revalidate=30",
						"X-Feedback-Cache": "hit",
					});
				}

				const page = await fetchDiscussions(token, repo, first, after);

				// 站内关联：只有已登录用户才查，且只回「是不是你提的」，不回别人的身份
				const viewer = viewer0;
				let mine: Record<string, true> = {};
				if (viewer) {
					const numbers = page.discussions.map((d: any) => d.number);
					const base = supabaseBase();
					const key = serviceKey();
					if (base && key && numbers.length) {
						try {
							const q = `${base}/rest/v1/feedback_submissions?user_id=eq.${encodeURIComponent(viewer.userId)}`
								+ `&discussion_number=in.(${numbers.join(",")})&select=discussion_number`;
							const r = await fetch(q, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } });
							if (r.ok) {
								const rows = await r.json();
								if (Array.isArray(rows)) {
									for (const row of rows) {
										if (row && row.discussion_number != null) mine[String(row.discussion_number)] = true;
									}
								}
							}
						} catch { /* 忽略 */ }
					}
				}

				const payload = {
					success: true,
					repo,
					identity: who,
					types: describeTypes(rc),
					missing: rc.missing,
					// 维护者登录名：前端据此给这个账号打「管理员」标签（issue #38）
					maintainer: maintainerLogin(),
					// 自己的帖子连名字一起回（issue #45）：列表以前只能拿到 GitHub 上的 bot 作者，
					// 于是「我提交的」在广场里也显示成「匿名」，看着就像登录没生效。
					// 只补自己的那几条 —— 别人的身份仍然不在列表里露出（与 #33 的隐私口径一致）。
					discussions: page.discussions.map((d: any) => {
						if (!mine[String(d.number)]) return d;
						return {
							...d,
							mine: true,
							siteAuthor: viewer
								? { username: viewer.username, avatarUrl: viewer.avatarUrl }
								: null,
						};
					}),
					pageInfo: page.pageInfo,
					viewer: viewer ? { loggedIn: true, username: viewer.username } : { loggedIn: false, username: null },
				};

				if (cacheable) {
					listCache = { key: cacheKey, at: Date.now(), payload };
				}

				return json(payload, 200, cacheable
					? { "Cache-Control": "public, max-age=10, stale-while-revalidate=30", "X-Feedback-Cache": "miss" }
					: { "Cache-Control": "no-store" });
			}

			// 单条详情（含回复列表）
			if (action === "detail") {
				const number = Number(url.searchParams.get("number") || 0);
				if (!Number.isInteger(number) || number <= 0) {
					return json({ success: false, message: "讨论编号无效" }, 400);
				}
				const firstRaw = Number(url.searchParams.get("first") || 40);
				const first = Math.min(Math.max(Number.isFinite(firstRaw) ? firstRaw : 40, 1), 60);
				const detail = await fetchDiscussion(token, repo, number, first, url.searchParams.get("after"));
				// 谁能看到「编辑/关闭/删除」（issue #33）。
				// ⚠️ 不能拿站点用户名去比 GitHub 登录名 —— 两者可以不一样（user_profiles.username
				// 与 GitHub 账号名没有强绑定）。真正可信的判断在服务端：这里已经验过 JWT、
				// 也知道维护者是谁，只有两者对得上才给 true。这只是「别把按钮摊给所有人」的
				// UI 开关，真正的写权限仍然由 token 本身决定。
				const detailViewer = await resolveSubmitter(req);
				const canManage = viewerCanManage(detailViewer);
				// 回复会不会用「本人 PAT」发：只有显式配了名单并命中才为真，
				// 前端据此决定回复框里那句提示怎么写。
				const adminAsSelf = isListedAdmin(detailViewer)
					&& !!(Deno.env.get("DISCUSSIONS_TOKEN") || "").trim();
				// 站内身份（issue 三轮）：提交者如果是本站登录用户，就显示他自己的名字与头像，
				// 而不是「站点代发」。游客提交时为 null，前端显示「游客」；
				// 勾了匿名的返回 { anonymous: true }，前端显示「匿名」。
				const postAuthor = await lookupSubmissionAuthor(number);
				const siteAuthor = postAuthor.badge;
				// 回复也要能显示成本人：GitHub 上都是 bot 代发，作者归属只能在站内表里查。
				// 主回复与二级回复都要查 —— 少查一层，那一层的回复就永远显示「游客」。
				const allComments: any[] = [];
				for (const c of (detail.comments || [])) {
					allComments.push(c);
					for (const r of (c.replies || [])) allComments.push(r);
				}
				const commentAuthors = await lookupCommentAuthors(allComments.map((c) => c.id));
				// 「楼主」：库里比 user_id，**不比名字**（匿名帖没有名字，游客帖没有身份）。
				// 算完只把布尔值给前端，userId 永远不下发。
				const postUserId = postAuthor.userId;
				function withAuthor(node: any): any {
					const row = node && commentAuthors[node.id];
					if (!row) return node;
					const out: any = { ...node, siteAuthor: row.badge };
					if (postUserId && row.userId && row.userId === postUserId) out.op = true;
					return out;
				}
				const commentsWithAuthor = (detail.comments || []).map((c: any) => {
					const head = withAuthor(c);
					if (!c.replies || !c.replies.length) return head;
					return { ...head, replies: c.replies.map(withAuthor) };
				});
				return json({
					success: true,
					repo,
					identity: who,
					types: describeTypes(rc),
					maintainer: maintainerLogin(),
					canManage,
					adminAsSelf,
					siteAuthor,
					...detail,
					comments: commentsWithAuthor,
				}, 200, {
					// 详情相对稳定，让浏览器存 15 秒，来回点不重复拉
					// ⚠️ 带了 canManage 就不能再 public 缓存：那是按人变化的
					"Cache-Control": "private, max-age=15",
				});
			}

			return json({
				success: true,
				ready: true,
				repo,
				identity: who,
				types: describeTypes(rc),
				missing: rc.missing,
				maintainer: maintainerLogin(),
				cachedAt: rc.at,
			});
		} catch (err) {
			const message = describe(err);
			const status = message === "TOKEN_INVALID" ? 401 : (message === "讨论不存在" ? 404 : 502);
			return json({ success: false, ready: false, message, repo }, status);
		}
	}

	if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

	/* ---------- 写：新建 / 回复（身份 App 优先） ---------- */
	let ident: Identity | null = null;
	try {
		ident = await identity();
	} catch (err) {
		return json({ success: false, message: describe(err), repo }, 502);
	}
	if (!ident) {
		return json({ success: false, configure: true, message: "反馈服务尚未配置，可改用 GitHub 提交", repo });
	}
	const token = ident.token;
	if (overLimit(writeHits, ip, WRITE_MAX, now)) {
		return json({ success: false, message: "提交太频繁了，请稍后再试" }, 429);
	}

	let raw: any = null;
	try {
		raw = await req.json();
	} catch {
		return json({ success: false, message: "提交内容无法解析" }, 400);
	}

	// 蜜罐：真人看不见这个字段
	if (clip(raw?.hp, 64)) return json({ success: true, url: "", number: 0, silent: true });

	/* ---------- 写之一：在已有讨论下回复 ---------- */
	const action = (url.searchParams.get("action") || raw?.action || "").trim();

	/* ---------- 单张图片上传（issue #11 二轮：选完立刻传，不等提交） ---------- */
	if (action === "upload") {
		// 前端在正文里插入占位符后立刻调这里，拿到 URL 再把占位符换成真图。
		// 这样「点了图就开始传」，而不用等到点提交才动。
		const tokens = uploadTokens(ident.token);
		if (!tokens.length) {
			return json({
				success: false,
				message: "还没有配置上传用的令牌（DISCUSSIONS_TOKEN），可先把图去掉再提交",
			}, 503);
		}
		try {
			const rc = await resolveRepo(token, repo);
			const one = await uploadImage(tokens, rc.repoDbId, raw || {});
			return json({ success: true, url: one.url, name: one.name });
		} catch (err) {
			const message = describe(err);
			return json({ success: false, message }, 502);
		}
	}

	/* ---------- 帖子操作与互动（issue #33） ---------- */
	if (action === "edit" || action === "close" || action === "reopen"
		|| action === "delete" || action === "reaction") {
		const number = Number(raw?.number || 0);
		if (!Number.isInteger(number) || number <= 0) {
			return json({ success: false, message: "讨论编号无效" }, 400);
		}
		try {
			if (action === "edit") {
				const title = clip(raw?.title, 300);
				const body = clip(raw?.body, 8000);
				if (!title && !body) return json({ success: false, message: "没有要修改的内容" }, 400);
				if (title && title.length < 2) return json({ success: false, message: "标题太短" }, 400);
				// 编辑也允许带新图：先上传，再拼进正文。
				// 编辑传上来的 body 是前端剥过附加信息的纯正文，所以图片直接接在后面即可。
				const pending = await collectImages(token, raw, repo);
				const withImages = body + imageMarkdown(pending.images);
				const updated = await editDiscussion(token, repo, number, {
					title: title || undefined,
					body: withImages ? withImages : undefined,
				});
				return json({
					success: true,
					number,
					discussion: updated,
					images: pending.images,
					imageError: pending.error,
				});
			}
			if (action === "close" || action === "reopen") {
				const out = await setDiscussionClosed(token, repo, number, action === "close");
				return json({ success: true, number, ...out });
			}
			if (action === "delete") {
				// 删除不可逆：前端必须显式传 confirm=true，挡掉误触
				if (raw?.confirm !== true) {
					return json({ success: false, message: "删除需要二次确认" }, 400);
				}
				const out = await deleteDiscussion(token, repo, number);
				return json({ success: true, number, ...out });
			}
			// reaction：帖子本身或某条评论/回复
			const content = String(raw?.content || "").trim().toUpperCase();
			const remove = raw?.remove === true;
			let subjectId: string;
			if (raw?.commentId) {
				subjectId = await assertComment(token, String(raw.commentId));
			} else {
				subjectId = (await discussionNode(token, repo, number)).id;
			}
			const out = await toggleReaction(token, subjectId, content, remove);
			return json({ success: true, number, ...out });
		} catch (err) {
			const message = describe(err);
			const status = message === "TOKEN_INVALID" ? 401
				: (message === "讨论不存在" || message === "找不到这条回复" ? 404 : 502);
			return json({ success: false, message }, status);
		}
	}

	if (action === "comment") {
		const number = Number(raw?.number || 0);
		if (!Number.isInteger(number) || number <= 0) {
			return json({ success: false, message: "讨论编号无效" }, 400);
		}
		const commentBody = clip(raw?.body, 8000);
		if (commentBody.length < 2) {
			return json({ success: false, message: "回复内容太短" }, 400);
		}
		if (duplicated(`c\u0000${number}\u0000${commentBody}`, now)) {
			return json({ success: false, message: "同样的回复刚发过了" }, 409);
		}
		try {
			// ── 用什么身份发这条回复（issue #44：「给本站管理员账号用 PAT 评论」）──
			//
			// 默认仍走站点 App（GitHub 上显示 bot，适合代发/匿名场景）。
			// 但如果**发回复的人本身就是管理员**，就改用 PAT 发 —— 这样 GitHub 上显示的
			// 是他自己的账号，而不是「一个机器人替他说了句话」。
			//
			// 只有管理员有 PAT（全站只有一个 DISCUSSIONS_TOKEN，代表维护者本人），
			// 所以普通用户和游客的回复仍然走 bot，没法冒充别人。
			const commenter = await resolveSubmitter(req);
			const pat = (Deno.env.get("DISCUSSIONS_TOKEN") || "").trim();
			// ⚠️ 必须**显式配了名单**才用 PAT。
			// 不能拿「登录即可管理」那个宽松口径来判断 —— 那会让任何登录用户的回复
			// 都用维护者的 PAT 发出去，等于在 GitHub 上冒充站长发言。
			const asMaintainer = !!pat && isListedAdmin(commenter);
			const postToken = asMaintainer ? pat : token;
			const created = await addComment(postToken, repo, number, commentBody);
			// 记下这条回复的真实作者（登录用户才有）——即便用 PAT 发、GitHub 上已经是他本人，
			// 站内还是要有一份归属：显示用的名字/头像以站内为准，判定楼主也靠它。
			const anonymous = raw?.anonymous === true;
			let linked = false;
			if (commenter && created.id) {
				linked = await recordCommentAuthor({
					commentId: created.id,
					number,
					submitter: commenter,
					anonymous,
				});
			}
			return json({
				success: true,
				number,
				comment: created,
				// 如实告诉前端这条是用哪个身份发的：pat = 显示成管理员本人
				identity: asMaintainer
					? { mode: "pat", bot: null, as: "maintainer" }
					: { mode: ident.mode, bot: ident.botName, as: "bot" },
				anonymous: anonymous && !!commenter,
				commenter: commenter
					? {
						loggedIn: true,
						username: anonymous ? null : commenter.username,
						anonymous: anonymous,
						linked,
					}
					: { loggedIn: false, username: null, anonymous: false, linked: false },
			});
		} catch (err) {
			const message = describe(err);
			const status = message === "TOKEN_INVALID" ? 401 : (message === "讨论不存在" ? 404 : 502);
			return json({ success: false, message }, status);
		}
	}

	/* ---------- 写之二：新建讨论 ---------- */
	// 默认 Bug（与前端弹窗的默认选中一致）：类型没传或不认识时按 bug 处理，
	// 而不是悄悄落到 Others —— 那会让 Bug 报告漂到「其他」分类里没人看。
	const type = TYPES.some((t) => t.type === raw?.type) ? String(raw.type) : "bug";

	// 标题与正文互相补齐（issue #31）：正文 ≤4 字 / 标题被截断 / 两者都空 的判定都收在这里
	const filled = completeTitleBody(raw?.title, raw?.body);
	if (!filled) return json({ success: false, message: "请再多写几个字" }, 400);
	const { title: rawTitle, body: bodyText } = filled;
	if (bodyText.length < 4) return json({ success: false, message: "请再多写几个字" }, 400);

	const title = buildTitle(type, rawTitle, bodyText);
	const contact = clip(raw?.contact, 140);
	const meta = clip(raw?.meta, 1200);
	// 来源页面：前端从 ?from= 自动带上（从哪一页点的顶栏反馈），也允许用户自己改。
	// 它现在会写进 GitHub 正文顶部（issue #18），所以再兜一层：不是站内路径就不写。
	const page = clip(raw?.page, 300);
	const pageForBody = /^[\w\-./%#?=&~]*$/.test(page) && page.length > 0 ? page : "";

	if (duplicated(`${type}\u0000${title}\u0000${bodyText}`, now)) {
		return json({ success: false, message: "同样的内容刚提交过了" }, 409);
	}

	try {
		const rc = await resolveRepo(token, repo);
		// 该 type 没有对应分类时，落到第一个可用分类（前端会提示）
		const category = rc.byType[type] || rc.categories[0];

		// 图片先上传：资源必须**先存在、再被正文引用**才会变成可访问，
		// 顺序反过来会得到一个 404 的链接（实测）。
		const pending = await collectImages(token, raw, repo);

		const result = await gh(
			token,
			`mutation($repoId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repoId,categoryId:$categoryId,title:$title,body:$body}){discussion{number url category{name}}}}`,
			{
				repoId: rc.repoId,
				categoryId: category.id,
				title,
				body: buildBody({ body: bodyText, contact, meta, page: pageForBody, images: pending.images }),
			},
		);

		const discussion = result.data?.createDiscussion?.discussion;
		if (!discussion) {
			const firstError = result.errors && result.errors[0];
			throw new Error((firstError && firstError.message) || "创建讨论失败");
		}

		// 站内留痕：谁提的只存自己库里，GitHub 那边仍由站点 App 代发
		const submitter = await resolveSubmitter(req);
		// 「匿名提交」：勾上就不记名字，但仍记 user_id —— 只有这样帖内回复才认得出楼主
		const anonymous = raw?.anonymous === true && !!submitter;
		const recorded = await recordSubmission({
			number: discussion.number,
			submitter,
			anonymous,
			kind: type,
			title,
			page: page || "/feedback/",
		});

		return json({
			success: true,
			url: discussion.url,
			number: discussion.number,
			type,
			title,
			category: discussion.category ? discussion.category.name : category.name,
			// 说明是否因为缺分类而降级
			degraded: !rc.byType[type],
			// 作者身份：app = 站点代发（bot），pat = 维护者本人
			identity: { mode: ident.mode, bot: ident.botName },
			// 站内关联：登录用户提交时会记下身份；游客为 null
			anonymous,
			submitter: submitter
				? { loggedIn: true, username: anonymous ? null : submitter.username, anonymous }
				: { loggedIn: false, username: null, anonymous: false },
			linked: recorded,
			// 图片结果：帖子已经发出去了，图没跟上时要让用户知道
			images: pending.images,
			imageError: pending.error,
		});
	} catch (err) {
		const message = describe(err);
		return json({ success: false, message, repo }, message === "TOKEN_INVALID" ? 401 : 502);
	}
});

function describe(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err || "未知错误");
	if (message === "TOKEN_INVALID") return "反馈令牌失效（DISCUSSIONS_TOKEN）";
	if (message === "DISCUSSIONS_DISABLED") return "仓库尚未启用 Discussions";
	if (message === "CATEGORY_MISSING") return "仓库没有可用的讨论分类";
	if (message === "REPO_INVALID") return "FEEDBACK_REPO 配置有误";
	if (message === "NOT_FOUND") return "讨论不存在";
	if (message === "IMAGE_INVALID") return "图片格式无法识别";
	if (message === "IMAGE_TYPE") return "只支持 PNG / JPEG / GIF / WebP";
	if (message === "IMAGE_TOO_LARGE") return "单张图片不能超过 10 MB";
	if (message === "REPO_DB_ID_MISSING") return "拿不到仓库的数字 id，图片无法上传";
	if (/^图片上传失败 /.test(message)) return message.replace(/^图片上传失败 /, "图片上传失败：");
	if (/rate limit/i.test(message)) return "GitHub 接口限流，请稍后再试";
	return message;
}
