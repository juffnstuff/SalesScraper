/**
 * Contact Lists page — campaign "shopping carts" of Apollo contacts.
 * Left: index of all lists. Right: members + push/export/delete actions.
 */

let allLists = [];
let activeListId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadLists();

  document.getElementById('newListForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newListName').value.trim();
    const description = document.getElementById('newListDescription').value.trim();
    const errEl = document.getElementById('newListError');
    errEl.classList.add('d-none');
    if (!name) return;

    try {
      const resp = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });
      const data = await resp.json();
      if (!data.success) {
        errEl.textContent = data.error || 'Failed to create list';
        errEl.classList.remove('d-none');
        return;
      }
      document.getElementById('newListName').value = '';
      document.getElementById('newListDescription').value = '';
      bootstrap.Modal.getInstance(document.getElementById('newListModal')).hide();
      await loadLists();
      selectList(data.list.id);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('d-none');
    }
  });
});

async function loadLists() {
  const container = document.getElementById('listsIndex');
  try {
    const resp = await fetch('/api/lists');
    const data = await resp.json();
    if (!data.success) {
      container.innerHTML = `<div class="text-danger p-3">${escapeHtml(data.error || 'Load failed')}</div>`;
      return;
    }
    allLists = data.lists || [];
    if (allLists.length === 0) {
      container.innerHTML = '<div class="text-muted text-center py-4 small">No lists yet. Click "New list" to create one.</div>';
      return;
    }
    container.innerHTML = allLists.map(l => `
      <button type="button" class="list-group-item list-group-item-action ${l.id === activeListId ? 'active' : ''}"
              onclick="selectList(${l.id})">
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-2 flex-grow-1">
            <div class="fw-bold small">${escapeHtml(l.name)}</div>
            ${l.description ? `<small class="text-muted d-block">${escapeHtml(l.description)}</small>` : ''}
            ${l.pushedAt ? `<small class="text-success"><i class="bi bi-check-circle"></i> ${l.pushedCount} pushed</small>` : ''}
          </div>
          <span class="badge bg-primary rounded-pill">${l.memberCount}</span>
        </div>
      </button>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="text-danger p-3">${escapeHtml(e.message)}</div>`;
  }
}

async function selectList(listId) {
  activeListId = listId;
  // re-render index to highlight selection
  await loadLists();

  const container = document.getElementById('listDetail');
  container.innerHTML = '<div class="card"><div class="card-body text-center text-muted py-5"><div class="spinner-border spinner-border-sm"></div> Loading list...</div></div>';

  try {
    const resp = await fetch(`/api/lists/${listId}`);
    const data = await resp.json();
    if (!data.success) {
      container.innerHTML = `<div class="card"><div class="card-body text-danger">${escapeHtml(data.error || 'Failed to load')}</div></div>`;
      return;
    }
    renderListDetail(data.list, data.members);
  } catch (e) {
    container.innerHTML = `<div class="card"><div class="card-body text-danger">${escapeHtml(e.message)}</div></div>`;
  }
}

function renderListDetail(list, members) {
  const container = document.getElementById('listDetail');
  const pushable = members.filter(m => !m.pushedToHubspot).length;
  const pushed = members.filter(m => m.pushedToHubspot).length;
  const enrichable = members.filter(m => m.providerPersonId && !m.enrichedAt).length;
  const enriched = members.filter(m => m.enrichedAt).length;

  let html = `
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <h5 class="mb-1">${escapeHtml(list.name)}</h5>
            ${list.description ? `<p class="text-muted mb-2">${escapeHtml(list.description)}</p>` : ''}
            <small class="text-muted">${members.length} contact${members.length === 1 ? '' : 's'}
              ${enriched > 0 ? ` · <span class="text-primary">${enriched} enriched</span>` : ''}
              ${pushed > 0 ? ` · <span class="text-success">${pushed} in HubSpot</span>` : ''}
              ${list.pushedAt ? ` · last pushed ${new Date(list.pushedAt).toLocaleDateString()}` : ''}
            </small>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <a href="/api/lists/${list.id}/export.csv" class="btn btn-sm btn-outline-secondary">
              <i class="bi bi-download"></i> CSV
            </a>
            <button class="btn btn-sm btn-primary" ${enrichable === 0 ? 'disabled' : ''} onclick="enrichList(${list.id}, ${enrichable})" title="Reveal email, phone, and full name via Apollo (~1 credit each)">
              <i class="bi bi-magic"></i> Enrich ${enrichable}
            </button>
            <button class="btn btn-sm btn-success" ${pushable === 0 ? 'disabled' : ''} onclick="pushList(${list.id})">
              <i class="bi bi-cloud-upload"></i> Push ${pushable} to HubSpot
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteList(${list.id}, '${escapeAttr(list.name)}')">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  if (members.length === 0) {
    html += `<div class="card"><div class="card-body text-center text-muted py-5">
      No contacts yet. Add contacts from the heatmap's Apollo search results.
    </div></div>`;
  } else {
    html += `<div class="card"><div class="table-responsive"><table class="table table-sm mb-0">
      <thead class="table-light">
        <tr>
          <th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Project</th>
          <th class="text-end"></th>
        </tr>
      </thead><tbody>`;
    for (const m of members) {
      const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || '<em>(no name)</em>';
      const projLabel = m.projectName ? `${escapeHtml(m.projectName)}<br><small class="text-muted">${escapeHtml([m.projectCity, m.projectState].filter(Boolean).join(', '))}</small>` : '';
      const badges = [];
      if (m.enrichedAt) badges.push('<span class="badge bg-primary" style="font-size:0.6rem;">Enriched</span>');
      else if (m.providerPersonId) badges.push('<span class="badge bg-secondary" style="font-size:0.6rem;">Needs enrich</span>');
      if (m.pushedToHubspot) badges.push('<span class="badge bg-success" style="font-size:0.6rem;">In HubSpot</span>');
      html += `<tr>
        <td>
          <div>${name}</div>
          ${badges.join(' ')}
        </td>
        <td><small>${escapeHtml(m.title || '')}</small></td>
        <td><small>${escapeHtml(m.company || m.contractorName || '')}</small></td>
        <td><small>${m.email ? escapeHtml(m.email) : '<span class="text-muted">—</span>'}</small></td>
        <td><small>${projLabel}</small></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" style="font-size:0.7rem; padding:2px 6px;"
                  onclick="removeMember(${list.id}, ${m.id})" title="Remove from list">
            <i class="bi bi-x"></i>
          </button>
        </td>
      </tr>`;
    }
    html += '</tbody></table></div></div>';
  }

  container.innerHTML = html;
}

async function enrichList(listId, enrichableCount) {
  const ok = confirm(
    `Enrich ${enrichableCount} contact${enrichableCount === 1 ? '' : 's'} via Apollo?\n\n` +
    `This will reveal real last name, email, phone, and LinkedIn for each.\n` +
    `Cost: ~${enrichableCount} Apollo credit${enrichableCount === 1 ? '' : 's'} (1 per contact).\n\n` +
    `Already-enriched contacts are skipped.`
  );
  if (!ok) return;

  const allButtons = document.querySelectorAll('#listDetail button');
  allButtons.forEach(b => { b.disabled = true; });
  const enrichBtn = Array.from(allButtons).find(b => b.textContent.includes('Enrich'));
  const originalHtml = enrichBtn ? enrichBtn.innerHTML : '';
  if (enrichBtn) enrichBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enriching...';

  try {
    const resp = await fetch(`/api/lists/${listId}/enrich`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) {
      alert(`Enrichment failed: ${data.error}`);
      return;
    }
    const s = data.summary || {};
    alert(
      `Enrichment complete.\n\n` +
      `Attempted: ${s.attempted || 0}\n` +
      `Enriched:  ${s.enriched || 0}\n` +
      `With email: ${s.withEmail || 0}`
    );
    selectList(listId);
  } catch (e) {
    alert(`Enrichment failed: ${e.message}`);
  } finally {
    if (enrichBtn) enrichBtn.innerHTML = originalHtml;
    allButtons.forEach(b => { b.disabled = false; });
  }
}

async function pushList(listId) {
  if (!confirm('Push all not-yet-pushed contacts in this list to HubSpot?')) return;
  try {
    const resp = await fetch(`/api/lists/${listId}/push`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) {
      alert(`Push failed: ${data.error}`);
      return;
    }
    const succeeded = (data.results || []).filter(r => r.action !== 'failed').length;
    const failed = (data.results || []).filter(r => r.action === 'failed').length;
    alert(`Pushed ${succeeded} contact${succeeded === 1 ? '' : 's'}${failed > 0 ? ` (${failed} failed)` : ''}.`);
    selectList(listId);
  } catch (e) {
    alert(`Push failed: ${e.message}`);
  }
}

async function deleteList(listId, name) {
  if (!confirm(`Delete list "${name}"? This cannot be undone. Contacts themselves are not deleted.`)) return;
  try {
    const resp = await fetch(`/api/lists/${listId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!data.success) {
      alert(`Delete failed: ${data.error}`);
      return;
    }
    activeListId = null;
    document.getElementById('listDetail').innerHTML = `
      <div class="card"><div class="card-body text-center text-muted py-5">
        <i class="bi bi-arrow-left"></i> Select a list to view its contacts.
      </div></div>`;
    await loadLists();
  } catch (e) {
    alert(`Delete failed: ${e.message}`);
  }
}

async function removeMember(listId, contactId) {
  try {
    const resp = await fetch(`/api/lists/${listId}/items/${contactId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!data.success) {
      alert(`Remove failed: ${data.error}`);
      return;
    }
    selectList(listId);
    loadLists();
  } catch (e) {
    alert(`Remove failed: ${e.message}`);
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}
