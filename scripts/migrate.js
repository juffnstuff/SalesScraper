#!/usr/bin/env node
/**
 * Database Migration Script
 * Creates PostgreSQL tables and seeds data from existing JSON files.
 *
 * Usage:
 *   node scripts/migrate.js              # Create tables + seed all data
 *   node scripts/migrate.js --tables     # Create tables only
 *   node scripts/migrate.js --seed       # Seed data only (tables must exist)
 *   node scripts/migrate.js --reset      # Drop and recreate all tables + reseed
 *
 * Requires DATABASE_URL environment variable.
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ── Table Definitions ──

const CREATE_TABLES = `
-- Projects (from news_cache.json)
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_type TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  estimated_value NUMERIC DEFAULT 0,
  bid_date TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  general_contractor TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  source TEXT DEFAULT 'construction_news_expanded',
  relevance_score NUMERIC DEFAULT 0,
  lifecycle_stage TEXT DEFAULT 'construction',
  verticals JSONB DEFAULT '["construction"]',
  project_status TEXT DEFAULT 'Unknown',
  notes TEXT DEFAULT '',
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  contractor_searched BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_name, state)
);

CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(state);
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle ON projects(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(project_status);

-- Contractors (linked to projects)
CREATE TABLE IF NOT EXISTS contractors (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  specialty TEXT DEFAULT '',
  website TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  source TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractors_project ON contractors(project_id);

-- Transactions (sales orders + estimates from NetSuite)
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  tran_id TEXT NOT NULL,
  tran_type TEXT NOT NULL,
  customer_id TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  sales_rep TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  street TEXT DEFAULT '',
  date TEXT DEFAULT '',
  ship_date TEXT DEFAULT '',
  total NUMERIC DEFAULT 0,
  status TEXT DEFAULT '',
  ns_status TEXT DEFAULT '',
  probability TEXT DEFAULT '',
  days_open INTEGER,
  contact_email TEXT DEFAULT '',
  is_bid BOOLEAN DEFAULT FALSE,
  first_order BOOLEAN DEFAULT FALSE,
  first_quote BOOLEAN DEFAULT FALSE,
  linked_so TEXT DEFAULT '',
  date_converted TEXT DEFAULT '',
  lost_reason TEXT DEFAULT '',
  reason_for_loss TEXT DEFAULT '',
  vertical TEXT DEFAULT '',
  hq_city TEXT DEFAULT '',
  hq_state TEXT DEFAULT '',
  lead_source TEXT DEFAULT '',
  class TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  invoice_id TEXT DEFAULT '',
  invoice_status TEXT DEFAULT '',
  items JSONB DEFAULT '[]',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tran_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(tran_type);
CREATE INDEX IF NOT EXISTS idx_transactions_state ON transactions(state);
CREATE INDEX IF NOT EXISTS idx_transactions_rep ON transactions(sales_rep);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  role TEXT DEFAULT 'sales_rep',
  rep_id TEXT,
  must_change_password BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scan metadata
CREATE TABLE IF NOT EXISTS scan_metadata (
  id SERIAL PRIMARY KEY,
  scan_type TEXT NOT NULL,
  last_scan TIMESTAMPTZ DEFAULT NOW(),
  total_projects INTEGER DEFAULT 0
);

-- Transaction sync metadata (tracks last successful NetSuite sync)
CREATE TABLE IF NOT EXISTS transaction_sync (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_modified_cutoff TEXT NOT NULL DEFAULT '',
  records_fetched INTEGER DEFAULT 0,
  records_upserted INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success',
  error_message TEXT DEFAULT ''
);
`;

const DROP_TABLES = `
DROP TABLE IF EXISTS contractors CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS scan_metadata CASCADE;
DROP TABLE IF EXISTS transaction_sync CASCADE;
`;

// ── Seed Functions ──

async function seedProjects() {
  const cachePath = path.join(__dirname, '../data/news_cache.json');
  if (!fs.existsSync(cachePath)) {
    console.log('  No news_cache.json found, skipping projects.');
    return 0;
  }

  const ConstructionNewsExpanded = require('../src/prospecting/sources/construction_news_expanded');

  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const projects = cache.projects || [];
  let count = 0;

  for (const p of projects) {
    try {
      const verticals = p.verticals || ConstructionNewsExpanded.classifyAllVerticals(p);
      const primaryStage = p.lifecycleStage || verticals[0] || 'construction';

      const result = await pool.query(`
        INSERT INTO projects (project_name, project_type, city, state, estimated_value, bid_date, owner, general_contractor, source_url, source, relevance_score, lifecycle_stage, verticals, notes, scanned_at, contractor_searched)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (project_name, state) DO NOTHING
        RETURNING id
      `, [
        p.projectName || 'Unknown', p.projectType || '', p.city || '', p.state || '',
        p.estimatedValue || 0, p.bidDate || '', p.owner || '', p.generalContractor || '',
        p.sourceUrl || '', p.source || 'construction_news_expanded', p.relevanceScore || 0,
        primaryStage, JSON.stringify(verticals), (p.notes || '').substring(0, 500),
        p.scannedAt || new Date().toISOString(), p.contractorSearched || false
      ]);

      if (result.rows.length > 0 && p.contractors && p.contractors.length > 0) {
        const projectId = result.rows[0].id;
        for (const c of p.contractors) {
          await pool.query(`
            INSERT INTO contractors (project_id, name, role, specialty, website, phone, source)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, [projectId, c.name || '', c.role || '', c.specialty || '', c.website || '', c.phone || '', c.source || '']);
        }
      }

      if (result.rows.length > 0) count++;
    } catch (e) {
      console.warn(`  Skip project "${p.projectName}": ${e.message}`);
    }
  }

  // Save scan metadata
  await pool.query(`
    INSERT INTO scan_metadata (scan_type, last_scan, total_projects)
    VALUES ('heatmap', $1, $2)
    ON CONFLICT DO NOTHING
  `, [cache.lastScan || new Date().toISOString(), projects.length]);

  return count;
}

async function seedTransactions() {
  let count = 0;

  // Sales
  const salesPath = path.join(__dirname, '../data/netsuite_cache/sales.json');
  if (fs.existsSync(salesPath)) {
    const salesData = JSON.parse(fs.readFileSync(salesPath, 'utf8'));
    const txns = salesData.transactions || [];
    console.log(`  Loading ${txns.length} sales orders...`);

    for (const row of txns) {
      try {
        await pool.query(`
          INSERT INTO transactions (tran_id, tran_type, customer_id, customer_name, sales_rep, city, state, zip, street, date, ship_date, total, status, vertical, hq_city, hq_state, first_order, lead_source, class, memo, invoice_id, invoice_status, items, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
          ON CONFLICT (tran_id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, street = EXCLUDED.street,
            total = EXCLUDED.total, status = EXCLUDED.status,
            invoice_id = EXCLUDED.invoice_id, invoice_status = EXCLUDED.invoice_status,
            items = EXCLUDED.items, synced_at = EXCLUDED.synced_at
        `, [
          row.orderId || row.tranid, 'SalesOrd', row.customer || '', row.customerName || '',
          String(row.salesRep || row.employee || ''), row.city || row.shipcity || '', row.state || row.shipstate || '',
          row.zip || row.shipzip || '', row.street || '', row.date || row.trandate || '',
          row.shipDate || '', parseFloat(row.total) || 0, row.status || '',
          row.vertical || '', row.hqCity || '', row.hqState || '', row.firstOrder || false,
          row.leadSource || '', row.class || '', row.memo || '',
          row.invoiceId || '', row.invoiceStatus || '', JSON.stringify(row.items || []),
          salesData.syncedAt || new Date().toISOString()
        ]);
        count++;
      } catch (e) {
        // Skip duplicates silently
      }
    }
  }

  // Estimates
  const estPath = path.join(__dirname, '../data/netsuite_cache/estimates.json');
  if (fs.existsSync(estPath)) {
    const estData = JSON.parse(fs.readFileSync(estPath, 'utf8'));
    const txns = estData.transactions || [];
    console.log(`  Loading ${txns.length} estimates...`);

    for (const row of txns) {
      try {
        await pool.query(`
          INSERT INTO transactions (tran_id, tran_type, customer_id, customer_name, sales_rep, city, state, zip, street, date, total, status, ns_status, probability, days_open, contact_email, is_bid, first_quote, linked_so, date_converted, lost_reason, reason_for_loss, vertical, hq_city, hq_state, lead_source, memo, items, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
          ON CONFLICT (tran_id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, street = EXCLUDED.street,
            total = EXCLUDED.total, status = EXCLUDED.status, ns_status = EXCLUDED.ns_status,
            probability = EXCLUDED.probability, days_open = EXCLUDED.days_open,
            linked_so = EXCLUDED.linked_so, date_converted = EXCLUDED.date_converted,
            lost_reason = EXCLUDED.lost_reason, reason_for_loss = EXCLUDED.reason_for_loss,
            items = EXCLUDED.items, synced_at = EXCLUDED.synced_at
        `, [
          row.quoteId || row.tranid, 'Estimate', row.customer || '', row.customerName || '',
          String(row.salesRep || row.employee || ''), row.city || row.shipcity || '', row.state || row.shipstate || '',
          row.zip || row.shipzip || '', row.street || '', row.date || row.trandate || '',
          parseFloat(row.total) || 0, row.status || row.statusdisplay || '', row.nsStatus || '',
          row.probability || '', row.daysOpen != null ? row.daysOpen : null,
          row.contactEmail || '', row.isBid || false, row.firstQuote || false,
          row.linkedSO || '', row.dateConverted || '', row.lostReason || row.lostreason || '',
          row.reasonForLoss || '', row.vertical || '', row.hqCity || '', row.hqState || '',
          row.leadSource || '', row.memo || '', JSON.stringify(row.items || []),
          estData.syncedAt || new Date().toISOString()
        ]);
        count++;
      } catch (e) {
        // Skip duplicates silently
      }
    }
  }

  return count;
}

async function seedUsers() {
  const usersPath = path.join(__dirname, '../config/users.json');
  if (!fs.existsSync(usersPath)) {
    console.log('  No users.json found, skipping users.');
    return 0;
  }

  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  let count = 0;

  for (const u of users) {
    try {
      await pool.query(`
        INSERT INTO users (username, password_hash, name, email, role, rep_id, must_change_password, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (username) DO NOTHING
      `, [
        u.username, u.passwordHash, u.name, u.email || '',
        u.role || 'sales_rep', u.repId || null, u.mustChangePassword !== false,
        u.createdAt || new Date().toISOString()
      ]);
      count++;
    } catch (e) {
      console.warn(`  Skip user "${u.username}": ${e.message}`);
    }
  }

  return count;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const tablesOnly = args.includes('--tables');
  const seedOnly = args.includes('--seed');

  console.log('\n  RubberForm Database Migration');
  console.log('  ────────────────────────────\n');

  try {
    await pool.query('SELECT 1');
    console.log('  Connected to PostgreSQL.\n');
  } catch (e) {
    console.error('  Failed to connect:', e.message);
    console.error('  Make sure DATABASE_URL is set.');
    process.exit(1);
  }

  if (reset) {
    console.log('  Dropping all tables...');
    await pool.query(DROP_TABLES);
    console.log('  Done.\n');
  }

  if (!seedOnly) {
    console.log('  Creating tables...');
    await pool.query(CREATE_TABLES);
    console.log('  Tables created.\n');
  }

  if (!tablesOnly) {
    console.log('  Seeding projects...');
    const projCount = await seedProjects();
    console.log(`  → ${projCount} projects seeded.\n`);

    console.log('  Seeding transactions...');
    const txnCount = await seedTransactions();
    console.log(`  → ${txnCount} transactions seeded.\n`);

    console.log('  Seeding users...');
    const userCount = await seedUsers();
    console.log(`  → ${userCount} users seeded.\n`);
  }

  console.log('  Migration complete!\n');
  await pool.end();
}

main().catch(e => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
