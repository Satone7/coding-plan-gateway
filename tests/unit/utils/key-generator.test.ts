/**
 * Unit tests for API key generation utilities.
 * @see src/utils/key-generator.ts
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeyString,
  generateKeyPrefix,
  isValidKeyFormat,
} from '@/utils/key-generator';
import { API_KEY_PREFIX, API_KEY_RANDOM_LENGTH } from '@/config/defaults';

describe('key-generator utilities', () => {
  describe('generateKeyString', () => {
    it('should generate a key with the correct prefix', () => {
      const key = generateKeyString();
      expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it('should generate a key with the correct total length', () => {
      const key = generateKeyString();
      const expectedLength = API_KEY_PREFIX.length + API_KEY_RANDOM_LENGTH;
      expect(key).toHaveLength(expectedLength);
    });

    it('should generate a key with alphanumeric random portion', () => {
      const key = generateKeyString();
      const randomPortion = key.slice(API_KEY_PREFIX.length);
      expect(/^[a-zA-Z0-9]+$/.test(randomPortion)).toBe(true);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateKeyString());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe('generateKeyPrefix', () => {
    it('should extract first 8 chars after prefix', () => {
      const key = 'cpg_abc12345def678ghi901jkl234mno567pqr';
      const prefix = generateKeyPrefix(key);
      expect(prefix).toBe('abc12345');
    });

    it('should return empty string for key without prefix', () => {
      const prefix = generateKeyPrefix('invalid-key');
      expect(prefix).toBe('');
    });

    it('should handle short random portion', () => {
      const key = 'cpg_abc';
      const prefix = generateKeyPrefix(key);
      expect(prefix).toBe('abc');
    });

    it('should handle exact 8 char random portion', () => {
      const key = 'cpg_12345678';
      const prefix = generateKeyPrefix(key);
      expect(prefix).toBe('12345678');
    });
  });

  describe('isValidKeyFormat', () => {
    it('should return true for valid key format', () => {
      const key = generateKeyString();
      expect(isValidKeyFormat(key)).toBe(true);
    });

    it('should return false for key without prefix', () => {
      expect(isValidKeyFormat('abc123def456ghi789jkl012mno345pqr')).toBe(false);
    });

    it('should return false for key with wrong prefix', () => {
      expect(isValidKeyFormat('xyz_abc123def456ghi789jkl012mno345pqr')).toBe(false);
    });

    it('should return false for key with wrong length', () => {
      expect(isValidKeyFormat('cpg_short')).toBe(false);
    });

    it('should return false for key with special characters', () => {
      expect(isValidKeyFormat('cpg_abc123def456ghi789jkl012mno345!@#')).toBe(false);
    });
  });
});