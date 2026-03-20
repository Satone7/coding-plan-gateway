/**
 * Plan Repository - Storage abstraction for coding plans.
 * Implements the Repository pattern for future database migration.
 */

import { readFile, writeFile, access, rename } from 'fs/promises';
import { constants } from 'fs';
import { resolve, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  CodingPlan,
  CreateCodingPlanInput,
  UpdateCodingPlanInput,
} from '@/types';
import { planConfigSchema, type PlanConfig } from '@/config/schema';
import {
  encryptApiKey,
  decryptApiKey,
} from '@/config/encryption';
import { logger } from '@/utils/logger';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@/config/defaults';

/**
 * Repository interface for coding plan storage.
 * Allows swapping file-based storage for database in the future.
 */
export interface IPlanRepository {
  /** Find a plan by its ID */
  findById(id: string): Promise<CodingPlan | null>;

  /** Find all plans */
  findAll(): Promise<CodingPlan[]>;

  /** Find plans that support a specific model */
  findByModel(model: string): Promise<CodingPlan[]>;

  /** Find plans with active status */
  findActive(): Promise<CodingPlan[]>;

  /** Save a new plan */
  save(plan: CreateCodingPlanInput): Promise<CodingPlan>;

  /** Update an existing plan */
  update(id: string, updates: UpdateCodingPlanInput): Promise<CodingPlan>;

  /** Delete a plan by ID */
  delete(id: string): Promise<boolean>;

  /** Check if a plan exists */
  exists(id: string): Promise<boolean>;

  /** Get decrypted API key for a plan */
  getDecryptedApiKey(id: string): Promise<string | null>;
}

/**
 * File-based implementation of PlanRepository.
 * Stores plans in YAML or JSON format.
 */
export class FilePlanRepository implements IPlanRepository {
  private readonly filePath: string;
  private readonly encryptionKey: string | undefined;
  private plans: Map<string, CodingPlan> = new Map();
  private loaded: boolean = false;

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
   * Find a plan by its ID.
   */
  async findById(id: string): Promise<CodingPlan | null> {
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
    const normalizedModel = model.toLowerCase();
    return Array.from(this.plans.values())
      .filter((plan) =>
        plan.models.some((m) => m.toLowerCase() === normalizedModel)
      )
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

    const id = uuidv4();
    const now = new Date();

    // Encrypt API key if encryption key is available
    const apiKeyEncrypted = this.encryptionKey
      ? encryptApiKey(input.apiKey, this.encryptionKey)
      : input.apiKey;

    const plan: CodingPlan = {
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      apiKeyEncrypted,
      models: input.models,
      quota: input.quota,
      timeout: input.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
      status: 'active',
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
  async update(id: string, updates: UpdateCodingPlanInput): Promise<CodingPlan> {
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
  async delete(id: string): Promise<boolean> {
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
  async exists(id: string): Promise<boolean> {
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
  async getDecryptedApiKey(id: string): Promise<string | null> {
    await this.ensureLoaded();
    const plan = this.plans.get(id);
    if (!plan) {
      return null;
    }

    if (!this.encryptionKey) {
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

      // Validate and convert to CodingPlan objects
      const plansData =
        parsed && typeof parsed === 'object' && 'plans' in parsed
          ? (parsed as { plans: unknown[] }).plans
          : [];
      const config = planConfigSchema.array().parse(plansData);

      this.plans = new Map();
      for (const planConfig of config) {
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
   */
  private async persist(): Promise<void> {
    const plans = Array.from(this.plans.values()).map((p) =>
      this.planToConfig(p)
    );

    const content = this.serializeContent({ plans });

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
   */
  private configToPlan(config: PlanConfig): CodingPlan {
    const now = new Date();
    return {
      id: config.id ?? uuidv4(),
      name: config.name,
      baseUrl: config.baseUrl,
      apiKeyEncrypted: config.apiKey,
      models: config.models,
      quota: config.quota,
      timeout: config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
      status: config.status ?? 'active',
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

    return {
      id: plan.id,
      name: plan.name,
      baseUrl: plan.baseUrl,
      apiKey: plan.apiKeyEncrypted,
      models: plan.models,
      quota: plan.quota,
      timeout: plan.timeout,
      status: persistableStatus,
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