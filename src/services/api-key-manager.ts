/**
 * ApiKeyManager - Manages API key CRUD operations and validation.
 * Provides secure key generation, storage, and authentication.
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import type { ApiKey, ApiKeyStorage, CreateApiKeyInput, ApiKeyStatus } from '@/types';
import { apiKeyStorageSchema } from '@/types';
import { generateKeyString, generateKeyPrefix } from '@/utils/key-generator';
import { logger } from '@/utils/logger';
import { BCRYPT_COST_FACTOR, DEFAULT_AUTH_CONFIG } from '@/config/defaults';

/**
 * ApiKeyManager configuration.
 */
export interface ApiKeyManagerConfig {
  /** Path to API keys storage file */
  apiKeysPath?: string;
}

/**
 * Result of key creation containing the plaintext key and metadata.
 */
export interface CreateKeyResult {
  /** The plaintext API key (shown only once) */
  plaintextKey: string;
  /** The key metadata (stored in the system) */
  key: ApiKey;
}

/**
 * Validation result status.
 */
export type ValidationStatus = 'valid' | 'invalid' | 'disabled' | 'expired';

/**
 * Result of key validation.
 */
export interface ValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** Status indicating why validation passed/failed */
  status: ValidationStatus;
  /** The key metadata if found */
  key?: ApiKey;
}

/**
 * ApiKeyManager - Manages API keys for authentication.
 *
 * @example
 * ```typescript
 * const manager = createApiKeyManager({ apiKeysPath: './api-keys.json' });
 * await manager.initialize();
 *
 * // Create a new key
 * const { plaintextKey, key } = await manager.createKey({ name: 'My Key' });
 * console.log(`Created key: ${plaintextKey}`); // Show only once!
 *
 * // Validate a key
 * const validKey = await manager.validateKey(plaintextKey);
 * if (validKey) {
 *   console.log(`Key ${validKey.name} is valid`);
 * }
 * ```
 */
export class ApiKeyManager {
  private readonly apiKeysPath: string;
  private readonly keys: Map<string, ApiKey> = new Map();
  private readonly keysByPrefix: Map<string, ApiKey> = new Map();
  private initialized: boolean = false;

  /**
   * Create a new ApiKeyManager.
   *
   * @param config - Configuration options
   */
  constructor(config: ApiKeyManagerConfig = {}) {
    this.apiKeysPath = resolve(config.apiKeysPath ?? DEFAULT_AUTH_CONFIG.apiKeysPath);
  }

  /**
   * Initialize the manager by loading existing keys from storage.
   */
  async initialize(): Promise<void> {
    await this.loadKeys();
    this.initialized = true;
    logger.info('ApiKeyManager initialized', {
      keyCount: this.keys.size,
      storagePath: this.apiKeysPath,
    });
  }

  /**
   * Load keys from the storage file.
   */
  private async loadKeys(): Promise<void> {
    try {
      await access(this.apiKeysPath, constants.R_OK);
    } catch {
      // File doesn't exist, start with empty keys
      logger.debug('API keys file not found, starting with empty keys', {
        path: this.apiKeysPath,
      });
      return;
    }

    try {
      const content = await readFile(this.apiKeysPath, 'utf-8');
      const data = JSON.parse(content) as ApiKeyStorage;

      // Validate the storage format
      const parsed = apiKeyStorageSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn('Invalid API keys storage format, starting fresh', {
          errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
        return;
      }

      // Load keys into maps
      for (const key of parsed.data.keys) {
        this.keys.set(key.id, key);
        this.keysByPrefix.set(key.prefix, key);
      }

      logger.debug('Loaded API keys from storage', {
        keyCount: this.keys.size,
        lastUpdated: parsed.data.lastUpdated,
      });
    } catch (error) {
      logger.warn('Failed to load API keys from storage, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create a new API key.
   *
   * @param input - Key creation input (name, optional expiration)
   * @returns The plaintext key and key metadata
   */
  async createKey(input: CreateApiKeyInput): Promise<CreateKeyResult> {
    // Generate the key string
    const plaintextKey = generateKeyString();
    const prefix = generateKeyPrefix(plaintextKey);

    // Hash the key for storage
    const keyHash = await bcrypt.hash(plaintextKey, BCRYPT_COST_FACTOR);

    // Create the key metadata
    const key: ApiKey = {
      id: uuidv4(),
      name: input.name,
      keyHash,
      prefix,
      status: 'active',
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };

    // Store in memory
    this.keys.set(key.id, key);
    this.keysByPrefix.set(key.prefix, key);

    // Persist to storage
    await this.persistKeys();

    logger.info('Created new API key', {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
    });

    return { plaintextKey, key };
  }

  /**
   * Validate an API key.
   * Checks if the key exists, is active, and hasn't expired.
   *
   * @param plaintextKey - The plaintext API key to validate
   * @returns The key metadata if valid, null otherwise
   */
  async validateKey(plaintextKey: string): Promise<ApiKey | null> {
    const result = await this.validateKeyWithStatus(plaintextKey);
    return result.valid ? result.key ?? null : null;
  }

  /**
   * Validate an API key with detailed status.
   * Checks if the key exists, is active, and hasn't expired.
   *
   * @param plaintextKey - The plaintext API key to validate
   * @returns Detailed validation result with status
   */
  async validateKeyWithStatus(plaintextKey: string): Promise<ValidationResult> {
    // Extract prefix for fast lookup
    const prefix = generateKeyPrefix(plaintextKey);
    if (!prefix) {
      return { valid: false, status: 'invalid' };
    }

    // Find key by prefix
    const key = this.keysByPrefix.get(prefix);
    if (!key) {
      logger.debug('API key not found for prefix', { prefix });
      return { valid: false, status: 'invalid' };
    }

    // Compare the key hash using bcrypt
    const isValid = await bcrypt.compare(plaintextKey, key.keyHash);
    if (!isValid) {
      logger.debug('API key hash mismatch', { id: key.id });
      return { valid: false, status: 'invalid' };
    }

    // Check if key is active
    if (key.status !== 'active') {
      logger.debug('API key is disabled', { id: key.id, status: key.status });
      return { valid: false, status: 'disabled', key };
    }

    // Check if key has expired
    if (key.expiresAt && new Date() > key.expiresAt) {
      logger.debug('API key has expired', { id: key.id, expiresAt: key.expiresAt });
      return { valid: false, status: 'expired', key };
    }

    // Update last used timestamp
    key.lastUsedAt = new Date();

    logger.debug('API key validated successfully', {
      id: key.id,
      name: key.name,
    });

    return { valid: true, status: 'valid', key };
  }

  /**
   * Get a key by its ID.
   *
   * @param id - The key UUID
   * @returns The key metadata or undefined
   */
  getKeyById(id: string): ApiKey | undefined {
    return this.keys.get(id);
  }

  /**
   * Get a key by its prefix.
   *
   * @param prefix - The 8-character prefix
   * @returns The key metadata or undefined
   */
  getKeyByPrefix(prefix: string): ApiKey | undefined {
    return this.keysByPrefix.get(prefix);
  }

  /**
   * Get all keys.
   *
   * @returns Array of all keys
   */
  getAllKeys(): ApiKey[] {
    return Array.from(this.keys.values());
  }

  /**
   * Update a key's status.
   *
   * @param id - The key UUID
   * @param status - The new status
   * @returns True if updated, false if key not found
   */
  async updateKeyStatus(id: string, status: ApiKeyStatus): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key) {
      logger.warn('Cannot update status: key not found', { id });
      return false;
    }

    key.status = status;
    await this.persistKeys();

    logger.info('Updated API key status', { id, status });
    return true;
  }

  /**
   * Delete a key.
   *
   * @param id - The key UUID
   * @returns True if deleted, false if key not found
   */
  async deleteKey(id: string): Promise<boolean> {
    const key = this.keys.get(id);
    if (!key) {
      logger.warn('Cannot delete: key not found', { id });
      return false;
    }

    this.keys.delete(id);
    this.keysByPrefix.delete(key.prefix);
    await this.persistKeys();

    logger.info('Deleted API key', { id, name: key.name });
    return true;
  }

  /**
   * Persist keys to the storage file.
   * Uses atomic write (write to temp file, then rename).
   */
  async persistKeys(): Promise<void> {
    const keys = Array.from(this.keys.values());

    const data: ApiKeyStorage = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      keys,
    };

    // Ensure directory exists
    const dir = dirname(this.apiKeysPath);
    await mkdir(dir, { recursive: true });

    // Write to temp file first
    const tempPath = `${this.apiKeysPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

    // Rename for atomic write
    const { rename } = await import('fs/promises');
    await rename(tempPath, this.apiKeysPath);

    logger.debug('API keys persisted', {
      path: this.apiKeysPath,
      keyCount: keys.length,
    });
  }

  /**
   * Check if the manager is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the storage file path.
   */
  getStoragePath(): string {
    return this.apiKeysPath;
  }
}

/**
 * Create a new ApiKeyManager instance.
 *
 * @param config - Configuration options
 * @returns A new ApiKeyManager instance
 */
export function createApiKeyManager(config?: ApiKeyManagerConfig): ApiKeyManager {
  return new ApiKeyManager(config);
}