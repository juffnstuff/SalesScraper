/**
 * RubberForm Prospecting Engine — Web Server
 * Express app with MS365 authentication and dashboard UI.
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
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

// ── Authentication ──
const MS365_ENABLED = !!(process.env.MS365_CLIENT_ID && process.env.MS365_TENANT_ID);
const USERS_PATH = path.join(__dirname, '../../config/users.json');

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
  catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

// Passport serialization (shared by both strategies)
passport.serializeUser((user, done) => done(null, user.username || user.id));
passport.deserializeUser((identifier, done) => {
  const users = loadUsers();
  const user = users.find(u => u.username === identifier);
  if (user) {
    return done(null, {
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      repId: user.repId,
      mustChangePassword: user.mustChangePassword
    });
  }
  // Fallback for MS365 sessions (identifier is Azure OID)
  done(null, { id: identifier, name: 'MS365 User', role: 'admin' });
});

// ── Local username/password strategy ──
passport.use(new LocalStrategy(async (username, password, done) => {
  const users = loadUsers();
  const user = users.find(u => u.username === username.toLowerCase());
  if (!user) return done(null, false, { message: 'Invalid username or password' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return done(null, false, { message: 'Invalid username or password' });

  return done(null, {
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    repId: user.repId,
    mustChangePassword: user.mustChangePassword
  });
}));

// ── MS365 / Azure AD strategy (optional) ──
if (MS365_ENABLED) {
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
    const email = (profile.upn || profile._json?.email || '').toLowerCase();
    if (!email.endsWith('@rubberform.com')) {
      return done(null, false, { message: 'Access restricted to RubberForm employees' });
    }
    // Check if this email maps to a local user account
    const users = loadUsers();
    const localUser = users.find(u => u.email === email);
    if (localUser) {
      return done(null, {
        username: localUser.username,
        name: localUser.name,
        email: localUser.email,
        role: localUser.role,
        repId: localUser.repId,
        mustChangePassword: false
      });
    }
    return done(null, {
      id: profile.oid,
      name: profile.displayName,
      email: email,
      role: 'admin'
    });
  }));
}

app.use(passport.initialize());
app.use(passport.session());

// ── Auth middleware ──
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) {
    // Redirect to change-password if required (except for the change-password route itself)
    if (req.user.mustChangePassword && req.path !== '/change-password' && !req.path.startsWith('/api/')) {
      return res.redirect('/change-password');
    }
    return next();
  }
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).send('Admin access required');
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
  if (req.isAuthenticated()) return res.redirect('/');
  res.render('login', { error: req.query.error || null, MS365_ENABLED });
});

app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.redirect('/login?error=' + encodeURIComponent(info?.message || 'Login failed'));
    req.logIn(user, (err) => {
      if (err) return next(err);
      if (user.mustChangePassword) return res.redirect('/change-password');
      res.redirect('/');
    });
  })(req, res, next);
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

// ── Change Password ──
app.get('/change-password', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  res.render('change-password', {
    user: req.user,
    forced: req.user.mustChangePassword,
    error: req.query.error || null,
    success: req.query.success || null,
    MS365_ENABLED
  });
});

app.post('/change-password', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword) {
    return res.redirect('/change-password?error=' + encodeURIComponent('Passwords do not match'));
  }
  if (newPassword.length < 6) {
    return res.redirect('/change-password?error=' + encodeURIComponent('Password must be at least 6 characters'));
  }

  const users = loadUsers();
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.redirect('/login');

  // Verify current password (skip for forced change if password is still the default)
  if (!user.mustChangePassword) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.redirect('/change-password?error=' + encodeURIComponent('Current password is incorrect'));
    }
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  saveUsers(users);

  // Update session
  req.user.mustChangePassword = false;

  res.redirect('/change-password?success=' + encodeURIComponent('Password changed successfully'));
});

// ── Dashboard ──
app.get('/', ensureAuth, (req, res) => {
  const reps = loadReps();
  let visibleReps = reps;

  // Sales reps see only their own profile
  if (req.user.role === 'sales_rep' && req.user.repId) {
    visibleReps = reps.filter(r => r.id === req.user.repId);
  }

  const repsWithICP = visibleReps.map(rep => ({
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
  const daysParam = req.query.days;
  const days = daysParam != null && daysParam !== '' ? parseInt(daysParam) : 730;
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
    totalOpenValue: transactions.filter(t => t.layer === 'open').reduce((s, t) => s + t.total, 0),
    totalConvertedValue: transactions.filter(t => t.layer === 'converted').reduce((s, t) => s + t.total, 0),
    totalLostValue: transactions.filter(t => t.layer === 'lost').reduce((s, t) => s + t.total, 0)
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

// ── API: Heat Map Data (reads from persistent news cache + run logs) ──
app.get('/api/heatmap-data', ensureAuth, (req, res) => {
  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
  const days = parseInt(req.query.days) || 0;
  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000) : null;

  const projects = [];
  const seen = new Set();

  // Primary source: persistent news cache
  try {
    const cachePath = path.join(__dirname, '../../data/news_cache.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      for (const p of (cache.projects || [])) {
        if (cutoff && p.scannedAt && new Date(p.scannedAt) < cutoff) continue;
        const key = ((p.projectName || '') + (p.state || '')).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        projects.push({
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
          lifecycleStage: p.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(p),
          notes: (p.notes || '').substring(0, 200),
          contractors: p.contractors || [],
          contractorSearched: p.contractorSearched || false
        });
      }
    }
  } catch (e) { console.error('Error reading news cache:', e.message); }

  // Secondary source: run logs (for backward compatibility)
  try {
    const logsDir = path.join(__dirname, '../../logs/runs');
    if (fs.existsSync(logsDir)) {
      const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(logsDir, file), 'utf8'));
          if (cutoff && new Date(data.runDate) < cutoff) continue;
          for (const r of (data.searchResults?.results || [])) {
            const state = r.geography?.state;
            if (!state) continue;
            const key = ((r.projectName || '') + state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
            if (seen.has(key)) continue;
            seen.add(key);
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
              lifecycleStage: r.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(r),
              notes: (r.notes || '').substring(0, 200)
            });
          }
        } catch (e) { /* skip bad files */ }
      }
    }
  } catch (e) { /* skip */ }

  const summary = {
    total: projects.length,
    parking: projects.filter(p => p.lifecycleStage === 'parking').length,
    industrial: projects.filter(p => p.lifecycleStage === 'industrial').length,
    municipal: projects.filter(p => p.lifecycleStage === 'municipal').length,
    construction: projects.filter(p => p.lifecycleStage === 'construction').length
  };

  const byState = {};
  for (const p of projects) {
    byState[p.state] = (byState[p.state] || 0) + 1;
  }

  res.json({ projects, summary, byState });
});

// ── News cache helper ──
function mergeIntoNewsCache(results) {
  const cachePath = path.join(__dirname, '../../data/news_cache.json');
  let cache = { projects: [], lastScan: null, totalProjects: 0 };
  try {
    if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (e) { /* fresh cache */ }

  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
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
      lifecycleStage: r.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(r),
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

// ── API: Heat Map Scan (live news search → saves to persistent cache) ──
app.post('/api/heatmap-scan', ensureAuth, async (req, res) => {
  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();

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

    console.log('[Heatmap Scan] Starting quick scan...');
    const results = await searcher.search(scanIcp);
    console.log(`[Heatmap Scan] Search returned ${results.length} raw results`);
    const { total, newCount } = mergeIntoNewsCache(results);
    console.log(`[Heatmap Scan] After merge: ${newCount} new, ${total} total`);

    // Also save to run log for backward compatibility
    const Reporter = require('../ui/reporter');
    Reporter.saveRunLog('heatmap_scan', {
      repName: 'Heat Map Scan',
      icp: scanIcp,
      searchResults: { total: results.length, unique: results.length, qualified: results.length, results },
      pushResults: []
    });

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

    res.json({ success: true, projects, count: projects.length, totalCached: total, newProjects: newCount });
  } catch (error) {
    console.error('Heatmap scan error:', error.message);
    res.json({ success: false, error: error.message, projects: [] });
  }
});

// ── API: Single regional query (one region + one vertical, fast) ──
app.post('/api/heatmap-scan-single', ensureAuth, async (req, res) => {
  const { region, vertical } = req.body || {};
  if (!region || !vertical) return res.status(400).json({ error: 'region and vertical required' });

  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();
    const results = await searcher.searchSingleRegion(region, vertical);
    const { total, newCount } = mergeIntoNewsCache(results);

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

    res.json({ success: true, projects, count: projects.length, totalCached: total, newProjects: newCount });
  } catch (error) {
    console.error(`[Single Scan] ${region}/${vertical} error:`, error.message);
    res.json({ success: false, error: error.message, projects: [] });
  }
});

// ── API: Regional Deep Scan (state-by-state via region batching) ──
app.post('/api/heatmap-scan-regional', ensureAuth, async (req, res) => {
  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();

    const { regions, verticals } = req.body || {};
    const results = await searcher.searchByRegion({
      regions: regions || undefined,
      verticals: verticals || undefined
    });

    const { total, newCount } = mergeIntoNewsCache(results);

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

    res.json({ success: true, projects, count: projects.length, totalCached: total, newProjects: newCount });
  } catch (error) {
    console.error('Regional scan error:', error.message);
    res.json({ success: false, error: error.message, projects: [] });
  }
});

// ── API: Contractor Discovery (single project) ──
app.post('/api/heatmap-contractor-search', ensureAuth, async (req, res) => {
  const { projectName, state } = req.body;
  if (!projectName) return res.status(400).json({ error: 'projectName required' });

  console.log(`[Contractor Search] Starting: "${projectName}" (${state})`);

  const cachePath = path.join(__dirname, '../../data/news_cache.json');
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (e) {
    console.error('[Contractor Search] Cache read error:', e.message);
    return res.status(500).json({ error: 'Could not read cache' });
  }

  let project = cache.projects.find(p => p.projectName === projectName && p.state === state);
  if (!project) {
    // Case-insensitive fallback
    const nameLower = projectName.toLowerCase().trim();
    const stateLower = (state || '').toLowerCase().trim();
    project = cache.projects.find(p =>
      (p.projectName || '').toLowerCase().trim() === nameLower &&
      (p.state || '').toLowerCase().trim() === stateLower
    );
  }
  if (!project) {
    console.warn(`[Contractor Search] Project not found: "${projectName}" / ${state}`);
    return res.status(404).json({ error: `Project "${projectName}" (${state}) not found in cache` });
  }

  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();
    const contractors = await searcher.searchContractor(project);

    // Save back to cache
    project.contractors = contractors;
    project.contractorSearched = true;
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

    console.log(`[Contractor Search] Done: "${projectName}" → ${contractors.length} companies found`);
    res.json({ success: true, contractors });
  } catch (error) {
    console.error('[Contractor Search] Error:', error.stack || error.message);
    res.json({ success: false, error: error.message, contractors: [] });
  }
});

// ── API: Batch Contractor Discovery (top N by value) ──
app.post('/api/heatmap-contractor-batch', ensureAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.body.limit) || 10, 20);
  const cachePath = path.join(__dirname, '../../data/news_cache.json');
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return res.status(500).json({ error: 'Could not read cache' });
  }

  const targets = cache.projects
    .filter(p => !p.contractorSearched)
    .sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
    .slice(0, limit);

  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
  const searcher = new ConstructionNewsExpanded();

  let enriched = 0;
  for (const project of targets) {
    try {
      const contractors = await searcher.searchContractor(project);
      project.contractors = contractors;
      project.contractorSearched = true;
      if (contractors.length > 0) enriched++;
      await new Promise(r => setTimeout(r, 800));
    } catch {
      project.contractorSearched = true;
      project.contractors = [];
    }
  }

  fs.writeFileSync(cachePath, JSON.stringify(cache));
  res.json({ success: true, enriched, total: targets.length });
});

// ── Background scan on startup (seeds news cache if empty or stale) ──
async function runStartupScan() {
  const cachePath = path.join(__dirname, '../../data/news_cache.json');
  let shouldScan = false;

  try {
    if (!fs.existsSync(cachePath)) {
      shouldScan = true;
    } else {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const lastScan = cache.lastScan ? new Date(cache.lastScan) : null;
      const hoursSince = lastScan ? (Date.now() - lastScan.getTime()) / 3600000 : Infinity;
      shouldScan = hoursSince > 24 || (cache.projects || []).length === 0;
    }
  } catch (e) { shouldScan = true; }

  if (!shouldScan) {
    console.log('  News cache is fresh (scanned < 24h ago). Skipping startup scan.');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  No ANTHROPIC_API_KEY — skipping startup news scan.');
    return;
  }

  console.log('  Starting background news scan...');
  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();
    const scanIcp = {
      geographies: ['CA','TX','FL','NY','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI','CO','MN','SC','AL','LA','KY','OR','OK','CT','UT'],
      productAffinities: ['Cable Support Towers', 'Trackout Mats', 'Speed Cushions', 'Wheel Stops', 'Sign Bases', 'Rubber Curbs', 'Flexible Bollards', 'Speed Bumps'],
      triggerKeywords: ['construction', 'traffic calming', 'parking lot', 'data center', 'highway', 'warehouse']
    };
    const results = await searcher.search(scanIcp);
    const { total, newCount } = mergeIntoNewsCache(results);
    console.log(`  Background scan complete: ${results.length} found, ${newCount} new, ${total} total cached.`);
  } catch (e) {
    console.error('  Background scan failed:', e.message);
  }
}

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
  console.log(`  🔐 Auth: Local${MS365_ENABLED ? ' + MS365 (Azure AD)' : ''}\n`);

  // Run background news scan if cache is stale
  runStartupScan().catch(e => console.error('Startup scan error:', e.message));
});
