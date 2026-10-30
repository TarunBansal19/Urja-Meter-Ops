# Urja Meter Ops API

A resilient, high-performance REST API service providing programmatic access to smart meters, network hierarchy, and 30-minute interval readings from the legacy Urja Meter Ops portal (`https://urja-ops.flockenergy.tech`).

---

## 1. What this is

This service bridges the gap between field operations and programmatic consumers (data analytics, operations automation, and monitoring tools). Instead of scraping fragile HTML pages or firing over 1,200 granular requests across paged tables, this service discovers and leverages the legacy portal's HMAC-SHA256 bulk export facility. It normalizes messy data, infers missing hierarchy tiers, calculates interval energy consumption, provides geospatial proximity search, and caches responses with a resilient **stale-if-error** policy.

### Architecture

```mermaid
flowchart LR
    Consumer["API Consumers / Web UI"] -->|HTTP REST| Fastify["Fastify 5 API Server"]
    Fastify -->|Input Validation & Schemas| Routes["Route Layer (/meters, /hierarchy, etc.)"]
    Routes -->|Query / Slices| Store["In-Memory Dataset & Readings Cache"]
    Store -->|Cache Miss / TTL Expiry| Domain["Domain Cleaning & Tree Imputation"]
    Domain -->|Bulk Export & DT Fetch| PortalApi["Portal API Client"]
    PortalApi -->|HMAC-SHA256 Signing + Skew Correction| Signing["HMAC Signer"]
    PortalApi -->|Session Jar + Concurrency Cap (4)| PortalClient["Portal HTTP Client"]
    PortalClient -->|HTTPS + Auto-Relogin| LegacyPortal["Legacy Urja Ops Portal"]
```

---

## 2. Quick start

### Prerequisites
- Node.js >= 20.12 (developed and tested on Node 22 / 24)
- npm >= 10

### Setup & Launch
```bash
# 1. Clone repository and install dependencies
npm install

# 2. Configure environment credentials
cp .env.example .env
# Edit .env and supply PORTAL_EMAIL and PORTAL_PASSWORD (from assignment credentials)

# 3. Run the automated test suite (58 tests, runs completely offline)
npm test

# 4. Run the live verification smoke test (against urja-ops.flockenergy.tech)
npm run smoke

# 5. Start the API server
npm start
```
The service will start on `http://127.0.0.1:3000`. Interactive API documentation is available at [http://127.0.0.1:3000/docs](http://127.0.0.1:3000/docs).

---

## 3. Sample requests

### 1. List meters with filters (make, status, pagination)
```bash
curl "http://127.0.0.1:3000/meters?make=HPL,L%26T&installStatus=Faulty&pageSize=2"
```
```json
{
  "data": [
    {
      "meterId": "J100007",
      "serialNo": "SE33969",
      "make": "HPL",
      "phaseType": "single",
      "installStatus": "Faulty",
      "installType": "Whole Current",
      "build": "legacy",
      "dtCode": "DT-001",
      "location": { "latitude": 26.938961, "longitude": 75.830956 },
      "hierarchyNodeId": "Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001",
      "dataQuality": { "issues": [] }
    }
  ],
  "pagination": { "page": 1, "pageSize": 2, "total": 38, "totalPages": 19 },
  "meta": { "fetchedAt": "2026-10-30T04:30:00.000Z", "ageMs": 1240, "stale": false }
}
```

### 2. Get single meter details
```bash
curl "http://127.0.0.1:3000/meters/J100000"
```
```json
{
  "data": {
    "meterId": "J100000",
    "serialNo": "SE33962",
    "make": "HPL",
    "phaseType": "single",
    "installStatus": "Decommissioned",
    "installType": "Whole Current",
    "build": "legacy",
    "dtCode": "DT-001",
    "location": { "latitude": 26.938961, "longitude": 75.830956 },
    "hierarchy": {
      "zone": { "code": "Z-01", "name": "Jaipur Zone 1", "inferred": false },
      "circle": { "code": "C-01", "name": "Circle 1", "inferred": false },
      "division": { "code": "D-01", "name": "Division 1", "inferred": false },
      "subdivision": { "code": "SD-01", "name": "Subdivision 1", "inferred": false },
      "substation": { "code": "SS-01", "name": "Substation 1", "inferred": false },
      "feeder": { "code": "F-001", "name": "Feeder 1", "inferred": false },
      "dt": { "code": "DT-001", "name": "Malviya Nagar DT 1", "inferred": false }
    },
    "hierarchyNodeId": "Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001",
    "dataQuality": { "issues": [] }
  },
  "meta": { "fetchedAt": "2026-10-30T04:30:00.000Z", "stale": false }
}
```

### 3. Query 30-minute interval consumption with time filtering
```bash
curl "http://127.0.0.1:3000/meters/J100000/consumption?from=2026-06-30&to=2026-07-01"
```
```json
{
  "data": {
    "meterId": "J100000",
    "intervalMinutes": 30,
    "timezone": "+05:30",
    "readings": [
      {
        "timestamp": "2026-06-30T00:30:00+05:30",
        "kwh": 48560.10,
        "kvah": 52445.20,
        "voltageR": 224,
        "kwhDelta": 0.45,
        "kvahDelta": 0.50
      }
    ],
    "summary": {
      "kwhConsumed": 20.69,
      "kvahConsumed": 22.05,
      "voltageR": { "min": 218, "max": 235, "avg": 224.8 }
    }
  },
  "meta": {
    "availableFrom": "2026-06-23T23:30:00+05:30",
    "latestReadingAt": "2026-06-30T23:30:00+05:30",
    "rowCount": 47,
    "skippedRows": 0,
    "gaps": 0,
    "decreases": 0,
    "units": {
      "kwh": "cumulative kWh register (assumed)",
      "kwhDelta": "interval active consumption in kWh (assumed)",
      "voltageR": "volts RMS (assumed)"
    },
    "stale": false
  }
}
```

### 4. Geospatial proximity search ("near")
```bash
curl "http://127.0.0.1:3000/meters?near=26.9389,75.8309&radiusKm=2"
```

### 5. Network distribution tree (with depth truncation)
```bash
curl "http://127.0.0.1:3000/hierarchy?depth=2"
```

---

## 4. Where to find things

- [PROTOCOL.md](PROTOCOL.md) — Concise 2-page upstream protocol reference, quirks, and signing recipe.
- [openapi.json](openapi.json) — Full OpenAPI 3.1 specification committed to the repository.
- **Interactive Documentation** — Hosted live at `/docs` (via Scalar UI).
- [REFLECTION.md](REFLECTION.md) — Answers to the five retrospective questions from the brief.
- [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) — 1-page technical discussion guide and cheat-sheet.
- [docs/investigation-log.md](docs/investigation-log.md) — Full raw investigation notes from initial discovery.

---

## 5. Project structure

```
.
├── openapi.json             # Generated, committed OpenAPI 3.1 specification
├── PROTOCOL.md              # Reverse-engineered wire protocol reference
├── REFLECTION.md            # Retrospective answers (with human markers)
├── README.md                # Front door & service documentation
├── docs/
│   ├── investigation-log.md # Raw upstream investigation notes
│   └── WALKTHROUGH.md       # Technical discussion guide
├── src/
│   ├── server.js            # Entry point: loads config, starts server, handles shutdown
│   ├── app.js               # Fastify app builder with dependency injection
│   ├── config.js            # Environment parsing, defaults, and validation
│   ├── errors.js            # Unified domain and protocol error hierarchy
│   ├── portal/
│   │   ├── client.js        # PortalClient: cookie jar, auto-relogin, retries, concurrency cap
│   │   ├── signing.js       # Pure HMAC-SHA256 signature generator for /portal/export
│   │   └── api.js           # Upstream API calls: export, dts, energy, geo, search
│   ├── domain/
│   │   ├── meters.js        # Export row normalization, filtering, haversine distance
│   │   ├── hierarchy.js     # Modal value imputation, tree building, data quality report
│   │   ├── readings.js      # Energy normalization, interval deltas, summaries
│   │   └── time.js          # Strict DD/MM/YYYY timestamp parsing & ISO 8601 formatting
│   ├── store/
│   │   ├── async-cache.js   # Single-flight TTL cache with stale-if-error fallback
│   │   └── dataset.js       # Dataset indexing and readings store
│   ├── routes/              # Route controllers (meters, consumption, hierarchy, etc.)
│   └── schemas/             # Shared JSON Schemas for request/response validation and OpenAPI
├── scripts/
│   ├── generate-openapi.js  # Writes deterministic openapi.json from app schemas
│   ├── smoke.js             # Live portal sanity check
│   ├── probe.js             # Live read-only behavioral probes
│   └── verify-export.js     # Validates bulk export against 21 search pages
└── test/
    ├── helpers/fake-portal.js # Mock upstream portal server for integration testing
    ├── fixtures/              # Hand-crafted test fixtures reproducing quirks
    └── *.test.js              # Unit, integration, and route test suites (58 tests)
```

---

## 6. Assumptions

1. **Timezone:** Upstream timestamps in `/energy` (e.g., `30/06/2026 23:30`) lack timezone indicators. We assume Indian Standard Time (`Asia/Kolkata`, `UTC+05:30`) based on the utility geography. Configurable via `PORTAL_TZ_OFFSET`.
2. **Units of Measurement:** The portal presents raw numbers. We assume:
   - `kwh`: cumulative active energy in kilowatt-hours (kWh)
   - `kvah`: cumulative apparent energy in kilovolt-ampere-hours (kVAh)
   - `voltR`: R-phase RMS voltage in Volts (V)
   - `capacityKva`: transformer capacity in kVA
3. **Hardware `build`:** The portal tags meters as `legacy` (238 meters) or `v2` (165 meters). The internal firmware distinction is unverified upstream; we preserve and expose this string verbatim.
4. **Authoritative DT Allocation:** Meters `J100400`–`J100402` sit on `DT-007` despite sequential numeric patterns. We assume the portal's `dtCode` is authoritative and must not be altered.
5. **Clock Skew Compensation:** We assume server clock skew can be calculated from the HTTP `Date` header returned by `/portal/keys` to prevent signature rejections.
6. **Export Completeness:** The bulk export returns all 403 meters on `page=1`. We verified through `verify-export.js` that this export matches all 403 meters across 21 search pages with zero differences.

---

## 7. Design decisions & trade-offs

| Decision | Chosen Solution | Alternative Considered | Rationale |
|---|---|---|---|
| **Web Framework** | Fastify 5 | Express / Koa | Route JSON-schemas provide input validation, high-speed serialization, and auto-generated OpenAPI 3.1 documentation from a single source of truth. |
| **API Client** | Built-in `fetch` (undici) | Axios / Got | Zero dependencies; natively handles `getSetCookie()`, timeouts via `AbortSignal`, and form-encoded payloads. |
| **Test Runner** | Node.js native `node:test` + `node:assert` | Jest / Vitest | Zero dependencies; instant startup; native ESM support without babel or bundling overhead. |
| **Primary Ingestion** | HMAC Signed Bulk Export (`/portal/export`) | Scraping 21 search pages + 403 per-meter calls | Reduces cold start from ~1,230 HTTP requests to 2 HTTP requests (~230 KB total payload vs several megabytes). |
| **Readings Strategy** | On-demand per meter with LRU cache | Prefetching all 403 readings | Prefetching would require 403 requests (11 MB payload) on boot. Most users inspect a small subset of meters. |
| **Hierarchy Keys** | Colon-delimited path (`Z-01:C-01:...:DT-001`) | Single code (e.g. `DT-001`) | Upstream reuses codes (e.g. `F-001` or `D-01`) under distinct parents. Path IDs prevent key collision. |
| **Storage Architecture** | In-memory indexing | SQLite / PostgreSQL | 403 meters is tiny (~1 MB in RAM). In-memory Maps give sub-millisecond query latency with zero deployment prerequisites. |
| **API Authentication** | None (binds `127.0.0.1`) | Bearer token / API keys | Appropriate for a local take-home assessment; leaves endpoints immediately testable by the reviewer. |

---

## 8. Data cleaning policy

Our service adheres to a strict, reversible data cleaning contract:

1. **What we fill:**
   - 22 meters have exactly one blank hierarchy field (e.g. missing `circle.code`).
   - We calculate the **modal (most frequent) non-blank value** among all other meters on the same distribution transformer.
   - We fill the field, set `inferred: true` on the hierarchy tier, and log an issue with `code: "hierarchy_field_filled"` and `source: "modal_of_dt"` in `/data-quality`.
2. **What we flag as aliases:**
   - `DT-007` has canonical name "Sanganer DT 7" in `/portal/dts`, but meters `J100400`–`J100402` report "Old Malviya Nagar Xfmr" in the export.
   - We assign the canonical name to the transformer, keep alternative names in `aliases[]`, and flag `{ code: "dt_name_alias" }` on the affected meters.
3. **What we never alter:**
   - We never reassign a meter's `dtCode` or attempt to deduce transformer links by arithmetic on meter IDs.
   - If non-blank values within a DT conflict, we preserve the meter's original value and flag `hierarchy_conflict` in the data quality audit.

---

## 9. Freshness & caching

- **Inventory Dataset TTL:** 3,600,000 ms (1 hour). Configurable via `DATASET_TTL_MS`.
- **Readings TTL:** 900,000 ms (15 minutes), capped to 500 active meters via LRU eviction. Configurable via `READINGS_TTL_MS`.
- **Stale-If-Error Fallback:** If upstream fails or returns 5xx/timeouts after a cache has expired, the service serves the stale copy for up to 24 hours (`STALE_IF_ERROR_MS`) and flags `meta.stale: true`.
- **Single-Flight Coalescing:** Concurrent requests during a cache miss or refresh share a single background loading promise, preventing dogpiling upstream.
- **Manual Invalidation:** Consumers can force an immediate upstream reload via `POST /admin/refresh`.

---

## 10. Robustness

- **Automatic Re-Login:** If upstream rejects a session (HTTP 401 or JSON body `{"error":"unauthorized"}`), `PortalClient` acquires a new session and retries the request exactly once.
- **Single-Flight Authentication:** Concurrent unauthorized requests share a single login promise to avoid hammering `/login`.
- **Concurrency Cap:** Upstream requests are regulated by an internal FIFO semaphore (`PORTAL_MAX_CONCURRENCY=4`).
- **Retries & Backoff:** Transient network errors, request timeouts, 429, and 5xx responses trigger up to 2 retries with exponential backoff and randomized jitter, respecting upstream `Retry-After` headers.
- **Cold-Start Resilience:** Server boots immediately and warms the dataset asynchronously; if the portal is initially unreachable, the service starts cleanly and returns 503 (`upstream_unavailable`) until connectivity is restored.

---

## 11. Extensions implemented

1. **Electrical Network Hierarchy (`/hierarchy`):** Constructs the full multi-tier topological tree from Zone down to DT with aggregated meter counts, transformer ratings, and depth truncation.
2. **Local Query Layer (`/meters`):** Substring text search (`q`), multi-value comma-separated parameter filters (`make`, `installStatus`, `phaseType`, etc.), hierarchy path prefix matching (`node`), and data quality filtering (`hasIssues`).
3. **Geospatial Proximity Search (`near`):** Uses Haversine spherical distance calculation to filter and sort meters by radial distance in kilometers.
   *Scale note:* Linear scan is optimal at 403 meters (< 1ms). For datasets exceeding 50,000 meters, an R-tree or spatial grid index (e.g. SQLite SpatiaLite or PostgreSQL/PostGIS) should be introduced.
4. **Interval Consumption & Delta Engine (`/consumption`):** Transforms raw cumulative counter registers into actual 30-minute interval usage (`kwhDelta`/`kvahDelta`), detecting gaps and counter drops.
5. **Data Quality Audit Engine (`/data-quality`):** Complete diagnostics and transparency into all imputed fields, alias names, and anomalies.

---

## 12. What I intentionally skipped, and why

- **SvelteKit `__data.json` devalue decoding:** The bulk export is a superset of the meter detail page data. Implementing a fragile devalue deserializer would have introduced technical debt with zero functional benefit.
- **Per-meter `/geo` scraping in the main path:** The bulk export already includes geographic coordinates; making 403 separate `/geo` calls would waste network round-trips.
- **API Authentication:** Left unauthenticated for local reviewer convenience (service binds to `127.0.0.1` by default).
- **Persistent Database (SQLite / Postgres):** 403 meters and 40 DTs consume under 1 MB of memory. Introducing an external database engine adds dependencies and migrations without operational necessity.
- **Upfront prefetching of all 403 energy profiles:** Prefetching all readings requires ~11 MB of downloads on boot. On-demand caching with LRU eviction is significantly more efficient.

---

## 13. What I'd do next / with more time

1. **Persistent Cache / Storage:** Add SQLite via `node:sqlite` for disk-backed caching so restarts don't require an initial portal fetch.
2. **Change Detection & Webhooks:** Run periodic background export comparisons to detect new meters, status updates, or transformer reassignments and emit webhooks.
3. **Consumer Authentication & Rate Limiting:** Introduce API Key / JWT authentication and token-bucket rate limiting for multi-tenant production readiness.
4. **Observability & Metrics:** Export Prometheus metrics (endpoint latencies, cache hit/miss ratios, upstream error counts, clock skew drift).

---

## 14. Reflection

For detailed answers to the assignment reflection questions (assumptions, difficulties, mistakes, and self-critiques), please refer to [REFLECTION.md](REFLECTION.md).

---

## 15. Troubleshooting

- **Clock Skew / Signature Rejections:**
  If `/portal/export` returns 401 with invalid signature, the client's clock may be drifted. The client automatically adjusts using the upstream `Date` header, but verify host NTP synchronization:
  ```bash
  timedatectl status
  ```
- **Login Failures:**
  Ensure `PORTAL_EMAIL` and `PORTAL_PASSWORD` in `.env` match assignment credentials. The service redacts credentials from logs.
- **Portal Outage:**
  If the portal is down on boot, `/health` will report `loaded: false`. Once loaded, the API serves stale data gracefully. Run `npm run smoke` to test portal connectivity.

---

## 16. AI-assistance note

TODO(human): State how AI assistance was used throughout the investigation, design, and implementation of this project.
