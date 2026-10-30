import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExportRow } from '../src/domain/meters.js';
import {
  buildHierarchy,
  findModalValue,
  pruneTreeDepth,
} from '../src/domain/hierarchy.js';
import { sampleRawMeters, sampleDts } from './fixtures/sample-dataset.js';

describe('domain/hierarchy', () => {
  it('findModalValue finds most frequent non-blank string', () => {
    assert.equal(findModalValue(['A', 'B', 'A', '', null]), 'A');
    assert.equal(findModalValue([null, undefined, '']), null);
  });

  it('cleans hierarchy, fills blanks from modal DT peers, and builds report', () => {
    const rawMeters = sampleRawMeters.map(normalizeExportRow);
    const { meters, roots, nodesById, transformers, report } = buildHierarchy(
      rawMeters,
      sampleDts
    );

    // 1. J100002 had blank circle.code -> filled with C-01
    const m2 = meters.find((m) => m.meterId === 'J100002');
    assert.equal(m2.hierarchy.circle.code, 'C-01');
    assert.equal(m2.hierarchy.circle.inferred, true);
    assert.ok(
      m2.dataQuality.issues.some(
        (i) => i.code === 'hierarchy_field_filled' && i.field === 'circle.code' && i.value === 'C-01'
      )
    );

    // 2. J100003 had blank feeder.name -> filled with Feeder 1
    const m3 = meters.find((m) => m.meterId === 'J100003');
    assert.equal(m3.hierarchy.feeder.name, 'Feeder 1');
    assert.equal(m3.hierarchy.feeder.inferred, true);

    // 3. J100008 had DT name alias 'Old Malviya Nagar Xfmr' vs canonical 'Sanganer DT 7'
    const m8 = meters.find((m) => m.meterId === 'J100008');
    assert.ok(
      m8.dataQuality.issues.some(
        (i) => i.code === 'dt_name_alias' && i.value === 'Old Malviya Nagar Xfmr'
      )
    );

    // Check DT-007 aliases in transformers list
    const dt7 = transformers.find((t) => t.code === 'DT-007');
    assert.ok(dt7);
    assert.equal(dt7.name, 'Sanganer DT 7');
    assert.deepEqual(dt7.aliases, ['Old Malviya Nagar Xfmr']);

    // 4. J100006 on DT-004 had blank circle code with no peers -> unknown-circle
    const m6 = meters.find((m) => m.meterId === 'J100006');
    assert.equal(m6.hierarchy.circle.code, 'unknown-circle');
    assert.equal(m6.hierarchy.circle.name, 'Unknown circle');

    // 5. Code reuse: F-001 under SS-01 vs SS-02 should produce distinct nodes in nodesById
    const f1_ss1 = nodesById.get('Z-01:C-01:D-01:SD-01:SS-01:F-001');
    const f1_ss2 = nodesById.get('Z-01:C-01:D-01:SD-01:SS-02:F-001');
    assert.ok(f1_ss1, 'Feeder F-001 under SS-01 must exist');
    assert.ok(f1_ss2, 'Feeder F-001 under SS-02 must exist');
    assert.notEqual(f1_ss1.id, f1_ss2.id);

    // 6. Tree root meter counts
    assert.ok(roots.length > 0);
    const zoneRoot = roots.find((r) => r.code === 'Z-01');
    assert.ok(zoneRoot);
    assert.equal(zoneRoot.meterCount, 8);

    // 7. Data quality report summary
    assert.ok(report.summary.filledFieldsCount >= 2);
    assert.ok(report.summary.dtAliasesCount >= 1);
  });

  it('pruneTreeDepth correctly truncates hierarchy tree at depth limit', () => {
    const rawMeters = sampleRawMeters.map(normalizeExportRow);
    const { roots } = buildHierarchy(rawMeters, sampleDts);

    const pruned1 = pruneTreeDepth(roots, 1);
    assert.equal(pruned1.length, roots.length);
    assert.equal(pruned1[0].children.length, 0);

    const pruned2 = pruneTreeDepth(roots, 2);
    assert.ok(pruned2[0].children.length > 0);
    assert.equal(pruned2[0].children[0].children.length, 0);
  });
});
