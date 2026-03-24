/**
 * API Key generation utilities.
 * Provides cryptographic key generation and prefix extraction.
 */

import { randomBytes } from 'crypto';
import { API_KEY_PREFIX, API_KEY_RANDOM_LENGTH } from '@/config/defaults';

/**
 * Characters used for generating the random portion of API keys.
 * Base62: alphanumeric characters (a-z, A-Z, 0-9).
 */
const BASE62_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a random alphanumeric string of specified length.
 *
 * @param length - The number of characters to generate
 * @returns A random alphanumeric string
 */
function generateRandomString(length: number): string {
  const bytes = randomBytes(length);
  const chars: string[] = [];
  const charsLength = BASE62_CHARS.length;

  for (let i = 0; i < length; i++) {
    const byteValue = bytes[i];
    if (byteValue !== undefined) {
      chars.push(BASE62_CHARS[byteValue % charsLength] as string);
    }
  }

  return chars.join('');
}

/**
 * Generates a new API key string.
 * Format: `cpg_` prefix + 32 random alphanumeric characters.
 *
 * @returns A new API key string (e.g., "cpg_abc123def456ghi789jkl012mno345pqr")
 *
 * @example
 * ```typescript
 * const apiKey = generateKeyString();
 * // Returns: "cpg_Kj9mN2pL5qR8sT1vW4xY7zA0bC3dE6fG"
 * ```
 */
export function generateKeyString(): string {
  const randomPortion = generateRandomString(API_KEY_RANDOM_LENGTH);
  return `${API_KEY_PREFIX}${randomPortion}`;
}

/**
 * Extracts the display prefix from an API key.
 * Returns the first 8 characters after the `cpg_` prefix.
 *
 * @param keyString - The full API key string
 * @returns The 8-character prefix for display, or empty string if invalid key format
 *
 * @example
 * ```typescript
 * const prefix = generateKeyPrefix('cpg_abc12345def678ghi901jkl234mno567pqr');
 * // Returns: "abc12345"
 *
 * const invalidPrefix = generateKeyPrefix('invalid-key');
 * // Returns: ""
 * ```
 */
export function generateKeyPrefix(keyString: string): string {
  // Validate key starts with expected prefix
  if (!keyString.startsWith(API_KEY_PREFIX)) {
    return '';
  }

  // Extract the portion after the prefix
  const afterPrefix = keyString.slice(API_KEY_PREFIX.length);

  // Return first 8 characters for display
  if (afterPrefix.length < 8) {
    return afterPrefix;
  }

  return afterPrefix.slice(0, 8);
}

/**
 * Validates that a key string has the correct format.
 *
 * @param keyString - The API key string to validate
 * @returns True if the key has valid format, false otherwise
 */
export function isValidKeyFormat(keyString: string): boolean {
  if (!keyString.startsWith(API_KEY_PREFIX)) {
    return false;
  }

  const afterPrefix = keyString.slice(API_KEY_PREFIX.length);

  // Check length matches expected
  if (afterPrefix.length !== API_KEY_RANDOM_LENGTH) {
    return false;
  }

  // Check all characters are alphanumeric
  return /^[a-zA-Z0-9]+$/.test(afterPrefix);
}