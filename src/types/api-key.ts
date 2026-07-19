/**
 * API Key types and validation schemas.
 * Provides type definitions for API key management.
 */

import { z } from 'zod';

/**
 * API Key status enum.
 */
export type ApiKeyStatus = 'active' | 'disabled';

/**
 * API Key entity representing a client credential.
 */
export interface ApiKey {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Human-readable name (1-100 characters) */
  name: string;
  /** bcrypt hash of the API key (cost factor 12) */
  keyHash: string;
  /** First 8 characters after prefix for identification */
  prefix: string;
  /** Key status */
  status: ApiKeyStatus;
  /**
   * Whether this key may access the admin plane (/api/plans, /api/quota, ...).
   * Undefined/absent is treated as false (data-plane only) for backward
   * compatibility with keys created before the role split.
   */
  isAdmin?: boolean;
  /** Key creation timestamp */
  createdAt: Date;
  /** Optional expiration date */
  expiresAt?: Date;
  /** Last successful authentication timestamp */
  lastUsedAt?: Date;
}

/**
 * API Key storage schema (for JSON persistence).
 */
export interface ApiKeyStorage {
  version: string;
  lastUpdated: string;
  keys: ApiKey[];
}

/**
 * Input for creating a new API key.
 */
export interface CreateApiKeyInput {
  name: string;
  expiresAt?: Date;
  isAdmin?: boolean;
}

/**
 * Zod schema for API key status validation.
 */
export const apiKeyStatusSchema = z.enum(['active', 'disabled']);

/**
 * Zod schema for API key validation.
 */
export const apiKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  keyHash: z.string().min(1),
  prefix: z.string().length(8).regex(/^[a-zA-Z0-9]+$/),
  status: apiKeyStatusSchema,
  isAdmin: z.boolean().optional(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  lastUsedAt: z.coerce.date().optional(),
});

/**
 * Zod schema for API key storage file.
 */
export const apiKeyStorageSchema = z.object({
  version: z.string().default('1.0'),
  lastUpdated: z.string(),
  keys: z.array(apiKeySchema).default([]),
});

/**
 * Zod schema for create API key input.
 */
export const createApiKeyInputSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[\w\s-]+$/, 'Name must be alphanumeric with spaces, hyphens, or underscores'),
  expiresAt: z.coerce.date().optional(),
});