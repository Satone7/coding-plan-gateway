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
 * Model routing strategy entry schema (generic, passthrough).
 *
 * `id` selects the strategy implementation; the remaining fields are that
 * strategy's own params (e.g. `rules` for context-downgrade). Each strategy
 * validates its own params, so adding a new strategy requires no schema change
 * — only a new class registered in ModelRoutingService.
 */
export const modelRoutingStrategySchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().optional().default(true),
  })
  .passthrough();

/**
 * Model routing configuration schema.
 * Controls content-aware model rewriting that runs before plan selection.
 * Additive optional field → no config version bump or migration needed.
 */
export const modelRoutingConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  strategies: z.array(modelRoutingStrategySchema).default([]),
});

/**
 * Quota period schemas (discriminated union).
 */
const fiveHourPeriodSchema = z.object({
  type: z.literal('5h'),
  windowHours: z.number().int().min(1).max(24).optional().default(5),
  sliding: z.literal(true).optional().default(true),
});

const weeklyPeriodSchema = z.object({
  type: z.literal('weekly'),
  weekday: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]),
});

const monthlyPeriodSchema = z.object({
  type: z.literal('monthly'),
  expiresOn: z.number().int().min(1).max(31).optional(),
});

const totalPeriodSchema = z.object({
  type: z.literal('total'),
});

export const quotaPeriodSchema = z.discriminatedUnion('type', [
  fiveHourPeriodSchema,
  weeklyPeriodSchema,
  monthlyPeriodSchema,
  totalPeriodSchema,
]);

/**
 * Quota configuration schema.
 */
export const quotaConfigSchema = z.object({
  limit: z.number().int().positive(),
  period: quotaPeriodSchema,
  // Legacy expiration fields inside quota (kept for backward compat with old YAML configs)
  // These are applied by configToPlan in the repository layer
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
 * When `provider` is set, `baseUrl`, `models`, and `quota` become optional
 * (defaults come from the provider preset).
 */
export const planConfigSchema = z.object({
  id: z.union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z.string().uuid(),
  ]).optional(),
  name: z.string().min(1).max(100),
  provider: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  openaiBaseUrl: z.string().url().optional(),
  apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1).optional(),
  quota: quotaConfigSchema.optional(),
  timeout: z.number().int().min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
  expiresOn: z.number().int().min(1).max(31).optional(),
  expiresAt: z.string().datetime().optional(),
  weight: z.number().int().min(0).max(100).optional(),
  enable: z.boolean().optional().default(true),
  modelAliases: modelAliasesSchema.optional(),
  dynamicModels: z.boolean().optional(),
  modelsExclude: z.array(z.string().min(1)).optional(),
}).refine(
  (plan) => {
    if (plan.provider) {
      return true;
    }
    // No provider: require quota + at least one endpoint URL.
    // models is required unless dynamicModels fetches it at runtime.
    const hasUrl = plan.baseUrl !== undefined || plan.openaiBaseUrl !== undefined;
    const hasQuota = plan.quota !== undefined;
    const hasModels = plan.models !== undefined || plan.dynamicModels === true;
    return hasUrl && hasQuota && hasModels;
  },
  { message: 'quota and at least one of baseUrl/openaiBaseUrl are required when provider is not set; models is required unless dynamicModels is true' }
).refine(
  (plan) => {
    if (!plan.modelAliases) return true;
    // When provider is set, models may come from preset - skip validation here
    // (validated later in normalizePlanConfig with preset models)
    if (plan.provider && !plan.models) return true;
    const models = plan.models ?? [];
    const modelsLower = models.map((m: string) => m.toLowerCase());
    return Object.values(plan.modelAliases).every(
      (target) => modelsLower.includes(target.toLowerCase())
    );
  },
  { message: "modelAliases target must exist in the plan's models array" }
);

/**
 * Provider override schema for config-level customization.
 */
export const providerOverrideSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  openaiBaseUrl: z.string().url().optional(),
  models: z.array(z.string().min(1)).min(1).optional(),
  defaultModelAliases: modelAliasesSchema.optional(),
  hasUsageApi: z.boolean().optional(),
  dynamicModels: z.boolean().optional(),
  modelsExclude: z.array(z.string().min(1)).optional(),
});

/**
 * Full configuration schema (root).
 */
export const configSchema = z.object({
  version: z.union([z.number().int().min(0), z.string()]).optional(),
  plans: z.array(planConfigSchema).default([]),
  providers: z.record(z.string().min(1), providerOverrideSchema).optional(),
  loadBalancing: loadBalanceConfigSchema.optional(),
  modelRouting: modelRoutingConfigSchema.optional(),
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
export type ModelRoutingConfigInput = z.infer<typeof modelRoutingConfigSchema>;