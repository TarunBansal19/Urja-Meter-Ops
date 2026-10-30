import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatasetService } from '../src/store/dataset.js';
import { sampleRawMeters, sampleDts } from './fixtures/sample-dataset.js';
import { NotFoundError } from '../src/errors.js';

describe('DatasetService', () => {
  it('loads, cleans, indexes dataset and computes stats', async () => {
    let exportCalls = 0;
    let dtsCalls = 0;

    const mockApi = {
      async fetchExport() {
        exportCalls++;
        return sampleRawMeters;
      },
      async fetchDts() {
        dtsCalls++;
        return sampleDts;
      },
      async fetchEnergy(meterId) {
        return [
          { timestamp: '30/06/2026 23:00', kwh: '100.0', kvah: '110.0', voltR: '230' },
          { timestamp: '30/06/2026 23:30', kwh: '100.5', kvah: '110.6', voltR: '231' },
        ];
      },
    };

    const datasetService = new DatasetService({
      api: mockApi,
      datasetTtlMs: 60000,
      readingsTtlMs: 30000,
    });

    const ds1 = await datasetService.getDataset();
    assert.equal(ds1.meters.length, 8);
    assert.equal(ds1.transformers.length, 5);
    assert.equal(exportCalls, 1);
    assert.equal(dtsCalls, 1);

    // Verify fast lookup maps
    assert.ok(ds1.meterById.has('J100001'));
    assert.ok(ds1.transformersByCode.has('DT-001'));

    // Verify stats
    assert.equal(ds1.stats.totals.meters, 8);
    assert.equal(ds1.stats.totals.transformers, 5);
    assert.ok(ds1.stats.byMake['HPL'] >= 2);

    // Second call should hit cache without calling API again
    const ds2 = await datasetService.getDataset();
    assert.equal(exportCalls, 1);
    assert.equal(dtsCalls, 1);
    assert.equal(ds2.meta.stale, false);

    // Invalidation
    datasetService.invalidate();
    await datasetService.getDataset();
    assert.equal(exportCalls, 2);

    // Energy readings for existing meter
    const energy = await datasetService.getEnergyReadings('J100001');
    assert.equal(energy.readings.length, 2);

    // Energy readings for unknown meter throws NotFoundError without calling API
    await assert.rejects(
      async () => datasetService.getEnergyReadings('UNKNOWN_METER'),
      (err) => err instanceof NotFoundError
    );
  });
});
