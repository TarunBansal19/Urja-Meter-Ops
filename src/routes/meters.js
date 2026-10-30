import { applyFilters } from '../domain/meters.js';
import { NotFoundError, BadRequestError } from '../errors.js';

export async function metersRoutes(fastify, options) {
  const { datasetService } = options;

  fastify.get(
    '/meters',
    {
      schema: {
        description: 'List and query smart meters with filtering, text search, hierarchy prefix matching, and geospatial proximity.',
        tags: ['Meters'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1, description: 'Page number (1-based)' },
            pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Results per page (max 200)' },
            q: { type: 'string', description: 'Case-insensitive substring search on meterId and serialNo' },
            make: { type: 'string', description: 'Comma-separated meter brands (e.g. HPL,L&T)' },
            phaseType: { type: 'string', description: 'single or three' },
            installStatus: { type: 'string', description: 'Installed, Faulty, or Decommissioned' },
            installType: { type: 'string', description: 'Whole Current or CT Operated' },
            build: { type: 'string', description: 'legacy or v2' },
            dtCode: { type: 'string', description: 'Distribution transformer code (e.g. DT-001)' },
            node: { type: 'string', description: 'Hierarchy node ID prefix (e.g. Z-01:C-01)' },
            hasIssues: { type: 'string', enum: ['true', 'false'], description: 'Filter by presence of data quality issues' },
            near: { type: 'string', description: 'Geographic coordinate "lat,lng" for radial proximity search' },
            radiusKm: { type: 'number', minimum: 0, description: 'Maximum radius in km from near coordinate' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['data', 'pagination', 'meta'],
            properties: {
              data: { type: 'array', items: { $ref: 'Meter#' } },
              pagination: { $ref: 'Pagination#' },
              meta: { $ref: 'Meta#' },
            },
          },
          400: { $ref: 'Error#' },
          503: { $ref: 'Error#' },
        },
      },
    },
    async (request) => {
      const dataset = await datasetService.getDataset();
      const query = request.query;

      const page = parseInt(query.page || 1, 10);
      const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize || 50, 10)));

      const filtered = applyFilters(dataset.meters, query);
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      const startIndex = (page - 1) * pageSize;
      const data = filtered.slice(startIndex, startIndex + pageSize);

      return {
        data,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
        },
        meta: dataset.meta,
      };
    }
  );

  fastify.get(
    '/meters/:meterId',
    {
      schema: {
        description: 'Get full details for a single meter by meterId, including clean hierarchy and data quality annotations.',
        tags: ['Meters'],
        params: {
          type: 'object',
          required: ['meterId'],
          properties: {
            meterId: { type: 'string', example: 'J100000', description: 'Authoritative meter ID' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: { $ref: 'Meter#' },
              meta: { $ref: 'Meta#' },
            },
          },
          404: { $ref: 'Error#' },
          503: { $ref: 'Error#' },
        },
      },
    },
    async (request) => {
      const { meterId } = request.params;
      const dataset = await datasetService.getDataset();
      const meter = dataset.meterById.get(meterId);

      if (!meter) {
        throw new NotFoundError(`Meter ${meterId} not found`, { meterId });
      }

      return {
        data: meter,
        meta: dataset.meta,
      };
    }
  );
}
