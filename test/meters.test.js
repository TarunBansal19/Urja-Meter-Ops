import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExportRow,
  haversineKm,
  applyFilters,
} from '../src/domain/meters.js';
import { BadRequestError } from '../src/errors.js';
import { sampleRawMeters } from './fixtures/sample-dataset.js';

describe('domain/meters', () => {
  it('normalizes raw export row cleanly', () => {
    const raw = {
      meterId: '  J100000  ',
      serialNo: 'SE12345',
      make: 'HPL',
      phaseType: 'Single',
      installStatus: 'Installed',
      installType: 'Whole Current',
      build: 'legacy',
      dtCode: 'DT-001',
      geo: { lat: 26.9389, lng: 75.8309 },
      hierarchy: {
        zone: { code: ' Z-01 ', name: ' Jaipur Zone 1 ' },
        circle: { code: '', name: '   ' },
      },
    };

    const normalized = normalizeExportRow(raw);
    assert.equal(normalized.meterId, 'J100000');
    assert.equal(normalized.phaseType, 'single');
    assert.equal(normalized.installStatus, 'Installed');
    assert.deepEqual(normalized.location, {
      latitude: 26.9389,
      longitude: 75.8309,
    });
    assert.equal(normalized.hierarchy.zone.code, 'Z-01');
    assert.equal(normalized.hierarchy.zone.name, 'Jaipur Zone 1');
    assert.equal(normalized.hierarchy.circle.code, null);
    assert.equal(normalized.hierarchy.circle.name, null);
  });

  it('handles missing or invalid geo coordinates gracefully', () => {
    const raw1 = { meterId: 'J1', geo: { lat: 'invalid', lng: 75 } };
    const norm1 = normalizeExportRow(raw1);
    assert.equal(norm1.location, null);

    const raw2 = { meterId: 'J2', geo: null };
    const norm2 = normalizeExportRow(raw2);
    assert.equal(norm2.location, null);
  });

  it('calculates haversine distance correctly', () => {
    // Distance between (26.90, 75.80) and (26.91, 75.80) is ~1.11 km
    const dist = haversineKm(26.90, 75.80, 26.91, 75.80);
    assert.ok(dist > 1.10 && dist < 1.12);
  });

  describe('applyFilters', () => {
    const meters = sampleRawMeters.map(normalizeExportRow);

    it('filters by q substring on meterId and serialNo case-insensitively', () => {
      const res1 = applyFilters(meters, { q: 'j100001' });
      assert.equal(res1.length, 1);
      assert.equal(res1[0].meterId, 'J100001');

      const res2 = applyFilters(meters, { q: 'se1003' });
      assert.equal(res2.length, 1);
      assert.equal(res2[0].meterId, 'J100003');
    });

    it('filters by comma-separated multi-value parameters', () => {
      const res = applyFilters(meters, { make: 'HPL,l&t' });
      assert.equal(res.length, 5); // J100001 (HPL), J100002 (L&T), J100003 (HPL), J100007 (HPL), J100008 (L&T)
      const makes = new Set(res.map((m) => m.make));
      assert.ok(makes.has('HPL'));
      assert.ok(makes.has('L&T'));
    });

    it('filters by phaseType, installStatus, and dtCode', () => {
      const res1 = applyFilters(meters, { phaseType: 'three' });
      assert.equal(res1.length, 2); // J100002, J100004

      const res2 = applyFilters(meters, { installStatus: 'Faulty' });
      assert.equal(res2.length, 1);
      assert.equal(res2[0].meterId, 'J100002');

      const res3 = applyFilters(meters, { dtCode: 'DT-001' });
      assert.equal(res3.length, 3);
    });

    it('sorts and filters by near and radiusKm', () => {
      // Center at J100001 (26.90, 75.80)
      const res = applyFilters(meters, {
        near: '26.90,75.80',
        radiusKm: 5,
      });

      // J100001 (0 km), J100002 (~1.1 km), J100004 (~2.4 km) should match. J100003 (~66 km) excluded.
      assert.ok(res.length >= 2);
      assert.equal(res[0].meterId, 'J100001');
      assert.equal(res[0].distanceKm, 0);
      assert.equal(res[1].meterId, 'J100002');
      assert.ok(res[0].distanceKm <= res[1].distanceKm);
    });

    it('throws BadRequestError on invalid near format', () => {
      assert.throws(
        () => applyFilters(meters, { near: 'invalid-coords' }),
        (err) => err instanceof BadRequestError && err.message.includes('"near"')
      );
      assert.throws(
        () => applyFilters(meters, { near: '100,50' }), // lat > 90
        (err) => err instanceof BadRequestError
      );
    });
  });
});
