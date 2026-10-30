import { createHmac } from 'node:crypto';

/**
 * Sign an export request for Urja Meter Ops portal.
 *
 * Specification:
 * timestamp = current Unix time, whole seconds, as string
 * message   = method + "\n" + path + "\n" + queryWithoutLeadingQuestionMark + "\n" + timestamp
 * signature = lowercase hex( HMAC-SHA256(key = secret, data = message) )
 *
 * @param {Object} params
 * @param {string} params.secret 32-character signing secret from /portal/keys
 * @param {string} [params.method='GET'] HTTP method (e.g. 'GET')
 * @param {string} [params.path='/portal/export'] Path without query (e.g. '/portal/export')
 * @param {string} [params.query='page=1'] Query string without '?'
 * @param {number|string} params.timestamp Unix timestamp in whole seconds
 * @returns {{ timestamp: string, signature: string, headers: { 'x-timestamp': string, 'x-signature': string } }}
 */
export function signExport({ secret, method = 'GET', path = '/portal/export', query = 'page=1', timestamp }) {
  if (!secret) {
    throw new Error('Signing secret is required');
  }

  const tsStr = String(timestamp);
  const cleanQuery = query.startsWith('?') ? query.slice(1) : query;
  const message = `${method.toUpperCase()}\n${path}\n${cleanQuery}\n${tsStr}`;

  const signature = createHmac('sha256', secret)
    .update(message, 'utf8')
    .digest('hex')
    .toLowerCase();

  return {
    timestamp: tsStr,
    signature,
    headers: {
      'x-timestamp': tsStr,
      'x-signature': signature,
    },
  };
}
