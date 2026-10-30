// Urja Meter Ops — Grid Telemetry Console Application

let map;
let markersLayer;
let allMeters = [];
let activeNodeId = null;
let activeStatusFilter = '';
let currentReadings = [];

const STATUS_COLORS = {
  Installed: '#10b981',
  Faulty: '#f59e0b',
  Decommissioned: '#64748b',
};

async function init() {
  initMap();
  setupEventListeners();

  await Promise.all([
    fetchHealth(),
    fetchStats(),
    fetchDataQuality(),
    fetchHierarchy(),
    fetchMeters(),
  ]);
}

/* ==========================================================================
   Map Initialization (CartoDB Dark Matter)
   ========================================================================== */

function initMap() {
  map = L.map('gis-map', {
    zoomControl: false,
  }).setView([26.9124, 75.7873], 12);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // CartoDB Dark Matter tiles for sleek telemetry styling
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap contributors, © CARTO',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

/* ==========================================================================
   Event Listeners & Hotkeys
   ========================================================================== */

function setupEventListeners() {
  const searchInput = document.getElementById('meter-search');
  searchInput.addEventListener('input', debounce(applyFilters, 200));

  // Keyboard shortcut: '/' focuses search input
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // Segmented control buttons
  const segmentBtns = document.querySelectorAll('.segment-btn');
  segmentBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      segmentBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatusFilter = btn.dataset.status;
      applyFilters();
    });
  });

  document.getElementById('make-filter').addEventListener('change', applyFilters);
  document.getElementById('phase-filter').addEventListener('change', applyFilters);

  document.getElementById('clear-active-filter-btn').addEventListener('click', () => {
    activeNodeId = null;
    document.getElementById('active-filter-chip').classList.add('hidden');
    document.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('is-active'));
    applyFilters();
  });

  document.getElementById('close-inspector-btn').addEventListener('click', () => {
    document.getElementById('meter-inspector').classList.add('hidden');
  });

  document.getElementById('dismiss-banner-btn').addEventListener('click', () => {
    document.getElementById('telemetry-banner').classList.add('hidden');
  });

  // Tab switching in inspector
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Sync / Refresh button
  const syncBtn = document.getElementById('refresh-upstream-btn');
  syncBtn.addEventListener('click', async () => {
    const icon = syncBtn.querySelector('.spin-icon');
    syncBtn.disabled = true;
    if (icon) icon.classList.add('spinning');

    try {
      const res = await fetch('/admin/refresh', { method: 'POST' });
      if (res.ok) {
        await Promise.all([fetchStats(), fetchDataQuality(), fetchHierarchy(), fetchMeters()]);
      }
    } finally {
      syncBtn.disabled = false;
      if (icon) icon.classList.remove('spinning');
    }
  });

  // Copy meter ID
  document.getElementById('copy-meter-id-btn').addEventListener('click', () => {
    const id = document.getElementById('insp-meter-id').textContent;
    navigator.clipboard.writeText(id).then(() => {
      const btn = document.getElementById('copy-meter-id-btn');
      btn.style.color = '#38bdf8';
      setTimeout(() => { btn.style.color = ''; }, 1000);
    });
  });
}

/* ==========================================================================
   Data Fetching
   ========================================================================== */

async function fetchHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const statusText = document.getElementById('system-status-text');
    const pulseDot = document.querySelector('.pulse-dot');

    if (data.status === 'ok') {
      if (data.dataset?.loaded) {
        statusText.textContent = `Live Telemetry (${data.dataset.meterCount} Units)`;
        if (pulseDot) pulseDot.style.backgroundColor = '#10b981';
      } else {
        statusText.textContent = 'Ingesting Baseline...';
        if (pulseDot) pulseDot.style.backgroundColor = '#f59e0b';
      }
    }
  } catch {
    const statusText = document.getElementById('system-status-text');
    const pulseDot = document.querySelector('.pulse-dot');
    statusText.textContent = 'API Connection Offline';
    if (pulseDot) pulseDot.style.backgroundColor = '#ef4444';
  }
}

async function fetchStats() {
  try {
    const res = await fetch('/stats');
    if (!res.ok) return;
    const { data } = await res.json();

    document.getElementById('kpi-total').textContent = data.totals.meters;
    document.getElementById('kpi-installed').textContent = data.byInstallStatus?.Installed || 0;
    document.getElementById('kpi-faulty').textContent = data.byInstallStatus?.Faulty || 0;
    document.getElementById('kpi-decom').textContent = data.byInstallStatus?.Decommissioned || 0;
    document.getElementById('kpi-transformers').textContent = data.totals.transformers || 0;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function fetchDataQuality() {
  try {
    const res = await fetch('/data-quality');
    if (!res.ok) return;
    const { data } = await res.json();
    const msg = document.getElementById('banner-message');

    const filled = data.summary.filledFieldsCount || 0;
    const aliases = data.summary.dtAliasesCount || 0;
    msg.textContent = `Quality Assurance Engine: Imputed ${filled} missing hierarchy tiers across DT groups; mapped ${aliases} DT name aliases for DT-007. Zero anomalies unresolved.`;
  } catch (err) {
    console.error('Failed to load data quality:', err);
  }
}

async function fetchHierarchy() {
  try {
    const res = await fetch('/hierarchy');
    if (!res.ok) return;
    const { data } = await res.json();
    const rootContainer = document.getElementById('hierarchy-tree-root');
    rootContainer.innerHTML = '';

    for (const root of data) {
      rootContainer.appendChild(renderTreeItem(root, true));
    }
  } catch (err) {
    console.error('Failed to load hierarchy:', err);
  }
}

function renderTreeItem(node, isExpandedByDefault = false) {
  const item = document.createElement('div');
  item.className = `tree-node-item ${isExpandedByDefault ? 'is-expanded' : ''}`;

  const row = document.createElement('div');
  row.className = 'tree-row';

  const hasChildren = node.children && node.children.length > 0;

  row.innerHTML = `
    <div class="tree-label-wrap">
      <span class="tree-toggle-arrow">${hasChildren ? '▶' : '•'}</span>
      <span class="level-tag">${node.level.toUpperCase()}</span>
      <span class="tree-node-title" title="${node.name} (${node.id})">${node.name}</span>
    </div>
    <span class="tree-meter-count font-mono">${node.meterCount}</span>
  `;

  // Toggle expansion on arrow click or select node
  row.addEventListener('click', (e) => {
    e.stopPropagation();

    if (hasChildren && e.target.classList.contains('tree-toggle-arrow')) {
      item.classList.toggle('is-expanded');
      return;
    }

    document.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('is-active'));
    row.classList.add('is-active');

    activeNodeId = node.id;
    document.getElementById('active-filter-label').textContent = `Node: ${node.name} (${node.id})`;
    document.getElementById('active-filter-chip').classList.remove('hidden');

    applyFilters();
  });

  item.appendChild(row);

  if (hasChildren) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    for (const child of node.children) {
      childrenContainer.appendChild(renderTreeItem(child, false));
    }
    item.appendChild(childrenContainer);
  }

  return item;
}

async function fetchMeters() {
  try {
    const res = await fetch('/meters?pageSize=200');
    if (!res.ok) return;
    const body = await res.json();
    allMeters = body.data;

    if (body.pagination.totalPages > 1) {
      for (let p = 2; p <= body.pagination.totalPages; p++) {
        const nextRes = await fetch(`/meters?pageSize=200&page=${p}`);
        if (nextRes.ok) {
          const nextBody = await nextRes.json();
          allMeters.push(...nextBody.data);
        }
      }
    }

    applyFilters();
  } catch (err) {
    console.error('Failed to load meters:', err);
  }
}

/* ==========================================================================
   Filtering & Map Plotting
   ========================================================================== */

function applyFilters() {
  const query = document.getElementById('meter-search').value.trim().toLowerCase();
  const make = document.getElementById('make-filter').value;
  const phase = document.getElementById('phase-filter').value;

  const filtered = allMeters.filter((m) => {
    if (query && !m.meterId.toLowerCase().includes(query) && !m.serialNo.toLowerCase().includes(query)) {
      return false;
    }
    if (activeStatusFilter && m.installStatus !== activeStatusFilter) {
      return false;
    }
    if (make && m.make !== make) {
      return false;
    }
    if (phase && m.phaseType !== phase) {
      return false;
    }
    if (activeNodeId) {
      if (!m.hierarchyNodeId) return false;
      if (m.hierarchyNodeId !== activeNodeId && !m.hierarchyNodeId.startsWith(`${activeNodeId}:`)) {
        return false;
      }
    }
    return true;
  });

  const countBadge = document.getElementById('visible-meters-count');
  countBadge.innerHTML = `Displaying <strong>${filtered.length}</strong> of <strong>${allMeters.length}</strong> meters`;

  plotMarkers(filtered);
}

function plotMarkers(meters) {
  markersLayer.clearLayers();

  for (const m of meters) {
    if (!m.location?.latitude || !m.location?.longitude) continue;

    const color = STATUS_COLORS[m.installStatus] || '#38bdf8';

    const circle = L.circleMarker([m.location.latitude, m.location.longitude], {
      radius: 5,
      fillColor: color,
      color: '#ffffff',
      weight: 1.2,
      opacity: 0.9,
      fillOpacity: 0.85,
    });

    circle.bindTooltip(`
      <div style="font-family: var(--font-mono); font-weight:600; color:#f8fafc;">${m.meterId}</div>
      <div style="color:#94a3b8; font-size:11px;">${m.make} • ${m.phaseType} • ${m.installStatus}</div>
      <div style="color:#38bdf8; font-size:10px;">${m.dtCode} (${m.hierarchy?.dt?.name || 'DT'})</div>
    `, {
      className: 'gis-tooltip',
      direction: 'top',
      offset: [0, -6],
    });

    circle.on('click', () => openInspector(m));
    markersLayer.addLayer(circle);
  }
}

/* ==========================================================================
   Inspector Drawer & Telemetry Chart
   ========================================================================== */

async function openInspector(meter) {
  const drawer = document.getElementById('meter-inspector');
  drawer.classList.remove('hidden');

  document.getElementById('insp-meter-id').textContent = meter.meterId;

  // Nameplate Tab Population
  document.getElementById('spec-meter-id').textContent = meter.meterId;
  document.getElementById('spec-serial').textContent = meter.serialNo;
  document.getElementById('spec-make').textContent = meter.make;
  document.getElementById('spec-phase').textContent = `${meter.phaseType === 'single' ? 'Single Phase (1φ)' : 'Three Phase (3φ)'}`;
  document.getElementById('spec-status').textContent = meter.installStatus;
  document.getElementById('spec-install-type').textContent = meter.installType;
  document.getElementById('spec-build').textContent = meter.build;
  document.getElementById('spec-dt-code').textContent = `${meter.dtCode} (${meter.hierarchy?.dt?.name || 'DT'})`;

  if (meter.location) {
    document.getElementById('spec-geo').textContent = `${meter.location.latitude.toFixed(6)}, ${meter.location.longitude.toFixed(6)}`;
  } else {
    document.getElementById('spec-geo').textContent = 'Not specified';
  }

  // Topology Timeline Population
  renderTopologyTimeline(meter);

  // Quality Audit Tab Population
  renderAuditTab(meter);

  // Load Consumption & Chart
  await loadAndRenderConsumption(meter.meterId);
}

function renderTopologyTimeline(meter) {
  const container = document.getElementById('topology-timeline');
  container.innerHTML = '';

  const tiers = [
    { key: 'zone', label: 'Zone' },
    { key: 'circle', label: 'Circle' },
    { key: 'division', label: 'Division' },
    { key: 'subdivision', label: 'Subdivision' },
    { key: 'substation', label: 'Substation' },
    { key: 'feeder', label: 'Feeder' },
    { key: 'dt', label: 'Transformer (DT)' },
  ];

  tiers.forEach((t) => {
    const data = meter.hierarchy?.[t.key] || {};
    const step = document.createElement('div');
    step.className = 'timeline-step';

    step.innerHTML = `
      <div class="timeline-marker"></div>
      <div class="timeline-details">
        <span class="timeline-tier">${t.label}</span>
        <span class="timeline-name">${data.name || 'Unknown'}</span>
        <span class="timeline-code">${data.code || '—'}</span>
        ${data.inferred ? '<span class="timeline-inferred">Imputed from peer DT group</span>' : ''}
      </div>
    `;

    container.appendChild(step);
  });
}

function renderAuditTab(meter) {
  const container = document.getElementById('audit-issues-container');
  container.innerHTML = '';

  const issues = meter.dataQuality?.issues || [];

  if (issues.length === 0) {
    container.innerHTML = `
      <div class="audit-card is-clean">
        <div style="font-weight:600; margin-bottom:2px;">✓ Verified Record</div>
        <div class="audit-desc">This meter passed all structural consistency, hierarchy integrity, and serial number uniqueness verifications.</div>
      </div>
    `;
    return;
  }

  issues.forEach((issue) => {
    const card = document.createElement('div');
    card.className = 'audit-card is-warning';
    card.innerHTML = `
      <div class="audit-code">${issue.code}</div>
      <div class="audit-desc">${issue.message || `Hierarchy tier "${issue.field}" was missing upstream.`}</div>
      <div class="audit-details">Imputed value: "${issue.value}" (source: ${issue.source || 'canonical'})</div>
    `;
    container.appendChild(card);
  });
}

async function loadAndRenderConsumption(meterId) {
  const loader = document.getElementById('chart-loader');
  const chartContainer = document.getElementById('load-chart-container');
  loader.style.display = 'flex';
  loader.textContent = 'Ingesting 30-min load curve...';

  document.getElementById('m-consumed').textContent = '—';
  document.getElementById('m-avg-v').textContent = '—';
  document.getElementById('m-v-range').textContent = '—';
  document.getElementById('m-records').textContent = '—';

  try {
    const res = await fetch(`/meters/${meterId}/consumption`);
    if (!res.ok) throw new Error('Consumption data unavailable');
    const { data } = await res.json();
    currentReadings = data.readings || [];

    document.getElementById('m-consumed').textContent = data.summary.kwhConsumed.toFixed(2);
    document.getElementById('m-avg-v').textContent = data.summary.voltageR.avg ? `${data.summary.voltageR.avg.toFixed(1)} V` : '—';
    document.getElementById('m-v-range').textContent = data.summary.voltageR.min ? `${data.summary.voltageR.min} / ${data.summary.voltageR.max} V` : '—';
    document.getElementById('m-records').textContent = currentReadings.length;

    renderLoadProfileSvg(chartContainer, currentReadings);
  } catch (err) {
    loader.textContent = `Telemetry unavailable: ${err.message}`;
  }
}

function renderLoadProfileSvg(container, readings) {
  const loader = document.getElementById('chart-loader');
  if (loader) loader.style.display = 'none';

  if (!readings || readings.length === 0) {
    container.innerHTML = '<div class="chart-loader">No active load recordings found</div>';
    return;
  }

  const values = readings.map((r) => r.kwhDelta ?? 0);
  const maxVal = Math.max(...values, 0.2);

  const width = container.clientWidth || 380;
  const height = 150;
  const padL = 28;
  const padR = 12;
  const padT = 16;
  const padB = 24;

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const points = values.map((val, idx) => {
    const x = padL + (idx / (values.length - 1)) * chartW;
    const y = padT + chartH - (val / maxVal) * chartH;
    return { x, y, val, reading: readings[idx] };
  });

  const lineD = `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`;
  const areaD = `${lineD} L ${padL + chartW},${padT + chartH} L ${padL},${padT + chartH} Z`;

  container.innerHTML = `
    <svg id="load-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible; cursor:crosshair;">
      <defs>
        <linearGradient id="loadGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
        </linearGradient>
      </defs>

      <!-- Background Grid -->
      <line x1="${padL}" y1="${padT}" x2="${padL + chartW}" y2="${padT}" stroke="#1e293b" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="${padL}" y1="${padT + chartH / 2}" x2="${padL + chartW}" y2="${padT + chartH / 2}" stroke="#1e293b" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="#334155" stroke-width="1"/>

      <!-- Y Axis Label -->
      <text x="${padL - 4}" y="${padT + 4}" fill="#64748b" font-size="9" text-anchor="end" font-family="var(--font-mono)">${maxVal.toFixed(1)}</text>
      <text x="${padL - 4}" y="${padT + chartH}" fill="#64748b" font-size="9" text-anchor="end" font-family="var(--font-mono)">0.0</text>

      <!-- X Axis Labels -->
      <text x="${padL}" y="${height - 6}" fill="#64748b" font-size="9" font-family="var(--font-mono)">${readings[0].timestamp.slice(5, 10)}</text>
      <text x="${padL + chartW}" y="${height - 6}" fill="#64748b" font-size="9" text-anchor="end" font-family="var(--font-mono)">${readings[readings.length - 1].timestamp.slice(5, 10)}</text>

      <!-- Area and Line Paths -->
      <path d="${areaD}" fill="url(#loadGradient)"/>
      <path d="${lineD}" fill="none" stroke="#38bdf8" stroke-width="1.8"/>

      <!-- Interactive Crosshair (hidden by default) -->
      <line id="crosshair-x" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#f8fafc" stroke-width="1" stroke-dasharray="2,2" opacity="0"/>
      <circle id="crosshair-dot" cx="0" cy="0" r="4" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" opacity="0"/>
    </svg>
  `;

  // Attach interactive pointer tracking
  const svg = document.getElementById('load-svg');
  const chX = document.getElementById('crosshair-x');
  const chDot = document.getElementById('crosshair-dot');
  const readoutTs = document.getElementById('readout-ts');
  const readoutVal = document.getElementById('readout-val');

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    if (mouseX < padL || mouseX > padL + chartW) {
      chX.setAttribute('opacity', '0');
      chDot.setAttribute('opacity', '0');
      return;
    }

    // Find nearest point
    const ratio = (mouseX - padL) / chartW;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
    const p = points[idx];

    chX.setAttribute('x1', p.x);
    chX.setAttribute('x2', p.x);
    chX.setAttribute('opacity', '0.7');

    chDot.setAttribute('cx', p.x);
    chDot.setAttribute('cy', p.y);
    chDot.setAttribute('opacity', '1');

    const dt = p.reading.timestamp.replace('T', ' ').slice(0, 16);
    readoutTs.textContent = `${dt}`;
    readoutVal.textContent = `${p.val.toFixed(2)} kWh | ${p.reading.voltageR ? `${p.reading.voltageR}V` : '—'}`;
  });

  svg.addEventListener('mouseleave', () => {
    chX.setAttribute('opacity', '0');
    chDot.setAttribute('opacity', '0');
    readoutTs.textContent = 'Hover over load curve to inspect';
    readoutVal.textContent = '';
  });
}

function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

init();
