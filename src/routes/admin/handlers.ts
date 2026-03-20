/**
 * Admin route handlers for plan CRUD and quota operations.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IPlanRepository } from '@/services/plan-repository';
import type { QuotaManager } from '@/services/quota-manager';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';

/**
 * Request with planId parameter.
 */
interface PlanParams {
  planId: string;
}

/**
 * UUID validation schema.
 */
const uuidSchema = z.string().uuid();

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
  timeout: z.number().int().min(1000).max(300000).optional(),
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
  timeout: z.number().int().min(1000).max(300000).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

/**
 * Plan response schema (without sensitive data).
 */
interface PlanResponse {
  id: string;
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
  planId: string;
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
 * Transform a CodingPlan to a response object (without sensitive data).
 */
function toPlanResponse(
  plan: {
    id: string;
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
 */
interface AdminHandlers {
  listPlans: (request: FastifyRequest, reply: FastifyReply) => Promise<PlansSuccessResponse>;
  getPlan: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<PlanSuccessResponse>;
  createPlan: (request: FastifyRequest<{ Body: z.infer<typeof createPlanBodySchema> }>, reply: FastifyReply) => Promise<PlanSuccessResponse>;
  updatePlan: (request: FastifyRequest<{ Params: PlanParams; Body: z.infer<typeof updatePlanBodySchema> }>, reply: FastifyReply) => Promise<PlanSuccessResponse>;
  deletePlan: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<void>;
  getQuotaStatus: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<QuotaSuccessResponse>;
  resetQuota: (request: FastifyRequest<{ Params: PlanParams }>, reply: FastifyReply) => Promise<QuotaSuccessResponse>;
}

/**
 * Create admin handlers with repository dependency injection.
 */
// eslint-disable-next-line max-lines-per-function
export function createAdminHandlers(
  repository: IPlanRepository,
  quotaManager?: QuotaManager
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
      const { planId } = request.params;

      // Validate planId
      const validationResult = uuidSchema.safeParse(planId);
      if (!validationResult.success) {
        throw createGatewayError('INVALID_REQUEST', 'Invalid plan ID format', {
          field: 'planId',
        });
      }

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
      const { planId } = request.params;

      // Validate planId
      const idValidation = uuidSchema.safeParse(planId);
      if (!idValidation.success) {
        throw createGatewayError('INVALID_REQUEST', 'Invalid plan ID format', {
          field: 'planId',
        });
      }

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
      const { planId } = request.params;

      // Validate planId
      const validationResult = uuidSchema.safeParse(planId);
      if (!validationResult.success) {
        throw createGatewayError('INVALID_REQUEST', 'Invalid plan ID format', {
          field: 'planId',
        });
      }

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
      const { planId } = request.params;

      // Validate planId
      const validationResult = uuidSchema.safeParse(planId);
      if (!validationResult.success) {
        throw createGatewayError('INVALID_REQUEST', 'Invalid plan ID format', {
          field: 'planId',
        });
      }

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
      const { planId } = request.params;

      // Validate planId
      const validationResult = uuidSchema.safeParse(planId);
      if (!validationResult.success) {
        throw createGatewayError('INVALID_REQUEST', 'Invalid plan ID format', {
          field: 'planId',
        });
      }

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