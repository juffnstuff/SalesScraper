/**
 * RubberForm Prospecting Engine — Web Server
 * Express app with MS365 authentication and dashboard UI.
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { OIDCStrategy } = require('passport-azure-ad');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Production proxy (Railway, Render, etc.) ──
app.set('trust proxy', 1);

// ── View engine ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ──
app.use(session({
  secret: process.env.SESSION_SECRET || 'rubberform-prospect-engine-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

// ── MS365 / Azure AD Authentication ──
const MS365_ENABLED = process.env.MS365_CLIENT_ID && process.env.MS365_TENANT_ID;

if (MS365_ENABLED) {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  passport.use(new OIDCStrategy({
    identityMetadata: `https://login.microsoftonline.com/${process.env.MS365_TENANT_ID}/v2.0/.well-known/openid-configuration`,
    clientID: process.env.MS365_CLIENT_ID,
    clientSecret: process.env.MS365_CLIENT_SECRET,
    responseType: 'code',
    responseMode: 'form_post',
    redirectUrl: process.env.AUTH_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`,
    allowHttpForRedirectUrl: true,
    scope: ['profile', 'email', 'openid'],
    passReqToCallback: false
  }, (iss, sub, profile, accessToken, refreshToken, done) => {
    // Only allow @rubberform.com emails
    const email = (profile.upn || profile._json?.email || '').toLowerCase();
    if (email.endsWith('@rubberform.com')) {
      return done(null, {
        id: profile.oid,
        name: profile.displayName,
        email: email
      });
    }
    return done(null, false, { message: 'Access restricted to RubberForm employees' });
  }));

  app.use(passport.initialize());
  app.use(passport.session());
}

// ── Auth middleware ──
function ensureAuth(req, res, next) {
  if (!MS365_ENABLED) return next(); // Skip auth if not configured
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// ── Load shared data ──
function loadReps() {
  const repsPath = path.join(__dirname, '../../config/rep_profiles.json');
  return JSON.parse(fs.readFileSync(repsPath, 'utf8'));
}

function loadICP(repId) {
  const icpPath = path.join(__dirname, `../../config/icps/${repId}_icp.json`);
  if (fs.existsSync(icpPath)) return JSON.parse(fs.readFileSync(icpPath, 'utf8'));
  return null;
}

function loadRunLogs(repId) {
  const logsDir = path.join(__dirname, '../../logs/runs');
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.json') && (!repId || f.includes(repId)))
    .sort().reverse()
    .slice(0, 20)
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf8'));
        data._filename = f;
        return data;
      } catch { return null; }
    })
    .filter(Boolean);
}

// ── Estimate status classifier ──
function classifyEstimateStatus(statusDisplay, lostReason) {
  if (!statusDisplay) return 'open';
  const s = statusDisplay.toLowerCase();
  if (s.includes('processed') || s.includes('converted') || s.includes('closed won')) return 'converted';
  if (s.includes('closed') || s.includes('expired') || s.includes('voided') || s.includes('declined')) {
    // "Lost: Alternate RF Solution/Quote" means customer bought a different RF product — not truly lost
    if (lostReason && lostReason.toLowerCase().includes('alternate rf solution')) return 'converted';
    return 'lost';
  }
  return 'open';
}

// ── Auth routes ──
app.get('/login', (req, res) => {
  if (!MS365_ENABLED) return res.redirect('/');
  res.render('login');
});

if (MS365_ENABLED) {
  app.get('/auth/signin', passport.authenticate('azuread-openidconnect', { failureRedirect: '/login' }));
  app.post('/auth/callback', passport.authenticate('azuread-openidconnect', { failureRedirect: '/login' }), (req, res) => {
    res.redirect('/');
  });
}

app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// ── Dashboard ──
app.get('/', ensureAuth, (req, res) => {
  const reps = loadReps();
  const repsWithICP = reps.map(rep => ({
    ...rep,
    icp: loadICP(rep.id)
  }));
  const recentLogs = loadRunLogs();
  res.render('dashboard', {
    user: req.user || { name: 'Local User' },
    reps: repsWithICP,
    recentLogs,
    MS365_ENABLED
  });
});

// ── Search page ──
app.get('/search/:repId', ensureAuth, (req, res) => {
  const reps = loadReps();
  const rep = reps.find(r => r.id === req.params.repId);
  if (!rep) return res.status(404).send('Rep not found');
  const icp = loadICP(rep.id);
  res.render('search', {
    user: req.user || { name: 'Local User' },
    rep, icp, results: null, MS365_ENABLED
  });
});

// ── API: Run search ──
app.post('/api/search/:repId', ensureAuth, async (req, res) => {
  const reps = loadReps();
  const rep = reps.find(r => r.id === req.params.repId);
  if (!rep) return res.status(404).json({ error: 'Rep not found' });

  const icp = loadICP(rep.id);
  if (!icp) return res.status(400).json({ error: 'No ICP found for this rep' });

  try {
    const BidSearcher = require('../prospecting/bid_searcher');
    const searcher = new BidSearcher();
    const results = await searcher.searchForRep(rep, icp);

    // Save run log
    const Reporter = require('../ui/reporter');
    Reporter.saveRunLog(rep.id, {
      repName: rep.name,
      icp,
      searchResults: results,
      pushResults: []
    });

    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: error.message, results: { total: 0, qualified: 0, results: [] } });
  }
});

// ── Review page ──
app.get('/review', ensureAuth, (req, res) => {
  const logs = loadRunLogs();
  // Gather all unpushed results
  const pending = [];
  for (const log of logs) {
    const results = log.searchResults?.results || [];
    const pushed = (log.pushResults || []).map(p => p.contactId).filter(Boolean);
    for (const r of results) {
      if (!pushed.includes(r.projectName)) {
        pending.push({ ...r, repName: log.repName, repId: log.repId, logFile: log._filename });
      }
    }
  }
  res.render('review', {
    user: req.user || { name: 'Local User' },
    pending: pending.slice(0, 50),
    MS365_ENABLED
  });
});

// ── API: Push to HubSpot ──
app.post('/api/push', ensureAuth, async (req, res) => {
  const { prospects, repId } = req.body;
  if (!prospects || !repId) return res.status(400).json({ error: 'Missing data' });

  const reps = loadReps();
  const rep = reps.find(r => r.id === repId);
  if (!rep) return res.status(404).json({ error: 'Rep not found' });

  // Resolve assignment routing (RFST: rentals -> Brad, rest -> Jake)
  function resolveHubspotRep(rep, prospect) {
    if (rep.hubspotAssignRentals) {
      const companyName = (prospect.owner || prospect.generalContractor || prospect.projectName || '').toLowerCase();
      const rentalKeywords = ['rental', 'rentals', 'united rentals', 'sunbelt', 'herc', 'equipment rental', 'hire'];
      const isRental = rentalKeywords.some(kw => companyName.includes(kw));
      if (isRental) {
        const rentalRep = reps.find(r => r.id === rep.hubspotAssignRentals) || rep;
        return { ...rep, hubspotOwnerId: rentalRep.hubspotOwnerId };
      }
    }
    const assignToRep = rep.hubspotAssignTo ? reps.find(r => r.id === rep.hubspotAssignTo) || rep : rep;
    return { ...rep, hubspotOwnerId: assignToRep.hubspotOwnerId };
  }

  try {
    const HubSpotClient = require('../crm/hubspot_client');
    const hubspot = new HubSpotClient();
    const results = [];

    for (const prospect of prospects) {
      const contact = {
        firstName: prospect.contactFirstName || '',
        lastName: prospect.contactLastName || prospect.owner || 'Unknown',
        email: prospect.contactEmail || '',
        phone: prospect.contactPhone || '',
        title: prospect.contactTitle || 'Decision Maker',
        company: prospect.owner || prospect.generalContractor || prospect.projectName,
        state: prospect.geography?.state || ''
      };
      const effectiveRep = resolveHubspotRep(rep, prospect);
      const result = await hubspot.pushProspect(contact, prospect, effectiveRep);
      results.push(result);
    }

    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ── Reports page ──
app.get('/reports', ensureAuth, (req, res) => {
  const reps = loadReps();
  const logs = loadRunLogs();

  // Build per-rep stats
  const repStats = reps.map(rep => {
    const repLogs = logs.filter(l => l.repId === rep.id);
    const totalProspects = repLogs.reduce((sum, l) => sum + (l.searchResults?.qualified || 0), 0);
    const totalPushed = repLogs.reduce((sum, l) => sum + (l.pushResults?.filter(p => p.action === 'created').length || 0), 0);
    return {
      ...rep,
      runCount: repLogs.length,
      totalProspects,
      totalPushed,
      lastRun: repLogs[0]?.runDate || 'Never'
    };
  });

  res.render('reports', {
    user: req.user || { name: 'Local User' },
    repStats, logs,
    MS365_ENABLED
  });
});

// ── Sales Map page ──
app.get('/salesmap', ensureAuth, (req, res) => {
  const reps = loadReps();
  res.render('salesmap', {
    user: req.user || { name: 'Local User' },
    title: 'Sales Map',
    reps,
    MS365_ENABLED
  });
});

// ── API: Sales Map Data (reads cached NetSuite data from data/netsuite_cache/) ──
app.get('/api/salesmap-data', ensureAuth, (req, res) => {
  const days = parseInt(req.query.days) || 730;
  const repId = req.query.repId || '';
  const reps = loadReps();

  // Build rep lookup for display names
  const repLookup = {};
  for (const r of reps) {
    repLookup[r.netsuiteId] = r.name;
  }

  // Resolve repId string to NetSuite employee ID
  let netsuiteRepId = null;
  if (repId) {
    const rep = reps.find(r => r.id === repId);
    if (rep) netsuiteRepId = rep.netsuiteId;
  }

  // Date cutoff
  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000) : null;

  const cacheDir = path.join(__dirname, '../../data/netsuite_cache');
  const transactions = [];

  // Read sales cache (supports both SuiteQL and enriched saved-search format)
  try {
    const salesPath = path.join(cacheDir, 'sales.json');
    if (fs.existsSync(salesPath)) {
      const salesData = JSON.parse(fs.readFileSync(salesPath, 'utf8'));
      for (const row of (salesData.transactions || [])) {
        const repId_ = row.salesRep || row.employee;
        if (netsuiteRepId && repId_ !== netsuiteRepId) continue;
        const dateStr = row.date || row.trandate;
        if (cutoff && new Date(dateStr) < cutoff) continue;
        transactions.push({
          id: row.id,
          tranId: row.orderId || row.tranid,
          type: 'SalesOrd',
          layer: 'shipped',
          date: dateStr,
          total: parseFloat(row.total) || 0,
          customerName: row.customerName || row.customer || row.customername,
          memo: row.memo || '',
          city: row.city || row.shipcity || '',
          state: row.state || row.shipstate || '',
          zip: row.zip || row.shipzip || '',
          street: row.street || '',
          repName: repLookup[repId_] || '',
          vertical: row.vertical || '',
          hqCity: row.hqCity || '',
          hqState: row.hqState || '',
          firstOrder: row.firstOrder || false,
          leadSource: row.leadSource || '',
          items: row.items || []
        });
      }
    }
  } catch (e) { console.error('Error reading sales cache:', e.message); }

  // Read estimates cache (supports both SuiteQL and enriched saved-search format)
  try {
    const estPath = path.join(cacheDir, 'estimates.json');
    if (fs.existsSync(estPath)) {
      const estData = JSON.parse(fs.readFileSync(estPath, 'utf8'));
      for (const row of (estData.transactions || [])) {
        const repId_ = row.salesRep || row.employee;
        if (netsuiteRepId && repId_ !== netsuiteRepId) continue;
        const dateStr = row.date || row.trandate;
        if (cutoff && new Date(dateStr) < cutoff) continue;
        const nsStatus = row.nsStatus || '';
        const lostReason = row.lostReason || row.lostreason || '';
        const statusDisplay = row.status || row.statusdisplay || nsStatus || '';
        const layer = classifyEstimateStatus(statusDisplay, lostReason);
        transactions.push({
          id: row.id,
          tranId: row.quoteId || row.tranid,
          type: 'Estimate',
          layer,
          date: dateStr,
          total: parseFloat(row.total) || 0,
          customerName: row.customerName || row.customer || row.customername,
          memo: row.memo || '',
          city: row.city || row.shipcity || '',
          state: row.state || row.shipstate || '',
          zip: row.zip || row.shipzip || '',
          street: row.street || '',
          repName: repLookup[repId_] || '',
          probability: row.probability || null,
          status: statusDisplay,
          nsStatus,
          lostReason,
          reasonForLoss: row.reasonForLoss || '',
          daysOpen: row.daysOpen != null ? row.daysOpen : null,
          linkedSO: row.linkedSO || '',
          dateConverted: row.dateConverted || '',
          contactEmail: row.contactEmail || '',
          isBid: row.isBid || false,
          firstQuote: row.firstQuote || false,
          vertical: row.vertical || '',
          hqCity: row.hqCity || '',
          hqState: row.hqState || '',
          leadSource: row.leadSource || '',
          items: row.items || []
        });
      }
    }
  } catch (e) { console.error('Error reading estimates cache:', e.message); }

  const summary = {
    total: transactions.length,
    shipped: transactions.filter(t => t.layer === 'shipped').length,
    open: transactions.filter(t => t.layer === 'open').length,
    converted: transactions.filter(t => t.layer === 'converted').length,
    lost: transactions.filter(t => t.layer === 'lost').length,
    totalRevenue: transactions.filter(t => t.layer === 'shipped').reduce((s, t) => s + t.total, 0),
    totalQuoteValue: transactions.filter(t => t.layer === 'open').reduce((s, t) => s + t.total, 0)
  };

  // Read sync timestamp
  try {
    const salesPath = path.join(cacheDir, 'sales.json');
    if (fs.existsSync(salesPath)) {
      const d = JSON.parse(fs.readFileSync(salesPath, 'utf8'));
      summary.syncedAt = d.syncedAt;
    }
  } catch (e) { /* skip */ }

  res.json({ transactions, summary });
});

// ── Heat Map page ──
app.get('/heatmap', ensureAuth, (req, res) => {
  res.render('heatmap', {
    user: req.user || { name: 'Local User' },
    title: 'Heat Map',
    MS365_ENABLED
  });
});

// ── API: Heat Map Data (aggregate run logs by geography + lifecycle) ──
app.get('/api/heatmap-data', ensureAuth, (req, res) => {
  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
  const days = parseInt(req.query.days) || 0; // 0 = all time
  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000) : null;

  const logsDir = path.join(__dirname, '../../logs/runs');
  if (!fs.existsSync(logsDir)) {
    return res.json({ projects: [], summary: { total: 0, construction: 0, parking_industrial: 0, municipal: 0 }, byState: {} });
  }

  const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
  const projects = [];
  const seen = new Set();

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(logsDir, file), 'utf8'));
      if (cutoff && new Date(data.runDate) < cutoff) continue;

      const results = data.searchResults?.results || [];
      for (const r of results) {
        const state = r.geography?.state;
        if (!state) continue;

        // Deduplicate by project name + state
        const key = ((r.projectName || '') + state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
        if (seen.has(key)) continue;
        seen.add(key);

        const stage = r.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(r);
        projects.push({
          projectName: r.projectName || 'Unknown',
          projectType: r.projectType || '',
          city: r.geography?.city || '',
          state: state,
          estimatedValue: r.estimatedValue || 0,
          bidDate: r.bidDate || '',
          owner: r.owner || '',
          generalContractor: r.generalContractor || '',
          sourceUrl: r.sourceUrl || '',
          source: r.source || '',
          relevanceScore: r.relevanceScore || 0,
          lifecycleStage: stage,
          notes: (r.notes || '').substring(0, 200)
        });
      }
    } catch (e) { /* skip bad files */ }
  }

  // Build summary
  const summary = {
    total: projects.length,
    construction: projects.filter(p => p.lifecycleStage === 'construction').length,
    parking_industrial: projects.filter(p => p.lifecycleStage === 'parking_industrial').length,
    municipal: projects.filter(p => p.lifecycleStage === 'municipal').length
  };

  const byState = {};
  for (const p of projects) {
    byState[p.state] = (byState[p.state] || 0) + 1;
  }

  res.json({ projects, summary, byState });
});

// ── API: Heat Map Scan (live news search) ──
app.post('/api/heatmap-scan', ensureAuth, async (req, res) => {
  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();

    // Generic national ICP for broad scanning
    const scanIcp = {
      geographies: ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'],
      productAffinities: [
        'Cable Support Towers', 'Trackout Mats', 'Speed Cushions',
        'Wheel Stops', 'Sign Bases', 'Rubber Curbs', 'Flexible Bollards',
        'Speed Bumps', 'Trench Guards', 'Spill Containment Berms'
      ],
      triggerKeywords: [
        'construction', 'traffic calming', 'parking lot', 'speed bump',
        'data center', 'highway', 'warehouse', 'Vision Zero'
      ]
    };

    const results = await searcher.search(scanIcp);

    // Save scan results to a log file
    const Reporter = require('../ui/reporter');
    Reporter.saveRunLog('heatmap_scan', {
      repName: 'Heat Map Scan',
      icp: scanIcp,
      searchResults: { total: results.length, unique: results.length, qualified: results.length, results },
      pushResults: []
    });

    // Classify and return
    const projects = results.map(r => ({
      projectName: r.projectName || 'Unknown',
      projectType: r.projectType || '',
      city: r.geography?.city || '',
      state: r.geography?.state || '',
      estimatedValue: r.estimatedValue || 0,
      bidDate: r.bidDate || '',
      owner: r.owner || '',
      generalContractor: r.generalContractor || '',
      sourceUrl: r.sourceUrl || '',
      source: r.source || '',
      relevanceScore: r.relevanceScore || 0,
      lifecycleStage: r.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(r),
      notes: (r.notes || '').substring(0, 200)
    }));

    res.json({ success: true, projects, count: projects.length });
  } catch (error) {
    res.json({ success: false, error: error.message, projects: [] });
  }
});

// ── ICP detail ──
app.get('/icp/:repId', ensureAuth, (req, res) => {
  const reps = loadReps();
  const rep = reps.find(r => r.id === req.params.repId);
  if (!rep) return res.status(404).send('Rep not found');
  const icp = loadICP(rep.id);
  res.render('icp', {
    user: req.user || { name: 'Local User' },
    rep, icp,
    MS365_ENABLED
  });
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`\n  🔧 RubberForm Prospecting Engine`);
  console.log(`  📊 Dashboard: http://localhost:${PORT}`);
  console.log(`  🔐 Auth: ${MS365_ENABLED ? 'MS365 (Azure AD)' : 'Disabled (local mode)'}\n`);
});
