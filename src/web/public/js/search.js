async function runSearch(repId) {
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const summary = document.getElementById('resultsSummary');
  const area = document.getElementById('resultsArea');

  btn.classList.add('searching');
  btn.disabled = true;
  status.innerHTML = '<i class="bi bi-hourglass-split"></i> Searching SAM.gov, State DOTs, BidNet, Construction News, and the web... This may take 1-2 minutes.';
  area.innerHTML = '';

  try {
    const res = await fetch(`/api/search/${repId}`, { method: 'POST' });
    const data = await res.json();

    btn.classList.remove('searching');
    btn.disabled = false;

    if (!data.success && !data.results) {
      status.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle"></i> Search failed: ${data.error}</div>`;
      return;
    }

    const results = data.results || { total: 0, qualified: 0, results: [] };
    const allResults = results.results || [];
    const qualified = allResults.filter(r => r.relevanceScore >= 60);
    const unqualified = allResults.filter(r => r.relevanceScore < 60);

    // Summary stats
    summary.style.display = 'flex';
    document.getElementById('statTotal').textContent = results.total || 0;
    document.getElementById('statQualified').textContent = qualified.length;
    document.getElementById('statHigh').textContent = allResults.filter(r => r.relevanceScore >= 85).length;
    document.getElementById('statMid').textContent = allResults.filter(r => r.relevanceScore >= 60 && r.relevanceScore < 85).length;

    status.innerHTML = `<i class="bi bi-check-circle text-success"></i> Found ${allResults.length} total results — ${qualified.length} qualified (score 60+), ${unqualified.length} below threshold.`;

    if (allResults.length === 0) {
      area.innerHTML = '<div class="text-muted text-center py-4">No results found. The search sources may be temporarily unavailable — try again later.</div>';
      return;
    }

    // Render qualified results
    let html = '';

    if (qualified.length > 0) {
      html += '<h6 class="mt-3 mb-2 text-success"><i class="bi bi-check-circle-fill"></i> Qualified Prospects (Score 60+)</h6>';
      html += renderResultsTable(qualified);
    }

    // Render unqualified results
    if (unqualified.length > 0) {
      html += `<div class="mt-4 mb-2 d-flex align-items-center">
        <h6 class="text-muted mb-0"><i class="bi bi-eye"></i> Below Threshold (Score &lt; 60)</h6>
        <button class="btn btn-sm btn-outline-secondary ms-2" onclick="toggleUnqualified()">Show/Hide</button>
      </div>`;
      html += `<div id="unqualifiedResults" style="display:none;">`;
      html += renderResultsTable(unqualified, true);
      html += '</div>';
    }

    area.innerHTML = html;

  } catch (err) {
    btn.classList.remove('searching');
    btn.disabled = false;
    status.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle"></i> Error: ${err.message}</div>`;
  }
}

function renderResultsTable(results, dimmed) {
  let html = '<table class="table table-hover table-sm"><thead class="table-light"><tr>';
  html += '<th style="width:60px">Score</th><th>Project</th><th>Type</th><th>Location</th><th>Bid Date</th><th>Owner / GC</th><th>Value</th><th>Source</th>';
  html += '</tr></thead><tbody>';

  for (const r of results) {
    const scoreClass = r.relevanceScore >= 85 ? 'score-high' : r.relevanceScore >= 70 ? 'score-mid' : 'score-low';
    const borderClass = r.relevanceScore >= 85 ? 'score-high-border' : r.relevanceScore >= 70 ? 'score-mid-border' : '';
    const geo = [r.geography?.city, r.geography?.state].filter(Boolean).join(', ') || '—';
    const rowStyle = dimmed ? 'opacity: 0.7;' : '';

    html += `<tr class="result-row ${borderClass}" style="${rowStyle}">`;
    html += `<td><span class="score-badge ${scoreClass}">${r.relevanceScore}</span></td>`;
    html += `<td><strong>${escapeHtml(r.projectName || 'Unknown')}</strong>`;
    if (r.scoringReasoning) html += `<br><small class="text-muted">${escapeHtml(r.scoringReasoning.substring(0, 120))}</small>`;
    if (r.notes && !r.scoringReasoning) html += `<br><small class="text-muted">${escapeHtml((r.notes || '').substring(0, 120))}</small>`;
    html += `</td>`;
    html += `<td><small>${escapeHtml(r.projectType || '—')}</small></td>`;
    html += `<td>${escapeHtml(geo)}</td>`;
    html += `<td>${r.bidDate ? escapeHtml(r.bidDate) : '<span class="text-muted">—</span>'}</td>`;

    // Owner AND GC on separate lines if both exist
    const owner = r.owner || '';
    const gc = r.generalContractor || '';
    html += '<td>';
    if (owner) html += `<small>${escapeHtml(owner)}</small>`;
    if (owner && gc) html += '<br>';
    if (gc) html += `<small class="text-primary">GC: ${escapeHtml(gc)}</small>`;
    if (!owner && !gc) html += '<span class="text-muted">—</span>';
    html += '</td>';

    // Value
    html += '<td>';
    if (r.estimatedValue && r.estimatedValue > 0) {
      html += `<small class="text-success fw-bold">$${Number(r.estimatedValue).toLocaleString()}</small>`;
    } else {
      html += '<span class="text-muted">—</span>';
    }
    html += '</td>';

    html += `<td>`;
    if (r.sourceUrl) {
      html += `<a href="${escapeHtml(r.sourceUrl)}" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="bi bi-box-arrow-up-right"></i></a>`;
    } else {
      html += `<small class="text-muted">${escapeHtml(r.source || '—')}</small>`;
    }
    html += `</td></tr>`;
  }

  html += '</tbody></table>';
  return html;
}

function toggleUnqualified() {
  const el = document.getElementById('unqualifiedResults');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
