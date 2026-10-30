import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signExport } from '../src/portal/signing.js';

describe('portal signing', () => {
  it('correctly constructs message and computes HMAC-SHA256 hex', () => {
    const secret = '12345678901234567890123456789012';
    const timestamp = 1700000000;
    const method = 'GET';
    const path = '/portal/export';
    const query = 'page=1';

    // Independent message construction
    const message = `GET\n/portal/export\npage=1\n1700000000`;
    const expectedHex = createHmac('sha256', secret).update(message).digest('hex');

    const result = signExport({ secret, method, path, query, timestamp });

    assert.equal(result.timestamp, '1700000000');
    assert.equal(result.signature, expectedHex);
    assert.deepEqual(result.headers, {
      'x-timestamp': '1700000000',
      'x-signature': expectedHex,
    });
  });

  it('handles query with leading question mark', () => {
    const secret = 'test-secret';
    const res1 = signExport({ secret, query: 'page=1', timestamp: 12345 });
    const res2 = signExport({ secret, query: '?page=1', timestamp: 12345 });
    assert.equal(res1.signature, res2.signature);
  });

  it('throws when secret is missing', () => {
    assert.throws(() => signExport({ secret: '', timestamp: 12345 }), /Signing secret is required/);
  });
});
