import 'dotenv/config';

import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import {
  CLAUDE_HOME_CONFIG,
  getConfiguredE2EProviders,
  renderE2EConfigYaml,
} from '../../src/e2e/config';

async function main(): Promise<void> {
  const projectRoot = resolve(__dirname, '../..');
  const e2eRoot = join(projectRoot, 'e2e');
  const claudeHomeRoot = join(e2eRoot, 'claude-home');
  const claudeConfigRoot = join(claudeHomeRoot, '.claude');
  const runtimeRoot = join(e2eRoot, 'runtime');
  const gatewayPort = process.env.E2E_GATEWAY_PORT ?? '8081';

  const providers = getConfiguredE2EProviders(process.env);
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const defaultModel = enabledProviders[0]?.testModel;

  if (!defaultModel) {
    throw new Error(
      'No E2E providers are configured. Set at least one provider API key in .env before running e2e:start.'
    );
  }

  await mkdir(claudeConfigRoot, { recursive: true });
  await mkdir(join(claudeConfigRoot, 'logs'), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });

  await writeFile(
    join(e2eRoot, 'test-config.yaml'),
    renderE2EConfigYaml(providers),
    'utf-8'
  );

  await writeFile(
    join(claudeHomeRoot, '.claude.json'),
    `${JSON.stringify(CLAUDE_HOME_CONFIG, null, 2)}\n`,
    'utf-8'
  );

  await writeFile(
    join(runtimeRoot, 'providers.json'),
    `${JSON.stringify({ gatewayPort, providers }, null, 2)}\n`,
    'utf-8'
  );

  await writeFile(
    join(runtimeRoot, 'e2e.env'),
    [
      `E2E_GATEWAY_PORT=${gatewayPort}`,
      `E2E_DEFAULT_MODEL=${defaultModel}`,
      `E2E_ENABLED_PROVIDERS=${enabledProviders.map((provider) => provider.providerId).join(',')}`,
      '',
    ].join('\n'),
    'utf-8'
  );

  console.log(`Prepared E2E config for providers: ${enabledProviders.map((provider) => provider.providerId).join(', ')}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
