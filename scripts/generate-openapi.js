import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, '../openapi.json');

/**
 * Deterministically sort object keys for stable diff-friendly JSON output.
 */
function sortKeys(val) {
  if (Array.isArray(val)) {
    return val.map(sortKeys);
  }
  if (val !== null && typeof val === 'object') {
    const sorted = {};
    for (const key of Object.keys(val).sort()) {
      sorted[key] = sortKeys(val[key]);
    }
    return sorted;
  }
  return val;
}

export async function generateOpenApiSpec() {
  const dummyApi = {
    fetchExport: async () => [],
    fetchDts: async () => [],
    fetchEnergy: async () => [],
  };

  const app = await buildApp({
    config: {
      host: 'localhost',
      port: 3000,
      logLevel: 'silent',
      portalTzOffset: '+05:30',
    },
    portalApi: dummyApi,
    disableLogger: true,
  });

  await app.ready();
  const spec = app.swagger();
  await app.close();

  const sortedSpec = sortKeys(spec);
  return JSON.stringify(sortedSpec, null, 2) + '\n';
}

async function main() {
  const json = await generateOpenApiSpec();
  await fs.writeFile(outputPath, json, 'utf8');
  console.log(`✓ Wrote OpenAPI specification to ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Failed to generate openapi.json:', err);
    process.exit(1);
  });
}
