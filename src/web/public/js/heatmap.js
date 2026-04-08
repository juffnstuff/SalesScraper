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

const STAGE_LABELS = {
  parking: 'Parking Lot Safety',
  industrial: 'Industrial Safety',
  municipal: 'Municipal / Traffic Calming',
  construction: 'Construction'
};

// Global state
let map;
let allProjects = [];
let geoData = null;
let markerLayers = {
  parking: null,
  industrial: null,
  municipal: null,
  construction: null
};
let activeStages = { parking: true, industrial: true, municipal: true, construction: true };
let lastViewedStage = null; // for "Back to list" navigation
let currentListProjects = []; // current list being displayed in sidebar

const US_STATES_GEOJSON = '/data/us-states.json';

// ── Initialize ──
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

  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
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
  for (const stage of Object.keys(markerLayers)) {
    markerLayers[stage].clearLayers();
  }

  for (const project of allProjects) {
    const coords = getCoords(project.city, project.state);
    if (!coords) continue;

    const stage = project.lifecycleStage || 'construction';
    const color = STAGE_COLORS[stage] || STAGE_COLORS.construction;

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

    const label = escapeHtml(project.projectName).substring(0, 50);
    marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });

    if (markerLayers[stage]) {
      markerLayers[stage].addLayer(marker);
    }
  }

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

// ── Project List (clickable stat cards) ──
function showProjectList(stage) {
  lastViewedStage = stage;
  const filtered = stage === 'all'
    ? allProjects
    : allProjects.filter(p => p.lifecycleStage === stage);

  currentListProjects = filtered;
  const label = stage === 'all' ? 'All Projects' : STAGE_LABELS[stage] || stage;
  const color = STAGE_COLORS[stage] || '#1e293b';

  const title = document.getElementById('sidebarTitle');
  title.innerHTML = `<i class="bi bi-list-ul" style="color:${color}"></i> ${label} (${filtered.length})`;
  document.getElementById('backToListBtn').classList.add('d-none');

  const sidebar = document.getElementById('sidebarContent');

  if (filtered.length === 0) {
    sidebar.innerHTML = '<div class="text-center text-muted py-4"><p>No projects in this category.</p></div>';
    return;
  }

  let html = '';
  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i];
    const stColor = STAGE_COLORS[p.lifecycleStage] || '#ea580c';
    const value = p.estimatedValue > 0 ? `<span class="text-success fw-bold">$${Number(p.estimatedValue).toLocaleString()}</span>` : '';
    const location = [p.city, p.state].filter(Boolean).join(', ');
    const hasContractors = p.contractors && p.contractors.length > 0;

    html += `<div class="project-list-item" onclick="showProjectDetailByIndex(${i})">
      <div class="d-flex justify-content-between align-items-start">
        <strong class="small" style="line-height:1.3;">${escapeHtml(p.projectName).substring(0, 60)}</strong>
        <span class="badge ms-1 flex-shrink-0" style="background:${stColor};color:white;font-size:0.6rem;">${p.lifecycleStage}</span>
      </div>
      <div class="d-flex justify-content-between align-items-center mt-1">
        <small class="text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(location)}</small>
        ${value ? `<small>${value}</small>` : ''}
      </div>
      ${hasContractors ? '<small class="text-success"><i class="bi bi-people-fill"></i> Contractors found</small>' : ''}
    </div>`;
  }

  sidebar.innerHTML = html;
}

function showProjectDetailByIndex(index) {
  const project = currentListProjects[index];
  if (project) showProjectDetail(project);
}

function backToList() {
  if (lastViewedStage !== null) {
    showProjectList(lastViewedStage);
  }
}

// ── Project Detail (marker click or list click) ──
function showProjectDetail(project) {
  const sidebar = document.getElementById('sidebarContent');
  const title = document.getElementById('sidebarTitle');
  const stage = project.lifecycleStage || 'construction';
  const color = STAGE_COLORS[stage];

  title.innerHTML = `<i class="bi bi-geo-alt-fill" style="color:${color}"></i> Project Details`;

  // Show back button if we came from a list
  const backBtn = document.getElementById('backToListBtn');
  if (lastViewedStage !== null) {
    backBtn.classList.remove('d-none');
  } else {
    backBtn.classList.add('d-none');
  }

  let html = '<div class="p-3">';

  // Project name
  html += `<h6 class="mb-1">${escapeHtml(project.projectName)}</h6>`;
  html += `<span class="badge" style="background:${color}; color:white; font-size:0.7rem;">${STAGE_LABELS[stage] || stage}</span>`;

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

  // Contractors section
  if (project.contractors && project.contractors.length > 0) {
    html += '<div class="mt-3 border-top pt-2">';
    html += '<strong class="small"><i class="bi bi-people-fill text-success"></i> Contractors / Bidders:</strong>';
    for (const c of project.contractors) {
      html += '<div class="contractor-card">';
      html += `<div class="fw-bold small">${escapeHtml(c.name)}</div>`;
      if (c.role) html += `<small class="text-muted">${escapeHtml(c.role)}</small>`;
      if (c.website) html += `<br><a href="${escapeHtml(c.website)}" target="_blank" class="small">${escapeHtml(c.website)}</a>`;
      if (c.phone) html += `<br><small><i class="bi bi-telephone"></i> ${escapeHtml(c.phone)}</small>`;
      html += '</div>';
    }
    html += '</div>';
  } else {
    // Find Contractors button
    const pName = escapeHtml(project.projectName).replace(/'/g, "\\'");
    const pState = escapeHtml(project.state || '');
    html += `<div class="mt-3 border-top pt-2">
      <button class="btn btn-sm btn-outline-success w-100" id="contractorBtn" onclick="findContractors('${pName}', '${pState}')">
        <i class="bi bi-search"></i> Find Contractors / Bidders
      </button>
      <small class="text-muted d-block text-center mt-1">Uses AI web search to find who won the bid</small>
    </div>`;
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

// ── Contractor Discovery ──
async function findContractors(projectName, state) {
  const btn = document.getElementById('contractorBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Searching...';

  try {
    const resp = await fetch('/api/heatmap-contractor-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, state })
    });
    const data = await resp.json();

    if (data.success && data.contractors && data.contractors.length > 0) {
      // Update the project in allProjects and re-render detail
      const project = allProjects.find(p => p.projectName === projectName && p.state === state);
      if (project) {
        project.contractors = data.contractors;
        project.contractorSearched = true;
        showProjectDetail(project);
      }
    } else {
      btn.innerHTML = '<i class="bi bi-x-circle"></i> No contractors found';
      btn.classList.replace('btn-outline-success', 'btn-outline-warning');
      btn.disabled = false;
    }
  } catch (e) {
    btn.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Search failed';
    btn.disabled = false;
  }
}

// ── Stage Toggle ──
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

// ── Quick Scan (existing national) ──
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
      mergeProjects(data.projects);
      alert(`Quick scan complete! Found ${data.projects.length} projects (${data.newProjects || 0} new).`);
    } else {
      alert('Scan completed but found no results. Try again later.');
    }
  } catch (e) {
    btn.classList.remove('scanning');
    btn.disabled = false;
    alert('Scan failed: ' + e.message);
  }
}

// ── Deep Scan (regional, state-by-state) ──
async function scanRegional() {
  const btn = document.getElementById('regionalScanBtn');
  btn.classList.add('regional-scanning');
  btn.disabled = true;
  document.getElementById('scanBtn').disabled = true;

  const regions = ['Northeast','Southeast','Midwest-East','Midwest-West','South-Central','Mountain','Pacific','Mid-Atlantic'];
  let totalNew = 0;

  try {
    for (let i = 0; i < regions.length; i++) {
      document.getElementById('regionalProgress').textContent = `${regions[i]} (${i + 1}/${regions.length})`;

      const resp = await fetch('/api/heatmap-scan-regional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regions: [regions[i]] })
      });
      const data = await resp.json();

      if (data.success && data.projects) {
        mergeProjects(data.projects);
        totalNew += data.newProjects || 0;
      }
    }

    alert(`Regional scan complete! ${totalNew} new projects found across ${regions.length} regions.`);
  } catch (e) {
    alert('Regional scan failed: ' + e.message);
  } finally {
    btn.classList.remove('regional-scanning');
    btn.disabled = false;
    document.getElementById('scanBtn').disabled = false;
  }
}

// ── Merge new projects and refresh ──
function mergeProjects(newProjects) {
  const existingKeys = new Set(
    allProjects.map(p => (p.projectName + p.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60))
  );

  for (const p of newProjects) {
    const key = (p.projectName + p.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
    if (!existingKeys.has(key)) {
      allProjects.push(p);
      existingKeys.add(key);
    }
  }

  updateMap();
  updateStats({
    total: allProjects.length,
    parking: allProjects.filter(p => p.lifecycleStage === 'parking').length,
    industrial: allProjects.filter(p => p.lifecycleStage === 'industrial').length,
    municipal: allProjects.filter(p => p.lifecycleStage === 'municipal').length,
    construction: allProjects.filter(p => p.lifecycleStage === 'construction').length
  });
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
