import { NotFoundError } from '../errors.js';

export async function transformersRoutes(fastify, options) {
  const { datasetService } = options;

  fastify.get(
    '/transformers',
    {
      schema: {
        description: 'List all distribution transformers (DTs) with authoritative capacity, parent feeder, and connected meter counts.',
        tags: ['Transformers'],
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: { type: 'array', items: { $ref: 'Transformer#' } },
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
        data: dataset.transformers,
        meta: dataset.meta,
      };
    }
  );

  fastify.get(
    '/transformers/:code',
    {
      schema: {
        description: 'Get details for a single distribution transformer including connected meters and make/status breakdown.',
        tags: ['Transformers'],
        params: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', example: 'DT-001', description: 'Distribution transformer code' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: {
                type: 'object',
                required: ['code', 'name', 'aliases', 'feederCode', 'capacityKva', 'meterCount', 'hierarchyNodeId', 'breakdown', 'meters'],
                properties: {
                  code: { type: 'string' },
                  name: { type: 'string' },
                  aliases: { type: 'array', items: { type: 'string' } },
                  feederCode: { type: 'string', nullable: true },
                  capacityKva: { type: 'number', nullable: true },
                  meterCount: { type: 'integer' },
                  hierarchyNodeId: { type: 'string' },
                  breakdown: {
                    type: 'object',
                    properties: {
                      byInstallStatus: { type: 'object', additionalProperties: { type: 'integer' } },
                      byMake: { type: 'object', additionalProperties: { type: 'integer' } },
                    },
                  },
                  meters: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        meterId: { type: 'string' },
                        serialNo: { type: 'string' },
                        make: { type: 'string' },
                        phaseType: { type: 'string' },
                        installStatus: { type: 'string' },
                      },
                    },
                  },
                },
              },
              meta: { $ref: 'Meta#' },
            },
          },
          404: { $ref: 'Error#' },
          503: { $ref: 'Error#' },
        },
      },
    },
    async (request) => {
      const { code } = request.params;
      const dataset = await datasetService.getDataset();
      const dt = dataset.transformersByCode.get(code);

      if (!dt) {
        throw new NotFoundError(`Transformer ${code} not found`, { code });
      }

      const dtMeters = dataset.meters.filter((m) => m.dtCode === code);

      const byInstallStatus = {};
      const byMake = {};
      const metersSummary = [];

      for (const m of dtMeters) {
        byInstallStatus[m.installStatus || 'unknown'] = (byInstallStatus[m.installStatus || 'unknown'] || 0) + 1;
        byMake[m.make || 'unknown'] = (byMake[m.make || 'unknown'] || 0) + 1;
        metersSummary.push({
          meterId: m.meterId,
          serialNo: m.serialNo,
          make: m.make,
          phaseType: m.phaseType,
          installStatus: m.installStatus,
        });
      }

      return {
        data: {
          ...dt,
          breakdown: {
            byInstallStatus,
            byMake,
          },
          meters: metersSummary,
        },
        meta: dataset.meta,
      };
    }
  );
}
