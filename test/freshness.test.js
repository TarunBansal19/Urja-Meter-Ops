import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncCache } from '../src/store/async-cache.js';
import { createFakePortal } from './helpers/fake-portal.js';
import { PortalClient } from '../src/portal/client.js';
import { PortalApi } from '../src/portal/api.js';
import { DatasetService } from '../src/store/dataset.js';
import { buildApp } from '../src/app.js';

describe('Freshness & Robustness (AsyncCache and End-to-End)', () => {
  it('AsyncCache handles fresh, stale-if-error fallback, and expiration correctly', async () => {
    let now = 1000000;
    const clock = () => now;

    let callCount = 0;
    let shouldFail = false;

    const cache = new AsyncCache({
      ttlMs: 5000,
      staleIfErrorMs: 20000,
      clock,
    });

    const loader = async () => {
      callCount++;
      if (shouldFail) {
        throw new Error('Upstream failed');
      }
      return { count: callCount };
    };

    // 1. Initial load
    const r1 = await cache.get('item', loader);
    assert.equal(r1.value.count, 1);
    assert.equal(r1.stale, false);
    assert.equal(callCount, 1);

    // 2. Access within TTL: no loader call
    now += 2000;
    const r2 = await cache.get('item', loader);
    assert.equal(r2.value.count, 1);
    assert.equal(r2.stale, false);
    assert.equal(callCount, 1);

    // 3. Access after TTL expires: refreshes cleanly
    now += 4000; // now age is 6000 > ttlMs (5000)
    const r3 = await cache.get('item', loader);
    assert.equal(r3.value.count, 2);
    assert.equal(r3.stale, false);
    assert.equal(callCount, 2);

    // 4. Access after TTL when loader FAILS: returns stale entry with stale: true!
    now += 6000;
    shouldFail = true;
    const r4 = await cache.get('item', loader);
    assert.equal(r4.value.count, 2); // previous good value
    assert.equal(r4.stale, true);
    assert.equal(callCount, 3);

    // 5. Access after stale window (age > 20000): throws error
    now += 30000;
    await assert.rejects(
      async () => cache.get('item', loader),
      /Upstream failed/
    );
  });

  describe('End-to-End against FakePortal with mid-run downtime', () => {
    let fakePortal;
    let baseUrl;

    beforeEach(async () => {
      fakePortal = createFakePortal();
      baseUrl = await fakePortal.start();
    });

    afterEach(async () => {
      await fakePortal.stop();
    });

    it('serves stale-if-error when portal fails after initial load, then recovers when portal returns', async () => {
      let virtualNow = 10000000;
      const clock = () => virtualNow;

      const portalClient = new PortalClient({
        baseUrl,
        email: 'test@example.com',
        password: 'correct-password',
      });
      const portalApi = new PortalApi(portalClient);
      const datasetService = new DatasetService({
        api: portalApi,
        datasetTtlMs: 10000,
        staleIfErrorMs: 60000,
        clock,
      });

      const app = await buildApp({
        datasetService,
        portalApi,
        portalClient,
        disableLogger: true,
      });

      // 1. First request succeeds and loads dataset
      const res1 = await app.inject({ method: 'GET', url: '/meters?pageSize=2' });
      assert.equal(res1.statusCode, 200);
      assert.equal(res1.json().meta.stale, false);

      // 2. Portal goes completely down (returns 503)
      fakePortal.state.serverErrorsRemaining = 100;
      fakePortal.state.serverErrorCode = 503;

      // Advance clock past TTL (15s > 10s)
      virtualNow += 15000;

      // 3. Next request should serve stale cached data with meta.stale: true
      const res2 = await app.inject({ method: 'GET', url: '/meters?pageSize=2' });
      assert.equal(res2.statusCode, 200);
      const body2 = res2.json();
      assert.equal(body2.meta.stale, true);
      assert.equal(body2.data.length, 2);

      // 4. Portal recovers
      fakePortal.state.serverErrorsRemaining = 0;
      virtualNow += 20000; // past next TTL

      // 5. Next request should refresh and clear stale flag
      const res3 = await app.inject({ method: 'GET', url: '/meters?pageSize=2' });
      assert.equal(res3.statusCode, 200);
      const body3 = res3.json();
      assert.equal(body3.meta.stale, false);

      await app.close();
    });
  });
});
