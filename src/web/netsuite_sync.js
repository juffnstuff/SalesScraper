/**
 * NetSuite Incremental Sync
 * Pulls only new/modified transactions from NetSuite into PostgreSQL.
 * Uses lastModifiedDate so status changes on old records are captured.
 */

const db = require('./db');
const NetSuiteClient = require('../discovery/netsuite_client');
const { geocodeAddress, delay: geocodeDelay } = require('./geocoder');

/**
 * Get the last successful sync cutoff date from the database.
 * Returns ISO date string (YYYY-MM-DD) or null if never synced.
 */
async function getLastSyncDate() {
  try {
    const { rows } = await db.query(
      `SELECT last_modified_cutoff FROM transaction_sync
       WHERE status = 'success'
       ORDER BY last_sync_at DESC LIMIT 1`
    );
    if (rows.length > 0 && rows[0].last_modified_cutoff) {
      return rows[0].last_modified_cutoff;
    }
  } catch (e) {
    console.warn('[NetSuite Sync] Could not read sync history:', e.message);
  }
  return null;
}

/**
 * Record a sync result in the transaction_sync table.
 */
async function recordSync({ syncType, cutoff, fetched, upserted, durationMs, status, errorMessage }) {
  try {
    await db.query(`
      INSERT INTO transaction_sync (sync_type, last_sync_at, last_modified_cutoff, records_fetched, records_upserted, duration_ms, status, error_message)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7)
    `, [syncType, cutoff, fetched, upserted, durationMs, status, errorMessage || '']);
  } catch (e) {
    console.error('[NetSuite Sync] Failed to record sync metadata:', e.message);
  }
}

/**
 * Upsert a sales order row from NetSuite into PostgreSQL.
 */
async function upsertSalesOrder(row) {
  const tranId = row.tranId || row.tranid;
  if (!tranId) return false;

  const result = await db.query(`
    INSERT INTO transactions (tran_id, tran_type, customer_name, sales_rep, city, state, zip, street, date, ship_date, total, status, memo, synced_at)
    VALUES ($1, 'SalesOrd', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (tran_id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, street = EXCLUDED.street,
      ship_date = EXCLUDED.ship_date,
      total = EXCLUDED.total, status = EXCLUDED.status, memo = EXCLUDED.memo,
      synced_at = NOW()
    RETURNING id
  `, [
    tranId,
    row.customerName || row.customername || '',
    String(row.employee || ''),
    row.shipCity || row.shipcity || '',
    row.shipState || row.shipstate || '',
    row.shipZip || row.shipzip || '',
    row.shipStreet || row.addr1 || '',
    row.tranDate || row.trandate || '',
    row.shipDate || row.shipdate || '',
    parseFloat(row.total) || 0,
    row.statusDisplay || row.status || '',
    row.memo || ''
  ]);

  return result.rows.length > 0;
}

/**
 * Refresh every currently-open sales order (Pending Approval + Pending
 * Fulfillment) regardless of modification date. Runs on every sync so any
 * long-standing pending order that the incremental cutoff would skip still
 * lands in the DB.
 */
async function syncOpenSalesOrders(netsuite) {
  const rows = await netsuite.getOpenSalesOrders();
  let upserted = 0;
  for (const row of rows) {
    try {
      if (await upsertSalesOrder(row)) upserted++;
    } catch (e) {
      console.warn(`[NetSuite Sync] open SO upsert failed for ${row.tranId || row.tranid}: ${e.message}`);
    }
  }
  return { fetched: rows.length, upserted };
}

/**
 * Upsert an estimate row from NetSuite into PostgreSQL.
 */
async function upsertEstimate(row) {
  const tranId = row.tranId || row.tranid;
  if (!tranId) return false;

  const statusDisplay = row.statusDisplay || row.status || '';

  const result = await db.query(`
    INSERT INTO transactions (tran_id, tran_type, customer_name, sales_rep, city, state, zip, street, date, total, status, ns_status, probability, memo, synced_at)
    VALUES ($1, 'Estimate', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    ON CONFLICT (tran_id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, street = EXCLUDED.street,
      total = EXCLUDED.total, status = EXCLUDED.status, ns_status = EXCLUDED.ns_status,
      probability = EXCLUDED.probability, memo = EXCLUDED.memo,
      synced_at = NOW()
    RETURNING id
  `, [
    tranId,
    row.customerName || row.customername || '',
    String(row.employee || ''),
    row.shipCity || row.shipcity || '',
    row.shipState || row.shipstate || '',
    row.shipZip || row.shipzip || '',
    row.shipStreet || row.addr1 || '',
    row.tranDate || row.trandate || '',
    parseFloat(row.total) || 0,
    statusDisplay,
    statusDisplay,
    row.probability || '',
    row.memo || ''
  ]);

  return result.rows.length > 0;
}

/**
 * Upsert one inventory item row from NetSuite into the inventory table.
 * Single-location setup: NetSuite's `item.quantityOnHand` etc. are already
 * company-wide aggregates, so we store them directly without a location join.
 */
async function upsertInventoryItem(row) {
  // SuiteQL returns column names lowercased in some setups and as-declared in
  // others; tolerate both so we don't care which path populates the row.
  const internalId = String(row.id || row.ID || '');
  if (!internalId) return false;

  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v) => v === true || v === 'T' || v === 't' || v === 'true';

  const result = await db.query(`
    INSERT INTO inventory (
      item_id, sku, name,
      quantity_on_hand, quantity_available, quantity_committed,
      quantity_on_order, quantity_back_ordered,
      average_cost, reorder_point, is_inactive,
      last_synced_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (item_id) DO UPDATE SET
      sku = EXCLUDED.sku,
      name = EXCLUDED.name,
      quantity_on_hand = EXCLUDED.quantity_on_hand,
      quantity_available = EXCLUDED.quantity_available,
      quantity_committed = EXCLUDED.quantity_committed,
      quantity_on_order = EXCLUDED.quantity_on_order,
      quantity_back_ordered = EXCLUDED.quantity_back_ordered,
      average_cost = EXCLUDED.average_cost,
      reorder_point = EXCLUDED.reorder_point,
      is_inactive = EXCLUDED.is_inactive,
      last_synced_at = NOW()
    RETURNING item_id
  `, [
    internalId,
    row.itemId || row.itemid || '',
    row.displayName || row.displayname || '',
    num(row.quantityOnHand ?? row.quantityonhand) ?? 0,
    num(row.quantityAvailable ?? row.quantityavailable) ?? 0,
    num(row.quantityCommitted ?? row.quantitycommitted) ?? 0,
    num(row.quantityOnOrder ?? row.quantityonorder) ?? 0,
    num(row.quantityBackOrdered ?? row.quantitybackordered) ?? 0,
    num(row.averageCost ?? row.averagecost),
    num(row.reorderPoint ?? row.reorderpoint),
    bool(row.isInactive ?? row.isinactive)
  ]);

  return result.rows.length > 0;
}

/**
 * Pull the full inventory snapshot from NetSuite and upsert into `inventory`.
 * Returns { fetched, upserted } so the caller can log the outcome.
 */
async function syncInventory(netsuite) {
  const rows = await netsuite.getInventory();
  let upserted = 0;
  for (const row of rows) {
    try {
      if (await upsertInventoryItem(row)) upserted++;
    } catch (e) {
      console.warn(`[NetSuite Sync] inventory upsert failed for item ${row.id || row.itemId}: ${e.message}`);
    }
  }
  return { fetched: rows.length, upserted };
}

/**
 * Run an incremental sync from NetSuite.
 * - Checks last sync date from DB
 * - Queries NetSuite for records modified since then
 * - Upserts into PostgreSQL
 * - Records sync metadata
 *
 * @param {Object} options
 * @param {boolean} options.force - If true, ignore last sync and pull wider window
 * @returns {{ sales: { fetched, upserted }, estimates: { fetched, upserted }, openSales: { fetched, upserted }, inventory: { fetched, upserted }, sinceDate, durationMs }}
 */
async function runSync(options = {}) {
  if (!(await db.isReady())) {
    throw new Error('Database not available — cannot sync');
  }

  // Ensure the transaction_sync table exists
  await db.query(`
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
    )
  `);

  const startTime = Date.now();
  const netsuite = new NetSuiteClient();

  // Determine cutoff: last sync date, or 7 days back for first run
  let sinceDate = await getLastSyncDate();
  if (!sinceDate || options.force) {
    // First sync or forced: go back 7 days to catch recent changes
    // (the initial full dataset was already seeded from JSON files)
    const d = new Date();
    d.setDate(d.getDate() - 7);
    sinceDate = d.toISOString().split('T')[0];
  }

  console.log(`[NetSuite Sync] Fetching records modified since ${sinceDate}...`);

  const result = {
    sales: { fetched: 0, upserted: 0 },
    estimates: { fetched: 0, upserted: 0 },
    openSales: { fetched: 0, upserted: 0 },
    inventory: { fetched: 0, upserted: 0 },
    sinceDate,
    durationMs: 0
  };

  try {
    // Fetch modified sales orders
    console.log('[NetSuite Sync] Querying sales orders...');
    const salesRows = await netsuite.getSalesModifiedSince(sinceDate);
    result.sales.fetched = salesRows.length;
    console.log(`[NetSuite Sync] Got ${salesRows.length} modified sales orders`);

    for (const row of salesRows) {
      const upserted = await upsertSalesOrder(row);
      if (upserted) result.sales.upserted++;
    }

    // Record sales sync
    await recordSync({
      syncType: 'sales',
      cutoff: sinceDate,
      fetched: result.sales.fetched,
      upserted: result.sales.upserted,
      durationMs: Date.now() - startTime,
      status: 'success'
    });

    // Safety-net: refresh every currently-open sales order (Pending Approval
    // + Pending Fulfillment) regardless of lastModifiedDate. The incremental
    // pull above misses long-standing pending SOs that haven't been touched
    // since they entered that status — without this every sync would leave
    // them invisible to the sales map.
    console.log('[NetSuite Sync] Refreshing open sales orders (Pending Approval + Fulfillment)...');
    try {
      const openStart = Date.now();
      result.openSales = await syncOpenSalesOrders(netsuite);
      console.log(`[NetSuite Sync] Open SOs: ${result.openSales.upserted}/${result.openSales.fetched} refreshed`);
      await recordSync({
        syncType: 'open_sales',
        cutoff: sinceDate,
        fetched: result.openSales.fetched,
        upserted: result.openSales.upserted,
        durationMs: Date.now() - openStart,
        status: 'success'
      });
    } catch (e) {
      console.error('[NetSuite Sync] Open SO refresh failed:', e.message);
      await recordSync({
        syncType: 'open_sales',
        cutoff: sinceDate,
        fetched: result.openSales.fetched,
        upserted: result.openSales.upserted,
        durationMs: 0,
        status: 'error',
        errorMessage: e.message
      });
      // Don't rethrow — the incremental sales sync already succeeded.
    }

    // Fetch modified estimates
    console.log('[NetSuite Sync] Querying estimates...');
    const estRows = await netsuite.getEstimatesModifiedSince(sinceDate);
    result.estimates.fetched = estRows.length;
    console.log(`[NetSuite Sync] Got ${estRows.length} modified estimates`);

    for (const row of estRows) {
      const upserted = await upsertEstimate(row);
      if (upserted) result.estimates.upserted++;
    }

    // Record estimates sync
    await recordSync({
      syncType: 'estimates',
      cutoff: sinceDate,
      fetched: result.estimates.fetched,
      upserted: result.estimates.upserted,
      durationMs: Date.now() - startTime,
      status: 'success'
    });

    // Inventory snapshot (full refresh each run — single location, current
    // state only; the other service reads `inventory` as the source of truth).
    console.log('[NetSuite Sync] Refreshing inventory snapshot...');
    try {
      const invStart = Date.now();
      result.inventory = await syncInventory(netsuite);
      console.log(`[NetSuite Sync] Inventory: ${result.inventory.upserted}/${result.inventory.fetched} items upserted`);
      await recordSync({
        syncType: 'inventory',
        cutoff: sinceDate,
        fetched: result.inventory.fetched,
        upserted: result.inventory.upserted,
        durationMs: Date.now() - invStart,
        status: 'success'
      });
    } catch (e) {
      console.error('[NetSuite Sync] Inventory refresh failed:', e.message);
      await recordSync({
        syncType: 'inventory',
        cutoff: sinceDate,
        fetched: result.inventory.fetched,
        upserted: result.inventory.upserted,
        durationMs: 0,
        status: 'error',
        errorMessage: e.message
      });
      // Don't rethrow — sales/estimate sync already succeeded and shouldn't
      // be penalized by an inventory query hiccup.
    }

    result.durationMs = Date.now() - startTime;

    const totalFetched = result.sales.fetched + result.estimates.fetched;
    const totalUpserted = result.sales.upserted + result.estimates.upserted;
    console.log(`[NetSuite Sync] Complete: ${totalFetched} txn fetched, ${totalUpserted} upserted; ${result.openSales.upserted} open SOs refreshed; ${result.inventory.upserted} inventory items refreshed in ${result.durationMs}ms`);

    // Geocode any new transactions that don't have coordinates yet
    if (totalUpserted > 0) {
      geocodeNewTransactions().catch(e =>
        console.warn('[NetSuite Sync] Geocoding failed:', e.message)
      );
    }

    return result;

  } catch (e) {
    result.durationMs = Date.now() - startTime;
    console.error(`[NetSuite Sync] Failed: ${e.message}`);

    await recordSync({
      syncType: 'incremental',
      cutoff: sinceDate,
      fetched: result.sales.fetched + result.estimates.fetched,
      upserted: result.sales.upserted + result.estimates.upserted,
      durationMs: result.durationMs,
      status: 'error',
      errorMessage: e.message
    });

    throw e;
  }
}

/**
 * Get sync status info for display in the UI.
 */
async function getSyncStatus() {
  if (!(await db.isReady())) {
    return { lastSync: null, available: false };
  }

  try {
    const { rows } = await db.query(
      `SELECT last_sync_at, last_modified_cutoff, records_fetched, records_upserted, duration_ms, status, error_message
       FROM transaction_sync
       ORDER BY last_sync_at DESC LIMIT 1`
    );

    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM transactions');
    const totalTransactions = parseInt(countRows[0].count);

    if (rows.length === 0) {
      return { lastSync: null, totalTransactions, available: true };
    }

    const last = rows[0];
    return {
      lastSync: last.last_sync_at,
      lastCutoff: last.last_modified_cutoff,
      lastFetched: last.records_fetched,
      lastUpserted: last.records_upserted,
      lastDuration: last.duration_ms,
      lastStatus: last.status,
      lastError: last.error_message,
      totalTransactions,
      available: true
    };
  } catch (e) {
    return { lastSync: null, available: false, error: e.message };
  }
}

/**
 * Geocode transactions that have an address but no lat/lng.
 * Runs after sync to fill in coordinates for new records.
 * Rate limited to 1 req/sec (Census API).
 */
async function geocodeNewTransactions() {
  const { rows } = await db.query(`
    SELECT id, street, city, state, zip FROM transactions
    WHERE lat IS NULL AND street IS NOT NULL AND street != ''
    ORDER BY synced_at DESC
    LIMIT 200
  `);

  if (rows.length === 0) return;
  console.log(`[Geocode] ${rows.length} transactions need geocoding...`);

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

  console.log(`[Geocode] Done: ${geocoded}/${rows.length} geocoded.`);
}

module.exports = { runSync, getSyncStatus, getLastSyncDate, syncInventory, upsertInventoryItem, syncOpenSalesOrders };
