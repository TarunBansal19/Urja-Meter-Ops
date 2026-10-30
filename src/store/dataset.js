import { AsyncCache } from './async-cache.js';
import { normalizeExportRow } from '../domain/meters.js';
import { buildHierarchy } from '../domain/hierarchy.js';
import { NotFoundError } from '../errors.js';

export class DatasetService {
  /**
   * @param {Object} options
   * @param {import('../portal/api.js').PortalApi} options.api
   * @param {number} [options.datasetTtlMs=3600000]
   * @param {number} [options.readingsTtlMs=900000]
   * @param {number} [options.staleIfErrorMs=86400000]
   * @param {() => number} [options.clock]
   */
  constructor(options) {
    this.api = options.api;
    this.clock = options.clock || (() => Date.now());

    this.datasetCache = new AsyncCache({
      ttlMs: options.datasetTtlMs ?? 3600000,
      staleIfErrorMs: options.staleIfErrorMs ?? 86400000,
      clock: this.clock,
    });

    this.readingsCache = new AsyncCache({
      ttlMs: options.readingsTtlMs ?? 900000,
      staleIfErrorMs: options.staleIfErrorMs ?? 86400000,
      maxEntries: 500,
      clock: this.clock,
    });
  }

  /**
   * Invalidate the dataset cache to force a fresh reload on next access.
   */
  invalidate() {
    this.datasetCache.invalidate('dataset');
  }

  /**
   * Warm up the dataset (non-blocking call).
   */
  async warm() {
    try {
      await this.getDataset();
    } catch {
      // Do not crash on boot if portal is down
    }
  }

  /**
   * Compute breakdown counts for various meter attributes.
   * @param {import('../domain/meters.js').DomainMeter[]} meters
   */
  #computeStats(meters, transformersCount) {
    const countBy = (prop) => {
      const counts = {};
      for (const m of meters) {
        const val = m[prop] || 'unknown';
        counts[val] = (counts[val] || 0) + 1;
      }
      return counts;
    };

    return {
      totals: {
        meters: meters.length,
        transformers: transformersCount,
        metersWithIssues: meters.filter((m) => m.dataQuality.issues.length > 0).length,
      },
      byMake: countBy('make'),
      byInstallStatus: countBy('installStatus'),
      byPhaseType: countBy('phaseType'),
      byInstallType: countBy('installType'),
      byBuild: countBy('build'),
    };
  }

  /**
   * Retrieve the parsed and indexed dataset.
   *
   * @returns {Promise<{
   *   meters: import('../domain/meters.js').DomainMeter[],
   *   meterById: Map<string, import('../domain/meters.js').DomainMeter>,
   *   transformers: any[],
   *   transformersByCode: Map<string, any>,
   *   tree: any[],
   *   nodesById: Map<string, any>,
   *   report: any,
   *   stats: any,
   *   meta: { fetchedAt: string, ageMs: number, stale: boolean }
   * }>}
   */
  async getDataset() {
    const cached = await this.datasetCache.get('dataset', async () => {
      // Fetch export and DTs concurrently
      const [rawExport, rawDts] = await Promise.all([
        this.api.fetchExport(),
        this.api.fetchDts(),
      ]);

      // Normalize export meters
      const normalizedMeters = rawExport.map(normalizeExportRow);

      // Clean hierarchy, build tree and data-quality report
      const { meters, roots, nodesById, transformers, report } = buildHierarchy(
        normalizedMeters,
        rawDts
      );

      // Build fast lookup indexes
      const meterById = new Map();
      for (const meter of meters) {
        if (meter.meterId) {
          meterById.set(meter.meterId, meter);
        }
      }

      const transformersByCode = new Map();
      for (const dt of transformers) {
        transformersByCode.set(dt.code, dt);
      }

      // Compute statistics summary
      const stats = this.#computeStats(meters, transformers.length);

      return {
        meters,
        meterById,
        transformers,
        transformersByCode,
        tree: roots,
        nodesById,
        report,
        stats,
      };
    });

    return {
      ...cached.value,
      meta: {
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        ageMs: cached.ageMs,
        stale: cached.stale,
      },
    };
  }

  /**
   * Get raw energy readings for a meter with caching.
   * Checks whether meter exists in dataset first.
   *
   * @param {string} meterId
   * @returns {Promise<{ readings: any[], meta: { fetchedAt: string, ageMs: number, stale: boolean } }>}
   */
  async getEnergyReadings(meterId) {
    // 1. Ensure meter exists in our local dataset
    const dataset = await this.getDataset();
    if (!dataset.meterById.has(meterId)) {
      throw new NotFoundError(`Meter ${meterId} not found`, { meterId });
    }

    const cached = await this.readingsCache.get(meterId, async () => {
      return this.api.fetchEnergy(meterId);
    });

    return {
      readings: cached.value,
      meta: {
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        ageMs: cached.ageMs,
        stale: cached.stale,
      },
    };
  }
}
