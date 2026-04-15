#!/usr/bin/env node
/**
 * Re-scrape Line Items with Part Codes
 * Fetches line items from NetSuite with actual item.itemId (SKU/part number)
 * and updates the cached JSON files + PostgreSQL database.
 *
 * Usage:
 *   node scripts/rescrape_items.js              # Update both JSON + DB
 *   node scripts/rescrape_items.js --json-only  # Update JSON files only
 *   node scripts/rescrape_items.js --db-only    # Update database only
 *
 * Requires NETSUITE_* environment variables.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const NetSuiteClient = require('../src/discovery/netsuite_client');

const SALES_PATH = path.join(__dirname, '../data/netsuite_cache/sales.json');
const ESTIMATES_PATH = path.join(__dirname, '../data/netsuite_cache/estimates.json');

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json-only');
  const dbOnly = args.includes('--db-only');

  console.log('\n  RubberForm — Re-scrape Line Items with Part Codes');
  console.log('  ─────────────────────────────────────────────────\n');

  if (!process.env.NETSUITE_ACCOUNT_ID) {
    console.error('  NETSUITE_ACCOUNT_ID not set. Cannot query NetSuite.');
    process.exit(1);
  }

  const netsuite = new NetSuiteClient();

  // Fetch line items for sales orders
  console.log('  Fetching sales order line items with part codes...');
  let salesItems;
  try {
    salesItems = await netsuite.getLineItemsWithPartCodes('SalesOrd');
    console.log(`  → ${salesItems.length} sales line items fetched.\n`);
  } catch (e) {
    console.error('  Failed to fetch sales line items:', e.message);
    salesItems = [];
  }

  // Fetch line items for estimates
  console.log('  Fetching estimate line items with part codes...');
  let estimateItems;
  try {
    estimateItems = await netsuite.getLineItemsWithPartCodes('Estimate');
    console.log(`  → ${estimateItems.length} estimate line items fetched.\n`);
  } catch (e) {
    console.error('  Failed to fetch estimate line items:', e.message);
    estimateItems = [];
  }

  // Group line items by tranId
  function groupByTranId(items) {
    const map = {};
    for (const item of items) {
      const tranId = item.tranId || item.tranid;
      if (!tranId) continue;
      if (!map[tranId]) map[tranId] = [];
      map[tranId].push({
        itemId: item.partNumber || item.partnumber || item.itemId || '',
        itemNumber: String(item.internalId || item.internalid || ''),
        itemName: item.itemName || item.itemname || '',
        description: item.description || item.displayname || item.itemName || '',
        qty: parseInt(item.qty || item.quantity) || 0,
        amount: parseFloat(item.amount) || 0,
        rate: item.rate || ''
      });
    }
    return map;
  }

  const salesByTran = groupByTranId(salesItems);
  const estimatesByTran = groupByTranId(estimateItems);

  console.log(`  Sales: ${Object.keys(salesByTran).length} transactions with items`);
  console.log(`  Estimates: ${Object.keys(estimatesByTran).length} transactions with items\n`);

  // Update JSON files
  if (!dbOnly) {
    // Update sales.json
    if (fs.existsSync(SALES_PATH)) {
      console.log('  Updating sales.json...');
      const salesData = JSON.parse(fs.readFileSync(SALES_PATH, 'utf8'));
      let updated = 0;
      for (const txn of (salesData.transactions || [])) {
        const tranId = txn.orderId || txn.tranid;
        if (salesByTran[tranId]) {
          txn.items = salesByTran[tranId];
          updated++;
        }
      }
      fs.writeFileSync(SALES_PATH, JSON.stringify(salesData, null, 2));
      console.log(`  → ${updated} sales orders updated with part codes.\n`);
    }

    // Update estimates.json
    if (fs.existsSync(ESTIMATES_PATH)) {
      console.log('  Updating estimates.json...');
      const estData = JSON.parse(fs.readFileSync(ESTIMATES_PATH, 'utf8'));
      let updated = 0;
      for (const txn of (estData.transactions || [])) {
        const tranId = txn.quoteId || txn.tranid;
        if (estimatesByTran[tranId]) {
          txn.items = estimatesByTran[tranId];
          updated++;
        }
      }
      fs.writeFileSync(ESTIMATES_PATH, JSON.stringify(estData, null, 2));
      console.log(`  → ${updated} estimates updated with part codes.\n`);
    }
  }

  // Update database
  if (!jsonOnly && process.env.DATABASE_URL) {
    console.log('  Updating database...');
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
      await pool.query('SELECT 1');
      const allItems = { ...salesByTran, ...estimatesByTran };
      let updated = 0;

      for (const [tranId, items] of Object.entries(allItems)) {
        const result = await pool.query(
          'UPDATE transactions SET items = $1 WHERE tran_id = $2',
          [JSON.stringify(items), tranId]
        );
        if (result.rowCount > 0) updated++;
      }

      console.log(`  → ${updated} transactions updated in database.\n`);
      await pool.end();
    } catch (e) {
      console.error('  Database update failed:', e.message);
    }
  }

  console.log('  Done!\n');
}

main().catch(e => {
  console.error('Re-scrape failed:', e.message);
  process.exit(1);
});
