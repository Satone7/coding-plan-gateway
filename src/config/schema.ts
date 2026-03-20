/**
 * Configuration Zod schemas.
 * Provides type-safe configuration validation.
 */

import { z } from 'zod';

/**
 * Quota configuration schema.
 */
export const quotaConfigSchema = z.object({
  limit: z.number().int().positive(),
  period: z.enum(['daily', 'monthly', 'total']),
});

/**
 * Plan configuration schema (from YAML/JSON).
 */
export const planConfigSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
  quota: quotaConfigSchema,
  timeout: z.number().int().min(1000).max(300000).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

/**
 * Full configuration schema (root).
 */
export const configSchema = z.object({
  version: z.string().optional(),
  plans: z.array(planConfigSchema).default([]),
});

/**
 * Server configuration schema.
 */
export const serverConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8080),
  host: z.string().default('0.0.0.0'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

/**
 * Paths configuration schema.
 */
export const pathsConfigSchema = z.object({
  configPath: z.string().default('./config.yaml'),
  quotaStatePath: z.string().default('./quota-state.json'),
});

/**
 * Security configuration schema.
 */
export const securityConfigSchema = z.object({
  encryptionKey: z.string().length(64).regex(/^[0-9a-fA-F]+$/),
});

/**
 * Quota configuration schema.
 */
export const quotaSyncConfigSchema = z.object({
  syncIntervalMs: z.number().int().positive().default(60000),
});

/**
 * Full application configuration schema.
 */
export const appConfigSchema = z.object({
  server: serverConfigSchema,
  paths: pathsConfigSchema,
  security: securityConfigSchema,
  quota: quotaSyncConfigSchema,
});

/**
 * Inferred types from schemas.
 */
export type PlanConfig = z.infer<typeof planConfigSchema>;
export type Config = z.infer<typeof configSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type PathsConfig = z.infer<typeof pathsConfigSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type QuotaSyncConfig = z.infer<typeof quotaSyncConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;