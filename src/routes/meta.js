export async function metaRoutes(fastify, options) {
  const { datasetService } = options;

  fastify.get(
    '/health',
    {
      schema: {
        description: 'Liveness check and local dataset status. Never makes an upstream network call.',
        tags: ['System'],
        response: {
          200: {
            type: 'object',
            required: ['status', 'dataset'],
            properties: {
              status: { type: 'string', example: 'ok' },
              dataset: {
                type: 'object',
                required: ['loaded', 'stale', 'meterCount'],
                properties: {
                  loaded: { type: 'boolean' },
                  fetchedAt: { type: 'string', nullable: true },
                  ageMs: { type: 'number', nullable: true },
                  stale: { type: 'boolean' },
                  meterCount: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const isLoaded = datasetService.datasetCache.has('dataset');
      if (!isLoaded) {
        return {
          status: 'ok',
          dataset: {
            loaded: false,
            fetchedAt: null,
            ageMs: null,
            stale: false,
            meterCount: 0,
          },
        };
      }

      // Read from cache without triggering network loader
      const cached = datasetService.datasetCache.store.get('dataset');
      const now = datasetService.clock();
      const ageMs = cached ? now - cached.fetchedAt : null;
      const fetchedAt = cached ? new Date(cached.fetchedAt).toISOString() : null;
      const meterCount = cached?.value?.meters?.length || 0;
      const stale = ageMs !== null && ageMs > datasetService.datasetCache.ttlMs;

      return {
        status: 'ok',
        dataset: {
          loaded: true,
          fetchedAt,
          ageMs,
          stale,
          meterCount,
        },
      };
    }
  );

  fastify.get(
    '/stats',
    {
      schema: {
        description: 'Comprehensive breakdown counts by make, phase, status, installation type, and build.',
        tags: ['System'],
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: {
                type: 'object',
                required: ['totals', 'byMake', 'byInstallStatus', 'byPhaseType', 'byInstallType', 'byBuild'],
                properties: {
                  totals: {
                    type: 'object',
                    properties: {
                      meters: { type: 'integer' },
                      transformers: { type: 'integer' },
                      metersWithIssues: { type: 'integer' },
                    },
                  },
                  byMake: { type: 'object', additionalProperties: { type: 'integer' } },
                  byInstallStatus: { type: 'object', additionalProperties: { type: 'integer' } },
                  byPhaseType: { type: 'object', additionalProperties: { type: 'integer' } },
                  byInstallType: { type: 'object', additionalProperties: { type: 'integer' } },
                  byBuild: { type: 'object', additionalProperties: { type: 'integer' } },
                },
              },
              meta: { $ref: 'Meta#' },
            },
          },
          503: { $ref: 'Error#' },
        },
      },
    },
    async () => {
      const dataset = await datasetService.getDataset();
      return {
        data: dataset.stats,
        meta: dataset.meta,
      };
    }
  );

  fastify.get(
    '/data-quality',
    {
      schema: {
        description: 'Detailed report of all cleaned hierarchy fields, DT aliases, and anomalies discovered in upstream data.',
        tags: ['System'],
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: {
                type: 'object',
                required: ['summary'],
                properties: {
                  summary: {
                    type: 'object',
                    properties: {
                      totalMeters: { type: 'integer' },
                      totalTransformers: { type: 'integer' },
                      metersWithIssues: { type: 'integer' },
                      filledFieldsCount: { type: 'integer' },
                      dtAliasesCount: { type: 'integer' },
                      conflictsCount: { type: 'integer' },
                      feederMismatchesCount: { type: 'integer' },
                      unknownFieldsCount: { type: 'integer' },
                    },
                  },
                  filledFields: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  dtAliases: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  conflicts: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  feederMismatches: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  unknownFields: { type: 'array', items: { type: 'object', additionalProperties: true } },
                },
              },
              meta: { $ref: 'Meta#' },
            },
          },
          503: { $ref: 'Error#' },
        },
      },
    },
    async () => {
      const dataset = await datasetService.getDataset();
      return {
        data: dataset.report,
        meta: dataset.meta,
      };
    }
  );

  fastify.post(
    '/admin/refresh',
    {
      schema: {
        description: 'Trigger immediate invalidation and background/single-flight reloading of the meter dataset from the portal.',
        tags: ['System'],
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: {
                type: 'object',
                required: ['refreshed', 'meterCount'],
                properties: {
                  refreshed: { type: 'boolean', example: true },
                  meterCount: { type: 'integer', example: 403 },
                },
              },
              meta: { $ref: 'Meta#' },
            },
          },
          503: { $ref: 'Error#' },
        },
      },
    },
    async () => {
      datasetService.invalidate();
      const freshDataset = await datasetService.getDataset();
      return {
        data: {
          refreshed: true,
          meterCount: freshDataset.meters.length,
        },
        meta: freshDataset.meta,
      };
    }
  );
}
