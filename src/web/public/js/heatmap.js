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
let currentListProjects = []; // unfiltered list backing the sidebar
let visibleListProjects = []; // filtered view actually rendered (click indices map into this)
let currentListLocLabel = ''; // cluster's location label, only used for cluster lists
let sidebarFilter = ''; // current sidebar search term
let lastListType = null; // 'cluster' or 'stat' — determines how to rebuild on back
let cachedLists = null;  // [{id, name, memberCount}] — refreshed lazily
let activeProjectDbId = null; // currently-open project, drives Apollo refreshes

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
  await loadData();
  restoreFromUrl();

  document.querySelectorAll('.stage-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleStage(btn));
  });
  document.getElementById('timeRange').addEventListener('change', () => loadData());

  const searchInput = document.getElementById('sidebarSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      sidebarFilter = searchInput.value;
      renderSidebarList();
    });
  }

  // Browser back/forward → reapply URL state (open project or close back to default)
  window.addEventListener('popstate', () => restoreFromUrl({ fromPopstate: true }));
});

// Project selection persistence layers:
//   - URL ?project=<id>   → shareable, refresh-stable, browser back/forward
//   - sessionStorage       → survives sidebar nav (Lists ↔ Heat Map), which
//                            does a full page load and strips the query string
// URL is checked first; sessionStorage is the fallback.
const SESSION_KEY_ACTIVE_PROJECT = 'heatmap.activeProjectId';

// Read ?project=<dbId> from URL (or sessionStorage fallback) and open it.
function restoreFromUrl(opts = {}) {
  const params = new URLSearchParams(window.location.search);
  let projectId = parseInt(params.get('project') || '', 10);
  let needsUrlSync = false;
  if (!projectId && !opts.fromPopstate) {
    const stored = sessionStorage.getItem(SESSION_KEY_ACTIVE_PROJECT);
    const parsed = parseInt(stored || '', 10);
    if (parsed) {
      projectId = parsed;
      needsUrlSync = true; // came from sessionStorage; push it to the URL too
    }
  }

  if (projectId) {
    const project = allProjects.find(p => p && p._dbId === projectId);
    if (project) {
      // Keep both layers in sync regardless of which one we restored from.
      writeActiveProjectToSession(projectId);
      if (needsUrlSync) updateProjectInUrl(projectId, { replace: true });
      showProjectDetail(project, { skipUrlUpdate: true, skipSessionUpdate: true });
      return;
    }
    // Project not in current dataset (e.g. timeRange filter excluded it). Drop
    // both stores so we don't keep re-trying on every reload.
    writeActiveProjectToSession(null);
    if (!opts.fromPopstate) updateProjectInUrl(null, { replace: true });
  } else if (opts.fromPopstate) {
    // Browser-back left no project param — close detail view back to whatever
    // list state we have, or the stats default.
    backToList({ skipUrlUpdate: true });
  }
}

function updateProjectInUrl(dbId, opts = {}) {
  const url = new URL(window.location.href);
  if (dbId) url.searchParams.set('project', String(dbId));
  else url.searchParams.delete('project');
  const method = opts.replace ? 'replaceState' : 'pushState';
  history[method]({}, '', url.toString());
}

function writeActiveProjectToSession(dbId) {
  try {
    if (dbId) sessionStorage.setItem(SESSION_KEY_ACTIVE_PROJECT, String(dbId));
    else sessionStorage.removeItem(SESSION_KEY_ACTIVE_PROJECT);
  } catch (e) { /* sessionStorage can be disabled — fall back gracefully */ }
}

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

  const locations = [...new Set(projects.map(p => [p.city, p.state].filter(Boolean).join(', ')).filter(Boolean))];
  currentListLocLabel = locations.length === 1 ? locations[0] : `${locations.length} locations`;

  resetSidebarFilter();
  renderSidebarList();
}

// ── Project List (clickable stat cards) ──
function showProjectList(stage) {
  lastViewedStage = stage;
  lastListType = 'stat';
  currentListProjects = stage === 'all'
    ? allProjects
    : allProjects.filter(p => getVerts(p).includes(stage));
  currentListLocLabel = '';

  resetSidebarFilter();
  renderSidebarList();
}

// Fields scanned by the sidebar search — AI-extracted title + summary blurb
// plus the other fields the user can see on each card.
function projectMatchesFilter(p, needle) {
  if (!needle) return true;
  const hay = [
    p.projectName, p.projectType, p.notes,
    p.owner, p.generalContractor,
    p.city, p.state, p.source,
    ...(getVerts(p) || []),
    ...((p.contractors || []).flatMap(c => [c.name, c.role, c.specialty]))
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

function renderSidebarList() {
  const needle = (sidebarFilter || '').trim().toLowerCase();
  const isGlobalSearch = !!needle;

  // With no active list AND no search term, there's nothing to render.
  if (!lastListType && !isGlobalSearch) return;

  // Global search filters across every loaded project, not just the active
  // sidebar list — so users can find a match without first picking the
  // right vertical/cluster. Clearing the box reverts to whatever list was
  // last opened (preserved in currentListProjects).
  const source = isGlobalSearch ? allProjects : currentListProjects;
  visibleListProjects = isGlobalSearch
    ? source.filter(p => projectMatchesFilter(p, needle))
    : source.slice();

  // Header
  const title = document.getElementById('sidebarTitle');
  const stage = lastViewedStage;
  const color = STAGE_COLORS[stage] || '#1e293b';
  const totalCount = source.length;
  const shownCount = visibleListProjects.length;
  const countLabel = isGlobalSearch ? `${shownCount}/${totalCount}` : `${totalCount}`;

  if (isGlobalSearch) {
    title.innerHTML = `<i class="bi bi-search" style="color:#1e293b"></i> Search results (${countLabel})`;
  } else if (lastListType === 'cluster') {
    const label = STAGE_LABELS[stage] || stage;
    title.innerHTML = `<i class="bi bi-geo-alt-fill" style="color:${color}"></i> ${escapeHtml(currentListLocLabel)} &mdash; ${label} (${countLabel})`;
  } else {
    const label = stage === 'all' ? 'All Projects' : (STAGE_LABELS[stage] || stage);
    title.innerHTML = `<i class="bi bi-list-ul" style="color:${color}"></i> ${label} (${countLabel})`;
  }

  document.getElementById('backToListBtn').classList.add('d-none');
  setSidebarSearchVisible(true);

  // Match-count hint (only while filtering)
  const hint = document.getElementById('sidebarSearchCount');
  if (hint) {
    if (isGlobalSearch) {
      hint.textContent = `${shownCount} match${shownCount === 1 ? '' : 'es'} across all ${totalCount} projects`;
    } else {
      hint.textContent = '';
    }
  }

  const sidebar = document.getElementById('sidebarContent');

  if (totalCount === 0) {
    sidebar.innerHTML = '<div class="text-center text-muted py-4"><p>No projects in this category.</p></div>';
    return;
  }
  if (shownCount === 0) {
    sidebar.innerHTML = `<div class="text-center text-muted py-4"><p>No projects match &ldquo;${escapeHtml(sidebarFilter)}&rdquo;.</p></div>`;
    return;
  }

  let html = '';
  for (let i = 0; i < visibleListProjects.length; i++) {
    const p = visibleListProjects[i];
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

function resetSidebarFilter() {
  sidebarFilter = '';
  const input = document.getElementById('sidebarSearch');
  if (input) input.value = '';
  const hint = document.getElementById('sidebarSearchCount');
  if (hint) hint.textContent = '';
}

function setSidebarSearchVisible(visible) {
  const wrap = document.getElementById('sidebarSearchWrap');
  if (!wrap) return;
  wrap.classList.toggle('d-none', !visible);
}

function showProjectDetailByIndex(index) {
  const project = visibleListProjects[index];
  if (project) showProjectDetail(project);
}

function backToList(opts = {}) {
  if (!opts.skipUrlUpdate) updateProjectInUrl(null);
  if (!opts.skipSessionUpdate) writeActiveProjectToSession(null);
  activeProjectDbId = null;
  // Re-render the existing list (preserves any active filter) rather than
  // rebuilding — so the user's search survives a detail-view round-trip.
  // Works for three cases: an active stat/cluster list, a pure global-search
  // entry (no list clicked), or falling back to the last viewed stage.
  if ((lastListType && currentListProjects.length > 0) || (sidebarFilter || '').trim()) {
    renderSidebarList();
  } else if (lastViewedStage !== null) {
    showProjectList(lastViewedStage);
  }
}

// ── Project Detail (marker click or list click) ──
function showProjectDetail(project, opts = {}) {
  if (project && project._dbId) {
    if (!opts.skipUrlUpdate) updateProjectInUrl(project._dbId);
    if (!opts.skipSessionUpdate) writeActiveProjectToSession(project._dbId);
  }
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
  setSidebarSearchVisible(false);

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
    html += `<div class="notes-callout mt-2 p-2"><small>${escapeHtml(project.notes)}</small></div>`;
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

  // Apollo Contacts section — only available for DB-backed projects
  if (project._dbId) {
    const pIdx = allProjects.indexOf(project);
    const hasSearchTargets = (project.contractors && project.contractors.length > 0)
      || project.owner || project.generalContractor;
    html += '<div class="mt-3 border-top pt-2" id="apolloSection">';
    html += `<strong class="small"><i class="bi bi-person-rolodex text-primary"></i> Apollo Contacts</strong>`;
    if (hasSearchTargets) {
      html += `<button class="btn btn-sm btn-outline-primary w-100 mt-2" id="apolloBtn" onclick="findApolloContacts(${pIdx})">
        <i class="bi bi-search"></i> Find Contacts in Apollo
      </button>
      <small class="text-muted d-block text-center mt-1">Searches Apollo for decision-makers at the project's companies</small>`;
    } else {
      html += `<div class="mt-1"><small class="text-muted">Run contractor discovery first to enable Apollo search.</small></div>`;
    }
    html += '<div id="apolloContacts" class="mt-2"></div>';
    html += '</div>';
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

  // Auto-load any previously saved Apollo contacts for this project
  activeProjectDbId = project._dbId || null;
  if (project._dbId) {
    ensureListsLoaded().then(() => loadSavedApolloContacts(project._dbId));
  }
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

// ── Apollo Contact Lookup ──
async function loadSavedApolloContacts(projectId) {
  try {
    const resp = await fetch(`/api/contacts/${projectId}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.success && data.contacts && data.contacts.length > 0) {
      renderApolloContacts(data.contacts, projectId, /* fresh */ false);
    }
  } catch (e) {
    console.warn('Saved contacts load failed:', e);
  }
}

async function findApolloContacts(projectIdx) {
  const project = allProjects[projectIdx];
  if (!project || !project._dbId) return;

  const btn = document.getElementById('apolloBtn');
  const container = document.getElementById('apolloContacts');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Searching Apollo...';

  const stages = [
    { delay: 4000, text: 'Querying Apollo People Search...' },
    { delay: 12000, text: 'Matching titles to decision-makers...' },
    { delay: 25000, text: 'Enriching email & phone...' }
  ];
  const timers = stages.map(s => setTimeout(() => {
    if (btn.disabled) btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${s.text}`;
  }, s.delay));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const resp = await fetch('/api/contacts/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project._dbId }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    timers.forEach(t => clearTimeout(t));

    const data = await resp.json();
    if (!data.success) {
      btn.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${data.error || 'Search failed'}`;
      btn.classList.replace('btn-outline-primary', 'btn-outline-danger');
      btn.disabled = false;
      return;
    }

    if (!data.contacts || data.contacts.length === 0) {
      btn.innerHTML = `<i class="bi bi-x-circle"></i> ${data.message || 'No contacts found'}`;
      btn.classList.replace('btn-outline-primary', 'btn-outline-warning');
      btn.disabled = false;
      return;
    }

    btn.innerHTML = `<i class="bi bi-check-circle"></i> Found ${data.contacts.length} contacts`;
    btn.classList.replace('btn-outline-primary', 'btn-success');
    // Reload saved-list (server already persisted them) to dedupe with any prior runs
    await loadSavedApolloContacts(project._dbId);
  } catch (e) {
    timers.forEach(t => clearTimeout(t));
    const msg = e.name === 'AbortError' ? 'Search timed out (120s)' : `Search failed: ${e.message}`;
    console.error('Apollo search error:', e);
    btn.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${msg}`;
    btn.classList.replace('btn-outline-primary', 'btn-outline-danger');
    btn.disabled = false;
  }
}

function renderApolloContacts(contacts, projectId, fresh) {
  const container = document.getElementById('apolloContacts');
  if (!container) return;

  let html = '';
  html += `<div class="d-flex justify-content-between align-items-center mt-2">
    <small class="text-muted">${contacts.length} contact${contacts.length === 1 ? '' : 's'}</small>
    <button class="btn btn-xs btn-outline-primary" style="font-size:0.7rem; padding:2px 8px;"
            onclick="pushAllApolloContacts(${projectId})">
      <i class="bi bi-cloud-upload"></i> Push all to HubSpot
    </button>
  </div>`;

  for (const c of contacts) {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '(name withheld)';
    const conf = c.confidence ? Math.round(c.confidence * 100) : 0;
    const pushed = c.pushedToHubspot;
    html += '<div class="contact-card">';
    html += `<div class="fw-bold small">${escapeHtml(name)}`;
    if (conf > 0) html += ` <span class="text-muted" style="font-weight:normal;">· ${conf}%</span>`;
    html += '</div>';
    if (c.title) html += `<small class="text-muted d-block">${escapeHtml(c.title)}</small>`;
    if (c.company) html += `<small class="d-block">${escapeHtml(c.company)}</small>`;
    if (c.contractorRole) {
      const roleLabel = c.contractorRole === 'owner' ? 'Project Owner' :
                        c.contractorRole === 'general_contractor' ? 'General Contractor' :
                        c.contractorRole;
      html += `<small class="text-muted d-block"><i class="bi bi-link-45deg"></i> via ${escapeHtml(roleLabel)}</small>`;
    }
    if (c.email) html += `<small class="d-block"><i class="bi bi-envelope"></i> ${escapeHtml(c.email)}</small>`;
    if (c.phone) html += `<small class="d-block"><i class="bi bi-telephone"></i> ${escapeHtml(c.phone)}</small>`;
    if (c.linkedin) html += `<small class="d-block"><a href="${escapeHtml(c.linkedin)}" target="_blank">LinkedIn</a></small>`;

    html += '<div class="d-flex flex-wrap gap-1 mt-1 align-items-center">';
    if (pushed) {
      html += `<span class="badge bg-success" style="font-size:0.65rem;"><i class="bi bi-check-lg"></i> In HubSpot</span>`;
    } else {
      html += `<button class="btn btn-outline-success" style="font-size:0.7rem; padding:2px 8px;"
                       onclick="pushApolloContact(${c.id}, this)">
        <i class="bi bi-cloud-upload"></i> Push
      </button>`;
    }
    html += renderAddToListDropdown(c.id);
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

function renderAddToListDropdown(contactId) {
  const dropdownId = `addToList-${contactId}`;
  let items = '';
  if (cachedLists && cachedLists.length > 0) {
    for (const l of cachedLists) {
      items += `<li><a class="dropdown-item small" href="#"
                       onclick="event.preventDefault(); addContactToList(${l.id}, ${contactId}, this)">
        ${escapeHtml(l.name)}
        <small class="text-muted">(${l.memberCount})</small>
      </a></li>`;
    }
    items += '<li><hr class="dropdown-divider"></li>';
  }
  items += `<li><a class="dropdown-item small text-primary" href="#"
                   onclick="event.preventDefault(); promptNewListAndAdd(${contactId}, this)">
    <i class="bi bi-plus-lg"></i> New list...
  </a></li>`;

  return `<div class="dropdown d-inline-block">
    <button class="btn btn-outline-primary dropdown-toggle" style="font-size:0.7rem; padding:2px 8px;"
            type="button" id="${dropdownId}" data-bs-toggle="dropdown" aria-expanded="false">
      <i class="bi bi-plus-circle"></i> List
    </button>
    <ul class="dropdown-menu" aria-labelledby="${dropdownId}" style="max-height: 240px; overflow-y: auto;">
      ${items}
    </ul>
  </div>`;
}

async function ensureListsLoaded(force) {
  if (cachedLists && !force) return cachedLists;
  try {
    const resp = await fetch('/api/lists');
    const data = await resp.json();
    cachedLists = data.success ? (data.lists || []) : [];
  } catch (e) {
    console.warn('Lists load failed:', e);
    cachedLists = [];
  }
  return cachedLists;
}

async function addContactToList(listId, contactId, anchorEl) {
  try {
    const resp = await fetch(`/api/lists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId] })
    });
    const data = await resp.json();
    if (!data.success) {
      alert(`Add failed: ${data.error}`);
      return;
    }
    // Bump local count and flash confirmation
    const list = cachedLists && cachedLists.find(l => l.id === listId);
    if (list && data.added > 0) list.memberCount += data.added;
    if (anchorEl) {
      const original = anchorEl.innerHTML;
      anchorEl.innerHTML = `<i class="bi bi-check2 text-success"></i> Added to "${escapeHtml(list ? list.name : 'list')}"`;
      setTimeout(() => { anchorEl.innerHTML = original; }, 1400);
    }
  } catch (e) {
    alert(`Add failed: ${e.message}`);
  }
}

async function promptNewListAndAdd(contactId, anchorEl) {
  const name = prompt('Name your new list:');
  if (!name || !name.trim()) return;
  try {
    const resp = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    const data = await resp.json();
    if (!data.success) {
      alert(`Create failed: ${data.error}`);
      return;
    }
    await ensureListsLoaded(true);
    await addContactToList(data.list.id, contactId, anchorEl);
    // Refresh the contact list so every card's dropdown picks up the new list
    if (activeProjectDbId) loadSavedApolloContacts(activeProjectDbId);
  } catch (e) {
    alert(`Create failed: ${e.message}`);
  }
}

async function pushApolloContact(contactId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Pushing...';
  }
  try {
    const resp = await fetch('/api/contacts/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId] })
    });
    const data = await resp.json();
    const result = (data.results && data.results[0]) || {};
    if (result.action === 'failed') {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${result.error || 'Failed'}`;
        btnEl.classList.replace('btn-outline-success', 'btn-outline-danger');
      }
      return;
    }
    if (btnEl) {
      btnEl.outerHTML = `<div class="mt-1"><span class="badge bg-success" style="font-size:0.65rem;"><i class="bi bi-check-lg"></i> In HubSpot</span></div>`;
    }
  } catch (e) {
    console.error('Push contact error:', e);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = `<i class="bi bi-exclamation-triangle"></i> ${e.message}`;
    }
  }
}

async function pushAllApolloContacts(projectId) {
  const buttons = document.querySelectorAll('#apolloContacts button[onclick^="pushApolloContact"]');
  const contactIds = [];
  buttons.forEach(b => {
    const m = b.getAttribute('onclick').match(/pushApolloContact\((\d+)/);
    if (m) contactIds.push(parseInt(m[1]));
  });
  if (contactIds.length === 0) return;

  try {
    const resp = await fetch('/api/contacts/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds })
    });
    const data = await resp.json();
    if (data.success) {
      await loadSavedApolloContacts(projectId);
    } else {
      alert(`Push failed: ${data.error || 'unknown error'}`);
    }
  } catch (e) {
    console.error('Bulk push error:', e);
    alert(`Push failed: ${e.message}`);
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
