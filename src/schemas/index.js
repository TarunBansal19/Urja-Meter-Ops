export const ErrorSchema = {
  $id: 'Error',
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'Machine-readable error code' },
        message: { type: 'string', description: 'Human-readable error description' },
        details: { description: 'Additional structured error details', nullable: true },
      },
    },
  },
};

export const MetaSchema = {
  $id: 'Meta',
  type: 'object',
  properties: {
    fetchedAt: { type: 'string', format: 'date-time', description: 'Timestamp when upstream data was fetched' },
    ageMs: { type: 'number', description: 'Age of cached data in milliseconds' },
    stale: { type: 'boolean', description: 'True if upstream refresh failed and serving stale cache' },
  },
};

export const PaginationSchema = {
  $id: 'Pagination',
  type: 'object',
  required: ['page', 'pageSize', 'total', 'totalPages'],
  properties: {
    page: { type: 'integer', description: 'Current page (1-based)' },
    pageSize: { type: 'integer', description: 'Number of items per page' },
    total: { type: 'integer', description: 'Total number of items matching filters' },
    totalPages: { type: 'integer', description: 'Total number of pages' },
  },
};

export const HierarchyLevelSchema = {
  $id: 'HierarchyLevel',
  type: 'object',
  required: ['code', 'name', 'inferred'],
  properties: {
    code: { type: 'string', description: 'Node code at this level' },
    name: { type: 'string', description: 'Node name at this level' },
    inferred: { type: 'boolean', description: 'True if filled/inferred from peer meters on the same DT' },
  },
};

export const MeterSchema = {
  $id: 'Meter',
  type: 'object',
  required: ['meterId', 'serialNo', 'make', 'phaseType', 'installStatus', 'installType', 'build', 'dtCode', 'hierarchyNodeId'],
  properties: {
    meterId: { type: 'string', example: 'J100000', description: 'Authoritative meter identifier' },
    serialNo: { type: 'string', example: 'SE33962', description: 'Manufacturer serial number' },
    make: { type: 'string', example: 'HPL', description: 'Meter manufacturer brand' },
    phaseType: { type: 'string', enum: ['single', 'three'], example: 'single', description: 'Electrical phase configuration' },
    installStatus: { type: 'string', example: 'Installed', description: 'Operational status (Installed, Faulty, Decommissioned)' },
    installType: { type: 'string', example: 'Whole Current', description: 'Whole Current or CT Operated' },
    build: { type: 'string', example: 'legacy', description: 'Portal hardware build tag (legacy or v2)' },
    dtCode: { type: 'string', example: 'DT-001', description: 'Distribution transformer code' },
    location: {
      type: 'object',
      nullable: true,
      properties: {
        latitude: { type: 'number', example: 26.938961 },
        longitude: { type: 'number', example: 75.830956 },
      },
    },
    distanceKm: { type: 'number', nullable: true, description: 'Distance in kilometers when querying with near parameter' },
    hierarchy: {
      type: 'object',
      properties: {
        zone: { $ref: 'HierarchyLevel#' },
        circle: { $ref: 'HierarchyLevel#' },
        division: { $ref: 'HierarchyLevel#' },
        subdivision: { $ref: 'HierarchyLevel#' },
        substation: { $ref: 'HierarchyLevel#' },
        feeder: { $ref: 'HierarchyLevel#' },
        dt: { $ref: 'HierarchyLevel#' },
      },
    },
    hierarchyNodeId: {
      type: 'string',
      example: 'Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001',
      description: 'Canonical colon-delimited path from zone down to DT',
    },
    dataQuality: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            required: ['code'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              field: { type: 'string' },
              value: {},
              source: { type: 'string' },
              canonical: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

export const TransformerSchema = {
  $id: 'Transformer',
  type: 'object',
  required: ['code', 'name', 'aliases', 'feederCode', 'capacityKva', 'meterCount', 'hierarchyNodeId'],
  properties: {
    code: { type: 'string', example: 'DT-001', description: 'Distribution transformer code' },
    name: { type: 'string', example: 'Malviya Nagar DT 1', description: 'Canonical DT name from /portal/dts' },
    aliases: { type: 'array', items: { type: 'string' }, description: 'Alternative names observed in export records' },
    feederCode: { type: 'string', nullable: true, example: 'F-001', description: 'Parent feeder code' },
    capacityKva: { type: 'number', nullable: true, example: 100, description: 'Rated transformer capacity in kVA' },
    meterCount: { type: 'integer', example: 10, description: 'Number of connected meters' },
    hierarchyNodeId: { type: 'string', example: 'Z-01:C-01:D-01:SD-01:SS-01:F-001:DT-001' },
  },
};

export const HierarchyNodeSchema = {
  $id: 'HierarchyNode',
  type: 'object',
  required: ['id', 'level', 'code', 'name', 'meterCount', 'children'],
  properties: {
    id: { type: 'string', description: 'Full path of codes from zone down to this node joined by colon' },
    level: { type: 'string', enum: ['zone', 'circle', 'division', 'subdivision', 'substation', 'feeder', 'dt'] },
    code: { type: 'string' },
    name: { type: 'string' },
    meterCount: { type: 'integer' },
    aliases: { type: 'array', items: { type: 'string' } },
    feederCode: { type: 'string', nullable: true },
    capacityKva: { type: 'number', nullable: true },
    children: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
  },
};

export const ReadingSchema = {
  $id: 'Reading',
  type: 'object',
  required: ['timestamp', 'kwh', 'kvah', 'voltageR'],
  properties: {
    timestamp: {
      type: 'string',
      format: 'date-time',
      example: '2026-06-30T23:30:00+05:30',
      description: 'ISO 8601 timestamp with Asia/Kolkata (+05:30) offset',
    },
    kwh: { type: 'number', nullable: true, example: 48580.79, description: 'Cumulative active energy register (kWh assumed)' },
    kvah: { type: 'number', nullable: true, example: 52467.25, description: 'Cumulative apparent energy register (kVAh assumed)' },
    voltageR: { type: 'number', nullable: true, example: 220, description: 'R-phase RMS voltage in Volts (assumed)' },
    kwhDelta: { type: 'number', nullable: true, example: 0.5, description: 'Interval active consumption (kWh) since previous 30-min reading' },
    kvahDelta: { type: 'number', nullable: true, example: 0.6, description: 'Interval apparent consumption (kVAh) since previous 30-min reading' },
  },
};

export const allSchemas = [
  ErrorSchema,
  MetaSchema,
  PaginationSchema,
  HierarchyLevelSchema,
  MeterSchema,
  TransformerSchema,
  HierarchyNodeSchema,
  ReadingSchema,
];
