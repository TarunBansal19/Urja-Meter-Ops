export const sampleDts = [
  { code: 'DT-001', name: 'Malviya Nagar DT 1', feederCode: 'F-001', capacityKva: 100 },
  { code: 'DT-002', name: 'Vaishali DT 2', feederCode: 'F-001', capacityKva: 160 },
  { code: 'DT-003', name: 'Mansarovar DT 3', feederCode: 'F-001', capacityKva: 200 },
  { code: 'DT-004', name: 'Isolated DT 4', feederCode: 'F-099', capacityKva: 63 },
  { code: 'DT-007', name: 'Sanganer DT 7', feederCode: 'F-007', capacityKva: 250 },
];

export const sampleRawMeters = [
  // DT-001: J100001 (complete), J100002 (blank circle.code), J100003 (blank feeder.name)
  {
    meterId: 'J100001',
    serialNo: 'SE1001',
    make: 'HPL',
    phaseType: 'Single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-001',
    geo: { lat: 26.9000, lng: 75.8000 },
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: 'C-01', name: 'Circle 1' },
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-01', name: 'Substation 1' },
      feeder: { code: 'F-001', name: 'Feeder 1' },
      dt: { code: 'DT-001', name: 'Malviya Nagar DT 1' },
    },
  },
  {
    meterId: 'J100002',
    serialNo: 'SE1002',
    make: 'L&T',
    phaseType: 'Three',
    installStatus: 'Faulty',
    installType: 'CT Operated',
    build: 'v2',
    dtCode: 'DT-001',
    geo: { lat: 26.9100, lng: 75.8000 }, // ~1.1 km from J100001
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: '', name: 'Circle 1' }, // blank circle code
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-01', name: 'Substation 1' },
      feeder: { code: 'F-001', name: 'Feeder 1' },
      dt: { code: 'DT-001', name: 'Malviya Nagar DT 1' },
    },
  },
  {
    meterId: 'J100003',
    serialNo: 'SE1003',
    make: 'HPL',
    phaseType: 'single',
    installStatus: 'Decommissioned',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-001',
    geo: { lat: 27.5000, lng: 75.8000 }, // ~66 km from J100001
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: 'C-01', name: 'Circle 1' },
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-01', name: 'Substation 1' },
      feeder: { code: 'F-001', name: '' }, // blank feeder name
      dt: { code: 'DT-001', name: 'Malviya Nagar DT 1' },
    },
  },

  // DT-002: Feeder F-001 under Substation SS-01
  {
    meterId: 'J100004',
    serialNo: 'SE1004',
    make: 'Genus',
    phaseType: 'three',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-002',
    geo: { lat: 26.9200, lng: 75.8100 },
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: 'C-01', name: 'Circle 1' },
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-01', name: 'Substation 1' },
      feeder: { code: 'F-001', name: 'Feeder 1' },
      dt: { code: 'DT-002', name: 'Vaishali DT 2' },
    },
  },

  // DT-003: Same Feeder Code F-001 under a DIFFERENT substation SS-02!
  {
    meterId: 'J100005',
    serialNo: 'SE1005',
    make: 'Secure',
    phaseType: 'single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'v2',
    dtCode: 'DT-003',
    geo: { lat: 26.8500, lng: 75.7500 },
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: 'C-01', name: 'Circle 1' },
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-02', name: 'Substation 2' }, // different SS
      feeder: { code: 'F-001', name: 'Feeder 1' }, // reused code
      dt: { code: 'DT-003', name: 'Mansarovar DT 3' },
    },
  },

  // DT-004: Only meter on DT-004 with missing circle code and name
  {
    meterId: 'J100006',
    serialNo: 'SE1006',
    make: 'Allied',
    phaseType: 'single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-004',
    geo: { lat: 26.8600, lng: 75.7600 },
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: '', name: '' }, // no peer on DT-004 to infer from!
      division: { code: 'D-02', name: 'Division 2' },
      subdivision: { code: 'SD-02', name: 'Subdivision 2' },
      substation: { code: 'SS-03', name: 'Substation 3' },
      feeder: { code: 'F-099', name: 'Feeder 99' },
      dt: { code: 'DT-004', name: 'Isolated DT 4' },
    },
  },

  // DT-007: J100007 (canonical DT name), J100008 (DT alias name)
  {
    meterId: 'J100007',
    serialNo: 'SE1007',
    make: 'HPL',
    phaseType: 'single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-007',
    geo: { lat: 26.8800, lng: 75.7400 },
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: 'C-01', name: 'Circle 1' },
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-01', name: 'Substation 1' },
      feeder: { code: 'F-007', name: 'Feeder 7' },
      dt: { code: 'DT-007', name: 'Sanganer DT 7' },
    },
  },
  {
    meterId: 'J100008',
    serialNo: 'SE1008',
    make: 'L&T',
    phaseType: 'single',
    installStatus: 'Installed',
    installType: 'Whole Current',
    build: 'legacy',
    dtCode: 'DT-007',
    geo: { lat: 26.8810, lng: 75.7410 },
    hierarchy: {
      zone: { code: 'Z-01', name: 'Jaipur Zone 1' },
      circle: { code: 'C-01', name: 'Circle 1' },
      division: { code: 'D-01', name: 'Division 1' },
      subdivision: { code: 'SD-01', name: 'Subdivision 1' },
      substation: { code: 'SS-01', name: 'Substation 1' },
      feeder: { code: 'F-007', name: 'Feeder 7' },
      dt: { code: 'DT-007', name: 'Old Malviya Nagar Xfmr' }, // alias!
    },
  },
];
