/**
 * RubberForm Prospecting Engine — Heat Map
 * Interactive US construction activity map using Leaflet.js
 */

// Stage colors — RubberForm's 4 market verticals
const STAGE_COLORS = {
  parking: '#2563eb',
  industrial: '#7c3aed',
  municipal: '#16a34a',
  construction: '#ea580c'
};

// Global state
let map;
let allProjects = [];
let geoData = null; // city coords loaded from JSON
let markerLayers = {
  parking: null,
  industrial: null,
  municipal: null,
  construction: null
};
let activeStages = { parking: true, industrial: true, municipal: true, construction: true };

// US state boundary GeoJSON URL (simplified, free)
const US_STATES_GEOJSON = '/data/us-states.json';

// ── Initialize ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load city coordinates
  try {
    const resp = await fetch('/data/us_cities_coords.json');
    geoData = await resp.json();
  } catch (e) {
    console.warn('Could not load city coords:', e);
    geoData = { cities: {}, stateCentroids: {} };
  }

  initMap();
  loadData();

  // Filter event listeners
  document.querySelectorAll('.stage-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleStage(btn));
  });
  document.getElementById('timeRange').addEventListener('change', () => loadData());
});

function initMap() {
  map = L.map('heatmap', {
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
  tileLayer.on('tileerror', () => {});
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

  // Initialize marker cluster groups for each stage
  for (const stage of Object.keys(STAGE_COLORS)) {
    markerLayers[stage] = L.markerClusterGroup({
      maxClusterRadius: 40,
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        const color = STAGE_COLORS[stage];
        return L.divIcon({
          html: `<div style="background:${color}; color:white; border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.3);">${count}</div>`,
          className: '',
          iconSize: [36, 36]
        });
      }
    });
    map.addLayer(markerLayers[stage]);
  }
}

async function loadData() {
  const days = document.getElementById('timeRange').value;
  try {
    const resp = await fetch(`/api/heatmap-data?days=${days}`);
    const data = await resp.json();
    allProjects = data.projects || [];
    updateMap();
    updateStats(data.summary || {});
  } catch (e) {
    console.error('Failed to load heatmap data:', e);
  }
}

function updateMap() {
  // Clear all layers
  for (const stage of Object.keys(markerLayers)) {
    markerLayers[stage].clearLayers();
  }

  for (const project of allProjects) {
    const coords = getCoords(project.city, project.state);
    if (!coords) continue;

    const stage = project.lifecycleStage || 'construction';
    const color = STAGE_COLORS[stage] || STAGE_COLORS.construction;

    // Add slight jitter to prevent exact overlaps
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

    marker.on('click', () => showProjectDetail(project));

    // Tooltip on hover
    const label = escapeHtml(project.projectName).substring(0, 50);
    marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });

    if (markerLayers[stage]) {
      markerLayers[stage].addLayer(marker);
    }
  }

  // Apply active stage filters
  for (const stage of Object.keys(activeStages)) {
    if (activeStages[stage]) {
      if (!map.hasLayer(markerLayers[stage])) map.addLayer(markerLayers[stage]);
    } else {
      if (map.hasLayer(markerLayers[stage])) map.removeLayer(markerLayers[stage]);
    }
  }
}

function getCoords(city, state) {
  if (!geoData) return null;

  // Try exact city,state match
  if (city && state) {
    const key = `${city},${state}`;
    if (geoData.cities[key]) return geoData.cities[key];

    // Try case-insensitive match
    const keyLower = key.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      if (k.toLowerCase() === keyLower) return v;
    }

    // Try partial city match (e.g. "San Francisco" in "San Francisco,CA")
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

function showProjectDetail(project) {
  const sidebar = document.getElementById('sidebarContent');
  const title = document.getElementById('sidebarTitle');
  const stage = project.lifecycleStage || 'construction';
  const color = STAGE_COLORS[stage];
  const stageLabel = {
    parking: 'Parking Lot Safety',
    industrial: 'Industrial Safety',
    municipal: 'Municipal / Traffic Calming',
    construction: 'Construction'
  }[stage] || stage;

  title.innerHTML = `<i class="bi bi-geo-alt-fill" style="color:${color}"></i> Project Details`;

  let html = '<div class="p-3">';

  // Project name
  html += `<h6 class="mb-1">${escapeHtml(project.projectName)}</h6>`;
  html += `<span class="badge" style="background:${color}; color:white; font-size:0.7rem;">${stageLabel}</span>`;

  // Location
  const location = [project.city, project.state].filter(Boolean).join(', ');
  if (location) {
    html += `<div class="mt-2"><small class="text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(location)}</small></div>`;
  }

  // Type
  if (project.projectType) {
    html += `<div class="mt-1"><small class="text-muted"><i class="bi bi-tag"></i> ${escapeHtml(project.projectType)}</small></div>`;
  }

  // Value
  if (project.estimatedValue && project.estimatedValue > 0) {
    html += `<div class="mt-1"><small class="text-success fw-bold"><i class="bi bi-currency-dollar"></i> $${Number(project.estimatedValue).toLocaleString()}</small></div>`;
  }

  // Bid Date
  if (project.bidDate) {
    html += `<div class="mt-1"><small class="text-muted"><i class="bi bi-calendar"></i> ${escapeHtml(project.bidDate)}</small></div>`;
  }

  // Owner
  if (project.owner) {
    html += `<div class="mt-2"><small><strong>Owner:</strong> ${escapeHtml(project.owner)}</small></div>`;
  }

  // GC
  if (project.generalContractor) {
    html += `<div class="mt-1"><small><strong>GC:</strong> ${escapeHtml(project.generalContractor)}</small></div>`;
  }

  // Score
  if (project.relevanceScore > 0) {
    const scoreClass = project.relevanceScore >= 85 ? 'score-high' : project.relevanceScore >= 60 ? 'score-mid' : 'score-low';
    html += `<div class="mt-2"><span class="score-badge ${scoreClass}">${project.relevanceScore}</span> <small class="text-muted">relevance</small></div>`;
  }

  // Notes
  if (project.notes) {
    html += `<div class="mt-2 p-2" style="background:#f8fafc; border-radius:8px;"><small class="text-muted">${escapeHtml(project.notes)}</small></div>`;
  }

  // Source link
  if (project.sourceUrl) {
    html += `<div class="mt-2"><a href="${escapeHtml(project.sourceUrl)}" target="_blank" class="btn btn-sm btn-outline-primary w-100"><i class="bi bi-box-arrow-up-right"></i> View Source</a></div>`;
  }

  // Source
  if (project.source) {
    html += `<div class="mt-1 text-center"><small class="text-muted">via ${escapeHtml(project.source)}</small></div>`;
  }

  html += '</div>';
  sidebar.innerHTML = html;
}

function toggleStage(btn) {
  const stage = btn.dataset.stage;
  activeStages[stage] = !activeStages[stage];

  if (activeStages[stage]) {
    btn.classList.add('active');
    btn.style.opacity = '1';
    if (!map.hasLayer(markerLayers[stage])) map.addLayer(markerLayers[stage]);
  } else {
    btn.classList.remove('active');
    btn.style.opacity = '0.4';
    if (map.hasLayer(markerLayers[stage])) map.removeLayer(markerLayers[stage]);
  }
}

async function scanForNews() {
  const btn = document.getElementById('scanBtn');
  btn.classList.add('scanning');
  btn.disabled = true;

  try {
    const resp = await fetch('/api/heatmap-scan', { method: 'POST' });
    const data = await resp.json();

    btn.classList.remove('scanning');
    btn.disabled = false;

    if (data.success && data.projects) {
      // Merge new projects and refresh map
      const existingKeys = new Set(
        allProjects.map(p => (p.projectName + p.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60))
      );

      let newCount = 0;
      for (const p of data.projects) {
        const key = (p.projectName + p.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
        if (!existingKeys.has(key)) {
          allProjects.push(p);
          existingKeys.add(key);
          newCount++;
        }
      }

      updateMap();
      updateStats({
        total: allProjects.length,
        construction: allProjects.filter(p => p.lifecycleStage === 'construction').length,
        parking_industrial: allProjects.filter(p => p.lifecycleStage === 'parking_industrial').length,
        municipal: allProjects.filter(p => p.lifecycleStage === 'municipal').length
      });

      alert(`Scan complete! Found ${data.projects.length} projects (${newCount} new).`);
    } else {
      alert('Scan completed but found no results. Try again later.');
    }
  } catch (e) {
    btn.classList.remove('scanning');
    btn.disabled = false;
    alert('Scan failed: ' + e.message);
  }
}

function updateStats(summary) {
  document.getElementById('statTotal').textContent = summary.total || 0;
  document.getElementById('statParking').textContent = summary.parking || 0;
  document.getElementById('statIndustrial').textContent = summary.industrial || 0;
  document.getElementById('statMunicipal').textContent = summary.municipal || 0;
  document.getElementById('statConstruction').textContent = summary.construction || 0;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
