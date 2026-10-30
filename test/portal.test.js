import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePortal } from './helpers/fake-portal.js';
import { PortalClient } from '../src/portal/client.js';
import { PortalApi } from '../src/portal/api.js';
import {
  PortalAuthError,
  PortalProtocolError,
  PortalTimeoutError,
  NotFoundError,
} from '../src/errors.js';

describe('PortalClient and PortalApi with FakePortal', () => {
  let fakePortal;
  let baseUrl;

  beforeEach(async () => {
    fakePortal = createFakePortal();
    baseUrl = await fakePortal.start();
  });

  afterEach(async () => {
    await fakePortal.stop();
  });

  it('logs in successfully and captures session cookie verbatim', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    await client.login();
    assert.equal(
      client.cookies.get('__Secure-better-auth.session_token'),
      'test-session%2Ftoken-abc-123'
    );
  });

  it('throws PortalAuthError when login returns type: failure', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'wrong-password',
    });

    await assert.rejects(
      async () => client.login(),
      (err) => err instanceof PortalAuthError && err.message.includes('rejected credentials')
    );
  });

  it('replays cookie including %2F in subsequent requests', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    const secretInfo = await api.getSigningSecret();
    assert.equal(secretInfo.secret, 'fake-secret-32-chars-long12345');

    const keyReq = fakePortal.state.requests.find((r) => r.url === '/portal/keys');
    assert.ok(keyReq);
    assert.ok(
      keyReq.headers.cookie.includes('__Secure-better-auth.session_token=test-session%2Ftoken-abc-123')
    );
  });

  it('automatically relogins once when session expires mid-run', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    await api.getSigningSecret();

    // Expire session
    fakePortal.state.sessionExpired = true;

    // Next request should trigger one relogin and succeed
    const dts = await api.fetchDts();
    assert.equal(dts.length, 1);
    assert.equal(dts[0].code, 'DT-001');

    const loginRequests = fakePortal.state.requests.filter((r) => r.url === '/login');
    assert.equal(loginRequests.length, 2);
  });

  it('shares single login promise during concurrent unauthenticated requests', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);

    // Run 5 requests simultaneously with no initial login
    const results = await Promise.all([
      api.getSigningSecret(),
      api.fetchDts(),
      api.fetchGeo('J100000'),
      api.fetchEnergy('J100000'),
      api.getSigningSecret(),
    ]);

    assert.equal(results[0].secret, 'fake-secret-32-chars-long12345');
    assert.equal(results[1][0].code, 'DT-001');

    const loginRequests = fakePortal.state.requests.filter((r) => r.url === '/login');
    assert.equal(loginRequests.length, 1);
  });

  it('retries on 5xx and recovers', async () => {
    fakePortal.state.serverErrorsRemaining = 1;
    fakePortal.state.serverErrorCode = 503;

    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    const dts = await api.fetchDts();
    assert.equal(dts.length, 1);
  });

  it('handles request timeout gracefully with PortalTimeoutError', async () => {
    fakePortal.state.requestDelayMs = 150;

    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
      timeoutMs: 50,
    });

    await assert.rejects(
      async () => client.getJson('/portal/keys'),
      (err) => err instanceof PortalTimeoutError
    );
  });

  it('verifies export signature and fetches export data', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    const exportMeters = await api.fetchExport();
    assert.equal(exportMeters.length, 2);
    assert.equal(exportMeters[0].meterId, 'J100000');
    assert.equal(exportMeters[1].meterId, 'J100001');

    const exportReq = fakePortal.state.requests.find((r) => r.url.startsWith('/portal/export'));
    assert.ok(exportReq);
    assert.ok(exportReq.headers['x-timestamp']);
    assert.ok(exportReq.headers['x-signature']);
  });

  it('handles multipage export and terminates properly', async () => {
    await fakePortal.stop();
    fakePortal = createFakePortal({ multipageExport: true });
    baseUrl = await fakePortal.start();

    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    const exportMeters = await api.fetchExport();
    assert.equal(exportMeters.length, 2);
    assert.equal(exportMeters[0].meterId, 'J100000');
    assert.equal(exportMeters[1].meterId, 'J100001');

    const exportReqs = fakePortal.state.requests.filter((r) => r.url.startsWith('/portal/export'));
    assert.equal(exportReqs.length, 2);
  });

  it('encodes special characters like & properly in search queries', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    await api.fetchSearchPage('L&T', 1);

    const searchReq = fakePortal.state.requests.find((r) => r.url.includes('/meters/search'));
    assert.ok(searchReq);
    assert.ok(searchReq.url.includes('q=L%26T'));
  });

  it('throws NotFoundError when meter is not found for energy or geo', async () => {
    const client = new PortalClient({
      baseUrl,
      email: 'operator@urja.local',
      password: 'correct-password',
    });

    const api = new PortalApi(client);
    await assert.rejects(
      async () => api.fetchEnergy('NON_EXISTENT'),
      (err) => err instanceof NotFoundError
    );
    await assert.rejects(
      async () => api.fetchGeo('NON_EXISTENT'),
      (err) => err instanceof NotFoundError
    );
  });
});
