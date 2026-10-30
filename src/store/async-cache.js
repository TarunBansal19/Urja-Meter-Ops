/**
 * AsyncCache with:
 * - Time-To-Live (TTL)
 * - Stale-if-error fallback
 * - Single-flight loader concurrency coalescing
 * - Injectable clock (for testing)
 * - Optional LRU eviction bound
 */
export class AsyncCache {
  /**
   * @param {Object} options
   * @param {number} options.ttlMs Time in ms after which an entry is considered expired
   * @param {number} [options.staleIfErrorMs=86400000] Maximum age to serve stale data on refresh error
   * @param {() => number} [options.clock=Date.now] Injectable clock function
   * @param {number} [options.maxEntries=1000] Maximum entries before evicting oldest
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 3600000;
    this.staleIfErrorMs = options.staleIfErrorMs ?? 86400000;
    this.clock = options.clock || (() => Date.now());
    this.maxEntries = options.maxEntries ?? 1000;

    /** @type {Map<string, { value: any, fetchedAt: number }>} */
    this.store = new Map();

    /** @type {Map<string, Promise<{ value: any, fetchedAt: number, stale: boolean }>>} */
    this.inflight = new Map();
  }

  /**
   * Invalidate a single key or all keys if key is omitted.
   * @param {string} [key]
   */
  invalidate(key) {
    if (key !== undefined) {
      this.store.delete(key);
      this.inflight.delete(key);
    } else {
      this.store.clear();
      this.inflight.clear();
    }
  }

  /**
   * Check if a key is currently cached (even if stale).
   * @param {string} key
   */
  has(key) {
    return this.store.has(key);
  }

  /**
   * Get cached entry or invoke loader to populate/refresh.
   *
   * @param {string} key
   * @param {() => Promise<any>} loader
   * @returns {Promise<{ value: any, fetchedAt: number, stale: boolean, ageMs: number }>}
   */
  async get(key, loader) {
    const now = this.clock();
    const existing = this.store.get(key);

    // If exists and fresh, return immediately
    if (existing) {
      const ageMs = now - existing.fetchedAt;
      if (ageMs < this.ttlMs) {
        return {
          value: existing.value,
          fetchedAt: existing.fetchedAt,
          stale: false,
          ageMs,
        };
      }
    }

    // Refresh needed (either missing or expired)
    // Single-flight: coalesce concurrent calls for the same key
    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const loadPromise = (async () => {
      try {
        const newValue = await loader();
        const fetchedAt = this.clock();
        const entry = { value: newValue, fetchedAt };

        // Manage LRU size bound
        if (this.store.size >= this.maxEntries && !this.store.has(key)) {
          const firstKey = this.store.keys().next().value;
          if (firstKey !== undefined) this.store.delete(firstKey);
        }

        this.store.set(key, entry);
        return {
          value: entry.value,
          fetchedAt: entry.fetchedAt,
          stale: false,
          ageMs: 0,
        };
      } catch (err) {
        // If loader failed and we have a stale entry within staleIfErrorMs, serve stale
        if (existing) {
          const ageMs = now - existing.fetchedAt;
          if (ageMs <= this.staleIfErrorMs) {
            return {
              value: existing.value,
              fetchedAt: existing.fetchedAt,
              stale: true,
              ageMs,
            };
          }
        }
        // No existing entry or stale window exceeded -> rethrow
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, loadPromise);
    return loadPromise;
  }
}
