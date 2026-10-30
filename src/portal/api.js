import { signExport } from './signing.js';
import {
  NotFoundError,
  PortalProtocolError,
  PortalUnavailableError,
} from '../errors.js';

export class PortalApi {
  /**
   * @param {import('./client.js').PortalClient} client
   */
  constructor(client) {
    this.client = client;
    this.cachedSecretInfo = null;

    // Invalidate cached secret when client relogins
    this.client.onRelogin(() => {
      this.cachedSecretInfo = null;
    });
  }

  /**
   * Fetch signing secret and compute clock skew from the Date header.
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<{ secret: string, skewMs: number }>}
   */
  async getSigningSecret(forceRefresh = false) {
    if (this.cachedSecretInfo && !forceRefresh) {
      return this.cachedSecretInfo;
    }

    const { data, response } = await this.client.getJson('/portal/keys');
    const secret = data?.data?.signingSecret;

    if (!secret || typeof secret !== 'string') {
      throw new PortalProtocolError('Failed to obtain signing secret from /portal/keys', { data });
    }

    let skewMs = 0;
    const dateHeader = response.headers.get('date');
    if (dateHeader) {
      const serverTime = Date.parse(dateHeader);
      if (!Number.isNaN(serverTime)) {
        skewMs = serverTime - Date.now();
      }
    }

    this.cachedSecretInfo = { secret, skewMs };
    return this.cachedSecretInfo;
  }

  /**
   * Fetch all meters from the bulk export endpoint (/portal/export).
   * Paginates defensively if data.length < total.
   * @returns {Promise<any[]>} Array of raw export meter objects
   */
  async fetchExport() {
    let secretInfo = await this.getSigningSecret();

    const fetchPage = async (page, isRetry = false) => {
      const nowWithSkew = Date.now() + secretInfo.skewMs;
      const timestamp = Math.floor(nowWithSkew / 1000);
      const query = `page=${page}`;
      const { headers } = signExport({
        secret: secretInfo.secret,
        method: 'GET',
        path: '/portal/export',
        query,
        timestamp,
      });

      const { data, response } = await this.client.getJson('/portal/export', {
        query: { page },
        headers,
      });

      // If export returns 401/403 with invalid signature (and not unauthorized session), refresh secret once
      if (
        (response.status === 401 || response.status === 403) &&
        data?.error !== 'unauthorized'
      ) {
        if (!isRetry) {
          secretInfo = await this.getSigningSecret(true);
          return fetchPage(page, true);
        }
        throw new PortalUnavailableError(
          `Export signature rejected by portal: ${data?.message || response.statusText}`
        );
      }

      if (!data || !Array.isArray(data.data)) {
        throw new PortalProtocolError('Malformed export response: expected data array', { data });
      }

      return data;
    };

    const firstPage = await fetchPage(1);
    const metersById = new Map();

    for (const meter of firstPage.data) {
      if (meter && meter.meterId) {
        metersById.set(meter.meterId, meter);
      }
    }

    const total = typeof firstPage.total === 'number' ? firstPage.total : metersById.size;
    let currentPage = 1;
    const maxPages = 50;

    // If page 1 did not return all meters, loop defensively
    while (metersById.size < total && currentPage < maxPages) {
      currentPage++;
      const pageResult = await fetchPage(currentPage);
      const rows = pageResult.data || [];
      if (rows.length === 0) break;

      let addedAny = false;
      for (const m of rows) {
        if (m && m.meterId && !metersById.has(m.meterId)) {
          metersById.set(m.meterId, m);
          addedAny = true;
        }
      }

      if (!addedAny) {
        // Nothing new returned, avoid infinite loop
        break;
      }
    }

    return Array.from(metersById.values());
  }

  /**
   * Fetch all distribution transformers from /portal/dts (paged).
   * @returns {Promise<any[]>}
   */
  async fetchDts() {
    const allDts = [];
    const seenCodes = new Set();
    let page = 1;
    const maxPages = 50;

    while (page <= maxPages) {
      const { data } = await this.client.getJson('/portal/dts', { query: { page } });
      const items = data?.data;

      if (!Array.isArray(items) || items.length === 0) {
        break;
      }

      let addedNew = false;
      for (const item of items) {
        if (item && item.code && !seenCodes.has(item.code)) {
          seenCodes.add(item.code);
          allDts.push(item);
          addedNew = true;
        }
      }

      if (!addedNew) {
        break;
      }

      const total = data.total;
      const pageSize = data.pageSize || 20;
      if (typeof total === 'number' && page * pageSize >= total) {
        break;
      }

      page++;
    }

    return allDts;
  }

  /**
   * Fetch recent energy readings for a meter.
   * @param {string} meterId
   * @returns {Promise<any[]>}
   */
  async fetchEnergy(meterId) {
    if (!meterId) {
      throw new NotFoundError('Meter ID is required');
    }

    const encoded = encodeURIComponent(meterId);
    const { data, response } = await this.client.getJson(`/portal/meters/${encoded}/energy`);

    if (response.status === 404 || data?.error === 'not_found') {
      throw new NotFoundError(`Meter ${meterId} not found in portal`, { meterId });
    }

    if (!data || !Array.isArray(data.data)) {
      throw new PortalProtocolError(`Invalid energy response for meter ${meterId}`, { data });
    }

    return data.data;
  }

  /**
   * Fetch meter coordinates from /portal/meters/{id}/geo.
   * @param {string} meterId
   * @returns {Promise<{ latitude: string, longitude: string }>}
   */
  async fetchGeo(meterId) {
    if (!meterId) {
      throw new NotFoundError('Meter ID is required');
    }

    const encoded = encodeURIComponent(meterId);
    const { data, response } = await this.client.getJson(`/portal/meters/${encoded}/geo`);

    if (response.status === 404 || data?.error === 'not_found') {
      throw new NotFoundError(`Meter ${meterId} not found in portal`, { meterId });
    }

    if (!data?.data?.latitude || !data?.data?.longitude) {
      throw new PortalProtocolError(`Invalid geo response for meter ${meterId}`, { data });
    }

    return data.data;
  }

  /**
   * Query meter search page (used for cross-check/verification scripts).
   * @param {string} q
   * @param {number} [page=1]
   */
  async fetchSearchPage(q = '', page = 1) {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    query.set('page', String(page));

    const { data } = await this.client.getJson('/portal/meters/search', { query });
    return data;
  }
}
