export interface HttpParam {
	key: string;
	value: string;
	sensitive?: boolean;
}

export type HttpMethod = "GET" | "POST";
export type HttpBodyType = "none" | "json" | "form";

export interface HttpMatchRule {
	type: "status_code" | "status_range" | "text_contains" | "json_equals" | "text_not_contains";
	statusCode?: number;
	text?: string;
	jsonPath?: string;
	jsonValue?: string | number | boolean;
}

export interface PreRequestConfig {
	enabled: boolean;
	url?: string;
	method?: HttpMethod;
	includeCookies?: boolean;
	extraHeaders?: HttpParam[];
}

export interface RegexExtractRule {
	variableName: string;
	pattern: string;
	flags?: string;
	groupIndex?: number;
}

export interface BrowserEmulationConfig {
	enabled: boolean;
	userAgent?: string;
	referer?: string;
	origin?: string;
	acceptLanguage?: string;
	xRequestedWith?: boolean;
	accept?: string;
	cacheControl?: string;
	pragma?: string;
	secChUa?: string;
	secChUaMobile?: string;
	secChUaPlatform?: string;
	secFetchDest?: string;
	secFetchMode?: string;
	secFetchSite?: string;
	secFetchUser?: string;
	upgradeInsecureRequests?: string;
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
	failureRules?: HttpMatchRule[];
	preRequest?: PreRequestConfig;
	extractRules?: RegexExtractRule[];
	browserEmulation?: BrowserEmulationConfig;
	nonceInvalidKeywords?: string[];
	retryConfig?: {
		maxRetries?: number;
		initialDelayMs?: number;
		backoffMultiplier?: number;
	};
}

export interface SanitizedResponseInfo {
	status: number;
	statusText: string;
	contentType: string | null;
	contentLength: number;
	bodyPreview: string;
}
