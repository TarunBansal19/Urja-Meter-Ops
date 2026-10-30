import { getConfig } from '../src/config.js';
import { PortalClient } from '../src/portal/client.js';
import { PortalApi } from '../src/portal/api.js';
import { signExport } from '../src/portal/signing.js';

async function main() {
  console.log('=== URJA PORTAL LIVE PROBE (READ-ONLY) ===\n');
  const config = getConfig();

  const client = new PortalClient({
    baseUrl: config.portalBaseUrl,
    email: config.portalEmail,
    password: config.portalPassword,
  });
  const api = new PortalApi(client);

  console.log('1. Probing unauthorized response status on /portal/keys without cookie:');
  const unauthRes = await fetch(`${config.portalBaseUrl}/portal/keys`, {
    headers: { accept: 'application/json' },
  });
  const unauthBody = await unauthRes.json().catch(() => null);
  console.log(`   HTTP Status: ${unauthRes.status}`);
  console.log(`   Response Body:`, JSON.stringify(unauthBody));

  console.log('\n2. Logging in for authenticated probes:');
  await client.login();
  const secretInfo = await api.getSigningSecret();
  console.log(`   Signing secret acquired.`);

  console.log('\n3. Probing /portal/meters/J100000/energy date parameter handling:');
  const baseEnergy = await api.fetchEnergy('J100000');
  console.log(`   Base energy readings count: ${baseEnergy.length}`);

  // Test various query param styles
  const testQueries = [
    { from: '2026-06-25', to: '2026-06-30' },
    { from: '25/06/2026', to: '30/06/2026' },
    { startDate: '2026-06-25' },
  ];

  let anyParamHonored = false;
  for (const q of testQueries) {
    const qStr = new URLSearchParams(q).toString();
    const { data } = await client.getJson(`/portal/meters/J100000/energy?${qStr}`);
    const rows = data?.data || [];
    console.log(`   Query ?${qStr} -> returned ${rows.length} rows`);
    if (rows.length !== baseEnergy.length) {
      anyParamHonored = true;
      console.log(`   -> Parameter appeared to affect response!`);
    }
  }
  if (!anyParamHonored) {
    console.log('   -> Findings: /energy ignores date query parameters. Filtering must be performed locally.');
  }

  console.log('\n4. Probing /portal/export pagination behavior:');
  const nowWithSkew = Date.now() + secretInfo.skewMs;
  const ts = Math.floor(nowWithSkew / 1000);
  const sigPage2 = signExport({
    secret: secretInfo.secret,
    method: 'GET',
    path: '/portal/export',
    query: 'page=2',
    timestamp: ts,
  });

  const { data: page2Data, response: page2Res } = await client.getJson('/portal/export', {
    query: { page: 2 },
    headers: sigPage2.headers,
  });
  console.log(`   Page 2 status: ${page2Res.status}`);
  console.log(`   Page 2 total: ${page2Data?.total}, data length: ${page2Data?.data?.length}`);

  console.log('\n=== PROBE COMPLETE ===');
}

main().catch((err) => {
  console.error('\n❌ Probe failed:', err);
  process.exit(1);
});
