/**
 * E2E tests for Docker CLI execution.
 * Tests the CLI functionality inside Docker containers.
 *
 * These tests require:
 * - Docker to be installed and running
 * - The gateway Docker image to be built
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';

// Check if Docker is available
function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Check if the gateway image exists
function imageExists(): boolean {
  try {
    execSync('docker image inspect coding-plan-gateway:test', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Docker and image available check
function canRunDockerTests(): boolean {
  return isDockerAvailable() && imageExists();
}

// Build the test image if needed
function buildTestImage(): void {
  execSync('docker build -t coding-plan-gateway:test -f Dockerfile .', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}

// Run a command in a temporary container
function runInContainer(command: string, env: Record<string, string> = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const envFlags = Object.entries(env)
    .map(([key, value]) => `-e ${key}=${value}`)
    .join(' ');

  try {
    const stdout = execSync(
      `docker run --rm ${envFlags} coding-plan-gateway:test ${command}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
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

describe('Docker CLI Execution', () => {
  const dockerAvailable = isDockerAvailable();
  const imageAvailable = imageExists();
  const canRunTests = canRunDockerTests();

  beforeAll(() => {
    if (!dockerAvailable) {
      console.warn('Docker not available - skipping Docker CLI tests');
      return;
    }

    if (!imageAvailable) {
      console.warn('Gateway image not built - skipping Docker CLI tests');
      console.warn('Build with: docker build -t coding-plan-gateway:test .');
    }
  }, 120000); // 2 minutes timeout for image build

  describe('cpg --version', () => {
    it.skipIf(!canRunTests)('should show version information', () => {
      const result = runInContainer('cpg --version');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1.0.0');
    });
  });

  describe('cpg --help', () => {
    it.skipIf(!canRunTests)('should show help message', () => {
      const result = runInContainer('cpg --help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('Commands:');
    });
  });

  describe('cpg key --help', () => {
    it.skipIf(!canRunTests)('should show key command help', () => {
      const result = runInContainer('cpg key --help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('key');
      expect(result.stdout).toContain('create');
      expect(result.stdout).toContain('list');
    });
  });

  describe('cpg key list', () => {
    it.skipIf(!canRunTests)('should list keys (empty list)', () => {
      const result = runInContainer('cpg key list', {
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });

      expect(result.exitCode).toBe(0);
      // Empty list shows "No API keys found" message
      expect(result.stdout).toContain('API key');
    });
  });

  describe('cpg key create', () => {
    it.skipIf(!canRunTests)('should create an API key', () => {
      const result = runInContainer('cpg key create --name "Test Key"', {
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('API Key created');
      expect(result.stdout).toContain('Test Key');
      expect(result.stdout).toContain('cpg_');
    });

    it.skipIf(!canRunTests)('should create key without ENCRYPTION_KEY', () => {
      const result = runInContainer('cpg key create --name "Test Key"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('API Key created');
    });
  });

  describe('CLI in PATH', () => {
    it.skipIf(!canRunTests)('should be accessible without full path', () => {
      // The cpg command should be in PATH
      const result = runInContainer('which cpg');

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('/app/bin/cpg');
    });
  });

  describe('CLI executable permissions', () => {
    it.skipIf(!canRunTests)('should have execute permissions', () => {
      const result = runInContainer('test -x /app/bin/cpg && echo "executable"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('executable');
    });
  });
});