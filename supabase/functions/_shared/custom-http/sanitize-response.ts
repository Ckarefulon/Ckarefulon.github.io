const SENSITIVE_KEYWORDS = [
	"cookie", "token", "authorization", "api-key", "apikey", "api_key",
	"password", "passwd", "secret", "private_key", "privatekey", "access_token",
	"refresh_token", "id_token", "session", "credential"
];

const SENSITIVE_PATTERNS = [
	/bearer\s+[a-zA-Z0-9_\-\.]+/gi,
	/basic\s+[a-zA-Z0-9+/=]+/gi,
	/([a-zA-Z0-9_\-]+token[a-zA-Z0-9_\-]*)\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]+)["']?/gi,
];

export function maskSensitiveValues(text: string): string {
	let masked = text;
	for (const pattern of SENSITIVE_PATTERNS) {
		masked = masked.replace(pattern, (match) => {
			if (match.length <= 8) return "***";
			return match.substring(0, 4) + "***" + match.substring(match.length - 4);
		});
	}
	return masked;
}

export function sanitizeHeaderValue(key: string, value: string): string {
	const lowerKey = key.toLowerCase();
	for (const kw of SENSITIVE_KEYWORDS) {
		if (lowerKey.includes(kw)) {
			if (value.length <= 8) return "***";
			return value.substring(0, 4) + "***" + value.substring(value.length - 4);
		}
	}
	return value;
}

export function sanitizeBodyPreview(bodyText: string, maxLen = 500): string {
	if (!bodyText) return "";
	let preview = bodyText;
	if (preview.length > maxLen) {
		preview = preview.substring(0, maxLen) + "…";
	}
	return maskSensitiveValues(preview);
}

export function sanitizeErrorMessage(message: string): string {
	return maskSensitiveValues(message).substring(0, 200);
}
