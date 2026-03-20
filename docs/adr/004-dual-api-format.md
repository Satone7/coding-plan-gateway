# ADR-004: Dual API Format Support (OpenAI + Anthropic)

## Status

Accepted

## Context

Users want to use the gateway with different AI tools:
- Claude Code expects Anthropic API format
- Cursor and other tools may expect OpenAI API format
- Users have multiple subscriptions with different native formats

The gateway must provide transparent integration without requiring users to modify their tool configurations.

## Decision

Provide both API endpoints:
- `/v1/chat/completions` - OpenAI-compatible format
- `/v1/messages` - Anthropic-compatible format

Both endpoints accept requests and return responses in their respective formats, with internal transformation to/from a unified representation.

## Rationale

1. **Tool compatibility**: Maximum compatibility with existing AI tools
2. **Transparent integration**: No modification required in user tools
3. **Flexibility**: Users can choose their preferred tool
4. **Provider agnostic**: Gateway handles format differences internally

## API Mapping

### OpenAI Format (`/v1/chat/completions`)

```json
// Request
{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true,
  "max_tokens": 1024
}

// Response
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "Hi!"},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 5, "completion_tokens": 2}
}
```

### Anthropic Format (`/v1/messages`)

```json
// Request
{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 1024,
  "stream": true
}

// Response
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "Hi!"}],
  "usage": {"input_tokens": 5, "output_tokens": 2}
}
```

## Alternatives Considered

### Single Format with Client Configuration
- **Pros**: Simpler implementation
- **Cons**: Requires users to configure tools differently
- **Verdict**: Rejected - poor user experience

### Auto-Detect Format
- **Pros**: Single endpoint
- **Cons**: Ambiguity in format detection, error-prone
- **Verdict**: Rejected - explicit endpoints are clearer

### Only OpenAI Format
- **Pros**: Widely supported
- **Cons**: Claude Code uses Anthropic format natively
- **Verdict**: Rejected - breaks Claude Code compatibility

## Consequences

### Positive
- Works with Claude Code, Cursor, and other tools
- No user configuration changes required
- Clear endpoint semantics

### Negative
- More code for transformation
- Need to maintain both format implementations
- Streaming requires dual implementation

### Implementation

```typescript
// Request transformation
function transformOpenAIToInternal(req: OpenAIRequest): InternalRequest
function transformAnthropicToInternal(req: AnthropicRequest): InternalRequest

// Response transformation
function transformInternalToOpenAI(res: InternalResponse): OpenAIResponse
function transformInternalToAnthropic(res: InternalResponse): AnthropicResponse

// Streaming transformations for SSE events
function* transformOpenAIStream(events: AsyncIterable<InternalEvent>): AsyncIterable<OpenAIEvent>
function* transformAnthropicStream(events: AsyncIterable<InternalEvent>): AsyncIterable<AnthropicEvent>
```

## References

- FR-002: System MUST provide OpenAI-compatible API endpoint
- FR-003: System MUST provide Anthropic-compatible API endpoint
- FR-009: System MUST support streaming responses for both formats
- SC-005: Users can switch between AI tools without changing configuration