# ADR-002: File-Based Configuration Storage

## Status

Accepted

## Context

Users need to configure multiple coding plans with their settings including:
- Plan name and identifier
- Base URL for API endpoint
- API key for authentication
- Supported models list
- Quota limits and current usage

Configuration must:
- Persist across restarts
- Be human-readable and editable
- Support hot-reloading without restart
- Be version-controllable

## Decision

Store configuration in a YAML file with hot-reload support via file watcher or API endpoint.

## Rationale

1. **Human-readable**: YAML is easy to read and edit manually
2. **Version control**: Configuration can be committed to git
3. **No database**: Eliminates dependency on external storage
4. **Hot-reload**: Changes take effect without restart
5. **Backup/restore**: Simple file copy operations
6. **Schema validation**: Tools like yamllint can validate structure

## Alternatives Considered

### JSON File
- **Pros**: Native JavaScript support, widely used
- **Cons**: Less readable, no comments
- **Verdict**: Rejected - YAML preferred for readability and comments

### SQLite Database
- **Pros**: Structured queries, transactions, indexing
- **Cons**: Additional dependency, less transparent
- **Verdict**: Rejected - over-engineering for simple configuration

### Environment Variables
- **Pros**: Standard 12-factor app approach
- **Cons**: Complex for nested data, hard to manage multiple plans
- **Verdict**: Rejected - suitable for secrets only, not configuration

## Consequences

### Positive
- Simple backup and restore
- Easy to debug configuration issues
- Can be version-controlled
- No database setup required
- Hot-reload enables seamless updates

### Negative
- Not suitable for concurrent writes (single-user mitigates this)
- File corruption risk (mitigated by validation and backups)
- No transaction support

### Implementation Details

```yaml
# config.yaml
version: "1.0"
plans:
  - id: "plan-001"
    name: "Kimi Subscription"
    baseUrl: "https://api.moonshot.cn/v1"
    apiKey: "${KIMI_API_KEY}"  # Environment variable reference
    models: ["kimi-k2.5", "moonshot-v1-8k"]
    quota:
      limit: 1000000
      used: 150000
      period: "monthly"
```

## References

- FR-008: System MUST persist configuration across restarts
- FR-012: System MUST support hot-reloading of configuration
- FR-013: System MUST validate configuration before applying changes