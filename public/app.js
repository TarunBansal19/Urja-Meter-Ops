// Urja Meter Ops — Minimal Telemetry Console Application

let map;
let markersLayer;
let allMeters = [];
let activeNodeId = null;
let activeStatusFilter = '';
let currentReadings = [];

const STATUS_COLORS = {
  Installed: '#22c55e',
  Faulty: '#eab308',
  Decommissioned: '#71717a',
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
   Map Initialization (OpenStreetMap with Clean Dark Filter, Zero API Key)
   ========================================================================== */

function initMap() {
  map = L.map('gis-map', {
    zoomControl: false,
  }).setView([26.9124, 75.7873], 12);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Standard OpenStreetMap tiles (100% free, reliable, no API key required)
  // Paired with CSS dark filter in styles.css for a seamless dark-gray UI look
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

/* ==========================================================================
   Event Listeners & Hotkeys
   ========================================================================== */

function setupEventListeners() {
  const searchInput = document.getElementById('meter-search');
  searchInput.addEventListener('input', debounce(applyFilters, 180));

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
      btn.style.color = '#ffffff';
      setTimeout(() => { btn.style.color = ''; }, 800);
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
    const statusDot = document.querySelector('.status-dot');

    if (data.status === 'ok') {
      if (data.dataset?.loaded) {
        statusText.textContent = `Online (${data.dataset.meterCount} units)`;
        if (statusDot) statusDot.style.backgroundColor = '#22c55e';
      } else {
        statusText.textContent = 'Warming...';
        if (statusDot) statusDot.style.backgroundColor = '#eab308';
      }
    }
  } catch {
    const statusText = document.getElementById('system-status-text');
    const statusDot = document.querySelector('.status-dot');
    statusText.textContent = 'Offline';
    if (statusDot) statusDot.style.backgroundColor = '#ef4444';
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
    msg.textContent = `Audit Engine: Imputed ${filled} missing hierarchy tiers; tracked ${aliases} transformer aliases for DT-007. No unresolved conflicts.`;
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
      <span class="level-tag font-mono">${node.level.toUpperCase()}</span>
      <span class="tree-node-title" title="${node.name} (${node.id})">${node.name}</span>
    </div>
    <span class="tree-meter-count font-mono">${node.meterCount}</span>
  `;

  row.addEventListener('click', (e) => {
    e.stopPropagation();

    if (hasChildren && e.target.classList.contains('tree-toggle-arrow')) {
      item.classList.toggle('is-expanded');
      return;
    }

    document.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('is-active'));
    row.classList.add('is-active');

    activeNodeId = node.id;
    document.getElementById('active-filter-label').textContent = `${node.name} (${node.id})`;
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
  countBadge.innerHTML = `<strong>${filtered.length}</strong> / <strong>${allMeters.length}</strong> meters`;

  plotMarkers(filtered);
}

function plotMarkers(meters) {
  markersLayer.clearLayers();

  for (const m of meters) {
    if (!m.location?.latitude || !m.location?.longitude) continue;

    const color = STATUS_COLORS[m.installStatus] || '#d4d4d8';

    const circle = L.circleMarker([m.location.latitude, m.location.longitude], {
      radius: 4.5,
      fillColor: color,
      color: '#18181b',
      weight: 1.2,
      opacity: 0.9,
      fillOpacity: 0.85,
    });

    circle.bindTooltip(`
      <div style="font-family: var(--font-mono); font-weight:600; color:#f4f4f5;">${m.meterId}</div>
      <div style="color:#a1a1aa; font-size:11px;">${m.make} • ${m.phaseType} • ${m.installStatus}</div>
      <div style="color:#71717a; font-size:10px;">${m.dtCode}</div>
    `, {
      className: 'gis-tooltip',
      direction: 'top',
      offset: [0, -5],
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

  // Nameplate Tab
  document.getElementById('spec-meter-id').textContent = meter.meterId;
  document.getElementById('spec-serial').textContent = meter.serialNo;
  document.getElementById('spec-make').textContent = meter.make;
  document.getElementById('spec-phase').textContent = meter.phaseType === 'single' ? 'Single Phase (1φ)' : 'Three Phase (3φ)';
  document.getElementById('spec-status').textContent = meter.installStatus;
  document.getElementById('spec-install-type').textContent = meter.installType;
  document.getElementById('spec-build').textContent = meter.build;
  document.getElementById('spec-dt-code').textContent = `${meter.dtCode} (${meter.hierarchy?.dt?.name || 'DT'})`;

  if (meter.location) {
    document.getElementById('spec-geo').textContent = `${meter.location.latitude.toFixed(6)}, ${meter.location.longitude.toFixed(6)}`;
  } else {
    document.getElementById('spec-geo').textContent = 'Not specified';
  }

  // Topology Timeline
  renderTopologyTimeline(meter);

  // Quality Audit Tab
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
    { key: 'dt', label: 'DT' },
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
        <span class="timeline-code font-mono">${data.code || '—'}</span>
        ${data.inferred ? '<span class="timeline-inferred font-mono">Imputed from peer DT group</span>' : ''}
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
        <div style="font-weight:500; margin-bottom:2px;">✓ Verified Record</div>
        <div class="audit-desc">Passed all structural consistency, hierarchy integrity, and serial number uniqueness verifications.</div>
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
      <div class="audit-details">Imputed: "${issue.value}" (source: ${issue.source || 'canonical'})</div>
    `;
    container.appendChild(card);
  });
}

async function loadAndRenderConsumption(meterId) {
  const loader = document.getElementById('chart-loader');
  const chartContainer = document.getElementById('load-chart-container');
  loader.style.display = 'flex';
  loader.textContent = 'Loading interval series...';

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

  const width = container.clientWidth || 370;
  const height = 135;
  const padL = 26;
  const padR = 10;
  const padT = 14;
  const padB = 22;

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
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0"/>
        </linearGradient>
      </defs>

      <!-- Background Grid -->
      <line x1="${padL}" y1="${padT}" x2="${padL + chartW}" y2="${padT}" stroke="#27272a" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="${padL}" y1="${padT + chartH / 2}" x2="${padL + chartW}" y2="${padT + chartH / 2}" stroke="#27272a" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="#3f3f46" stroke-width="1"/>

      <!-- Y Axis Label -->
      <text x="${padL - 4}" y="${padT + 4}" fill="#71717a" font-size="8.5" text-anchor="end" font-family="var(--font-mono)">${maxVal.toFixed(1)}</text>
      <text x="${padL - 4}" y="${padT + chartH}" fill="#71717a" font-size="8.5" text-anchor="end" font-family="var(--font-mono)">0.0</text>

      <!-- X Axis Labels -->
      <text x="${padL}" y="${height - 5}" fill="#71717a" font-size="8.5" font-family="var(--font-mono)">${readings[0].timestamp.slice(5, 10)}</text>
      <text x="${padL + chartW}" y="${height - 5}" fill="#71717a" font-size="8.5" text-anchor="end" font-family="var(--font-mono)">${readings[readings.length - 1].timestamp.slice(5, 10)}</text>

      <!-- Area and Line Paths -->
      <path d="${areaD}" fill="url(#loadGradient)"/>
      <path d="${lineD}" fill="none" stroke="#d4d4d8" stroke-width="1.5"/>

      <!-- Interactive Crosshair -->
      <line id="crosshair-x" x1="0" y1="${padT}" x2="0" y2="${padT + chartH}" stroke="#f4f4f5" stroke-width="1" stroke-dasharray="2,2" opacity="0"/>
      <circle id="crosshair-dot" cx="0" cy="0" r="3.5" fill="#f4f4f5" stroke="#18181b" stroke-width="1.5" opacity="0"/>
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

    const ratio = (mouseX - padL) / chartW;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
    const p = points[idx];

    chX.setAttribute('x1', p.x);
    chX.setAttribute('x2', p.x);
    chX.setAttribute('opacity', '0.6');

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
