# Configuration Migration System Design

> Date: 2026-04-11
> Status: Approved

## Problem

When the software updates and the configuration format changes, users' existing config files become incompatible, causing startup failures. Currently, config migrations are "opportunistic" (detect old formats and convert in-place on every load) with no version ordering guarantees. This is fragile and cannot handle complex multi-step format changes correctly.

## Solution

Implement a **versioned, chain-style migration system** similar to database migrations. Each config format change gets a version bump with a dedicated migration function. On startup, the system detects the config version and runs migrations sequentially from the current version to the latest, then writes back the migrated config.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Migration trigger | Automatic on startup | Zero user intervention required |
| Backup strategy | Auto-backup before each migration | Users can manually roll back if needed |
| Version numbering | Independent integer (v1, v2, v3...) | Decoupled from package.json, simple and clear |
| Existing migrations | Refactor into v0->v1 | Unify all migrations under one framework |
| Migration failure | Refuse to start, print clear error | Fail-fast prevents silent data corruption |

## Version Numbering

- Format: integer, `v1`, `v2`, `v3`... independent of `package.json` version.
- The `version` field in the config file holds this value.
- Current value is `"1.0"` which maps to `v1` after migration.
- Missing `version` field means `v0` (oldest unversioned config).
- `version` > `LATEST_CONFIG_VERSION` means config comes from a newer software version; refuse to start.

## Migration Interface

```typescript
interface ConfigMigration {
  version: number;
  description: string;
  migrate(config: unknown): unknown;
}
```

### Migration Registry

An ordered array in `src/config/migrations/registry.ts`, sorted by version ascending:

```typescript
const migrations: ConfigMigration[] = [
  { version: 1, description: '...', migrate: migrateV0ToV1 },
  { version: 2, description: '...', migrate: migrateV1ToV2 },
];
```

### Execution Engine

```typescript
function runMigrations(rawConfig: unknown, fromVersion: number): unknown {
  const applicable = migrations.filter(m => m.version > fromVersion);
  let config = rawConfig;
  for (const migration of applicable) {
    config = migration.migrate(config);
    config.version = migration.version;
  }
  return config;
}
```

## Startup Flow

```
Read config file (YAML/JSON)
    |
Parse to raw object (no Zod validation yet)
    |
Detect config version (version field)
    |
version === LATEST? ---yes--> Skip migration, normal load
    | no
version > LATEST? ---yes--> Refuse to start with error message
    | no (version < LATEST)
Backup original file (config.yaml.v{old_version}.bak)
    |
Run chain migration (v{old} -> v{old+1} -> ... -> v{latest})
    |
Write migrated config back to file (overwrite)
    |
Normal Zod validation + load
```

## Backup Strategy

- Backup created before migration runs.
- File name format: `config.yaml.v{old_version}.bak`.
- If backup with same name exists, append sequence number: `config.yaml.v{old_version}.bak.1`.
- Backup contains the original un-migrated content.

## Write-back Behavior

- Migrated config written back in YAML format using `yaml.dump()`.
- Note: YAML comments in the original file will be lost (inherent limitation of YAML library).
- Startup log records: `Config migrated from v{old} to v{latest}. Backup: {backup_path}`.

## Directory Structure

```
src/config/migrations/
  types.ts             # ConfigMigration interface
  registry.ts          # Migration registry + execution engine
  detect-version.ts    # Version detection logic
  v0-to-v1.ts          # v0->v1: UUID->int + period string->structured
  v1-to-v2.ts          # v1->v2: (placeholder for future changes)
```

## Refactoring Existing Migrations

The v0 -> v1 migration consolidates two existing opportunistic migrations:

1. **UUID to integer ID** (from `src/migration/uuid-to-int.ts`): detect UUID-format `id` fields, replace with sequential integers.
2. **Period string to structured object** (from `src/utils/quota-period-migration.ts`): `'daily'` -> `{ type: '5h', windowHours: 5, sliding: true }`, `'monthly'` -> `{ type: 'monthly', expiresOn: N }`, `'total'` -> `{ type: 'total' }`.
3. **Add `version: 1`** to the config object.

### Refactoring Scope

- Extract migration logic from `src/utils/quota-period-migration.ts` into `v0-to-v1.ts`.
- Extract migration logic from `src/migration/uuid-to-int.ts` into `v0-to-v1.ts`.
- Remove `FilePlanRepository.migratePlans()` call; migration is now handled by the startup engine.
- Legacy `expiresOn`/`expiresAt` fields in Zod schema can be removed (v1 config no longer needs them).
- Original files may be kept as re-exports for backward compatibility or removed entirely.

> Note: Current users' configs are already in v1 format (existing opportunistic migrations have already run). The framework's value is in handling future config changes cleanly.

## Adding Future Migrations

When a developer needs to change the config format:

1. Increment `LATEST_CONFIG_VERSION` in `src/config/defaults.ts`.
2. Create new migration file (e.g., `src/config/migrations/v1-to-v2.ts`).
3. Register it in `registry.ts` (append to the `migrations` array).
4. Update `configSchema` in `src/config/schema.ts` to reflect the new format.
5. Update `config.yaml.example` to show the new format.

### Constraints

- Migration functions must be **idempotent** (safe to run on already-migrated configs).
- Migration functions operate on raw JS objects, not Zod-validated types.
- Migration functions must have **no side effects** (no file I/O, no network calls).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Config version > LATEST | Refuse to start. Error: "Config version {v} is newer than supported version {latest}. Please update the software." |
| Migration function throws | Refuse to start. Error: "Migration to v{n} failed: {message}. Backup at {path}." |
| Config file missing `version` | Treat as v0, run all migrations. |
| Config file unreadable | Fail with existing error handling (unchanged). |
| Backup file write fails | Abort migration, refuse to start. Original config untouched. |
