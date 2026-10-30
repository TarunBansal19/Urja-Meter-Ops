import http from 'node:http';
import { createHmac } from 'node:crypto';

/**
 * Creates a mock Urja Meter Ops portal server for testing.
 */
export function createFakePortal(options = {}) {
  const state = {
    signingSecret: options.signingSecret || 'fake-secret-32-chars-long12345',
    sessionToken: options.sessionToken || 'test-session%2Ftoken-abc-123',
    sessionExpired: false,
    loginFailuresRemaining: 0,
    serverErrorsRemaining: 0,
    serverErrorCode: 503,
    requestDelayMs: 0,
    unauthorizedStatusCode: options.unauthorizedStatusCode || 200,
    requests: [],
    exportData: options.exportData || [
      {
        meterId: 'J100000',
        serialNo: 'SE33962',
        make: 'HPL',
        phaseType: 'single',
        installStatus: 'Installed',
        installType: 'Whole Current',
        build: 'legacy',
        dtCode: 'DT-001',
        hierarchy: {
          zone: { name: 'Jaipur Zone 1', code: 'Z-01' },
          circle: { name: 'Circle 1', code: 'C-01' },
          division: { name: 'Division 1', code: 'D-01' },
          subdivision: { name: 'Subdivision 1', code: 'SD-01' },
          substation: { name: 'Substation 1', code: 'SS-01' },
          feeder: { name: 'Feeder 1', code: 'F-001' },
          dt: { name: 'Malviya Nagar DT 1', code: 'DT-001' },
        },
        geo: { lat: 26.938961, lng: 75.830956 },
      },
      {
        meterId: 'J100001',
        serialNo: 'SE33963',
        make: 'L&T',
        phaseType: 'three',
        installStatus: 'Faulty',
        installType: 'CT Operated',
        build: 'v2',
        dtCode: 'DT-001',
        hierarchy: {
          zone: { name: 'Jaipur Zone 1', code: 'Z-01' },
          circle: { name: 'Circle 1', code: 'C-01' },
          division: { name: 'Division 1', code: 'D-01' },
          subdivision: { name: 'Subdivision 1', code: 'SD-01' },
          substation: { name: 'Substation 1', code: 'SS-01' },
          feeder: { name: 'Feeder 1', code: 'F-001' },
          dt: { name: 'Malviya Nagar DT 1', code: 'DT-001' },
        },
        geo: { lat: 26.939, lng: 75.831 },
      },
    ],
    dtsData: options.dtsData || [
      { code: 'DT-001', name: 'Malviya Nagar DT 1', feederCode: 'F-001', capacityKva: 100 },
    ],
    energyData: options.energyData || [
      { timestamp: '30/06/2026 23:00', kwh: '100.5', kvah: '110.2', voltR: '235.4' },
      { timestamp: '30/06/2026 23:30', kwh: '101.0', kvah: '110.8', voltR: '236.1' },
    ],
    ...options,
  };

  const server = http.createServer(async (req, res) => {
    // Read request body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyStr = Buffer.concat(chunks).toString('utf8');

    state.requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: bodyStr,
    });

    if (state.requestDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.requestDelayMs));
    }

    if (state.serverErrorsRemaining > 0) {
      state.serverErrorsRemaining--;
      res.writeHead(state.serverErrorCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', message: 'Temporary upstream failure' }));
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Login endpoint
    if (req.method === 'POST' && pathname === '/login') {
      if (state.loginFailuresRemaining > 0) {
        state.loginFailuresRemaining--;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'failure', message: 'Invalid credentials' }));
        return;
      }

      const params = new URLSearchParams(bodyStr);
      const email = params.get('email');
      const password = params.get('password');

      if (!email || !password || password === 'wrong-password') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'failure', message: 'Invalid credentials' }));
        return;
      }

      state.sessionExpired = false;
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `__Secure-better-auth.session_token=${state.sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      });
      res.end(JSON.stringify({ type: 'redirect', status: 303, location: '/meters' }));
      return;
    }

    // Auth check for /portal/* endpoints
    if (pathname.startsWith('/portal/')) {
      const cookieHeader = req.headers.cookie || '';
      const hasValidCookie =
        cookieHeader.includes(`__Secure-better-auth.session_token=${state.sessionToken}`) &&
        !state.sessionExpired;

      if (!hasValidCookie) {
        res.writeHead(state.unauthorizedStatusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized', message: 'A valid session is required.' }));
        return;
      }
    }

    // Portal Keys
    if (req.method === 'GET' && pathname === '/portal/keys') {
      res.writeHead(200, {
        'content-type': 'application/json',
        date: new Date().toUTCString(),
      });
      res.end(JSON.stringify({ data: { signingSecret: state.signingSecret } }));
      return;
    }

    // Portal Export
    if (req.method === 'GET' && pathname === '/portal/export') {
      const tsHeader = req.headers['x-timestamp'];
      const sigHeader = req.headers['x-signature'];

      const queryWithoutQuestion = parsedUrl.search ? parsedUrl.search.slice(1) : 'page=1';
      const expectedMessage = `GET\n/portal/export\n${queryWithoutQuestion}\n${tsHeader}`;
      const expectedSig = createHmac('sha256', state.signingSecret)
        .update(expectedMessage)
        .digest('hex');

      if (!tsHeader || !sigHeader || sigHeader.toLowerCase() !== expectedSig.toLowerCase()) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_signature', message: 'Export signature verification failed' }));
        return;
      }

      const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
      if (options.multipageExport) {
        // e.g. 2 pages
        const pageSize = 1;
        const total = state.exportData.length;
        const startIndex = (page - 1) * pageSize;
        const pagedMeters = state.exportData.slice(startIndex, startIndex + pageSize);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: pagedMeters, total, page, pageSize }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: state.exportData, total: state.exportData.length }));
      return;
    }

    // Portal DTs
    if (req.method === 'GET' && pathname === '/portal/dts') {
      const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
      const pageSize = 20;
      const total = state.dtsData.length;
      const startIndex = (page - 1) * pageSize;
      const pagedDts = state.dtsData.slice(startIndex, startIndex + pageSize);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: pagedDts, total, page, pageSize }));
      return;
    }

    // Portal search
    if (req.method === 'GET' && pathname === '/portal/meters/search') {
      const q = (parsedUrl.searchParams.get('q') || '').toLowerCase();
      const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
      const filtered = state.exportData.filter(
        (m) =>
          (m.meterId && m.meterId.toLowerCase().includes(q)) ||
          (m.serialNo && m.serialNo.toLowerCase().includes(q))
      );
      const pageSize = 20;
      const startIndex = (page - 1) * pageSize;
      const paged = filtered.slice(startIndex, startIndex + pageSize);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: paged, total: filtered.length, page, pageSize }));
      return;
    }

    // Portal geo: /portal/meters/:id/geo
    const geoMatch = pathname.match(/^\/portal\/meters\/([^/]+)\/geo$/);
    if (req.method === 'GET' && geoMatch) {
      const meterId = geoMatch[1];
      const meter = state.exportData.find((m) => m.meterId === meterId);
      if (!meter) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', message: 'Meter not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            latitude: String(meter.geo?.lat ?? '26.9389'),
            longitude: String(meter.geo?.lng ?? '75.8309'),
          },
        })
      );
      return;
    }

    // Portal energy: /portal/meters/:id/energy
    const energyMatch = pathname.match(/^\/portal\/meters\/([^/]+)\/energy$/);
    if (req.method === 'GET' && energyMatch) {
      const meterId = energyMatch[1];
      const meter = state.exportData.find((m) => m.meterId === meterId);
      if (!meter) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found', message: 'Meter not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: state.energyData }));
      return;
    }

    // Fallback 404
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', message: 'Endpoint not found' }));
  });

  return {
    server,
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      return `http://127.0.0.1:${addr.port}`;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
