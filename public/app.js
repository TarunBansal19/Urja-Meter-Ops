// Urja Meter Ops Web Client

let map;
let markersLayer;
let allMeters = [];
let activeNodeId = null;

const STATUS_COLORS = {
  Installed: '#22c55e',
  Faulty: '#f97316',
  Decommissioned: '#64748b',
};

async function init() {
  initMap();
  setupEventListeners();

  await Promise.all([
    checkHealth(),
    loadStats(),
    loadDataQuality(),
    loadHierarchy(),
    loadMeters(),
  ]);
}

function initMap() {
  // Center on Jaipur coordinates
  map = L.map('map').setView([26.9124, 75.7873], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function setupEventListeners() {
  document.getElementById('search-input').addEventListener('input', debounce(filterMeters, 250));
  document.getElementById('filter-status').addEventListener('change', filterMeters);
  document.getElementById('filter-make').addEventListener('change', filterMeters);

  document.getElementById('clear-node-btn').addEventListener('click', () => {
    activeNodeId = null;
    document.getElementById('active-node-box').classList.add('hidden');
    document.querySelectorAll('.node-label').forEach((el) => el.classList.remove('active'));
    filterMeters();
  });

  document.getElementById('close-panel-btn').addEventListener('click', () => {
    document.getElementById('meter-panel').classList.add('hidden');
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    try {
      const res = await fetch('/admin/refresh', { method: 'POST' });
      if (res.ok) {
        await Promise.all([loadStats(), loadDataQuality(), loadHierarchy(), loadMeters()]);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Refresh Upstream';
    }
  });
}

async function checkHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const badge = document.getElementById('health-badge');
    if (data.status === 'ok') {
      badge.textContent = data.dataset.loaded
        ? `Loaded (${data.dataset.meterCount} meters)`
        : 'Warming Dataset...';
      badge.style.backgroundColor = data.dataset.loaded ? '#059669' : '#d97706';
    }
  } catch {
    const badge = document.getElementById('health-badge');
    badge.textContent = 'API Offline';
    badge.style.backgroundColor = '#dc2626';
  }
}

async function loadStats() {
  try {
    const res = await fetch('/stats');
    if (!res.ok) return;
    const { data } = await res.json();

    document.getElementById('stat-total').textContent = data.totals.meters;
    document.getElementById('stat-installed').textContent = data.byInstallStatus?.Installed || 0;
    document.getElementById('stat-faulty').textContent = data.byInstallStatus?.Faulty || 0;
    document.getElementById('stat-decom').textContent = data.byInstallStatus?.Decommissioned || 0;
    document.getElementById('stat-transformers').textContent = data.totals.transformers || 0;
  } catch (err) {
    console.error('Failed loading stats:', err);
  }
}

async function loadDataQuality() {
  try {
    const res = await fetch('/data-quality');
    if (!res.ok) return;
    const { data } = await res.json();
    const banner = document.getElementById('data-quality-banner');
    const bannerText = document.getElementById('banner-text');

    const filled = data.summary.filledFieldsCount || 0;
    const aliases = data.summary.dtAliasesCount || 0;

    bannerText.textContent = `Data Quality Engine: Cleaned and filled ${filled} missing hierarchy fields; tracked ${aliases} transformer naming aliases.`;
    banner.classList.remove('hidden');
  } catch (err) {
    console.error('Failed loading data quality report:', err);
  }
}

async function loadHierarchy() {
  try {
    const res = await fetch('/hierarchy');
    if (!res.ok) return;
    const { data } = await res.json();
    const container = document.getElementById('tree-container');
    container.innerHTML = '';

    for (const root of data) {
      container.appendChild(renderTreeNode(root));
    }
  } catch (err) {
    console.error('Failed loading hierarchy:', err);
  }
}

function renderTreeNode(node) {
  const el = document.createElement('div');
  el.className = 'tree-node';

  const label = document.createElement('div');
  label.className = 'node-label';
  label.innerHTML = `
    <span>${node.level.toUpperCase()}: ${node.name}</span>
    <span class="node-count">${node.meterCount}</span>
  `;

  label.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.node-label').forEach((l) => l.classList.remove('active'));
    label.classList.add('active');

    activeNodeId = node.id;
    document.getElementById('active-node-name').textContent = `${node.name} (${node.id})`;
    document.getElementById('active-node-box').classList.remove('hidden');
    filterMeters();
  });

  el.appendChild(label);

  if (node.children && node.children.length > 0) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    for (const child of node.children) {
      childrenContainer.appendChild(renderTreeNode(child));
    }
    el.appendChild(childrenContainer);
  }

  return el;
}

async function loadMeters() {
  try {
    const res = await fetch('/meters?pageSize=200');
    if (!res.ok) return;
    const body = await res.json();
    allMeters = body.data;

    // Fetch remaining if more than 200
    if (body.pagination.totalPages > 1) {
      for (let p = 2; p <= body.pagination.totalPages; p++) {
        const nextRes = await fetch(`/meters?pageSize=200&page=${p}`);
        if (nextRes.ok) {
          const nextBody = await nextRes.json();
          allMeters.push(...nextBody.data);
        }
      }
    }

    renderMapMarkers(allMeters);
  } catch (err) {
    console.error('Failed loading meters:', err);
  }
}

function filterMeters() {
  const search = document.getElementById('search-input').value.trim().toLowerCase();
  const status = document.getElementById('filter-status').value;
  const make = document.getElementById('filter-make').value;

  const filtered = allMeters.filter((m) => {
    if (search && !m.meterId.toLowerCase().includes(search) && !m.serialNo.toLowerCase().includes(search)) {
      return false;
    }
    if (status && m.installStatus !== status) return false;
    if (make && m.make !== make) return false;
    if (activeNodeId) {
      if (!m.hierarchyNodeId) return false;
      if (m.hierarchyNodeId !== activeNodeId && !m.hierarchyNodeId.startsWith(`${activeNodeId}:`)) {
        return false;
      }
    }
    return true;
  });

  renderMapMarkers(filtered);
}

function renderMapMarkers(meters) {
  markersLayer.clearLayers();

  for (const m of meters) {
    if (!m.location?.latitude || !m.location?.longitude) continue;

    const color = STATUS_COLORS[m.installStatus] || '#38bdf8';
    const marker = L.circleMarker([m.location.latitude, m.location.longitude], {
      radius: 6,
      fillColor: color,
      color: '#ffffff',
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.8,
    });

    marker.bindTooltip(`<strong>${m.meterId}</strong> (${m.make} - ${m.installStatus})`);
    marker.on('click', () => openMeterPanel(m));
    markersLayer.addLayer(marker);
  }
}

async function openMeterPanel(meter) {
  const panel = document.getElementById('meter-panel');
  panel.classList.remove('hidden');

  document.getElementById('panel-meter-id').textContent = `Meter ${meter.meterId}`;
  document.getElementById('info-serial').textContent = meter.serialNo;
  document.getElementById('info-make-phase').textContent = `${meter.make} (${meter.phaseType}-phase)`;
  document.getElementById('info-status').textContent = meter.installStatus;
  document.getElementById('info-type-build').textContent = `${meter.installType} / ${meter.build}`;
  document.getElementById('info-dt').textContent = `${meter.dtCode} (${meter.hierarchy?.dt?.name || 'DT'})`;

  // Breadcrumb
  const h = meter.hierarchy || {};
  const breadcrumb = [
    h.zone?.name,
    h.circle?.name,
    h.division?.name,
    h.substation?.name,
    h.feeder?.name,
    h.dt?.name,
  ]
    .filter(Boolean)
    .join(' → ');
  document.getElementById('info-breadcrumb').textContent = breadcrumb || meter.hierarchyNodeId;

  // Issues
  const issues = meter.dataQuality?.issues || [];
  const issuesEl = document.getElementById('info-issues');
  if (issues.length === 0) {
    issuesEl.textContent = '✓ Clean record, no anomalies detected.';
    issuesEl.style.color = '#86efac';
  } else {
    issuesEl.innerHTML = issues
      .map((i) => `<div>⚠ ${i.code}: ${i.field || ''} (${i.value || ''})</div>`)
      .join('');
    issuesEl.style.color = '#fca5a5';
  }

  // Fetch consumption
  const chartLoading = document.getElementById('chart-loading');
  const chartContainer = document.getElementById('chart-container');
  const chartSummary = document.getElementById('chart-summary');

  chartLoading.classList.remove('hidden');
  chartContainer.innerHTML = '';
  chartSummary.innerHTML = '';

  try {
    const res = await fetch(`/meters/${meter.meterId}/consumption`);
    if (!res.ok) throw new Error('Failed to load consumption');
    const { data, meta } = await res.json();
    renderSvgChart(chartContainer, data.readings);

    chartSummary.innerHTML = `
      <div><strong>Summary:</strong> Total Active Consumed: <strong>${data.summary.kwhConsumed} kWh</strong></div>
      <div>Voltage R-Phase: min ${data.summary.voltageR.min || '-'}V, max ${data.summary.voltageR.max || '-'}V, avg ${data.summary.voltageR.avg || '-'}V</div>
      <div>Records: ${meta.rowCount} (gaps: ${meta.gaps}, resets: ${meta.decreases})</div>
    `;
  } catch (err) {
    chartContainer.innerHTML = `<span style="color:#f87171;font-size:0.8rem">Failed loading consumption: ${err.message}</span>`;
  } finally {
    chartLoading.classList.add('hidden');
  }
}

function renderSvgChart(container, readings) {
  if (!readings || readings.length === 0) {
    container.innerHTML = '<span style="color:#94a3b8;font-size:0.8rem">No interval readings available</span>';
    return;
  }

  const values = readings.map((r) => r.kwhDelta ?? 0);
  const maxVal = Math.max(...values, 0.1);
  const width = container.clientWidth || 360;
  const height = 130;
  const padding = 15;

  const points = values.map((val, idx) => {
    const x = padding + (idx / (values.length - 1)) * (width - 2 * padding);
    const y = height - padding - (val / maxVal) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  container.innerHTML = `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible">
      <!-- Grid lines -->
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#475569" stroke-width="1" />
      <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#334155" stroke-dasharray="2,2" />
      <!-- Data line -->
      <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2" />
      <!-- Top / Bottom labels -->
      <text x="${padding}" y="${padding - 3}" fill="#94a3b8" font-size="9">${maxVal.toFixed(2)} kWh</text>
      <text x="${padding}" y="${height - 2}" fill="#94a3b8" font-size="9">Start (${readings[0].timestamp.slice(5, 10)})</text>
      <text x="${width - padding - 60}" y="${height - 2}" fill="#94a3b8" font-size="9">End (${readings[readings.length - 1].timestamp.slice(5, 10)})</text>
    </svg>
  `;
}

function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

init();
