/**
 * RubberForm Prospecting Engine — Sales Map
 * Interactive US map showing NetSuite sales orders and quotes by shipping address.
 */

// Layer colors
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
let markerLayers = {};
let activeLayers = { shipped: true, open: true, converted: true, lost: true };

// US state boundary GeoJSON
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

  // Layer toggle buttons
  document.querySelectorAll('.stage-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleLayer(btn));
  });

  // Filter change handlers
  document.getElementById('timeRange').addEventListener('change', () => loadData());
  document.getElementById('repFilter').addEventListener('change', () => loadData());
});

function initMap() {
  map = L.map('salesmap', {
    center: [39.8, -98.5],
    zoom: 4,
    minZoom: 3,
    maxZoom: 12
  });

  // Try CARTO tiles first, fall back to no-tile map if CDN unreachable
  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });
  tileLayer.on('tileerror', () => {}); // Suppress tile load errors silently
  tileLayer.addTo(map);

  // US state boundaries (local GeoJSON — serves as base map when tiles unavailable)
  fetch(US_STATES_GEOJSON)
    .then(r => r.json())
    .then(geojson => {
      L.geoJSON(geojson, {
        style: {
          fillColor: '#e2e8f0',
          fillOpacity: 0.6,
          color: '#94a3b8',
          weight: 1.5
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(feature.properties.name, { sticky: true, className: 'state-tooltip' });
          layer.on('mouseover', function() {
            this.setStyle({ fillOpacity: 0.8, weight: 2.5, color: '#64748b' });
          });
          layer.on('mouseout', function() {
            this.setStyle({ fillOpacity: 0.6, weight: 1.5, color: '#94a3b8' });
          });
        }
      }).addTo(map);
    })
    .catch(e => console.warn('Could not load state boundaries:', e));

  // Initialize marker cluster groups for each layer
  for (const layer of Object.keys(LAYER_COLORS)) {
    markerLayers[layer] = L.markerClusterGroup({
      maxClusterRadius: 40,
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        const color = LAYER_COLORS[layer];
        return L.divIcon({
          html: `<div style="background:${color}; color:white; border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.3);">${count}</div>`,
          className: '',
          iconSize: [36, 36]
        });
      }
    });
    map.addLayer(markerLayers[layer]);
  }
}

async function loadData() {
  const days = document.getElementById('timeRange').value;
  const repId = document.getElementById('repFilter').value;

  // Show loading indicator
  document.getElementById('loadingIndicator').style.display = 'inline';
  document.getElementById('cacheIndicator').style.display = 'none';

  try {
    const resp = await fetch(`/api/salesmap-data?days=${days}&repId=${repId}`);
    const data = await resp.json();
    allTransactions = data.transactions || [];

    document.getElementById('loadingIndicator').style.display = 'none';

    if (data.error) {
      document.getElementById('cacheIndicator').style.display = 'inline';
      document.getElementById('cacheAge').textContent = 'NetSuite error: ' + data.error;
    }

    updateMap();
    updateStats(data.summary || {});
  } catch (e) {
    document.getElementById('loadingIndicator').style.display = 'none';
    console.error('Failed to load sales map data:', e);
  }
}

function updateMap() {
  // Clear all layers
  for (const layer of Object.keys(markerLayers)) {
    markerLayers[layer].clearLayers();
  }

  for (const txn of allTransactions) {
    const coords = getCoords(txn.city, txn.state);
    if (!coords) continue;

    const layer = txn.layer || 'shipped';
    const color = LAYER_COLORS[layer] || LAYER_COLORS.shipped;

    // Slight jitter to prevent exact overlaps
    const jitter = () => (Math.random() - 0.5) * 0.02;
    const lat = coords[0] + jitter();
    const lng = coords[1] + jitter();

    const marker = L.circleMarker([lat, lng], {
      radius: 7,
      fillColor: color,
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    });

    marker.on('click', () => showTransactionDetail(txn));

    const label = escapeHtml(txn.customerName || txn.tranId).substring(0, 50);
    marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });

    if (markerLayers[layer]) {
      markerLayers[layer].addLayer(marker);
    }
  }

  // Apply active layer filters
  for (const layer of Object.keys(activeLayers)) {
    if (activeLayers[layer]) {
      if (!map.hasLayer(markerLayers[layer])) map.addLayer(markerLayers[layer]);
    } else {
      if (map.hasLayer(markerLayers[layer])) map.removeLayer(markerLayers[layer]);
    }
  }
}

function getCoords(city, state) {
  if (!geoData) return null;

  // Try exact city,state match
  if (city && state) {
    const key = `${city},${state}`;
    if (geoData.cities[key]) return geoData.cities[key];

    // Case-insensitive match
    const keyLower = key.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      if (k.toLowerCase() === keyLower) return v;
    }

    // Partial city match
    const cityLower = city.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      const parts = k.split(',');
      if (parts[1] === state && parts[0].toLowerCase().includes(cityLower)) return v;
    }
  }

  // Fallback to state centroid
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
    html += `<h6 class="mb-1">${escapeHtml(txn.customerName)}</h6>`;
  }

  // Layer badge
  html += `<span class="badge" style="background:${color}; color:white; font-size:0.7rem;">${layerLabel}</span>`;

  // Transaction number
  if (txn.tranId) {
    html += `<div class="mt-2"><small class="text-muted"><i class="bi bi-hash"></i> ${escapeHtml(txn.tranId)}</small></div>`;
  }

  // Date
  if (txn.date) {
    html += `<div class="mt-1"><small class="text-muted"><i class="bi bi-calendar"></i> ${escapeHtml(txn.date)}</small></div>`;
  }

  // Amount
  if (txn.total > 0) {
    html += `<div class="mt-1"><small class="text-success fw-bold"><i class="bi bi-currency-dollar"></i> $${Number(txn.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small></div>`;
  }

  // Location
  const location = [txn.city, txn.state, txn.zip].filter(Boolean).join(', ');
  if (location) {
    html += `<div class="mt-1"><small class="text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(location)}</small></div>`;
  }

  // Sales rep
  if (txn.repName) {
    html += `<div class="mt-2"><small><strong>Sales Rep:</strong> ${escapeHtml(txn.repName)}</small></div>`;
  }

  // Quote-specific fields
  if (txn.type === 'Estimate') {
    if (txn.status) {
      html += `<div class="mt-1"><small><strong>Status:</strong> ${escapeHtml(txn.status)}</small></div>`;
    }
    if (txn.lostReason) {
      html += `<div class="mt-1"><small><strong>Lost Reason:</strong> ${escapeHtml(txn.lostReason)}</small></div>`;
    }
    if (txn.probability != null) {
      html += `<div class="mt-1"><small><strong>Probability:</strong> ${txn.probability}%</small></div>`;
    }
  }

  // Memo
  if (txn.memo) {
    html += `<div class="mt-2 p-2" style="background:#f8fafc; border-radius:8px;"><small class="text-muted">${escapeHtml(txn.memo)}</small></div>`;
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
    if (!map.hasLayer(markerLayers[layer])) map.addLayer(markerLayers[layer]);
  } else {
    btn.classList.remove('active');
    btn.style.opacity = '0.4';
    if (map.hasLayer(markerLayers[layer])) map.removeLayer(markerLayers[layer]);
  }
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
