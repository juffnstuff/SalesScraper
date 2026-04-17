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
let lastListType = null; // 'cluster' or 'stat' — determines how to rebuild on back

const STATE_CODES = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','district of columbia':'DC',
  'florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL',
  'indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA',
  'maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN',
  'mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV',
  'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
  'north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR',
  'pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  'tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA',
  'washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY'
};

function normalizeState(state) {
  if (!state) return '';
  const s = state.trim();
  if (s.length === 2) return s.toUpperCase();
  // Handle "DC/VA" → take first
  if (s.includes('/')) return normalizeState(s.split('/')[0]);
  return STATE_CODES[s.toLowerCase()] || s;
}

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

  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
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
      zoomToBoundsOnClick: false,
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

    // Cluster click → show list of projects in that cluster
    markerLayers[stage].on('clusterclick', function(e) {
      const markers = e.layer.getAllChildMarkers();
      const projects = markers.map(m => m._projectData).filter(Boolean);
      // Dedupe by dbId (same project may have multiple markers for multi-vertical)
      const seen = new Set();
      const unique = [];
      for (const p of projects) {
        const key = p._dbId || (p.projectName + p.state);
        if (!seen.has(key)) { seen.add(key); unique.push(p); }
      }
      if (unique.length > 0) showClusterList(unique, stage);
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

    // Compute stats from allProjects directly (more reliable than API summary)
    recalcStats();

    // Try to render map (defensive — don't let marker errors block stats)
    try {
      updateMap();
    } catch (e) {
      console.error('updateMap failed:', e);
    }

    // Show last scan time
    const infoEl = document.getElementById('lastScanInfo');
    if (infoEl && data.lastScan) {
      const ago = timeSince(new Date(data.lastScan));
      infoEl.innerHTML = `<i class="bi bi-clock-history"></i> Last scan: ${ago} ago &middot; Auto-updates nightly 2am EST`;
    } else if (infoEl) {
      infoEl.textContent = 'Auto-updates nightly 2am EST';
    }
  } catch (e) {
    console.error('Failed to load heatmap data:', e);
  }
}

function updateMap() {
  for (const stage of Object.keys(markerLayers)) {
    if (markerLayers[stage]) markerLayers[stage].clearLayers();
  }

  // Collect markers per layer, then batch-add (addLayers is MUCH faster than addLayer in a loop)
  const markerBatches = { parking: [], industrial: [], municipal: [], construction: [] };

  for (const project of allProjects) {
    const coords = getCoords(project.city, project.state);
    if (!coords) continue;

    const verticals = getVerts(project);

    for (const stage of verticals) {
      if (!markerBatches[stage]) continue;

      const color = STAGE_COLORS[stage] || STAGE_COLORS.construction;
      const jitter = () => (Math.random() - 0.5) * 0.02;
      const lat = coords[0] + jitter();
      const lng = coords[1] + jitter();

      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        fillColor: color,
        color: verticals.length > 1 ? '#fbbf24' : '#fff',
        weight: verticals.length > 1 ? 2.5 : 2,
        opacity: 1,
        fillOpacity: 0.85
      });

      marker._projectData = project;
      marker.on('click', () => showProjectDetail(project));

      const label = escapeHtml(project.projectName).substring(0, 50);
      marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });

      markerBatches[stage].push(marker);
    }
  }

  // Batch-add all markers at once per layer
  for (const stage of Object.keys(markerBatches)) {
    if (markerLayers[stage] && markerBatches[stage].length > 0) {
      markerLayers[stage].addLayers(markerBatches[stage]);
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

  const st = normalizeState(state);

  if (city && st) {
    const key = `${city},${st}`;
    if (geoData.cities[key]) return geoData.cities[key];

    const keyLower = key.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      if (k.toLowerCase() === keyLower) return v;
    }

    const cityLower = city.toLowerCase();
    for (const [k, v] of Object.entries(geoData.cities)) {
      const parts = k.split(',');
      if (parts[1] === st && parts[0].toLowerCase().includes(cityLower)) return v;
    }
  }

  if (st && geoData.stateCentroids[st]) {
    return geoData.stateCentroids[st];
  }

  return null;
}

// Normalize verticals — handles array, JSON string, or missing
function getVerts(p) {
  let v = p.verticals;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = [v]; } }
  if (!Array.isArray(v) || v.length === 0) v = [p.lifecycleStage || 'construction'];
  return v;
}

// ── Cluster Click → Project List ──
function showClusterList(projects, stage) {
  lastViewedStage = stage;
  lastListType = 'cluster';
  currentListProjects = projects;

  const label = STAGE_LABELS[stage] || stage;
  const color = STAGE_COLORS[stage] || '#1e293b';
  const locations = [...new Set(projects.map(p => [p.city, p.state].filter(Boolean).join(', ')).filter(Boolean))];
  const locLabel = locations.length === 1 ? locations[0] : `${locations.length} locations`;

  const title = document.getElementById('sidebarTitle');
  title.innerHTML = `<i class="bi bi-geo-alt-fill" style="color:${color}"></i> ${escapeHtml(locLabel)} &mdash; ${label} (${projects.length})`;
  document.getElementById('backToListBtn').classList.add('d-none');

  const sidebar = document.getElementById('sidebarContent');
  let html = '';
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const value = p.estimatedValue > 0 ? `<span class="text-success fw-bold">$${Number(p.estimatedValue).toLocaleString()}</span>` : '';
    const location = [p.city, p.state].filter(Boolean).join(', ');
    const hasContractors = p.contractors && p.contractors.length > 0;
    const verts = getVerts(p);
    const badges = verts.map(v => `<span class="badge ms-1 flex-shrink-0" style="background:${STAGE_COLORS[v] || '#ea580c'};color:white;font-size:0.55rem;">${v}</span>`).join('');

    html += `<div class="project-list-item" onclick="showProjectDetailByIndex(${i})">
      <div class="d-flex justify-content-between align-items-start">
        <strong class="small" style="line-height:1.3;">${escapeHtml(p.projectName).substring(0, 60)}</strong>
        <span class="flex-shrink-0">${badges}</span>
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

// ── Project List (clickable stat cards) ──
function showProjectList(stage) {
  lastViewedStage = stage;
  lastListType = 'stat';
  const filtered = stage === 'all'
    ? allProjects
    : allProjects.filter(p => {
        const verts = getVerts(p);
        return verts.includes(stage);
      });

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

    const verts = getVerts(p);
    const badges = verts.map(v => `<span class="badge ms-1 flex-shrink-0" style="background:${STAGE_COLORS[v] || '#ea580c'};color:white;font-size:0.55rem;">${v}</span>`).join('');

    html += `<div class="project-list-item" onclick="showProjectDetailByIndex(${i})">
      <div class="d-flex justify-content-between align-items-start">
        <strong class="small" style="line-height:1.3;">${escapeHtml(p.projectName).substring(0, 60)}</strong>
        <span class="flex-shrink-0">${badges}</span>
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
  if (lastListType === 'cluster' && currentListProjects.length > 0) {
    showClusterList(currentListProjects, lastViewedStage);
  } else if (lastViewedStage !== null) {
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

  // Project name + all vertical badges
  html += `<h6 class="mb-1">${escapeHtml(project.projectName)}</h6>`;
  const detailVerts = getVerts(project);
  for (const v of detailVerts) {
    const vc = STAGE_COLORS[v] || color;
    html += `<span class="badge me-1" style="background:${vc}; color:white; font-size:0.7rem;">${STAGE_LABELS[v] || v}</span>`;
  }

  // Project status badge
  if (project.projectStatus && project.projectStatus !== 'Unknown') {
    const statusColors = { Active: '#16a34a', Awarded: '#2563eb', Bidding: '#ea580c', Planned: '#6b7280', Completed: '#8b5cf6' };
    const sc = statusColors[project.projectStatus] || '#94a3b8';
    html += ` <span class="badge" style="background:${sc}; color:white; font-size:0.7rem;">${escapeHtml(project.projectStatus)}</span>`;
  }

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
    html += `<strong class="small"><i class="bi bi-people-fill text-success"></i> Companies Found (${project.contractors.length}):</strong>`;
    for (const c of project.contractors) {
      html += '<div class="contractor-card">';
      html += `<div class="fw-bold small">${escapeHtml(c.name)}</div>`;
      const details = [];
      if (c.role) details.push(c.role);
      if (c.specialty) details.push(c.specialty);
      if (details.length) html += `<small class="text-muted">${escapeHtml(details.join(' — '))}</small>`;
      if (c.website) html += `<br><a href="${escapeHtml(c.website)}" target="_blank" class="small text-primary">${escapeHtml(c.website)}</a>`;
      if (c.phone) html += `<br><small><i class="bi bi-telephone"></i> ${escapeHtml(c.phone)}</small>`;
      html += '</div>';
    }
    html += '<div class="mt-2"><small class="text-muted"><i class="bi bi-info-circle"></i> These are the companies to market RubberForm products to.</small></div>';
    html += '</div>';
  } else {
    // Find Contractors button — pass index to avoid string escaping issues
    const pIdx = allProjects.indexOf(project);
    html += `<div class="mt-3 border-top pt-2">
      <button class="btn btn-sm btn-outline-success w-100" id="contractorBtn" onclick="findContractors(${pIdx})">
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
async function findContractors(projectIdx) {
  const project = allProjects[projectIdx];
  if (!project) return;
  const { projectName, state } = project;

  const btn = document.getElementById('contractorBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Fetching article & searching...';

  // Progress updates while waiting
  const stages = [
    { delay: 5000, text: 'Reading source article...' },
    { delay: 15000, text: 'Searching for contractors...' },
    { delay: 30000, text: 'Looking up contact info...' },
    { delay: 50000, text: 'Almost done...' }
  ];
  const timers = stages.map(s => setTimeout(() => {
    if (btn.disabled) btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${s.text}`;
  }, s.delay));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout

    const resp = await fetch('/api/heatmap-contractor-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, state }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    timers.forEach(t => clearTimeout(t));

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      console.error('Contractor search error:', err);
      btn.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${err.error || 'Server error'}`;
      btn.classList.replace('btn-outline-success', 'btn-outline-danger');
      btn.disabled = false;
      return;
    }

    const data = await resp.json();

    if (data.success && data.contractors && data.contractors.length > 0) {
      project.contractors = data.contractors;
      project.contractorSearched = true;
      showProjectDetail(project);
    } else {
      const msg = data.error ? `Error: ${data.error}` : 'No contractors found';
      console.warn('Contractor search:', msg, data);
      btn.innerHTML = `<i class="bi bi-x-circle"></i> ${msg}`;
      btn.classList.replace('btn-outline-success', 'btn-outline-warning');
      btn.disabled = false;
    }
  } catch (e) {
    timers.forEach(t => clearTimeout(t));
    const msg = e.name === 'AbortError' ? 'Search timed out (90s)' : `Search failed: ${e.message}`;
    console.error('Contractor search error:', e);
    btn.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${msg}`;
    btn.classList.replace('btn-outline-success', 'btn-outline-danger');
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

// ── Helpers ──
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
  recalcStats();
}

function recalcStats() {
  const hasVert = (p, v) => getVerts(p).includes(v);
  updateStats({
    total: allProjects.length,
    parking: allProjects.filter(p => hasVert(p, 'parking')).length,
    industrial: allProjects.filter(p => hasVert(p, 'industrial')).length,
    municipal: allProjects.filter(p => hasVert(p, 'municipal')).length,
    construction: allProjects.filter(p => hasVert(p, 'construction')).length
  });
}

function updateStats(summary) {
  document.getElementById('statTotal').textContent = summary.total || 0;
  document.getElementById('statParking').textContent = summary.parking || 0;
  document.getElementById('statIndustrial').textContent = summary.industrial || 0;
  document.getElementById('statMunicipal').textContent = summary.municipal || 0;
  document.getElementById('statConstruction').textContent = summary.construction || 0;
}

// ── Export ──
function exportExcel(vertical) {
  window.location.href = `/api/heatmap-export/excel?vertical=${vertical}`;
}
function exportPDF(vertical) {
  window.open(`/api/heatmap-export/pdf?vertical=${vertical}`, '_blank');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
