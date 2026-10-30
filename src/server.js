import { getConfig } from './config.js';
import { buildApp } from './app.js';
import { DatasetService } from './store/dataset.js';
import { PortalClient } from './portal/client.js';
import { PortalApi } from './portal/api.js';

async function start() {
  const config = getConfig();

  const portalClient = new PortalClient({
    baseUrl: config.portalBaseUrl,
    email: config.portalEmail,
    password: config.portalPassword,
    timeoutMs: config.portalTimeoutMs,
    maxConcurrency: config.portalMaxConcurrency,
  });

  const portalApi = new PortalApi(portalClient);

  const datasetService = new DatasetService({
    api: portalApi,
    datasetTtlMs: config.datasetTtlMs,
    readingsTtlMs: config.readingsTtlMs,
    staleIfErrorMs: config.staleIfErrorMs,
  });

  const app = await buildApp({
    config,
    portalClient,
    portalApi,
    datasetService,
  });

  // Non-blocking warm up of dataset so server starts immediately
  datasetService.warm().catch((err) => {
    app.log.warn({ err: err.message }, 'Initial background dataset warming failed; will retry on demand');
  });

  // Graceful shutdown
  const closeSignals = ['SIGINT', 'SIGTERM'];
  for (const sig of closeSignals) {
    process.on(sig, async () => {
      app.log.info({ signal: sig }, 'Received termination signal, shutting down gracefully...');
      try {
        await app.close();
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'Error during graceful shutdown');
        process.exit(1);
      }
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      `Urja Meter Ops API running at http://${config.host}:${config.port} (Interactive docs: http://${config.host}:${config.port}/docs)`
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
