import { execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getConfiguredE2EProviders, type ConfiguredE2EProvider } from '@/e2e/config';
import { config as loadDotenv } from 'dotenv';

const PROJECT_ROOT = process.cwd();
const E2E_RUNTIME_PROVIDER_FILE = join(PROJECT_ROOT, 'e2e', 'runtime', 'providers.json');
const DOTENV_PATH = join(PROJECT_ROOT, '.env');

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isContainerRunning(name: string): boolean {
  try {
    const result = execSync(`docker ps --filter "name=${name}" --filter "status=running" -q`, {
      encoding: 'utf-8',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export function execInContainer(
  containerName: string,
  command: string[],
  extraEnv: Record<string, string> = {}
): { stdout: string; stderr: string; exitCode: number } {
  const envArgs = Object.entries(extraEnv).map(([key, value]) => `${key}=${value}`);

  try {
    const stdout = execFileSync(
      'docker',
      ['exec', containerName, 'env', ...envArgs, ...command],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

export function execInGateway(command: string[]): { stdout: string; stderr: string; exitCode: number } {
  return execInContainer(process.env.E2E_CONTAINER_NAME || 'gateway-e2e', command);
}

export function execInClaudeCode(
  command: string[],
  extraEnv: Record<string, string> = {}
): { stdout: string; stderr: string; exitCode: number } {
  return execInContainer('claude-code-e2e', command, extraEnv);
}

export function extractLastJson(output: string): unknown {
  const lines = output.trim().split('\n');

  let jsonStartIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith('{"timestamp"')) {
      jsonStartIndex = i + 1;
    } else {
      break;
    }
  }

  let startIndex = -1;
  for (let i = jsonStartIndex; i < lines.length; i++) {
    if ((lines[i]?.trim() ?? '') === '{') {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    throw new Error('No JSON object found in output');
  }

  let braceCount = 0;
  let endIndex = -1;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const char of line) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (braceCount === 0 && i > startIndex) {
        endIndex = i;
        break;
      }
    }
    if (endIndex !== -1) break;
  }

  if (endIndex === -1) {
    throw new Error('No closing brace found for JSON object');
  }

  return JSON.parse(lines.slice(startIndex, endIndex + 1).join('\n'));
}

export function createGatewayApiKey(name: string): string {
  const result = execInGateway(['cpg', 'key', 'create', '--name', name, '--json']);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create E2E API key');
  }
  const parsed = extractLastJson(result.stdout) as { key: { plaintextKey: string } };
  return parsed.key.plaintextKey;
}

export function loadE2EProviders(): ConfiguredE2EProvider[] {
  if (existsSync(E2E_RUNTIME_PROVIDER_FILE)) {
    const runtime = JSON.parse(readFileSync(E2E_RUNTIME_PROVIDER_FILE, 'utf-8')) as {
      providers: ConfiguredE2EProvider[];
    };
    return runtime.providers;
  }

  loadDotenv({ path: DOTENV_PATH });
  return getConfiguredE2EProviders(process.env);
}
