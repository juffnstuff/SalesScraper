/**
 * RubberForm Prospecting Engine — Sales Heat Map
 * True density gradient heat map with drill-down detail panel.
 * Uses Leaflet.heat for gradient visualization + invisible markers for click interaction.
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

// Heat map gradient (cool blue → warm yellow → hot red)
const HEAT_GRADIENT = {
  0.2: '#3b82f6',
  0.4: '#06b6d4',
  0.5: '#22c55e',
  0.6: '#eab308',
  0.8: '#f97316',
  1.0: '#ef4444'
};

// Global state
let map;
let allTransactions = [];
let geoData = null;
let heatLayer = null;
let clickMarkerLayer = null;
let activeLayers = { shipped: true, open: true, converted: true, lost: true };

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

  document.querySelectorAll('.stage-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleLayer(btn));
  });
  document.getElementById('timeRange').addEventListener('change', () => loadData());
  document.getElementById('repFilter').addEventListener('change', () => loadData());
});

function initMap() {
  map = L.map('salesmap', {
    center: [39.8, -98.5],
    zoom: 4,
    minZoom: 3,
    maxZoom: 18
  });

  // Tile layer (graceful fallback)
  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO &copy; OSM',
    subdomains: 'abcd',
    maxZoom: 19
  });
  tileLayer.on('tileerror', () => {});
  tileLayer.addTo(map);

  // State boundaries as base map
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

  // Click marker layer (invisible markers for drill-down)
  clickMarkerLayer = L.layerGroup().addTo(map);
}

async function loadData() {
  const days = document.getElementById('timeRange').value;
  const repId = document.getElementById('repFilter').value;

  document.getElementById('loadingIndicator').style.display = 'inline';
  document.getElementById('cacheIndicator').style.display = 'none';

  try {
    const resp = await fetch(`/api/salesmap-data?days=${days}&repId=${repId}`);
    const data = await resp.json();
    allTransactions = data.transactions || [];

    document.getElementById('loadingIndicator').style.display = 'none';

    if (data.error) {
      document.getElementById('cacheIndicator').style.display = 'inline';
      document.getElementById('cacheAge').textContent = 'Error: ' + data.error;
    }

    updateMap();
    updateStats(data.summary || {});
  } catch (e) {
    document.getElementById('loadingIndicator').style.display = 'none';
    console.error('Failed to load sales map data:', e);
  }
}

function updateMap() {
  // Remove old heat layer
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  clickMarkerLayer.clearLayers();

  // Filter by active layers
  const filtered = allTransactions.filter(t => activeLayers[t.layer]);

  // Build heat points: [lat, lng, intensity]
  // Intensity is based on revenue (log scale to avoid outlier domination)
  const heatPoints = [];
  const maxTotal = Math.max(...filtered.map(t => t.total || 1), 1);

  for (const txn of filtered) {
    const coords = getCoords(txn.city, txn.state);
    if (!coords) continue;

    const jitter = () => (Math.random() - 0.5) * 0.03;
    const lat = coords[0] + jitter();
    const lng = coords[1] + jitter();

    // Log-scaled intensity: higher revenue = more heat
    const intensity = 0.3 + 0.7 * (Math.log(1 + (txn.total || 0)) / Math.log(1 + maxTotal));
    heatPoints.push([lat, lng, intensity]);

    // Invisible click marker for drill-down
    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      fillColor: 'transparent',
      color: 'transparent',
      fillOpacity: 0,
      weight: 0
    });
    marker.on('click', () => showTransactionDetail(txn));
    const label = escapeHtml(txn.customerName || txn.tranId || '').substring(0, 50);
    if (label) marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });
    clickMarkerLayer.addLayer(marker);
  }

  // Create heat layer
  if (heatPoints.length > 0) {
    heatLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 20,
      maxZoom: 10,
      max: 1.0,
      minOpacity: 0.35,
      gradient: HEAT_GRADIENT
    }).addTo(map);
  }
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

function showTransactionDetail(txn) {
  const sidebar = document.getElementById('sidebarContent');
  const title = document.getElementById('sidebarTitle');
  const layer = txn.layer || 'shipped';
  const color = LAYER_COLORS[layer];
  const layerLabel = LAYER_LABELS[layer] || layer;

  title.innerHTML = `<i class="bi bi-receipt" style="color:${color}"></i> Transaction Details`;

  let html = '<div class="p-3">';

  // Customer name
  if (txn.customerName) {
    html += `<h5 class="mb-1">${escapeHtml(txn.customerName)}</h5>`;
  }

  // Layer badge + transaction number
  html += `<span class="badge" style="background:${color}; color:white;">${layerLabel}</span>`;
  if (txn.tranId) {
    html += ` <span class="badge bg-secondary">${escapeHtml(txn.tranId)}</span>`;
  }

  // Key details grid
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

  // Ship-to address
  const addrParts = [txn.street, txn.city, txn.state, txn.zip].filter(Boolean);
  if (addrParts.length) {
    html += `<div class="d-flex justify-content-between border-bottom py-1">
      <small class="text-muted">Ship To</small>
      <small class="text-end">${escapeHtml(addrParts.join(', '))}</small>
    </div>`;
  }

  // HQ location
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

  // Quote-specific pipeline section
  if (txn.type === 'Estimate') {
    html += '<div class="mt-3"><h6 class="text-muted small fw-bold">QUOTE PIPELINE</h6>';

    if (txn.nsStatus) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">NS Status</small>
        <small class="fw-bold">${escapeHtml(txn.nsStatus)}</small>
      </div>`;
    }
    if (txn.probability != null) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Probability</small>
        <small>${escapeHtml(String(txn.probability))}</small>
      </div>`;
    }
    if (txn.daysOpen != null) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Days Open</small>
        <small>${txn.daysOpen}</small>
      </div>`;
    }
    if (txn.linkedSO) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Linked SO</small>
        <small class="text-primary">${escapeHtml(txn.linkedSO)}</small>
      </div>`;
    }
    if (txn.dateConverted) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Date Converted</small>
        <small>${escapeHtml(txn.dateConverted)}</small>
      </div>`;
    }
    if (txn.contactEmail) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Contact</small>
        <small><a href="mailto:${escapeHtml(txn.contactEmail)}">${escapeHtml(txn.contactEmail)}</a></small>
      </div>`;
    }
    if (txn.lostReason) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Lost Reason</small>
        <small class="text-danger">${escapeHtml(txn.lostReason)}</small>
      </div>`;
    }
    if (txn.reasonForLoss) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Details</small>
        <small class="text-end">${escapeHtml(txn.reasonForLoss)}</small>
      </div>`;
    }
    if (txn.isBid) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">Is Bid</small>
        <small>Yes</small>
      </div>`;
    }
    if (txn.firstQuote) {
      html += `<div class="d-flex justify-content-between border-bottom py-1">
        <small class="text-muted">First Quote</small>
        <small class="text-info">Yes</small>
      </div>`;
    }
    html += '</div>';
  }

  // Sales-specific
  if (txn.type === 'SalesOrd' && txn.firstOrder) {
    html += `<div class="mt-2"><span class="badge bg-info">First Order</span></div>`;
  }

  // Line items
  if (txn.items && txn.items.length > 0) {
    html += '<div class="mt-3"><h6 class="text-muted small fw-bold">LINE ITEMS</h6>';
    html += '<table class="table table-sm table-borderless mb-0" style="font-size:0.78rem;">';
    html += '<thead><tr><th>Item</th><th class="text-end">Qty</th><th class="text-end">Amt</th></tr></thead><tbody>';
    for (const item of txn.items) {
      html += `<tr>
        <td title="${escapeHtml(item.description || '')}">${escapeHtml(item.itemNumber || '?')}</td>
        <td class="text-end">${item.qty || ''}</td>
        <td class="text-end">$${Number(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>`;
      if (item.description) {
        html += `<tr><td colspan="3" class="text-muted pt-0" style="font-size:0.7rem;">${escapeHtml(item.description).substring(0, 100)}</td></tr>`;
      }
    }
    html += '</tbody></table></div>';
  }

  // Memo
  if (txn.memo) {
    html += `<div class="mt-3 p-2" style="background:#f8fafc; border-radius:8px;"><small class="text-muted"><strong>Memo:</strong> ${escapeHtml(txn.memo)}</small></div>`;
  }

  html += '</div>';
  sidebar.innerHTML = html;
}

function toggleLayer(btn) {
  const layer = btn.dataset.stage;
  activeLayers[layer] = !activeLayers[layer];

  if (activeLayers[layer]) {
    btn.classList.add('active');
    btn.style.opacity = '1';
  } else {
    btn.classList.remove('active');
    btn.style.opacity = '0.4';
  }

  updateMap(); // Rebuild heat layer with new filter
}

function updateStats(summary) {
  document.getElementById('statTotal').textContent = summary.total || 0;
  document.getElementById('statShipped').textContent = summary.shipped || 0;
  document.getElementById('statOpen').textContent = summary.open || 0;
  document.getElementById('statConverted').textContent = summary.converted || 0;
  document.getElementById('statLost').textContent = summary.lost || 0;
  document.getElementById('statRevenue').textContent = '$' + (summary.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
