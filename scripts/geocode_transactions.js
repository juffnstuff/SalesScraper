#!/usr/bin/env node
/**
 * Batch Geocode Transactions
 * Geocodes all transactions that have a street address but no lat/lng.
 * Uses the US Census Bureau Geocoder (free, no API key).
 * Rate limited to ~1 request/sec.
 *
 * Usage:
 *   node scripts/geocode_transactions.js              # Geocode all un-geocoded
 *   node scripts/geocode_transactions.js --limit 500  # Geocode up to 500
 *   node scripts/geocode_transactions.js --reset      # Clear all lat/lng and re-geocode
 *
 * Requires DATABASE_URL environment variable.
 */

require('dotenv').config();
const { Pool } = require('pg');
const { geocodeAddress, delay } = require('../src/web/geocoder');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 1000 : null;

  console.log('\n  RubberForm — Batch Geocode Transactions');
  console.log('  ────────────────────────────────────────\n');

  try {
    await pool.query('SELECT 1');
    console.log('  Connected to PostgreSQL.\n');
  } catch (e) {
    console.error('  Failed to connect:', e.message);
    process.exit(1);
  }

  // Ensure columns exist
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS lat NUMERIC');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS lng NUMERIC');

  if (reset) {
    console.log('  Clearing all geocode data...');
    await pool.query('UPDATE transactions SET lat = NULL, lng = NULL');
    console.log('  Done.\n');
  }

  // Fetch transactions that need geocoding
  let query = `
    SELECT id, street, city, state, zip
    FROM transactions
    WHERE lat IS NULL
      AND street IS NOT NULL AND street != ''
    ORDER BY id
  `;
  if (limit) query += ` LIMIT ${limit}`;

  const { rows } = await pool.query(query);
  console.log(`  Found ${rows.length} transactions to geocode.\n`);

  if (rows.length === 0) {
    console.log('  Nothing to do!\n');
    await pool.end();
    return;
  }

  let geocoded = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const txn = rows[i];
    const address = [txn.street, txn.city, txn.state, txn.zip].filter(Boolean).join(', ');

    try {
      const coords = await geocodeAddress(txn.street, txn.city, txn.state, txn.zip);

      if (coords) {
        await pool.query(
          'UPDATE transactions SET lat = $1, lng = $2 WHERE id = $3',
          [coords.lat, coords.lng, txn.id]
        );
        geocoded++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }

    // Progress every 100
    if ((i + 1) % 100 === 0 || i === rows.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (geocoded / (elapsed || 1)).toFixed(1);
      const remaining = ((rows.length - i - 1) / (rate || 1)).toFixed(0);
      console.log(`  [${i + 1}/${rows.length}] ${geocoded} geocoded, ${failed} failed (${rate}/sec, ~${remaining}s remaining)`);
    }

    // Rate limit: 1 req/sec
    await delay(1050);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n  Complete: ${geocoded} geocoded, ${failed} failed in ${elapsed} minutes.`);

  // Show total stats
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(lat) AS geocoded,
      COUNT(*) - COUNT(lat) AS remaining
    FROM transactions
    WHERE street IS NOT NULL AND street != ''
  `);
  console.log(`  DB totals: ${stats[0].geocoded}/${stats[0].total} geocoded (${stats[0].remaining} remaining)\n`);

  await pool.end();
}

main().catch(e => {
  console.error('Geocode failed:', e.message);
  process.exit(1);
});
