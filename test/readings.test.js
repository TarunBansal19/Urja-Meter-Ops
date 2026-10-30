import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePortalTimestamp, parseQueryInstant } from '../src/domain/time.js';
import {
  normalizeEnergy,
  filterReadingsRange,
  summarizeReadings,
} from '../src/domain/readings.js';
import { BadRequestError } from '../src/errors.js';

describe('domain/time', () => {
  it('parses day-first portal timestamps with strict offset', () => {
    const res1 = parsePortalTimestamp('30/06/2026 23:30', '+05:30');
    assert.ok(res1);
    assert.equal(res1.iso, '2026-06-30T23:30:00+05:30');

    // Midnight
    const res2 = parsePortalTimestamp('01/01/2026 00:00', '+05:30');
    assert.ok(res2);
    assert.equal(res2.iso, '2026-01-01T00:00:00+05:30');

    // 31st of December
    const res3 = parsePortalTimestamp('31/12/2026 12:00', '+05:30');
    assert.ok(res3);
    assert.equal(res3.iso, '2026-12-31T12:00:00+05:30');
  });

  it('rejects invalid or impossible dates', () => {
    assert.equal(parsePortalTimestamp('31/02/2026 12:00'), null); // Feb 31 does not exist
    assert.equal(parsePortalTimestamp('2026-06-30 23:30'), null); // Wrong delimiter
    assert.equal(parsePortalTimestamp('random-string'), null);
  });

  it('parses query instant with date-only and full ISO', () => {
    const dateOnly = parseQueryInstant('2026-06-30', '+05:30');
    assert.equal(dateOnly.iso, '2026-06-30T00:00:00+05:30');

    const fullIso = parseQueryInstant('2026-06-30T10:00:00+05:30');
    assert.ok(fullIso.epochMs > 0);

    assert.throws(() => parseQueryInstant('invalid-date'), (err) => err instanceof BadRequestError);
  });
});

describe('domain/readings', () => {
  it('normalizes numbers, parses trailing zeros and computes deltas', () => {
    const raw = [
      { timestamp: '30/06/2026 22:30', kwh: '48440.00', kvah: '52000.0', voltR: '230' },
      { timestamp: '30/06/2026 23:00', kwh: '48440.50', kvah: '52000.6', voltR: '232' },
      { timestamp: '30/06/2026 23:30', kwh: '48441.25', kvah: '52001.5', voltR: '231' },
    ];

    const { readings, meta } = normalizeEnergy(raw);
    assert.equal(readings.length, 3);
    assert.equal(meta.skippedRows, 0);

    // Row 0 has null deltas
    assert.equal(readings[0].kwhDelta, null);

    // Row 1 delta: 48440.50 - 48440.00 = 0.5
    assert.equal(readings[1].kwhDelta, 0.5);
    assert.equal(readings[1].kvahDelta, 0.6);

    // Row 2 delta: 48441.25 - 48440.50 = 0.75
    assert.equal(readings[2].kwhDelta, 0.75);
    assert.equal(readings[2].kvahDelta, 0.9);
  });

  it('handles gap rows properly (sets delta to null and increments gap count)', () => {
    const raw = [
      { timestamp: '30/06/2026 20:00', kwh: '100.0', kvah: '110.0', voltR: '230' },
      // 1 hour gap instead of 30 min:
      { timestamp: '30/06/2026 21:00', kwh: '102.0', kvah: '112.0', voltR: '230' },
    ];

    const { readings } = normalizeEnergy(raw);
    assert.equal(readings[1].kwhDelta, null);

    const { gaps } = summarizeReadings(readings);
    assert.equal(gaps, 1);
  });

  it('handles decreasing counter (resets delta to null and flags decrease)', () => {
    const raw = [
      { timestamp: '30/06/2026 20:00', kwh: '100.0', kvah: '110.0', voltR: '230' },
      // Decreasing register
      { timestamp: '30/06/2026 20:30', kwh: '90.0', kvah: '100.0', voltR: '230' },
    ];

    const { readings } = normalizeEnergy(raw);
    assert.equal(readings[1].kwhDelta, null);

    const { decreases } = summarizeReadings(readings);
    assert.equal(decreases, 1);
  });

  it('handles empty raw list gracefully', () => {
    const { readings, meta } = normalizeEnergy([]);
    assert.equal(readings.length, 0);
    assert.equal(meta.availableFrom, null);
    assert.equal(meta.latestReadingAt, null);

    const { summary } = summarizeReadings([]);
    assert.equal(summary.kwhConsumed, 0);
    assert.equal(summary.voltageR.avg, null);
  });

  it('filters by range [from, to) with boundary check', () => {
    const raw = [
      { timestamp: '30/06/2026 00:00', kwh: '10.0', kvah: '10.0', voltR: '230' },
      { timestamp: '30/06/2026 12:00', kwh: '20.0', kvah: '20.0', voltR: '230' },
      { timestamp: '01/07/2026 00:00', kwh: '30.0', kvah: '30.0', voltR: '230' },
    ];

    const { readings } = normalizeEnergy(raw);

    // [from: 2026-06-30T00:00:00+05:30, to: 2026-07-01T00:00:00+05:30)
    // row 0 and row 1 should be included; row 2 excluded (exclusive 'to')
    const filtered = filterReadingsRange(readings, {
      from: '2026-06-30T00:00:00+05:30',
      to: '2026-07-01T00:00:00+05:30',
    });

    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].timestamp, '2026-06-30T00:00:00+05:30');
    assert.equal(filtered[1].timestamp, '2026-06-30T12:00:00+05:30');
  });
});
