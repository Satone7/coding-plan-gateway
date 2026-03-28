# Feature Specification: Model Alias Configuration

**Feature Branch**: `014-model-alias-config`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "将模型别名的设置从硬编码中转换成config.yaml文件中配置，在config.yaml中新增一个与plans同级别的配置项，专门用来配置模型别名。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Model Aliases via Config File (Priority: P1)

As a system administrator, I want to define model aliases in the configuration file instead of modifying code, so that I can add or modify model mappings without redeploying the application.

**Why this priority**: This is the core value proposition - moving configuration from hardcoded to file-based enables flexibility and reduces maintenance overhead. Without this, users must modify source code to change aliases.

**Independent Test**: Can be tested by updating config.yaml with new aliases and verifying that the gateway correctly resolves those aliases without code changes or restart.

**Acceptance Scenarios**:

1. **Given** a config.yaml with `modelAliases` section containing `minimax-m2.5: MiniMax-M2.5`, **When** a request uses model `minimax-m2.5`, **Then** the request is routed to a plan that supports `MiniMax-M2.5`
2. **Given** a config.yaml without `modelAliases` section, **When** the system starts, **Then** it should use an empty alias map (backward compatible)
3. **Given** a config.yaml with invalid alias format, **When** the system starts, **Then** it should log a warning and continue with empty aliases

---

### User Story 2 - Hot-Reload Model Aliases (Priority: P2)

As a system administrator, I want model alias changes to take effect after configuration reload without restarting the gateway, so that I can update aliases with minimal service disruption.

**Why this priority**: Enables operational flexibility - administrators can update aliases during runtime without downtime.

**Independent Test**: Can be tested by adding new aliases via config file and triggering a reload, then verifying the new aliases work immediately.

**Acceptance Scenarios**:

1. **Given** new aliases added to config.yaml, **When** a reload is triggered, **Then** the new aliases become active immediately
2. **Given** aliases removed from config.yaml, **When** a reload is triggered, **Then** the removed aliases no longer resolve

---

### User Story 3 - List Available Model Aliases (Priority: P3)

As a system administrator, I want to view all configured model aliases through the API, so that I can verify the current alias configuration.

**Why this priority**: Provides visibility into system configuration for debugging and auditing purposes.

**Independent Test**: Can be tested by making an API call to retrieve alias configuration and verifying the response matches config.yaml.

**Acceptance Scenarios**:

1. **Given** model aliases configured in config.yaml, **When** querying the `/api/config` or similar endpoint, **Then** the response includes all configured aliases

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST load model aliases from config.yaml file at startup
- **FR-002**: System MUST support a top-level `modelAliases` configuration key in config.yaml (same level as `plans`)
- **FR-003**: System MUST use the configured aliases for model name resolution during request routing
- **FR-004**: System MUST fall back to an empty alias map if `modelAliases` is not present in config.yaml (backward compatibility)
- **FR-005**: System MUST validate alias configuration format during startup and log warnings for invalid entries
- **FR-006**: System MUST apply alias configuration changes on hot-reload without requiring application restart
- **FR-007**: System MUST support alias mappings where the alias (key) maps to a canonical model name (value)

### Key Entities *(include if data involved)*

- **ModelAlias**: A mapping from an alias name to a canonical model name, defined in configuration
- **ModelAliasConfig**: The top-level configuration section containing all model aliases

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Model aliases defined in config.yaml are correctly used for request routing within 5 seconds of startup
- **SC-002**: System maintains 100% backward compatibility - existing deployments without `modelAliases` continue to work unchanged
- **SC-003**: Configuration reload applies alias changes within the same timeframe as other config changes (existing reload mechanism)
- **SC-004**: Zero downtime for alias updates when using hot-reload (existing reload behavior preserved)

---

## Assumptions *(optional)*

- The existing config.yaml schema will be extended with a new top-level key
- The existing hot-reload mechanism will apply to the new alias configuration
- The config.yaml file format will remain YAML
- Alias format in config will follow the same key-value pattern as the existing hardcoded MODEL_ALIASES

---

## Dependencies *(optional)*

- Depends on the existing model-resolver service (src/services/model-resolver.ts)
- Depends on the existing config loading mechanism (src/config/index.ts)
- Depends on the existing hot-reload functionality

---

## Clarifications

### Session 2026-03-27

- Q: How should configured aliases relate to hardcoded aliases? → A: Config completely replaces hardcoded (config is the sole source of truth)
- Q: How should circular aliases be handled? → A: Validate at startup and reject - fail with error message
- Q: Should default examples be provided? → A: Provide example config - include common aliases as examples in default config.yaml
- Q: Should alias resolution logging be enhanced? → A: Keep existing logging behavior - use existing debug level