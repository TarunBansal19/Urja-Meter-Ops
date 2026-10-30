import {
  PortalAuthError,
  PortalUnavailableError,
  PortalTimeoutError,
  PortalProtocolError,
} from '../errors.js';

class Semaphore {
  constructor(max = 4) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.current++;
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }
}

export class PortalClient {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl Base URL (e.g. 'https://urja-ops.flockenergy.tech')
   * @param {string} options.email
   * @param {string} options.password
   * @param {number} [options.timeoutMs=15000]
   * @param {number} [options.maxConcurrency=4]
   */
  constructor({ baseUrl = 'https://urja-ops.flockenergy.tech', email = '', password = '', timeoutMs = 15000, maxConcurrency = 4 } = {}) {
    this.baseUrl = (baseUrl || 'https://urja-ops.flockenergy.tech').replace(/\/+$/, '');
    this.email = email;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.semaphore = new Semaphore(maxConcurrency);

    /** @type {Map<string, string>} */
    this.cookies = new Map();
    this.loginPromise = null;
    this.onReloginCallbacks = new Set();
  }

  /**
   * Register a callback to run whenever relogin occurs (e.g. invalidating cached signing secret).
   * @param {Function} cb
   */
  onRelogin(cb) {
    this.onReloginCallbacks.add(cb);
  }

  /**
   * Parse Set-Cookie header(s) and store in the cookie jar.
   * Keeps raw encoded value as sent by the server.
   * @param {Response} response
   */
  #saveCookies(response) {
    let setCookieHeaders = [];
    if (typeof response.headers.getSetCookie === 'function') {
      setCookieHeaders = response.headers.getSetCookie();
    } else {
      const raw = response.headers.get('set-cookie');
      if (raw) setCookieHeaders = [raw];
    }

    for (const cookieStr of setCookieHeaders) {
      if (!cookieStr) continue;
      // Take the name=value part before the first ';'
      const firstPart = cookieStr.split(';')[0].trim();
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        const name = firstPart.slice(0, eqIdx).trim();
        const value = firstPart.slice(eqIdx + 1).trim();
        this.cookies.set(name, value);
      }
    }
  }

  /**
   * Build the Cookie header value from the cookie jar.
   * @returns {string}
   */
  #getCookieHeader() {
    const parts = [];
    for (const [name, value] of this.cookies.entries()) {
      parts.push(`${name}=${value}`);
    }
    return parts.join('; ');
  }

  /**
   * Log in to the portal and store the session cookie.
   * Single-flight: concurrent callers share the same login promise.
   * @returns {Promise<void>}
   */
  async login(retryCount = 0, maxRetries = 2) {
    if (this.loginPromise && retryCount === 0) {
      return this.loginPromise;
    }

    const doLogin = async () => {
      const url = `${this.baseUrl}/login`;
      const body = new URLSearchParams({
        email: this.email,
        password: this.password,
      }).toString();

      let origin = this.baseUrl;
      try {
        origin = new URL(this.baseUrl).origin;
      } catch {
        // ignore
      }

      const headers = {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'x-sveltekit-action': 'true',
        origin,
      };

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (err.name === 'TimeoutError' || err.code === 23) {
          if (retryCount < maxRetries) {
            await this.#backoff(retryCount);
            return this.login(retryCount + 1, maxRetries);
          }
          throw new PortalTimeoutError(`Login request timed out after ${this.timeoutMs}ms`);
        }

        if (retryCount < maxRetries) {
          await this.#backoff(retryCount);
          return this.login(retryCount + 1, maxRetries);
        }
        throw new PortalUnavailableError(`Network failure during login: ${err.message}`);
      }

      this.#saveCookies(res);

      // Check for transient 5xx or 429 on login
      if ((res.status >= 500 || res.status === 429) && retryCount < maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after');
        await this.#backoff(retryCount, retryAfterHeader);
        return this.login(retryCount + 1, maxRetries);
      }

      let data;
      try {
        data = await res.json();
      } catch (err) {
        throw new PortalProtocolError('Login response is not valid JSON', {
          statusCode: res.status,
          cause: err.message,
        });
      }

      // Per protocol spec: success is HTTP 200 with JSON type === "redirect"
      if (data?.type !== 'redirect') {
        throw new PortalAuthError('Portal login rejected credentials', {
          responseType: data?.type,
          responseMessage: data?.message,
        });
      }

      const hasSession = Array.from(this.cookies.keys()).some((k) =>
        k.includes('session')
      );

      if (!hasSession) {
        throw new PortalAuthError('Login succeeded but no session cookie received');
      }

      // Notify listeners that relogin occurred
      for (const cb of this.onReloginCallbacks) {
        try {
          cb();
        } catch {
          // ignore
        }
      }
    };

    if (retryCount > 0) {
      return doLogin();
    }

    this.loginPromise = (async () => {
      try {
        await doLogin();
      } finally {
        this.loginPromise = null;
      }
    })();

    return this.loginPromise;
  }

  /**
   * Ensure a session cookie is present, logging in if needed.
   */
  async ensureSession() {
    const hasSession = Array.from(this.cookies.keys()).some((k) =>
      k.includes('session')
    );
    if (!hasSession) {
      await this.login();
    }
  }

  /**
   * Execute an idempotent GET request with:
   * - Concurrency cap
   * - Retries with exponential backoff on 5xx / 429 / network errors
   * - Relogin once on 401 / unauthorized
   *
   * @param {string} path
   * @param {Object} [options]
   * @param {Record<string, any>|URLSearchParams} [options.query]
   * @param {Record<string, string>} [options.headers]
   * @param {boolean} [options.reloginOnUnauthorized=true]
   * @param {number} [options.retryCount=0]
   * @returns {Promise<{ data: any, response: Response }>}
   */
  async getJson(path, options = {}) {
    const {
      query,
      headers: customHeaders = {},
      reloginOnUnauthorized = true,
      retryCount = 0,
      maxRetries = 2,
    } = options;

    await this.semaphore.acquire();
    try {
      await this.ensureSession();

      let queryString = '';
      if (query) {
        if (query instanceof URLSearchParams) {
          queryString = query.toString();
        } else {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null) {
              sp.append(k, String(v));
            }
          }
          queryString = sp.toString();
        }
      }

      const fullUrl = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ''}`;

      const reqHeaders = {
        accept: 'application/json',
        ...customHeaders,
      };

      const cookieHeader = this.#getCookieHeader();
      if (cookieHeader) {
        reqHeaders['cookie'] = cookieHeader;
      }

      let res;
      try {
        res = await fetch(fullUrl, {
          method: 'GET',
          headers: reqHeaders,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (err.name === 'TimeoutError' || err.code === 23) {
          if (retryCount < maxRetries) {
            await this.#backoff(retryCount);
            return this.getJson(path, { ...options, retryCount: retryCount + 1 });
          }
          throw new PortalTimeoutError(`Request to ${path} timed out after ${this.timeoutMs}ms`);
        }

        // Network error retry
        if (retryCount < maxRetries) {
          await this.#backoff(retryCount);
          return this.getJson(path, { ...options, retryCount: retryCount + 1 });
        }
        throw new PortalUnavailableError(`Network failure requesting ${path}: ${err.message}`);
      }

      this.#saveCookies(res);

      // Check for transient 5xx or 429
      if ((res.status >= 500 || res.status === 429) && retryCount < maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after');
        await this.#backoff(retryCount, retryAfterHeader);
        return this.getJson(path, { ...options, retryCount: retryCount + 1 });
      }

      // Parse JSON defensively
      let jsonBody = null;
      const text = await res.text();
      if (text) {
        try {
          jsonBody = JSON.parse(text);
        } catch (err) {
          throw new PortalProtocolError(`Non-JSON response from ${path} (status ${res.status})`, {
            statusCode: res.status,
            bodyPreview: text.slice(0, 200),
          });
        }
      }

      // Check session expiry: error === "unauthorized" or status === 401
      const isUnauthorized =
        res.status === 401 ||
        jsonBody?.error === 'unauthorized';

      if (isUnauthorized && reloginOnUnauthorized) {
        // Relogin once and retry the request exactly once
        await this.login();
        return this.getJson(path, {
          ...options,
          reloginOnUnauthorized: false,
          retryCount: 0,
        });
      }

      return { data: jsonBody, response: res };
    } finally {
      this.semaphore.release();
    }
  }

  async #backoff(attempt, retryAfterHeader) {
    if (retryAfterHeader) {
      const parsedSeconds = parseInt(retryAfterHeader, 10);
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        await new Promise((r) => setTimeout(r, Math.min(parsedSeconds * 1000, 10000)));
        return;
      }
    }
    const baseDelay = 50 * Math.pow(2, attempt);
    const jitter = Math.random() * 20;
    await new Promise((r) => setTimeout(r, baseDelay + jitter));
  }
}
