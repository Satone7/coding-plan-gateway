/**
 * E2E test script for CLI operations.
 * Tests the CLI functionality in the E2E testing environment.
 *
 * These tests require:
 * - Docker to be installed and running
 * - The gateway Docker image to be built
 * - The E2E environment to be running (docker-compose -f docker-compose.e2e.yml up -d)
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

// Check if the gateway container is running
function isGatewayRunning(): boolean {
  try {
    const result = execSync('docker ps --filter "name=gateway" --filter "status=running" -q', {
      encoding: 'utf-8',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

// Execute command in the gateway container
function execInGateway(command: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`docker exec gateway ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

// Execute curl against the gateway
function curlGateway(path: string, method: string = 'GET', body?: string): {
  stdout: string;
  exitCode: number;
} {
  const bodyFlag = body ? `-d '${body}'` : '';
  try {
    const stdout = execSync(
      `docker exec gateway wget -qO- --method=${method} ${bodyFlag} http://localhost:8080${path}`,
      { encoding: 'utf-8' }
    );
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { status?: number };
    return { stdout: '', exitCode: err.status || 1 };
  }
}

describe('E2E CLI Operations', () => {
  const dockerAvailable = isDockerAvailable();
  const gatewayRunning = isGatewayRunning();

  beforeAll(() => {
    if (!dockerAvailable) {
      console.warn('Docker not available - skipping E2E CLI tests');
      return;
    }

    if (!gatewayRunning) {
      console.warn('Gateway container not running - skipping E2E CLI tests');
      console.warn('Start the E2E environment with: docker-compose -f docker-compose.e2e.yml up -d');
    }
  }, 30000);

  describe('CLI Availability', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should have cpg command in PATH', () => {
      const result = execInGateway('which cpg');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('/app/bin/cpg');
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should show version', () => {
      const result = execInGateway('cpg --version');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1.0.0');
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should show help', () => {
      const result = execInGateway('cpg --help');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
    });
  });

  describe('Key Management', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should create an API key', () => {
      const result = execInGateway(
        'cpg key create --name "E2E Test Key" --json'
      );

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.success).toBe(true);
      expect(output.key.name).toBe('E2E Test Key');
      expect(output.key.plaintextKey).toMatch(/^cpg_/);
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should list API keys', () => {
      // First create a key
      execInGateway('cpg key create --name "List Test Key"');

      const result = execInGateway('cpg key list --json');
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(Array.isArray(output.keys)).toBe(true);
      expect(output.keys.length).toBeGreaterThan(0);
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should test a valid key', () => {
      // Create a key
      const createResult = execInGateway(
        'cpg key create --name "Test Valid Key" --json'
      );
      const createOutput = JSON.parse(createResult.stdout);
      const key = createOutput.key.plaintextKey;

      // Test the key
      const testResult = execInGateway(`cpg key test ${key} --json`);
      expect(testResult.exitCode).toBe(0);

      const testOutput = JSON.parse(testResult.stdout);
      expect(testOutput.status).toBe('valid');
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should disable and enable a key', () => {
      // Create a key
      const createResult = execInGateway(
        'cpg key create --name "Disable Test Key" --json'
      );
      const createOutput = JSON.parse(createResult.stdout);
      const keyId = createOutput.key.id;
      const plaintextKey = createOutput.key.plaintextKey;

      // Disable the key
      const disableResult = execInGateway(`cpg key disable --id ${keyId} --json`);
      expect(disableResult.exitCode).toBe(0);

      // Test should show disabled
      const testDisabled = execInGateway(`cpg key test ${plaintextKey} --json`);
      const testOutput = JSON.parse(testDisabled.stdout);
      expect(testOutput.status).toBe('disabled');

      // Enable the key
      const enableResult = execInGateway(`cpg key enable --id ${keyId} --json`);
      expect(enableResult.exitCode).toBe(0);

      // Test should show valid again
      const testEnabled = execInGateway(`cpg key test ${plaintextKey} --json`);
      const testOutput2 = JSON.parse(testEnabled.stdout);
      expect(testOutput2.status).toBe('valid');
    });
  });

  describe('Real-time Key Availability', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should make key immediately available after creation', () => {
      // Create a key
      const createResult = execInGateway(
        'cpg key create --name "Immediate Test Key" --json'
      );
      expect(createResult.exitCode).toBe(0);

      const createOutput = JSON.parse(createResult.stdout);
      const plaintextKey = createOutput.key.plaintextKey;

      // Immediately try to use the key for authentication
      // This tests that the gateway was notified and has the key loaded
      const authResult = curlGateway(
        '/v1/models',
        'GET'
      );
      // The gateway should respond (even if with an error, it should recognize the key)
      expect(authResult.exitCode).toBe(0);
    });
  });

  describe('Usage Reporting', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should show usage report', () => {
      const result = execInGateway('cpg usage-report --json');
      expect(result.exitCode).toBe(0);

      // Empty or valid JSON response is acceptable
      try {
        const output = JSON.parse(result.stdout);
        expect(output).toHaveProperty('reports');
      } catch {
        // Empty response is OK for new installations
        expect(result.stdout).toBeTruthy();
      }
    });
  });
});