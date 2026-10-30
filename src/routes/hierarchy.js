import { pruneTreeDepth } from '../domain/hierarchy.js';
import { NotFoundError } from '../errors.js';

export async function hierarchyRoutes(fastify, options) {
  const { datasetService } = options;

  fastify.get(
    '/hierarchy',
    {
      schema: {
        description: 'Get the full hierarchical electrical network distribution tree from zone roots down to distribution transformers.',
        tags: ['Hierarchy'],
        querystring: {
          type: 'object',
          properties: {
            depth: {
              type: 'integer',
              minimum: 1,
              maximum: 7,
              description: 'Optional depth limit (1=zone, 2=circle, 3=division, 4=subdivision, 5=substation, 6=feeder, 7=dt)',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: { type: 'array', items: { $ref: 'HierarchyNode#' } },
              meta: { $ref: 'Meta#' },
            },
          },
          503: { $ref: 'Error#' },
        },
      },
    },
    async (request) => {
      const dataset = await datasetService.getDataset();
      const { depth } = request.query;

      let tree = dataset.tree;
      if (depth !== undefined && depth !== null) {
        const d = parseInt(depth, 10);
        if (!Number.isNaN(d) && d > 0) {
          tree = pruneTreeDepth(dataset.tree, d);
        }
      }

      return {
        data: tree,
        meta: dataset.meta,
      };
    }
  );

  fastify.get(
    '/hierarchy/:nodeId',
    {
      schema: {
        description: 'Get the subtree rooted at a specific hierarchical node path (e.g. "Z-01:C-01").',
        tags: ['Hierarchy'],
        params: {
          type: 'object',
          required: ['nodeId'],
          properties: {
            nodeId: {
              type: 'string',
              example: 'Z-01:C-01',
              description: 'Colon-delimited hierarchical node path identifier',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: { $ref: 'HierarchyNode#' },
              meta: { $ref: 'Meta#' },
            },
          },
          404: { $ref: 'Error#' },
          503: { $ref: 'Error#' },
        },
      },
    },
    async (request) => {
      const { nodeId } = request.params;
      const dataset = await datasetService.getDataset();
      const node = dataset.nodesById.get(nodeId);

      if (!node) {
        throw new NotFoundError(`Hierarchy node "${nodeId}" not found`, { nodeId });
      }

      return {
        data: node,
        meta: dataset.meta,
      };
    }
  );
}
