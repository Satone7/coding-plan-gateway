/**
 * Encryption utilities using AES-256-GCM.
 * Provides secure encryption/decryption for API keys stored at rest.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Algorithm used for encryption (AES-256-GCM).
 * GCM provides authenticated encryption with associated data (AEAD).
 */
const ALGORITHM = 'aes-256-gcm';

/**
 * IV length in bytes (12 bytes recommended for GCM).
 */
const IV_LENGTH = 12;

/**
 * Auth tag length in bytes (16 bytes = 128 bits).
 */
const AUTH_TAG_LENGTH = 16;

/**
 * Key length in bytes (32 bytes = 256 bits).
 */
const KEY_LENGTH = 32;

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The text to encrypt
 * @param key - Encryption key (hex string, must be 64 characters)
 * @returns Encrypted data in format: iv:authTag:ciphertext (all hex encoded)
 *
 * @example
 * ```typescript
 * const encrypted = encrypt('my-api-key', '0123456789abcdef...');
 * // Returns: 'iv_in_hex:auth_tag_in_hex:ciphertext_in_hex'
 * ```
 */
export function encrypt(plaintext: string, key: string): string {
  const keyBuffer = validateAndParseKey(key);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt data encrypted with AES-256-GCM.
 *
 * @param encryptedData - The encrypted data in format: iv:authTag:ciphertext
 * @param key - Decryption key (hex string, must be 64 characters)
 * @returns The decrypted plaintext
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 *
 * @example
 * ```typescript
 * const decrypted = decrypt('iv:authTag:ciphertext', '0123456789abcdef...');
 * // Returns: 'my-api-key'
 * ```
 */
export function decrypt(encryptedData: string, key: string): string {
  const keyBuffer = validateAndParseKey(key);

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex = '', authTagHex = '', ciphertextHex = ''] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error('Decryption failed: authentication tag verification failed');
  }
}

/**
 * Generate a new encryption key.
 * Use this to create a key for the ENCRYPTION_KEY environment variable.
 *
 * @returns A 32-byte key encoded as a hex string (64 characters)
 *
 * @example
 * ```typescript
 * const key = generateEncryptionKey();
 * console.log(key); // 64 character hex string
 * ```
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Hash a value using SHA-256.
 * Useful for creating deterministic identifiers or one-way hashes.
 *
 * @param value - The value to hash
 * @returns SHA-256 hash as hex string
 */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Validate and parse an encryption key.
 *
 * @param key - The key to validate (hex string)
 * @returns Buffer containing the key bytes
 * @throws Error if key is invalid
 */
function validateAndParseKey(key: string): Buffer {
  if (!key || typeof key !== 'string') {
    throw new Error('Encryption key is required');
  }

  if (key.length !== 64) {
    throw new Error(`Encryption key must be 64 hex characters, got ${key.length}`);
  }

  if (!/^[0-9a-fA-F]+$/.test(key)) {
    throw new Error('Encryption key must be a valid hex string');
  }

  return Buffer.from(key, 'hex');
}

/**
 * Check if a string appears to be encrypted (has our format).
 *
 * @param value - The value to check
 * @returns True if the value appears to be encrypted
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;

  const iv = parts[0] ?? '';
  const authTag = parts[1] ?? '';
  const ciphertext = parts[2] ?? '';
  return (
    /^[0-9a-fA-F]{24}$/.test(iv) &&      // 12 bytes = 24 hex chars
    /^[0-9a-fA-F]{32}$/.test(authTag) && // 16 bytes = 32 hex chars
    /^[0-9a-fA-F]+$/.test(ciphertext)    // Variable length
  );
}

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}