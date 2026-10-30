import { buildApp } from '../src/app.js';
import { getConfig } from '../src/config.js';

let appInstance = null;

async function getApp() {
  if (!appInstance) {
    // In serverless environments, allow booting even if env vars are pending
    const config = getConfig({}, false);
    appInstance = await buildApp({
      config,
      disableLogger: process.env.NODE_ENV === 'production',
    });
    await appInstance.ready();
  }
  return appInstance;
}

/**
 * Vercel Serverless Function entry point.
 */
export default async function handler(req, res) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (err) {
    console.error('Serverless Handler Error:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'internal_server_error',
          message: err.message || 'Serverless execution failed',
        },
      })
    );
  }
}
