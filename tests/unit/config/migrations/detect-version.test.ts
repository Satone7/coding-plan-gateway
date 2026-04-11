import { describe, it, expect } from 'vitest';
import { detectConfigVersion } from '@/config/migrations/detect-version';
import { LATEST_CONFIG_VERSION } from '@/config/defaults';

describe('detectConfigVersion', () => {
  it('should return 0 when version field is missing', () => {
    expect(detectConfigVersion({ plans: [] })).toBe(0);
  });

  it('should return 0 for empty object', () => {
    expect(detectConfigVersion({})).toBe(0);
  });

  it('should return 0 for null/undefined config', () => {
    expect(detectConfigVersion(null as any)).toBe(0);
    expect(detectConfigVersion(undefined as any)).toBe(0);
  });

  it('should parse integer version', () => {
    expect(detectConfigVersion({ version: 0 })).toBe(0);
    expect(detectConfigVersion({ version: 1 })).toBe(1);
  });

  it('should parse string version "1.0" as 1', () => {
    expect(detectConfigVersion({ version: '1.0' })).toBe(1);
  });

  it('should parse string version "0" as 0', () => {
    expect(detectConfigVersion({ version: '0' })).toBe(0);
  });

  it('should parse string version "1" as 1', () => {
    expect(detectConfigVersion({ version: '1' })).toBe(1);
  });

  it('should throw for version higher than LATEST_CONFIG_VERSION', () => {
    const futureVersion = LATEST_CONFIG_VERSION + 1;
    expect(() => detectConfigVersion({ version: futureVersion })).toThrow(
      /newer than supported/,
    );
  });

  it('should throw for non-numeric version string', () => {
    expect(() => detectConfigVersion({ version: 'abc' })).toThrow(
      /Unrecognized config version/,
    );
  });

  it('should throw for negative version', () => {
    expect(() => detectConfigVersion({ version: -1 })).toThrow(
      /Unrecognized config version/,
    );
  });
});
