# Quickstart: Model Alias Configuration

## Overview

This feature allows you to configure model aliases in `config.yaml` instead of having them hardcoded in the application.

## Adding Model Aliases

Edit your `config.yaml` file and add a `modelAliases` section at the top level (same level as `plans`):

```yaml
version: "1.0"

# Model aliases configuration
modelAliases:
  # Your alias mappings here
  minimax-m2.5: MiniMax-M2.5
  gpt-4: gpt-4-turbo

plans:
  # ... your existing plan configuration
```

## Format

The `modelAliases` section is a simple key-value map:

```yaml
modelAliases:
  alias-name: canonical-model-name
  another-alias: another-canonical-name
```

- **Key** (alias): The name users might send in their requests
- **Value** (canonical): The actual model name as defined in your plan's `models` list

## Examples

### Basic Usage

```yaml
modelAliases:
  minimax-m2.5: MiniMax-M2.5
```

Now when a user requests `minimax-m2.5`, it will be resolved to `MiniMax-M2.5` for routing purposes.

### Multiple Aliases

```yaml
modelAliases:
  # GPT aliases
  gpt-4: gpt-4-turbo
  gpt-3.5-turbo: gpt-3.5-turbo-0125

  # Claude aliases
  claude-3: claude-3-opus-20240229
  claude-3-sonnet: claude-3-sonnet-20240229

  # MiniMax aliases
  minimax-m2.5: MiniMax-M2.5
  minimax-m2: MiniMax-M2
```

## Without Aliases (Backward Compatible)

If you don't add `modelAliases` to your config, the system works exactly as before - no aliases are applied.

```yaml
version: "1.0"

# No modelAliases section - this is fine!

plans:
  - id: 1
    name: "My Plan"
    # ... rest of config
```

## Hot Reload

After editing `config.yaml`, trigger a reload to apply changes without restarting:

```bash
npm run reload
```

The new aliases will be active immediately.

## Validation

The system validates your aliases at startup:

- **Circular alias detection**: If `a → b` and `b → a`, startup will fail
- **Self-reference detection**: If `a → a`, startup will fail
- **Empty values**: Aliases with empty canonical names are rejected

If there's a validation error, you'll see a clear error message and the server won't start.

## Troubleshooting

### Alias not working

1. Check that the canonical name exactly matches a model in your plan's `models` list
2. Make sure the alias is lowercase (aliases are case-insensitive)
3. Check logs for alias resolution debug messages

### Server won't start

Look for circular alias errors in the console. Check your `modelAliases` section for:
- Aliases pointing to each other in a loop
- Aliases pointing to themselves

## Complete Example

```yaml
version: "1.0"

modelAliases:
  minimax-m2.5: MiniMax-M2.5
  minimax-m2: MiniMax-M2
  gpt-4: gpt-4-turbo

plans:
  - id: 1
    name: "Ark Coding Plan"
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding"
    apiKey: "YOUR_API_KEY"
    models:
      - "ark-code-latest"
      - "MiniMax-M2.5"
      - "kimi-k2.5"
    quota:
      limit: 90000
      period: "monthly"
    timeout: 180000
    status: "active"
```