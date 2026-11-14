/**
 * feedback —— 站点反馈广场 + 提交到 GitHub Discussions
 *
 * 一个函数干两件事（共用同一份 PAT 与同一份 ID 缓存，少一次冷启动）：
 *
 *   GET  /functions/v1/feedback            预热：解析仓库/分类 ID，返回分类可用情况
 *   GET  /functions/v1/feedback?action=list 广场：列出讨论（分页）
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
	repoId: string;
	categories: Category[];
	/** type → 实际使用的分类；仓库里没有对应分类时为 null */
	byType: Record<string, Category | null>;
	missing: string[];
	at: number;
}

let cache: RepoCache | null = null;

/* ---------------- 小工具 ---------------- */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
	});
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

		// 顺手取用户名（user_profiles.username），失败不影响主流程
		let username: string | null = null;
		if (key) {
			try {
				const pr = await fetch(
					`${base}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=username&limit=1`,
					{ headers: { "apikey": key, "Authorization": `Bearer ${key}` } },
				);
				if (pr.ok) {
					const rows = await pr.json();
					if (Array.isArray(rows) && rows[0] && typeof rows[0].username === "string") {
						username = rows[0].username;
					}
				}
			} catch { /* 忽略 */ }
		}
		return { userId: String(user.id), username };
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
}): Promise<boolean> {
	const base = supabaseBase();
	const key = serviceKey();
	if (!base || !key) return false;
	try {
		const res = await fetch(`${base}/rest/v1/feedback_submissions`, {
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
				username: input.submitter ? input.submitter.username : null,
				kind: input.kind,
				title: input.title.slice(0, 300),
				page: input.page.slice(0, 300),
			}),
		});
		return res.ok;
	} catch {
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
		`query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id hasDiscussionsEnabled discussionCategories(first:50){nodes{id name slug}}}}`,
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

function buildBody(input: { body: string; contact: string; meta: string }): string {
	const parts: string[] = [input.body];
	if (input.contact) parts.push(`**联系方式**：${input.contact}`);
	if (input.meta) {
		parts.push(`<details><summary>环境信息</summary>\n\n\`\`\`\n${input.meta}\n\`\`\`\n\n</details>`);
	}
	parts.push(`> 由站点反馈广场提交 · ${new Date().toISOString()}`);
	return parts.join("\n\n");
}

function defaultTitle(type: string, body: string): string {
	const labels: Record<string, string> = {
		bug: "Bug",
		feature: "Feature",
		question: "Question",
		chat: "Chat",
		others: "Other",
	};
	const firstLine = body.split("\n").map((s) => s.trim()).find((s) => s.length > 0) || "站点反馈";
	const head = firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
	return `[${labels[type] || "Feedback"}] ${head}`;
}

/** 列表摘要：去掉我们附加的环境信息块，压掉多余空白 */
function excerpt(bodyText: unknown, max = 180): string {
	let text = typeof bodyText === "string" ? bodyText : "";
	// 按我们固定附加的段落切：<details> 整块 → 签名行 → 联系方式行
	const detailsAt = text.indexOf("<details>");
	if (detailsAt > 0) text = text.slice(0, detailsAt);
	const quote = text.lastIndexOf("> 由站点反馈广场提交");
	if (quote > 0) text = text.slice(0, quote);
	const contact = text.indexOf("**联系方式**");
	if (contact > 0) text = text.slice(0, contact);
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
      category{name slug}
      author{login avatarUrl}
      comments(first:$first, after:$after){
        totalCount
        pageInfo{hasNextPage endCursor}
        nodes{
          id body bodyText createdAt upvoteCount isAnswer
          author{login avatarUrl}
          replies(first:20){
            nodes{
              id bodyText createdAt isAnswer
              author{login avatarUrl}
            }
          }
        }
      }
    }
  }
}`;

interface CommentNode {
	id: string;
	body: string;
	createdAt: string;
	author: { login: string; avatarUrl: string } | null;
	isAnswer: boolean;
	upvotes: number;
	replies: Array<{
		id: string;
		body: string;
		createdAt: string;
		author: { login: string; avatarUrl: string } | null;
		isAnswer: boolean;
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
		replies: (c.replies?.nodes || []).filter((r: any) => r).map((r: any) => ({
			id: String(r.id || ""),
			body: typeof r.bodyText === "string" ? r.bodyText : "",
			createdAt: r.createdAt || "",
			author: r.author
				? { login: String(r.author.login || ""), avatarUrl: String(r.author.avatarUrl || "") }
				: null,
			isAnswer: !!r.isAnswer,
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

/* ---------------- 列表查询 ---------------- */

const LIST_QUERY = `query($owner:String!,$name:String!,$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    discussions(first:$first, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title url createdAt updatedAt bodyText upvoteCount
        category{name slug}
        author{login}
        comments{totalCount}
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

	const discussions = (node.discussions?.nodes || [])
		.filter((d: any) => d)
		.map((d: any) => ({
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
		}));

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
				const page = await fetchDiscussions(token, repo, first, after);

				// 站内关联：只有已登录用户才查，且只回「是不是你提的」，不回别人的身份
				const viewer = await resolveSubmitter(req);
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

				return json({
					success: true,
					repo,
					identity: who,
					types: describeTypes(rc),
					missing: rc.missing,
					discussions: page.discussions.map((d: any) => (
						mine[String(d.number)] ? { ...d, mine: true } : d
					)),
					pageInfo: page.pageInfo,
					viewer: viewer ? { loggedIn: true, username: viewer.username } : { loggedIn: false, username: null },
				});
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
				return json({ success: true, repo, identity: who, types: describeTypes(rc), ...detail });
			}

			return json({
				success: true,
				ready: true,
				repo,
				identity: who,
				types: describeTypes(rc),
				missing: rc.missing,
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
			const created = await addComment(token, repo, number, commentBody);
			return json({
				success: true,
				number,
				comment: created,
				identity: { mode: ident.mode, bot: ident.botName },
			});
		} catch (err) {
			const message = describe(err);
			const status = message === "TOKEN_INVALID" ? 401 : (message === "讨论不存在" ? 404 : 502);
			return json({ success: false, message }, status);
		}
	}

	/* ---------- 写之二：新建讨论 ---------- */
	const type = TYPES.some((t) => t.type === raw?.type) ? String(raw.type) : "others";
	const bodyText = clip(raw?.body, 8000);
	if (bodyText.length < 4) return json({ success: false, message: "请再多写几个字" }, 400);

	const title = clip(raw?.title, 120) || defaultTitle(type, bodyText);
	const contact = clip(raw?.contact, 140);
	const meta = clip(raw?.meta, 1200);

	if (duplicated(`${type}\u0000${title}\u0000${bodyText}`, now)) {
		return json({ success: false, message: "同样的内容刚提交过了" }, 409);
	}

	try {
		const rc = await resolveRepo(token, repo);
		// 该 type 没有对应分类时，落到第一个可用分类（前端会提示）
		const category = rc.byType[type] || rc.categories[0];

		const result = await gh(
			token,
			`mutation($repoId:ID!,$categoryId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repoId,categoryId:$categoryId,title:$title,body:$body}){discussion{number url category{name}}}}`,
			{
				repoId: rc.repoId,
				categoryId: category.id,
				title,
				body: buildBody({ body: bodyText, contact, meta }),
			},
		);

		const discussion = result.data?.createDiscussion?.discussion;
		if (!discussion) {
			const firstError = result.errors && result.errors[0];
			throw new Error((firstError && firstError.message) || "创建讨论失败");
		}

		// 站内留痕：谁提的只存自己库里，GitHub 那边仍是 bot 匿名
		const submitter = await resolveSubmitter(req);
		const recorded = await recordSubmission({
			number: discussion.number,
			submitter,
			kind: type,
			title,
			page: clip(raw?.page, 300) || "",
		});

		return json({
			success: true,
			url: discussion.url,
			number: discussion.number,
			type,
			category: discussion.category ? discussion.category.name : category.name,
			// 说明是否因为缺分类而降级
			degraded: !rc.byType[type],
			// 作者身份：app = 站点代发（bot），pat = 维护者本人
			identity: { mode: ident.mode, bot: ident.botName },
			// 站内关联：登录用户提交时会记下用户名；游客为 null
			submitter: submitter ? { loggedIn: true, username: submitter.username } : { loggedIn: false, username: null },
			linked: recorded,
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
	if (/rate limit/i.test(message)) return "GitHub 接口限流，请稍后再试";
	return message;
}
