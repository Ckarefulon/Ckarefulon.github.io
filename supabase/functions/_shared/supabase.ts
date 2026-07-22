import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getAdminKey(): string {
	const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

	if (rawSecretKeys && rawSecretKeys.trim()) {
		const trimmedSecretKeys = rawSecretKeys.trim();

		try {
			const parsed: unknown = JSON.parse(trimmedSecretKeys);

			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const secretKeys = parsed as Record<string, unknown>;
				const defaultKey = secretKeys.default;

				if (typeof defaultKey === "string" && defaultKey.trim()) {
					return defaultKey.trim();
				}

				const firstKey = Object.values(secretKeys).find(
					(value): value is string => typeof value === "string" && Boolean(value.trim())
				);

				if (firstKey) {
					return firstKey.trim();
				}
			}
		} catch {
			return trimmedSecretKeys;
		}
	}

	return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

export function getServiceClient() {
	const url = Deno.env.get("SUPABASE_URL");
	const key = getAdminKey();
	if (!url || !key) {
		throw new Error("Supabase environment not configured");
	}
	return createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

export async function getUserFromRequest(req: Request): Promise<{ user: any | null; error: string | null }> {
	const authHeader = req.headers.get("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return { user: null, error: "未授权" };
	}
	const token = authHeader.substring(7);
	if (!token) {
		return { user: null, error: "无效令牌" };
	}

	const client = getServiceClient();
	try {
		const { data, error } = await client.auth.getUser(token);
		if (error || !data.user) {
			return { user: null, error: "登录已过期" };
		}
		return { user: data.user, error: null };
	} catch {
		return { user: null, error: "认证失败" };
	}
}
