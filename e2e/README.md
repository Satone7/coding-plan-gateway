# E2E Docker Environment

This E2E setup runs the gateway and Claude Code CLI in Docker, with real upstream provider coverage driven by secrets from the repository-root `.env`.

## What it covers

- Real `claude` CLI traffic through the gateway
- Gateway CLI/key-management smoke checks
- Real provider requests for each built-in provider:
  - `zhipu`
  - `volcengine`
  - `ali`
  - `deepseek`

Plus two NVIDIA scenarios (NVIDIA is OpenAI-only, so they use different paths):

- **`nvidia-litellm`** — Claude Code (Anthropic) reaches NVIDIA through the
  external LiteLLM converter. The gateway forwards `/v1/messages` to a plan
  whose `baseUrl` points at LiteLLM (`http://192.168.100.1:4000`); LiteLLM does
  the Anthropic→OpenAI translation and calls NVIDIA. Covered by
  `claude-code-providers.test.ts`. Needs `LITELLM_MASTER_KEY`.
- **`nvidia` (direct)** — the NVIDIA preset itself (`baseUrl: ''` OpenAI-only
  sentinel, `dynamicModels`). Driven by direct OpenAI `/v1/chat/completions`
  requests from the host (Claude Code cannot use it). Covered by
  `nvidia-openai-direct.test.ts`. Needs `NVIDIA_API_KEY` and the `gateway-e2e`
  container must be able to reach `integrate.api.nvidia.com` (host Mihomo TUN
  proxy must cover docker bridge traffic).

If a provider API key is missing from `.env`, that provider's real-request test is skipped and called out explicitly in the E2E test output.

## Files

Tracked:

- `docker-compose.e2e.yml`
- `e2e/Dockerfile`
- `e2e/README.md`
- `e2e/claude-home/.gitkeep`
- `e2e/runtime/.gitkeep`

Generated at runtime and ignored by git:

- `e2e/test-config.yaml`
- `e2e/runtime/e2e.env`
- `e2e/runtime/providers.json`
- `e2e/claude-home/.claude.json`
- `e2e/claude-home/.claude/`

## Configuration

1. Copy `.env.example` to `.env`
2. Fill in at least one real provider API key
3. Set `E2E_ENCRYPTION_KEY` or reuse `ENCRYPTION_KEY`

Relevant `.env` entries:

```bash
E2E_GATEWAY_PORT=8081
E2E_ENCRYPTION_KEY=
ZHIPU_API_KEY=
VOLCENGINE_API_KEY=
ALI_API_KEY=
DEEPSEEK_API_KEY=
NVIDIA_API_KEY=         # NVIDIA preset OpenAI-direct scenario
LITELLM_MASTER_KEY=     # NVIDIA via LiteLLM converter scenario
```

## Start and stop

```bash
npm run e2e:start
npm run e2e:status
npm run e2e:stop
npm run e2e:reset
```

`e2e:start` does three things before Docker starts:

1. reads `.env`
2. generates `e2e/test-config.yaml` with only enabled providers
3. prepares a dedicated Claude Code home under `e2e/claude-home/`

## Run tests

```bash
npm run test:e2e
```

Expected result:

- Docker/image smoke tests run when Docker is available
- gateway/CLI tests run when the E2E environment is up
- provider tests run only for providers with configured API keys
- missing providers are reported as skipped

## Manual Claude Code check

Create a gateway API key:

```bash
docker exec gateway-e2e cpg key create --name "Manual E2E" --json
```

Then run Claude Code through the gateway:

```bash
docker exec -it claude-code-e2e env ANTHROPIC_API_KEY=<gateway-key> claude -p "Say hello in one word"
```

To force a specific provider, override the model with one of the unique test models:

- `glm-5-turbo` for `zhipu`
- `ark-code-latest` for `volcengine`
- `qwen3.6-plus` for `ali`
- `deepseek-v4-flash` for `deepseek`
- `glm-5.2` for NVIDIA via LiteLLM (Anthropic path through the converter)

Example:

```bash
docker exec -it claude-code-e2e env ANTHROPIC_API_KEY=<gateway-key> ANTHROPIC_MODEL=deepseek-v4-flash claude -p "Reply with one word"
```

NVIDIA direct (OpenAI path, from the host — Claude Code cannot use it):

```bash
curl -s http://localhost:${E2E_GATEWAY_PORT:-8081}/api/v1/chat/completions \
  -H "Authorization: Bearer <gateway-key>" -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.1-8b-instruct","messages":[{"role":"user","content":"hi"}],"max_tokens":16}'
```

## Notes

- The gateway listens on `http://localhost:${E2E_GATEWAY_PORT:-8081}` on the host.
- Inside Docker, Claude Code talks to `http://gateway-e2e:8080/api`.
- Secrets stay in `.env`; generated E2E config files are ignored by git.
