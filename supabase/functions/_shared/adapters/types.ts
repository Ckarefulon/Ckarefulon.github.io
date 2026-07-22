export interface ValidationResult {
	valid: boolean;
	errors?: string[];
}

export interface CheckinContext {
	credentials: Record<string, string>;
	publicConfig: Record<string, unknown>;
	targetId: string;
	userId: string;
	attempt: number;
	scheduledFor?: string;
}

export interface CheckinResult {
	success: boolean;
	alreadyCheckedIn?: boolean;
	summary: string;
	errorCode?: string;
	errorMessage?: string;
	retryable?: boolean;
	requiresReauth?: boolean;
	sanitizedResponse?: string;
}

export interface CredentialField {
	key: string;
	label: string;
	type: "text" | "password" | "textarea" | "checkbox";
	placeholder?: string;
	required: boolean;
	helpText?: string;
}

export interface PublicConfigField {
	key: string;
	label: string;
	type: "text" | "select" | "number" | "checkbox";
	placeholder?: string;
	defaultValue?: unknown;
	options?: { value: string; label: string }[];
	required?: boolean;
	helpText?: string;
}

export interface CheckinAdapter {
	serviceKey: string;
	serviceName: string;
	description: string;
	credentialFields: CredentialField[];
	publicConfigFields: PublicConfigField[];
	validateConfig(credentials: Record<string, string>, publicConfig: Record<string, unknown>): Promise<ValidationResult>;
	checkin(context: CheckinContext): Promise<CheckinResult>;
}
