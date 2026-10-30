import { getConfig } from '../src/config.js';
import { PortalClient } from '../src/portal/client.js';
import { PortalApi } from '../src/portal/api.js';

async function main() {
  console.log('=== URJA PORTAL LIVE SMOKE TEST ===');
  const config = getConfig();

  const client = new PortalClient({
    baseUrl: config.portalBaseUrl,
    email: config.portalEmail,
    password: config.portalPassword,
    timeoutMs: config.portalTimeoutMs,
    maxConcurrency: config.portalMaxConcurrency,
  });

  const api = new PortalApi(client);

  console.log('1. Attempting login...');
  await client.login();
  console.log('   ✓ Logged in successfully. Captured session cookies.');

  console.log('2. Fetching signing secret & clock skew...');
  const secretInfo = await api.getSigningSecret();
  console.log(`   ✓ Secret obtained (${secretInfo.secret.length} chars). Estimated clock skew: ${secretInfo.skewMs}ms.`);

  console.log('3. Fetching bulk export (/portal/export)...');
  const meters = await api.fetchExport();
  console.log(`   ✓ Export returned ${meters.length} meters.`);
  if (meters.length !== 403) {
    console.warn(`   ⚠ Warning: expected 403 meters, got ${meters.length}`);
  } else {
    console.log('   ✓ Meter count matches expected baseline (403 meters).');
  }

  console.log('4. Fetching distribution transformers (/portal/dts)...');
  const dts = await api.fetchDts();
  console.log(`   ✓ Returned ${dts.length} DTs.`);
  if (dts.length !== 40) {
    console.warn(`   ⚠ Warning: expected 40 DTs, got ${dts.length}`);
  } else {
    console.log('   ✓ DT count matches expected baseline (40 DTs).');
  }

  console.log('5. Running normalization and data quality diagnostics...');
  const { normalizeExportRow } = await import('../src/domain/meters.js');
  const { buildHierarchy } = await import('../src/domain/hierarchy.js');
  const normalizedMeters = meters.map(normalizeExportRow);
  const { report, transformers } = buildHierarchy(normalizedMeters, dts);

  console.log(`   ✓ Cleaned and filled ${report.summary.filledFieldsCount} missing hierarchy fields.`);
  if (report.summary.filledFieldsCount !== 22) {
    console.warn(`   ⚠ Warning: expected 22 filled fields, got ${report.summary.filledFieldsCount}`);
  }

  console.log(`   ✓ Identified ${report.summary.dtAliasesCount} DT name alias instances across meters.`);
  const dt7 = transformers.find((t) => t.code === 'DT-007');
  if (dt7 && dt7.aliases.length > 0) {
    console.log(`   ✓ DT-007 canonical name: "${dt7.name}", aliases: ${JSON.stringify(dt7.aliases)}`);
  }

  console.log('6. Fetching sample energy readings for meter J100000...');
  const energy = await api.fetchEnergy('J100000');
  console.log(`   ✓ Returned ${energy.length} readings for J100000.`);
  if (energy.length > 0) {
    console.log(`   Sample reading:`, energy[0]);
    console.log(`   Latest reading:`, energy[energy.length - 1]);
  }

  console.log('\n=== SMOKE TEST PASSED ===');
}

main().catch((err) => {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
});
