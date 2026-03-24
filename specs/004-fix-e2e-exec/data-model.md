# Data Model: Fix E2E Claude Code Execution

**Feature**: 004-fix-e2e-exec
**Date**: 2026-03-24

## Overview

This feature modifies existing request validation types rather than introducing new data entities. The key change is updating the `system` field in Anthropic API requests to support both string and array formats.

## Modified Types

### AnthropicMessageRequest

**Location**: `src/types/anthropic.ts`

**Current Definition**:
```typescript
interface AnthropicMessageRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream?: boolean;
  system?: string;  // ← Currently only string
  temperature?: number;
  top_k?: number;
  top_p?: number;
  stop_sequences?: string[];
  metadata?: { user_id?: string };
}
```

**Updated Definition**:
```typescript
interface AnthropicMessageRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream?: boolean;
  system?: string | AnthropicSystemBlock[];  // ← Now accepts array
  temperature?: number;
  top_k?: number;
  top_p?: number;
  stop_sequences?: string[];
  metadata?: { user_id?: string };
  // Additional fields passed through unchanged
  [key: string]: unknown;
}
```

### AnthropicSystemBlock (New Type)

**Location**: `src/types/anthropic.ts`

**Definition**:
```typescript
interface AnthropicSystemTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicSystemImageBlock {
  type: 'image';
  source: {
    type: 'url' | 'base64';
    media_type: string;
    data: string;
  };
}

type AnthropicSystemBlock = AnthropicSystemTextBlock | AnthropicSystemImageBlock;
```

## Validation Schema Changes

### messageRequestSchema

**Location**: `src/routes/anthropic/handlers.ts`

**Current Schema**:
```typescript
const messageRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional().default(false),
  system: z.string().optional(),  // ← Only string
  // ...
});
```

**Updated Schema**:
```typescript
const systemBlockSchema = z.object({
  type: z.enum(['text', 'image']),
  // Allow additional fields for forward compatibility
}).passthrough();

const messageRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional().default(false),
  // Accept string, array of blocks, or omit entirely
  system: z.union([
    z.string(),
    z.array(systemBlockSchema),
  ]).optional(),
  // Pass through all other fields unchanged
}).passthrough();  // ← Allow additional fields for transparency
```

## Entity Relationships

```
AnthropicMessageRequest
├── model: string
├── messages: AnthropicMessage[]
├── max_tokens: number
├── system: string | AnthropicSystemBlock[]  ← MODIFIED
├── stream?: boolean
├── temperature?: number
├── top_p?: number
├── top_k?: number
├── stop_sequences?: string[]
├── metadata?: { user_id?: string }
└── [additional fields]: unknown  ← NEW: Pass-through support
```

## Validation Rules

### System Field Validation

| Format | Valid | Example |
|--------|-------|---------|
| String | ✅ | `"You are a helpful assistant."` |
| Empty string | ✅ | `""` (treated as missing) |
| Array of text blocks | ✅ | `[{type: "text", text: "..."}]` |
| Array with images | ✅ | `[{type: "text", text: "..."}, {type: "image", source: {...}}]` |
| Empty array | ✅ | `[]` (treated as missing) |
| Missing field | ✅ | Field not present |
| Invalid type (number, etc.) | ❌ | `123` (validation error) |

### Pass-Through Behavior

1. All fields not explicitly validated are passed through unchanged
2. The gateway does NOT modify request body before forwarding
3. Empty arrays/strings are treated as missing (no system prompt)
4. Unknown fields are preserved for upstream provider

## Migration Notes

- No database migration required (file-based config unchanged)
- No API contract changes (backward compatible)
- Existing string-based `system` values continue to work
- New array-based `system` values now supported