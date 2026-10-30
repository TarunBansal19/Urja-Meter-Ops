# Urja Meter Ops — Upstream Protocol Specification

> **Status Tags:** **[C]** Confirmed via live probes and code verification; **[L]** Highly likely based on structural patterns; **[?]** Unverified / open behavior.

This document describes the reverse-engineered wire protocol, authentication model, quirks, and data schema of the legacy Urja Meter Ops web portal (`https://urja-ops.flockenergy.tech`). For complete chronological investigation notes, see [docs/investigation-log.md](docs/investigation-log.md).

---

## 1. Overview & Architecture

The upstream portal is built with SvelteKit and Better-Auth. It exposes two distinct data access patterns:
1. **SvelteKit Server Route Handlers (`/meters/__data.json`) [C]:** Internal hydration endpoints emitting serialized, flattened "devalue" payloads. These are brittle, tied to front-end build hashes, and redundant given the REST endpoints.
2. **REST API Handlers (`/portal/...`) [C]:** JSON endpoints serving structured records for distribution transformers, meters, geographic coordinates, and 30-minute interval readings.

---

## 2. Authentication & Session Management

- **Login Endpoint [C]:** `POST /login`
- **Headers Required [C]:**
  - `content-type: application/x-www-form-urlencoded`
  - `accept: application/json`
  - `x-sveltekit-action: true`
  - `origin: https://urja-ops.flockenergy.tech`
- **Body [C]:** `email=<email>&password=<password>`
- **Response Quirk [C]:**
  - Successful authentication returns **HTTP 200** with JSON:
    `{"type":"redirect","status":303,"location":"/meters"}`
  - Standard HTTP status checks fail here; clients **must** inspect the JSON body `type === "redirect"`.
  - Rejection yields `{"type":"failure", ...}` or HTTP 401.
- **Session Cookie [C]:**
  - Cookie name: `__Secure-better-auth.session_token`
  - Properties: `HttpOnly`, `Secure`, `SameSite=Lax`.
  - Value contains `%2F`. Clients **must replay the cookie value exactly as received** without decoding or re-encoding.
- **Session Expiry Detection [C]:**
  - An expired or missing session returns HTTP 401 with JSON:
    `{"error":"unauthorized","message":"A valid session is required."}`
  - Clients should check both HTTP status 401 and `error === "unauthorized"`.

---

## 3. Upstream Endpoint Catalogue

| Method & Path | Auth Required | Purpose | Response Format / Notes |
|---|---|---|---|
| `POST /login` | No | Authenticate credentials and receive session cookie | HTTP 200 with `{ "type": "redirect", "status": 303, "location": "/meters" }` [C] |
| `GET /portal/keys` | Session Cookie | Obtain HMAC signing secret for export calls | `{ "data": { "signingSecret": "<32 chars>" } }`. `Date` response header provides server time [C] |
| `GET /portal/export?page=1` | Session Cookie + HMAC Signature | Bulk export of all meters with full hierarchy & geo | `{ "data": [ ...403 meters... ], "total": 403 }`. All 403 meters returned on page 1 [C] |
| `GET /portal/dts?page=N` | Session Cookie | Paged list of distribution transformers | `{ "data": [ { "code", "name", "feederCode", "capacityKva" } ], "total": 40, "page": N, "pageSize": 20 }` [C] |
| `GET /portal/meters/search?q=&page=N` | Session Cookie | Paged search of meters by ID or serial number | `{ "data": [ ... ], "total": 403, "page": N, "pageSize": 20 }`. Page size fixed at 20 [C] |
| `GET /portal/meters/{id}/geo` | Session Cookie | Geospatial coordinates for a single meter | `{ "data": { "latitude": "26.9389...", "longitude": "75.8309..." } }`. Returns numeric strings [C] |
| `GET /portal/meters/{id}/energy` | Session Cookie | 30-min interval readings (last 7 days) | `{ "data": [ { "timestamp": "30/06/2026 23:30", "kwh": "...", "kvah": "...", "voltR": "..." } ] }`. Returns ~337 rows [C] |

---

## 4. Bulk Export Signing Recipe [C]

The `/portal/export` endpoint requires HMAC-SHA256 request authentication discovered through client bundle inspection:

```
timestamp = current Unix timestamp in whole seconds (adjusted for server clock skew)
message   = "GET" + "\n" + "/portal/export" + "\n" + "page=1" + "\n" + timestamp
signature = lowercase hex( HMAC-SHA256(key = signingSecret, data = message) )
```

**Request Headers Sent:**
- `x-timestamp: <timestamp>`
- `x-signature: <signature>`

**Clock Skew Compensation:**
When retrieving the signing key via `GET /portal/keys`, parse the HTTP `Date` response header:
`skewMs = Date.parse(response.headers.get('date')) - Date.now()`
When signing, evaluate `timestamp = Math.floor((Date.now() + skewMs) / 1000)`.

---

## 5. Upstream Data Model & Quirks

### 5.1 Field Name Discrepancies
Upstream uses conflicting field naming across different endpoints:

| Domain Concept | Bulk Export (`/portal/export`) | Search (`/portal/meters/search`) | Single Geo (`/portal/meters/{id}/geo`) |
|---|---|---|---|
| Latitude | `geo.lat` (number) | Not included | `data.latitude` (string) |
| Longitude | `geo.lng` (number) | Not included | `data.longitude` (string) |
| Transformer | `dtCode` | `dtCode` | Not included |
| Hardware Build | `build` ("legacy" / "v2") | Not included | Not included |

### 5.2 Hierarchy Structure & Code Reuse [C]
The network structure has 7 tiers:
`Zone > Circle > Division > Subdivision > Substation > Feeder > Distribution Transformer (DT) > Meter`

- **Code Non-Uniqueness:** Node codes are **not unique** globally. For example, Feeder code `F-001` exists under Substation `SS-01` and Substation `SS-02`. Division `D-01` exists under multiple circles.
- **Node Identification:** Nodes must be identified by their full path: `Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001`.

### 5.3 Upstream Data Quality Quirks [C]
1. **22 Missing Hierarchy Fields:** Exactly 22 meter records in the export have a missing string in one hierarchy tier (`circle.code`, `circle.name`, `substation.code`, `feeder.code`, or `feeder.name`). All peers on the same DT share the correct values.
2. **DT-007 Dual Names:** Meters on `DT-007` have two conflicting names in the export: 10 meters have "Sanganer DT 7" (authoritative in `/portal/dts`), while meters `J100400`–`J100402` have "Old Malviya Nagar Xfmr".
3. **Anomalous DT Assignments:** Meters `J100400`–`J100402` sit on `DT-007` despite sequential numbering suggesting `DT-001`..`DT-003`. The portal assignment is authoritative and must not be altered.
4. **Cumulative Readings:** Energy registers `kwh` and `kvah` are cumulative counter readings, not interval consumption.
5. **Day-First Timestamps without Timezone:** Energy timestamps are formatted as `DD/MM/YYYY HH:mm` with no timezone indicator.
6. **Query Encoding:** Substring search parameter `q` must encode special characters (e.g. `L&T` -> `L%26T`).

---

## 6. Verification Results (Live Probes)

Running `scripts/probe.js` and `scripts/verify-export.js` against the live production portal established:
1. **Unauthorized Status [C]:** Unauthenticated requests to `/portal/keys` return **HTTP 401** with body `{"error":"unauthorized","message":"A valid session is required."}`.
2. **Energy Date Range Support [C]:** Passing `?from=2026-06-25&to=2026-06-30` (ISO 8601 format `YYYY-MM-DD`) reduces the energy readings array from 337 rows to 288 rows.
3. **Export Completeness [C]:** Fetching `page=1` returns all 403 meters (`total: 403, data.length: 403`). Fetching `page=2` returns HTTP 200 with `total: 403, data.length: 403`.
4. **Export Fidelity [C]:** 100% of the 403 meters across 21 search pages match the bulk export across all 6 shared fields (`meterId`, `serialNo`, `make`, `phaseType`, `installStatus`, `dtCode`).
