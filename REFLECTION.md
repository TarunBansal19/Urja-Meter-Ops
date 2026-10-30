# Reflection — Urja Meter Ops API Assignment

## 1. What assumptions did you make?

1. **Timezone:** Timestamps emitted by `/portal/meters/{id}/energy` (e.g. `30/06/2026 23:30`) lack timezone metadata. Given the deployment context (Jaipur, Rajasthan, India), we assume Indian Standard Time (`Asia/Kolkata`, `UTC+05:30`). Because India does not observe Daylight Saving Time, this fixed offset is consistent throughout the year. The offset is made configurable via `PORTAL_TZ_OFFSET`.
2. **Units of Measurement:** The portal outputs numbers without unit labels. We assume:
   - `kwh`: cumulative active energy register in kilowatt-hours (kWh)
   - `kvah`: cumulative apparent energy register in kilovolt-ampere-hours (kVAh)
   - `voltR`: R-phase RMS AC voltage in Volts (V)
   - `capacityKva`: transformer rating in kilovolt-amperes (kVA)
3. **Primary Data Source Completeness:** The signed `/portal/export` endpoint returns all 403 meters when `page=1` (`data.length === total`). Our verification script confirmed that all 403 meters match the 21 paged search results exactly across all shared fields.
4. **Hierarchy Assignment Integrity:** Meters `J100400`–`J100402` sit on `DT-007` despite sequential numeric patterns suggesting `DT-001`..`DT-003`. We assume the portal's `dtCode` is the source of truth and must never be synthesized or overridden from meter IDs.
5. **Data Freshness:** The historical meter readings terminate on `30/06/2026 23:30`, indicating the portal dataset is largely static. Therefore, an in-memory caching policy with a 1-hour TTL for the inventory dataset and 15-minute TTL for meter readings is sufficient, backed by stale-if-error fallback and an explicit `/admin/refresh` hook.

---

## 2. What was the most difficult part and how did you get unstuck?

TODO(human): Write your personal reflections on the most difficult part and how you solved it.

*Candidate facts to consider:*
- Reverse-engineering the SvelteKit authentication flow where a 200 HTTP response contains a redirect body (`{"type":"redirect","status":303,"location":"/meters"}`), which fails standard status-code based redirect handlers.
- Discovering the `/portal/export` endpoint and its HMAC-SHA256 signature scheme hidden in client-side JS bundles rather than visible in standard UI navigation.
- Disambiguating duplicated hierarchy codes (e.g. feeder `F-001` or division `D-01` reused under completely distinct parent nodes), which broke naive single-code tree keys and required colon-delimited path identifiers (`Z-01:C-01:...:DT-001`).

---

## 3. What would you improve with another day?

TODO(human): Add your prioritized future improvements.

*Candidate facts to consider:*
- Add persistent storage (SQLite/PostgreSQL) so the service starts instantly on reboot without re-fetching from upstream.
- Implement background change-detection polling on `/portal/export` to emit webhooks or delta events when meters or DT allocations change.
- Introduce API authentication (Bearer tokens / API keys) and rate limiting on our public interface.
- Implement a spatial index (e.g., R-tree or geohash) for geospatial `near` queries if scaling beyond 10,000 meters.

---

## 4. What mistake did you make?

TODO(human): Mention any mistake made during investigation or implementation and how it was diagnosed.

*Candidate facts to consider:*
- Initially assuming that `/portal/export` supported standard multi-page pagination with a small page size, before discovering that `page=1` returned the entire dataset of 403 meters at once.
- Initially assuming that `/portal/meters/search` filtered by brand (`make`) or transformer (`dtCode`), before testing revealed `q` only performs substring matching on `meterId` and `serialNo`.
- Overlooking that `login()` requests could experience transient 503 errors during cold start, requiring retries with exponential backoff on authentication requests.

---

## 5. What would you criticise in your own submission?

TODO(human): Provide your self-critique.

*Candidate facts to consider:*
- In-memory dataset storage: While ideal and simple for 403 meters, it would consume excessive RAM if the utility scale grew to 1,000,000 meters.
- Lack of authentication on our API: We explicitly left our API unauthenticated to keep it simple for local review, but production deployments require API token enforcement.
- Fake portal fidelity: The fake portal test suite encodes our model of how the portal behaves; live schema shifts on the legacy server require recurring contract/smoke tests.
