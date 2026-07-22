const BLOCKED_SCHEMES = new Set(["http:", "file:", "ftp:", "data:", "javascript:", "ws:", "wss:"]);
const ALLOWED_PORT = 443;

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"localhost.localdomain",
]);

const BLOCKED_TLD_SUFFIXES = [".local", ".internal", ".localhost"];

const BLOCKED_IPV4_NETWORKS: Array<{ network: number; mask: number }> = [
	{ network: ip4ToNumber("127.0.0.0"), mask: 8 },
	{ network: ip4ToNumber("0.0.0.0"), mask: 8 },
	{ network: ip4ToNumber("10.0.0.0"), mask: 8 },
	{ network: ip4ToNumber("172.16.0.0"), mask: 12 },
	{ network: ip4ToNumber("192.168.0.0"), mask: 16 },
	{ network: ip4ToNumber("169.254.0.0"), mask: 16 },
];

const METADATA_IPV4 = [
	"169.254.169.254",
];

function ip4ToNumber(ip: string): number {
	const parts = ip.split(".").map(Number);
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
	if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
	const num = ip4ToNumber(ip);
	if (num === 0) return true;

	for (const { network, mask } of BLOCKED_IPV4_NETWORKS) {
		const shifted = 32 - mask;
		if ((num >>> shifted) === (network >>> shifted)) {
			return true;
		}
	}

	if (METADATA_IPV4.includes(ip)) return true;

	return false;
}

function isPrivateIPv6(ip: string): boolean {
	const lower = ip.toLowerCase();

	// Loopback
	if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;

	// IPv4-mapped loopback
	if (lower.endsWith("::ffff:127.0.0.1")) return true;

	// Link-local
	if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true;

	// Unique local addresses (fc00::/7)
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

	// Loopback compressed forms
	if (/^::1?$/.test(lower)) return true;

	// IPv4-mapped any address
	if (lower.endsWith("::ffff:0.0.0.0")) return true;

	return false;
}

function isBlockedHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();

	if (BLOCKED_HOSTNAMES.has(lower)) return true;

	for (const suffix of BLOCKED_TLD_SUFFIXES) {
		if (lower === suffix.substring(1) || lower.endsWith(suffix)) {
			return true;
		}
	}

	return false;
}

export interface UrlValidationResult {
	valid: boolean;
	error?: string;
	url?: URL;
}

function hasUserinfo(url: URL): boolean {
	return !!(url.username || url.password);
}

function validateUrlStructure(urlString: string): UrlValidationResult {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		return { valid: false, error: "无效的 URL 格式" };
	}

	if (BLOCKED_SCHEMES.has(url.protocol)) {
		return { valid: false, error: `不允许使用协议 ${url.protocol}` };
	}

	if (url.protocol !== "https:") {
		return { valid: false, error: "只允许使用 HTTPS 协议" };
	}

	const port = url.port ? Number(url.port) : 443;
	if (port !== ALLOWED_PORT) {
		return { valid: false, error: "只允许使用标准 HTTPS 端口 443" };
	}

	if (hasUserinfo(url)) {
		return { valid: false, error: "URL 中不允许包含用户名和密码" };
	}

	const hostname = url.hostname;
	if (!hostname) {
		return { valid: false, error: "URL 缺少主机名" };
	}

	if (isBlockedHostname(hostname)) {
		return { valid: false, error: "该域名不允许访问" };
	}

	// IPv4 literal
	if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
		if (isPrivateIPv4(hostname)) {
			return { valid: false, error: "不允许访问内网 IPv4 地址" };
		}
		return { valid: true, url };
	}

	// IPv6 literal
	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		const ipv6 = hostname.slice(1, -1);
		if (isPrivateIPv6(ipv6)) {
			return { valid: false, error: "不允许访问内网 IPv6 地址" };
		}
		return { valid: true, url };
	}

	return { valid: true, url };
}

export async function validateUrl(urlString: string): Promise<UrlValidationResult> {
	const structural = validateUrlStructure(urlString);
	if (!structural.valid || !structural.url) {
		return structural;
	}

	const hostname = structural.url.hostname;

	// 纯 IP 地址不需要 DNS 解析
	if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
		if (isPrivateIPv4(hostname)) {
			return { valid: false, error: "不允许访问内网 IPv4 地址" };
		}
		return { valid: true, url: structural.url };
	}

	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		const ipv6 = hostname.slice(1, -1);
		if (isPrivateIPv6(ipv6)) {
			return { valid: false, error: "不允许访问内网 IPv6 地址" };
		}
		return { valid: true, url: structural.url };
	}

	// 解析域名并检查所有解析结果
	let records: string[] = [];
	try {
		records = await Deno.resolveDns(hostname, "A");
	} catch {
		records = [];
	}

	let aaaaRecords: string[] = [];
	try {
		aaaaRecords = await Deno.resolveDns(hostname, "AAAA");
	} catch {
		aaaaRecords = [];
	}

	const allIps = [...records, ...aaaaRecords];

	if (allIps.length === 0) {
		return { valid: false, error: "无法解析该域名" };
	}

	for (const ip of allIps) {
		if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
			if (isPrivateIPv4(ip)) {
				return { valid: false, error: "域名解析到不允许的 IPv4 地址" };
			}
		} else if (isPrivateIPv6(ip)) {
			return { valid: false, error: "域名解析到不允许的 IPv6 地址" };
		}
	}

	return { valid: true, url: structural.url };
}

export async function validateRedirectUrl(
	originalUrl: URL,
	redirectUrlString: string
): Promise<UrlValidationResult> {
	const result = await validateUrl(redirectUrlString);
	if (!result.valid || !result.url) {
		return result;
	}

	if (result.url.hostname.toLowerCase() !== originalUrl.hostname.toLowerCase()) {
		return { valid: false, error: "不允许重定向到不同的域名" };
	}

	return result;
}
