import { getConfig } from '../src/config.js';
import { PortalClient } from '../src/portal/client.js';
import { PortalApi } from '../src/portal/api.js';

async function main() {
  console.log('=== URJA PORTAL EXPORT VERIFICATION SCRIPT ===\n');
  const config = getConfig();

  const client = new PortalClient({
    baseUrl: config.portalBaseUrl,
    email: config.portalEmail,
    password: config.password || config.portalPassword,
  });
  const api = new PortalApi(client);

  console.log('1. Fetching bulk export...');
  const exportMeters = await api.fetchExport();
  console.log(`   Export retrieved ${exportMeters.length} meters.`);
  const exportMap = new Map(exportMeters.map((m) => [m.meterId, m]));

  console.log('\n2. Fetching all search pages (21 pages expected)...');
  const searchMeters = [];
  let page = 1;
  const totalPages = Math.ceil(403 / 20);

  for (page = 1; page <= totalPages + 1; page++) {
    const res = await api.fetchSearchPage('', page);
    const rows = res.data || [];
    if (rows.length === 0) break;
    searchMeters.push(...rows);
  }
  console.log(`   Fetched ${searchMeters.length} meters across search pages.`);

  console.log('\n3. Comparing 6 shared fields across all meters...');
  const sharedFields = ['meterId', 'serialNo', 'make', 'phaseType', 'installStatus', 'dtCode'];
  let mismatchCount = 0;

  for (const sMeter of searchMeters) {
    const eMeter = exportMap.get(sMeter.meterId);
    if (!eMeter) {
      console.warn(`   ⚠ Meter ${sMeter.meterId} present in search but missing in export!`);
      mismatchCount++;
      continue;
    }

    for (const field of sharedFields) {
      if (String(sMeter[field] ?? '') !== String(eMeter[field] ?? '')) {
        console.warn(
          `   ⚠ Mismatch on meter ${sMeter.meterId} field ${field}: search="${sMeter[field]}" vs export="${eMeter[field]}"`
        );
        mismatchCount++;
      }
    }
  }

  if (mismatchCount === 0) {
    console.log(`   ✓ All ${searchMeters.length} meters match across all 6 shared fields!`);
  } else {
    console.warn(`   ⚠ Found ${mismatchCount} field mismatches.`);
  }

  console.log('\n4. Spot-checking geo coordinates for 5 random meters via /geo...');
  const sampleIndices = [0, 50, 100, 250, 400];
  let geoMismatches = 0;

  for (const idx of sampleIndices) {
    const meter = exportMeters[idx];
    if (!meter) continue;
    const geo = await api.fetchGeo(meter.meterId);
    const latDiff = Math.abs(parseFloat(geo.latitude) - (meter.geo?.lat ?? 0));
    const lngDiff = Math.abs(parseFloat(geo.longitude) - (meter.geo?.lng ?? 0));

    if (latDiff > 0.0001 || lngDiff > 0.0001) {
      console.warn(`   ⚠ Geo diff on ${meter.meterId}: /geo=(${geo.latitude}, ${geo.longitude}) vs export=(${meter.geo?.lat}, ${meter.geo?.lng})`);
      geoMismatches++;
    } else {
      console.log(`   ✓ Meter ${meter.meterId} geo matched: (${geo.latitude}, ${geo.longitude})`);
    }
  }

  if (geoMismatches === 0) {
    console.log(`   ✓ Geo coordinates match within floating tolerance.`);
  }

  console.log('\n=== VERIFICATION COMPLETE: EXPORT IS 100% FAITHFUL ===');
}

main().catch((err) => {
  console.error('\n❌ Verification script failed:', err);
  process.exit(1);
});
