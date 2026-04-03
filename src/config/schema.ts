/**
 * Configuration Zod schemas.
 * Provides type-safe configuration validation.
 */

import { z } from 'zod';

/**
 * Load balancing strategy schema.
 */
export const loadBalanceStrategySchema = z.enum([
  'quota-priority',
  'round-robin',
  'weighted-round-robin',
  'random',
]);

/**
 * Factor weights schema for multi-factor scoring.
 * Values must sum to 1.0.
 */
export const factorWeightsSchema = z
  .object({
    expiration: z.number().min(0).max(1).default(0.4),
    rpm: z.number().min(0).max(1).default(0.4),
    quota: z.number().min(0).max(1).default(0.2),
  })
  .refine(
    (data) => {
      const sum = data.expiration + data.rpm + data.quota;
      return Math.abs(sum - 1.0) < 0.001; // Allow small floating point errors
    },
    {
      message: 'Factor weights must sum to 1.0',
    }
  );

/**
 * Load balancing configuration schema.
 */
export const loadBalanceConfigSchema = z.object({
  strategy: loadBalanceStrategySchema.default('quota-priority'),
  factorWeights: factorWeightsSchema.default({
    expiration: 0.4,
    rpm: 0.4,
    quota: 0.2,
  }),
});

/**
 * Quota configuration schema.
 */
export const quotaConfigSchema = z.object({
  limit: z.number().int().positive(),
  period: z.enum(['daily', 'monthly', 'total']),
  // Load balancing and expiration fields inside quota
  expiresOn: z.number().int().min(1).max(31).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Model aliases schema.
 * Maps user-provided alias names to canonical model names.
 */
export const modelAliasesSchema = z
  .record(
    z.string().min(1), // alias key (e.g., "gpt-4")
    z.string().min(1) // canonical model name (e.g., "gpt-4-turbo")
  );

/**
 * Plan configuration schema (from YAML/JSON).
 * ID can be either integer (preferred) or UUID (legacy, for migration).
 */
export const planConfigSchema = z.object({
  id: z.union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER), // Integer ID (preferred)
    z.string().uuid(), // UUID (legacy, for migration)
  ]).optional(),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
  quota: quotaConfigSchema,
  timeout: z.number().int().min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
  // Load balancing and expiration fields
  expiresOn: z.number().int().min(1).max(31).optional(),
  expiresAt: z.string().datetime().optional(),
  weight: z.number().int().min(1).max(100).optional(),
  enable: z.boolean().optional().default(true),
  modelAliases: modelAliasesSchema.optional(),
}).refine(
  (plan) => {
    if (!plan.modelAliases) return true;
    const modelsLower = plan.models.map((m: string) => m.toLowerCase());
    return Object.values(plan.modelAliases).every(
      (target) => modelsLower.includes(target.toLowerCase())
    );
  },
  { message: "modelAliases target must exist in the plan's models array" }
);

/**
 * Full configuration schema (root).
 */
export const configSchema = z.object({
  version: z.string().optional(),
  plans: z.array(planConfigSchema).default([]),
  loadBalancing: loadBalanceConfigSchema.optional(),
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
 * Auth configuration schema.
 */
export const authConfigSchema = z.object({
  apiKeysPath: z.string().default('./api-keys.json'),
  usageDataPath: z.string().default('./usage-data.json'),
  authExemptPaths: z.string().default('/health,/ready'),
  usageSyncIntervalMs: z.number().int().positive().default(60000),
});

/**
 * Full application configuration schema.
 */
export const appConfigSchema = z.object({
  server: serverConfigSchema,
  paths: pathsConfigSchema,
  security: securityConfigSchema,
  quota: quotaSyncConfigSchema,
  auth: authConfigSchema.optional(),
});

/**
 * Inferred types from schemas.
 */
export type PlanConfig = z.infer<typeof planConfigSchema>;
export type Config = z.infer<typeof configSchema>;
export type ModelAliases = z.infer<typeof modelAliasesSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type PathsConfig = z.infer<typeof pathsConfigSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type QuotaSyncConfig = z.infer<typeof quotaSyncConfigSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type LoadBalanceConfigInput = z.infer<typeof loadBalanceConfigSchema>;
export type FactorWeightsInput = z.infer<typeof factorWeightsSchema>;