import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { backupConfigFile } from '@/config/migrations/backup';

describe('backupConfigFile', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `config-backup-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should create a backup file with .v{version}.bak suffix', async () => {
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(configPath, 'version: "1.0"\nplans: []\n');

    const backupPath = await backupConfigFile(configPath, 0);

    expect(backupPath).toContain('.v0.bak');
    const backupContent = await readFile(backupPath, 'utf-8');
    expect(backupContent).toBe('version: "1.0"\nplans: []\n');
  });

  it('should append sequence number if backup already exists', async () => {
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(configPath, 'version: "1.0"\n');

    const first = await backupConfigFile(configPath, 0);
    const second = await backupConfigFile(configPath, 0);

    expect(first).toContain('.v0.bak');
    expect(second).toContain('.v0.bak.1');
    expect(first).not.toBe(second);
  });

  it('should copy the file without modification', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const originalContent = 'version: "1.0"\nplans:\n  - name: test\n';
    await writeFile(configPath, originalContent);

    const backupPath = await backupConfigFile(configPath, 0);
    const backupContent = await readFile(backupPath, 'utf-8');

    expect(backupContent).toBe(originalContent);
  });
});
