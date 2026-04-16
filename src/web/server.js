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
const dataLayer = require('./data');
const netsuiteSync = require('./netsuite_sync');

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

// Async versions — used by endpoints, falls back to JSON if no DB
async function loadUsersAsync() {
  try { return await dataLayer.getUsers(); }
  catch { return loadUsers(); }
}

// Passport serialization (shared by both strategies)
passport.serializeUser((user, done) => done(null, user.username || user.id));
passport.deserializeUser(async (identifier, done) => {
  try {
    const users = await loadUsersAsync();
    const user = users.find(u => u.username === identifier);
    done(null, user || false);
  } catch (e) {
    done(null, false);
  }
});

// ── Local username/password strategy ──
passport.use(new LocalStrategy(async (username, password, done) => {
  const users = await loadUsersAsync();
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
  const lr = (lostReason || '').trim();

  // Explicitly converted
  if (s.includes('processed') || s.includes('converted') || s.includes('closed won')) return 'converted';
  // Closed: check lost reason to distinguish converted vs lost
  if (s.includes('closed')) {
    if (!lr) return 'converted'; // closed without lost reason = converted
    if (lr.toLowerCase().includes('alternate rf solution')) return 'converted'; // bought different RF product
    return 'lost';
  }
  // Expired / voided = lost
  if (s.includes('expired') || s.includes('voided') || s.includes('declined')) return 'lost';
  // Has a lost reason = lost
  if (lr) return 'lost';
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

  const users = await loadUsersAsync();
  const user = users.find(u => u.username === req.user.username);
  if (!user) return res.redirect('/login');

  // Verify current password (skip for forced change if password is still the default)
  if (!user.mustChangePassword) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.redirect('/change-password?error=' + encodeURIComponent('Current password is incorrect'));
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await dataLayer.updateUser(req.user.username, { passwordHash: newHash, mustChangePassword: false });

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

// ── Search page (rep's projects filtered by vertical) ──
app.get('/search/:repId', ensureAuth, async (req, res) => {
  const reps = loadReps();
  const rep = reps.find(r => r.id === req.params.repId);
  if (!rep) return res.status(404).send('Rep not found');
  const icp = loadICP(rep.id);
  res.render('search', {
    user: req.user || { name: 'Local User' },
    rep, icp, reps, MS365_ENABLED
  });
});

// ── API: Projects for rep (filtered by vertical) ──
app.get('/api/search/:repId/projects', ensureAuth, async (req, res) => {
  const reps = loadReps();
  const rep = reps.find(r => r.id === req.params.repId);
  if (!rep) return res.status(404).json({ error: 'Rep not found' });

  try {
    const projects = await dataLayer.getProjectsForRep(req.params.repId, reps);
    res.json({ success: true, projects, total: projects.length });
  } catch (e) {
    console.error('[API] Project load failed:', e.message);
    res.json({ success: false, error: e.message, projects: [] });
  }
});

// ── API: Find decision-maker contacts via Selling.com ──
app.post('/api/contacts/find', ensureAuth, async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  try {
    const SellingApiClient = require('../enrichment/selling_api');
    const selling = new SellingApiClient();

    // Load project and its contractors
    const db = require('./db');
    const { rows: projRows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projRows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const project = projRows[0];

    const contractors = await dataLayer.getContractorsForProject(projectId);
    if (contractors.length === 0) {
      return res.json({ success: true, contacts: [], message: 'No contractors found — run contractor discovery first' });
    }

    // Default buyer titles for Selling.com search
    const targetTitles = [
      'Project Manager', 'Procurement Manager', 'Purchasing Manager',
      'Operations Manager', 'VP Operations', 'VP Construction',
      'Director of Procurement', 'Director of Operations',
      'Safety Manager', 'Facilities Manager', 'Site Manager',
      'General Manager', 'Owner', 'President'
    ];

    const allContacts = [];
    for (const contractor of contractors) {
      console.log(`[Selling.com] Searching: ${contractor.name} (${project.state})`);
      const found = await selling.findContacts(contractor.name, project.state, targetTitles);
      console.log(`[Selling.com] → ${found.length} contacts for ${contractor.name}`);

      if (found.length > 0) {
        const saved = await dataLayer.saveContacts(projectId, contractor.id, found);
        allContacts.push(...saved.map(r => ({
          id: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          phone: r.phone,
          title: r.title,
          company: r.company,
          linkedin: r.linkedin,
          confidence: parseFloat(r.confidence) || 0,
          contractorName: contractor.name,
          contractorRole: contractor.role
        })));
      }
    }

    res.json({ success: true, contacts: allContacts, contractorsSearched: contractors.length });
  } catch (e) {
    console.error('[API] Contact find failed:', e.message);
    res.json({ success: false, error: e.message, contacts: [] });
  }
});

// ── API: Get contacts for a project ──
app.get('/api/contacts/:projectId', ensureAuth, async (req, res) => {
  try {
    const contacts = await dataLayer.getContactsForProject(parseInt(req.params.projectId));
    res.json({ success: true, contacts });
  } catch (e) {
    res.json({ success: false, error: e.message, contacts: [] });
  }
});

// ── API: Push contacts to HubSpot ──
app.post('/api/contacts/push', ensureAuth, async (req, res) => {
  const { contactIds, repId } = req.body;
  if (!contactIds || !contactIds.length) return res.status(400).json({ error: 'contactIds required' });

  const reps = loadReps();
  const rep = repId ? reps.find(r => r.id === repId) : null;
  if (repId && !rep) return res.status(404).json({ error: 'Rep not found' });

  try {
    const HubSpotClient = require('../crm/hubspot_client');
    const hubspot = new HubSpotClient();
    const db = require('./db');
    const results = [];

    for (const contactId of contactIds) {
      // Load contact + project context
      const { rows: contactRows } = await db.query(`
        SELECT ct.*, p.project_name, p.project_type, p.city AS proj_city, p.state AS proj_state,
               p.estimated_value, p.bid_date, p.owner, p.general_contractor, p.source_url, p.source,
               p.verticals, c.name AS contractor_name, c.role AS contractor_role
        FROM contacts ct
        JOIN projects p ON ct.project_id = p.id
        LEFT JOIN contractors c ON ct.contractor_id = c.id
        WHERE ct.id = $1
      `, [contactId]);

      if (contactRows.length === 0) {
        results.push({ contactId, action: 'failed', error: 'Contact not found' });
        continue;
      }

      const ct = contactRows[0];

      // Determine rep: explicit override > assigned rep > vertical-based
      let effectiveRep = rep;
      if (!effectiveRep && ct.assigned_rep) {
        effectiveRep = reps.find(r => r.id === ct.assigned_rep);
      }
      if (!effectiveRep) {
        const projectVerticals = ct.verticals || [];
        effectiveRep = reps.find(r => r.verticals && r.verticals.some(v => projectVerticals.includes(v)));
      }
      if (!effectiveRep) {
        effectiveRep = reps.find(r => r.id === 'jake_robbins') || reps[0];
      }

      const contact = {
        firstName: ct.first_name || '',
        lastName: ct.last_name || ct.contractor_name || 'Unknown',
        email: ct.email || '',
        phone: ct.phone || '',
        title: ct.title || 'Decision Maker',
        company: ct.company || ct.contractor_name || '',
        state: ct.state || ct.proj_state || ''
      };

      const project = {
        projectName: ct.project_name,
        projectType: ct.project_type || '',
        owner: ct.owner || '',
        generalContractor: ct.general_contractor || '',
        bidDate: ct.bid_date || '',
        estimatedValue: parseFloat(ct.estimated_value) || 0,
        relevanceScore: 0,
        geography: { city: ct.proj_city || '', state: ct.proj_state || '' },
        sourceUrl: ct.source_url || '',
        source: ct.source || '',
        scoringReasoning: `Heatmap project. Contractor: ${ct.contractor_name || ''} (${ct.contractor_role || ''}). Contact via Selling.com.`
      };

      try {
        const result = await hubspot.pushProspect(contact, project, effectiveRep);
        await dataLayer.markContactPushed(contactId, result.contactId || '');
        results.push({ contactId, ...result });
      } catch (e) {
        results.push({ contactId, action: 'failed', error: e.message });
      }
    }

    res.json({ success: true, results });
  } catch (e) {
    console.error('[API] Contact push failed:', e.message);
    res.json({ success: false, error: e.message });
  }
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

// ── API: NetSuite Sync (manual trigger) ──
app.post('/api/netsuite-sync', ensureAuth, async (req, res) => {
  if (!process.env.NETSUITE_ACCOUNT_ID) {
    return res.json({ success: false, error: 'NetSuite credentials not configured (NETSUITE_ACCOUNT_ID missing)' });
  }
  try {
    const result = await netsuiteSync.runSync({ force: !!req.body.force });
    res.json({
      success: true,
      sinceDate: result.sinceDate,
      sales: result.sales,
      estimates: result.estimates,
      durationMs: result.durationMs
    });
  } catch (e) {
    console.error('[API] NetSuite sync failed:', e.message);
    res.json({ success: false, error: e.message });
  }
});

// ── API: NetSuite Sync Status ──
app.get('/api/netsuite-sync-status', ensureAuth, async (req, res) => {
  try {
    const status = await netsuiteSync.getSyncStatus();
    res.json(status);
  } catch (e) {
    res.json({ available: false, error: e.message });
  }
});

// ── API: Sales Map Data (reads from PostgreSQL, falls back to JSON) ──
app.get('/api/salesmap-data', ensureAuth, async (req, res) => {
  const daysParam = req.query.days;
  const days = daysParam != null && daysParam !== '' ? parseInt(daysParam) : 730;
  const repId = req.query.repId || '';
  const reps = loadReps();

  // Build rep lookup for display names
  const repLookup = {};
  for (const r of reps) {
    repLookup[r.netsuiteId] = r.name;
  }

  // Date cutoff
  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000) : null;

  // Try database first
  let transactions = await dataLayer.getTransactions(repId, reps);

  if (transactions === null) {
    // JSON fallback — database not available
    transactions = [];

    // Resolve repId string to NetSuite employee ID
    let netsuiteRepId = null;
    if (repId) {
      const rep = reps.find(r => r.id === repId);
      if (rep) netsuiteRepId = rep.netsuiteId;
    }

    const cacheDir = path.join(__dirname, '../../data/netsuite_cache');

    // Read sales cache
    try {
      const salesPath = path.join(cacheDir, 'sales.json');
      if (fs.existsSync(salesPath)) {
        const salesData = JSON.parse(fs.readFileSync(salesPath, 'utf8'));
        for (const row of (salesData.transactions || [])) {
          const repId_ = row.salesRep || row.employee;
          if (netsuiteRepId && repId_ !== netsuiteRepId) continue;
          const dateStr = row.date || row.trandate;
          if (cutoff && new Date(dateStr) < cutoff) continue;
          // For JSON fallback, we can't easily determine had_quote without a DB join.
          // Default to 'quoted' (majority of sales have quotes).
          transactions.push({
            id: row.id, tranId: row.orderId || row.tranid, type: 'SalesOrd', layer: 'quoted',
            date: dateStr, total: parseFloat(row.total) || 0,
            customerName: row.customerName || row.customer || row.customername,
            memo: row.memo || '', city: row.city || row.shipcity || '',
            state: row.state || row.shipstate || '', zip: row.zip || row.shipzip || '',
            street: row.street || '', repName: repLookup[repId_] || '',
            vertical: row.vertical || '', hqCity: row.hqCity || '', hqState: row.hqState || '',
            firstOrder: row.firstOrder || false, leadSource: row.leadSource || '',
            items: row.items || []
          });
        }
      }
    } catch (e) { console.error('Error reading sales cache:', e.message); }

    // Read estimates cache
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
          // Skip converted estimates — they show up as shipped sales already
          if (layer === 'converted') continue;
          transactions.push({
            id: row.id, tranId: row.quoteId || row.tranid, type: 'Estimate', layer,
            date: dateStr, total: parseFloat(row.total) || 0,
            customerName: row.customerName || row.customer || row.customername,
            memo: row.memo || '', city: row.city || row.shipcity || '',
            state: row.state || row.shipstate || '', zip: row.zip || row.shipzip || '',
            street: row.street || '', repName: repLookup[repId_] || '',
            probability: row.probability || null, status: statusDisplay, nsStatus, lostReason,
            reasonForLoss: row.reasonForLoss || '',
            daysOpen: row.daysOpen != null ? row.daysOpen : null,
            linkedSO: row.linkedSO || '', dateConverted: row.dateConverted || '',
            contactEmail: row.contactEmail || '', isBid: row.isBid || false,
            firstQuote: row.firstQuote || false, vertical: row.vertical || '',
            hqCity: row.hqCity || '', hqState: row.hqState || '',
            leadSource: row.leadSource || '', items: row.items || []
          });
        }
      }
    } catch (e) { console.error('Error reading estimates cache:', e.message); }
  }

  // Apply date cutoff for DB results too
  if (cutoff && transactions.length > 0 && transactions[0].date) {
    transactions = transactions.filter(t => {
      if (!t.date) return true;
      return new Date(t.date) >= cutoff;
    });
  }

  const quoted = transactions.filter(t => t.layer === 'quoted');
  const direct = transactions.filter(t => t.layer === 'direct');
  const open = transactions.filter(t => t.layer === 'open');
  const lost = transactions.filter(t => t.layer === 'lost');

  const summary = {
    total: transactions.length,
    quoted: quoted.length,
    direct: direct.length,
    open: open.length,
    lost: lost.length,
    totalQuotedRevenue: quoted.reduce((s, t) => s + t.total, 0),
    totalDirectRevenue: direct.reduce((s, t) => s + t.total, 0),
    totalOpenValue: open.reduce((s, t) => s + t.total, 0),
    totalLostValue: lost.reduce((s, t) => s + t.total, 0)
  };

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
app.get('/api/heatmap-data', ensureAuth, async (req, res) => {
  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
  const days = parseInt(req.query.days) || 0;
  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000) : null;

  try {
    let projects = await dataLayer.getProjects(cutoff);

    // Add projectStatus and verticals if not already set
    projects = projects.map(p => {
      const verticals = p.verticals && p.verticals.length > 0
        ? p.verticals
        : ConstructionNewsExpanded.classifyAllVerticals(p);
      return {
        ...p,
        projectStatus: p.projectStatus || ConstructionNewsExpanded.classifyProjectStatus(p),
        lifecycleStage: p.lifecycleStage || verticals[0] || 'construction',
        verticals
      };
    });

    // Count by vertical — a project in multiple verticals is counted in each
    const summary = {
      total: projects.length,
      parking: projects.filter(p => p.verticals.includes('parking')).length,
      industrial: projects.filter(p => p.verticals.includes('industrial')).length,
      municipal: projects.filter(p => p.verticals.includes('municipal')).length,
      construction: projects.filter(p => p.verticals.includes('construction')).length
    };

    const byState = {};
    for (const p of projects) {
      byState[p.state] = (byState[p.state] || 0) + 1;
    }

    // Get last scan time (prefer DB scan_metadata, fall back to JSON cache)
    let lastScan = null;
    try {
      const db = require('./db');
      if (await db.isReady()) {
        const { rows } = await db.query(
          "SELECT last_scan FROM scan_metadata WHERE scan_type = 'heatmap' ORDER BY last_scan DESC LIMIT 1"
        );
        if (rows.length > 0) lastScan = rows[0].last_scan;
      }
      if (!lastScan) {
        const cachePath = path.join(__dirname, '../../data/news_cache.json');
        if (fs.existsSync(cachePath)) {
          const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          lastScan = cache.lastScan || null;
        }
      }
    } catch { /* ignore */ }

    res.json({ projects, summary, byState, lastScan });
  } catch (e) {
    console.error('Error loading heatmap data:', e.message);
    res.json({ projects: [], summary: { total: 0 }, byState: {}, lastScan: null });
  }
});

// ── API: Export projects to Excel ──
app.get('/api/heatmap-export/excel', ensureAuth, async (req, res) => {
  const ExcelJS = require('exceljs');
  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
  const vertical = req.query.vertical || 'all';

  let projects = [];
  try {
    const raw = await dataLayer.getProjects();
    projects = raw.map(p => ({
      projectName: p.projectName || 'Unknown',
      projectType: p.projectType || '',
      city: p.city || '',
      state: p.state || '',
      estimatedValue: p.estimatedValue || 0,
      bidDate: p.bidDate || '',
      owner: p.owner || '',
      generalContractor: p.generalContractor || '',
      sourceUrl: p.sourceUrl || '',
      lifecycleStage: p.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(p),
      projectStatus: p.projectStatus || ConstructionNewsExpanded.classifyProjectStatus(p),
      notes: (p.notes || '').substring(0, 300),
      contractors: (p.contractors || []).map(c => c.name).join(', ')
    }));
  } catch (e) {
    return res.status(500).json({ error: 'Could not read cache' });
  }

  if (vertical !== 'all') {
    projects = projects.filter(p => p.lifecycleStage === vertical);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'RubberForm Prospecting Engine';
  const ws = wb.addWorksheet('Projects');

  ws.columns = [
    { header: 'Project Name', key: 'projectName', width: 40 },
    { header: 'Status', key: 'projectStatus', width: 14 },
    { header: 'City', key: 'city', width: 18 },
    { header: 'State', key: 'state', width: 8 },
    { header: 'Est. Value', key: 'estimatedValue', width: 16 },
    { header: 'Owner / Developer', key: 'owner', width: 30 },
    { header: 'General Contractor', key: 'generalContractor', width: 25 },
    { header: 'Timeline', key: 'bidDate', width: 25 },
    { header: 'Vertical', key: 'lifecycleStage', width: 14 },
    { header: 'Type', key: 'projectType', width: 22 },
    { header: 'Companies Found', key: 'contractors', width: 35 },
    { header: 'Notes', key: 'notes', width: 50 },
    { header: 'Source URL', key: 'sourceUrl', width: 40 }
  ];

  // Header style
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } };

  for (const p of projects) {
    const row = ws.addRow(p);
    if (p.estimatedValue > 0) {
      row.getCell('estimatedValue').numFmt = '$#,##0';
    }
  }

  // Auto-filter
  ws.autoFilter = { from: 'A1', to: `M${projects.length + 1}` };

  const label = vertical === 'all' ? 'all-verticals' : vertical;
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="rubberform-projects-${label}-${date}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ── API: Export projects to printable PDF page ──
app.get('/api/heatmap-export/pdf', ensureAuth, async (req, res) => {
  const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
  const vertical = req.query.vertical || 'all';

  let projects = [];
  try {
    const raw = await dataLayer.getProjects();
    projects = raw.map(p => ({
      projectName: p.projectName || 'Unknown',
      city: p.city || '',
      state: p.state || '',
      estimatedValue: p.estimatedValue || 0,
      owner: p.owner || '',
      generalContractor: p.generalContractor || '',
      bidDate: p.bidDate || '',
      lifecycleStage: p.lifecycleStage || ConstructionNewsExpanded.classifyLifecycleStage(p),
      projectStatus: p.projectStatus || ConstructionNewsExpanded.classifyProjectStatus(p),
      notes: (p.notes || '').substring(0, 150),
      sourceUrl: p.sourceUrl || ''
    }));
  } catch (e) {
    return res.status(500).send('Could not load projects');
  }

  if (vertical !== 'all') {
    projects = projects.filter(p => p.lifecycleStage === vertical);
  }

  const label = vertical === 'all' ? 'All Verticals' : vertical.charAt(0).toUpperCase() + vertical.slice(1);
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const statusColors = { Active: '#16a34a', Awarded: '#2563eb', Bidding: '#ea580c', Planned: '#6b7280', Completed: '#8b5cf6', Unknown: '#94a3b8' };

  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtVal = v => v > 0 ? '$' + Number(v).toLocaleString('en-US') : '—';

  let rows = '';
  for (const p of projects) {
    const sc = statusColors[p.projectStatus] || '#94a3b8';
    rows += `<tr>
      <td><strong>${esc(p.projectName)}</strong></td>
      <td>${esc(p.city)}, ${esc(p.state)}</td>
      <td>${fmtVal(p.estimatedValue)}</td>
      <td>${esc(p.owner)}</td>
      <td>${esc(p.generalContractor) || '—'}</td>
      <td><span style="color:${sc}; font-weight:bold;">${esc(p.projectStatus)}</span></td>
      <td>${esc(p.bidDate) || '—'}</td>
    </tr>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>RubberForm Projects — ${esc(label)}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; margin: 20px; color: #1e293b; font-size: 11px; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  .subtitle { color: #64748b; margin-bottom: 12px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1e293b; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  @media print { body { margin: 10px; } }
</style></head><body>
<h1>RubberForm Recycled Products — Construction Project Pipeline</h1>
<div class="subtitle">${esc(label)} &bull; ${esc(date)} &bull; ${projects.length} projects</div>
<table>
  <thead><tr><th>Project</th><th>Location</th><th>Est. Value</th><th>Owner</th><th>GC</th><th>Status</th><th>Timeline</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<script>window.print();</script>
</body></html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── News cache helper (uses PostgreSQL via data layer, falls back to JSON) ──
async function mergeIntoNewsCache(results) {
  return dataLayer.mergeProjects(results);
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

  const project = await dataLayer.findProject(projectName, state);
  if (!project) {
    console.warn(`[Contractor Search] Project not found: "${projectName}" / ${state}`);
    return res.status(404).json({ error: `Project "${projectName}" (${state}) not found` });
  }

  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();
    const contractors = await searcher.searchContractor(project);

    await dataLayer.saveContractors(projectName, state, contractors);

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

// ── Scheduled nightly scan (runs daily between 2-4am EST) ──
let nightlyScanRunning = false;

async function runNightlyScan() {
  const cachePath = path.join(__dirname, '../../data/news_cache.json');

  // Check if cache was already scanned in the last 20 hours (prevents double-runs)
  try {
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const lastScan = cache.lastScan ? new Date(cache.lastScan) : null;
      if (lastScan) {
        const hoursSince = (Date.now() - lastScan.getTime()) / 3600000;
        if (hoursSince < 20) {
          return; // Already scanned recently
        }
      }
    }
  } catch { /* proceed with scan */ }

  if (!process.env.ANTHROPIC_API_KEY) return;
  if (nightlyScanRunning) return;

  nightlyScanRunning = true;
  console.log(`[Nightly Scan] Starting regional deep scan at ${new Date().toISOString()}...`);

  try {
    const ConstructionNewsExpanded = require('../prospecting/sources/construction_news_expanded');
    const searcher = new ConstructionNewsExpanded();
    const results = await searcher.searchByRegion();
    const { total, newCount } = mergeIntoNewsCache(results);
    console.log(`[Nightly Scan] Complete: ${results.length} found, ${newCount} new, ${total} total cached.`);
  } catch (e) {
    console.error('[Nightly Scan] Failed:', e.message);
  } finally {
    nightlyScanRunning = false;
  }
}

function startNightlyScanScheduler() {
  // Calculate ms until next 2:00am EST (UTC-5)
  function msUntilNext2amEST() {
    const now = new Date();
    const target = new Date(now);
    // Set target to today at 07:00 UTC (= 2:00am EST)
    target.setUTCHours(7, 0, 0, 0);
    // If we're already past 2am EST today, schedule for tomorrow
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  function scheduleNext() {
    const delay = msUntilNext2amEST();
    const hoursUntil = (delay / 3600000).toFixed(1);
    console.log(`  Next nightly run in ${hoursUntil}h`);

    setTimeout(async () => {
      // Run heatmap scan
      await runNightlyScan().catch(e => console.error('[Nightly] Heatmap scan error:', e.message));

      // Run NetSuite sync
      if (process.env.NETSUITE_ACCOUNT_ID) {
        console.log('[Nightly] Starting NetSuite sync...');
        try {
          const result = await netsuiteSync.runSync();
          const totalFetched = result.sales.fetched + result.estimates.fetched;
          const totalUpserted = result.sales.upserted + result.estimates.upserted;
          console.log(`[Nightly] NetSuite sync: ${totalFetched} fetched, ${totalUpserted} upserted`);
        } catch (e) {
          console.error('[Nightly] NetSuite sync error:', e.message);
        }
      }

      // Re-scrape line items with actual part codes from NetSuite
      if (process.env.NETSUITE_ACCOUNT_ID) {
        try {
          const db = require('./db');
          if (await db.isReady()) {
            const NetSuiteClient = require('../discovery/netsuite_client');
            const netsuite = new NetSuiteClient();

            console.log('[Nightly] Fetching line items with part codes...');
            const salesItems = await netsuite.getLineItemsWithPartCodes('SalesOrd').catch(() => []);
            const estItems = await netsuite.getLineItemsWithPartCodes('Estimate').catch(() => []);
            console.log(`[Nightly] Got ${salesItems.length} sales + ${estItems.length} estimate line items`);

            // Group by tranId
            const allItems = {};
            for (const item of [...salesItems, ...estItems]) {
              const tranId = item.tranId || item.tranid;
              if (!tranId) continue;
              if (!allItems[tranId]) allItems[tranId] = [];
              allItems[tranId].push({
                itemId: item.partNumber || item.partnumber || item.itemId || '',
                itemNumber: String(item.internalId || item.internalid || ''),
                itemName: item.itemName || item.itemname || '',
                description: item.description || item.displayname || item.itemName || '',
                qty: parseInt(item.qty || item.quantity) || 0,
                amount: parseFloat(item.amount) || 0,
                rate: item.rate || ''
              });
            }

            let updated = 0;
            for (const [tranId, items] of Object.entries(allItems)) {
              const result = await db.query(
                'UPDATE transactions SET items = $1 WHERE tran_id = $2',
                [JSON.stringify(items), tranId]
              );
              if (result.rowCount > 0) updated++;
            }
            console.log(`[Nightly] Updated ${updated} transactions with part codes.`);
          }
        } catch (e) {
          console.error('[Nightly] Item re-scrape error:', e.message);
        }
      }

      // Geocode un-geocoded transactions (3200 per night, ~55 min)
      try {
        const db = require('./db');
        if (await db.isReady()) {
          const { geocodeAddress, delay: geocodeDelay } = require('./geocoder');
          const { rows } = await db.query(`
            SELECT id, street, city, state, zip FROM transactions
            WHERE lat IS NULL AND street IS NOT NULL AND street != ''
            ORDER BY id LIMIT 3200
          `);
          if (rows.length > 0) {
            console.log(`[Nightly] Geocoding ${rows.length} transactions...`);
            let geocoded = 0;
            for (const txn of rows) {
              try {
                const coords = await geocodeAddress(txn.street, txn.city, txn.state, txn.zip);
                if (coords) {
                  await db.query('UPDATE transactions SET lat = $1, lng = $2 WHERE id = $3', [coords.lat, coords.lng, txn.id]);
                  geocoded++;
                }
              } catch { /* skip */ }
              await geocodeDelay(1050);
            }
            console.log(`[Nightly] Geocoded ${geocoded}/${rows.length} transactions.`);
          }
        }
      } catch (e) {
        console.error('[Nightly] Geocoding error:', e.message);
      }

      // Schedule the next run (tomorrow at 2am EST)
      scheduleNext();
    }, delay);
  }

  scheduleNext();
  console.log('  Nightly scan + sync scheduled: 2:00am EST daily');
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
app.listen(PORT, async () => {
  console.log(`\n  🔧 RubberForm Prospecting Engine`);
  console.log(`  📊 Dashboard: http://localhost:${PORT}`);
  console.log(`  🔐 Auth: Local${MS365_ENABLED ? ' + MS365 (Azure AD)' : ''}`);

  // Check database connection
  const db = require('./db');
  if (await db.isReady()) {
    console.log('  💾 Database: PostgreSQL connected\n');
  } else if (process.env.DATABASE_URL) {
    console.log('  💾 Database: PostgreSQL configured but tables not found — run: node scripts/migrate.js');
    console.log('  💾 Falling back to JSON files\n');
  } else {
    console.log('  💾 Database: JSON files (no DATABASE_URL set)\n');
  }

  // Schedule nightly heatmap scan (2-4am EST)
  startNightlyScanScheduler();

  // Run background NetSuite incremental sync if DB is available and NetSuite is configured
  if (await db.isReady() && process.env.NETSUITE_ACCOUNT_ID) {
    runStartupNetSuiteSync().catch(e => console.error('NetSuite startup sync error:', e.message));
  }
});

async function runStartupNetSuiteSync() {
  const status = await netsuiteSync.getSyncStatus();

  // Skip if synced within the last 6 hours
  if (status.lastSync) {
    const hoursSince = (Date.now() - new Date(status.lastSync).getTime()) / 3600000;
    if (hoursSince < 6) {
      console.log(`  NetSuite sync is fresh (${hoursSince.toFixed(1)}h ago). Skipping startup sync.`);
      return;
    }
  }

  console.log('  Starting background NetSuite sync...');
  try {
    const result = await netsuiteSync.runSync();
    const totalFetched = result.sales.fetched + result.estimates.fetched;
    const totalUpserted = result.sales.upserted + result.estimates.upserted;
    console.log(`  NetSuite sync complete: ${totalFetched} fetched, ${totalUpserted} upserted in ${result.durationMs}ms`);
  } catch (e) {
    console.error('  NetSuite startup sync failed:', e.message);
  }
}
