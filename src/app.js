import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifyScalar from '@scalar/fastify-api-reference';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

import { allSchemas } from './schemas/index.js';
import { metersRoutes } from './routes/meters.js';
import { consumptionRoutes } from './routes/consumption.js';
import { transformersRoutes } from './routes/transformers.js';
import { hierarchyRoutes } from './routes/hierarchy.js';
import { metaRoutes } from './routes/meta.js';
import { AppError } from './errors.js';
import { PortalClient } from './portal/client.js';
import { PortalApi } from './portal/api.js';
import { DatasetService } from './store/dataset.js';

/**
 * Build Fastify application with dependency injection.
 *
 * @param {Object} [deps]
 * @param {import('./config.js').AppConfig} [deps.config]
 * @param {import('./portal/client.js').PortalClient} [deps.portalClient]
 * @param {import('./portal/api.js').PortalApi} [deps.portalApi]
 * @param {import('./store/dataset.js').DatasetService} [deps.datasetService]
 * @param {boolean} [deps.disableLogger=false]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(deps = {}) {
  const config = {
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'info',
    portalTzOffset: '+05:30',
    portalBaseUrl: 'https://urja-ops.flockenergy.tech',
    ...deps.config,
  };

  const portalClient =
    deps.portalClient ||
    new PortalClient({
      baseUrl: config.portalBaseUrl,
      email: config.portalEmail,
      password: config.portalPassword,
      timeoutMs: config.portalTimeoutMs,
      maxConcurrency: config.portalMaxConcurrency,
    });

  const portalApi = deps.portalApi || new PortalApi(portalClient);

  const datasetService =
    deps.datasetService ||
    new DatasetService({
      api: portalApi,
      datasetTtlMs: config.datasetTtlMs,
      readingsTtlMs: config.readingsTtlMs,
      staleIfErrorMs: config.staleIfErrorMs,
    });

  const app = Fastify({
    ajv: {
      customOptions: {
        keywords: ['example'],
      },
    },
    logger: deps.disableLogger
      ? false
      : {
          level: config.logLevel || 'info',
          redact: ['req.headers.cookie', '*.signingSecret', '*.password', 'password'],
        },
  });

  // Register all shared JSON schemas
  for (const schema of allSchemas) {
    app.addSchema(schema);
  }

  // Register Swagger (OpenAPI 3.1)
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Urja Meter Ops API',
        description:
          'A clean, resilient REST API service providing programmatic access to smart meters, network hierarchy, and consumption readings from the Urja Meter Ops legacy portal.',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://${config.host || '127.0.0.1'}:${config.port || 3000}`,
          description: 'Local API server',
        },
      ],
      tags: [
        { name: 'Meters', description: 'Smart meter inventory, attributes, and geospatial search' },
        { name: 'Readings', description: 'Interval energy consumption and voltage statistics' },
        { name: 'Transformers', description: 'Distribution transformers and network mapping' },
        { name: 'Hierarchy', description: 'Electrical distribution network hierarchy' },
        { name: 'System', description: 'Health check, operational stats, and data quality diagnostics' },
      ],
    },
    refResolver: {
      buildLocalReference(json, baseUri, fragment, i) {
        return json.$id || `def-${i}`;
      },
    },
  });

  // Register Scalar interactive documentation at /docs
  await app.register(fastifyScalar, {
    routePrefix: '/docs',
    configuration: {
      title: 'Urja Meter Ops API Reference',
    },
  });

  // Serve raw OpenAPI JSON
  app.get('/openapi.json', { schema: { hide: true } }, async () => {
    return app.swagger();
  });

  // Custom unified error handler
  app.setErrorHandler((error, request, reply) => {
    // 1. Domain/Application Errors
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
        },
      });
      return;
    }

    // 2. Fastify Schema Validation Errors
    if (error.validation) {
      reply.status(400).send({
        error: {
          code: 'invalid_request',
          message: error.message,
          details: error.validation,
        },
      });
      return;
    }

    // 3. Fallback generic internal error
    const statusCode = error.statusCode || 500;
    request.log.error(error);
    reply.status(statusCode).send({
      error: {
        code: statusCode === 404 ? 'not_found' : 'internal_error',
        message: error.message || 'An unexpected error occurred',
      },
    });
  });

  // Register static file serving for web client (Phase 8)
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  // Register all routes
  const routeOptions = { datasetService, portalApi, portalClient, config };
  await app.register(metersRoutes, routeOptions);
  await app.register(consumptionRoutes, routeOptions);
  await app.register(transformersRoutes, routeOptions);
  await app.register(hierarchyRoutes, routeOptions);
  await app.register(metaRoutes, routeOptions);

  return app;
}
