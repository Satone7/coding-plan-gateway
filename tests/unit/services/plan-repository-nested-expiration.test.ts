/**
 * Unit tests for plan repository with nested expiresOn/expiresAt in quota.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import type { PlanConfig } from '@/config/schema';

describe('FilePlanRepository with nested expiresOn', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plan-repo-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should load plan with expiresOn inside quota', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const fs = await import('fs/promises');

    // Write config with expiresOn inside quota
    const configContent = `
plans:
  - id: 1
    name: "Test Plan"
    baseUrl: "https://api.example.com"
    apiKey: "test-key"
    models:
      - "test-model"
    quota:
      limit: 90000
      period: "monthly"
      expiresOn: 27
    timeout: 180
    status: "active"
`;
    await fs.writeFile(configPath, configContent, 'utf-8');

    const repository = new FilePlanRepository(configPath);
    const plans = await repository.findAll();

    expect(plans).toHaveLength(1);
    expect(plans[0]?.quota.expiresOn).toBe(27);
    expect(plans[0]?.expiresOn).toBe(27); // Also should be at top level
  });

  it('should load plan with expiresAt inside quota', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const fs = await import('fs/promises');

    const expiresAt = '2026-04-27T23:59:59.999Z';
    const configContent = `
plans:
  - id: 1
    name: "Test Plan"
    baseUrl: "https://api.example.com"
    apiKey: "test-key"
    models:
      - "test-model"
    quota:
      limit: 90000
      period: "monthly"
      expiresAt: "${expiresAt}"
    timeout: 180
    status: "active"
`;
    await fs.writeFile(configPath, configContent, 'utf-8');

    const repository = new FilePlanRepository(configPath);
    const plans = await repository.findAll();

    expect(plans).toHaveLength(1);
    expect(plans[0]?.quota.expiresAt).toBe(expiresAt);
    expect(plans[0]?.expiresAt).toBe(expiresAt);
  });

  it('should support backward compatibility with expiresOn at top level', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const fs = await import('fs/promises');

    // Write config with expiresOn at top level (old format)
    const configContent = `
plans:
  - id: 1
    name: "Test Plan"
    baseUrl: "https://api.example.com"
    apiKey: "test-key"
    models:
      - "test-model"
    quota:
      limit: 90000
      period: "monthly"
    expiresOn: 15
    timeout: 180
    status: "active"
`;
    await fs.writeFile(configPath, configContent, 'utf-8');

    const repository = new FilePlanRepository(configPath);
    const plans = await repository.findAll();

    expect(plans).toHaveLength(1);
    // Top-level expiresOn should work as fallback
    expect(plans[0]?.expiresOn).toBe(15);
    // It should also be available in quota for internal usage
    expect(plans[0]?.quota.expiresOn).toBe(15);
  });

  it('should save plan with expiresOn inside quota', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const fs = await import('fs/promises');

    // Create empty config first
    await fs.writeFile(configPath, 'plans: []', 'utf-8');

    const repository = new FilePlanRepository(configPath);
    await repository.reload();

    // Save a new plan with expiresOn
    const plan = await repository.save({
      name: 'New Plan',
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      models: ['test-model'],
      quota: {
        limit: 50000,
        period: 'monthly',
        expiresOn: 10,
      },
    });

    // Verify it was saved correctly
    const plans = await repository.findAll();
    expect(plans).toHaveLength(1);
    expect(plans[0]?.quota.expiresOn).toBe(10);
    expect(plans[0]?.expiresOn).toBe(10);
  });

  it('should round-trip expiresOn through save and load', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const fs = await import('fs/promises');

    // Write initial config
    await fs.writeFile(configPath, 'plans: []', 'utf-8');

    const repository = new FilePlanRepository(configPath);
    await repository.reload();

    // Create a plan with expiresOn
    await repository.save({
      name: 'Test Plan',
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      models: ['test-model'],
      quota: {
        limit: 90000,
        period: 'monthly',
        expiresOn: 27,
        expiresAt: undefined,
      },
    });

    // Reload to verify persistence
    await repository.reload();
    const plans = await repository.findAll();

    expect(plans).toHaveLength(1);
    expect(plans[0]?.quota.expiresOn).toBe(27);
    expect(plans[0]?.quota.expiresAt).toBeUndefined();
    expect(plans[0]?.expiresOn).toBe(27);
  });
});