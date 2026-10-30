import { ConfigError } from './errors.js';

/**
 * Attempt to load .env using Node's built-in process.loadEnvFile().
 * Fails silently if .env is missing.
 */
export function loadEnvFileSafe(path) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      if (path) {
        process.loadEnvFile(path);
      } else {
        process.loadEnvFile();
      }
    }
  } catch (err) {
    // Ignore ENOENT (file not found), rethrow other critical errors if any
    if (err.code !== 'ENOENT') {
      // ignore
    }
  }
}

/**
 * Parse and validate configuration from process.env + optional overrides.
 *
 * @param {Record<string, string>} [overrides]
 * @param {boolean} [requireAuth=true] Whether PORTAL_EMAIL and PORTAL_PASSWORD are required
 * @returns {AppConfig}
 */
export function getConfig(overrides = {}, requireAuth = true) {
  loadEnvFileSafe();

  const env = { ...process.env, ...overrides };

  const email = env.PORTAL_EMAIL?.trim();
  const password = env.PORTAL_PASSWORD?.trim();

  if (requireAuth && (!email || !password)) {
    throw new ConfigError(
      'Missing required portal credentials. Please set PORTAL_EMAIL and PORTAL_PASSWORD in .env or environment.'
    );
  }

  const parseNumber = (val, def) => {
    if (val === undefined || val === '') return def;
    const n = Number(val);
    return Number.isFinite(n) ? n : def;
  };

  return {
    portalBaseUrl: (env.PORTAL_BASE_URL || 'https://urja-ops.flockenergy.tech').replace(/\/+$/, ''),
    portalEmail: email || '',
    portalPassword: password || '',
    port: parseNumber(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    logLevel: env.LOG_LEVEL || 'info',
    datasetTtlMs: parseNumber(env.DATASET_TTL_MS, 3600000),
    readingsTtlMs: parseNumber(env.READINGS_TTL_MS, 900000),
    staleIfErrorMs: parseNumber(env.STALE_IF_ERROR_MS, 86400000),
    portalTimeoutMs: parseNumber(env.PORTAL_TIMEOUT_MS, 15000),
    portalMaxConcurrency: parseNumber(env.PORTAL_MAX_CONCURRENCY, 4),
    portalTzOffset: env.PORTAL_TZ_OFFSET || '+05:30',
  };
}

/**
 * @typedef {Object} AppConfig
 * @property {string} portalBaseUrl
 * @property {string} portalEmail
 * @property {string} portalPassword
 * @property {number} port
 * @property {string} host
 * @property {string} logLevel
 * @property {number} datasetTtlMs
 * @property {number} readingsTtlMs
 * @property {number} staleIfErrorMs
 * @property {number} portalTimeoutMs
 * @property {number} portalMaxConcurrency
 * @property {string} portalTzOffset
 */
