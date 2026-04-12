/**
 * Plan Repository - Storage abstraction for coding plans.
 * Implements the Repository pattern for future database migration.
 */

import { readFile, writeFile, access, rename } from 'fs/promises';
import { constants } from 'fs';
import { resolve, extname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  CodingPlan,
  CreateCodingPlanInput,
  UpdateCodingPlanInput,
} from '@/types';
import { planConfigSchema, type PlanConfig } from '@/config/schema';
import { normalizePlanConfig, type NormalizedPlanConfig } from '@/config';
import {
  encryptApiKey,
  decryptApiKey,
  isApiKeyEncrypted,
} from '@/config/encryption';
import { logger } from '@/utils/logger';
import { planSupportsModel } from '@/utils/model-alias';
import { DEFAULT_REQUEST_TIMEOUT_SEC } from '@/config/defaults';
import type { PlanIdCounter } from './plan-id-counter';

/**
 * Repository interface for coding plan storage.
 * Allows swapping file-based storage for database in the future.
 */
export interface IPlanRepository {
  /** Find a plan by its ID */
  findById(id: number): Promise<CodingPlan | null>;

  /** Find all plans */
  findAll(): Promise<CodingPlan[]>;

  /** Find plans that support a specific model */
  findByModel(model: string): Promise<CodingPlan[]>;

  /** Find plans with active status */
  findActive(): Promise<CodingPlan[]>;

  /** Save a new plan */
  save(plan: CreateCodingPlanInput): Promise<CodingPlan>;

  /** Update an existing plan */
  update(id: number, updates: UpdateCodingPlanInput): Promise<CodingPlan>;

  /** Delete a plan by ID */
  delete(id: number): Promise<boolean>;

  /** Check if a plan exists */
  exists(id: number): Promise<boolean>;

  /** Get decrypted API key for a plan */
  getDecryptedApiKey(id: number): Promise<string | null>;

  /** Reload plans from storage */
  reload(): Promise<void>;

  /** Set the plan ID counter for ID generation */
  setPlanIdCounter(counter: PlanIdCounter): void;
}

/**
 * File-based implementation of PlanRepository.
 * Stores plans in YAML or JSON format.
 */
export class FilePlanRepository implements IPlanRepository {
  private readonly filePath: string;
  private readonly encryptionKey: string | undefined;
  private plans: Map<number, CodingPlan> = new Map();
  private loaded: boolean = false;
  private planIdCounter: PlanIdCounter | null = null;

  /**
   * Create a new FilePlanRepository.
   *
   * @param filePath - Path to the configuration file
   * @param encryptionKey - Optional encryption key for API keys
   */
  constructor(filePath: string, encryptionKey?: string) {
    this.filePath = resolve(filePath);
    this.encryptionKey = encryptionKey;
  }

  /**
   * Set the plan ID counter for ID generation.
   *
   * @param counter - The PlanIdCounter instance
   */
  setPlanIdCounter(counter: PlanIdCounter): void {
    this.planIdCounter = counter;
  }

  /**
   * Find a plan by its ID.
   */
  async findById(id: number): Promise<CodingPlan | null> {
    await this.ensureLoaded();
    const plan = this.plans.get(id);
    return plan ? this.toPlainObject(plan) : null;
  }

  /**
   * Find all plans.
   */
  async findAll(): Promise<CodingPlan[]> {
    await this.ensureLoaded();
    return Array.from(this.plans.values()).map((p) => this.toPlainObject(p));
  }

  /**
   * Find plans that support a specific model.
   */
  async findByModel(model: string): Promise<CodingPlan[]> {
    await this.ensureLoaded();
    return Array.from(this.plans.values())
      .filter((plan) => planSupportsModel(plan, model))
      .map((p) => this.toPlainObject(p));
  }

  /**
   * Find plans with active status.
   */
  async findActive(): Promise<CodingPlan[]> {
    await this.ensureLoaded();
    return Array.from(this.plans.values())
      .filter((plan) => plan.status === 'active')
      .map((p) => this.toPlainObject(p));
  }

  /**
   * Save a new plan.
   */
  async save(input: CreateCodingPlanInput): Promise<CodingPlan> {
    await this.ensureLoaded();

    // Generate ID using PlanIdCounter
    let id: number;
    if (this.planIdCounter) {
      id = await this.planIdCounter.getNextId();
    } else {
      // Fallback: find max ID and increment
      const maxId = Math.max(0, ...Array.from(this.plans.keys()));
      id = maxId + 1;
      logger.warn('PlanIdCounter not set, using fallback ID generation', { id });
    }

    const now = new Date();

    // Encrypt API key if encryption key is available
    const apiKeyEncrypted = this.encryptionKey
      ? encryptApiKey(input.apiKey, this.encryptionKey)
      : input.apiKey;

    // Extract expiresOn/expiresAt from quota if provided
    const { expiresOn, expiresAt, ...quotaWithoutExpiration } = input.quota;
    const finalExpiresOn = input.expiresOn ?? expiresOn;
    const finalExpiresAt = input.expiresAt ?? expiresAt;

    const plan: CodingPlan = {
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      apiKeyEncrypted,
      models: input.models,
      quota: input.quota,
      timeout: input.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      status: 'active',
      expiresOn: finalExpiresOn,
      expiresAt: finalExpiresAt,
      weight: input.weight,
      enable: input.enable ?? true,
      modelAliases: input.modelAliases,
      provider: input.provider,
      createdAt: now,
      updatedAt: now,
    };

    this.plans.set(id, plan);
    await this.persist();

    logger.info('Plan created', { planId: id, name: plan.name });
    return this.toPlainObject(plan);
  }

  /**
   * Update an existing plan.
   */
  async update(id: number, updates: UpdateCodingPlanInput): Promise<CodingPlan> {
    await this.ensureLoaded();

    const existing = this.plans.get(id);
    if (!existing) {
      throw new Error(`Plan not found: ${id}`);
    }

    const now = new Date();

    // Handle API key encryption
    let apiKeyEncrypted = existing.apiKeyEncrypted;
    if (updates.apiKey !== undefined) {
      apiKeyEncrypted = this.encryptionKey
        ? encryptApiKey(updates.apiKey, this.encryptionKey)
        : updates.apiKey;
    }

    const updated: CodingPlan = {
      ...existing,
      name: updates.name ?? existing.name,
      baseUrl: updates.baseUrl ?? existing.baseUrl,
      apiKeyEncrypted,
      models: updates.models ?? existing.models,
      quota: updates.quota
        ? { ...existing.quota, ...updates.quota }
        : existing.quota,
      timeout: updates.timeout ?? existing.timeout,
      status: updates.status ?? existing.status,
      expiresOn: updates.expiresOn !== undefined ? updates.expiresOn : existing.expiresOn,
      expiresAt: updates.expiresAt !== undefined ? updates.expiresAt : existing.expiresAt,
      weight: updates.weight !== undefined ? updates.weight : existing.weight,
      enable: updates.enable !== undefined ? updates.enable : existing.enable,
      modelAliases: updates.modelAliases !== undefined ? updates.modelAliases : existing.modelAliases,
      provider: updates.provider !== undefined ? updates.provider : existing.provider,
      updatedAt: now,
    };

    this.plans.set(id, updated);
    await this.persist();

    logger.info('Plan updated', { planId: id, name: updated.name });
    return this.toPlainObject(updated);
  }

  /**
   * Delete a plan by ID.
   */
  async delete(id: number): Promise<boolean> {
    await this.ensureLoaded();

    const existed = this.plans.delete(id);
    if (existed) {
      await this.persist();
      logger.info('Plan deleted', { planId: id });
    }
    return existed;
  }

  /**
   * Check if a plan exists.
   */
  async exists(id: number): Promise<boolean> {
    await this.ensureLoaded();
    return this.plans.has(id);
  }

  /**
   * Reload plans from file.
   */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.ensureLoaded();
  }

  /**
   * Get the decrypted API key for a plan.
   */
  async getDecryptedApiKey(id: number): Promise<string | null> {
    await this.ensureLoaded();
    const plan = this.plans.get(id);
    if (!plan) {
      return null;
    }

    if (!this.encryptionKey) {
      return plan.apiKeyEncrypted;
    }

    // Check if the key is actually encrypted before trying to decrypt
    if (!isApiKeyEncrypted(plan.apiKeyEncrypted)) {
      return plan.apiKeyEncrypted;
    }

    return decryptApiKey(plan.apiKeyEncrypted, this.encryptionKey);
  }

  /**
   * Ensure plans are loaded from file.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await this.load();
    this.loaded = true;
  }

  /**
   * Load plans from file.
   */
  private async load(): Promise<void> {
    const fileExists = await this.fileAccessible(this.filePath);

    if (!fileExists) {
      logger.info('Configuration file not found, starting with empty plans', {
        path: this.filePath,
      });
      this.plans = new Map();
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed: unknown = this.parseContent(content);

      // Extract plans array from parsed config
      const plansData =
        parsed && typeof parsed === 'object' && 'plans' in parsed
          ? (parsed as { plans: unknown[] }).plans
          : [];

      // Config migration is handled by the startup engine (migrateConfigFile).
      // Plans should already be in the latest format at this point.
      const migratedPlans = plansData;

      // Validate and convert to CodingPlan objects
      const config = planConfigSchema.array().parse(migratedPlans);
      const normalized = config.map(normalizePlanConfig);

      this.plans = new Map();
      for (const planConfig of normalized) {
        const plan = this.configToPlan(planConfig);
        this.plans.set(plan.id, plan);
      }

      logger.info(`Loaded ${this.plans.size} plan(s) from configuration`, {
        path: this.filePath,
      });
    } catch (error) {
      logger.error('Failed to load configuration', error as Error, {
        path: this.filePath,
      });
      throw new Error(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Persist plans to file.
   * Preserves non-plan fields (version, providers, loadBalancing, etc.)
   * by reading the existing file and merging plans into it.
   */
  private async persist(): Promise<void> {
    const plans = Array.from(this.plans.values()).map((p) =>
      this.planToConfig(p)
    );

    // Preserve non-plan fields from the existing file
    let existingData: Record<string, unknown> = {};
    try {
      const existingContent = await readFile(this.filePath, 'utf-8');
      const parsed = this.parseContent(existingContent);
      if (parsed && typeof parsed === 'object') {
        existingData = parsed as Record<string, unknown>;
      }
    } catch {
      // File may not exist yet or be empty — start fresh
    }

    const content = this.serializeContent({ ...existingData, plans });

    // Write to temp file first, then rename for atomicity
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, this.filePath);

    logger.debug('Configuration persisted', {
      path: this.filePath,
      planCount: plans.length,
    });
  }

  /**
   * Parse configuration file content.
   */
  private parseContent(content: string): unknown {
    const ext = extname(this.filePath).toLowerCase();

    if (ext === '.yaml' || ext === '.yml') {
      return parseYaml(content);
    }

    if (ext === '.json') {
      return JSON.parse(content);
    }

    // Try JSON first, then YAML
    try {
      return JSON.parse(content);
    } catch {
      return parseYaml(content);
    }
  }

  /**
   * Serialize configuration to file content.
   */
  private serializeContent(data: unknown): string {
    const ext = extname(this.filePath).toLowerCase();

    if (ext === '.json') {
      return JSON.stringify(data, null, 2);
    }

    // Default to YAML
    return stringifyYaml(data);
  }

  /**
   * Convert a PlanConfig to a CodingPlan.
   * Handles both integer and UUID IDs for migration compatibility.
   */
  private configToPlan(config: NormalizedPlanConfig): CodingPlan {
    const now = new Date();

    // Handle ID: prefer integer, generate if missing or if UUID (legacy)
    let id: number;
    if (typeof config.id === 'number') {
      id = config.id;
    } else if (typeof config.id === 'string') {
      // Legacy UUID - this should only happen during migration
      // For now, throw an error - migration should convert these
      throw new Error(
        `Legacy UUID ID detected: ${config.id}. Run migration first.`
      );
    } else {
      // No ID provided - should not happen in normal operation
      throw new Error('Plan ID is required');
    }

    // Support expiresOn/expiresAt in multiple positions:
    // 1. quota.period.expiresOn (structured monthly period)
    // 2. quota.expiresOn (legacy position inside quota block)
    // 3. expiresOn (top-level plan field, oldest format)
    const periodExpiresOn =
      config.quota.period.type === 'monthly' ? config.quota.period.expiresOn : undefined;
    const effectiveExpiresOn = periodExpiresOn ?? config.quota.expiresOn ?? config.expiresOn;
    const effectiveExpiresAt = config.quota.expiresAt ?? config.expiresAt;

    // Merge expires fields into quota for internal consistency
    const mergedQuota = {
      ...config.quota,
      expiresOn: effectiveExpiresOn,
      expiresAt: effectiveExpiresAt,
    };

    return {
      id,
      name: config.name,
      baseUrl: config.baseUrl,
      apiKeyEncrypted: config.apiKey,
      models: config.models,
      quota: mergedQuota,
      timeout: config.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      status: config.status ?? 'active',
      expiresOn: effectiveExpiresOn,
      expiresAt: effectiveExpiresAt,
      weight: config.weight,
      enable: config.enable ?? true,
      modelAliases: config.modelAliases,
      provider: config.provider,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Convert a CodingPlan to a PlanConfig for serialization.
   */
  private planToConfig(plan: CodingPlan): PlanConfig & { apiKey: string } {
    // When saving, only persist 'active' or 'paused' status
    // 'error' and 'exhausted' are runtime-only statuses
    const persistableStatus: 'active' | 'paused' | undefined =
      plan.status === 'active' || plan.status === 'paused'
        ? plan.status
        : undefined;

    // Store expiresOn/expiresAt inside quota for proper nesting
    // For monthly periods, sync the effective expiresOn into the period itself
    const quotaWithExpiration = {
      ...plan.quota,
      period: plan.quota.period.type === 'monthly' && plan.expiresOn !== undefined
        ? { ...plan.quota.period, expiresOn: plan.expiresOn }
        : plan.quota.period,
      expiresOn: plan.expiresOn,
      expiresAt: plan.expiresAt,
    };

    return {
      id: plan.id,
      name: plan.name,
      baseUrl: plan.baseUrl,
      apiKey: plan.apiKeyEncrypted,
      models: plan.models,
      quota: quotaWithExpiration,
      timeout: plan.timeout,
      status: persistableStatus,
      weight: plan.weight,
      enable: plan.enable ?? true,
      modelAliases: plan.modelAliases,
      provider: plan.provider,
    };
  }

  /**
   * Check if a file is accessible.
   */
  private async fileAccessible(path: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert a plan to a plain object (remove any class instance references).
   */
  private toPlainObject(plan: CodingPlan): CodingPlan {
    return {
      ...plan,
      createdAt: new Date(plan.createdAt),
      updatedAt: new Date(plan.updatedAt),
    };
  }
}

/**
 * Create a default plan repository instance.
 */
export function createPlanRepository(
  filePath: string,
  encryptionKey?: string
): IPlanRepository {
  return new FilePlanRepository(filePath, encryptionKey);
}