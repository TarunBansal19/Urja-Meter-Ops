import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/index.js';

test('api/index.js serverless handler', async (t) => {
  const server = http.createServer(async (req, res) => {
    await handler(req, res);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  await t.test('handles /health successfully', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  await t.test('serves static UI on /', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
});
