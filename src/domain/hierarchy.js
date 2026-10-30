import { HIERARCHY_LEVELS } from './meters.js';

/**
 * Find the modal (most frequent) non-blank value from an array of strings.
 * If ties occur, picks the first deterministically (or alphabetically).
 * @param {Array<string|null|undefined>} values
 * @returns {string|null}
 */
export function findModalValue(values) {
  const counts = new Map();
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim().length > 0) {
      const s = String(v).trim();
      counts.set(s, (counts.get(s) || 0) + 1);
    }
  }

  if (counts.size === 0) return null;

  let maxCount = -1;
  let modal = null;
  // Sort keys alphabetically for deterministic tie-breaking
  const keys = Array.from(counts.keys()).sort();
  for (const k of keys) {
    const c = counts.get(k);
    if (c > maxCount) {
      maxCount = c;
      modal = k;
    }
  }

  return modal;
}

/**
 * Process meters and authoritative DT metadata to:
 * 1. Fill missing hierarchy blanks from DT modals and record issues
 * 2. Resolve DT canonical names and aliases
 * 3. Construct the full hierarchy tree with unique path IDs
 * 4. Generate the Data Quality report
 *
 * @param {import('./meters.js').DomainMeter[]} meters
 * @param {Array<{ code: string, name: string, feederCode?: string, capacityKva?: number }>} dts
 * @returns {{
 *   meters: import('./meters.js').DomainMeter[],
 *   roots: any[],
 *   nodesById: Map<string, any>,
 *   transformers: any[],
 *   report: any
 * }}
 */
export function buildHierarchy(meters, dts = []) {
  const dtsByCode = new Map();
  for (const dt of dts) {
    if (dt && dt.code) {
      dtsByCode.set(dt.code, dt);
    }
  }

  // 1. Group meters by dtCode
  const metersByDt = new Map();
  for (const meter of meters) {
    const dtCode = meter.dtCode || 'UNKNOWN_DT';
    if (!metersByDt.has(dtCode)) {
      metersByDt.set(dtCode, []);
    }
    metersByDt.get(dtCode).push(meter);
  }

  const filledFieldsReport = [];
  const dtAliasesReport = [];
  const conflictsReport = [];
  const feederMismatchesReport = [];
  const unknownFieldsReport = [];

  const dtAliasesMap = new Map(); // dtCode -> Set<string>
  const dtModalPaths = new Map(); // dtCode -> full path array of { code, name, level }

  // 2. For each DT group, compute modal values for all levels and fill blanks
  for (const [dtCode, dtMeters] of metersByDt.entries()) {
    const authoritativeDt = dtsByCode.get(dtCode);
    const canonicalDtName = authoritativeDt?.name || null;

    if (!dtAliasesMap.has(dtCode)) {
      dtAliasesMap.set(dtCode, new Set());
    }

    // Compute modals for each level
    const dtLevelModals = {};
    for (const level of HIERARCHY_LEVELS) {
      const allCodes = dtMeters.map((m) => m.hierarchy[level]?.code);
      const allNames = dtMeters.map((m) => m.hierarchy[level]?.name);

      const modalCode = findModalValue(allCodes);
      let modalName = findModalValue(allNames);

      // If at DT level and authoritative name exists, canonical takes precedence
      if (level === 'dt' && canonicalDtName) {
        modalName = canonicalDtName;
      }

      dtLevelModals[level] = {
        code: modalCode,
        name: modalName,
      };

      // Check for non-blank conflicts within the DT (beyond DT name)
      const nonBlankCodes = new Set(allCodes.filter((c) => c !== null && c !== undefined && c !== ''));
      if (nonBlankCodes.size > 1 && level !== 'dt') {
        conflictsReport.push({
          code: 'hierarchy_conflict',
          level,
          property: 'code',
          dtCode,
          values: Array.from(nonBlankCodes),
        });
      }

      const nonBlankNames = new Set(allNames.filter((n) => n !== null && n !== undefined && n !== ''));
      if (nonBlankNames.size > 1 && level !== 'dt') {
        conflictsReport.push({
          code: 'hierarchy_conflict',
          level,
          property: 'name',
          dtCode,
          values: Array.from(nonBlankNames),
        });
      }
    }

    // Check feederCode mismatch between modal feeder and /portal/dts feederCode
    if (authoritativeDt?.feederCode && dtLevelModals.feeder?.code) {
      if (authoritativeDt.feederCode !== dtLevelModals.feeder.code) {
        feederMismatchesReport.push({
          code: 'feeder_code_mismatch',
          dtCode,
          portalDtsFeederCode: authoritativeDt.feederCode,
          modalMeterFeederCode: dtLevelModals.feeder.code,
        });
      }
    }

    // Fill missing blanks on each meter in this DT group
    for (const meter of dtMeters) {
      for (const level of HIERARCHY_LEVELS) {
        const fieldState = meter.hierarchy[level];
        const modal = dtLevelModals[level];

        // Code
        if (!fieldState.code) {
          if (modal.code) {
            fieldState.code = modal.code;
            fieldState.inferred = true;
            const issue = {
              code: 'hierarchy_field_filled',
              field: `${level}.code`,
              value: modal.code,
              source: 'modal_of_dt',
              meterId: meter.meterId,
              dtCode,
            };
            meter.dataQuality.issues.push(issue);
            filledFieldsReport.push(issue);
          } else {
            fieldState.code = `unknown-${level}`;
            fieldState.inferred = true;
            const issue = {
              code: 'hierarchy_field_unknown',
              field: `${level}.code`,
              value: fieldState.code,
              meterId: meter.meterId,
              dtCode,
            };
            meter.dataQuality.issues.push(issue);
            unknownFieldsReport.push(issue);
          }
        }

        // Name
        if (!fieldState.name) {
          if (modal.name) {
            fieldState.name = modal.name;
            fieldState.inferred = true;
            const issue = {
              code: 'hierarchy_field_filled',
              field: `${level}.name`,
              value: modal.name,
              source: 'modal_of_dt',
              meterId: meter.meterId,
              dtCode,
            };
            meter.dataQuality.issues.push(issue);
            filledFieldsReport.push(issue);
          } else {
            fieldState.name = `Unknown ${level}`;
            fieldState.inferred = true;
            const issue = {
              code: 'hierarchy_field_unknown',
              field: `${level}.name`,
              value: fieldState.name,
              meterId: meter.meterId,
              dtCode,
            };
            meter.dataQuality.issues.push(issue);
            unknownFieldsReport.push(issue);
          }
        }

        // DT Name alias check: if meter DT name differs from canonical DT name
        if (level === 'dt' && canonicalDtName && fieldState.name !== canonicalDtName) {
          const rawAlias = fieldState.name;
          dtAliasesMap.get(dtCode).add(rawAlias);
          const issue = {
            code: 'dt_name_alias',
            field: 'dt.name',
            value: rawAlias,
            canonical: canonicalDtName,
            meterId: meter.meterId,
            dtCode,
          };
          meter.dataQuality.issues.push(issue);
          dtAliasesReport.push(issue);
        }
      }
    }

    // Build the modal path for this DT: array of { level, code, name }
    const pathNodes = [];
    for (const level of HIERARCHY_LEVELS) {
      pathNodes.push({
        level,
        code: dtLevelModals[level].code || `unknown-${level}`,
        name: dtLevelModals[level].name || `Unknown ${level}`,
      });
    }
    dtModalPaths.set(dtCode, pathNodes);
  }

  // 3. Assign hierarchyNodeId to each meter
  for (const meter of meters) {
    const dtCode = meter.dtCode || 'UNKNOWN_DT';
    const pathNodes = dtModalPaths.get(dtCode) || [];
    meter.hierarchyNodeId = pathNodes.map((p) => p.code).join(':');
  }

  // 4. Construct the tree and node lookup table
  const roots = [];
  const nodesById = new Map();

  for (const [dtCode, dtMeters] of metersByDt.entries()) {
    const pathNodes = dtModalPaths.get(dtCode);
    if (!pathNodes || pathNodes.length === 0) continue;

    let currentParent = null;
    let currentPathId = '';

    for (let i = 0; i < pathNodes.length; i++) {
      const step = pathNodes[i];
      currentPathId = currentPathId ? `${currentPathId}:${step.code}` : step.code;

      let node = nodesById.get(currentPathId);
      if (!node) {
        node = {
          id: currentPathId,
          level: step.level,
          code: step.code,
          name: step.name,
          meterCount: 0,
          children: [],
        };

        if (step.level === 'dt') {
          const authDt = dtsByCode.get(dtCode);
          const aliases = Array.from(dtAliasesMap.get(dtCode) || []).filter(
            (a) => a !== step.name
          );
          node.aliases = aliases;
          node.feederCode = authDt?.feederCode || pathNodes[i - 1]?.code || null;
          node.capacityKva = typeof authDt?.capacityKva === 'number' ? authDt.capacityKva : null;
        }

        nodesById.set(currentPathId, node);

        if (currentParent) {
          currentParent.children.push(node);
        } else {
          roots.push(node);
        }
      }

      // Add meter count to this node
      node.meterCount += dtMeters.length;
      currentParent = node;
    }
  }

  // 5. Build transformers list (DT index)
  const transformers = [];
  // Include all DTs from /portal/dts plus any DT found in meters
  const allKnownDtCodes = new Set([...dtsByCode.keys(), ...metersByDt.keys()]);
  for (const dtCode of Array.from(allKnownDtCodes).sort()) {
    const authDt = dtsByCode.get(dtCode);
    const dtMeters = metersByDt.get(dtCode) || [];
    const pathNodes = dtModalPaths.get(dtCode) || [];
    const nodeId = pathNodes.map((p) => p.code).join(':');
    const aliases = Array.from(dtAliasesMap.get(dtCode) || []).filter(
      (a) => a !== (authDt?.name || pathNodes[pathNodes.length - 1]?.name)
    );

    const canonicalName =
      authDt?.name ||
      pathNodes[pathNodes.length - 1]?.name ||
      dtCode;

    transformers.push({
      code: dtCode,
      name: canonicalName,
      aliases,
      feederCode: authDt?.feederCode || (pathNodes[pathNodes.length - 2]?.code ?? null),
      capacityKva: typeof authDt?.capacityKva === 'number' ? authDt.capacityKva : null,
      meterCount: dtMeters.length,
      hierarchyNodeId: nodeId,
    });
  }

  // 6. Data quality report summary
  const report = {
    summary: {
      totalMeters: meters.length,
      totalTransformers: transformers.length,
      metersWithIssues: meters.filter((m) => m.dataQuality.issues.length > 0).length,
      filledFieldsCount: filledFieldsReport.length,
      dtAliasesCount: dtAliasesReport.length,
      conflictsCount: conflictsReport.length,
      feederMismatchesCount: feederMismatchesReport.length,
      unknownFieldsCount: unknownFieldsReport.length,
    },
    filledFields: filledFieldsReport,
    dtAliases: dtAliasesReport,
    conflicts: conflictsReport,
    feederMismatches: feederMismatchesReport,
    unknownFields: unknownFieldsReport,
  };

  return {
    meters,
    roots,
    nodesById,
    transformers,
    report,
  };
}

/**
 * Filter tree down to a specified maximum depth.
 * @param {any[]} roots
 * @param {number} maxDepth
 * @returns {any[]}
 */
export function pruneTreeDepth(roots, maxDepth) {
  if (maxDepth <= 0) return [];

  function pruneNode(node, currentDepth) {
    const cloned = { ...node };
    if (currentDepth >= maxDepth) {
      cloned.children = [];
    } else {
      cloned.children = node.children.map((child) => pruneNode(child, currentDepth + 1));
    }
    return cloned;
  }

  return roots.map((root) => pruneNode(root, 1));
}
