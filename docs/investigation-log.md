# Urja Meter Ops: Investigation Log

*Working notes that will become PROTOCOL.md. Never paste real passwords or tokens here; use `<REDACTED>`. Last updated 30 Oct 2026 (searches, pagination tests, the export flow and the export results added; entries from that round are marked 'new').*

## 0. How to use this doc

- Log findings **as you discover them**, with date/time. Surprises are the most valuable entries.
- For every claim, keep evidence: a request, a response sample, or a screenshot note.
- Mark confidence: **\[confirmed\]** (tested), **\[likely\]** (seen once), **\[guess\]** (untested).
- Dead ends and mistakes go in section 11. The Reflection asks for one, so capture it when it happens.

## 1. Overview

| Item | Notes |
| --- | --- |
| Portal URL | https://urja-ops.flockenergy.tech |
| Date(s) explored | 30 Oct 2026 |
| Rendering style | A SvelteKit app: server-rendered, then hydrated in the browser. Pages get their data in two ways: SvelteKit's built-in JSON (`/<page>/__data.json`) and a separate JSON API under `/portal/...` that the page calls from the browser. \[confirmed for the meter page\] |
| Frameworks or libraries spotted | Svelte 5 and SvelteKit (Vite build, files under `/_app/immutable/`). Tailwind CSS v4.3.2. Better Auth (inferred from the cookie name). |
| Server headers of note | Data responses use `content-type: application/json`. `__data.json` also sends `cache-control: private, no-store`. HTTP/3. Static files are cached for a year (immutable). No Server or X-Powered-By header seen. **New:** the `/portal/...` JSON routes send only content-length, content-type and date: no cache-control, etag or last-modified. |
| One-paragraph summary | A SvelteKit web app with routes `/`, `/login`, `/meters`, `/meters/[id]` and `/transformers`. You sign in with a form POST to `/login` and get a session cookie. Opening a meter fires three requests at once: nameplate and hierarchy from `/meters/{id}/__data.json`, location from `/portal/meters/{id}/geo`, and 7 days of half-hourly readings from `/portal/meters/{id}/energy`. The `/portal/...` calls are a plain JSON API that needs only the cookie, which makes it the likely best target for my service. The meter list (`/portal/meters/search`) and DT list (`/portal/dts`) are paged, 20 per page. \[confirmed for one meter and for both lists' first pages\] |

## 2. Pages and features (human walkthrough)

| Page / screen | URL | What it shows | Inputs (search, filters, dates) | Notes |
| --- | --- | --- | --- | --- |
| Login | /login | Sign-in form | email, password |  |
| Meters | /meters | Meters list, 20 per page, six fields each, plus total | search box (`q`), page | To describe in detail |
| Meter detail | /meters/{id} | Nameplate, network hierarchy, location, 7 days of half-hourly readings | none seen | Fires 3 requests when opened |
| Transformers | /transformers | DT list, 20 per page (code, name, feeder code, capacity) | page | To describe in detail |

**Things the UI shows but I can't yet explain:**

- (to fill)

**Things the UI does *not* show but might exist (buttons, links, hints in JS):**

- An Export all meters button on the Transformers page, found in the JS (see 4.2). Static chunk (`/_app/immutable/nodes/4.2Bgc2kUI.js`)

## 3. Authentication and session

### 3.1 Login flow

| Question | Finding |
| --- | --- |
| Login URL and method | POST https://urja-ops.flockenergy.tech/login. A SvelteKit form action on the same URL as the login page. \[confirmed\] |
| Request format (form-encoded / JSON) | Form-encoded (`application/x-www-form-urlencoded`). The page's JS sends it in the background with headers `accept: application/json` and `x-sveltekit-action: true`. A plain form submit should also work. \[confirmed from the page's JS; request body not inspected yet\] |
| Fields sent | email, password |
| Hidden fields / CSRF token? | None in the form HTML. \[confirmed\] SvelteKit may still reject POSTs without a matching Origin header, so test this from code. \[guess\] |
| Is the token fresh per page load? | Not applicable, there is no token. |
| Success response | HTTP **200**, not a redirect. JSON body: `type: "redirect"`, `status: 303`, `location: "/meters"`. A Set-Cookie header carries the session. \[confirmed\] |
| Failure response (wrong password) | Not tested yet. Expected: JSON with `type: "failure"` and an error message. \[guess\] |

### 3.2 Session mechanics

| Question | Finding |
| --- | --- |
| Where is the session kept? | In a cookie, set by the login response. \[confirmed\] |
| Cookie name and flags | `__Secure-better-auth.session_token`. Flags: HttpOnly, Secure, SameSite=Lax, Path=/. Value looks like `<token>.<signature>`. Expiry or Max-Age: not checked yet. \[confirmed for flags\] |
| What do authenticated requests send? | A Cookie header with the session cookie, plus normal browser headers. No Authorization or custom auth header seen. In the request, the `/` inside the cookie value appears as `%2F`, so a client should keep the cookie exactly as the server sent it. \[confirmed\] |
| Does the token get refreshed or rotated? | Unknown. Compare the cookie after a few page loads. |
| Session lifetime (idle and absolute) | Unknown. Look for Max-Age or Expires in the raw Set-Cookie header. Better Auth's default is 7 days. \[guess\] |

### 3.3 Expiry and invalid sessions

| Scenario | What the portal returns (status / redirect / body) |
| --- | --- |
| No cookie at all | JSON error: `{"error":"unauthorized","message":"A valid session is required."}`. Response headers: `content-type: application/json`, no content-length. Tested on `/portal/meters/search` and `/portal/meters/J100005/energy` in incognito. \[confirmed 30 Oct 2026\] |
| Tampered or garbage cookie | (to test) |
| Expired session | (to test) |
| After logout | (to test) |

**How my client will detect expiry and re-login:** Check response body for `"error":"unauthorized"`. Re-login by POSTing to `/login` and capturing the new cookie. Open: what is the HTTP status code of the unauthorized response (401? 403? 200?).

## 4. Endpoints discovered

### 4.1 Summary table

| # | Method | Path | Purpose | Auth needed | Format | Seen in |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | POST | /login | Sign in and receive the session cookie | No | JSON (SvelteKit form-action result) | Network tab, signing in |
| 2 | GET | /meters/{id}/\_\_data.json?x-sveltekit-invalidated=001 | Meter nameplate fields and network hierarchy | Yes (cookie) | JSON (SvelteKit flattened format) | Opening meter J100000 |
| 3 | GET | /portal/meters/{id}/geo | Meter latitude and longitude | Yes (cookie) | JSON | Opening meter J100000 |
| 4 | GET | /portal/meters/{id}/energy | Half-hourly readings: kWh, kVAh, voltage | Yes (cookie) | JSON | Opening meter J100000 |
| 5 | GET | /portal/meters/search?q=&page=1 | Meters list: 20 per page, six fields each, plus the total. `q` filters (see 4.2) | Yes (cookie) | JSON | Meters page; q and page tested by hand |
| 6 | GET | /portal/dts?page=1 | Transformers list: 20 DTs per page with code, name, feeder code and capacity | Yes (cookie) | JSON | Transformers page |
| 7 | ? | ? | Feeders, substations and the levels above them: found in the hierarchy of each meter in the export (row 9); no separate tree route seen | ? | ? | Not captured yet |
| 8 | GET | /portal/keys | Gives the browser a signing secret (data.signingSecret) used to sign export requests | Yes (cookie) \[confirmed\] | JSON | Called 30 Oct 2026 from the Export button (see A8, A9) |
| 9 | GET | /portal/export?page=1 | Bulk export of meters; the page saves it as meter-export.json. Returns all 403 meters in one response, with hierarchy and location. Needs x-timestamp and x-signature headers (see 4.2) | Yes (cookie plus signature headers) \[confirmed\] | JSON | Called 30 Oct 2026 from the Export button (see A8, A9) |

### 4.2 Endpoint detail

**Endpoint name: Meter detail**

- Method and URL: GET https://urja-ops.flockenergy.tech/meters/J100000/\_\_data.json?x-sveltekit-invalidated=001
- Query / path parameters: path id is the meter ID (example J100000). The query `x-sveltekit-invalidated=001` is a SvelteKit switch meaning: send data for the page level only and skip the two outer layout levels.
- Request headers that matter: Cookie with the session. The rest (Accept, Referer, Sec-Fetch-\*) are browser defaults. Test whether they are needed.
- Request body: none.
- Response status codes seen: 200. Headers: `content-type: application/json`, `cache-control: private, no-store`.
- Response shape: three nodes. The first two are `{"type":"skip"}`. The third holds data, a flat array where numbers point to other positions in the array. Decoded shape: `meterId`, `detail.data[]` (name/value pairs) and `hierarchy` (object). See Appendix A2.
- Quirks: no location and no consumption in this response, although the page shows both. Details are stored as name/value pairs. See section 8.

**Endpoint name: Meter location (geo)**

- Method and URL: GET https://urja-ops.flockenergy.tech/portal/meters/J100000/geo
- Parameters: path id only. The browser sent no query string.
- Request headers that matter: Cookie with the session. Not yet tested without it.
- Response: 200, `application/json`, 74 bytes. Body: `{"data":{"latitude":"26.938961002479868","longitude":"75.83095696146852"}}`
- Quirks: latitude and longitude are **strings**, not numbers. The result is wrapped in a `data` key.

**Endpoint name: Meter consumption (energy)**

- Method and URL: GET https://urja-ops.flockenergy.tech/portal/meters/J100000/energy
- Parameters: path id. No query string was sent. The reply covered 23/06/2026 23:30 to 30/06/2026 23:30. Whether the route accepts date parameters is not known yet.
- Request headers that matter: Cookie. The Cache-Control: no-cache and Pragma: no-cache headers came from my browser's Disable Cache setting.
- Response: 200, `application/json`, 27,557 bytes, about 337 rows in `data[]`. Each row has `timestamp`, `kwh`, `kvah` and `voltR`.
- Quirks: every value is a string, including the numbers. Timestamps look like `23/06/2026 23:30` with no timezone. Trailing zeros are dropped (`"48440"`). See Appendix A3.

**Endpoint name: Meter search (the Meters list)**

- Method and URL: GET https://urja-ops.flockenergy.tech/portal/meters/search?q=&page=1
- Parameters: `q` (search text, empty returns all meters) and `page` (starts at 1). No page size is sent by the browser; the reply reports `pageSize: 20`. Whether a page size can be set is not known yet.
- Behaviour of `q` (**new**, tested by hand): `q=J100005` returned exactly one meter (total 1), so it matches meterId. `q=L%26` returned 77 meters (4 pages); every hit had a serial number starting `L&`. Meter J100001 (make `L&T`, serial GE84132) was **not** returned, so `q` does not appear to search `make`. \[likely\] Not yet tested: substring vs prefix, upper vs lower case, searching a DT code.
- Request headers that matter: Cookie. Nothing else special. **New:** the route returned JSON even when the browser asked for `text/html`, so it ignores the Accept header.
- Response: 200, `application/json`. Shape: `{"data":[ ...up to 20 meters... ],"total":403,"page":1,"pageSize":20}`. Each meter has `meterId`, `serialNo`, `make`, `phaseType`, `installStatus` and `dtCode`. Page 1 is 2,539 bytes.
- Past the last page (**new**, \[confirmed\]): page 21 returns the last 3 meters (J100400 to J100402); page 22 returns HTTP 200 with `{"data":[],"total":403,"page":22,"pageSize":20}`. No error status.
- Quirks: only six fields per meter. Hierarchy, location and readings are not included, so each needs its own call per meter. Field names differ from the detail view. `&` in a search must be sent as `%26`. Results come back in meterId order, also when filtered. See section 8.

**Endpoint name: Transformer (DT) list**

- Method and URL: GET https://urja-ops.flockenergy.tech/portal/dts?page=1
- Parameters: `page` (starts at 1). No `q` seen on this call. Only page 1 captured so far.
- Request headers that matter: Cookie. Nothing else special.
- Response: 200, `application/json`, 1,680 bytes. Shape: `{"data":[ ...20 DTs... ],"total":40,"page":1,"pageSize":20}`. Each DT has `code`, `name`, `feederCode` and `capacityKva`.
- Response headers (**new**): only content-length, content-type and date. No cache-control, etag or last-modified, so there is no cheap way to ask whether the list changed; freshness has to be decided in my service.
- Quirks: `capacityKva` is a number here, while other routes send numbers as strings. Only the feeder code is given, not the levels above it. See section 5.2.

**Endpoint name: Signing key (new, read from the page JS)**

- Method and URL: GET https://urja-ops.flockenergy.tech/portal/keys
- Parameters: none. The Transformers page calls it with a same-origin fetch, and my capture shows the session cookie on that request. \[confirmed\]
- Response (captured 30 Oct 2026: status 200, 61 bytes, application/json): JSON of the form `{"data":{"signingSecret": ...}}`. The page reads `data.signingSecret`.
- Quirks: the signing secret is handed to the browser by an ordinary logged-in call. Never write its value in this log, in screenshots or in the repo; use `<REDACTED>`. The secret is 32 characters long. Open: is it the same on every call, or new per session?

**Endpoint name: Bulk export (new, read from the page JS)**

- Method and URL: GET https://urja-ops.flockenergy.tech/portal/export?page=1
- Parameters: the page sends only `page=1`.
- Required headers: `x-timestamp` and `x-signature`. How the signature is made is in Appendix A8.
- Response (captured 30 Oct 2026: status 200, 231,658 bytes, application/json): JSON with `data` (the meters) and `total`. The page saves `data` as `meter-export.json` and shows `Exported <total> meters.`. On a non-OK status it shows `Export failed (<status>).`
- Quirks: the button says Export all meters but the request has only `page=1`, and it still returned all 403 meters in one response. Checked by comparing the length of `data` with `total`.

## 5. Data model

### 5.1 Meter

| Field | Type | Example | Nullable? | Notes |
| --- | --- | --- | --- | --- |
| meter id | string | J100000 | no | Appears twice in the meter detail response: in detail and in hierarchy |
| serial number | string | SE33962 | unknown | Portal label: Serial No. Can contain `&` (for example L&84997) |
| make | string | HPL | unknown | Manufacturer. Counts from the export: HPL 90, L&T 64, Genus 88, Allied 76, Secure 85. |
| phase type | string | single | unknown | Values seen: single, three. The list calls it `phaseType`. |
| installation status | string | Decommissioned | unknown | Also repeated inside hierarchy. Values seen in the lists: Installed, Faulty, Decommissioned. The list calls it `installStatus`. |
| installation type | string | Whole Current | unknown | Whole Current (205) and CT Operated (198), counted in the export |
| latitude, longitude | string, string | 26.938961002479868, 75.83095696146852 | unknown | From `/portal/meters/{id}/geo`. Sent as text with about 15 decimal places. I convert to numbers. |
| build (new) | string | legacy | no (403 of 403 present) | Only in the export. legacy (238) or v2 (165). Meaning unknown; not in the list or the detail view. |
| geo (export) (new) | object with two numbers | lat 26.938961002479868, lng 75.83095696146852 | no (403 of 403 present) | Real numbers here, while the /geo route sends strings. lat 26.788 to 27.037, lng 75.662 to 75.912, all inside one small area. |

- ID format and uniqueness: J followed by 6 digits. Page 1 runs J100000 to J100019 in order; the last meter on page 21 is J100402. All 403 IDs are unique, J100000 to J100402 with no gaps, and no serial number repeats (counted in the export).
- Total number of meters and how I counted: 403, from the `total` field of the search route. **New:** page 21 holds 3 meters, which matches 20 x 20 + 3 = 403. \[confirmed: the export also holds exactly 403 meters\]

### 5.2 Network hierarchy

- Levels seen: Zone > Circle > Division > Subdivision > Sub Station > Feeder > DT (distribution transformer) > Meter. That is 7 levels above the meter.
- How a meter points to its parent: the meter detail view gives a display string per level in the form `Name (CODE)`. The meter list gives only `dtCode` (for example DT-001). The DT list (`/portal/dts`) links each DT code to a `feederCode` (DT-001 to F-001). On page 1 of the DT list each DT has its own feeder.
- **New, meter to DT rule** \[confirmed\]: for a meter ID with number n (the digits after J, minus 100000), the DT is `DT-` followed by (n mod 40) + 1. This matches 400 of the 403 meters in the export, all except the three below \[confirmed\] (for example J100049 -> DT-010, J100085 -> DT-006, J100146 -> DT-027). With 40 DTs and 403 meters this is a repeating assignment. I must not compute it in my service; I must read `dtCode` from the portal.
- **New, exception to the rule** \[confirmed\]: the last three meters J100400, J100401, J100402 would map to DT-001, DT-002, DT-003, but all three are on **DT-007** (all Genus, three-phase, Installed). DT-007 would then have 13 meters. In the export these three also carry a different name for DT-007 (Old Malviya Nagar Xfmr, where the other ten show Sanganer DT 7). They look like deliberately planted messy data. \[confirmed in the export\] Not yet checked in the meters' detail view.
- Is the hierarchy available as a tree endpoint, or only inferred from meter attributes? No separate tree route found. The export (see 4.2) holds all 7 levels, as name and code, for every meter, so the tree can be built from one call. Zone, Circle, Division, Subdivision and Sub Station also show up in a meter's detail view. Still to check: other chunks of the page JS for other `/portal/` routes.
- **Messy or inconsistent data found:** found in the export (table below): 22 blank fields, one DT code with two names, and upper-level codes reused under different parents. Checked on all 403 meters.

| Issue | Example | How I'd handle it |
| --- | --- | --- |
| Name and code share one string | Feeder 1 (F-001) | Split with a pattern, and keep the original string as well |
| Code widths differ between levels | SS-01, F-001, DT-001 | Treat codes as opaque strings, never assume a width |
| Key spelling differs from value spelling | key Sub Station, value Substation 1 (SS-01) | Normalise to one name in my API |
| Last 3 meters break the DT pattern (new) | J100400 to J100402 are on DT-007, the pattern says DT-001 to DT-003 | Always use the `dtCode` the portal returns; compare their hierarchy with J100006 (a normal DT-007 meter) |
| Blank hierarchy fields (new) | 22 meters have exactly one blank. Circle code: J100011, J100074, J100097, J100116, J100170, J100265. Circle name: J100218, J100248, J100306, J100370, J100371. Substation code: J100153, J100228, J100302. Feeder code: J100044, J100078, J100134, J100210, J100268. Feeder name: J100162, J100257, J100372. | Fill the blank from other meters on the same DT (each DT has one clean path), and mark the value as filled |
| One DT code, two names (new) | DT-007 is Sanganer DT 7 on 10 meters and Old Malviya Nagar Xfmr on J100400 to J100402 | Key by code; take the name from the DT list and keep the other name as an alias |
| Codes reused under different parents (new) | Division D-01 sits under circles C-01, C-03 and C-05; subdivision SD-01 under D-01, D-05 and D-09; feeder F-001 under substations SS-01 and SS-11. 10 division codes give 30 distinct (circle, division) pairs. | A code alone does not identify a node above the DT. Identify nodes by the full path from zone down: that gives 40 distinct paths, one per DT |

### 5.3 Consumption / readings

| Question | Finding |
| --- | --- |
| Interval | 30 minutes. About 337 rows, from 23/06/2026 23:30 to 30/06/2026 23:30. No gaps noticed by eye. \[confirmed on one meter\] |
| Date/time format and timezone | Text in the form DD/MM/YYYY HH:mm, day first (a row says 30/06/2026). No timezone is given. I will assume India time and say so. |
| Unit | Fields: `kwh`, `kvah`, `voltR`. The portal states no units. `voltR` is phase R voltage, between 220 and 240 in the sample, presumably volts. All values are strings. **Three-phase meters (J100005, tested) return the same four fields: no `voltY` or `voltB`.** \[confirmed 30 Oct 2026\] |
| Max date range per request | Unknown. The page sent no parameters. Read the page's JS to see whether the route takes any. |
| How missing intervals appear | None seen in this sample. Not known for other meters. |
| Cumulative reading vs interval delta | `kwh` and `kvah` only go up, by about 0.42 and 0.46 per row. They are running meter readings, not usage per interval. Usage is the difference between two rows. \[confirmed on this meter\] |
| Oldest and newest data available | In the response: 23/06/2026 23:30 to 30/06/2026 23:30. The page also says Latest: 30/06/2026 23:30. |

### 5.4 Other data

- Transformers (DTs): 40 in total (2 pages of 20, both captured). Fields: `code`, `name`, `feederCode`, `capacityKva` (a number, in kVA). Capacities: 63, 100, 160, 250, 400. Names cycle through 10 areas (Malviya Nagar, Mansarovar, Vaishali, Raja Park, Bani Park, Jhotwara, Sanganer, Tonk Road, Sikar Road, Civil Lines). Feeder codes wrap: DT-001 to DT-028 use F-001 to F-028, then DT-029 to DT-040 reuse F-001 to F-012 — so 28 unique feeder codes serve 40 DTs. \[confirmed 30 Oct 2026\]
- Meter status values seen so far: Installed, Faulty, Decommissioned. Counts from the export: Installed 238, Faulty 90, Decommissioned 75.

## 6. Pagination, filtering, sorting, limits

| Question | Finding |
| --- | --- |
| Pagination style | Page number: `page=1`, starting at 1. The reply carries `page`, `pageSize` and `total`. |
| Default and maximum page size | Fixed at 20. The `pageSize` parameter is **ignored** by the server: `pageSize=100` still returns 20 items with `pageSize: 20` in the response. \[confirmed 30 Oct 2026\] |
| Behaviour past the last page | **New** \[confirmed\]: `page=22` returns HTTP 200 with `{"data":[],"total":403,"page":22,"pageSize":20}`. No error. `page=0` silently returns page 1 (same data, `page: 1` in response). My client must stop when `data` is empty or when page x pageSize >= total. \[confirmed\] |
| Is the total count reported? Is it reliable? | Yes: `total` is 403. **New:** page 21 has 3 meters, consistent with 403. With a filter the total changes (q=L%26 gives 77, q=J100005 gives 1). Full walk to confirm still pending. |
| Filters supported | Only `q` (free text) seen. No separate filter for make, status or DT. **New:** `q` matches meterId and serialNo (see 4.2); it did not match make. |
| Sorting supported / default order stable? | No sort option seen. **New:** results come in meterId order, also in filtered results (q=L%26). \[confirmed on 2 queries\] Stability across repeated calls not checked. |
| Search behaviour | **New:** `q` is a **case-insensitive substring** match on `meterId` and `serialNo` only. It does **not** match `make` or `dtCode`. Evidence: `q=j100005` → 1 (lowercase works), `q=0005` → 11 (substring match), `q=HPL` → 0 (make not searched), `q=DT-006` → 0 (dtCode not searched), `q=J100005` → 1, `q=L%26` → 77 (serial number match). \[confirmed 30 Oct 2026\] |
| Does the DT list page the same way? | Yes: `page=1`, and the reply carries `page`, `pageSize` 20 and `total` 40, so 2 pages. Only page 1 captured. No `q` seen. |

## 7. Bulk or alternate data paths

- Export / download buttons or routes: found. The Transformers page has an Export all meters button. It calls /portal/keys for a signing secret, then /portal/export with a signature (see 4.2 and A8). \[confirmed: run 30 Oct 2026, 403 meters in one response\]
- Hidden or undocumented routes (robots.txt, sitemap, /api, /docs, JS references): the Meters page loads the static chunk `/_app/immutable/nodes/4.2Bgc2kUI.js` (1,509 bytes compressed; `cache-control: public, max-age=31536000, immutable`; last-modified 20 Aug 2026). Contents read (see 4.2): it is the Transformers page component, probably preloaded from the Meters page, and it holds the export flow. Still to do: search the other page chunks for `/portal` and any export routes. robots.txt and sitemap not checked.
- Is the bulk data identical to the paginated data? Partly checked: both give 403 meters with the same first and last ID, and the six list fields match for the meters I compared (J100000, J100001, J100003, J100005 and J100400 to J100402). The export also has fields the list lacks (installType, build, hierarchy, geo). A full row-by-row comparison is still to do.
- Cost/benefit: when would I use bulk vs per-meter calls? With the export, nameplate, hierarchy and location for all 403 meters come in 2 requests (keys plus export, 231,658 bytes). Only the readings still need one call per meter (403 calls). Without the export it would be 21 list pages plus 3 calls for each of 403 meters, about 1,230 requests.

## 8. Quirks and surprises

*Chronological. Include what surprised you, how you confirmed it, and its impact on the clean API.*

| Date | Quirk | Evidence | Impact on my service |
| --- | --- | --- | --- |
| 30 Oct 2026 | A successful login returns HTTP 200, with the redirect written inside the JSON body. | Login POST: status 200, body `type: "redirect"`, `status: 303`, `location: "/meters"`. | My client must read the JSON `type` field, not the HTTP status, to decide if login worked. |
| 30 Oct 2026 | The cookie name reveals the auth library: Better Auth. | `__Secure-better-auth.session_token` | The portal may also expose standard Better Auth routes. Test carefully later. \[guess\] |
| 30 Oct 2026 | Page data is available as JSON by adding `/__data.json` to a page URL. | GET /meters/J100000/\_\_data.json?x-sveltekit-invalidated=001 returned 200 with JSON. | A second way to reach page data, beside the `/portal/...` routes. |
| 30 Oct 2026 | The data is in a flattened format: an array where numbers point to other positions in the array. | Raw response of the call above. | I need a small decoder, with tests. |
| 30 Oct 2026 | Meter details are a list of name/value pairs, not an object. | `detail.data[]` with `parameterName` and `parameterValue`. | Convert to a plain object so callers get serialNo, make, and so on. |
| 30 Oct 2026 | Each hierarchy level is one string mixing name and code. Code widths differ. | Feeder 1 (F-001), Substation 1 (SS-01). The key says Sub Station, the value says Substation. | Split into name and code. Treat codes as opaque strings. |
| 30 Oct 2026 | Data responses from `__data.json` say `cache-control: private, no-store`. | Response headers of the meter detail call. | Any caching has to live in my service. |
| 30 Oct 2026 | There are two data routes: SvelteKit's `__data.json` for the nameplate and hierarchy, and a plain JSON API under `/portal/...` for location and readings. | The meter page makes three requests when it opens. | Call the `/portal/...` routes directly where they exist. Decode `__data.json` only where there is no other source. |
| 30 Oct 2026 | Readings and coordinates arrive as strings, and numbers drop trailing zeros. | `"kwh":"48438.74"`, `"kwh":"48440"`, `"latitude":"26.9389..."` | Convert to numbers in my service and never compare them as text. |
| 30 Oct 2026 | Timestamps have no timezone and are written day-first. | `"timestamp":"23/06/2026 23:30"`. A row dated 30/06/2026 shows the first number is the day. | Assume India time (Asia/Kolkata), write the assumption down, and output ISO 8601 with an offset. |
| 30 Oct 2026 | The data stops on 30 Jun 2026, four months before today (30 Oct 2026). | Last row 30/06/2026 23:30. | Don't treat the latest reading as now. Expose the latest reading time in my API. |
| 30 Oct 2026 | The meter list is paged: 20 per page and 403 meters in total, so 21 pages. | /portal/meters/search?q=&page=1 returned total 403 and pageSize 20. | My service must walk the pages to list everything. Check that the total stays stable. |
| 30 Oct 2026 | The list and the detail view name the same facts differently. | List: `installStatus`, `phaseType`, `dtCode`. Detail: Installation Status, Phase Type, and a full name for each hierarchy level. | My API uses one set of names (camelCase) and maps both sources onto it. |
| 30 Oct 2026 | Some values contain an ampersand. | Serial numbers L&84997 and L&34861, and the make L&T. | When searching or building URLs, encode & as %26. Otherwise the query string breaks. |
| 30 Oct 2026 | The list has only six fields per meter. Everything else needs separate calls per meter. | The list rows compared with the three calls the meter page makes. | The whole dataset is 21 list pages plus 3 calls for each of 403 meters, about 1,230 requests. Plan caching, and look for a bulk or export route. |
| 30 Oct 2026 | Number types are inconsistent between routes. | `capacityKva` is a real number (100, 63, 250). `kwh`, `voltR`, latitude and longitude are strings. | Convert everything to proper numbers in my API. |
| 30 Oct 2026 | The DT list gives only the feeder code, not the levels above it. | /portal/dts fields: code, name, feederCode, capacityKva. | Zone, Circle, Division, Subdivision and Sub Station appear only in a meter's detail view. To build the full tree I may need one detail call per DT (40 calls), unless another route exists. |
| 30 Oct 2026 | 40 DTs serve 403 meters, and the DT names reuse the same ten area names. | DT-001 and DT-011 are both Malviya Nagar. | Use the code, never the name, as the key. |
| 30 Oct 2026 (new) | Asking for a page past the end is not an error: HTTP 200 with an empty list. | page=22 returned `{"data":[],"total":403,"page":22,"pageSize":20}`; page=21 returned 3 meters. See A4 and A7. | Stop paging when `data` is empty or page x pageSize >= total. Never wait for an error. |
| 30 Oct 2026 (new) | The search box `q` matches meterId and serial number, but apparently not make. | q=L%26 gave 77 meters, all with serials starting L&. J100001 (make L&T, serial GE84132) was missing. q=J100005 gave exactly 1 meter. \[likely\] | I cannot filter by make through the portal; filter locally if my API needs it. |
| 30 Oct 2026 (new) | The meter to DT assignment follows a repeating pattern: DT number = (n mod 40) + 1, where n is the meter number minus 100000. | Held for 400 of the 403 meters in the export. \[confirmed\] | Do not compute it. Read `dtCode` from the portal. |
| 30 Oct 2026 (new) | The last three meters break that pattern: J100400 to J100402 are all on DT-007 (the pattern says DT-001 to DT-003). | Page 21 response, see A7. All three are Genus, three-phase, Installed, and carry a different DT name in the export. \[confirmed\] | Probably planted messy data. Compare their detail hierarchy with J100006 before trusting the DT link. |
| 30 Oct 2026 (new) | The `/portal/...` JSON responses have no caching headers and ignore the Accept header. | Response headers of /portal/dts and /portal/meters/search: only content-length, content-type, date. JSON returned even to a request asking for text/html. | No conditional requests possible. If I cache, staleness has to be decided by my own time limit. |
| 30 Oct 2026 (new) | A bulk export exists, behind an Export all meters button that sits on the Transformers page. | Transformers page JS (nodes/4.2Bgc2kUI.js): button label, calls to /portal/keys and /portal/export, saves meter-export.json. \[confirmed in code, not yet run\] | Possible way to get all meters in far fewer calls than 21 list pages plus per-meter calls. Test it before relying on it. |
| 30 Oct 2026 (new) | Export requests must be signed. The page fetches a signing secret from /portal/keys, then sends x-timestamp and x-signature headers (HMAC-SHA256). | Same JS file: the signing function and the click handler. See A8. | My client needs a small signer and a correct clock. The secret is never logged or committed. |
| 30 Oct 2026 (new) | The export button asks only for page=1, although its label says all meters. | fetch of /portal/export?page=1 in the JS. \[confirmed in code\] | Check how many meters come back. If the export is paged, my service has to loop over pages. |
| 30 Oct 2026 (new) | The Transformers page has no search; it fetches /portal/dts?page=N and works out the page count as the total divided by 20. | Same JS file. \[confirmed in code\] | The DT list has no filter in the UI. With 40 DTs I walk 2 pages. |
| 30 Oct 2026 (new) | The export returns all 403 meters in one response, with hierarchy and location included. | /portal/export?page=1: 200, 231,658 bytes, total 403, meters J100000 to J100402. See A9. | Make the export the main source for meter data. Per-meter calls remain only for the readings. |
| 30 Oct 2026 (new) | The export signature uses plain Unix time as its timestamp. | x-timestamp 1793331360 is 03:36:00 GMT on 30 Oct 2026; the response Date header says 03:35:59 GMT. | My client signs with the current clock, so the machine's clock must be right. How much clock error the portal accepts is untested. |
| 30 Oct 2026 (new) | The export has a field that no other view shows: build (legacy or v2). | Present on all 403 meters: legacy 238, v2 165. The three meters with the odd DT name are all legacy. | Expose it as an optional field and say its meaning is unknown. |
| 30 Oct 2026 (new) | Coordinates are real numbers in the export but strings in the /geo route. | Export geo.lat and geo.lng are floats on all 403 meters; /portal/meters/J100000/geo returned strings. | Always output numbers. |
| 30 Oct 2026 (new) | Unauthenticated requests to `/portal/...` routes get a JSON error, not a redirect. | Incognito: `{"error":"unauthorized","message":"A valid session is required."}` with `content-type: application/json`. No redirect to /login. \[confirmed\] | My client can detect expired sessions by checking for `"error":"unauthorized"` in the JSON body, then re-login. |
| 30 Oct 2026 (new) | Hierarchy codes repeat under different parents, so a code alone does not identify a node above the DT. | 10 division codes but 30 (circle, division) pairs; feeder F-001 sits under both SS-01 and SS-11; 28 feeder codes but 40 distinct feeder paths. Full paths from zone to DT: 40, one per DT. | Build the tree by full path, not by code. |
| 30 Oct 2026 (new) | 22 meters have one blank hierarchy field, and DT-007 has two names. | Blank circle, substation or feeder code or name on 22 meters (list in the 5.2 table); Old Malviya Nagar Xfmr versus Sanganer DT 7. | Fill blanks from other meters on the same DT; take DT names from the DT list. |

## 9. Errors and edge cases

| Input | Response | Notes |
| --- | --- | --- |
| Unknown meter ID | `{"error":"not_found","message":"Meter not found"}`. Tested with `/portal/meters/DOESNOTEXIST/geo`. \[confirmed\] | Clean JSON error, same shape as the unauthorized error |
| Malformed ID | (to test) |  |
| No cookie | `{"error":"unauthorized","message":"A valid session is required."}`. \[confirmed\] | JSON error, no redirect |
| Empty result | Past the last page: 200 with `{"data":[],"total":403,"page":22,"pageSize":20}` (see A4). `q=HPL` and `q=DT-006` return `total: 0`. \[confirmed\] | The empty page keeps the real total; zero-match searches return total 0 |
| Bad date range / format | (to test, after finding the energy parameters) |  |
| Very large range | (to test) |  |
| Special characters / unicode in search | q=L%26 (encoded &) works: 200, 77 matches. Unencoded & and unicode not tested. | Encode & as %26 in my client |

**Are errors consistent?** Yes: the portal uses a JSON object with `error` and `message` fields for all error cases (unauthorized, not found). Success cases that return no data use HTTP 200 with an empty `data` array. \[confirmed\]

## 10. Performance and robustness observations

| Question | Finding |
| --- | --- |
| Typical latency per endpoint | (to measure) |
| Slow endpoints | (to measure) |
| Rate limiting / throttling seen? | (none seen so far; about 8 manual calls in this round) |
| Flaky or intermittent failures | (none seen so far) |
| Behaviour over a long session | (to observe) |
| What I do to stay polite | (to decide: delay between calls and a cap on concurrent requests) |

## 11. Dead ends and mistakes

| What I tried | Why it failed | What I learned |
| --- | --- | --- |
|  |  |  |

**My mistake for the Reflection:** (to fill when it happens)

## 12. Open questions

- ☐ Does `/portal/meters/{id}/energy` accept date parameters (for example `from` and `to`)? Read the page's JS to find out.
- ☑ What happens past the last page of the meter search? Answered: HTTP 200 with empty `data` and the same `total`.
- ☑ Does `q` match the meter ID? Answered: yes, `q=J100005` returns that meter.
- ☑ Is `q` a substring or prefix match, and is it case-insensitive? Answered: **case-insensitive substring** on meterId and serialNo. `q=j100005` → 1, `q=0005` → 11, `q=HPL` → 0 (make not searched), `q=DT-006` → 0 (dtCode not searched).
- ☑ Is a page size accepted (`pageSize=100`)? Answered: **No**, ignored. Server always returns 20. `page=0` silently returns page 1.
- ☑ What is on page 2 of `/portal/dts`? Answered: 20 DTs (DT-021 to DT-040), total 40. Feeder codes wrap: DT-029 reuses F-001. No `q` parameter tested.
- ☐ Where do the upper levels (feeder, substation, subdivision, division, circle, zone) come from? Only a meter's detail view shows them so far.
- ☑ Is there an export or download button (a bulk route)? Answered: yes, Export all meters on the Transformers page; see 4.2 and A8. Not run yet.
- ☐ What does `/portal/...` return with no cookie or a bad cookie: 401, a redirect, or 200 with HTML?
- ☐ What timezone are the timestamps in?
- ☑ Do three-phase meters also report voltY and voltB? Answered: **No.** J100005 (three-phase) returns the same four fields (timestamp, kwh, kvah, voltR) as single-phase meters. No extra voltage phases.
- ☐ Is there a `/portal/meters/{id}` route for the nameplate and hierarchy, so I don't need to decode `__data.json`?
- ☐ Why do J100400 to J100402 sit on DT-007 with a different DT name? (The export shows the same upper hierarchy as J100006; only the DT name differs.) Compare their hierarchy in `__data.json` with J100006 (a normal DT-007 meter).

* ☐ What does `/portal/export?page=1` return: how many meters, is `total` 403? Answered: yes, 403 meters in one response. Still open: does it take other pages or a page size?
* ☐ How long is a signature valid (how old can the timestamp be)? Is the signing secret the same on every call, or new per session?
* ☐ What status and body does the export give when the signature is missing or the timestamp is old? (Only to learn the error format.)

- ☐ What does `build` (legacy or v2) mean? Does it explain the blank fields or the three meters with the odd DT name? (Those three are all legacy.)
- ☐ Is the export identical to the paged list plus detail views for all 403 meters? Only 7 meters were compared so far.
- ☐ How often does the portal data change? Take a second export later and compare, to decide how long a cached copy stays valid.
- ☐ Do readings exist for all 403 meters, and do they all end on 30/06/2026?

## 13. Assumptions and decisions

| Unclear point | Decision I made | Why | Alternative I rejected |
| --- | --- | --- | --- |
|  |  |  |  |

## 14. Mapping: portal to my clean API

| My endpoint | Portal source | Transformation or cleaning needed | Caching idea |
| --- | --- | --- | --- |
| GET /meters | `/portal/`export (one call, all meters); /portal/meters/search as a cross-check | `camelCase names; real numbers; fill blank hierarchy fields from other meters on the same DT and mark them as filled` |  |
| GET /meters/{id} | `/portal/export (nameplate, hierarchy, location); the three per-meter calls only as a fallback` | Same cleaning as above; hierarchy as nodes with name and code; location as numbers |  |
| GET /meters/{id}/consumption | `/portal/meters/{id}/energy` | Strings to numbers, DD/MM/YYYY to ISO 8601 with offset |  |
| GET /hierarchy | /portal/export (hierarchy of every meter); /portal/dts for DT capacity and name | Build the tree by full path from zone to DT (40 paths, one per DT), not by code alone |  |

## Appendix A: Raw samples (redacted)

**A1. Login request/response**

```
(paste here, redact secrets)
```

**A2. Meter details response**

Decoded from the portal's flattened format. The raw response is shorter and uses numbers that point into an array.

```
{
  "meterId": "J100000",
  "detail": {
    "data": [
      { "parameterName": "Meter ID", "parameterValue": "J100000" },
      { "parameterName": "Serial No", "parameterValue": "SE33962" },
      { "parameterName": "Make", "parameterValue": "HPL" },
      { "parameterName": "Phase Type", "parameterValue": "single" },
      { "parameterName": "Installation Status", "parameterValue": "Decommissioned" },
      { "parameterName": "Installation Type", "parameterValue": "Whole Current" }
    ]
  },
  "hierarchy": {
    "Meter ID": "J100000",
    "Installation Status": "Decommissioned",
    "Installation Type": "Whole Current",
    "Zone": "Jaipur Zone 1 (Z-01)",
    "Circle": "Circle 1 (C-01)",
    "Division": "Division 1 (D-01)",
    "Subdivision": "Subdivision 1 (SD-01)",
    "Sub Station": "Substation 1 (SS-01)",
    "Feeder": "Feeder 1 (F-001)",
    "DT": "Malviya Nagar DT 1 (DT-001)"
  }
}
```

Location response from /portal/meters/J100000/geo:

```
{"data":{"latitude":"26.938961002479868","longitude":"75.83095696146852"}}
```

**A3. Consumption response**

Trimmed: the first 3 rows and the last row of the response from /portal/meters/J100000/energy. The rows in between are left out.

```
{
  "data": [
    { "timestamp": "23/06/2026 23:30", "kwh": "48438.74", "kvah": "52313.84", "voltR": "226" },
    { "timestamp": "24/06/2026 00:00", "kwh": "48439.16", "kvah": "52314.29", "voltR": "229" },
    { "timestamp": "24/06/2026 00:30", "kwh": "48439.58", "kvah": "52314.75", "voltR": "220" },
    { "timestamp": "30/06/2026 23:30", "kwh": "48580.79", "kvah": "52467.25", "voltR": "220" }
  ]
}
```

**A4. Error and edge-case responses**

GET /portal/meters/search?q=&page=22 (past the last page): HTTP 200, content-type application/json, 47 bytes.

```
{"data":[],"total":403,"page":22,"pageSize":20}
```

**A5. Meter search response (trimmed)**

The first 2 of 20 meters from /portal/meters/search?q=&page=1.

```
{
  "data": [
    { "meterId": "J100000", "serialNo": "SE33962", "make": "HPL", "phaseType": "single", "installStatus": "Decommissioned", "dtCode": "DT-001" },
    { "meterId": "J100001", "serialNo": "GE84132", "make": "L&T", "phaseType": "single", "installStatus": "Installed", "dtCode": "DT-002" }
  ],
  "total": 403,
  "page": 1,
  "pageSize": 20
}
```

**A5b. Meter search with q (new)**

GET /portal/meters/search?q=J100005&page=1 (165 bytes):

```
{"data":[{"meterId":"J100005","serialNo":"HP63682","make":"Allied","phaseType":"three","installStatus":"Faulty","dtCode":"DT-006"}],"total":1,"page":1,"pageSize":20}
```

GET /portal/meters/search?q=L%26&page=1 (2,528 bytes), first 3 of 20 meters; total is 77:

```
{
  "data": [
    { "meterId": "J100003", "serialNo": "L&84997", "make": "Genus", "phaseType": "single", "installStatus": "Installed", "dtCode": "DT-004" },
    { "meterId": "J100015", "serialNo": "L&34861", "make": "HPL", "phaseType": "three", "installStatus": "Installed", "dtCode": "DT-016" },
    { "meterId": "J100023", "serialNo": "L&31862", "make": "Genus", "phaseType": "single", "installStatus": "Installed", "dtCode": "DT-024" }
  ],
  "total": 77,
  "page": 1,
  "pageSize": 20
}
```

**A6. Transformer list response (trimmed)**

The first 2 of 20 DTs from /portal/dts?page=1.

```
{
  "data": [
    { "code": "DT-001", "name": "Malviya Nagar DT 1", "feederCode": "F-001", "capacityKva": 100 },
    { "code": "DT-002", "name": "Mansarovar DT 2", "feederCode": "F-002", "capacityKva": 63 }
  ],
  "total": 40,
  "page": 1,
  "pageSize": 20
}
```

**A7. Last page of the meter list (new)**

GET /portal/meters/search?q=&page=21 (418 bytes). The last three meters are all on DT-007, which breaks the repeating pattern:

```
{"data":[{"meterId":"J100400","serialNo":"GN31592","make":"Genus","phaseType":"three","installStatus":"Installed","dtCode":"DT-007"},{"meterId":"J100401","serialNo":"GN61501","make":"Genus","phaseType":"three","installStatus":"Installed","dtCode":"DT-007"},{"meterId":"J100402","serialNo":"GN11062","make":"Genus","phaseType":"three","installStatus":"Installed","dtCode":"DT-007"}],"total":403,"page":21,"pageSize":20}
```

**A8. How the export request is signed (new, read from the page JS)**

No secret values here. This is the recipe the page's code follows:

```
timestamp = current Unix time in whole seconds, as text
message   = method + "\n" + path + "\n" + query + "\n" + timestamp
signature = lowercase hex of HMAC-SHA256(key = signingSecret, data = message)

for the export call:
message = "GET\n/portal/export\npage=1\n<timestamp>"
signingSecret comes from GET /portal/keys, field data.signingSecret
request: GET /portal/export?page=1
headers: x-timestamp: <timestamp>   x-signature: <signature>
```

**A9. Export response (new, trimmed)**

GET /portal/export?page=1 with headers x-timestamp: 1793331360 and x-signature: `<REDACTED>`. HTTP 200, `application/json`, 231,658 bytes, no content-encoding header seen. Shape: `{"data":[ ...403 meters... ],"total":403}`. Two meters shown: the first, and the first of the three odd ones on DT-007 (note the DT name).

```
{
  "meterId": "J100000", "serialNo": "SE33962", "make": "HPL", "phaseType": "single",
  "installStatus": "Decommissioned", "installType": "Whole Current", "build": "legacy", "dtCode": "DT-001",
  "hierarchy": {
    "zone": {"name": "Jaipur Zone 1", "code": "Z-01"},  "circle": {"name": "Circle 1", "code": "C-01"},
    "division": {"name": "Division 1", "code": "D-01"},  "subdivision": {"name": "Subdivision 1", "code": "SD-01"},
    "substation": {"name": "Substation 1", "code": "SS-01"},  "feeder": {"name": "Feeder 1", "code": "F-001"},
    "dt": {"name": "Malviya Nagar DT 1", "code": "DT-001"}
  },
  "geo": {"lat": 26.938961002479868, "lng": 75.83095696146852}
}

{
  "meterId": "J100400", "serialNo": "GN31592", "make": "Genus", "phaseType": "three",
  "installStatus": "Installed", "installType": "CT Operated", "build": "legacy", "dtCode": "DT-007",
  "hierarchy": {
    "zone": {"name": "Jaipur Zone 1", "code": "Z-01"},  "circle": {"name": "Circle 1", "code": "C-01"},
    "division": {"name": "Division 7", "code": "D-07"},  "subdivision": {"name": "Subdivision 7", "code": "SD-07"},
    "substation": {"name": "Substation 7", "code": "SS-07"},  "feeder": {"name": "Feeder 7", "code": "F-007"},
    "dt": {"name": "Old Malviya Nagar Xfmr", "code": "DT-007"}
  },
  "geo": {"lat": 26.882703003792653, "lng": 75.74015781362327}
}
```

## Appendix B: Timeline log

Times are the server's Date header, in GMT (India time is 5 hours 30 minutes ahead).

| Time (GMT) | What I did | What I saw |
| --- | --- | --- |
| 03:13:41 | Opened the Transformers page and the Meters page; checked headers in DevTools | /portal/dts?page=1: 200, 1,680 bytes, no cache headers. Static chunk nodes/4.2Bgc2kUI.js: immutable, cached for a year |
| 03:23:59 | Searched q=J100005 | 1 meter (three-phase, Faulty, DT-006) |
| 03:25:33 | Searched q=L%26 | 77 meters, matches on serial number only; make L&T not matched |
| 03:26:11 | Requested page=21 | 3 meters, J100400 to J100402, all on DT-007 (pattern break) |
| 03:26:52 | Requested page=22 | HTTP 200, empty data, total still 403 |
| 03:35:59 | Clicked Export all meters on the Transformers page; captured the calls to /portal/keys and /portal/export?page=1 | keys: 200, 61 bytes (secret not recorded here). export: 200, 231,658 bytes, 403 meters, total 403. |
