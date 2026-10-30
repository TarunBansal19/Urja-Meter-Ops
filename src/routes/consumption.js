import { normalizeEnergy, filterReadingsRange, summarizeReadings } from '../domain/readings.js';

export async function consumptionRoutes(fastify, options) {
  const { datasetService, config } = options;
  const tzOffset = config.portalTzOffset || '+05:30';

  fastify.get(
    '/meters/:meterId/consumption',
    {
      schema: {
        description:
          'Get 30-minute interval energy readings and consumption summary for a meter within a time range [from, to). Timestamps and units are explicitly documented.',
        tags: ['Readings'],
        params: {
          type: 'object',
          required: ['meterId'],
          properties: {
            meterId: { type: 'string', example: 'J100000', description: 'Authoritative meter ID' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Inclusive start instant (YYYY-MM-DD or full ISO 8601 with offset)',
              example: '2026-06-25',
            },
            to: {
              type: 'string',
              description: 'Exclusive end instant (YYYY-MM-DD or full ISO 8601 with offset)',
              example: '2026-07-01',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['data', 'meta'],
            properties: {
              data: {
                type: 'object',
                required: ['meterId', 'intervalMinutes', 'timezone', 'readings', 'summary'],
                properties: {
                  meterId: { type: 'string' },
                  intervalMinutes: { type: 'integer', example: 30 },
                  timezone: { type: 'string', example: '+05:30' },
                  readings: { type: 'array', items: { $ref: 'Reading#' } },
                  summary: {
                    type: 'object',
                    required: ['kwhConsumed', 'kvahConsumed', 'voltageR'],
                    properties: {
                      kwhConsumed: { type: 'number', example: 142.05, description: 'Net active consumption in kWh within range' },
                      kvahConsumed: { type: 'number', example: 153.41, description: 'Net apparent consumption in kVAh within range' },
                      voltageR: {
                        type: 'object',
                        properties: {
                          min: { type: 'number', nullable: true },
                          max: { type: 'number', nullable: true },
                          avg: { type: 'number', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  availableFrom: { type: 'string', nullable: true },
                  latestReadingAt: { type: 'string', nullable: true },
                  rowCount: { type: 'integer' },
                  skippedRows: { type: 'integer' },
                  gaps: { type: 'integer' },
                  decreases: { type: 'integer' },
                  units: { type: 'object', additionalProperties: true },
                  fetchedAt: { type: 'string' },
                  ageMs: { type: 'number' },
                  stale: { type: 'boolean' },
                },
              },
            },
          },
          400: { $ref: 'Error#' },
          404: { $ref: 'Error#' },
          503: { $ref: 'Error#' },
        },
      },
    },
    async (request) => {
      const { meterId } = request.params;
      const { from, to } = request.query;

      const energyResult = await datasetService.getEnergyReadings(meterId);
      const normalized = normalizeEnergy(energyResult.readings, { tzOffset });

      const slicedReadings = filterReadingsRange(normalized.readings, { from, to }, tzOffset);
      const { summary, gaps, decreases } = summarizeReadings(slicedReadings);

      return {
        data: {
          meterId,
          intervalMinutes: 30,
          timezone: tzOffset,
          readings: slicedReadings,
          summary,
        },
        meta: {
          availableFrom: normalized.meta.availableFrom,
          latestReadingAt: normalized.meta.latestReadingAt,
          rowCount: slicedReadings.length,
          skippedRows: normalized.meta.skippedRows,
          gaps,
          decreases,
          units: {
            kwh: 'cumulative kWh register (assumed)',
            kvah: 'cumulative kVAh register (assumed)',
            voltageR: 'volts RMS (assumed)',
            kwhDelta: 'interval active consumption in kWh (assumed)',
            kvahDelta: 'interval apparent consumption in kVAh (assumed)',
          },
          fetchedAt: energyResult.meta.fetchedAt,
          ageMs: energyResult.meta.ageMs,
          stale: energyResult.meta.stale,
        },
      };
    }
  );
}
