import { parsePortalTimestamp, parseQueryInstant } from './time.js';

const EXPECTED_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Parse a raw number string safely; returns null if not finite.
 * @param {any} val
 * @returns {number|null}
 */
function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize and sort raw energy rows from /portal/meters/{id}/energy.
 * Computes interval deltas and flags gaps / decreases.
 *
 * @param {any[]} rawRows
 * @param {Object} [options]
 * @param {string} [options.tzOffset='+05:30']
 * @returns {{
 *   readings: DomainReading[],
 *   meta: {
 *     availableFrom: string|null,
 *     latestReadingAt: string|null,
 *     totalAvailable: number,
 *     skippedRows: number
 *   }
 * }}
 */
export function normalizeEnergy(rawRows = [], options = {}) {
  const tzOffset = options.tzOffset || '+05:30';
  let skippedRows = 0;

  const parsed = [];
  for (const raw of rawRows) {
    const ts = parsePortalTimestamp(raw?.timestamp, tzOffset);
    if (!ts) {
      skippedRows++;
      continue;
    }

    parsed.push({
      timestamp: ts.iso,
      epochMs: ts.epochMs,
      kwh: parseNumber(raw.kwh),
      kvah: parseNumber(raw.kvah),
      voltageR: parseNumber(raw.voltR),
      kwhDelta: null,
      kvahDelta: null,
    });
  }

  // Sort ascending by time
  parsed.sort((a, b) => a.epochMs - b.epochMs);

  // Compute deltas on the full dataset before window slicing
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];

    const timeDiff = curr.epochMs - prev.epochMs;
    // Exactly one 30-min interval earlier
    if (timeDiff === EXPECTED_INTERVAL_MS) {
      if (curr.kwh !== null && prev.kwh !== null) {
        const delta = curr.kwh - prev.kwh;
        if (delta >= 0) {
          curr.kwhDelta = Math.round(delta * 1000) / 1000;
        }
      }

      if (curr.kvah !== null && prev.kvah !== null) {
        const delta = curr.kvah - prev.kvah;
        if (delta >= 0) {
          curr.kvahDelta = Math.round(delta * 1000) / 1000;
        }
      }
    }
  }

  const availableFrom = parsed.length > 0 ? parsed[0].timestamp : null;
  const latestReadingAt = parsed.length > 0 ? parsed[parsed.length - 1].timestamp : null;

  return {
    readings: parsed,
    meta: {
      availableFrom,
      latestReadingAt,
      totalAvailable: parsed.length,
      skippedRows,
    },
  };
}

/**
 * Filter readings by time range [from, to).
 *
 * @param {DomainReading[]} readings
 * @param {Object} [range]
 * @param {string} [range.from]
 * @param {string} [range.to]
 * @param {string} [tzOffset='+05:30']
 * @returns {DomainReading[]}
 */
export function filterReadingsRange(readings, range = {}, tzOffset = '+05:30') {
  let filtered = readings;

  if (range.from) {
    const fromInstant = parseQueryInstant(range.from, tzOffset);
    filtered = filtered.filter((r) => r.epochMs >= fromInstant.epochMs);
  }

  if (range.to) {
    const toInstant = parseQueryInstant(range.to, tzOffset);
    filtered = filtered.filter((r) => r.epochMs < toInstant.epochMs);
  }

  return filtered;
}

/**
 * Summarize a slice of readings (total consumption and voltage stats).
 *
 * @param {DomainReading[]} readings
 * @returns {{
 *   summary: {
 *     kwhConsumed: number,
 *     kvahConsumed: number,
 *     voltageR: { min: number|null, max: number|null, avg: number|null }
 *   },
 *   gaps: number,
 *   decreases: number
 * }}
 */
export function summarizeReadings(readings) {
  let gaps = 0;
  let decreases = 0;

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];
    const timeDiff = curr.epochMs - prev.epochMs;

    if (timeDiff !== EXPECTED_INTERVAL_MS) {
      gaps++;
    }

    if (curr.kwh !== null && prev.kwh !== null && curr.kwh < prev.kwh) {
      decreases++;
    }
  }

  let kwhConsumed = 0;
  let kvahConsumed = 0;

  if (readings.length >= 2) {
    const first = readings[0];
    const last = readings[readings.length - 1];
    if (last.kwh !== null && first.kwh !== null && last.kwh >= first.kwh) {
      kwhConsumed = Math.round((last.kwh - first.kwh) * 1000) / 1000;
    }
    if (last.kvah !== null && first.kvah !== null && last.kvah >= first.kvah) {
      kvahConsumed = Math.round((last.kvah - first.kvah) * 1000) / 1000;
    }
  }

  // Voltage statistics
  const voltages = readings.map((r) => r.voltageR).filter((v) => v !== null);
  let voltageStats = { min: null, max: null, avg: null };

  if (voltages.length > 0) {
    const min = Math.min(...voltages);
    const max = Math.max(...voltages);
    const sum = voltages.reduce((acc, v) => acc + v, 0);
    const avg = Math.round((sum / voltages.length) * 100) / 100;
    voltageStats = { min, max, avg };
  }

  return {
    summary: {
      kwhConsumed,
      kvahConsumed,
      voltageR: voltageStats,
    },
    gaps,
    decreases,
  };
}

/**
 * @typedef {Object} DomainReading
 * @property {string} timestamp ISO 8601 string with timezone offset
 * @property {number} epochMs
 * @property {number|null} kwh
 * @property {number|null} kvah
 * @property {number|null} voltageR
 * @property {number|null} kwhDelta
 * @property {number|null} kvahDelta
 */
