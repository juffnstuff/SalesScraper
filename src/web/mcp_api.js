/**
 * /api/mcp/* — read-only, bearer-keyed API family for rf-business-mcp.
 *
 * This is how RubberForm's MCP aggregator (RF-MCP) reads the Prospecting
 * Engine: heat-map projects, contractors and contacts, contact lists, rep
 * ICPs, prospecting run logs, and the NetSuite-synced sales map. Same
 * convention as DSOATD / QMS / Production Tracker: the aggregator sends
 * `Authorization: Bearer <SALESSCRAPER_MCP_API_KEY>` and the key must match
 * the same-named variable on this service.
 *
 * STRICTLY GET. Nothing here can start a Claude scan, spend an Apollo
 * credit, or push a contact to HubSpot — those cost money and stay in the
 * web UI with a human behind them. Any non-GET request answers 405.
 *
 * Mounted from server.js via createMcpRouter({ ...shared helpers }), so the
 * rep / ICP / run-log / sales-map logic is shared with the web UI rather
 * than duplicated.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { createHash, timingSafeEqual } = require('crypto');
const dataLayer = require('./data');
const db = require('./db');
const netsuiteSync = require('./netsuite_sync');

const NEWS_CACHE_PATH = path.join(__dirname, '../../data/news_cache.json');

// ── Auth ──

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function requireMcpKey(req, res, next) {
  const key = process.env.SALESSCRAPER_MCP_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'MCP API not configured — set SALESSCRAPER_MCP_API_KEY on this service' });
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!m || !safeEqual(m[1].trim(), key)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function readOnly(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.set('Allow', 'GET');
  res.status(405).json({ error: 'The MCP API is read-only (GET only)' });
}

// ── Helpers ──

function intParam(v, fallback, { min = 1, max = Infinity } = {}) {
  if (v == null || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function lower(s) { return (s == null ? '' : String(s)).toLowerCase(); }

function cutoffFromDays(days) {
  return days > 0 ? new Date(Date.now() - days * 86400000) : null;
}

function ageDays(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
}

async function getLastHeatmapScan() {
  try {
    if (await db.isReady()) {
      const { rows } = await db.query(
        "SELECT last_scan FROM scan_metadata WHERE scan_type = 'heatmap' ORDER BY last_scan DESC LIMIT 1"
      );
      if (rows.length > 0 && rows[0].last_scan) return rows[0].last_scan;
    }
  } catch { /* fall through to JSON */ }
  try {
    if (fs.existsSync(NEWS_CACHE_PATH)) {
      const cache = JSON.parse(fs.readFileSync(NEWS_CACHE_PATH, 'utf8'));
      return cache.lastScan || null;
    }
  } catch { /* ignore */ }
  return null;
}

// Public-safe view of a rep profile (no tokens live here, but keep it explicit).
function publicRep(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    title: r.title || '',
    territory: r.territory || '',
    segment: r.segment || '',
    verticals: r.verticals || [],
    netsuiteId: r.netsuiteId,
    hubspotOwnerId: r.hubspotOwnerId,
    inactive: !!r.inactive,
    successorRepId: r.successorRepId || null,
    hubspotAssignTo: r.hubspotAssignTo || null,
    hubspotAssignRentals: r.hubspotAssignRentals || null
  };
}

function compactProject(p) {
  return {
    id: p._dbId != null ? p._dbId : null,
    projectName: p.projectName,
    projectType: p.projectType || '',
    city: p.city || '',
    state: p.state || '',
    estimatedValue: p.estimatedValue || 0,
    bidDate: p.bidDate || '',
    owner: p.owner || '',
    generalContractor: p.generalContractor || '',
    projectStatus: p.projectStatus || 'Unknown',
    lifecycleStage: p.lifecycleStage || 'construction',
    verticals: p.verticals || [],
    relevanceScore: p.relevanceScore || 0,
    source: p.source || '',
    sourceUrl: p.sourceUrl || '',
    notes: (p.notes || '').substring(0, 300),
    contractorSearched: !!p.contractorSearched,
    contractorCount: p.contractorCount != null ? p.contractorCount : (p.contractors || []).length,
    contactCount: p.contactCount != null ? p.contactCount : undefined,
    contractors: (p.contractors || []).map(c => ({ name: c.name, role: c.role, specialty: c.specialty || '' }))
  };
}

function compactRunLog(log) {
  const sr = log.searchResults || {};
  const push = log.pushResults || [];
  return {
    runDate: log.runDate || null,
    repId: log.repId || null,
    repName: log.repName || '',
    total: sr.total || 0,
    unique: sr.unique != null ? sr.unique : undefined,
    qualified: sr.qualified || 0,
    pushed: push.filter(p => p.action === 'created').length,
    pushAttempted: push.length,
    topResults: (sr.results || []).slice(0, 10).map(r => ({
      projectName: r.projectName,
      relevanceScore: r.relevanceScore || 0,
      estimatedValue: r.estimatedValue || 0,
      state: (r.geography && r.geography.state) || '',
      owner: r.owner || '',
      source: r.source || ''
    })),
    file: log._filename
  };
}

// ── Router ──

/**
 * @param {object} deps  Shared helpers from server.js.
 * @param {() => Array} deps.loadReps
 * @param {(repId: string) => object|null} deps.loadICP
 * @param {(repId?: string) => Array} deps.loadRunLogs
 * @param {(repId: string, days: number) => Promise<{transactions: Array, summary: object}>} deps.buildSalesMapData
 */
function createMcpRouter(deps) {
  const { loadReps, loadICP, loadRunLogs, buildSalesMapData } = deps;
  const router = express.Router();

  router.use(readOnly);
  router.use(requireMcpKey);

  // Wrap handlers so a thrown error becomes a JSON 500 instead of an HTML page.
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error(`[mcp] ${req.method} ${req.originalUrl} failed:`, e.message);
      res.status(500).json({ error: e.message });
    }
  };

  // Cheapest authenticated call — proves the key matches.
  router.get('/ping', wrap(async (req, res) => {
    res.json({ ok: true, service: 'salesscraper', time: new Date().toISOString(), dbReady: await db.isReady() });
  }));

  // One-call state of the engine.
  router.get('/summary', wrap(async (req, res) => {
    const reps = loadReps();
    const activeReps = reps.filter(r => !r.inactive);
    const icps = activeReps.map(r => {
      const icp = loadICP(r.id);
      return {
        repId: r.id,
        repName: r.name,
        hasIcp: !!icp,
        generatedAt: icp ? icp.generatedAt || null : null,
        ageDays: icp ? ageDays(icp.generatedAt) : null,
        stale: icp ? (ageDays(icp.generatedAt) == null || ageDays(icp.generatedAt) > 30) : true
      };
    });

    const [projects, lists, lastScan, dbReady] = await Promise.all([
      dataLayer.getProjects(),
      dataLayer.getLists(),
      getLastHeatmapScan(),
      db.isReady()
    ]);
    const projectsLast30 = projects.filter(p => p.scannedAt && ageDays(p.scannedAt) != null && ageDays(p.scannedAt) <= 30).length;

    let netsuite;
    try { netsuite = await netsuiteSync.getSyncStatus(); }
    catch (e) { netsuite = { available: false, error: e.message }; }

    const logs = loadRunLogs();

    res.json({
      time: new Date().toISOString(),
      database: dbReady ? 'postgres' : 'json-fallback',
      enrichmentProvider: (process.env.ENRICHMENT_PROVIDER || 'apollo').toLowerCase(),
      reps: { active: activeReps.length, total: reps.length },
      icps,
      heatmap: {
        projects: projects.length,
        projectsScannedLast30Days: projectsLast30,
        withContractors: projects.filter(p => (p.contractors || []).length > 0).length,
        lastScan
      },
      contactLists: {
        count: lists.length,
        members: lists.reduce((s, l) => s + (l.memberCount || 0), 0),
        pushedToHubspot: lists.reduce((s, l) => s + (l.pushedCount || 0), 0)
      },
      netsuiteSync: netsuite,
      lastProspectingRun: logs[0] ? { runDate: logs[0].runDate || null, repId: logs[0].repId || null, repName: logs[0].repName || '' } : null
    });
  }));

  // Sales reps and their vertical routing.
  router.get('/reps', wrap(async (req, res) => {
    const includeInactive = lower(req.query.includeInactive) === 'true';
    const reps = loadReps().filter(r => includeInactive || !r.inactive).map(publicRep);
    res.json({ reps, total: reps.length });
  }));

  // Full ICP for one rep.
  router.get('/icp/:repId', wrap(async (req, res) => {
    const rep = loadReps().find(r => r.id === req.params.repId);
    if (!rep) return res.status(404).json({ error: `Rep '${req.params.repId}' not found` });
    const icp = loadICP(rep.id);
    if (!icp) return res.status(404).json({ error: `No ICP generated yet for ${rep.name}` });
    res.json({ rep: publicRep(rep), ageDays: ageDays(icp.generatedAt), stale: ageDays(icp.generatedAt) == null || ageDays(icp.generatedAt) > 30, icp });
  }));

  // Heat-map construction projects with filters.
  router.get('/projects', wrap(async (req, res) => {
    const days = intParam(req.query.days, 0, { min: 0, max: 3650 });
    const limit = intParam(req.query.limit, 100, { min: 1, max: 500 });
    const state = (req.query.state || '').toUpperCase().trim();
    const vertical = lower(req.query.vertical).trim();
    const status = lower(req.query.status).trim();
    const minValue = Number(req.query.minValue) || 0;
    const q = lower(req.query.q).trim();

    let projects = await dataLayer.getProjects(cutoffFromDays(days));
    if (state) projects = projects.filter(p => (p.state || '').toUpperCase() === state);
    if (vertical) projects = projects.filter(p => (p.verticals || []).map(lower).includes(vertical));
    if (status) projects = projects.filter(p => lower(p.projectStatus) === status);
    if (minValue > 0) projects = projects.filter(p => (p.estimatedValue || 0) >= minValue);
    if (q) {
      projects = projects.filter(p =>
        [p.projectName, p.owner, p.generalContractor, p.city, p.projectType, p.notes].some(f => lower(f).includes(q))
      );
    }
    projects.sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0));

    const byVertical = {};
    const byState = {};
    const byStatus = {};
    let totalValue = 0;
    for (const p of projects) {
      for (const v of (p.verticals || [])) byVertical[v] = (byVertical[v] || 0) + 1;
      if (p.state) byState[p.state] = (byState[p.state] || 0) + 1;
      const s = p.projectStatus || 'Unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
      totalValue += p.estimatedValue || 0;
    }

    res.json({
      filters: { days, state: state || null, vertical: vertical || null, status: status || null, minValue, q: q || null, limit },
      total: projects.length,
      returned: Math.min(limit, projects.length),
      totalEstimatedValue: totalValue,
      byVertical, byState, byStatus,
      lastScan: await getLastHeatmapScan(),
      projects: projects.slice(0, limit).map(compactProject)
    });
  }));

  // One project with its contractors and decision-maker contacts (Postgres only).
  router.get('/projects/:id', wrap(async (req, res) => {
    const id = intParam(req.params.id, 0, { min: 0 });
    if (!id) return res.status(400).json({ error: 'numeric project id required' });
    if (!(await db.isReady())) return res.status(503).json({ error: 'project detail requires the PostgreSQL database' });

    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: `Project ${id} not found` });
    const r = rows[0];
    const [contractors, contacts] = await Promise.all([
      dataLayer.getContractorsForProject(id),
      dataLayer.getContactsForProject(id)
    ]);
    res.json({
      project: {
        id: r.id,
        projectName: r.project_name,
        projectType: r.project_type,
        city: r.city,
        state: r.state,
        estimatedValue: parseFloat(r.estimated_value) || 0,
        bidDate: r.bid_date,
        owner: r.owner,
        generalContractor: r.general_contractor,
        projectStatus: r.project_status,
        lifecycleStage: r.lifecycle_stage,
        verticals: r.verticals || [],
        relevanceScore: parseFloat(r.relevance_score) || 0,
        source: r.source,
        sourceUrl: r.source_url,
        notes: r.notes || '',
        scannedAt: r.scanned_at,
        contractorSearched: !!r.contractor_searched
      },
      contractors: contractors.map(c => ({
        id: c.id, name: c.name, role: c.role, specialty: c.specialty || '',
        website: c.website || '', phone: c.phone || '', source: c.source || ''
      })),
      contacts
    });
  }));

  // Projects matching a rep's verticals (what the rep sees on /search/:repId).
  router.get('/rep-projects/:repId', wrap(async (req, res) => {
    const reps = loadReps();
    const rep = reps.find(r => r.id === req.params.repId);
    if (!rep) return res.status(404).json({ error: `Rep '${req.params.repId}' not found` });
    const limit = intParam(req.query.limit, 100, { min: 1, max: 500 });
    const state = (req.query.state || '').toUpperCase().trim();
    let projects = await dataLayer.getProjectsForRep(rep.id, reps);
    if (state) projects = projects.filter(p => (p.state || '').toUpperCase() === state);
    res.json({
      rep: publicRep(rep),
      total: projects.length,
      returned: Math.min(limit, projects.length),
      projects: projects.slice(0, limit).map(compactProject)
    });
  }));

  // Decision-maker contacts already found for a project.
  router.get('/contacts/:projectId', wrap(async (req, res) => {
    const id = intParam(req.params.projectId, 0, { min: 0 });
    if (!id) return res.status(400).json({ error: 'numeric project id required' });
    const contacts = await dataLayer.getContactsForProject(id);
    res.json({ projectId: id, total: contacts.length, contacts });
  }));

  // Contact lists (the shared "shopping carts").
  router.get('/lists', wrap(async (req, res) => {
    const lists = await dataLayer.getLists();
    res.json({ lists, total: lists.length });
  }));

  router.get('/lists/:id', wrap(async (req, res) => {
    const id = intParam(req.params.id, 0, { min: 0 });
    if (!id) return res.status(400).json({ error: 'numeric list id required' });
    const list = await dataLayer.getListById(id);
    if (!list) return res.status(404).json({ error: `List ${id} not found` });
    const members = await dataLayer.getListMembers(id);
    res.json({
      list: {
        id: list.id, name: list.name, description: list.description || '',
        createdAt: list.created_at, pushedAt: list.pushed_at, pushedCount: list.pushed_count || 0
      },
      total: members.length,
      withEmail: members.filter(m => m.email).length,
      pushedToHubspot: members.filter(m => m.pushedToHubspot).length,
      members
    });
  }));

  // Recent prospecting runs (what /reports shows).
  router.get('/run-logs', wrap(async (req, res) => {
    const limit = intParam(req.query.limit, 20, { min: 1, max: 50 });
    const repId = (req.query.repId || '').trim() || undefined;
    const logs = loadRunLogs(repId).slice(0, limit).map(compactRunLog);
    res.json({ repId: repId || null, total: logs.length, runs: logs });
  }));

  // NetSuite → Postgres sync health.
  router.get('/netsuite-sync-status', wrap(async (req, res) => {
    res.json(await netsuiteSync.getSyncStatus());
  }));

  // ── Sales map (NetSuite sales orders + estimates). Financial data. ──

  // Filters shared by /sales-summary and /sales-transactions.
  async function loadSalesTransactions(query) {
    const reps = loadReps();
    const repId = (query.repId || '').trim();
    if (repId && !reps.find(r => r.id === repId)) {
      return { error: `Rep '${repId}' not found` };
    }
    const days = intParam(query.days, 365, { min: 0, max: 3650 });
    const state = (query.state || '').toUpperCase().trim();
    const layer = lower(query.layer).trim();
    const type = lower(query.type).trim();
    const customer = lower(query.customer).trim();

    const { transactions } = await buildSalesMapData(repId, days);
    let rows = transactions;
    if (state) rows = rows.filter(t => (t.state || '').toUpperCase() === state);
    if (layer) rows = rows.filter(t => lower(t.layer) === layer);
    if (type) rows = rows.filter(t => lower(t.type) === type);
    if (customer) rows = rows.filter(t => lower(t.customerName).includes(customer));
    return { rows, filters: { repId: repId || null, days, state: state || null, layer: layer || null, type: type || null, customer: customer || null } };
  }

  router.get('/sales-summary', wrap(async (req, res) => {
    const loaded = await loadSalesTransactions(req.query);
    if (loaded.error) return res.status(404).json({ error: loaded.error });
    const { rows, filters } = loaded;

    const bucket = () => ({ count: 0, total: 0 });
    const byLayer = {};
    const byRep = {};
    const byState = {};
    const byCustomer = {};
    const byLeadSource = {};
    let firstOrders = 0;
    let firstQuotes = 0;

    for (const t of rows) {
      const l = t.layer || 'unknown';
      (byLayer[l] = byLayer[l] || bucket()).count++; byLayer[l].total += t.total;

      const rep = t.repName || 'Unassigned';
      const rb = (byRep[rep] = byRep[rep] || { quoted: bucket(), direct: bucket(), pending: bucket(), open: bucket(), lost: bucket() });
      if (rb[l]) { rb[l].count++; rb[l].total += t.total; }

      const st = t.state || '??';
      (byState[st] = byState[st] || bucket()).count++; byState[st].total += t.total;

      const isShipped = l === 'quoted' || l === 'direct';
      if (isShipped) {
        const c = t.customerName || 'Unknown';
        (byCustomer[c] = byCustomer[c] || bucket()).count++; byCustomer[c].total += t.total;
        const ls = t.leadSource || 'Unknown';
        (byLeadSource[ls] = byLeadSource[ls] || bucket()).count++; byLeadSource[ls].total += t.total;
        if (t.firstOrder) firstOrders++;
      }
      if (l === 'open' && t.firstQuote) firstQuotes++;
    }

    const shipped = (byLayer.quoted || bucket()).total + (byLayer.direct || bucket()).total;
    const top = (obj, n) => Object.entries(obj)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, n)
      .map(([name, v]) => ({ name, count: v.count, total: v.total }));

    res.json({
      filters,
      transactions: rows.length,
      shippedRevenue: shipped,
      pendingValue: (byLayer.pending || bucket()).total,
      openQuoteValue: (byLayer.open || bucket()).total,
      lostQuoteValue: (byLayer.lost || bucket()).total,
      quoteWinRateByCount: (() => {
        const won = (byLayer.quoted || bucket()).count;
        const lost = (byLayer.lost || bucket()).count;
        return won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : null;
      })(),
      firstOrders,
      firstQuotes,
      byLayer,
      byRep,
      topStates: top(byState, 15),
      topCustomers: top(byCustomer, 15),
      byLeadSource: top(byLeadSource, 15),
      layerLegend: {
        quoted: 'shipped sales order that had a prior quote',
        direct: 'shipped sales order with no quote',
        pending: 'sales order pending approval or fulfillment',
        open: 'open estimate (quote) not yet won or lost',
        lost: 'estimate closed lost, expired, voided or declined'
      }
    });
  }));

  router.get('/sales-transactions', wrap(async (req, res) => {
    const loaded = await loadSalesTransactions(req.query);
    if (loaded.error) return res.status(404).json({ error: loaded.error });
    const { rows, filters } = loaded;
    const limit = intParam(req.query.limit, 100, { min: 1, max: 500 });
    const includeItems = lower(req.query.includeItems) === 'true';

    rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const out = rows.slice(0, limit).map(t => {
      const o = {
        id: t.id, tranId: t.tranId, type: t.type, layer: t.layer, date: t.date, total: t.total,
        customerName: t.customerName, repName: t.repName, status: t.status || null,
        city: t.city, state: t.state, zip: t.zip,
        vertical: t.vertical || '', leadSource: t.leadSource || '',
        firstOrder: !!t.firstOrder, firstQuote: !!t.firstQuote, hadQuote: !!t.hadQuote,
        memo: (t.memo || '').substring(0, 200),
        itemCount: Array.isArray(t.items) ? t.items.length : 0
      };
      if (t.type === 'Estimate') {
        Object.assign(o, {
          probability: t.probability, daysOpen: t.daysOpen, isBid: !!t.isBid,
          lostReason: t.lostReason || '', reasonForLoss: t.reasonForLoss || '',
          linkedSO: t.linkedSO || '', dateConverted: t.dateConverted || ''
        });
      }
      if (includeItems) {
        o.items = (t.items || []).map(it => ({
          itemId: it.itemId || '', description: it.description || it.itemName || '',
          partGroup: it.partGroup || '', qty: it.qty || 0, amount: it.amount || 0
        }));
      }
      return o;
    });

    res.json({ filters: { ...filters, limit, includeItems }, total: rows.length, returned: out.length, transactions: out });
  }));

  router.use((req, res) => res.status(404).json({ error: `no MCP route ${req.method} ${req.originalUrl}` }));
  return router;
}

module.exports = { createMcpRouter, requireMcpKey };
