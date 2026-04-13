/**
 * RubberForm Prospecting Engine — Rep Search Page
 * Shows heatmap projects filtered by rep's verticals.
 * Enriches contractors with Selling.com contacts, pushes to HubSpot.
 */

let allProjects = [];
let selectedProject = null;

// ── Load projects on page load ──
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
});

async function loadProjects() {
  document.getElementById('loadingIndicator').style.display = 'block';
  document.getElementById('projectList').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';

  try {
    const resp = await fetch(`/api/search/${REP_ID}/projects`);
    const data = await resp.json();
    allProjects = data.projects || [];

    document.getElementById('loadingIndicator').style.display = 'none';

    if (allProjects.length === 0) {
      document.getElementById('emptyState').style.display = 'block';
      return;
    }

    document.getElementById('projectCount').textContent = `${allProjects.length} projects`;
    renderProjectList();
  } catch (e) {
    document.getElementById('loadingIndicator').innerHTML =
      `<div class="text-danger py-3"><i class="bi bi-exclamation-circle"></i> Failed to load: ${esc(e.message)}</div>`;
  }
}

// ── Render project list ──
function renderProjectList() {
  const container = document.getElementById('projectList');
  container.style.display = 'block';

  let html = '<table class="table table-hover mb-0" style="font-size: 0.85rem;">';
  html += `<thead><tr>
    <th>Project</th>
    <th>Location</th>
    <th>Value</th>
    <th>Status</th>
    <th>Verticals</th>
    <th class="text-center">Contractors</th>
    <th class="text-center">Contacts</th>
  </tr></thead><tbody>`;

  for (let i = 0; i < allProjects.length; i++) {
    const p = allProjects[i];
    const value = p.estimatedValue > 0 ? '$' + Number(p.estimatedValue).toLocaleString() : '';
    const location = [p.city, p.state].filter(Boolean).join(', ');
    const statusColors = { Active: '#16a34a', Awarded: '#2563eb', Bidding: '#ea580c', Planned: '#6b7280', Completed: '#8b5cf6' };
    const sc = statusColors[p.projectStatus] || '#94a3b8';
    const vertColors = { parking: '#2563eb', industrial: '#7c3aed', municipal: '#16a34a', construction: '#ea580c' };
    const vertBadges = (p.verticals || []).map(v =>
      `<span class="badge" style="background:${vertColors[v] || '#94a3b8'}; font-size:0.6rem;">${v}</span>`
    ).join(' ');

    const contractorBadge = p.contractorCount > 0
      ? `<span class="badge bg-success">${p.contractorCount}</span>`
      : `<span class="badge bg-secondary">0</span>`;
    const contactBadge = p.contactCount > 0
      ? `<span class="badge bg-primary">${p.contactCount}</span>`
      : `<span class="badge bg-secondary">0</span>`;

    const isActive = selectedProject && selectedProject._dbId === p._dbId;

    html += `<tr style="cursor:pointer;" onclick="selectProject(${i})" class="${isActive ? 'table-active' : ''}">
      <td><strong>${esc(p.projectName).substring(0, 55)}</strong>
        ${p.owner ? `<br><small class="text-muted">${esc(p.owner)}</small>` : ''}</td>
      <td>${esc(location)}</td>
      <td class="text-success fw-bold">${value}</td>
      <td><span style="color:${sc}; font-weight:600; font-size:0.8rem;">${esc(p.projectStatus || 'Unknown')}</span></td>
      <td>${vertBadges}</td>
      <td class="text-center">${contractorBadge}</td>
      <td class="text-center">${contactBadge}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Select a project → show detail panel ──
async function selectProject(index) {
  selectedProject = allProjects[index];
  const card = document.getElementById('detailCard');
  const title = document.getElementById('detailTitle');
  const content = document.getElementById('detailContent');

  card.style.display = 'block';
  title.innerHTML = `<i class="bi bi-building"></i> ${esc(selectedProject.projectName)}`;

  renderProjectList();

  // Build detail content
  let html = '';
  const location = [selectedProject.city, selectedProject.state].filter(Boolean).join(', ');
  html += '<div class="row g-3 mb-3"><div class="col-md-6">';
  if (location) html += `<div><small class="text-muted">Location:</small> <strong>${esc(location)}</strong></div>`;
  if (selectedProject.estimatedValue > 0) html += `<div><small class="text-muted">Value:</small> <strong class="text-success">$${Number(selectedProject.estimatedValue).toLocaleString()}</strong></div>`;
  if (selectedProject.bidDate) html += `<div><small class="text-muted">Timeline:</small> ${esc(selectedProject.bidDate)}</div>`;
  if (selectedProject.owner) html += `<div><small class="text-muted">Owner:</small> ${esc(selectedProject.owner)}</div>`;
  if (selectedProject.generalContractor) html += `<div><small class="text-muted">GC:</small> ${esc(selectedProject.generalContractor)}</div>`;
  html += '</div><div class="col-md-6">';
  if (selectedProject.sourceUrl) html += `<div><a href="${esc(selectedProject.sourceUrl)}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="bi bi-box-arrow-up-right"></i> Source Article</a></div>`;
  if (selectedProject.notes) html += `<div class="mt-2 p-2" style="background:#f8fafc; border-radius:6px;"><small class="text-muted">${esc(selectedProject.notes).substring(0, 200)}</small></div>`;
  html += '</div></div><hr>';
  html += '<div id="contractorsSection"><span class="spinner-border spinner-border-sm"></span> Loading contractors & contacts...</div>';

  content.innerHTML = html;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  await loadProjectDetail(selectedProject._dbId);
}

async function loadProjectDetail(projectId) {
  const section = document.getElementById('contractorsSection');

  try {
    const resp = await fetch(`/api/contacts/${projectId}`);
    const data = await resp.json();
    const contacts = data.contacts || [];

    let html = '';

    // Group contacts by contractor
    const byContractor = {};
    for (const c of contacts) {
      const key = c.contractorName || c.company || 'Unknown';
      if (!byContractor[key]) byContractor[key] = { role: c.contractorRole || '', contacts: [] };
      byContractor[key].contacts.push(c);
    }

    if (contacts.length > 0) {
      html += `<h6 class="fw-bold small text-muted mb-2"><i class="bi bi-people-fill"></i> DECISION MAKERS (${contacts.length})</h6>`;

      for (const [company, group] of Object.entries(byContractor)) {
        html += `<div class="mb-3">`;
        html += `<div class="fw-bold small">${esc(company)} <span class="text-muted fw-normal">${esc(group.role)}</span></div>`;

        for (const c of group.contacts) {
          const confidence = c.confidence > 0 ? `<span class="badge ${c.confidence >= 70 ? 'bg-success' : 'bg-warning text-dark'}" style="font-size:0.6rem;">${c.confidence}%</span>` : '';
          html += `<div class="contact-card d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold small">${esc(c.firstName)} ${esc(c.lastName)} ${confidence}</div>
              <small class="text-muted">${esc(c.title)}</small>
              ${c.email ? `<br><small><i class="bi bi-envelope"></i> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></small>` : ''}
              ${c.phone ? `<br><small><i class="bi bi-telephone"></i> ${esc(c.phone)}</small>` : ''}
              ${c.linkedin ? `<br><small><i class="bi bi-linkedin"></i> <a href="${esc(c.linkedin)}" target="_blank">LinkedIn</a></small>` : ''}
            </div>
            <div class="text-end">
              ${c.pushedToHubspot
                ? '<span class="badge bg-success"><i class="bi bi-check"></i> In HubSpot</span>'
                : `<button class="btn btn-sm btn-outline-success" onclick="pushContact(${c.id}, this)"><i class="bi bi-cloud-upload"></i> Push</button>`}
            </div>
          </div>`;
        }
        html += '</div>';
      }

      const unpushed = contacts.filter(c => !c.pushedToHubspot);
      if (unpushed.length > 0) {
        html += `<button class="btn btn-sm btn-success w-100 mt-2" onclick="pushAllContacts(${projectId}, this)">
          <i class="bi bi-cloud-upload"></i> Push All ${unpushed.length} Contacts to HubSpot
        </button>`;
      }
    }

    // Find Decision Makers button
    if (selectedProject.contractorCount > 0 || selectedProject.contractorSearched) {
      html += `<div class="mt-3">
        <button class="btn btn-sm btn-primary w-100" id="findContactsBtn" onclick="findDecisionMakers(${projectId}, this)">
          <i class="bi bi-person-plus"></i> Find Decision Makers via Selling.com
        </button>
        <small class="text-muted d-block text-center mt-1">Searches Selling.com for contacts at each contractor</small>
      </div>`;
    } else {
      html += `<div class="mt-3 text-center text-muted">
        <p><i class="bi bi-info-circle"></i> No contractors discovered yet.</p>
        <p>Go to the <a href="/heatmap">Heat Map</a>, find this project, and run contractor discovery first.</p>
      </div>`;
    }

    section.innerHTML = html;
  } catch (e) {
    section.innerHTML = `<div class="text-danger"><i class="bi bi-exclamation-circle"></i> ${esc(e.message)}</div>`;
  }
}

// ── Find Decision Makers (Selling.com) ──
async function findDecisionMakers(projectId, btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Searching Selling.com...';
  }

  try {
    const resp = await fetch('/api/contacts/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    });
    const data = await resp.json();

    if (data.success) {
      await loadProjectDetail(projectId);
      if (selectedProject) {
        selectedProject.contactCount = (selectedProject.contactCount || 0) + data.contacts.length;
        renderProjectList();
      }
    } else {
      if (btn) { btn.innerHTML = `<i class="bi bi-exclamation-circle"></i> ${esc(data.error || 'Failed')}`; btn.disabled = false; }
    }
  } catch (e) {
    if (btn) { btn.innerHTML = `<i class="bi bi-exclamation-circle"></i> ${esc(e.message)}`; btn.disabled = false; }
  }
}

// ── Push single contact to HubSpot ──
async function pushContact(contactId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }

  try {
    const resp = await fetch('/api/contacts/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId], repId: REP_ID })
    });
    const data = await resp.json();

    if (data.success && data.results && data.results[0]) {
      const r = data.results[0];
      if (r.action === 'created' || r.action === 'skipped') {
        if (btn) btn.outerHTML = '<span class="badge bg-success"><i class="bi bi-check"></i> In HubSpot</span>';
      } else {
        if (btn) { btn.innerHTML = '<i class="bi bi-x"></i> Failed'; btn.disabled = false; }
      }
    }
  } catch (e) {
    if (btn) { btn.innerHTML = '<i class="bi bi-x"></i> Error'; btn.disabled = false; }
  }
}

// ── Push all unpushed contacts ──
async function pushAllContacts(projectId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Pushing to HubSpot...'; }

  try {
    const listResp = await fetch(`/api/contacts/${projectId}`);
    const listData = await listResp.json();
    const unpushed = (listData.contacts || []).filter(c => !c.pushedToHubspot);
    const contactIds = unpushed.map(c => c.id);

    if (contactIds.length === 0) {
      if (btn) btn.innerHTML = 'All contacts already pushed';
      return;
    }

    const resp = await fetch('/api/contacts/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds, repId: REP_ID })
    });
    const data = await resp.json();

    if (data.success) {
      const created = data.results.filter(r => r.action === 'created').length;
      const skipped = data.results.filter(r => r.action === 'skipped').length;
      if (btn) btn.innerHTML = `<i class="bi bi-check-circle"></i> Done: ${created} created, ${skipped} skipped`;
      await loadProjectDetail(projectId);
    } else {
      if (btn) { btn.innerHTML = `<i class="bi bi-x"></i> ${esc(data.error || 'Failed')}`; btn.disabled = false; }
    }
  } catch (e) {
    if (btn) { btn.innerHTML = `<i class="bi bi-x"></i> ${esc(e.message)}`; btn.disabled = false; }
  }
}

function closeDetail() {
  document.getElementById('detailCard').style.display = 'none';
  selectedProject = null;
  renderProjectList();
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
