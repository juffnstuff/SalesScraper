async function runSearch(repId) {
  const btn = document.getElementById('searchBtn');
  const status = document.getElementById('searchStatus');
  const summary = document.getElementById('resultsSummary');
  const area = document.getElementById('resultsArea');

  btn.classList.add('searching');
  btn.disabled = true;
  status.innerHTML = '<i class="bi bi-hourglass-split"></i> Searching SAM.gov, State DOTs, BidNet, and the web... This may take a minute.';
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

    // Summary stats
    summary.style.display = 'flex';
    document.getElementById('statTotal').textContent = results.total || 0;
    document.getElementById('statQualified').textContent = results.qualified || 0;
    document.getElementById('statHigh').textContent = (results.results || []).filter(r => r.relevanceScore >= 85).length;
    document.getElementById('statMid').textContent = (results.results || []).filter(r => r.relevanceScore >= 60 && r.relevanceScore < 85).length;

    status.innerHTML = `<i class="bi bi-check-circle text-success"></i> Found ${results.qualified || 0} qualified prospects from ${results.total || 0} raw results.`;

    // Render results
    if (!results.results || results.results.length === 0) {
      area.innerHTML = '<div class="text-muted text-center py-4">No qualified results found. Try adjusting the ICP or running again later.</div>';
      return;
    }

    let html = '<table class="table table-hover"><thead class="table-light"><tr>';
    html += '<th>Score</th><th>Project</th><th>Type</th><th>Location</th><th>Bid Date</th><th>Owner / GC</th><th>Source</th>';
    html += '</tr></thead><tbody>';

    for (const r of results.results) {
      const scoreClass = r.relevanceScore >= 85 ? 'score-high' : r.relevanceScore >= 70 ? 'score-mid' : 'score-low';
      const borderClass = r.relevanceScore >= 85 ? 'score-high-border' : r.relevanceScore >= 70 ? 'score-mid-border' : '';
      const geo = [r.geography?.city, r.geography?.state].filter(Boolean).join(', ') || '—';

      html += `<tr class="result-row ${borderClass}">`;
      html += `<td><span class="score-badge ${scoreClass}">${r.relevanceScore}</span></td>`;
      html += `<td><strong>${escapeHtml(r.projectName || 'Unknown')}</strong>`;
      if (r.scoringReasoning) html += `<br><small class="text-muted">${escapeHtml(r.scoringReasoning.substring(0, 100))}</small>`;
      html += `</td>`;
      html += `<td><small>${escapeHtml(r.projectType || '—')}</small></td>`;
      html += `<td>${escapeHtml(geo)}</td>`;
      html += `<td>${r.bidDate ? escapeHtml(r.bidDate) : '<span class="text-muted">—</span>'}</td>`;
      html += `<td><small>${escapeHtml(r.owner || r.generalContractor || '—')}</small></td>`;
      html += `<td>`;
      if (r.sourceUrl) {
        html += `<a href="${escapeHtml(r.sourceUrl)}" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="bi bi-box-arrow-up-right"></i></a>`;
      } else {
        html += `<small class="text-muted">${escapeHtml(r.source || '—')}</small>`;
      }
      html += `</td></tr>`;
    }

    html += '</tbody></table>';
    area.innerHTML = html;

  } catch (err) {
    btn.classList.remove('searching');
    btn.disabled = false;
    status.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle"></i> Error: ${err.message}</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
