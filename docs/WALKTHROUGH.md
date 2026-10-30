# Technical Walkthrough & Discussion Guide

**Author:** Tarun Bansal (`bansaltarun0819@gmail.com`)

This guide is designed for the assignment follow-up review. It outlines my architecture, key design decisions, dataset quirks, and code locations.

---

## 1. End-to-End Request Flow

```mermaid
flowchart TD
    Client["Client / Web UI"] -->|HTTP GET /meters, /consumption, etc.| Fastify["Fastify 5 App (src/app.js)"]
    Fastify -->|Input Validation & Schemas| RouteHandler["Route Handlers (src/routes/*)"]
    RouteHandler -->|Query / Slices| DatasetService["DatasetService (src/store/dataset.js)"]
    
    subgraph Storage & Cache Layer
        DatasetService -->|In-Memory Cache (TTL + Stale-if-Error)| AsyncCache["AsyncCache (src/store/async-cache.js)"]
        AsyncCache -->|Single-Flight Coalescing| Loader["Loader Promise"]
    end
    
    subgraph Upstream Client Layer
        Loader -->|Normalized Domain Operations| Domain["Domain Cleaning (meters.js, hierarchy.js, readings.js)"]
        Loader -->|Idempotent API Calls| PortalApi["PortalApi (src/portal/api.js)"]
        PortalApi -->|HMAC-SHA256 Signed Requests| Signing["signExport() (src/portal/signing.js)"]
        PortalApi -->|Concurrency Semaphore (max 4) + Cookie Jar| PortalClient["PortalClient (src/portal/client.js)"]
        PortalClient -->|HTTPS + Retries & Relogin| LegacyPortal["Legacy Portal (urja-ops.flockenergy.tech)"]
    end
```

---

## 2. Five Key Design Decisions

1. **Fastify 5 + JSON Schemas:** Unified routing, request validation, serialization, and automatic OpenAPI 3.1 generation from a single source of truth without code duplication.
2. **Bulk Export over Granular Scraping:** A single signed request to `/portal/export` plus `/portal/dts` loads all 403 meters and network topology in 2 HTTP calls instead of ~1,230 per-meter scrapes.
3. **On-Demand Energy Caching:** Readings are retrieved on-demand per meter and cached with a 15-minute TTL and 500-entry LRU bound, avoiding 11 MB of upfront payload downloads.
4. **Stale-If-Error Resiliency:** If upstream goes down or experiences transient 5xx errors, our API continues serving cached data with `meta.stale: true` rather than failing consumer requests.
5. **Path-Based Hierarchy Identifiers:** Network codes repeat under different parents (e.g. `F-001` under multiple substations); identifying nodes by their full path (`Z-01:C-01:...:DT-001`) prevents tree collisions.

---

## 3. Five Messiest Data Facts & How They Are Handled

| Upstream Anomaly | Portal Symptom | Our Handling Strategy | File Location |
|---|---|---|---|
| **22 Blank Hierarchy Fields** | 22 meters lack one field (e.g. `circle.code`, `feeder.name`). | Group meters by `dtCode`, take modal non-blank value of peers, mark `inferred: true`, and log issue in `/data-quality`. | [src/domain/hierarchy.js](file:///home/epsilon/FLOCK/src/domain/hierarchy.js) |
| **DT-007 Dual Naming** | 10 meters report "Sanganer DT 7"; J100400–402 report "Old Malviya Nagar Xfmr". | Canonical name taken from `/portal/dts`; alternative name preserved in `aliases[]` and flagged in data quality. | [src/domain/hierarchy.js](file:///home/epsilon/FLOCK/src/domain/hierarchy.js) |
| **Anomalous Meter-DT Links** | J100400–402 break the sequential meter→DT numbering pattern. | Never guess or synthesize `dtCode` from meter numbers; preserve portal's explicit assignment verbatim. | [src/domain/meters.js](file:///home/epsilon/FLOCK/src/domain/meters.js) |
| **Reused Hierarchy Codes** | Codes like `F-001` or `D-01` appear under multiple parent nodes. | Full colon-delimited path IDs (`Z-01:C-01:D-01:SD-01:SS-01:F-001`) guarantee unique tree nodes. | [src/domain/hierarchy.js](file:///home/epsilon/FLOCK/src/domain/hierarchy.js) |
| **Stringly-Typed & Cumulative Registers** | Energy numbers are strings; values are cumulative registers, not usage. | Cast to real floats; compute interval consumption (`kwhDelta`); flag timestamp gaps and counter resets. | [src/domain/readings.js](file:///home/epsilon/FLOCK/src/domain/readings.js) |

---

## 4. "If Asked X, Point at File Y" Cheat-Sheet

- **Authentication & Cookie Jar:** [src/portal/client.js](file:///home/epsilon/FLOCK/src/portal/client.js) (`#saveCookies`, verbatim cookie string replay, single-flight `login()`)
- **HMAC-SHA256 Signing Recipe:** [src/portal/signing.js](file:///home/epsilon/FLOCK/src/portal/signing.js) (`signExport()`)
- **Bulk Export & Clock Skew:** [src/portal/api.js](file:///home/epsilon/FLOCK/src/portal/api.js) (`getSigningSecret()`, `fetchExport()`)
- **Modal Value Imputation & Tree Building:** [src/domain/hierarchy.js](file:///home/epsilon/FLOCK/src/domain/hierarchy.js) (`buildHierarchy()`, `findModalValue()`)
- **Filtering, Text Search & Haversine Distance:** [src/domain/meters.js](file:///home/epsilon/FLOCK/src/domain/meters.js) (`applyFilters()`, `haversineKm()`)
- **Timestamp Parsing & Energy Normalization:** [src/domain/time.js](file:///home/epsilon/FLOCK/src/domain/time.js) & [src/domain/readings.js](file:///home/epsilon/FLOCK/src/domain/readings.js) (`parsePortalTimestamp()`, `normalizeEnergy()`)
- **Caching & Stale-If-Error Policy:** [src/store/async-cache.js](file:///home/epsilon/FLOCK/src/store/async-cache.js) & [src/store/dataset.js](file:///home/epsilon/FLOCK/src/store/dataset.js)
- **OpenAPI 3.1 & Schema Definitions:** [src/schemas/index.js](file:///home/epsilon/FLOCK/src/schemas/index.js) & [scripts/generate-openapi.js](file:///home/epsilon/FLOCK/scripts/generate-openapi.js)
- **Fastify Server & Route Setup:** [src/app.js](file:///home/epsilon/FLOCK/src/app.js) & [src/server.js](file:///home/epsilon/FLOCK/src/server.js)

---

## 5. Things to Be Able to Re-Derive Without Notes

1. **Export Signing Recipe:**
   - Text message: `GET\n/portal/export\npage=1\n<timestamp>`
   - HMAC: SHA-256 with 32-character secret from `/portal/keys`, hex output lowercase.
   - Headers: `x-timestamp` and `x-signature`.
2. **Clock Skew Compensation:**
   - Server sends `Date` response header on `/portal/keys`.
   - `skewMs = Date.parse(dateHeader) - Date.now()`.
   - Signature timestamp uses `Math.floor((Date.now() + skewMs) / 1000)`.
3. **Why `dtCode` is Never Calculated from Meter ID:**
   - Even though meters J100000–J100009 are on DT-001, meters J100400–J100402 sit on DT-007. Hardcoding arithmetic rules creates silent data corruption.
4. **Why Node IDs Are Full Paths:**
   - Reused codes (e.g., Feeder `F-001` under Substation `SS-01` and Substation `SS-02`) would overwrite each other if keyed by code alone.
