# Reflection — Urja Meter Ops API

**Author:** Tarun Bansal (`bansaltarun0819@gmail.com`)

---

## 1. What assumptions did you make?

I made five core assumptions during the design and implementation of this service:

1. **Timezone:** Timestamps returned by `/portal/meters/{id}/energy` (e.g. `30/06/2026 23:30`) are day-first strings with zero timezone or UTC offset information. Given that this deployment manages electrical distribution assets in Jaipur, Rajasthan, I assumed Indian Standard Time (`Asia/Kolkata`, `UTC+05:30`). Because India does not observe Daylight Saving Time, this offset is constant year-round. I made this offset configurable via `PORTAL_TZ_OFFSET` so it can be adjusted if deployed in a different operating territory.
2. **Units of Measurement:** Upstream energy numbers carry no units or label headers. Based on standard Indian utility smart meter specifications (such as IS 16444), I assumed:
   - `kwh`: cumulative active energy register in kilowatt-hours (kWh)
   - `kvah`: cumulative apparent energy register in kilovolt-ampere-hours (kVAh)
   - `voltR`: R-phase RMS voltage in Volts (V)
   - `capacityKva`: transformer rating in kilovolt-amperes (kVA)
   I explicitly documented these assumptions in the OpenAPI schemas and API response metadata envelopes.
3. **Primary Ingestion Completeness:** The signed `/portal/export?page=1` endpoint returned all 403 meters (`total: 403`, `data.length: 403`). Rather than blindly assuming this was a complete dataset, I wrote an automated cross-check script (`scripts/verify-export.js`) that crawled all 21 paged search results and verified that every single meter and all 6 shared fields matched with 100% parity.
4. **Authoritative DT Allocation:** Meters `J100400`–`J100402` sit on `DT-007` despite sequential numeric patterns suggesting they belong on `DT-001`–`DT-003`. I treated the portal's `dtCode` as authoritative ground truth rather than attempting to deduce transformer allocations through meter ID arithmetic.
5. **Static Snapshot of Portal Data:** The meter reading records for all meters terminate on 30 June 2026 at 23:30, which indicates the portal dataset is a fixed historical snapshot. I therefore decided that an in-memory dataset cache with a 1-hour TTL and a 15-minute readings TTL was optimal, coupled with a manual `/admin/refresh` hook for operational control.

---

## 2. Which part was the most difficult, and how did you get unstuck?

The most difficult part was discovering and reverse-engineering the bulk export signature scheme.

When I first explored the portal as a logged-in user, the only visible meter interface was a paginated table displaying 20 meters per page. Scraping 21 pages plus 403 individual meter detail and geo endpoints would have required over 1,200 HTTP calls on boot, taking considerable time and hammering the legacy server.

I decided to inspect the compiled SvelteKit JavaScript chunks under `/_app/immutable/chunks/`. While searching for API path strings in the client bundles, I noticed references to `/portal/keys` and `/portal/export`. Deobfuscating the client-side code revealed an HMAC-SHA256 request authentication routine that required:
- A structured message: `GET\n/portal/export\npage=1\n<timestamp>`
- A 32-character signing key fetched from `GET /portal/keys`
- HTTP request headers: `x-timestamp` and `x-signature` (lowercase hex)

The second hurdle hit immediately: my initial signed requests failed with HTTP 401 signature verification errors. By inspecting the HTTP `Date` response header returned by `/portal/keys`, I realized my local workstation clock had a ~1.6-second drift relative to the portal's server clock. Once I implemented clock skew estimation (`serverTime - localTime`) in my signing utility, the export succeeded on the very first attempt, unlocking all 403 meters with full coordinates and hierarchy in a single 230 KB payload.

---

## 3. If you had another day, what would you improve?

With an additional day, I would prioritize three key improvements:

1. **Persistent Storage (SQLite / PostgreSQL):** Currently, the dataset is loaded and indexed in-memory using JavaScript Maps. While this is fast and has zero operational dependencies for a local evaluation, backing the store with an embedded SQLite database (`node:sqlite`) would eliminate cold-start latency and persist 30-minute interval readings across service restarts.
2. **Background Change Detection & Webhooks:** Instead of waiting for cache TTL expiry or manual `/admin/refresh` calls, I would implement a lightweight background worker that periodically polls `/portal/export`, computes a dataset diff, and emits webhook notifications or WebSocket events whenever meters, operational statuses, or DT connections change.
3. **Consumer Authentication & Token-Bucket Rate Limiting:** For production multi-tenancy, I would add Bearer token / API key authentication and token-bucket rate limiting on our public endpoints to prevent downstream consumers from overwhelming the service.
4. **Spatial Indexing for Scale:** While a linear Haversine scan takes < 1ms for 403 meters, scaling to 100,000+ meters would require an R-tree or spatial grid index (such as PostGIS or SQLite R*Tree) for sub-millisecond proximity queries.

---

## 4. What mistake did you make while solving this (there's always one)?

Early in the implementation, when modeling the electrical hierarchy, I assumed each entity code was globally unique across the utility network—for example, that feeder code `F-001` or division code `D-01` uniquely identified a single feeder or division.

I wrote an initial tree-building prototype that keyed nodes simply by their level and code. When I inspected the generated tree, only 14 feeders appeared instead of the expected 25+, and meters connected to different substations were getting merged under the same feeder node.

Looking closely at the export data, I discovered that the utility reuses feeder codes like `F-001` under different substations (`SS-01` and `SS-02`), and division `D-01` appears under multiple circles. The fix was to redefine node identity as the full path of codes from the zone down (`Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001`). That resolved the tree collision completely, producing the exact 40 distinct full paths matching the 40 distribution transformers.

---

## 5. If you were reviewing your own submission, what would you criticise?

If I were reviewing this submission as a peer, I would raise three constructive criticisms:

1. **In-Memory Storage Does Not Scale to Millions:** In-memory Maps and linear filtering work well for 403 meters (< 1ms query time, < 5 MB heap), but if the utility grew to 1,000,000 meters, this approach would consume excessive RAM and linear scans for geospatial `near` searches would degrade. A persistent database with spatial indexes would be necessary at enterprise utility scale.
2. **The Fake Portal Encodes My Own Understanding:** While my test suite contains 59 automated tests covering auth expiry, 5xx retries, timeouts, and multi-page export termination, the fake portal mock server encodes my mental model of how the portal behaves. If the legacy portal introduces unexpected edge cases in production, unit tests against the mock would still pass. That is why I built `scripts/smoke.js` and `scripts/verify-export.js` to validate directly against the live portal, but a continuous contract testing job against staging would be needed in production.
3. **Unauthenticated API Surface:** To keep the assignment easy and frictionless to evaluate locally, I intentionally left the API unauthenticated (binding to `127.0.0.1` by default). In any deployment accessible over a network, an authentication middleware (JWT / API tokens) must be enforced.
