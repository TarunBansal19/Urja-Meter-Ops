import { BadRequestError } from '../errors.js';

export const HIERARCHY_LEVELS = [
  'zone',
  'circle',
  'division',
  'subdivision',
  'substation',
  'feeder',
  'dt',
];

/**
 * Trim string value; convert empty/whitespace-only to null.
 * @param {any} val
 * @returns {string|null}
 */
export function cleanString(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

/**
 * Normalize a raw row from /portal/export into our clean domain format.
 *
 * @param {any} raw
 * @returns {DomainMeter}
 */
export function normalizeExportRow(raw) {
  const meterId = cleanString(raw.meterId);
  const serialNo = cleanString(raw.serialNo);
  const make = cleanString(raw.make);
  const phaseType = cleanString(raw.phaseType)?.toLowerCase() || null;
  const installStatus = cleanString(raw.installStatus);
  const installType = cleanString(raw.installType);
  const build = cleanString(raw.build);
  const dtCode = cleanString(raw.dtCode);

  let location = null;
  const rawLat = raw.geo?.lat ?? raw.location?.latitude;
  const rawLng = raw.geo?.lng ?? raw.location?.longitude;
  const latNum = typeof rawLat === 'number' ? rawLat : parseFloat(rawLat);
  const lngNum = typeof rawLng === 'number' ? rawLng : parseFloat(rawLng);

  if (!Number.isNaN(latNum) && !Number.isNaN(lngNum) && latNum !== null && lngNum !== null) {
    location = {
      latitude: latNum,
      longitude: lngNum,
    };
  }

  const hierarchy = {};
  for (const level of HIERARCHY_LEVELS) {
    const rawLevel = raw.hierarchy?.[level] || {};
    hierarchy[level] = {
      code: cleanString(rawLevel.code),
      name: cleanString(rawLevel.name),
      inferred: false,
    };
  }

  return {
    meterId,
    serialNo,
    make,
    phaseType,
    installStatus,
    installType,
    build,
    dtCode,
    location,
    hierarchy,
    hierarchyNodeId: '',
    dataQuality: {
      issues: [],
    },
  };
}

/**
 * Calculate Great Circle distance between two points in kilometers.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's mean radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parse comma-separated filter value into a set of lowercased tokens.
 * @param {string|string[]} val
 * @returns {Set<string>}
 */
function parseMultiFilter(val) {
  const tokens = new Set();
  const arr = Array.isArray(val) ? val : String(val).split(',');
  for (const item of arr) {
    const trimmed = item.trim().toLowerCase();
    if (trimmed) tokens.add(trimmed);
  }
  return tokens;
}

/**
 * Filter and sort meters in-memory.
 *
 * @param {DomainMeter[]} meters
 * @param {Object} query
 * @param {string} [query.q]
 * @param {string} [query.make]
 * @param {string} [query.phaseType]
 * @param {string} [query.installStatus]
 * @param {string} [query.installType]
 * @param {string} [query.build]
 * @param {string} [query.dtCode]
 * @param {string} [query.node]
 * @param {boolean|string} [query.hasIssues]
 * @param {string} [query.near] 'lat,lng'
 * @param {number|string} [query.radiusKm]
 * @returns {Array<DomainMeter & { distanceKm?: number }>}
 */
export function applyFilters(meters, query = {}) {
  let filtered = [...meters];

  // 1. Text search q on meterId and serialNo (case-insensitive substring)
  if (query.q) {
    const q = String(query.q).trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        (m) =>
          (m.meterId && m.meterId.toLowerCase().includes(q)) ||
          (m.serialNo && m.serialNo.toLowerCase().includes(q))
      );
    }
  }

  // 2. Multi-value filters
  const filterKeys = ['make', 'phaseType', 'installStatus', 'installType', 'build', 'dtCode'];
  for (const key of filterKeys) {
    if (query[key]) {
      const allowed = parseMultiFilter(query[key]);
      if (allowed.size > 0) {
        filtered = filtered.filter((m) => {
          const val = m[key];
          return val && allowed.has(String(val).toLowerCase());
        });
      }
    }
  }

  // 3. Hierarchy node prefix filter
  if (query.node) {
    const nodePrefix = String(query.node).trim();
    if (nodePrefix) {
      filtered = filtered.filter((m) => {
        if (!m.hierarchyNodeId) return false;
        return m.hierarchyNodeId === nodePrefix || m.hierarchyNodeId.startsWith(`${nodePrefix}:`);
      });
    }
  }

  // 4. hasIssues filter
  if (query.hasIssues !== undefined && query.hasIssues !== '') {
    const wantIssues =
      query.hasIssues === true ||
      query.hasIssues === 'true' ||
      query.hasIssues === '1';
    filtered = filtered.filter((m) =>
      wantIssues ? m.dataQuality.issues.length > 0 : m.dataQuality.issues.length === 0
    );
  }

  // 5. Geo near + radiusKm filter
  let isGeoSorted = false;
  if (query.near) {
    const parts = String(query.near).split(',').map((p) => parseFloat(p.trim()));
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
      throw new BadRequestError('Invalid "near" parameter. Expected format: "lat,lng" as decimal numbers.');
    }
    const [centerLat, centerLng] = parts;
    if (centerLat < -90 || centerLat > 90 || centerLng < -180 || centerLng > 180) {
      throw new BadRequestError('Latitude must be between -90 and 90, longitude between -180 and 180.');
    }

    let maxRadius = Infinity;
    if (query.radiusKm !== undefined && query.radiusKm !== '') {
      const r = parseFloat(query.radiusKm);
      if (Number.isNaN(r) || r < 0) {
        throw new BadRequestError('Invalid "radiusKm" parameter. Must be a positive number.');
      }
      maxRadius = r;
    }

    const withDist = [];
    for (const m of filtered) {
      if (!m.location || typeof m.location.latitude !== 'number' || typeof m.location.longitude !== 'number') {
        continue;
      }
      const dist = haversineKm(centerLat, centerLng, m.location.latitude, m.location.longitude);
      const roundedDist = Math.round(dist * 1000) / 1000;
      if (roundedDist <= maxRadius) {
        withDist.push({
          ...m,
          distanceKm: roundedDist,
        });
      }
    }

    withDist.sort((a, b) => a.distanceKm - b.distanceKm);
    filtered = withDist;
    isGeoSorted = true;
  }

  // Default ordering: meterId asc (if not sorted by geo)
  if (!isGeoSorted) {
    filtered.sort((a, b) => (a.meterId || '').localeCompare(b.meterId || ''));
  }

  return filtered;
}

/**
 * @typedef {Object} DomainMeter
 * @property {string} meterId
 * @property {string} serialNo
 * @property {string} make
 * @property {string} phaseType
 * @property {string} installStatus
 * @property {string} installType
 * @property {string} build
 * @property {string} dtCode
 * @property {{ latitude: number, longitude: number }|null} location
 * @property {Record<string, { code: string|null, name: string|null, inferred: boolean }>} hierarchy
 * @property {string} hierarchyNodeId
 * @property {{ issues: Array<{ code: string, message?: string, field?: string, value?: any, source?: string }> }} dataQuality
 */
