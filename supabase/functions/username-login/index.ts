import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

serve(async (req: Request) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	if (req.method !== "POST") {
		return new Response(
			JSON.stringify({ success: false, message: "Method not allowed" }),
			{ status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	const supabaseUrl = Deno.env.get("SUPABASE_URL");
	const adminKey = getAdminKey();

	if (!supabaseUrl || !adminKey) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	let body: { username?: string; password?: string };
	try {
		body = await req.json();
	} catch {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	const username = (body.username || "").trim();
	const password = body.password || "";

	if (!password) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	if (typeof username !== "string" || username !== username.trim()) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	if (username.length < 2 || username.length > 32) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	if (username.indexOf("@") >= 0) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	if (!/^[A-Za-z0-9._ -]+$/.test(username)) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	const adminClient = createClient(supabaseUrl, adminKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const profileResult = await adminClient
		.from("user_profiles")
		.select("user_id")
		.eq("username", username)
		.maybeSingle();

	if (profileResult.error || !profileResult.data || !profileResult.data.user_id) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	const userId = profileResult.data.user_id;

	const { data: userData, error: getUserError } = await adminClient.auth.admin.getUserById(userId);

	if (getUserError || !userData.user || !userData.user.email) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	const email = userData.user.email;

	const signInResult = await adminClient.auth.signInWithPassword({
		email: email,
		password: password,
	});

	if (signInResult.error || !signInResult.data.session) {
		return new Response(
			JSON.stringify({ success: false, message: "账号或密码错误" }),
			{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
		);
	}

	const session = signInResult.data.session;

	return new Response(
		JSON.stringify({
			success: true,
			message: "登录成功",
			session: {
				access_token: session.access_token,
				refresh_token: session.refresh_token,
				expires_at: session.expires_at,
				expires_in: session.expires_in,
				token_type: session.token_type,
			},
		}),
		{ status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
	);
});
