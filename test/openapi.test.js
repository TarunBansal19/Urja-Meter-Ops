import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOpenApiSpec } from '../scripts/generate-openapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const committedSpecPath = path.resolve(__dirname, '../openapi.json');

describe('openapi specification', () => {
  it('committed openapi.json matches current generated spec', async () => {
    let committed = null;
    try {
      committed = await fs.readFile(committedSpecPath, 'utf8');
    } catch {
      assert.fail('openapi.json is missing in repository root. Run "npm run openapi" to generate it.');
    }

    const generated = await generateOpenApiSpec();
    assert.equal(
      committed,
      generated,
      'committed openapi.json differs from generator output. Please run "npm run openapi" and commit the changes.'
    );
  });
});
