import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceDefinitions } from "../_shared/adapters/index.ts";

serve(async (req: Request) => {
	const corsRes = handleCors(req);
	if (corsRes) return corsRes;

	try {
		const services = getServiceDefinitions();
		return jsonResponse({ success: true, services });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "服务器错误";
		return errorResponse(message, 500);
	}
});
