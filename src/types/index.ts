/**
 * Type exports for coding-plan-gateway.
 * Re-exports all types from individual type modules.
 */

// Coding plan types
export type {
  QuotaPeriod,
  PlanStatus,
  QuotaConfig,
  CodingPlan,
  CreateCodingPlanInput,
  UpdateCodingPlanInput,
} from './coding-plan';

// Quota types
export type {
  QuotaState,
  QuotaUpdate,
  QuotaStatusResponse,
} from './quota';

export {
  calculateRemaining,
  isQuotaExhausted,
  createInitialQuotaState,
  calculateResetAt,
} from './quota';

// Gateway request types
export type {
  MessageRole,
  ContentBlock,
  TextContentBlock,
  ImageContentBlock,
  GatewayMessage,
  GatewayRequest,
  GatewayResponse,
  GatewayStreamChunk,
  RoutingContext,
  GatewayErrorCode,
  GatewayError,
} from './gateway-request';

export { createGatewayError } from './gateway-request';

// OpenAI types
export type {
  OpenAIMessageRole,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChoice,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  Usage,
  ModelsResponse,
  Model,
  OpenAIError,
} from './openai';

export { isOpenAIRequest } from './openai';

// Anthropic types
export type {
  AnthropicMessageRole,
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicUsage,
  AnthropicMessageStart,
  AnthropicContentBlockStart,
  AnthropicContentBlockDelta,
  AnthropicContentBlockStop,
  AnthropicMessageDelta,
  AnthropicMessageStop,
  AnthropicStreamEvent,
  AnthropicError,
} from './anthropic';

export { isAnthropicRequest } from './anthropic';

// API Key types
export type {
  ApiKeyStatus,
  ApiKey,
  ApiKeyStorage,
  CreateApiKeyInput,
} from './api-key';

export {
  apiKeyStatusSchema,
  apiKeySchema,
  apiKeyStorageSchema,
  createApiKeyInputSchema,
} from './api-key';

// Usage types
export type {
  UsageRecord,
  DailyUsage,
  DateRange,
  UsageReport,
  UsageDataStorage,
  UsageRecordData,
} from './usage';

export {
  usageRecordSchema,
  dailyUsageSchema,
  dateRangeSchema,
  usageReportSchema,
  usageRecordDataSchema,
  usageDataStorageSchema,
} from './usage';

// CLI types
export type {
  CliContext,
  ParsedArgs,
  OutputFormatter,
  TestKeyResult,
  CliError,
  EnrichedUsageReport,
  UsageTotals,
  PlanUsageReportDisplay,
  PlanUsageSummaryDisplay,
  AdjustmentResultDisplay,
} from './cli';

export {
  CLI_EXIT_CODES,
  CLI_ENV_VARS,
  DEFAULT_GATEWAY_URL,
  CLI_VERSION,
} from './cli';

// Plan usage types
export type {
  PlanUsageRecord,
  DailyPlanUsage,
  PlanUsageReport,
  UsageAdjustmentHistory,
  PlanUsageDataStorage,
  PlanUsageRecordData,
  AdjustmentHistoryStorage,
  AdjustmentRecordData,
  PlanUsageSummary,
} from './plan-usage';

export {
  planUsageRecordSchema,
  dailyPlanUsageSchema,
  planUsageRecordDataSchema,
  planUsageDataStorageSchema,
  adjustmentRecordDataSchema,
  adjustmentHistoryStorageSchema,
  usageAdjustmentRequestSchema,
} from './plan-usage';