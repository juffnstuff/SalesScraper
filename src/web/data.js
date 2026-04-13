/**
 * Data Access Layer
 * Reads/writes from PostgreSQL when available, falls back to JSON files.
 */

const db = require('./db');
const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '../../data/news_cache.json');
const SALES_PATH = path.join(__dirname, '../../data/netsuite_cache/sales.json');
const ESTIMATES_PATH = path.join(__dirname, '../../data/netsuite_cache/estimates.json');
const USERS_PATH = path.join(__dirname, '../../config/users.json');

// ── Projects ──

async function getProjects(cutoffDate) {
  if (await db.isReady()) {
    let q = 'SELECT * FROM projects';
    const params = [];
    if (cutoffDate) {
      q += ' WHERE scanned_at >= $1';
      params.push(cutoffDate);
    }
    q += ' ORDER BY scanned_at DESC';
    const { rows } = await db.query(q, params);

    // Load contractors for all projects
    const projectIds = rows.map(r => r.id);
    let contractorMap = {};
    if (projectIds.length > 0) {
      const { rows: contractors } = await db.query(
        'SELECT * FROM contractors WHERE project_id = ANY($1)',
        [projectIds]
      );
      for (const c of contractors) {
        if (!contractorMap[c.project_id]) contractorMap[c.project_id] = [];
        contractorMap[c.project_id].push({
          name: c.name, role: c.role, specialty: c.specialty,
          website: c.website, phone: c.phone, source: c.source
        });
      }
    }

    return rows.map(r => ({
      projectName: r.project_name,
      projectType: r.project_type,
      city: r.city,
      state: r.state,
      estimatedValue: parseFloat(r.estimated_value) || 0,
      bidDate: r.bid_date,
      owner: r.owner,
      generalContractor: r.general_contractor,
      sourceUrl: r.source_url,
      source: r.source,
      relevanceScore: parseFloat(r.relevance_score) || 0,
      lifecycleStage: r.lifecycle_stage,
      verticals: r.verticals || [r.lifecycle_stage || 'construction'],
      projectStatus: r.project_status,
      notes: r.notes,
      contractors: contractorMap[r.id] || [],
      contractorSearched: r.contractor_searched,
      _dbId: r.id
    }));
  }

  // JSON fallback
  try {
    if (!fs.existsSync(CACHE_PATH)) return [];
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    return (cache.projects || []).map(p => ({
      projectName: p.projectName || 'Unknown',
      projectType: p.projectType || '',
      city: p.city || '',
      state: p.state || '',
      estimatedValue: p.estimatedValue || 0,
      bidDate: p.bidDate || '',
      owner: p.owner || '',
      generalContractor: p.generalContractor || '',
      sourceUrl: p.sourceUrl || '',
      source: p.source || '',
      relevanceScore: p.relevanceScore || 0,
      lifecycleStage: p.lifecycleStage || 'construction',
      verticals: p.verticals || [p.lifecycleStage || 'construction'],
      notes: (p.notes || '').substring(0, 300),
      contractors: p.contractors || [],
      contractorSearched: p.contractorSearched || false
    }));
  } catch { return []; }
}

async function mergeProjects(results) {
  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');

  if (await db.isReady()) {
    let newCount = 0;
    for (const r of results) {
      const state = r.geography?.state || r.state || '';
      const name = r.projectName || 'Unknown';
      const stage = r.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(r);
      const status = ConstructionNewsExpanded.classifyProjectStatus({ ...r, bidDate: r.bidDate || '', notes: r.notes || '' });

      try {
        const verticals = r.verticals || ConstructionNewsExpanded.classifyAllVerticals({
          projectName: name, projectType: r.projectType || '', notes: r.notes || '',
          owner: r.owner || '', generalContractor: r.generalContractor || ''
        });

        const result = await db.query(`
          INSERT INTO projects (project_name, project_type, city, state, estimated_value, bid_date, owner, general_contractor, source_url, source, relevance_score, lifecycle_stage, verticals, project_status, notes, scanned_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
          ON CONFLICT (project_name, state) DO NOTHING
          RETURNING id
        `, [
          name, r.projectType || '', r.geography?.city || r.city || '', state,
          r.estimatedValue || 0, r.bidDate || '', r.owner || '', r.generalContractor || '',
          r.sourceUrl || '', r.source || 'construction_news_expanded', r.relevanceScore || 0,
          stage, JSON.stringify(verticals), status, (r.notes || '').substring(0, 500)
        ]);
        if (result.rows.length > 0) newCount++;
      } catch (e) {
        // Skip duplicates
      }
    }

    // Update scan metadata
    const { rows } = await db.query('SELECT COUNT(*) FROM projects');
    const total = parseInt(rows[0].count);
    await db.query(`
      INSERT INTO scan_metadata (scan_type, last_scan, total_projects)
      VALUES ('heatmap', NOW(), $1)
    `, [total]);

    console.log(`[News Cache DB] Merged: ${newCount} new, ${total} total`);
    return { total, newCount };
  }

  // JSON fallback
  const cachePath = CACHE_PATH;
  let cache = { projects: [], lastScan: null, totalProjects: 0 };
  try {
    if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch { /* fresh cache */ }

  const seen = new Set();
  for (const p of cache.projects) {
    seen.add(((p.projectName || '') + (p.state || '')).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120));
  }

  let newCount = 0;
  for (const r of results) {
    const state = r.geography?.state || r.state || '';
    const key = ((r.projectName || '') + state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    newCount++;
    const verticals = r.verticals || ConstructionNewsExpanded.classifyAllVerticals({
      projectName: r.projectName || '', projectType: r.projectType || '', notes: r.notes || '',
      owner: r.owner || '', generalContractor: r.generalContractor || ''
    });
    cache.projects.push({
      projectName: r.projectName || 'Unknown',
      projectType: r.projectType || '',
      city: r.geography?.city || r.city || '',
      state,
      estimatedValue: r.estimatedValue || 0,
      bidDate: r.bidDate || '',
      owner: r.owner || '',
      generalContractor: r.generalContractor || '',
      sourceUrl: r.sourceUrl || '',
      source: r.source || 'construction_news_expanded',
      relevanceScore: r.relevanceScore || 0,
      lifecycleStage: verticals[0] || ConstructionNewsExpanded.classifyLifecycleStage(r),
      verticals: verticals,
      notes: (r.notes || '').substring(0, 300),
      scannedAt: new Date().toISOString()
    });
  }

  cache.lastScan = new Date().toISOString();
  cache.totalProjects = cache.projects.length;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  console.log(`[News Cache] Merged: ${newCount} new, ${cache.projects.length} total`);
  return { total: cache.projects.length, newCount };
}

async function findProject(projectName, state) {
  if (await db.isReady()) {
    let { rows } = await db.query(
      'SELECT * FROM projects WHERE project_name = $1 AND state = $2',
      [projectName, state]
    );
    if (rows.length === 0) {
      // Case-insensitive fallback
      ({ rows } = await db.query(
        'SELECT * FROM projects WHERE LOWER(TRIM(project_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(state)) = LOWER(TRIM($2))',
        [projectName, state]
      ));
    }
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      _dbId: r.id,
      projectName: r.project_name, projectType: r.project_type,
      city: r.city, state: r.state, estimatedValue: parseFloat(r.estimated_value) || 0,
      bidDate: r.bid_date, owner: r.owner, generalContractor: r.general_contractor,
      sourceUrl: r.source_url, source: r.source, notes: r.notes
    };
  }

  // JSON fallback
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    let project = cache.projects.find(p => p.projectName === projectName && p.state === state);
    if (!project) {
      const nameLower = projectName.toLowerCase().trim();
      const stateLower = (state || '').toLowerCase().trim();
      project = cache.projects.find(p =>
        (p.projectName || '').toLowerCase().trim() === nameLower &&
        (p.state || '').toLowerCase().trim() === stateLower
      );
    }
    return project || null;
  } catch { return null; }
}

async function saveContractors(projectName, state, contractors) {
  if (await db.isReady()) {
    const { rows } = await db.query(
      'SELECT id FROM projects WHERE project_name = $1 AND state = $2',
      [projectName, state]
    );
    if (rows.length === 0) return;
    const projectId = rows[0].id;

    // Clear old contractors
    await db.query('DELETE FROM contractors WHERE project_id = $1', [projectId]);

    for (const c of contractors) {
      await db.query(`
        INSERT INTO contractors (project_id, name, role, specialty, website, phone, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [projectId, c.name || '', c.role || '', c.specialty || '', c.website || '', c.phone || '', c.source || '']);
    }

    await db.query('UPDATE projects SET contractor_searched = TRUE WHERE id = $1', [projectId]);
    return;
  }

  // JSON fallback
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    const project = cache.projects.find(p => p.projectName === projectName && p.state === state);
    if (project) {
      project.contractors = contractors;
      project.contractorSearched = true;
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
    }
  } catch { /* skip */ }
}

// ── Transactions ──

async function getTransactions(repId, reps) {
  const repLookup = {};
  for (const r of reps) repLookup[r.netsuiteId] = r.name;

  let netsuiteRepId = null;
  if (repId) {
    const rep = reps.find(r => r.id === repId);
    if (rep) netsuiteRepId = rep.netsuiteId;
  }

  if (await db.isReady()) {
    let q = 'SELECT * FROM transactions';
    const params = [];
    if (netsuiteRepId) {
      q += ' WHERE sales_rep = $1';
      params.push(String(netsuiteRepId));
    }
    const { rows } = await db.query(q, params);

    return rows.map(r => {
      const isEstimate = r.tran_type === 'Estimate';
      const layer = isEstimate
        ? classifyEstimateStatusFromDb(r.status, r.ns_status, r.lost_reason)
        : 'shipped';

      return {
        id: r.id, tranId: r.tran_id, type: r.tran_type, layer,
        date: r.date, total: parseFloat(r.total) || 0,
        customerName: r.customer_name, memo: r.memo,
        city: r.city, state: r.state, zip: r.zip, street: r.street,
        repName: repLookup[r.sales_rep] || '',
        vertical: r.vertical, hqCity: r.hq_city, hqState: r.hq_state,
        firstOrder: r.first_order, firstQuote: r.first_quote,
        leadSource: r.lead_source, items: r.items || [],
        // Estimate-specific
        nsStatus: r.ns_status, probability: r.probability,
        daysOpen: r.days_open, contactEmail: r.contact_email,
        isBid: r.is_bid, linkedSO: r.linked_so,
        dateConverted: r.date_converted, lostReason: r.lost_reason,
        reasonForLoss: r.reason_for_loss, status: r.status
      };
    });
  }

  // JSON fallback — return null to signal server.js should use existing file logic
  return null;
}

function classifyEstimateStatusFromDb(status, nsStatus, lostReason) {
  const s = (status || '').toLowerCase();
  const ns = (nsStatus || '').toLowerCase();
  const lr = (lostReason || '').trim();

  // Explicitly converted
  if (ns === 'converted' || s === 'processed') return 'converted';
  // Closed: check lost reason to distinguish converted vs lost
  if (s === 'closed' || ns === 'closed') {
    if (!lr) return 'converted'; // closed without lost reason = converted
    if (lr.toLowerCase().includes('alternate rf solution')) return 'converted'; // bought different RF product
    return 'lost';
  }
  // Expired / voided = lost
  if (s === 'expired' || ns === 'expired' || s === 'voided' || ns === 'voided') return 'lost';
  // Has a lost reason regardless = lost
  if (lr) return 'lost';
  return 'open';
}

// ── Users ──

async function getUsers() {
  if (await db.isReady()) {
    const { rows } = await db.query('SELECT * FROM users ORDER BY id');
    return rows.map(r => ({
      username: r.username,
      passwordHash: r.password_hash,
      name: r.name,
      email: r.email,
      role: r.role,
      repId: r.rep_id,
      mustChangePassword: r.must_change_password,
      createdAt: r.created_at
    }));
  }

  // JSON fallback
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch { return []; }
}

async function saveUsers(users) {
  if (await db.isReady()) {
    for (const u of users) {
      await db.query(`
        INSERT INTO users (username, password_hash, name, email, role, rep_id, must_change_password)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (username) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          rep_id = EXCLUDED.rep_id,
          must_change_password = EXCLUDED.must_change_password
      `, [u.username, u.passwordHash, u.name, u.email || '', u.role || 'sales_rep', u.repId || null, u.mustChangePassword !== false]);
    }
    return;
  }

  // JSON fallback
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

async function updateUser(username, updates) {
  if (await db.isReady()) {
    const sets = [];
    const params = [];
    let i = 1;

    if (updates.passwordHash !== undefined) { sets.push(`password_hash = $${i++}`); params.push(updates.passwordHash); }
    if (updates.mustChangePassword !== undefined) { sets.push(`must_change_password = $${i++}`); params.push(updates.mustChangePassword); }

    if (sets.length === 0) return;
    params.push(username);
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE username = $${i}`, params);
    return;
  }

  // JSON fallback
  const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  const user = users.find(u => u.username === username);
  if (user) {
    Object.assign(user, updates);
    fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  }
}

module.exports = {
  getProjects, mergeProjects, findProject, saveContractors,
  getTransactions, getUsers, saveUsers, updateUser
};
