export interface HttpParam {
	key: string;
	value: string;
	sensitive?: boolean;
}

export type HttpMethod = "GET" | "POST";
export type HttpBodyType = "none" | "json" | "form";

export interface HttpMatchRule {
	type: "status_code" | "status_range" | "text_contains" | "json_equals";
	statusCode?: number;
	text?: string;
	jsonPath?: string;
	jsonValue?: string | number | boolean;
}

export interface CustomHttpConfig {
	url: string;
	method: HttpMethod;
	bodyType: HttpBodyType;
	queryParams: HttpParam[];
	headers: HttpParam[];
	bodyFields: HttpParam[];
	successRules: HttpMatchRule[];
	alreadyCheckedInRules: HttpMatchRule[];
	authFailureRules: HttpMatchRule[];
}

export interface SanitizedResponseInfo {
	status: number;
	statusText: string;
	contentType: string | null;
	contentLength: number;
	bodyPreview: string;
}
