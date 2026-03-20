/**
 * API key encryption module.
 * Handles encryption/decryption of API keys in configuration.
 */

import { encrypt, decrypt, isEncrypted } from '@/utils/crypto';

/**
 * Prefix for encrypted values in configuration.
 */
const ENCRYPTED_PREFIX = 'enc:';

/**
 * Encrypt an API key for storage.
 *
 * @param apiKey - The plaintext API key
 * @param encryptionKey - The encryption key (hex string)
 * @returns The encrypted API key with prefix
 */
export function encryptApiKey(apiKey: string, encryptionKey: string): string {
  const encrypted = encrypt(apiKey, encryptionKey);
  return `${ENCRYPTED_PREFIX}${encrypted}`;
}

/**
 * Decrypt an API key from storage.
 *
 * @param encryptedApiKey - The encrypted API key (with or without prefix)
 * @param encryptionKey - The encryption key (hex string)
 * @returns The plaintext API key
 */
export function decryptApiKey(encryptedApiKey: string, encryptionKey: string): string {
  // Remove prefix if present
  const encrypted = encryptedApiKey.startsWith(ENCRYPTED_PREFIX)
    ? encryptedApiKey.slice(ENCRYPTED_PREFIX.length)
    : encryptedApiKey;

  return decrypt(encrypted, encryptionKey);
}

/**
 * Check if an API key value is encrypted.
 *
 * @param value - The value to check
 * @returns True if the value appears to be encrypted
 */
export function isApiKeyEncrypted(value: string): boolean {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return false;
  }
  const encrypted = value.slice(ENCRYPTED_PREFIX.length);
  return isEncrypted(encrypted);
}

/**
 * Ensure an API key is encrypted.
 * If already encrypted, returns as-is.
 * If plaintext, encrypts it.
 *
 * @param apiKey - The API key (plaintext or already encrypted)
 * @param encryptionKey - The encryption key (hex string)
 * @returns The encrypted API key with prefix
 */
export function ensureEncrypted(apiKey: string, encryptionKey: string): string {
  if (isApiKeyEncrypted(apiKey)) {
    return apiKey;
  }
  return encryptApiKey(apiKey, encryptionKey);
}

/**
 * Mask an API key for logging/display.
 * Shows only the first 4 and last 4 characters.
 *
 * @param apiKey - The API key to mask
 * @returns The masked API key
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) {
    return '***';
  }
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}...${end}`;
}

/**
 * Process configuration to encrypt all API keys.
 *
 * @param config - The configuration object with plans
 * @param encryptionKey - The encryption key (hex string)
 * @returns The configuration with encrypted API keys
 */
export function encryptConfigApiKeys(
  config: { plans: Array<{ apiKey: string }> },
  encryptionKey: string
): void {
  for (const plan of config.plans) {
    if (!isApiKeyEncrypted(plan.apiKey)) {
      plan.apiKey = encryptApiKey(plan.apiKey, encryptionKey);
    }
  }
}

/**
 * Process configuration to decrypt all API keys.
 *
 * @param config - The configuration object with plans
 * @param encryptionKey - The encryption key (hex string)
 * @returns The configuration with decrypted API keys (new object)
 */
export function decryptConfigApiKeys(
  config: { plans: Array<{ apiKey: string; apiKeyEncrypted?: string }> },
  encryptionKey: string
): Array<{ apiKey: string }> {
  return config.plans.map((plan) => ({
    ...plan,
    apiKey: isApiKeyEncrypted(plan.apiKey)
      ? decryptApiKey(plan.apiKey, encryptionKey)
      : plan.apiKey,
  }));
}