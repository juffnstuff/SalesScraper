/**
 * RubberForm Prospecting Engine — Sales Map
 * Colored dot markers with clustering, grouped by transaction layer.
 * Cluster click shows record list; stat tile click shows full transaction list.
 */

// Layer config
const LAYER_COLORS = {
  shipped: '#16a34a',
  open: '#ea580c',
  converted: '#2563eb',
  lost: '#dc2626'
};

const LAYER_LABELS = {
  shipped: 'Shipped Sale',
  open: 'Open Quote',
  converted: 'Converted Quote',
  lost: 'Lost Quote'
};

// Global state
let map;
let allTransactions = [];
let geoData = null;
let markerLayers = { shipped: null, open: null, converted: null, lost: null };
let activeLayers = { shipped: true, open: true, converted: true, lost: true };
let activeYears = {};
let currentListTransactions = [];
let lastViewedLayer = null;

// Pre-built marker cache: markerCache[layer][year] = [marker, marker, ...]
let markerCache = { shipped: {}, open: {}, converted: {}, lost: {} };

const US_STATES_GEOJSON = '/data/us-states.json';

// -- Initialize --
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('/data/us_cities_coords.json');
    geoData = await resp.json();
  } catch (e) {
    console.warn('Could not load city coords:', e);
    geoData = { cities: {}, stateCentroids: {} };
  }

  initMap();
  loadData();
  loadSyncStatus();

  document.querySelectorAll('.stage-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleLayer(btn));
  });

  document.getElementById('repFilter').addEventListener('change', () => loadData());
});

function initMap() {
  map = L.map('salesmap', {
    center: [39.8, -98.5],
    zoom: 4,
    minZoom: 3,
    maxZoom: 18
  });

  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO &copy; OSM',
    subdomains: 'abcd',
    maxZoom: 19
  });
  tileLayer.on('tileerror', () => {});
  tileLayer.addTo(map);

  fetch(US_STATES_GEOJSON)
    .then(r => r.json())
    .then(geojson => {
      L.geoJSON(geojson, {
        style: {
          fillColor: '#e2e8f0',
          fillOpacity: 0.5,
          color: '#94a3b8',
          weight: 1.5
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(feature.properties.name, { sticky: true });
          layer.on('mouseover', function() { this.setStyle({ fillOpacity: 0.7, weight: 2, color: '#64748b' }); });
          layer.on('mouseout', function() { this.setStyle({ fillOpacity: 0.5, weight: 1.5, color: '#94a3b8' }); });
        }
      }).addTo(map);
    })
    .catch(e => console.warn('Could not load state boundaries:', e));

  // Per-layer marker cluster groups with colored count badges
  for (const layerName of Object.keys(LAYER_COLORS)) {
    const color = LAYER_COLORS[layerName];
    markerLayers[layerName] = L.markerClusterGroup({
      maxClusterRadius: 40,
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        const size = count < 10 ? 30 : count < 50 ? 36 : 42;
        return L.divIcon({
          html: `<div style="background:${color}; color:white; border-radius:50%; width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; font-size:${size < 36 ? 12 : 13}px; font-weight:bold; border:2px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.3);">${count}</div>`,
          className: '',
          iconSize: [size, size]
        });
      }
    });

    // Cluster click → show list of transactions in that cluster
    markerLayers[layerName].on('clusterclick', function(e) {
      const markers = e.layer.getAllChildMarkers();
      const txns = markers.map(m => m._txnData).filter(Boolean);
      if (txns.length > 0) {
        showClusterList(txns, layerName);
      }
    });

    map.addLayer(markerLayers[layerName]);
  }
}

async function loadData() {
  const repId = document.getElementById('repFilter').value;

  document.getElementById('loadingIndicator').style.display = 'inline';

  try {
    const resp = await fetch(`/api/salesmap-data?days=0&repId=${repId}`);
    const data = await resp.json();
    allTransactions = data.transactions || [];

    document.getElementById('loadingIndicator').style.display = 'none';

    buildYearButtons();
    buildMarkers();
    updateMap();
  } catch (e) {
    document.getElementById('loadingIndicator').style.display = 'none';
    console.error('Failed to load sales map data:', e);
  }
}

// ── Dynamic Year Dropdown (multi-select with checkboxes) ──
function buildYearButtons() {
  const years = new Set();
  for (const txn of allTransactions) {
    const y = getTransactionYear(txn);
    if (y) years.add(y);
  }
  const sorted = [...years].sort((a, b) => b - a);
  const menu = document.getElementById('yearDropdownMenu');
  menu.innerHTML = '';
  activeYears = {};

  // "Select All / Deselect All" toggle at the top
  const toggleLi = document.createElement('li');
  toggleLi.innerHTML = `<a class="dropdown-item small" href="#" id="yearToggleAll"><strong>Select All</strong></a>`;
  menu.appendChild(toggleLi);
  const divider = document.createElement('li');
  divider.innerHTML = '<hr class="dropdown-divider my-1">';
  menu.appendChild(divider);

  for (const y of sorted) {
    activeYears[String(y)] = true;
    const li = document.createElement('li');
    li.innerHTML = `<label class="dropdown-item small d-flex align-items-center gap-2 mb-0" style="cursor:pointer;">
      <input type="checkbox" class="form-check-input year-checkbox" value="${y}" checked> ${y}
    </label>`;
    menu.appendChild(li);
  }

  // Wire up checkbox changes — instant filter with cached markers
  menu.querySelectorAll('.year-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      activeYears[cb.value] = cb.checked;
      updateYearDropdownLabel();
      updateMap();
    });
  });

  // Wire up select all / deselect all
  document.getElementById('yearToggleAll').addEventListener('click', (e) => {
    e.preventDefault();
    const allChecked = Object.values(activeYears).every(v => v);
    const newState = !allChecked;
    menu.querySelectorAll('.year-checkbox').forEach(cb => {
      cb.checked = newState;
      activeYears[cb.value] = newState;
    });
    updateYearDropdownLabel();
    updateMap();
  });

  updateYearDropdownLabel();
}

function updateYearDropdownLabel() {
  const btn = document.getElementById('yearDropdownBtn');
  const allYears = Object.keys(activeYears);
  const selected = allYears.filter(y => activeYears[y]);

  if (selected.length === 0) {
    btn.textContent = 'No Years';
  } else if (selected.length === allYears.length) {
    btn.textContent = 'All Years';
  } else if (selected.length <= 3) {
    btn.textContent = selected.sort((a, b) => b - a).join(', ');
  } else {
    btn.textContent = selected.length + ' Years';
  }
}

function getTransactionYear(txn) {
  if (!txn.date) return null;
  const parts = txn.date.split('/');
  if (parts.length === 3) return parseInt(parts[2]); // M/D/YYYY
  return new Date(txn.date).getFullYear();
}

// ── Map Rendering ──
function getFilteredTransactions() {
  const anyYearActive = Object.values(activeYears).some(v => v);
  return allTransactions.filter(t => {
    if (!activeLayers[t.layer]) return false;
    if (anyYearActive) {
      const year = getTransactionYear(t);
      if (year && !activeYears[String(year)]) return false;
    }
    return true;
  });
}

/**
 * Build all markers once and cache them by layer + year.
 * Called once after data loads — never recreates marker objects.
 */
function buildMarkers() {
  markerCache = { shipped: {}, open: {}, converted: {}, lost: {} };

  for (const txn of allTransactions) {
    const coords = getCoords(txn.city, txn.state);
    if (!coords) continue;

    const layer = txn.layer;
    if (!markerCache[layer]) continue;

    const year = String(getTransactionYear(txn) || 'unknown');
    if (!markerCache[layer][year]) markerCache[layer][year] = [];

    const jitter = () => (Math.random() - 0.5) * 0.02;
    const lat = coords[0] + jitter();
    const lng = coords[1] + jitter();
    const color = LAYER_COLORS[layer] || '#666';

    const marker = L.circleMarker([lat, lng], {
      radius: 7,
      fillColor: color,
      color: '#fff',
      weight: 2,
      fillOpacity: 0.85
    });

    marker._txnData = txn;
    marker.on('click', () => showTransactionDetail(txn));
    const label = escapeHtml(txn.customerName || txn.tranId || '').substring(0, 50);
    if (label) marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });

    markerCache[layer][year].push(marker);
  }
}

/**
 * Fast filter update — swaps pre-built markers in/out of cluster groups.
 * No marker creation happens here, just addLayers/clearLayers.
 */
function updateMap() {
  const anyYearActive = Object.values(activeYears).some(v => v);

  for (const layerName of Object.keys(markerLayers)) {
    markerLayers[layerName].clearLayers();

    if (!activeLayers[layerName]) continue;

    const yearBuckets = markerCache[layerName] || {};
    const markersToAdd = [];

    for (const [year, markers] of Object.entries(yearBuckets)) {
      if (anyYearActive && year !== 'unknown' && !activeYears[year]) continue;
      markersToAdd.push(...markers);
    }

    if (markersToAdd.length > 0) {
      markerLayers[layerName].addLayers(markersToAdd);
    }
  }

  updateStats(getFilteredTransactions());
}

function getCoords(city, state) {
  if (!geoData) return null;

  if (city && state) {
    const key = `${city},${state}`;
    if (geoData.cities[key]) return geoData.cities[key];

    const keyLower = key.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      if (k.toLowerCase() === keyLower) return v;
    }

    const cityLower = city.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      const parts = k.split(',');
      if (parts[1] === state && parts[0].toLowerCase().includes(cityLower)) return v;
    }
  }

  if (state && geoData.stateCentroids[state]) {
    return geoData.stateCentroids[state];
  }

  return null;
}

// ── Cluster Click → Record List ──
function showClusterList(txns, layerName) {
  const color = LAYER_COLORS[layerName] || '#666';
  const label = LAYER_LABELS[layerName] || layerName;
  const location = txns[0] ? [txns[0].city, txns[0].state].filter(Boolean).join(', ') : '';

  currentListTransactions = txns;
  lastViewedLayer = layerName;

  const sidebar = document.getElementById('sidebarContent');
  const title = document.getElementById('sidebarTitle');
  title.innerHTML = `<i class="bi bi-geo-alt-fill" style="color:${color}"></i> ${location || label} (${txns.length})`;

  let html = '<div class="p-2" style="max-height:500px; overflow-y:auto;">';
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i];
    const amt = t.total > 0 ? '$' + Number(t.total).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '';
    const tColor = LAYER_COLORS[t.layer] || '#666';
    html += `<div class="p-2 border-bottom" style="cursor:pointer;" onclick="showTransactionDetailByIndex(${i})" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="fw-bold small">${escapeHtml((t.customerName || t.tranId || 'Unknown').substring(0, 40))}</div>
          <small class="text-muted">${escapeHtml([t.city, t.state].filter(Boolean).join(', '))}</small>
        </div>
        <div class="text-end">
          <span class="badge" style="background:${tColor}; color:white; font-size:0.65rem;">${LAYER_LABELS[t.layer] || t.layer}</span>
          ${amt ? `<div class="small fw-bold text-success mt-1">${amt}</div>` : ''}
        </div>
      </div>
    </div>`;
  }
  html += '</div>';
  sidebar.innerHTML = html;
}

// ── Stat Tile Click → Full Transaction List ──
function showTransactionList(layer) {
  const filtered = getFilteredTransactions();
  const txns = layer === 'all' ? filtered : filtered.filter(t => t.layer === layer);

  if (txns.length === 0) return;

  const color = LAYER_COLORS[layer] || '#475569';
  const label = layer === 'all' ? 'All Transactions' : (LAYER_LABELS[layer] || layer);

  // Sort by date descending
  txns.sort((a, b) => {
    const da = a.date ? new Date(a.date) : new Date(0);
    const db = b.date ? new Date(b.date) : new Date(0);
    return db - da;
  });

  currentListTransactions = txns;
  lastViewedLayer = layer;

  const sidebar = document.getElementById('sidebarContent');
  const title = document.getElementById('sidebarTitle');
  title.innerHTML = `<i class="bi bi-list-ul" style="color:${color}"></i> ${label} (${txns.length})`;

  let html = '<div class="p-2" style="max-height:500px; overflow-y:auto;">';
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i];
    const amt = t.total > 0 ? '$' + Number(t.total).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '';
    const tColor = LAYER_COLORS[t.layer] || '#666';
    html += `<div class="p-2 border-bottom" style="cursor:pointer;" onclick="showTransactionDetailByIndex(${i})" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="fw-bold small">${escapeHtml((t.customerName || t.tranId || 'Unknown').substring(0, 40))}</div>
          <small class="text-muted">${escapeHtml([t.city, t.state].filter(Boolean).join(', '))}</small>
          ${t.date ? `<br><small class="text-muted">${escapeHtml(t.date)}</small>` : ''}
        </div>
        <div class="text-end">
          <span class="badge" style="background:${tColor}; color:white; font-size:0.65rem;">${LAYER_LABELS[t.layer] || t.layer}</span>
          ${amt ? `<div class="small fw-bold text-success mt-1">${amt}</div>` : ''}
        </div>
      </div>
    </div>`;
  }
  html += '</div>';
  sidebar.innerHTML = html;
}

function showTransactionDetailByIndex(index) {
  const txn = currentListTransactions[index];
  if (txn) showTransactionDetail(txn);
}

// ── Transaction Detail ──
function showTransactionDetail(txn) {
  const sidebar = document.getElementById('sidebarContent');
  const title = document.getElementById('sidebarTitle');
  const layer = txn.layer || 'shipped';
  const color = LAYER_COLORS[layer];
  const layerLabel = LAYER_LABELS[layer] || layer;

  title.innerHTML = `<i class="bi bi-receipt" style="color:${color}"></i> Transaction Details`;

  let html = '<div class="p-3">';

  // Back to list button
  if (lastViewedLayer !== null) {
    html += `<button class="btn btn-sm btn-outline-secondary mb-2" onclick="backToList()"><i class="bi bi-arrow-left"></i> Back to list</button>`;
  }

  if (txn.customerName) {
    html += `<h5 class="mb-1">${escapeHtml(txn.customerName)}</h5>`;
  }

  html += `<span class="badge" style="background:${color}; color:white;">${layerLabel}</span>`;
  if (txn.tranId) {
    html += ` <span class="badge bg-secondary">${escapeHtml(txn.tranId)}</span>`;
  }

  html += '<div class="mt-3">';

  if (txn.total > 0) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Amount</small>
      <small class="fw-bold text-success">$${Number(txn.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>
    </div>`;
  }

  if (txn.date) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Date</small>
      <small>${escapeHtml(txn.date)}</small>
    </div>`;
  }

  if (txn.repName) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Sales Rep</small>
      <small>${escapeHtml(txn.repName)}</small>
    </div>`;
  }

  const addrParts = [txn.street, txn.city, txn.state, txn.zip].filter(Boolean);
  if (addrParts.length) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Ship To</small>
      <small class="text-end">${escapeHtml(addrParts.join(', '))}</small>
    </div>`;
  }

  if (txn.hqCity || txn.hqState) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">HQ</small>
      <small>${escapeHtml([txn.hqCity, txn.hqState].filter(Boolean).join(', '))}</small>
    </div>`;
  }

  if (txn.vertical) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Vertical</small>
      <small>${escapeHtml(txn.vertical)}</small>
    </div>`;
  }

  if (txn.leadSource) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Lead Source</small>
      <small>${escapeHtml(txn.leadSource)}</small>
    </div>`;
  }

  html += '</div>';

  // Quote pipeline
  if (txn.type === 'Estimate') {
    html += '<div class="mt-3"><h6 class="text-muted small fw-bold">QUOTE PIPELINE</h6>';
    if (txn.nsStatus) html += detailRow('NS Status', `<span class="fw-bold">${escapeHtml(txn.nsStatus)}</span>`);
    if (txn.probability != null) html += detailRow('Probability', escapeHtml(String(txn.probability)));
    if (txn.daysOpen != null) html += detailRow('Days Open', txn.daysOpen);
    if (txn.linkedSO) html += detailRow('Linked SO', `<span class="text-primary">${escapeHtml(txn.linkedSO)}</span>`);
    if (txn.dateConverted) html += detailRow('Date Converted', escapeHtml(txn.dateConverted));
    if (txn.contactEmail) html += detailRow('Contact', `<a href="mailto:${escapeHtml(txn.contactEmail)}">${escapeHtml(txn.contactEmail)}</a>`);
    if (txn.lostReason) html += detailRow('Lost Reason', `<span class="text-danger">${escapeHtml(txn.lostReason)}</span>`);
    if (txn.reasonForLoss) html += detailRow('Details', `<span class="text-end">${escapeHtml(txn.reasonForLoss)}</span>`);
    if (txn.isBid) html += detailRow('Is Bid', 'Yes');
    if (txn.firstQuote) html += detailRow('First Quote', '<span class="text-info">Yes</span>');
    html += '</div>';
  }

  if (txn.type === 'SalesOrd' && txn.firstOrder) {
    html += `<div class="mt-2"><span class="badge bg-info">First Order</span></div>`;
  }

  // Line items
  if (txn.items && txn.items.length > 0) {
    html += '<div class="mt-3"><h6 class="text-muted small fw-bold">LINE ITEMS</h6>';
    html += '<table class="table table-sm table-borderless mb-0" style="font-size:0.78rem;">';
    html += '<thead><tr><th>Item</th><th class="text-end">Qty</th><th class="text-end">Amt</th></tr></thead><tbody>';
    for (const item of txn.items) {
      const itemCode = item.itemId || item.partNumber || item.itemNumber || '?';
      html += `<tr>
        <td><strong>${escapeHtml(itemCode)}</strong></td>
        <td class="text-end">${item.qty || ''}</td>
        <td class="text-end">$${Number(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>`;
      if (item.description) {
        html += `<tr><td colspan="3" class="text-muted pt-0" style="font-size:0.7rem;">${escapeHtml(item.description).substring(0, 100)}</td></tr>`;
      }
    }
    html += '</tbody></table></div>';
  }

  if (txn.memo) {
    html += `<div class="mt-3 p-2" style="background:#f8fafc; border-radius:8px;"><small class="text-muted"><strong>Memo:</strong> ${escapeHtml(txn.memo)}</small></div>`;
  }

  html += '</div>';
  sidebar.innerHTML = html;
}

function detailRow(label, value) {
  return `<div class="d-flex justify-content-between border-bottom py-1"><small class="text-muted">${label}</small><small>${value}</small></div>`;
}

function backToList() {
  if (lastViewedLayer !== null) {
    // Re-render the last list
    if (currentListTransactions.length > 0 && currentListTransactions[0].city) {
      // Was a cluster list — re-show it
      const layerName = lastViewedLayer;
      showClusterList(currentListTransactions, layerName);
    } else {
      showTransactionList(lastViewedLayer);
    }
  }
}

// ── Layer Toggle ──
function toggleLayer(btn) {
  const layer = btn.dataset.stage;
  activeLayers[layer] = !activeLayers[layer];

  if (activeLayers[layer]) {
    btn.classList.add('active');
    btn.style.opacity = '1';
    if (markerLayers[layer] && !map.hasLayer(markerLayers[layer])) {
      map.addLayer(markerLayers[layer]);
    }
  } else {
    btn.classList.remove('active');
    btn.style.opacity = '0.4';
    if (markerLayers[layer] && map.hasLayer(markerLayers[layer])) {
      map.removeLayer(markerLayers[layer]);
    }
  }

  updateMap();
}

// ── Stats ──
function fmtDollars(n) {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

function updateStats(filtered) {
  const shipped = filtered.filter(t => t.layer === 'shipped');
  const open = filtered.filter(t => t.layer === 'open');
  const converted = filtered.filter(t => t.layer === 'converted');
  const lost = filtered.filter(t => t.layer === 'lost');

  const totalRevenue = shipped.reduce((s, t) => s + t.total, 0);
  const openValue = open.reduce((s, t) => s + t.total, 0);
  const convertedValue = converted.reduce((s, t) => s + t.total, 0);
  const lostValue = lost.reduce((s, t) => s + t.total, 0);

  document.getElementById('statTotal').textContent = filtered.length.toLocaleString();
  document.getElementById('statShipped').textContent = shipped.length.toLocaleString();
  document.getElementById('statOpen').textContent = open.length.toLocaleString();
  document.getElementById('statConverted').textContent = converted.length.toLocaleString();
  document.getElementById('statLost').textContent = lost.length.toLocaleString();

  document.getElementById('statRevenue').textContent = fmtDollars(totalRevenue);
  document.getElementById('statOpenValue').textContent = fmtDollars(openValue);
  document.getElementById('statConvertedValue').textContent = fmtDollars(convertedValue);
  document.getElementById('statLostValue').textContent = fmtDollars(lostValue);

  const totalDecided = converted.length + lost.length;
  const convRate = totalDecided > 0 ? ((converted.length / totalDecided) * 100).toFixed(1) : '--';
  document.getElementById('statConvRate').textContent = convRate + '% conv rate';
}

// ── NetSuite Sync ──
async function loadSyncStatus() {
  try {
    const resp = await fetch('/api/netsuite-sync-status');
    const status = await resp.json();
    const el = document.getElementById('syncStatus');

    if (!status.available) {
      el.innerHTML = '<i class="bi bi-database-x"></i> DB unavailable';
      return;
    }

    if (status.lastSync) {
      const ago = timeSince(new Date(status.lastSync));
      const countLabel = status.totalTransactions ? ` &middot; ${Number(status.totalTransactions).toLocaleString()} records` : '';
      const statusIcon = status.lastStatus === 'success'
        ? '<i class="bi bi-check-circle text-success"></i>'
        : '<i class="bi bi-exclamation-circle text-danger"></i>';
      el.innerHTML = `${statusIcon} Synced ${ago} ago${countLabel}`;
    } else {
      el.innerHTML = '<i class="bi bi-info-circle"></i> Never synced — data from initial seed';
    }
  } catch (e) {
    // Silently ignore
  }
}

async function triggerNetSuiteSync() {
  const btn = document.getElementById('syncBtn');
  const icon = document.getElementById('syncIcon');
  const statusEl = document.getElementById('syncStatus');

  // Check sync status first — if DB isn't available, don't attempt
  try {
    const checkResp = await fetch('/api/netsuite-sync-status');
    const checkStatus = await checkResp.json();
    if (!checkStatus.available) {
      statusEl.innerHTML = '<i class="bi bi-exclamation-circle text-warning"></i> Database not available — sync requires PostgreSQL';
      return;
    }
  } catch (e) { /* proceed anyway */ }

  btn.disabled = true;
  icon.classList.add('spin-animation');
  statusEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Syncing with NetSuite...';

  try {
    const resp = await fetch('/api/netsuite-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await resp.json();

    if (result.success) {
      const totalFetched = result.sales.fetched + result.estimates.fetched;
      const totalUpserted = result.sales.upserted + result.estimates.upserted;
      statusEl.innerHTML = `<i class="bi bi-check-circle text-success"></i> Synced: ${totalFetched} fetched, ${totalUpserted} updated (${(result.durationMs / 1000).toFixed(1)}s)`;

      // Reload map data if anything was updated
      if (totalUpserted > 0) {
        loadData();
      }
    } else {
      statusEl.innerHTML = `<i class="bi bi-exclamation-circle text-danger"></i> Sync failed: ${escapeHtml(result.error || 'Unknown error')}`;
    }
  } catch (e) {
    statusEl.innerHTML = `<i class="bi bi-exclamation-circle text-danger"></i> Sync error: ${escapeHtml(e.message)}`;
  }

  btn.disabled = false;
  icon.classList.remove('spin-animation');
}

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  return days + 'd';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
