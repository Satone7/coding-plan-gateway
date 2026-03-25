# CLI Command Contract

This document defines the command-line interface contract for the `cpg` executable.

## Command Structure

```
cpg <command> [subcommand] [options] [arguments]
```

## Global Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help message |
| `--version` | `-v` | Show version information |
| `--json` | | Output in JSON format |
| `--gateway-url <url>` | | Gateway URL (default: http://localhost:8080) |
| `--config <path>` | `-c` | Path to config directory |

## Commands

### `cpg key` - API Key Management

#### `cpg key create`

Create a new API key.

**Usage**:
```bash
cpg key create --name <name> [--expires <date>] [--json]
```

**Options**:
- `--name <name>` (required): Name for the API key
- `--expires <date>` (optional): Expiration date in YYYY-MM-DD format
- `--json`: Output in JSON format

**Exit Codes**:
- 0: Success
- 1: Invalid arguments or operation failed
- 2: Missing ENCRYPTION_KEY

**Human Output**:
```
API Key created successfully!

  ID: 550e8400-e29b-41d4-a716-446655440000
  Name: My API Key
  Key: cpg_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
  Expires: 2026-12-31

IMPORTANT: Save this key now! It will not be shown again.
```

**JSON Output**:
```json
{
  "success": true,
  "key": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My API Key",
    "plaintextKey": "cpg_1234567890abcdef...",
    "prefix": "cpg_1234",
    "status": "active",
    "createdAt": "2026-03-25T10:30:00.000Z",
    "expiresAt": "2026-12-31T23:59:59.000Z"
  }
}
```

---

#### `cpg key list`

List all API keys.

**Usage**:
```bash
cpg key list [--json]
```

**Human Output**:
```
API Keys:

  ID                                      Name                 Status    Prefix    Created     Expires
  --------------------------------------- -------------------- --------- --------- ----------- -----------
  550e8400-e29b-41d4-a716-446655440000    My API Key           active    cpg_1234  2026-03-25  2026-12-31
  660f9500-f39c-52e5-b827-557766551111    Test Key             disabled  cpg_5678  2026-03-20  N/A

  Total: 2 key(s)
```

**JSON Output**:
```json
{
  "keys": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "My API Key",
      "prefix": "cpg_1234",
      "status": "active",
      "createdAt": "2026-03-25T10:30:00.000Z",
      "expiresAt": "2026-12-31T23:59:59.000Z",
      "lastUsedAt": null
    }
  ],
  "total": 2
}
```

---

#### `cpg key test`

Test if an API key is valid.

**Usage**:
```bash
cpg key test <key> [--json]
```

**Arguments**:
- `<key>` (required): The API key to test

**Human Output (Valid)**:
```
Key: cpg_1234...cdef
Status: valid

  ID: 550e8400-e29b-41d4-a716-446655440000
  Name: My API Key
  Created: 2026-03-25
  Expires: 2026-12-31
```

**Human Output (Invalid)**:
```
Key: cpg_1234...cdef
Status: invalid

Error: Key not found or invalid
```

**JSON Output**:
```json
{
  "prefix": "cpg_1234",
  "status": "valid",
  "key": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My API Key",
    "status": "active",
    "createdAt": "2026-03-25T10:30:00.000Z",
    "expiresAt": "2026-12-31T23:59:59.000Z"
  }
}
```

---

#### `cpg key disable`

Disable an API key.

**Usage**:
```bash
cpg key disable --id <uuid> [--json]
```

**Options**:
- `--id <uuid>` (required): The key ID to disable

**Human Output**:
```
API key disabled successfully.
  ID: 550e8400-e29b-41d4-a716-446655440000
  Name: My API Key
  Status: disabled
```

---

#### `cpg key enable`

Enable a disabled API key.

**Usage**:
```bash
cpg key enable --id <uuid> [--json]
```

**Options**:
- `--id <uuid>` (required): The key ID to enable

---

#### `cpg key delete`

Delete an API key permanently.

**Usage**:
```bash
cpg key delete --id <uuid> [--json]
```

**Options**:
- `--id <uuid>` (required): The key ID to delete

**Human Output**:
```
API key deleted successfully.
  ID: 550e8400-e29b-41d4-a716-446655440000
  Name: My API Key
```

---

### `cpg usage-report` - Usage Reporting

Show usage report for API keys.

**Usage**:
```bash
cpg usage-report [--key-id <uuid>] [--from <date>] [--to <date>] [--json]
```

**Options**:
- `--key-id <uuid>` (optional): Filter by key ID
- `--from <date>` (optional): Start date (YYYY-MM-DD)
- `--to <date>` (optional): End date (YYYY-MM-DD)
- `--json`: Output in JSON format

**Human Output**:
```
Usage Report
============

Date Range: from 2026-03-01 to 2026-03-25
Report Generated: 2026-03-25 10:30:00

Summary by Key:
──────────────────────────────────────────────────────────────────────────────────────
  Key ID         Name                 Requests   Tokens
──────────────────────────────────────────────────────────────────────────────────────
  550e8400...    My API Key              1523    125000
  660f9500...    Test Key                 523     45000
──────────────────────────────────────────────────────────────────────────────────────
  TOTAL                                     2046    170000

Token Breakdown:
  Input Tokens:  102,000
  Output Tokens: 68,000
  Total Tokens:  170,000
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://localhost:8080` | Gateway URL for notifications |
| `CONFIG_PATH` | `./config` | Path to config directory |
| `ENCRYPTION_KEY` | (required) | Key for encrypting API keys |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (invalid arguments, operation failed) |
| 2 | Configuration error (missing ENCRYPTION_KEY) |
| 3 | Network error (gateway unreachable) |
| 4 | Storage error (file not accessible) |