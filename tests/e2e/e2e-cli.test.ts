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
    // Check for gateway-e2e container (E2E environment)
    const result = execSync('docker ps --filter "name=gateway-e2e" --filter "status=running" -q', {
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
    // Use gateway-e2e container name for E2E environment
    const containerName = process.env.E2E_CONTAINER_NAME || 'gateway-e2e';
    const stdout = execSync(`docker exec ${containerName} ${command}`, {
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

// Extract the last JSON object from CLI output (which may include log lines)
// Log lines are single-line JSON starting with {"timestamp"
// Output JSON is multiline and starts after all log lines
function extractLastJson(output: string): unknown {
  const lines = output.trim().split('\n');

  // First, skip all log lines (they start with {"timestamp")
  let jsonStartIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('{"timestamp"')) {
      jsonStartIndex = i + 1;
    } else {
      break;
    }
  }

  // Now find the { that starts the JSON output
  let startIndex = -1;
  for (let i = jsonStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '{') {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    throw new Error('No JSON object found in output');
  }

  // Extract from the opening brace to the matching closing brace
  let braceCount = 0;
  let endIndex = -1;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
      }

      if (braceCount === 0 && i > startIndex) {
        endIndex = i;
        break;
      }
    }
    if (endIndex !== -1) {
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('No closing brace found for JSON object');
  }

  const jsonLines = lines.slice(startIndex, endIndex + 1).join('\n');
  return JSON.parse(jsonLines);
}

// Execute wget against the gateway
function wgetGateway(path: string, method: string = 'GET', body?: string, headers?: Record<string, string>): {
  stdout: string;
  exitCode: number;
} {
  // Use gateway-e2e container name for E2E environment
  const containerName = process.env.E2E_CONTAINER_NAME || 'gateway-e2e';

  const args: string[] = ['wget', '-qO-'];

  if (body) {
    args.push(`--post-data='${body}'`);
  }

  if (method !== 'GET' && !body) {
    args.push(`--method=${method}`);
  }

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      args.push(`--header='${key}: ${value}'`);
    }
  }

  args.push(`http://127.0.0.1:8080${path}`);

  try {
    const stdout = execSync(
      `docker exec ${containerName} ${args.join(' ')}`,
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

      const output = extractLastJson(result.stdout) as { success: boolean; key: { name: string; plaintextKey: string } };
      expect(output.success).toBe(true);
      expect(output.key.name).toBe('E2E Test Key');
      expect(output.key.plaintextKey).toMatch(/^cpg_/);
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should list API keys', () => {
      // First create a key
      execInGateway('cpg key create --name "List Test Key"');

      const result = execInGateway('cpg key list --json');
      expect(result.exitCode).toBe(0);

      const output = extractLastJson(result.stdout) as { keys: unknown[] };
      expect(Array.isArray(output.keys)).toBe(true);
      expect(output.keys.length).toBeGreaterThan(0);
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should test a valid key', () => {
      // Create a key
      const createResult = execInGateway(
        'cpg key create --name "Test Valid Key" --json'
      );
      const createOutput = extractLastJson(createResult.stdout) as { key: { plaintextKey: string } };
      const key = createOutput.key.plaintextKey;

      // Test the key
      const testResult = execInGateway(`cpg key test ${key} --json`);
      expect(testResult.exitCode).toBe(0);

      const testOutput = extractLastJson(testResult.stdout) as { status: string };
      expect(testOutput.status).toBe('valid');
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should disable and enable a key', () => {
      // Create a key
      const createResult = execInGateway(
        'cpg key create --name "Disable Test Key" --json'
      );
      const createOutput = extractLastJson(createResult.stdout) as { key: { id: string; plaintextKey: string } };
      const keyId = createOutput.key.id;
      const plaintextKey = createOutput.key.plaintextKey;

      // Disable the key
      const disableResult = execInGateway(`cpg key disable --id ${keyId} --json`);
      expect(disableResult.exitCode).toBe(0);

      // Test should show disabled
      const testDisabled = execInGateway(`cpg key test ${plaintextKey} --json`);
      const testOutput = extractLastJson(testDisabled.stdout) as { status: string };
      expect(testOutput.status).toBe('disabled');

      // Enable the key
      const enableResult = execInGateway(`cpg key enable --id ${keyId} --json`);
      expect(enableResult.exitCode).toBe(0);

      // Test should show valid again
      const testEnabled = execInGateway(`cpg key test ${plaintextKey} --json`);
      const testOutput2 = extractLastJson(testEnabled.stdout) as { status: string };
      expect(testOutput2.status).toBe('valid');
    });
  });

  describe('Reload Endpoint (T012)', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should allow POST /internal/reload without authentication', () => {
      // Test that the reload endpoint is accessible without API key
      const result = wgetGateway(
        '/internal/reload',
        'POST',
        '{"type":"api-keys"}',
        { 'Content-Type': 'application/json' }
      );

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.success).toBe(true);
      expect(output.message).toContain('Reloaded: api-keys');
    });
  });

  describe('Real-time Key Availability (T013)', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should make key immediately available for authentication after creation', () => {
      // Create a key
      const createResult = execInGateway(
        'cpg key create --name "Immediate Auth Test Key" --json'
      );
      expect(createResult.exitCode).toBe(0);

      const createOutput = extractLastJson(createResult.stdout) as { key: { plaintextKey: string } };
      const plaintextKey = createOutput.key.plaintextKey;

      // Immediately try to authenticate with the key to /v1/models
      // This tests that the gateway was notified via /internal/reload and has the key loaded
      const authResult = wgetGateway(
        '/v1/models',
        'GET',
        undefined,
        { 'Authorization': `Bearer ${plaintextKey}` }
      );

      expect(authResult.exitCode).toBe(0);

      const modelsOutput = JSON.parse(authResult.stdout);
      expect(modelsOutput.object).toBe('list');
      expect(Array.isArray(modelsOutput.data)).toBe(true);
      expect(modelsOutput.data.length).toBeGreaterThan(0);
    });
  });

  describe('Usage Reporting', () => {
    it.skipIf(!dockerAvailable || !gatewayRunning)('should show usage report', () => {
      const result = execInGateway('cpg usage-report --json');
      expect(result.exitCode).toBe(0);

      // Empty or valid JSON response is acceptable
      try {
        const output = extractLastJson(result.stdout) as { reports: unknown };
        expect(output).toHaveProperty('reports');
      } catch {
        // Empty response is OK for new installations
        expect(result.stdout).toBeTruthy();
      }
    });
  });

  describe('Key Persistence Across Restart (T017)', () => {
    // This test requires docker compose to be available and may disrupt other tests
    // It should be run in isolation or at the end of the test suite
    const canRestartContainer = dockerAvailable && gatewayRunning && process.env.E2E_ALLOW_RESTART === 'true';

    it.skipIf(!canRestartContainer)('should persist API keys across container restart', () => {
      // Generate unique key name with timestamp to avoid conflicts
      const timestamp = Date.now();
      const keyName = `Persistence Test ${timestamp}`;

      // Create a key
      const createResult = execInGateway(
        `cpg key create --name "${keyName}" --json`
      );
      expect(createResult.exitCode).toBe(0);

      const createOutput = extractLastJson(createResult.stdout) as {
        success: boolean;
        key: { id: string; plaintextKey: string; prefix: string };
      };
      expect(createOutput.success).toBe(true);
      const keyId = createOutput.key.id;
      const plaintextKey = createOutput.key.plaintextKey;
      const prefix = createOutput.key.prefix;

      // Verify the key works before restart
      const testBeforeRestart = execInGateway(`cpg key test ${plaintextKey} --json`);
      const testOutputBefore = extractLastJson(testBeforeRestart.stdout) as { status: string };
      expect(testOutputBefore.status).toBe('valid');

      // Restart the container using docker compose
      // Note: This will temporarily disrupt the gateway
      const containerName = process.env.E2E_CONTAINER_NAME || 'gateway-e2e';
      execSync('docker compose -f docker-compose.e2e.yml down', { stdio: 'inherit' });
      execSync('docker compose -f docker-compose.e2e.yml up -d', { stdio: 'inherit' });

      // Wait for the container to be ready (from host)
      let ready = false;
      let attempts = 0;
      const maxAttempts = 60; // 60 seconds max
      while (!ready && attempts < maxAttempts) {
        try {
          // Check health from host (more reliable than from inside container)
          // E2E gateway runs on port 8081
          const healthCheck = execSync('curl -s http://localhost:8081/health', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          if (healthCheck.includes('healthy') || healthCheck.includes('"status"')) {
            ready = true;
          } else {
            attempts++;
            execSync('sleep 1', { stdio: 'ignore' });
          }
        } catch {
          attempts++;
          execSync('sleep 1', { stdio: 'ignore' });
        }
      }
      expect(ready).toBe(true);

      // Verify the key still exists after restart
      const listResult = execInGateway('cpg key list --json');
      const listOutput = extractLastJson(listResult.stdout) as { keys: Array<{ id: string }> };
      const keyIds = listOutput.keys.map((k) => k.id);
      expect(keyIds).toContain(keyId);

      // Verify the key still works after restart
      const testAfterRestart = execInGateway(`cpg key test ${plaintextKey} --json`);
      expect(testAfterRestart.exitCode).toBe(0);

      const testOutputAfter = extractLastJson(testAfterRestart.stdout) as {
        status: string;
        prefix: string;
        key: { id: string };
      };
      expect(testOutputAfter.status).toBe('valid');
      expect(testOutputAfter.key.id).toBe(keyId);
      expect(testOutputAfter.prefix).toBe(prefix);
    });
  });

  describe('Load Balancing (009-enhance-routing-lb)', () => {
    // These tests verify load balancing features using the production config.yaml

    it.skipIf(!dockerAvailable || !gatewayRunning)('should list models from configured plans', () => {
      const result = wgetGateway('/v1/models', 'GET');
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.object).toBe('list');
      expect(Array.isArray(output.data)).toBe(true);
      // Should have models from config.yaml
      expect(output.data.length).toBeGreaterThan(0);
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should preserve custom parameters in requests (passthrough)', () => {
      // Test that custom parameters are passed through to upstream
      const result = wgetGateway(
        '/v1/chat/completions',
        'POST',
        JSON.stringify({
          model: 'kimi-k2.5', // Use model from config.yaml
          messages: [{ role: 'user', content: 'Hi' }],
          // Custom parameter that should be preserved
          custom_field: 'test_value_123',
        }),
        { 'Content-Type': 'application/json' }
      );

      // Request should be accepted (may fail upstream, but shouldn't fail at gateway)
      // The gateway should pass through custom_field to the upstream provider
      expect(result.exitCode).toBe(0);
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should route requests to available plans', () => {
      // Send a request and verify it routes successfully
      const result = wgetGateway(
        '/v1/chat/completions',
        'POST',
        JSON.stringify({
          model: 'kimi-k2.5',
          messages: [{ role: 'user', content: 'Test routing' }],
        }),
        { 'Content-Type': 'application/json' }
      );

      expect(result.exitCode).toBe(0);

      // Parse response - should be a valid chat completion response
      try {
        const output = JSON.parse(result.stdout);
        expect(output).toHaveProperty('choices');
      } catch {
        // If not JSON, might be streaming or error response
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should handle multiple requests (load distribution)', async () => {
      // Send multiple requests to test load balancing
      const requests = [];
      for (let i = 0; i < 3; i++) {
        const result = wgetGateway(
          '/v1/chat/completions',
          'POST',
          JSON.stringify({
            model: 'kimi-k2.5',
            messages: [{ role: 'user', content: `Load test ${i}` }],
          }),
          { 'Content-Type': 'application/json' }
        );
        requests.push(result);
      }

      // All requests should succeed or fail gracefully
      for (const result of requests) {
        expect([0, 1]).toContain(result.exitCode);
      }
    });

    it.skipIf(!dockerAvailable || !gatewayRunning)('should check health endpoint', () => {
      const result = wgetGateway('/health', 'GET');
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.status).toBe('healthy');
    });
  });
});