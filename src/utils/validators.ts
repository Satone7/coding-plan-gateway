/**
 * Validation helpers using Zod.
 * Provides schemas and utilities for validating request data.
 */

import { z } from 'zod';

// ==================== Common Schemas ====================

/**
 * UUID v4 schema.
 */
export const uuidSchema = z.string().uuid();

/**
 * Non-empty string schema.
 */
export const nonEmptyStringSchema = z.string().min(1);

/**
 * URL schema (HTTPS only for security).
 */
export const httpsUrlSchema = z.string().url().refine(
  (url) => url.startsWith('https://') || url.startsWith('http://localhost'),
  { message: 'URL must use HTTPS (or localhost for development)' }
);

/**
 * Positive integer schema.
 */
export const positiveIntegerSchema = z.number().int().positive();

/**
 * Non-negative integer schema.
 */
export const nonNegativeIntegerSchema = z.number().int().nonnegative();

// ==================== Quota Schemas ====================

/**
 * Quota period schema.
 */
export const quotaPeriodSchema = z.enum(['daily', 'monthly', 'total']);

/**
 * Quota configuration schema.
 */
export const quotaConfigSchema = z.object({
  limit: positiveIntegerSchema,
  period: quotaPeriodSchema,
});

/**
 * Quota state schema.
 */
export const quotaStateSchema = z.object({
  planId: uuidSchema,
  used: nonNegativeIntegerSchema,
  limit: positiveIntegerSchema,
  period: quotaPeriodSchema,
  lastUpdated: z.string().or(z.date()),
  resetAt: z.string().or(z.date()).nullable(),
});

// ==================== Plan Schemas ====================

/**
 * Plan status schema.
 */
export const planStatusSchema = z.enum(['active', 'paused', 'error', 'exhausted']);

/**
 * Coding plan schema for creation.
 */
export const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: httpsUrlSchema,
  apiKey: nonEmptyStringSchema,
  models: z.array(nonEmptyStringSchema).min(1).max(100),
  quota: quotaConfigSchema,
  timeout: z.number().int().min(1000).max(300000).optional(),
});

/**
 * Coding plan schema for updates.
 */
export const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: httpsUrlSchema.optional(),
  apiKey: nonEmptyStringSchema.optional(),
  models: z.array(nonEmptyStringSchema).min(1).max(100).optional(),
  quota: quotaConfigSchema.partial().optional(),
  timeout: z.number().int().min(1000).max(300000).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

/**
 * Full coding plan schema (with all fields).
 */
export const codingPlanSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  baseUrl: httpsUrlSchema,
  apiKeyEncrypted: nonEmptyStringSchema,
  models: z.array(nonEmptyStringSchema).min(1).max(100),
  quota: quotaConfigSchema,
  timeout: z.number().int().min(1000).max(300000),
  status: planStatusSchema,
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

// ==================== API Request Schemas ====================

/**
 * Message role schema for OpenAI format.
 */
export const messageRoleSchema = z.enum(['system', 'user', 'assistant']);

/**
 * Chat message schema.
 */
export const chatMessageSchema = z.object({
  role: messageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
});

/**
 * OpenAI chat completion request schema.
 */
export const chatCompletionRequestSchema = z.object({
  model: nonEmptyStringSchema,
  messages: z.array(chatMessageSchema).min(1),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  user: z.string().optional(),
});

/**
 * Anthropic message request schema.
 */
export const anthropicMessageRequestSchema = z.object({
  model: nonEmptyStringSchema,
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.union([
      z.string(),
      z.array(z.object({
        type: z.enum(['text', 'image']),
        text: z.string().optional(),
        source: z.object({
          type: z.enum(['url', 'base64']),
          media_type: z.string().optional(),
          data: z.string(),
        }).optional(),
      })),
    ]),
  })).min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional(),
  system: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
});

/**
 * Quota reset request schema.
 */
export const quotaResetRequestSchema = z.object({
  used: z.number().int().nonnegative().optional().default(0),
});

// ==================== Config Schemas ====================

/**
 * Environment variable schema.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).optional().default('8080'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional().default('info'),
  CONFIG_PATH: z.string().optional().default('./config.yaml'),
  QUOTA_STATE_PATH: z.string().optional().default('./quota-state.json'),
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-fA-F]+$/),
  QUOTA_SYNC_INTERVAL: z.string().regex(/^\d+$/).transform(Number).optional().default('60000'),
});

// ==================== Validation Utilities ====================

/**
 * Validation error with details.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details: z.ZodError
  ) {
    super(message);
    this.name = 'ValidationError';
  }

  /**
   * Get formatted error messages.
   */
  getFormattedErrors(): string[] {
    return this.details.errors.map((err) => {
      const path = err.path.join('.');
      return `${path}: ${err.message}`;
    });
  }
}

/**
 * Validate data against a schema.
 * Throws ValidationError if validation fails.
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new ValidationError('Validation failed', result.error);
  }

  return result.data;
}

/**
 * Validate data against a schema, returning a result object.
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result.error };
}

/**
 * Create a validator function for a schema.
 */
export function createValidator<T>(schema: z.ZodSchema<T>): (data: unknown) => T {
  return (data: unknown) => validate(schema, data);
}