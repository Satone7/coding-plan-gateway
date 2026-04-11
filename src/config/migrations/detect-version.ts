import { LATEST_CONFIG_VERSION } from '../defaults';

/**
 * Detect the configuration format version from a raw config object.
 *
 * - Missing version field → 0 (oldest unversioned config)
 * - "1.0" → 1 (legacy string format)
 * - 1 → 1 (integer format)
 * - version > LATEST_CONFIG_VERSION → throws
 *
 * @param config - Raw parsed config object
 * @returns The detected version number
 * @throws Error if version is newer than supported or unrecognized
 */
export function detectConfigVersion(config: unknown): number {
  if (!config || typeof config !== 'object' || !('version' in config)) {
    return 0;
  }

  const raw = (config as Record<string, unknown>).version;
  const numVersion = parseVersion(raw);

  if (numVersion === null) {
    throw new Error(
      `Unrecognized config version: ${String(raw)}. ` +
        `Supported versions: 0-${LATEST_CONFIG_VERSION}`,
    );
  }

  if (numVersion > LATEST_CONFIG_VERSION) {
    throw new Error(
      `Config version ${numVersion} is newer than supported version ${LATEST_CONFIG_VERSION}. ` +
        `Please update the software.`,
    );
  }

  return numVersion;
}

/**
 * Parse a version value to a non-negative integer.
 * Returns null if unparseable.
 */
function parseVersion(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? raw : null;
  }

  if (typeof raw === 'string') {
    // Handle "1.0" format → parse major part
    if (raw.includes('.')) {
      const major = parseInt(raw.split('.')[0], 10);
      return Number.isNaN(major) || major < 0 ? null : major;
    }
    const num = parseInt(raw, 10);
    return Number.isNaN(num) || num < 0 ? null : num;
  }

  return null;
}
