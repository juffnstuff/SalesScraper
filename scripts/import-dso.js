#!/usr/bin/env node
/**
 * One-shot backfill of sales orders from a NetSuite "Daily SALES Report"
 * CSV export (DSO) into the `transactions` table.
 *
 * The incremental sync only pulls records modified since the last run, so
 * sales orders sitting in Pending Approval / Pending Fulfillment for weeks
 * without modifications never enter the sliding window and can be missing
 * from the DB. This script fixes that by upserting every row in the CSV
 * directly.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/import-dso.js path/to/export.csv
 *
 * Safe to re-run: uses ON CONFLICT (tran_id) DO UPDATE, so existing rows
 * get their status/total/items refreshed from the CSV.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ── Rep name → NetSuite internal id mapping ──────────────────────────────
// The CSV stores rep names ("Reich, Galen J") but the transactions table
// keys on the numeric NetSuite employee id. Build the lookup from the
// rep_profiles.json that the web app already reads from.
function loadRepLookup() {
  const profilesPath = path.join(__dirname, '..', 'config', 'rep_profiles.json');
  const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const lookup = {};
  for (const p of profiles) {
    const id = String(p.netsuiteId);
    const name = (p.name || '').toLowerCase();
    lookup[name] = id;
    // Also map "Last, First …" variants — CSV uses both styles
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstLast = parts.join(' ');
      const lastFirst = parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ');
      lookup[firstLast] = id;
      lookup[lastFirst] = id;
    }
  }
  // Known CSV-only aliases that don't decompose cleanly from the profile names
  const aliases = {
    'reich, galen j': '442081',
    'andrew j. gibson': '26',
    'zielinski, nick': '150925',
    'backman, brad': '443337',
    'william j robbins, sr.': '-5',
    'jacob d. robbins': '16',
    'rfst': '142706' // House Accounts
  };
  for (const [k, v] of Object.entries(aliases)) lookup[k] = v;
  return lookup;
}

// ── CSV parsing (handles quoted fields with embedded commas/quotes) ──────
function parseCsv(text) {
  const lines = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); lines.push(row); }
  if (lines.length === 0) return [];
  const header = lines[0];
  return lines.slice(1).filter(r => r.length >= header.length / 2).map(r => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] || '').trim();
    return obj;
  });
}

// ── Value parsing helpers ────────────────────────────────────────────────
function parseMoney(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[$,]/g, '').trim();
  if (!s || s === '.00' || s === '0') return parseFloat(s) || 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseQty(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseInt(s.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseYesNo(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true';
}

// "Invoice #RF81002" → "RF81002"; "RF81002" → "RF81002"; "" → ""
function stripInvoicePrefix(v) {
  return String(v || '').replace(/^\s*invoice\s*#\s*/i, '').trim();
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/import-dso.js <path-to-csv>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log(`\nReading ${csvPath}...`);
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''); // strip BOM
  const rows = parseCsv(text);
  console.log(`  ${rows.length} line-item rows parsed.`);

  // Group line items by Internal ID (the transaction id within NetSuite).
  // Each group becomes one row in the `transactions` table; its lines
  // become the `items` JSONB payload.
  const byTxn = new Map();
  for (const r of rows) {
    const key = r['Internal ID'] || r['INTERNAL ID'] || r['internal id'];
    if (!key) continue;
    if (!byTxn.has(key)) byTxn.set(key, { header: r, lines: [] });
    byTxn.get(key).lines.push(r);
  }
  console.log(`  ${byTxn.size} distinct transactions.`);

  const repLookup = loadRepLookup();
  console.log(`  Rep lookup: ${Object.keys(repLookup).length} name variants mapped.`);

  await pool.query('SELECT 1'); // fail fast on DATABASE_URL issues
  console.log('\nStarting upsert...');

  // ── Shape one transaction row ─────────────────────────────────────────
  function build(internalId, header, lines) {
    const tranId = (header['VENDOR PO'] || '').trim();
    if (!tranId) return null; // no SO document number, can't upsert on (tran_id)

    const repName = (header['Sales Rep'] || '').trim().toLowerCase();
    const salesRep = repLookup[repName] || '';
    const nsStatus = (header['NS STATUS'] || '').trim();

    const items = lines.map(l => ({
      itemId: (l['ITEM NUMBER'] || '').trim(),
      itemNumber: '', // CSV doesn't include NetSuite internal item id — leave blank
      itemName: (l['Description'] || '').trim(),
      description: (l['Description'] || '').trim(),
      qty: parseQty(l['QTY ORDERED']),
      qtyShipped: parseQty(l['QTY SHIPD']),
      qtyInvoiced: parseQty(l['QTY INVOICED']),
      qtyBackOrdered: parseQty(l['Qty BACK ORDER']),
      amount: parseMoney(l['TOTAL ITEM AMT']),
      rate: parseMoney(l['Item Rate']),
      partGroup: (l['Part Group'] || '').trim(),
      priceLevel: (l['Price Level'] || '').trim()
    }));

    // Transaction-level ORDER AMT is duplicated on every line; first non-zero
    // line wins (fallback: sum of line amounts).
    let total = 0;
    for (const l of lines) {
      const n = parseMoney(l['ORDER AMT']);
      if (n > 0) { total = n; break; }
    }
    if (total === 0) total = items.reduce((s, i) => s + (i.amount || 0), 0);

    return {
      tranId,
      tranType: 'SalesOrd',
      customerName: (header['CUSTOMER'] || '').trim(),
      salesRep,
      city: (header['CITY'] || '').trim(),
      state: (header['STATE'] || '').trim(),
      zip: (header['Shipping Zip'] || '').trim(),
      street: (header['STREET'] || '').trim(),
      date: (header["DATE REC'D"] || '').trim(),
      shipDate: (header['Actual Ship Date'] || header['TARGET SHIP DATE'] || '').trim(),
      total,
      status: nsStatus,
      nsStatus,
      memo: (header['NOTES'] || '').trim(),
      vertical: (header['CUST VERTICAL'] || '').trim(),
      hqCity: (header['HEADQUARTERS CITY'] || '').trim(),
      hqState: (header['HEADQUARTERS STATE'] || '').trim(),
      leadSource: (header['Customer Lead Source'] || header['Original Lead Source'] || '').trim(),
      class: (header['Class'] || '').trim(),
      invoiceId: stripInvoicePrefix(header['INVOICE #']),
      invoiceStatus: (header['INVOICE STATUS'] || '').trim(),
      firstOrder: parseYesNo(header['First Sales Order']),
      items: JSON.stringify(items)
    };
  }

  // ── Upsert loop ───────────────────────────────────────────────────────
  const stats = { total: 0, inserted: 0, updated: 0, skipped: 0, byStatus: {} };
  for (const [internalId, { header, lines }] of byTxn) {
    const t = build(internalId, header, lines);
    if (!t) { stats.skipped++; continue; }
    stats.byStatus[t.status] = (stats.byStatus[t.status] || 0) + 1;

    // xmax = 0 on the returned row means this was an INSERT rather than an
    // UPDATE — lets us count the two outcomes separately.
    const res = await pool.query(`
      INSERT INTO transactions (
        tran_id, tran_type, customer_name, sales_rep, city, state, zip, street,
        date, ship_date, total, status, ns_status, memo, vertical, hq_city, hq_state,
        lead_source, class, invoice_id, invoice_status, first_order, items, synced_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb, NOW()
      )
      ON CONFLICT (tran_id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        sales_rep     = CASE WHEN EXCLUDED.sales_rep <> '' THEN EXCLUDED.sales_rep ELSE transactions.sales_rep END,
        city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, street = EXCLUDED.street,
        date = EXCLUDED.date, ship_date = EXCLUDED.ship_date,
        total = EXCLUDED.total,
        status = EXCLUDED.status, ns_status = EXCLUDED.ns_status,
        memo = EXCLUDED.memo, vertical = EXCLUDED.vertical,
        hq_city = EXCLUDED.hq_city, hq_state = EXCLUDED.hq_state,
        lead_source = EXCLUDED.lead_source, class = EXCLUDED.class,
        invoice_id = EXCLUDED.invoice_id, invoice_status = EXCLUDED.invoice_status,
        first_order = EXCLUDED.first_order,
        items = EXCLUDED.items,
        synced_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `, [
      t.tranId, t.tranType, t.customerName, t.salesRep, t.city, t.state, t.zip, t.street,
      t.date, t.shipDate, t.total, t.status, t.nsStatus, t.memo, t.vertical, t.hqCity, t.hqState,
      t.leadSource, t.class, t.invoiceId, t.invoiceStatus, t.firstOrder, t.items
    ]);
    stats.total++;
    if (res.rows[0].inserted) stats.inserted++;
    else stats.updated++;
    if (stats.total % 1000 === 0) console.log(`  ... ${stats.total} upserted`);
  }

  console.log(`\nDone.`);
  console.log(`  ${stats.total} transactions upserted`);
  console.log(`    inserted: ${stats.inserted}`);
  console.log(`    updated:  ${stats.updated}`);
  console.log(`    skipped (no VENDOR PO): ${stats.skipped}`);
  console.log(`  By status:`);
  for (const [k, v] of Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${v}`);
  }

  // Verify pending SOs are now present — they're the whole reason this
  // script exists.
  const { rows: pendingRows } = await pool.query(`
    SELECT status, COUNT(*) AS n
    FROM transactions
    WHERE tran_type = 'SalesOrd'
      AND status IN ('Pending Approval', 'Pending Fulfillment')
    GROUP BY status
    ORDER BY status
  `);
  console.log(`\nPending sales orders in DB after import:`);
  for (const r of pendingRows) console.log(`  ${r.status}: ${r.n}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
