/**
 * Unit tests for ApiKeyManager service.
 * Tests API key CRUD operations, validation, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiKeyManager, createApiKeyManager } from '@/services/api-key-manager';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import bcrypt from 'bcrypt';

describe('ApiKeyManager', () => {
  let apiKeyManager: ApiKeyManager;
  let tempDir: string;
  let keysPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `apikey-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    keysPath = join(tempDir, 'api-keys.json');
    apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('should create an ApiKeyManager instance', () => {
      expect(apiKeyManager).toBeInstanceOf(ApiKeyManager);
    });

    it('should accept custom configuration', () => {
      const manager = createApiKeyManager({ apiKeysPath: '/custom/keys.json' });
      expect(manager).toBeInstanceOf(ApiKeyManager);
      expect(manager.getStoragePath()).toBe('/custom/keys.json');
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await apiKeyManager.initialize();
      expect(apiKeyManager.isInitialized()).toBe(true);
    });

    it('should start with empty keys when no storage file exists', async () => {
      await apiKeyManager.initialize();
      expect(apiKeyManager.getAllKeys()).toHaveLength(0);
    });

    it('should load existing keys from storage file', async () => {
      // Create a key first to get a valid hash
      const hashedKey = await bcrypt.hash('cpg_test12345678901234567890123456', 12);

      // Write existing keys file
      const existingKeys = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        keys: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Test Key',
            keyHash: hashedKey,
            prefix: 'test1234',
            status: 'active',
            createdAt: new Date().toISOString(),
          },
        ],
      };

      await writeFile(keysPath, JSON.stringify(existingKeys), 'utf-8');

      // Create new manager and initialize
      const newManager = createApiKeyManager({ apiKeysPath: keysPath });
      await newManager.initialize();

      const keys = newManager.getAllKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]?.name).toBe('Test Key');
      expect(keys[0]?.prefix).toBe('test1234');
    });
  });

  describe('createKey', () => {
    beforeEach(async () => {
      await apiKeyManager.initialize();
    });

    it('should create a new API key', async () => {
      const result = await apiKeyManager.createKey({ name: 'My Test Key' });

      expect(result.plaintextKey).toMatch(/^cpg_[a-zA-Z0-9]{32}$/);
      expect(result.key.name).toBe('My Test Key');
      expect(result.key.status).toBe('active');
      expect(result.key.id).toBeDefined();
      expect(result.key.prefix).toHaveLength(8);
    });

    it('should store the key in memory', async () => {
      const result = await apiKeyManager.createKey({ name: 'Stored Key' });

      const stored = apiKeyManager.getKeyById(result.key.id);
      expect(stored).toBeDefined();
      expect(stored?.name).toBe('Stored Key');
    });

    it('should persist keys to storage file', async () => {
      await apiKeyManager.createKey({ name: 'Persisted Key' });

      // Verify file was created
      expect(existsSync(keysPath)).toBe(true);

      // Verify content
      const content = await readFile(keysPath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].name).toBe('Persisted Key');
    });

    it('should create key with expiration date', async () => {
      const expiresAt = new Date('2026-12-31');
      const result = await apiKeyManager.createKey({ name: 'Expiring Key', expiresAt });

      expect(result.key.expiresAt).toEqual(expiresAt);
    });

    it('should generate unique IDs', async () => {
      const result1 = await apiKeyManager.createKey({ name: 'Key 1' });
      const result2 = await apiKeyManager.createKey({ name: 'Key 2' });

      expect(result1.key.id).not.toBe(result2.key.id);
    });

    it('should generate unique prefixes', async () => {
      // Generate multiple keys and check prefix uniqueness
      const prefixes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const result = await apiKeyManager.createKey({ name: `Key ${i}` });
        prefixes.add(result.key.prefix);
      }
      expect(prefixes.size).toBe(10);
    });
  });

  describe('validateKey', () => {
    let validKey: string;
    let keyId: string;

    beforeEach(async () => {
      await apiKeyManager.initialize();
      const result = await apiKeyManager.createKey({ name: 'Valid Key' });
      validKey = result.plaintextKey;
      keyId = result.key.id;
    });

    it('should validate a correct API key', async () => {
      const key = await apiKeyManager.validateKey(validKey);
      expect(key).toBeDefined();
      expect(key?.id).toBe(keyId);
      expect(key?.status).toBe('active');
    });

    it('should return null for invalid key format', async () => {
      const key = await apiKeyManager.validateKey('invalid-key');
      expect(key).toBeNull();
    });

    it('should return null for non-existent key', async () => {
      const key = await apiKeyManager.validateKey('cpg_nonexistent12345678901234567890');
      expect(key).toBeNull();
    });

    it('should return null for wrong key value (same prefix)', async () => {
      // Create another key with different value
      const result2 = await apiKeyManager.createKey({ name: 'Another Key' });

      // Try to validate with wrong key
      const key = await apiKeyManager.validateKey(result2.plaintextKey + 'x');
      expect(key).toBeNull();
    });

    it('should update lastUsedAt on successful validation', async () => {
      const before = new Date();
      await apiKeyManager.validateKey(validKey);
      const after = new Date();

      const stored = apiKeyManager.getKeyById(keyId);
      expect(stored?.lastUsedAt).toBeDefined();
      expect(stored?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
      expect(stored?.lastUsedAt?.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
    });
  });

  describe('validateKey with disabled key', () => {
    let validKey: string;
    let keyId: string;

    beforeEach(async () => {
      await apiKeyManager.initialize();
      const result = await apiKeyManager.createKey({ name: 'Test Key' });
      validKey = result.plaintextKey;
      keyId = result.key.id;
    });

    it('should return null for disabled key', async () => {
      // Disable the key
      await apiKeyManager.updateKeyStatus(keyId, 'disabled');

      const key = await apiKeyManager.validateKey(validKey);
      expect(key).toBeNull();
    });
  });

  describe('validateKey with expired key', () => {
    let validKey: string;

    beforeEach(async () => {
      await apiKeyManager.initialize();
      // Create key that expired yesterday
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);

      const result = await apiKeyManager.createKey({
        name: 'Expired Key',
        expiresAt: expiredDate,
      });
      validKey = result.plaintextKey;
    });

    it('should return null for expired key', async () => {
      const key = await apiKeyManager.validateKey(validKey);
      expect(key).toBeNull();
    });
  });

  describe('getKeyById', () => {
    beforeEach(async () => {
      await apiKeyManager.initialize();
    });

    it('should return key by ID', async () => {
      const result = await apiKeyManager.createKey({ name: 'Test Key' });
      const key = apiKeyManager.getKeyById(result.key.id);
      expect(key).toBeDefined();
      expect(key?.name).toBe('Test Key');
    });

    it('should return undefined for non-existent ID', () => {
      const key = apiKeyManager.getKeyById('non-existent-uuid');
      expect(key).toBeUndefined();
    });
  });

  describe('getKeyByPrefix', () => {
    beforeEach(async () => {
      await apiKeyManager.initialize();
    });

    it('should return key by prefix', async () => {
      const result = await apiKeyManager.createKey({ name: 'Test Key' });
      const key = apiKeyManager.getKeyByPrefix(result.key.prefix);
      expect(key).toBeDefined();
      expect(key?.name).toBe('Test Key');
    });

    it('should return undefined for non-existent prefix', () => {
      const key = apiKeyManager.getKeyByPrefix('nonexist');
      expect(key).toBeUndefined();
    });
  });

  describe('getAllKeys', () => {
    beforeEach(async () => {
      await apiKeyManager.initialize();
    });

    it('should return all keys', async () => {
      await apiKeyManager.createKey({ name: 'Key 1' });
      await apiKeyManager.createKey({ name: 'Key 2' });
      await apiKeyManager.createKey({ name: 'Key 3' });

      const keys = apiKeyManager.getAllKeys();
      expect(keys).toHaveLength(3);
    });

    it('should return empty array when no keys', async () => {
      const keys = apiKeyManager.getAllKeys();
      expect(keys).toHaveLength(0);
    });
  });

  describe('updateKeyStatus', () => {
    let keyId: string;

    beforeEach(async () => {
      await apiKeyManager.initialize();
      const result = await apiKeyManager.createKey({ name: 'Test Key' });
      keyId = result.key.id;
    });

    it('should update key status to disabled', async () => {
      const updated = await apiKeyManager.updateKeyStatus(keyId, 'disabled');
      expect(updated).toBe(true);

      const key = apiKeyManager.getKeyById(keyId);
      expect(key?.status).toBe('disabled');
    });

    it('should update key status to active', async () => {
      await apiKeyManager.updateKeyStatus(keyId, 'disabled');
      const updated = await apiKeyManager.updateKeyStatus(keyId, 'active');
      expect(updated).toBe(true);

      const key = apiKeyManager.getKeyById(keyId);
      expect(key?.status).toBe('active');
    });

    it('should return false for non-existent key', async () => {
      const updated = await apiKeyManager.updateKeyStatus('non-existent-id', 'disabled');
      expect(updated).toBe(false);
    });

    it('should persist status change', async () => {
      await apiKeyManager.updateKeyStatus(keyId, 'disabled');

      // Reload from storage
      const newManager = createApiKeyManager({ apiKeysPath: keysPath });
      await newManager.initialize();

      const key = newManager.getKeyById(keyId);
      expect(key?.status).toBe('disabled');
    });
  });

  describe('deleteKey', () => {
    let keyId: string;

    beforeEach(async () => {
      await apiKeyManager.initialize();
      const result = await apiKeyManager.createKey({ name: 'Test Key' });
      keyId = result.key.id;
    });

    it('should delete a key', async () => {
      const deleted = await apiKeyManager.deleteKey(keyId);
      expect(deleted).toBe(true);

      const key = apiKeyManager.getKeyById(keyId);
      expect(key).toBeUndefined();
    });

    it('should return false for non-existent key', async () => {
      const deleted = await apiKeyManager.deleteKey('non-existent-id');
      expect(deleted).toBe(false);
    });

    it('should persist deletion', async () => {
      await apiKeyManager.deleteKey(keyId);

      // Reload from storage
      const newManager = createApiKeyManager({ apiKeysPath: keysPath });
      await newManager.initialize();

      const key = newManager.getKeyById(keyId);
      expect(key).toBeUndefined();
    });
  });

  describe('persistKeys', () => {
    beforeEach(async () => {
      await apiKeyManager.initialize();
    });

    it('should create storage file with correct format', async () => {
      await apiKeyManager.createKey({ name: 'Test Key' });
      await apiKeyManager.persistKeys();

      const content = await readFile(keysPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.version).toBe('1.0');
      expect(data.lastUpdated).toBeDefined();
      expect(Array.isArray(data.keys)).toBe(true);
    });

    it('should handle multiple keys', async () => {
      await apiKeyManager.createKey({ name: 'Key 1' });
      await apiKeyManager.createKey({ name: 'Key 2' });
      await apiKeyManager.persistKeys();

      const content = await readFile(keysPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.keys).toHaveLength(2);
    });
  });
});

describe('createApiKeyManager', () => {
  it('should create an ApiKeyManager instance', () => {
    const manager = createApiKeyManager();
    expect(manager).toBeInstanceOf(ApiKeyManager);
  });

  it('should accept custom configuration', () => {
    const manager = createApiKeyManager({ apiKeysPath: '/custom/path.json' });
    expect(manager).toBeInstanceOf(ApiKeyManager);
  });
});