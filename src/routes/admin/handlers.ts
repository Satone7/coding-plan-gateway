/**
 * Admin route handlers for plan CRUD and quota operations.
 *
 * @module routes/admin/handlers
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IPlanRepository } from '@/services/plan-repository';
import type { QuotaManager } from '@/services/quota-manager';
import type { PlanUsageTracker } from '@/services/plan-usage-tracker';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
import { usageAdjustmentRequestSchema } from '@/types/plan-usage';
import { planIdParamSchema } from '@/utils/validators';

/**
 * Request with planId parameter.
 */
interface PlanParams {
  planId: string; // String from URL, will be parsed to number
}

/**
 * Integer plan ID parameter (parsed from URL).
 */
interface PlanIdParam {
  planId: number;
}

/**
 * Create plan request body schema.
 */
const createPlanBodySchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
  quota: z.object({
    limit: z.number().int().positive(),
    period: z.enum(['daily', 'monthly', 'total']),
  }),
  timeout: z.number().int().min(1).optional(),
});

/**
 * Update plan request body schema.
 */
const updatePlanBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  models: z.array(z.string().min(1)).min(1).optional(),
  quota: z
    .object({
      limit: z.number().int().positive().optional(),
      period: z.enum(['daily', 'monthly', 'total']).optional(),
    })
    .optional(),
  timeout: z.number().int().min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

/**
 * Plan response schema (without sensitive data).
 */
interface PlanResponse {
  id: number;
  name: string;
  baseUrl: string;
  models: string[];
  quota: {
    limit: number;
    period: string;
  };
  timeout: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  usage?: {
    used: number;
    remaining: number;
    lastUpdated: string;
  };
}

/**
 * Quota status response.
 */
interface QuotaStatusResponse {
  planId: number;
  used: number;
  limit: number;
  remaining: number;
  period: string;
  resetAt: string | null;
  lastUpdated: string;
}

/**
 * Meta response structure.
 */
interface MetaResponse {
  requestId: string;
  timestamp: string;
}

/**
 * Success response with single plan.
 */
interface PlanSuccessResponse {
  data: PlanResponse;
  meta: MetaResponse;
}

/**
 * Success response with multiple plans.
 */
interface PlansSuccessResponse {
  data: PlanResponse[];
  meta: MetaResponse;
}

/**
 * Quota status success response.
 */
interface QuotaSuccessResponse {
  data: QuotaStatusResponse;
  meta: MetaResponse;
}

/**
 * Parse and validate plan ID from URL parameter.
 *
 * @param planIdStr - The plan ID string from URL
 * @returns The parsed integer plan ID
 * @throws GatewayError if invalid
 */
function parsePlanId(planIdStr: string): number {
  const result = planIdParamSchema.safeParse(planIdStr);
  if (!result.success) {
    throw createGatewayError('INVALID_REQUEST', 'Invalid plan ID format. Must be a positive integer.', {
      field: 'planId',
    });
  }
  return result.data;
}

function toPlanResponse(
  plan: {
    id: number;
    name: string;
    baseUrl: string;
    models: string[];
    quota: { limit: number; period: string };
    timeout: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  quotaState?: {
    used: number;
    lastUpdated: Date;
  }
): PlanResponse {
  return {
    id: plan.id,
    name: plan.name,
    baseUrl: plan.baseUrl,
    models: plan.models,
    quota: plan.quota,
    timeout: plan.timeout,
    status: plan.status,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    usage: quotaState
      ? {
          used: quotaState.used,
          remaining: plan.quota.limit - quotaState.used,
          lastUpdated: quotaState.lastUpdated.toISOString(),
        }
      : undefined,
  };
}

/**
 * Admin handlers interface.
 * Defines the structure of returned handler methods.
 */
interface AdminHandlers {
  /** GET /api/plans - List all plans */
  listPlans: (request: FastifyRequest, reply: FastifyReply) => Promise<PlansSuccessResponse>;
  /** GET /api/plans/:planId - Get a specific plan */
  getPlan: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<PlanSuccessResponse>;
  /** POST /api/plans - Create a new plan */
  createPlan: (request: FastifyRequest<{ Body: z.infer<typeof createPlanBodySchema> }>, reply: FastifyReply) => Promise<PlanSuccessResponse>;
  /** PUT /api/plans/:planId - Update a plan */
  updatePlan: (request: FastifyRequest<{ Params: PlanParams; Body: z.infer<typeof updatePlanBodySchema> }>, reply: FastifyReply) => Promise<PlanSuccessResponse>;
  /** DELETE /api/plans/:planId - Delete a plan */
  deletePlan: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<void>;
  /** GET /api/quota/:planId - Get quota status for a plan */
  getQuotaStatus: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<QuotaSuccessResponse>;
  /** POST /api/quota/:planId/reset - Reset quota for a plan */
  resetQuota: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<QuotaSuccessResponse>;
  /** POST /api/quota/:planId/sync - Sync quota state with PlanUsageTracker */
  syncQuota: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<QuotaSyncResponse>;
  /** POST /api/reload - Reload configuration */
  reloadConfig: (request: FastifyRequest, reply: FastifyReply) => Promise<ReloadResponse>;
  /** GET /api/plans/:planId/usage - Get plan usage report */
  getPlanUsage: (request: FastifyRequest<{ Params: PlanParams; Querystring: PlanUsageQuery }>, reply: FastifyReply) => Promise<PlanUsageResponse>;
  /** POST /api/plans/:planId/usage/adjust - Adjust plan usage */
  adjustPlanUsage: (request: FastifyRequest<{ Params: PlanParams; Body: z.infer<typeof usageAdjustmentRequestSchema> }>, reply: FastifyReply) => Promise<UsageAdjustmentResponse>;
  /** GET /api/plans/:planId/usage/history - Get usage adjustment history */
  getUsageAdjustmentHistory: (request: FastifyRequest<{ Params: PlanParams; Querystring: HistoryQuery }>, reply: FastifyReply) => Promise<AdjustmentHistoryResponse>;
  /** GET /api/plans/usage/summary - Get usage summary for all plans */
  getPlansUsageSummary: (request: FastifyRequest, reply: FastifyReply) => Promise<PlansUsageSummaryResponse>;
}

/**
 * Reload response.
 */
interface ReloadResponse {
  success: boolean;
  planCount?: number;
  error?: string;
}

/**
 * Quota sync response.
 */
interface QuotaSyncResponse {
  planId: number;
  usage: number;
  synced: boolean;
}

/**
 * Plan usage query parameters.
 */
interface PlanUsageQuery {
  from?: string;
  to?: string;
}

/**
 * History query parameters.
 */
interface HistoryQuery {
  limit?: number;
}

/**
 * Daily plan usage in response.
 */
interface DailyPlanUsageResponse {
  date: string;
  requestCount: number;
}

/**
 * Plan usage report response.
 */
interface PlanUsageReportData {
  planId: number;
  planName: string;
  totalRequests: number;
  limit: number;
  remaining: number;
  percentage: number;
  dateRange: {
    start: string;
    end: string;
  };
  dailyBreakdown: DailyPlanUsageResponse[];
  quotaPeriod: string;
  resetAt: string | null;
}

/**
 * Plan usage response.
 */
interface PlanUsageResponse {
  data: PlanUsageReportData;
  meta: MetaResponse;
}

/**
 * Usage adjustment response data.
 */
interface UsageAdjustmentData {
  planId: number;
  oldValue: number;
  newValue: number;
  adjustmentId: string;
  warning?: string;
}

/**
 * Usage adjustment response.
 */
interface UsageAdjustmentResponse {
  data: UsageAdjustmentData;
  meta: MetaResponse;
}

/**
 * Adjustment history record.
 */
interface AdjustmentHistoryRecord {
  id: string;
  planId: number;
  timestamp: string;
  oldValue: number;
  newValue: number;
  adjustmentType: 'count' | 'percent';
  adjustmentValue: number;
}

/**
 * Adjustment history response.
 */
interface AdjustmentHistoryResponse {
  data: AdjustmentHistoryRecord[];
  meta: MetaResponse & { count: number };
}

/**
 * Plan usage summary item.
 */
interface PlanUsageSummaryItem {
  planId: number;
  planName: string;
  limit: number;
  used: number;
  remaining: number;
  percentage: number;
  quotaPeriod: string;
  resetAt: string | null;
}

/**
 * Plans usage summary response.
 */
interface PlansUsageSummaryResponse {
  data: PlanUsageSummaryItem[];
  meta: MetaResponse & { totalPlans: number; totalRequests: number };
}

/**
 * Create admin route handlers with dependency injection.
 *
 * Creates handlers for admin API endpoints including plan CRUD operations
 * and quota management. The handlers integrate with the plan repository
 * for configuration management and optionally with the quota manager for
 * usage tracking.
 *
 * @param repository - The plan repository for accessing and modifying coding plan configurations
 * @param quotaManager - Optional quota manager for usage tracking and quota operations
 * @param planUsageTracker - Optional plan usage tracker for daily usage tracking
 * @returns An object containing handler methods for admin endpoints
 *
 * @example
 * ```typescript
 * const repository = createPlanRepository('./config.yaml', encryptionKey);
 * const quotaManager = createQuotaManager({ quotaStatePath: './quota-state.json' });
 * const handlers = createAdminHandlers(repository, quotaManager);
 *
 * // Use handlers with Fastify
 * fastify.get('/plans', handlers.listPlans);
 * fastify.post('/plans', handlers.createPlan);
 * fastify.get('/plans/:planId', handlers.getPlan);
 * fastify.put('/plans/:planId', handlers.updatePlan);
 * fastify.delete('/plans/:planId', handlers.deletePlan);
 * fastify.get('/quota/:planId', handlers.getQuotaStatus);
 * fastify.post('/quota/:planId/reset', handlers.resetQuota);
 * ```
 */
// eslint-disable-next-line max-lines-per-function
export function createAdminHandlers(
  repository: IPlanRepository,
  quotaManager?: QuotaManager,
  planUsageTracker?: PlanUsageTracker
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
): AdminHandlers {
  return {
    /**
     * GET /api/plans - List all plans.
     */
    async listPlans(
      request: FastifyRequest,
      _reply: FastifyReply
    ): Promise<PlansSuccessResponse> {
      const plans = await repository.findAll();

      const response: PlansSuccessResponse = {
        data: plans.map((plan) => {
          const quotaState = quotaManager?.getQuotaState(plan.id);
          return toPlanResponse(
            plan,
            quotaState
              ? { used: quotaState.used, lastUpdated: quotaState.lastUpdated }
              : undefined
          );
        }),
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };

      return response;
    },

    /**
     * GET /api/plans/:planId - Get a specific plan.
     */
    async getPlan(
      request: FastifyRequest<{ Params: PlanParams }>,
      _reply: FastifyReply
    ): Promise<PlanSuccessResponse> {
      const planId = parsePlanId(request.params.planId);

      const plan = await repository.findById(planId);

      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      const quotaState = quotaManager?.getQuotaState(planId);
      const response: PlanSuccessResponse = {
        data: toPlanResponse(
          plan,
          quotaState
            ? { used: quotaState.used, lastUpdated: quotaState.lastUpdated }
            : undefined
        ),
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };

      return response;
    },

    /**
     * POST /api/plans - Create a new plan.
     */
    async createPlan(
      request: FastifyRequest<{ Body: z.infer<typeof createPlanBodySchema> }>,
      reply: FastifyReply
    ): Promise<PlanSuccessResponse> {
      // Validate request body
      const validationResult = createPlanBodySchema.safeParse(request.body);
      if (!validationResult.success) {
        throw validationResult.error;
      }

      const input = validationResult.data;

      // Create the plan
      const plan = await repository.save({
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        models: input.models,
        quota: input.quota,
        timeout: input.timeout,
      });

      logger.info('Plan created via API', {
        requestId: request.id,
        planId: plan.id,
        name: plan.name,
      });

      const response: PlanSuccessResponse = {
        data: toPlanResponse(plan),
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };

      void reply.status(201);
      return response;
    },

    /**
     * PUT /api/plans/:planId - Update a plan.
     */
    async updatePlan(
      request: FastifyRequest<{
        Params: PlanParams;
        Body: z.infer<typeof updatePlanBodySchema>;
      }>,
      _reply: FastifyReply
    ): Promise<PlanSuccessResponse> {
      const planId = parsePlanId(request.params.planId);

      // Validate request body
      const bodyValidation = updatePlanBodySchema.safeParse(request.body);
      if (!bodyValidation.success) {
        throw bodyValidation.error;
      }

      const input = bodyValidation.data;

      // Check if plan exists
      const exists = await repository.exists(planId);
      if (!exists) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      // Update the plan
      const plan = await repository.update(planId, input);

      // Update quota manager if quota changed
      if (input.quota?.limit && quotaManager) {
        quotaManager.updatePlanQuota(planId, input.quota.limit);
      }

      logger.info('Plan updated via API', {
        requestId: request.id,
        planId: plan.id,
        name: plan.name,
      });

      const response: PlanSuccessResponse = {
        data: toPlanResponse(plan),
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };

      return response;
    },

    /**
     * DELETE /api/plans/:planId - Delete a plan.
     */
    async deletePlan(
      request: FastifyRequest<{ Params: PlanParams }>,
      reply: FastifyReply
    ): Promise<void> {
      const planId = parsePlanId(request.params.planId);

      const deleted = await repository.delete(planId);

      if (!deleted) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      // Remove from quota manager
      if (quotaManager) {
        quotaManager.removePlan(planId);
      }

      logger.info('Plan deleted via API', {
        requestId: request.id,
        planId,
      });

      void reply.status(204).send();
    },

    /**
     * GET /api/quota/:planId - Get quota status for a plan.
     */
    async getQuotaStatus(
      request: FastifyRequest<{ Params: PlanParams }>,
      _reply: FastifyReply
    ): Promise<QuotaSuccessResponse> {
      const planId = parsePlanId(request.params.planId);

      if (!quotaManager) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Quota management is not enabled'
        );
      }

      const plan = await repository.findById(planId);
      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      const state = quotaManager.getQuotaState(planId);
      if (!state) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Quota state not found for plan'
        );
      }

      const response: QuotaSuccessResponse = {
        data: {
          planId: state.planId,
          used: state.used,
          limit: state.limit,
          remaining: state.limit - state.used,
          period: state.period,
          resetAt: state.resetAt ? state.resetAt.toISOString() : null,
          lastUpdated: state.lastUpdated.toISOString(),
        },
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };

      return response;
    },

    /**
     * POST /api/quota/:planId/reset - Reset quota for a plan.
     */
    async resetQuota(
      request: FastifyRequest<{ Params: PlanParams }>,
      _reply: FastifyReply
    ): Promise<QuotaSuccessResponse> {
      const planId = parsePlanId(request.params.planId);

      if (!quotaManager) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Quota management is not enabled'
        );
      }

      const plan = await repository.findById(planId);
      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      quotaManager.resetQuota(planId);

      logger.info('Quota reset via API', {
        requestId: request.id,
        planId,
      });

      const state = quotaManager.getQuotaState(planId)!;

      const response: QuotaSuccessResponse = {
        data: {
          planId: state.planId,
          used: state.used,
          limit: state.limit,
          remaining: state.limit - state.used,
          period: state.period,
          resetAt: state.resetAt ? state.resetAt.toISOString() : null,
          lastUpdated: state.lastUpdated.toISOString(),
        },
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };

      return response;
    },

    /**
     * POST /api/quota/:planId/sync - Sync quota state with PlanUsageTracker.
     * Called by CLI after set-usage to update running server's QuotaManager.
     */
    async syncQuota(
      request: FastifyRequest<{ Params: PlanParams }>,
      _reply: FastifyReply
    ): Promise<QuotaSyncResponse> {
      const planId = parsePlanId(request.params.planId);

      if (!quotaManager) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Quota management is not enabled'
        );
      }

      if (!planUsageTracker) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Plan usage tracking is not enabled'
        );
      }

      const plan = await repository.findById(planId);
      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      // Reload PlanUsageTracker from disk to get latest data from CLI
      await planUsageTracker.reload();

      // Get current usage from PlanUsageTracker
      const usageData = planUsageTracker.getUsageForQuotaManager(planId);
      const usage = usageData?.used ?? 0;

      // Sync QuotaManager with PlanUsageTracker's usage
      quotaManager.setUsedQuota(planId, usage);

      logger.info('Quota synced via API', {
        requestId: request.id,
        planId,
        usage,
      });

      return {
        planId,
        usage,
        synced: true,
      };
    },

    /**
     * POST /api/reload - Reload configuration.
     */
    async reloadConfig(
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<ReloadResponse> {
      try {
        // Reload plans from repository
        await repository.reload();
        const plans = await repository.findAll();

        // Reinitialize quota manager with new plans
        if (quotaManager) {
          await quotaManager.initialize(plans);
        }

        logger.info('Configuration reloaded via API', {
          requestId: request.id,
          planCount: plans.length,
        });

        return {
          success: true,
          planCount: plans.length,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to reload configuration', error as Error, {
          requestId: request.id,
        });

        void reply.status(500);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    /**
     * GET /api/plans/:planId/usage - Get plan usage report.
     */
    async getPlanUsage(
      request: FastifyRequest<{ Params: PlanParams; Querystring: PlanUsageQuery }>,
      _reply: FastifyReply
    ): Promise<PlanUsageResponse> {
      const planId = parsePlanId(request.params.planId);
      const { from, to } = request.query;

      const plan = await repository.findById(planId);
      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      if (!planUsageTracker) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Plan usage tracking is not enabled'
        );
      }

      // Get usage report with expiresOn/expiresAt support
      const report = planUsageTracker.getUsageReport(
        planId,
        {
          id: plan.id,
          name: plan.name,
          quota: {
            limit: plan.quota.limit,
            period: plan.quota.period,
            expiresOn: plan.expiresOn,
            expiresAt: plan.expiresAt,
          },
        },
        from,
        to
      );

      // Calculate reset date using the tracker's method that respects expiresOn/expiresAt
      const resetAt = planUsageTracker.calculateResetAt(
        plan.quota.period,
        plan.expiresOn,
        plan.expiresAt
      );

      const responseData: PlanUsageReportData = report ? {
        planId: report.planId,
        planName: report.planName,
        totalRequests: report.totalRequests,
        limit: report.limit,
        remaining: report.remaining,
        percentage: report.percentage,
        dateRange: report.dateRange,
        dailyBreakdown: report.dailyBreakdown,
        quotaPeriod: report.quotaPeriod,
        resetAt: report.resetAt?.toISOString() ?? resetAt?.toISOString() ?? null,
      } : {
        planId,
        planName: plan.name,
        totalRequests: 0,
        limit: plan.quota.limit,
        remaining: plan.quota.limit,
        percentage: 0,
        dateRange: {
          start: from ?? new Date().toISOString().split('T')[0]!,
          end: to ?? new Date().toISOString().split('T')[0]!,
        },
        dailyBreakdown: [],
        quotaPeriod: plan.quota.period,
        resetAt: resetAt?.toISOString() ?? null,
      };

      return {
        data: responseData,
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };
    },

    /**
     * POST /api/plans/:planId/usage/adjust - Adjust plan usage.
     */
    async adjustPlanUsage(
      request: FastifyRequest<{ Params: PlanParams; Body: z.infer<typeof usageAdjustmentRequestSchema> }>,
      _reply: FastifyReply
    ): Promise<UsageAdjustmentResponse> {
      const planId = parsePlanId(request.params.planId);

      // Validate request body
      const bodyValidation = usageAdjustmentRequestSchema.safeParse(request.body);
      if (!bodyValidation.success) {
        throw bodyValidation.error;
      }

      const plan = await repository.findById(planId);
      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      if (!planUsageTracker) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Plan usage tracking is not enabled'
        );
      }

      // Calculate new value
      const { count, percent } = bodyValidation.data;
      const newValue = count !== undefined ? count : Math.round((percent! / 100) * plan.quota.limit);
      const adjustmentType = count !== undefined ? 'count' : 'percent';
      const adjustmentValue = count ?? percent!;

      // Perform adjustment
      const result = planUsageTracker.adjustUsage(
        planId,
        newValue,
        plan.quota.limit,
        adjustmentType,
        adjustmentValue
      );

      // Persist changes
      await planUsageTracker.persist();

      logger.info('Plan usage adjusted via API', {
        requestId: request.id,
        planId,
        adjustmentId: result.adjustmentId,
        oldValue: result.oldValue,
        newValue: result.newValue,
      });

      const responseData: UsageAdjustmentData = {
        planId: result.planId,
        oldValue: result.oldValue,
        newValue: result.newValue,
        adjustmentId: result.adjustmentId,
        warning: result.warning,
      };

      return {
        data: responseData,
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
        },
      };
    },

    /**
     * GET /api/plans/:planId/usage/history - Get usage adjustment history.
     */
    async getUsageAdjustmentHistory(
      request: FastifyRequest<{ Params: PlanParams; Querystring: HistoryQuery }>,
      _reply: FastifyReply
    ): Promise<AdjustmentHistoryResponse> {
      const planId = parsePlanId(request.params.planId);
      const { limit = 20 } = request.query;

      const plan = await repository.findById(planId);
      if (!plan) {
        throw createGatewayError('PLAN_NOT_FOUND', `Plan not found: ${planId}`);
      }

      if (!planUsageTracker) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Plan usage tracking is not enabled'
        );
      }

      const history = planUsageTracker.getAdjustmentHistory(planId, limit);

      const responseData: AdjustmentHistoryRecord[] = history.map((a) => ({
        id: a.id,
        planId: a.planId,
        timestamp: a.timestamp.toISOString(),
        oldValue: a.oldValue,
        newValue: a.newValue,
        adjustmentType: a.adjustmentType,
        adjustmentValue: a.adjustmentValue,
      }));

      return {
        data: responseData,
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
          count: responseData.length,
        },
      };
    },

    /**
     * GET /api/plans/usage/summary - Get usage summary for all plans.
     */
    async getPlansUsageSummary(
      request: FastifyRequest,
      _reply: FastifyReply
    ): Promise<PlansUsageSummaryResponse> {
      const plans = await repository.findAll();

      if (!planUsageTracker) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Plan usage tracking is not enabled'
        );
      }

      const summaryData: PlanUsageSummaryItem[] = plans.map((plan) => {
        const used = planUsageTracker.getTotalUsage(plan.id);
        const remaining = plan.quota.limit - used;
        const percentage = plan.quota.limit > 0 ? Math.round((used / plan.quota.limit) * 100) : 0;

        // Calculate reset date using the tracker's method that respects expiresOn/expiresAt
        const resetAt = planUsageTracker.calculateResetAt(
          plan.quota.period,
          plan.expiresOn,
          plan.expiresAt
        );

        return {
          planId: plan.id,
          planName: plan.name,
          limit: plan.quota.limit,
          used,
          remaining,
          percentage,
          quotaPeriod: plan.quota.period,
          resetAt: resetAt?.toISOString() ?? null,
        };
      });

      const totalRequests = summaryData.reduce((sum, s) => sum + s.used, 0);

      return {
        data: summaryData,
        meta: {
          requestId: request.id,
          timestamp: new Date().toISOString(),
          totalPlans: plans.length,
          totalRequests,
        },
      };
    },
  };
}

/**
 * Type exports for request/response.
 */
export type {
  PlanParams,
  PlanResponse,
  PlanSuccessResponse,
  PlansSuccessResponse,
  QuotaStatusResponse,
  QuotaSuccessResponse,
};