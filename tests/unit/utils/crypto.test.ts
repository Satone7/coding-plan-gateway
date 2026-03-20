/**
 * Unit tests for encryption utilities.
 * @see src/utils/crypto.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  encrypt,
  decrypt,
  generateEncryptionKey,
  hash,
  isEncrypted,
  constantTimeCompare,
} from '@/utils/crypto';

describe('crypto utilities', () => {
  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex string', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-fA-F]+$/.test(key)).toBe(true);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('encrypt and decrypt', () => {
    let encryptionKey: string;

    beforeEach(() => {
      encryptionKey = generateEncryptionKey();
    });

    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = 'my-secret-api-key-12345';
      const encrypted = encrypt(plaintext, encryptionKey);
      const decrypted = decrypt(encrypted, encryptionKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const plaintext = 'my-secret-api-key';
      const encrypted1 = encrypt(plaintext, encryptionKey);
      const encrypted2 = encrypt(plaintext, encryptionKey);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce ciphertext in correct format', () => {
      const plaintext = 'test-data';
      const encrypted = encrypt(plaintext, encryptionKey);
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toHaveLength(24); // IV (12 bytes = 24 hex chars)
      expect(parts[1]).toHaveLength(32); // Auth tag (16 bytes = 32 hex chars)
    });

    it('should throw error for invalid key length', () => {
      const plaintext = 'test';
      const invalidKey = 'short';
      expect(() => encrypt(plaintext, invalidKey)).toThrow('Encryption key must be 64 hex characters');
    });

    it('should throw error for non-hex key', () => {
      const plaintext = 'test';
      const invalidKey = 'g'.repeat(64);
      expect(() => encrypt(plaintext, invalidKey)).toThrow('Encryption key must be a valid hex string');
    });

    it('should throw error for empty key', () => {
      const plaintext = 'test';
      expect(() => encrypt(plaintext, '')).toThrow('Encryption key is required');
    });

    it('should throw error for invalid encrypted data format', () => {
      expect(() => decrypt('invalid-format', encryptionKey)).toThrow('Invalid encrypted data format');
    });

    it('should throw error for wrong key', () => {
      const plaintext = 'test-data';
      const encrypted = encrypt(plaintext, encryptionKey);
      const wrongKey = generateEncryptionKey();
      expect(() => decrypt(encrypted, wrongKey)).toThrow('Decryption failed');
    });

    it('should handle unicode characters', () => {
      const plaintext = '你好世界 🌍 emoji test';
      const encrypted = encrypt(plaintext, encryptionKey);
      const decrypted = decrypt(encrypted, encryptionKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encrypt(plaintext, encryptionKey);
      const decrypted = decrypt(encrypted, encryptionKey);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('hash', () => {
    it('should produce consistent hash for same input', () => {
      const value = 'test-value';
      const hash1 = hash(value);
      const hash2 = hash(value);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hash('value1');
      const hash2 = hash('value2');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64-character hex string', () => {
      const result = hash('test');
      expect(result).toHaveLength(64);
      expect(/^[0-9a-fA-F]+$/.test(result)).toBe(true);
    });
  });

  describe('isEncrypted', () => {
    let encryptionKey: string;

    beforeEach(() => {
      encryptionKey = generateEncryptionKey();
    });

    it('should return true for encrypted values', () => {
      const encrypted = encrypt('test', encryptionKey);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext values', () => {
      expect(isEncrypted('plaintext-value')).toBe(false);
    });

    it('should return false for invalid format', () => {
      expect(isEncrypted('not:encrypted:data')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isEncrypted('')).toBe(false);
    });
  });

  describe('constantTimeCompare', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeCompare('abc', 'def')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(constantTimeCompare('abc', 'abcd')).toBe(false);
    });

    it('should return false for empty strings', () => {
      expect(constantTimeCompare('', '')).toBe(true);
    });
  });
});