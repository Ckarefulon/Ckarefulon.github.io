const ENCRYPTION_ALGORITHM = "AES-GCM";
const KEY_DERIVATION_ALGORITHM = "PBKDF2";
const KEY_LENGTH = 256;
const ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENCODER = new TextEncoder();

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

function getMasterKey(): Uint8Array {
	const key = Deno.env.get("PULSE_ENCRYPTION_KEY") || getAdminKey();
	if (!key) {
		throw new Error("Encryption key not configured");
	}
	return ENCODER.encode(key);
}

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
	const masterKey = getMasterKey();
	const baseKey = await crypto.subtle.importKey(
		"raw",
		masterKey,
		{ name: KEY_DERIVATION_ALGORITHM },
		false,
		["deriveKey"]
	);
	return crypto.subtle.deriveKey(
		{
			name: KEY_DERIVATION_ALGORITHM,
			salt: salt,
			iterations: ITERATIONS,
			hash: "SHA-256",
		},
		baseKey,
		{ name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
		false,
		["encrypt", "decrypt"]
	);
}

export interface EncryptedBlob {
	salt: string;
	iv: string;
	data: string;
}

export async function encryptCredentials(plaintext: string): Promise<EncryptedBlob> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(salt);

	const encrypted = await crypto.subtle.encrypt(
		{ name: ENCRYPTION_ALGORITHM, iv: iv, tagLength: TAG_LENGTH * 8 },
		key,
		ENCODER.encode(plaintext)
	);

	return {
		salt: bufferToBase64(salt),
		iv: bufferToBase64(iv),
		data: bufferToBase64(encrypted),
	};
}

export async function decryptCredentials(blob: EncryptedBlob): Promise<string> {
	const salt = base64ToBuffer(blob.salt);
	const iv = base64ToBuffer(blob.iv);
	const data = base64ToBuffer(blob.data);
	const key = await deriveKey(salt);

	try {
		const decrypted = await crypto.subtle.decrypt(
			{ name: ENCRYPTION_ALGORITHM, iv: iv, tagLength: TAG_LENGTH * 8 },
			key,
			data
		);
		return new TextDecoder().decode(decrypted);
	} catch {
		throw new Error("Failed to decrypt credentials");
	}
}

export function serializeEncryptedBlob(blob: EncryptedBlob): Uint8Array {
	const json = JSON.stringify(blob);
	return ENCODER.encode(json);
}

export function deserializeEncryptedBlob(bytes: Uint8Array): EncryptedBlob {
	const json = new TextDecoder().decode(bytes);
	return JSON.parse(json);
}

export function sanitizeForLog(value: string, maxLen = 100): string {
	if (!value) return "";
	if (value.length <= 8) return "***";
	return value.substring(0, 3) + "***" + value.substring(value.length - 3);
}
