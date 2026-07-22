export const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

export function handleCors(req: Request): Response | null {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}
	return null;
}

export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, "Content-Type": "application/json" },
	});
}

export function errorResponse(message: string, status = 400, code?: string): Response {
	return jsonResponse({ success: false, message, error: code || null }, status);
}

export function successResponse(data: Record<string, unknown> = {}): Response {
	return jsonResponse({ success: true, ...data });
}
