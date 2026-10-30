import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { sampleRawMeters, sampleDts } from './fixtures/sample-dataset.js';
import { DatasetService } from '../src/store/dataset.js';
import { PortalUnavailableError } from '../src/errors.js';

describe('HTTP Routes via app.inject()', () => {
  let app;
  let mockApi;
  let datasetService;

  beforeEach(async () => {
    mockApi = {
      async fetchExport() {
        return sampleRawMeters;
      },
      async fetchDts() {
        return sampleDts;
      },
      async fetchEnergy(meterId) {
        return [
          { timestamp: '30/06/2026 22:30', kwh: '100.00', kvah: '110.00', voltR: '230' },
          { timestamp: '30/06/2026 23:00', kwh: '100.50', kvah: '110.55', voltR: '231' },
          { timestamp: '30/06/2026 23:30', kwh: '101.20', kvah: '111.35', voltR: '230' },
        ];
      },
    };

    datasetService = new DatasetService({
      api: mockApi,
      datasetTtlMs: 60000,
      readingsTtlMs: 30000,
    });

    app = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 3000,
        portalTzOffset: '+05:30',
      },
      portalApi: mockApi,
      datasetService,
      disableLogger: true,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns dataset loaded: false before warming', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.dataset.loaded, false);
    assert.equal(body.dataset.meterCount, 0);
  });

  it('GET /meters returns list with pagination and meta envelopes', async () => {
    const res = await app.inject({ method: 'GET', url: '/meters?pageSize=3&page=1' });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.data.length, 3);
    assert.equal(body.pagination.page, 1);
    assert.equal(body.pagination.pageSize, 3);
    assert.equal(body.pagination.total, 8);
    assert.equal(body.pagination.totalPages, 3);
    assert.equal(body.meta.stale, false);

    // Verify fastify schema did not drop required fields
    const meter = body.data[0];
    assert.ok(meter.meterId);
    assert.ok(meter.hierarchyNodeId);
    assert.ok(meter.hierarchy.zone);
    assert.ok(meter.dataQuality);
  });

  it('GET /meters filters by make and dtCode', async () => {
    const res = await app.inject({ method: 'GET', url: '/meters?make=HPL&dtCode=DT-001' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.length, 2);
    assert.ok(body.data.every((m) => m.make === 'HPL' && m.dtCode === 'DT-001'));
  });

  it('GET /meters/:meterId returns single meter', async () => {
    const res = await app.inject({ method: 'GET', url: '/meters/J100001' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.meterId, 'J100001');
    assert.equal(body.data.hierarchyNodeId, 'Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001');
  });

  it('GET /meters/:meterId returns 404 for unknown meter', async () => {
    const res = await app.inject({ method: 'GET', url: '/meters/UNKNOWN_METER' });
    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error.code, 'not_found');
  });

  it('GET /meters/:meterId/consumption returns readings, deltas and summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/meters/J100001/consumption' });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.data.meterId, 'J100001');
    assert.equal(body.data.intervalMinutes, 30);
    assert.equal(body.data.timezone, '+05:30');
    assert.equal(body.data.readings.length, 3);

    // Deltas
    assert.equal(body.data.readings[1].kwhDelta, 0.5);
    assert.equal(body.data.summary.kwhConsumed, 1.2);
    assert.equal(body.data.summary.voltageR.avg, 230.33);

    // Meta
    assert.equal(body.meta.rowCount, 3);
    assert.equal(body.meta.gaps, 0);
    assert.equal(body.meta.decreases, 0);
  });

  it('GET /meters/:meterId/consumption filters with date-only from/to parameters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meters/J100001/consumption?from=2026-06-30&to=2026-07-01',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.readings.length, 3);
  });

  it('GET /transformers returns all DTs', async () => {
    const res = await app.inject({ method: 'GET', url: '/transformers' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.length, 5);
  });

  it('GET /transformers/:code returns DT detail with breakdown and connected meters', async () => {
    const res = await app.inject({ method: 'GET', url: '/transformers/DT-001' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.code, 'DT-001');
    assert.equal(body.data.name, 'Malviya Nagar DT 1');
    assert.equal(body.data.meterCount, 3);
    assert.ok(body.data.breakdown.byMake);
    assert.equal(body.data.meters.length, 3);
  });

  it('GET /transformers/:code returns 404 on unknown DT', async () => {
    const res = await app.inject({ method: 'GET', url: '/transformers/UNKNOWN_DT' });
    assert.equal(res.statusCode, 404);
  });

  it('GET /hierarchy returns tree', async () => {
    const res = await app.inject({ method: 'GET', url: '/hierarchy' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data.length > 0);
    assert.equal(body.data[0].level, 'zone');
  });

  it('GET /hierarchy?depth=1 prunes tree', async () => {
    const res = await app.inject({ method: 'GET', url: '/hierarchy?depth=1' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data[0].children.length, 0);
  });

  it('GET /hierarchy/:nodeId returns subtree and 404 on unknown', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/hierarchy/Z-01' });
    assert.equal(res1.statusCode, 200);
    const body1 = res1.json();
    assert.equal(body1.data.id, 'Z-01');

    const res2 = await app.inject({ method: 'GET', url: '/hierarchy/UNKNOWN_NODE' });
    assert.equal(res2.statusCode, 404);
  });

  it('GET /stats returns breakdown totals', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.totals.meters, 8);
    assert.ok(body.data.byMake);
  });

  it('GET /data-quality returns full report', async () => {
    const res = await app.inject({ method: 'GET', url: '/data-quality' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.data.summary);
    assert.ok(Array.isArray(body.data.filledFields));
    assert.ok(Array.isArray(body.data.dtAliases));
  });

  it('POST /admin/refresh invalidates and reloads dataset', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/refresh' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.refreshed, true);
    assert.equal(body.data.meterCount, 8);
  });

  it('GET / serves the static web client index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.body.includes('Urja Meter Ops Explorer'));
  });

  it('returns 400 invalid_request on bad query parameters', async () => {
    const res = await app.inject({ method: 'GET', url: '/meters?near=invalid_coords' });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error.code, 'invalid_request');
  });

  it('returns 503 upstream_unavailable when portal fails on cold start with no cached data', async () => {
    const failingApi = {
      async fetchExport() {
        throw new PortalUnavailableError('Portal offline');
      },
      async fetchDts() {
        throw new PortalUnavailableError('Portal offline');
      },
      async fetchEnergy() {
        throw new PortalUnavailableError('Portal offline');
      },
    };

    const failingDatasetService = new DatasetService({
      api: failingApi,
    });

    const failingApp = await buildApp({
      datasetService: failingDatasetService,
      portalApi: failingApi,
      disableLogger: true,
    });

    const res = await failingApp.inject({ method: 'GET', url: '/meters' });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.error.code, 'upstream_unavailable');

    await failingApp.close();
  });
});
