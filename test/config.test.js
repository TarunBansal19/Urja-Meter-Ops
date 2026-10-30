import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

describe('config', () => {
  it('throws ConfigError if credentials are missing when requireAuth=true', () => {
    assert.throws(
      () => getConfig({ PORTAL_EMAIL: '', PORTAL_PASSWORD: '' }, true),
      (err) => err instanceof ConfigError && err.message.includes('PORTAL_EMAIL')
    );
  });

  it('loads valid configuration with defaults and overrides', () => {
    const conf = getConfig({
      PORTAL_EMAIL: 'test@example.com',
      PORTAL_PASSWORD: 'secretpassword',
      PORT: '4000',
      LOG_LEVEL: 'warn',
      DATASET_TTL_MS: '60000',
    }, true);

    assert.equal(conf.portalEmail, 'test@example.com');
    assert.equal(conf.portalPassword, 'secretpassword');
    assert.equal(conf.port, 4000);
    assert.equal(conf.host, '127.0.0.1');
    assert.equal(conf.logLevel, 'warn');
    assert.equal(conf.datasetTtlMs, 60000);
    assert.equal(conf.portalTzOffset, '+05:30');
    assert.equal(conf.portalBaseUrl, 'https://urja-ops.flockenergy.tech');
  });

  it('trims trailing slashes from PORTAL_BASE_URL', () => {
    const conf = getConfig({
      PORTAL_BASE_URL: 'https://example.com/api///',
      PORTAL_EMAIL: 'test@example.com',
      PORTAL_PASSWORD: 'secretpassword',
    }, true);

    assert.equal(conf.portalBaseUrl, 'https://example.com/api');
  });
});
