# PLAN.md — Build the "Urja Meter Ops" API service

> **For the coding agent.** Read this whole file before writing any code. It is the single source of truth for scope, decisions and order of work. The investigation is already done (see §2); your job is to **build**, not to re-investigate. Follow the phases in order, commit after each phase, and keep the README current as you go (§8).

---

## 0. Ground rules

1. **Stack:** Node.js (>= 20.12, develop on 22 LTS) and **plain JavaScript (ESM)**. No TypeScript, no build step. Use JSDoc `@typedef`s for the core types.
2. **The portal is read-only.** Only well-formed GETs plus the login POST. No fuzzing, no tampered cookies/signatures, no hammering. Max 4 concurrent portal requests (configurable). A "probe" is a handful of requests, not a scan.
3. **Never commit secrets.** Credentials come from `.env` (`PORTAL_EMAIL`, `PORTAL_PASSWORD`), which is git-ignored. The signing secret returned by `/portal/keys` and the session cookie must never be logged, written to disk, or put in docs/tests. Redact them in the logger config.
4. **Keep it appropriately sized.** The brief rewards judgment: neither over- nor under-engineered. Every dependency and every abstraction must earn its place. When unsure, pick the simpler option and write the trade-off down.
5. **Write decisions down as you make them** in the matching section of `README.md` (skeleton created in Phase 0). Do not leave this for the end.
6. **Time budget: 4–6 hours of work.** See §9 for what to cut if running over.
7. **Don't invent facts about the portal.** If something is unverified, say so in the docs (`[unverified]`) and make the code tolerant of both possibilities.
8. **Human-owned parts (§10):** do not fabricate the Reflection answers about mistakes/difficulty/self-criticism. Scaffold them with `TODO(human)` markers.

---

## 1. What we are building

A clean, documented REST API in front of the legacy portal at `https://urja-ops.flockenergy.tech`. Another engineer should be able to consume meter data, the network hierarchy and consumption readings without ever touching the portal.

**Deliverables (repo root):** source code, `README.md`, `PROTOCOL.md`, `openapi.json`, `REFLECTION.md` (linked from README). Plus tests and a few helper scripts.

**Extensions we are doing** (all are cheap given the bulk export): network hierarchy, local query layer (filters + "near"), freshness/caching, robustness, bulk path. **Optional last:** small web client (Phase 8).

---

## 2. What the portal does (from `investigation.md`)

Tags: **[C]** confirmed, **[L]** likely, **[?]** unverified.

### 2.1 Auth
- `POST /login`, form-encoded body `email=…&password=…`, headers `accept: application/json`, `x-sveltekit-action: true`. Also send `origin: <portal origin>` because SvelteKit may enforce an Origin check on form POSTs **[?]**.
- Success is **HTTP 200** with JSON `{"type":"redirect","status":303,"location":"/meters"}` plus `Set-Cookie`. **Decide success from the JSON `type`, not the HTTP status.** [C]
- Failure is expected to be `{"type":"failure", …}` **[?]** — treat anything other than `type === "redirect"` as failure.
- Session cookie: `__Secure-better-auth.session_token` (HttpOnly, Secure, SameSite=Lax). Value contains `%2F`; **replay the cookie exactly as the server sent it** (take the `name=value` part before the first `;`, do not decode/re-encode). [C]
- Lifetime and rotation unknown **[?]** → merge any `Set-Cookie` from every response into the cookie jar.
- No/invalid cookie on `/portal/...` returns a JSON body `{"error":"unauthorized","message":"A valid session is required."}`. **HTTP status code is unknown [?]** → detect by body `error === "unauthorized"` **or** status 401, never by status alone. [C for body]
- Other errors share the shape `{"error": "...", "message": "..."}` (e.g. `{"error":"not_found","message":"Meter not found"}`). [C]

### 2.2 Endpoints (all need the cookie)

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /portal/keys` | `{"data":{"signingSecret":"<32 chars>"}}` | Secret for signing export calls. Same per session? **[?]** Use response `Date` header to estimate clock skew (see 2.3). |
| `GET /portal/export?page=1` | `{"data":[…403 meters…],"total":403}` (~230 KB) | **Main source.** Needs `x-timestamp` + `x-signature`. Returned *all* meters for `page=1`. Whether other pages exist is unknown **[?]** → loop defensively (see Phase 1). |
| `GET /portal/dts?page=N` | `{"data":[{code,name,feederCode,capacityKva}],"total":40,"page","pageSize":20}` | 2 pages. `capacityKva` is a real number. Authoritative DT names. |
| `GET /portal/meters/search?q=&page=N` | `{"data":[{meterId,serialNo,make,phaseType,installStatus,dtCode}],"total":403,"page","pageSize":20}` | `pageSize` param ignored. Past last page → 200 + empty `data`. `page=0` → page 1. `q` = case-insensitive **substring** on `meterId` and `serialNo` only (not make, not dtCode). `&` must be sent as `%26`. Used **only** for the cross-check script. |
| `GET /portal/meters/{id}/geo` | `{"data":{"latitude":"26.93…","longitude":"75.83…"}}` | Strings. Not needed in the main path (export has geo). |
| `GET /portal/meters/{id}/energy` | `{"data":[{timestamp,kwh,kvah,voltR}, …≈337 rows]}` | **Only source of readings.** All values strings. Timestamp `DD/MM/YYYY HH:mm`, no timezone. 30-min interval, 7 days, last row `30/06/2026 23:30`. `kwh`/`kvah` are **cumulative registers** (usage = difference between rows). Three-phase meters have the same 4 fields (no voltY/voltB). Date params unknown **[?]**. |
| `GET /meters/{id}/__data.json?x-sveltekit-invalidated=001` | SvelteKit "devalue" flattened array | **Deliberately not used** (export is a superset). Documented in PROTOCOL.md only. |

### 2.3 Export signing [C]
```
timestamp = current Unix time, whole seconds, as text
message   = "GET" + "\n" + "/portal/export" + "\n" + "page=1" + "\n" + timestamp
signature = lowercase hex( HMAC-SHA256(key = signingSecret, data = message) )
headers   = x-timestamp: <timestamp>, x-signature: <signature>
```
The query part of the message is the raw query string without `?` (so `page=1`). Tolerated clock skew is unknown **[?]** → when calling `/portal/keys`, compute `skewMs = Date(response header) − Date.now()` and sign with `Date.now() + skewMs`.

### 2.4 Export row shape [C]
```json
{
  "meterId": "J100000", "serialNo": "SE33962", "make": "HPL", "phaseType": "single",
  "installStatus": "Decommissioned", "installType": "Whole Current", "build": "legacy", "dtCode": "DT-001",
  "hierarchy": {
    "zone": {"name":"Jaipur Zone 1","code":"Z-01"}, "circle": {"name":"Circle 1","code":"C-01"},
    "division": {…}, "subdivision": {…}, "substation": {…}, "feeder": {…}, "dt": {"name":"Malviya Nagar DT 1","code":"DT-001"}
  },
  "geo": {"lat": 26.938961002479868, "lng": 75.83095696146852}
}
```

### 2.5 Dataset facts and messy data (use for fixtures and live sanity checks)
- 403 meters `J100000…J100402` (unique, no gaps, unique serials); 40 DTs.
- `make`: HPL 90, L&T 64, Genus 88, Allied 76, Secure 85. `installStatus`: Installed 238, Faulty 90, Decommissioned 75. `installType`: Whole Current 205, CT Operated 198. `build`: legacy 238, v2 165 (**meaning unknown**).
- Hierarchy levels: **zone > circle > division > subdivision > substation > feeder > dt** (then meter).
- **22 meters have exactly one blank hierarchy field** (circle code ×6, circle name ×5, substation code ×3, feeder code ×5, feeder name ×3). Fill from other meters on the same DT and **mark as filled**.
- **Codes are reused under different parents** (division D-01 under circles C-01/C-03/C-05; feeder F-001 under SS-01 and SS-11, etc.). **A code alone does not identify a node above the DT. Identify nodes by full path from zone down.** There are 40 distinct full paths, one per DT.
- **DT-007 has two names:** "Sanganer DT 7" on 10 meters, "Old Malviya Nagar Xfmr" on J100400–J100402. These three also break the otherwise-regular meter→DT assignment (they sit on DT-007; the pattern says DT-001..003). **Never compute `dtCode` from the meter number; always use the portal's `dtCode`.** Flag the three as data-quality issues; don't "fix" the DT link.
- Several DT codes' `feederCode` wrap (DT-029..040 reuse F-001..F-012).
- Type inconsistencies: `/geo` strings vs export numbers; `/energy` all strings; `capacityKva` number. Always output real numbers.

### 2.6 Still unknown — resolve cheaply in Phase 2 (don't block on them)
1. Does `/energy` accept date params (`from`/`to`)? Grep the meter page's JS chunk under `/_app/immutable/` for `energy`, then try 1–2 probes. If not supported, filter locally.
2. HTTP status of the "unauthorized" response.
3. Does `/portal/export` honour `page=2`? (Only try if `data.length < total`; otherwise skip.)
4. Is the export identical to the paged list on the 6 shared fields for all 403 meters? (`scripts/verify-export.js`.)

---

## 3. Decisions already made (do not re-litigate; document the *why* in README)

| Topic | Decision | Why |
|---|---|---|
| HTTP framework | **Fastify 5** + `@fastify/swagger` + `@scalar/fastify-api-reference` (fallback: `@fastify/swagger-ui` if Scalar costs >15 min) | Route JSON-schemas give validation, serialization **and** the OpenAPI doc from one source of truth |
| HTTP client to portal | Built-in `fetch` (undici) | Zero deps; `res.headers.getSetCookie()` handles cookies. If Node refuses to set `Origin`, fall back to `undici.request` |
| Testing | Built-in `node:test` + `node:assert` | Zero deps |
| Config | `process.loadEnvFile()` (wrapped in try/catch) + `process.env` | No dotenv dependency |
| Primary data source | Bulk export + `/portal/dts` | 3–5 requests vs ~1,230 for list + per-meter calls |
| Readings | On demand per meter, cached per meter | 403 × 27 KB isn't worth prefetching |
| Meter detail via `__data.json` | **Skipped** | Export is a superset; the devalue decoder would be dead code. Mentioned in "intentionally skipped" |
| Cache staleness | Per-resource TTL + **stale-if-error** (serve stale, flag it) + single-flight + manual refresh | Portal sends no ETag/Last-Modified/Cache-Control, so freshness must be our policy |
| Hierarchy identity | Node id = full path of codes from zone down, joined with `:` (e.g. `Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001`) | Codes repeat under different parents |
| Hierarchy cleaning | Fill blanks with the **modal non-blank value among meters on the same DT**; record each fill; canonical DT name from `/portal/dts`; other names kept as `aliases` | Traceable, reversible, no guessing from patterns |
| Timestamps | Parse `DD/MM/YYYY HH:mm` with a strict regex; **assume Asia/Kolkata (+05:30)**; emit ISO 8601 with offset. Offset configurable via `PORTAL_TZ_OFFSET` | No DST in India so a fixed offset is correct; assumption documented |
| Numbers | Always real numbers in our API. Unparseable → `null` and counted | Portal types are inconsistent |
| Units | Output `kwh`, `kvah`, `voltageR`; assume kWh, kVAh, volts; **state clearly this is an assumption** | Portal states no units |
| Usage | Return cumulative registers **and** per-interval `kwhDelta`/`kvahDelta` (delta only when previous row is exactly one interval earlier and value didn't decrease; else `null`, counted in `meta`) | Raw registers are misleading as "consumption" |
| Pagination (our API) | `page` (1-based) + `pageSize` (default 50, max 200); envelope includes `pagination` | Mirrors the portal's style but with a usable size |
| Errors | `{"error":{"code","message","details?"}}`; 400 invalid_request, 404 not_found, 502 upstream_error, 503 upstream_unavailable, 504 upstream_timeout | Consistent, typed |
| Auth on our API | **None** (binds `127.0.0.1` by default) | Local take-home; listed under "skipped" |
| Language of API fields | camelCase; one vocabulary across all endpoints | Portal names the same facts three different ways |

---

## 4. Repository layout

```
.
├── README.md                  # front door (see §8)
├── PROTOCOL.md                # how the portal works (see §8)
├── REFLECTION.md              # scaffold; human fills (see §10)
├── openapi.json              # generated, committed
├── package.json  package-lock.json  .nvmrc  .gitignore  .env.example
├── docs/
│   ├── investigation-log.md   # raw notes, copied from investigation.md (already redacted)
│   └── WALKTHROUGH.md         # "teammate pickup" guide (see §10)
├── src/
│   ├── server.js              # entrypoint: config -> build app -> listen -> graceful shutdown
│   ├── app.js                 # buildApp({config, portal?, dataset?}) -> Fastify instance (injectable for tests)
│   ├── config.js              # env parsing + defaults + validation
│   ├── errors.js              # PortalAuthError, PortalUnavailableError, PortalProtocolError, NotFoundError, ...
│   ├── portal/
│   │   ├── client.js          # PortalClient: login, cookie jar, relogin-on-expiry, retry/backoff, timeout, concurrency cap
│   │   ├── signing.js         # signExport({secret, method, path, query, timestamp})
│   │   └── api.js             # fetchExport(), fetchDts(), fetchSearchPage(), fetchGeo(), fetchEnergy()
│   ├── domain/
│   │   ├── meters.js          # normalizeExportRow(), meter filters & "near" (haversine)
│   │   ├── hierarchy.js       # clean + build tree + data-quality report
│   │   ├── readings.js        # normalizeEnergy(), range filter, deltas, summary
│   │   └── time.js            # parsePortalTimestamp(), parseQueryInstant()
│   ├── store/
│   │   ├── async-cache.js     # TTL + stale-if-error + single-flight (injectable clock)
│   │   └── dataset.js         # Dataset service: load export+dts -> normalized indexes; readings service
│   ├── routes/                # meters.js, consumption.js, transformers.js, hierarchy.js, meta.js (health, stats, data-quality, refresh)
│   └── schemas/               # shared JSON Schemas (components for OpenAPI)
├── scripts/
│   ├── generate-openapi.js    # writes openapi.json from the app (no network)
│   ├── smoke.js               # live: login -> keys -> export -> dts -> one energy; prints sanity numbers
│   ├── probe.js               # live, read-only: resolves the open questions in §2.6
│   └── verify-export.js       # live: export vs paged list (21 calls) on shared fields
├── test/
│   ├── helpers/fake-portal.js # local node:http server imitating the portal (§7)
│   ├── fixtures/              # small hand-built fixtures reproducing the quirks
│   └── *.test.js
└── public/                    # (Phase 8, optional) web client, no build step
```

`package.json` scripts: `start`, `dev` (`node --watch`), `test`, `openapi`, `smoke`, `probe`, `verify-export`.

---

## 5. API design

Envelope: success → `{ "data": …, "meta": { "fetchedAt", "stale", … } }`; lists add `"pagination": { page, pageSize, total, totalPages }`. `stale: true` means a refresh failed and we are serving the last good copy.

| Method & path | Purpose |
|---|---|
| `GET /meters` | List/search meters (from the local dataset). Params: `page`, `pageSize`; `q` (case-insensitive substring on `meterId`/`serialNo`, same semantics as the portal); exact, case-insensitive, comma-separated multi-value filters `make`, `phaseType`, `installStatus`, `installType`, `build`, `dtCode`; `node` (hierarchy node id **prefix**, e.g. all meters under a circle); `hasIssues=true`; geo: `near=lat,lng&radiusKm=` (adds `distanceKm`, sorts by distance). Default order: `meterId` asc. Invalid params → 400. |
| `GET /meters/{meterId}` | One meter: nameplate, `location {latitude, longitude}`, `hierarchy` (per level `{code, name, inferred?}`), `hierarchyNodeId`, `dataQuality.issues[]`. Unknown id → 404 (answered from the dataset, no portal call). |
| `GET /meters/{meterId}/consumption` | Readings. Params: `from`, `to` (ISO 8601; date-only means midnight IST; range is **[from, to)**). Response: `data { meterId, intervalMinutes: 30, timezone, readings[ {timestamp, kwh, kvah, voltageR, kwhDelta, kvahDelta} ], summary { kwhConsumed, kvahConsumed, voltageR {min,max,avg} } }`, `meta { availableFrom, latestReadingAt, rowCount, skippedRows, gaps, decreases, units }`. Meter must exist in dataset (also prevents arbitrary path forwarding); portal `not_found` → 404. |
| `GET /transformers` | All DTs: `code, name, aliases[], feederCode, capacityKva, meterCount, hierarchyNodeId`. |
| `GET /transformers/{code}` | DT + status/make breakdown of its meters. |
| `GET /hierarchy` | Full tree (roots array). Node: `{ id, level, code, name, aliases?, meterCount, children[] }`; DT nodes also carry `capacityKva`, `feederCode`. Param `depth` to truncate. |
| `GET /hierarchy/{nodeId}` | Subtree for one node (404 if unknown). |
| `GET /stats` | Counts by make / installStatus / phaseType / installType / build + totals + dataset freshness. |
| `GET /data-quality` | Report of everything we cleaned or flagged (filled blanks, DT aliases, anomalies, counts). |
| `GET /health` | Liveness + dataset state (`loaded`, `fetchedAt`, `ageMs`, `stale`, `meterCount`). **Must not call the portal.** |
| `POST /admin/refresh` | Invalidate + reload dataset (single-flight). |
| `GET /docs`, `GET /openapi.json` | Scalar UI; raw spec. |

**Fastify gotchas to handle:**
- Response schemas silently **drop undeclared fields**. Write route tests that assert full payloads.
- Define shared schemas once (`Meter`, `Reading`, `HierarchyNode`, `Transformer`, `Error`, `Pagination`, `Meta`) with `$id`s and use `@fastify/swagger`'s `refResolver` so they appear under `components.schemas`.
- Add descriptions/examples to every route and parameter; the OpenAPI doc is a graded deliverable. State the units/timezone assumptions in the schema descriptions.
- Custom error handler maps domain errors to the error shape above; schema-validation errors also use that shape.

---

## 6. Phases

Commit at the end of each phase (`feat: …` / `test: …` / `docs: …`). Run `npm test` before each commit.

### Phase 0 — Scaffold (≈15 min)
- `npm init`, `"type": "module"`, `"engines": {"node": ">=20.12"}`, `.nvmrc` (22), `.gitignore` (`node_modules`, `.env`, `*.log`), `.env.example` with these keys and **no real values**:
  `PORTAL_BASE_URL=https://urja-ops.flockenergy.tech`, `PORTAL_EMAIL=`, `PORTAL_PASSWORD=`, `PORT=3000`, `HOST=127.0.0.1`, `LOG_LEVEL=info`, `DATASET_TTL_MS=3600000`, `READINGS_TTL_MS=900000`, `STALE_IF_ERROR_MS=86400000`, `PORTAL_TIMEOUT_MS=15000`, `PORTAL_MAX_CONCURRENCY=4`, `PORTAL_TZ_OFFSET=+05:30`.
- Install deps: `fastify`, `@fastify/swagger`, `@scalar/fastify-api-reference` only. Commit the lockfile. Check current versions with `npm view` and pick ones compatible with Fastify 5 (and ≥14 days old).
- Copy `investigation.md` to `docs/investigation-log.md`.
- Create `README.md` with **empty section headings** for everything in §8 so decisions can be appended as you go.
- `src/config.js`: parse + validate env, fail fast with a clear message if `PORTAL_EMAIL`/`PORTAL_PASSWORD` are missing.

### Phase 1 — Portal client (≈60 min)
Build `src/portal/*` and `test/helpers/fake-portal.js` together (TDD-ish).
- **`client.js`**
  - Cookie jar: `Map<name, value>`; merge `Set-Cookie` from **every** response; send all as one `Cookie` header; never decode values.
  - `login()`: POST as in §2.1; success only if `res.ok` and JSON `type === "redirect"` and a session cookie is present; otherwise throw `PortalAuthError` (without echoing the password). **Single-flight**: concurrent callers share one login promise.
  - `getJson(path, {query, signed})`: apply concurrency cap (tiny semaphore, no library), per-request timeout (`AbortSignal.timeout`), parse JSON defensively (non-JSON → `PortalProtocolError`).
  - **Session expiry:** if body has `error === "unauthorized"` or status is 401 → `login()` then retry **once**. Never loop.
  - **Retries:** idempotent GETs only; network errors, timeouts, 429, 5xx → up to 2 retries with exponential backoff + jitter (honour `Retry-After` if present). Don't retry 4xx.
  - Encode path segments with `encodeURIComponent` and build query strings with `URLSearchParams` (this handles `&` → `%26`).
- **`signing.js`**: pure function per §2.3 with a unit test using a fixed secret/timestamp and an independently computed expected hex (compute it once with `node:crypto` in the test and also check with `openssl` or similar by hand).
- **`api.js`**
  - `getSigningSecret()` → also returns `skewMs` from the `Date` header; cache with the session; refetch after re-login.
  - `fetchExport()`: signed GET `page=1`; if `data.length < total`, request further pages until the total is reached or a page adds nothing new (dedupe by `meterId`; hard cap of 50 pages). If the export returns 401/403 *without* `error: "unauthorized"` → refetch secret once and retry once (covers clock/secret rotation), then throw `PortalUnavailableError`.
  - `fetchDts()` walks pages until `data` is empty or `page * pageSize >= total` (portal returns 200 + empty past the end — never wait for an error).
  - `fetchEnergy(id)`, `fetchGeo(id)`, `fetchSearchPage(q, page)`.
- **Tests (against fake portal):** login success; login failure (`type: "failure"`); cookie replay incl. `%2F`; expiry → exactly one relogin → success; concurrent 401s → one login; 5xx then success (retry); timeout; signature verified by the fake portal; export multi-page loop terminates; `&` encoding in search.

### Phase 2 — Live probes and smoke test (≈25 min; skip if the sandbox has no network and mark `TODO(human)`)
- `scripts/smoke.js`: login → keys → export → dts → energy for `J100000`; print counts and compare with §2.5 (**warn, don't fail**, if numbers differ — data may legitimately change).
- `scripts/probe.js` (read-only, prints a compact report, ≤ ~15 requests): the four open questions in §2.6. Do **not** send tampered credentials or signatures.
- `scripts/verify-export.js`: fetch the 21 list pages; compare `meterId, serialNo, make, phaseType, installStatus, dtCode` with the export; spot-check geo for ~5 random meters via `/geo`; print diffs.
- Write the findings into `PROTOCOL.md` and README "Assumptions". If energy accepts date params, pass `from`/`to` upstream when the requested window is a strict subset; otherwise filter locally. Either way our API contract is unchanged.

### Phase 3 — Normalization, hierarchy, dataset (≈75 min)
- `domain/meters.js`: `normalizeExportRow()` → trim strings, treat empty/whitespace as `null`, `geo.{lat,lng}` → `location.{latitude,longitude}` (numbers; `null` if absent/NaN), lower-case `phaseType`, keep portal casing for other enums.
- `domain/hierarchy.js` (pure functions, heavily tested):
  1. Group meters by `dtCode`. For each level × (`code`,`name`) pick the **modal non-blank** value across the group. Fill blanks; record `{code:"hierarchy_field_filled", field:"circle.code", value, source:"modal_of_dt"}` on the meter.
  2. DT name: canonical from `/portal/dts`. Meters whose export DT name differs get `{code:"dt_name_alias", value}`; the alias is collected on the DT.
  3. If non-blank values within a DT disagree (beyond DT name), report `hierarchy_conflict` and use the modal path for the tree; leave the meter's own non-blank value untouched.
  4. Cross-check `/portal/dts.feederCode` against the DT's modal feeder code; report `feeder_code_mismatch` if different.
  5. Build the tree from full code paths. Id = codes joined by `:`. Node name = modal name at that path. If a code is still missing after cleaning, use `unknown-<level>` and report it.
  6. Output: `{ roots, nodesById, dtIndex, report }`. `report` feeds `/data-quality`.
- `store/dataset.js`: `getDataset()` → `AsyncCache` entry holding `{ meters[], meterById, transformers[], tree, report, stats }`. Loads export and DTs concurrently. Builds indexes once per load, not per request.
- `domain/meters.js` also exports `applyFilters(meters, params)` and `haversineKm()`. Linear scan is fine at this scale (note the scale limit in README: ~10⁵ meters is still OK; beyond that use a spatial index such as a grid/geohash, or SQLite/PostGIS, plus an inverted index for text search).
- **Tests with small hand-built fixtures** (≈12 meters, 3–4 DTs): blank circle code, blank feeder name, DT-007-style alias, two DTs sharing a feeder code under different substations (must become two distinct nodes), a DT whose only meter has a blank field (→ `unknown-…`), duplicate-code pitfalls, filter semantics (multi-value, case-insensitivity, `q` substring), `near` ordering.

### Phase 4 — Readings (≈30 min)
- `domain/time.js`: strict `DD/MM/YYYY HH:mm` regex (reject anything else); build `YYYY-MM-DDTHH:mm:00<offset>` by string/arithmetic (don't rely on the host's local timezone). `parseQueryInstant()` accepts ISO 8601 with offset, `Z`, or date-only (midnight at the configured offset).
- `domain/readings.js`: `normalizeEnergy(rows, {tzOffset})` → readings with real numbers; skip + count rows with bad timestamps; sort by time; compute deltas per §3 (null when gap ≠ 30 min or value decreased; count `gaps` and `decreases`); `filterRange`; `summarize` (consumed = last − first cumulative within range, min/max/avg voltage).
- Store: readings cached per `meterId` through `AsyncCache` (TTL `READINGS_TTL_MS`, bounded to 500 entries, oldest evicted).
- **Tests:** timestamp parsing edge cases (day-first, midnight, `31/12`), trailing-zero strings (`"48440"`), a gap row, a decreasing counter, empty list, `[from,to)` boundaries, date-only input.

### Phase 5 — HTTP layer + OpenAPI (≈60 min)
- `app.js` with dependency injection (`buildApp({config, portal, dataset})`) so tests can pass a stub.
- Implement all routes in §5 with full JSON schemas. Pino logger with `redact` for `req.headers.cookie`, `*.signingSecret`, `*.password`.
- Graceful shutdown (SIGINT/SIGTERM → `app.close()`), non-blocking `dataset.warm()` on boot (server must start even if the portal is down; data endpoints then return 503 with `Retry-After`).
- `scripts/generate-openapi.js` boots the app with a stub portal, calls `app.swagger()`, writes `openapi.json` (pretty-printed, stable key order). Set `info.title/version/description`, servers `http://localhost:3000`, tags per resource.
- **Test:** `openapi.json` committed in the repo equals freshly generated output (fails with a helpful "run `npm run openapi`" message).
- **Route tests** via `app.inject()`: every endpoint's happy path with full payload assertions, 400 on bad params, 404 on unknown meter/node, stale flag when the refresh fails, 503 when nothing is cached and the portal is down.

### Phase 6 — Freshness & robustness wiring (≈30 min)
- `store/async-cache.js`: `get(key, loader)` returns `{value, fetchedAt, stale}`. Fresh if age < TTL. Expired → refresh via **single-flight** loader; on failure, serve the stale entry if age < `STALE_IF_ERROR_MS` (log a warning, `stale: true`), else throw. Clock injectable for tests. `invalidate(key)` for `/admin/refresh`.
- Verify end-to-end against the fake portal: portal down after first load → API still serves stale data with `meta.stale: true`; portal returns → next request after TTL recovers.
- Confirm one login serves many requests and that a long session survives a mid-run expiry (fake portal toggle).
- Record the rationale for TTLs in README: the portal offers no validators; the dataset looks static (readings end 30 Jun 2026, four months before the investigation) so 1 h for the dataset and 15 min for readings is conservative; manual refresh exists for when a user knows data changed. Open question to mention: how often the portal data truly changes (a second export a few days later would tell us).

### Phase 7 — Documentation (≈50 min) — see §8

### Phase 8 — OPTIONAL web client (time-box 60–75 min; only if Phases 0–7 are done and tests pass)
Static files in `public/`, served by Fastify (`@fastify/static`), vanilla JS modules, **no build step**, talks only to our API. Keep it small and useful:
1. **Overview:** counts by status/make (simple SVG/CSS bars), a data-quality banner linking to `/data-quality` ("22 blank fields filled, 3 meters with DT name aliases").
2. **Map:** meters as markers coloured by `installStatus` (Leaflet from npm, served locally; tiles need internet — say so), click → side panel.
3. **Meter panel:** nameplate, hierarchy breadcrumb, consumption chart (hand-rolled SVG line chart or uPlot): per-interval kWh and voltage, with gaps visible and a note that data ends 30 Jun 2026.
4. **Hierarchy explorer:** collapsible tree with meter counts; selecting a node filters the map.
Mention in README that it exists; list what it deliberately lacks (no auth, no tests beyond a manual check).

---

## 7. Testing strategy

- **Unit (pure):** signing, time parsing, readings normalization, hierarchy cleaning/tree, filters/haversine, async-cache.
- **Integration with `fake-portal.js`:** a tiny `node:http` server implementing `/login`, `/portal/keys`, `/portal/export` (verifies the HMAC and a plausible timestamp window), `/portal/dts`, `/portal/meters/search`, `/portal/meters/:id/{geo,energy}`, with toggles to: expire the session, return N× 503, delay responses, return `type:"failure"` at login, paginate export.
- **API tests** with `app.inject()` and a stubbed dataset.
- **Caveat to state in README:** the fake portal encodes *our understanding*; a green suite is not proof the real portal agrees. That's what `npm run smoke` and `npm run verify-export` are for.
- No snapshot of the full real export in the repo (size/noise); fixtures are small and hand-written.

---

## 8. Documentation deliverables

### README.md (must be understandable with zero context; all of these headings must exist)
1. **What this is** + one-paragraph architecture summary + a small diagram (ASCII or Mermaid): `client → our API → dataset/cache → PortalClient → portal`.
2. **Quick start:** prerequisites (Node ≥ 20.12), `npm ci`, `cp .env.example .env` and fill `PORTAL_EMAIL`/`PORTAL_PASSWORD` (credentials are in the assignment email; none are in this repo), `npm start`, `npm test`, `npm run smoke`.
3. **Sample requests** with real-looking responses (meters list with filters, one meter, consumption with `from`/`to`, hierarchy subtree, `near`).
4. **Where to find things:** links to `PROTOCOL.md`, `openapi.json`, live docs at `/docs`, `REFLECTION.md`, `docs/WALKTHROUGH.md`.
5. **Project structure** (short).
6. **Assumptions** (timezone, units, `build` meaning unknown, DT link taken as given, clock skew handling, export is complete when `data.length == total`, etc.).
7. **Design decisions & trade-offs** (use the table in §3 as a starting point; add the reasoning).
8. **Data cleaning policy** (what we fill, what we flag, what we never touch).
9. **Freshness & caching** (TTLs, stale-if-error, refresh endpoint, what a consumer sees in `meta`).
10. **Robustness** (relogin, retries, timeouts, concurrency cap, graceful degradation).
11. **Extensions implemented** (hierarchy, local query layer + scale note, caching, robustness, bulk path, web client if built).
12. **What I intentionally skipped, and why:** `__data.json` decoding; per-meter `/geo` and `/search` as primary paths; auth on our API; persistence (SQLite) — in-memory is enough for 403 meters; rate limiting of our own API; Docker; prefetching all readings; pagination of tiny lists (hierarchy); anything write-related.
13. **What I'd do next / with more time:** persistent store, background refresh, change detection between exports, proper TZ confirmation with the utility, auth + rate limiting, metrics, contract tests against the real portal on a schedule, spatial index at scale.
14. **Reflection** (link to `REFLECTION.md`).
15. **Troubleshooting:** wrong clock → signature rejected (we correct skew from the `Date` header, but say what to check), login failures, portal unreachable behaviour.
16. A short, honest **AI-assistance note** (placeholder for the human to word, §10).

### PROTOCOL.md (short — aim for 2–3 pages; it's one of the most valuable deliverables)
Condense `investigation.md`; **do not copy it wholesale** and **do not add facts that aren't in it**. Keep the confirmed/likely/unverified labels. Structure:
1. Overview (SvelteKit app, two data paths: `__data.json` and `/portal/...`).
2. Authentication & session (login flow incl. the "200 with redirect in body" quirk, cookie, expiry behaviour and what's unknown).
3. Endpoint catalogue (table: method, path, purpose, auth, notes) including the signed export flow with the signing recipe (**no secrets**).
4. Data model (meter, hierarchy levels, DT, readings) and field-name mapping between sources.
5. Pagination/search semantics (fixed page size 20, `pageSize` ignored, empty page past the end, `q` semantics).
6. Quirks & surprises (stringly-typed numbers, tz-less day-first timestamps, cumulative registers, code reuse under different parents, 22 blank fields, DT-007 two names, three meters breaking the DT pattern, `build` unknown, data ends 30 Jun 2026, `&` encoding).
7. Bulk path (keys + signed export) and how it was found (page JS chunk).
8. What's verified vs open (incl. results from `probe.js` / `verify-export.js` if run).
9. Link to `docs/investigation-log.md` for raw notes.

### openapi.json
Generated by `npm run openapi`, committed, kept in sync by a test; rendered at `/docs`.

---

## 9. Priorities and stop rules

**Tier A (must):** Phases 0–5 core: client, export-based dataset, `/meters`, `/meters/{id}`, `/meters/{id}/consumption`, `/hierarchy`, `/transformers`, OpenAPI, README, PROTOCOL.md, REFLECTION scaffold.
**Tier B (should):** data-quality report, filters + `near`, `/stats`, `/health`, caching/stale-if-error, refresh, fake-portal integration tests, smoke/probe/verify scripts.
**Tier C (nice):** web client (Phase 8), daily aggregation (`aggregate=daily` on consumption), Docker.

If over time: cut Tier C first, then `near`/`/stats`, then probes. **Never cut** the docs or the tests for hierarchy cleaning and readings normalization. If you stop early, write what you'd do next in README (explicitly valued by the brief).

---

## 10. Human-owned parts (do NOT fabricate)

- **`REFLECTION.md`:** create it with the five questions from the brief as headings. You may pre-fill **"What assumptions did you make?"** from the README assumptions. Leave the other four (**most difficult part & how unstuck; what I'd improve with another day; the mistake I made; what I'd criticise in my own submission**) as `TODO(human): …` with 2–3 *candidate facts* the human can react to (e.g. "possible criticism: in-memory only; no auth; fake portal encodes my assumptions"). The human writes the final words.
- **AI-assistance note in README:** insert a placeholder `TODO(human): state how AI assistance was used`. The brief allows AI for guidance but expects the core investigation to be the candidate's and tests understanding in a follow-up; the human decides the wording.
- **`docs/WALKTHROUGH.md`:** a 1-page guide for the follow-up conversation: request flow end-to-end (one diagram), the 5 key design decisions with one-sentence rationale, the 5 messiest data facts and how each is handled, "if asked X, point at file Y" cheat-sheet, and a list of things the human should be able to re-derive without notes (signing recipe, why `dtCode` isn't computed, why node ids are paths).

---

## 11. Definition of done

- [ ] `npm ci && npm test` passes from a clean clone (no network, no credentials needed for tests).
- [ ] `npm start` with a filled `.env` serves: `/health`, `/meters?installStatus=Faulty&pageSize=5`, `/meters/J100000`, `/meters/J100000/consumption?from=2026-06-30`, `/hierarchy`, `/transformers`, `/data-quality`, `/docs`.
- [ ] `npm run smoke` against the live portal prints ≈ 403 meters / 40 DTs / the 3 DT-007 aliases / 22 filled hierarchy fields (or explains differences).
- [ ] `openapi.json` is committed and equals `npm run openapi` output; `/docs` renders it.
- [ ] All README headings in §8 are filled; PROTOCOL.md exists and is short; REFLECTION.md scaffold exists with `TODO(human)` where required.
- [ ] `git grep -i -E "password|secret|cookie|signature"` shows no real values; `.env` is not tracked; logs don't contain the cookie or signing secret (check one run).
- [ ] Commit history is a readable story (one commit per phase, sensible messages).
