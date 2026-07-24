#!/usr/bin/env node
/**
 * Refresh the NetSuite Part Group (item.custitem1) ID → name mapping.
 * Overwrites config/part_groups.json.
 *
 * Run after new part groups are added in NetSuite so the Sales Map's
 * "Part Groups" filter shows the new names.
 *
 * Usage:
 *   node scripts/refresh_part_groups.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const NetSuiteClient = require('../src/discovery/netsuite_client');

const OUT_PATH = path.join(__dirname, '..', 'config', 'part_groups.json');

async function main() {
  const client = new NetSuiteClient();

  console.log('Fetching part group mapping from NetSuite...');
  const resp = await client.runSuiteQL(
    `SELECT DISTINCT item.custitem1 AS partGroupId,
                     BUILTIN.DF(item.custitem1) AS partGroupName
     FROM item
     WHERE item.custitem1 IS NOT NULL
     ORDER BY BUILTIN.DF(item.custitem1)`,
    'Part Group ID → name mapping'
  );
  const rows = resp.items || [];

  const groups = {};
  for (const r of rows) {
    const id = String(r.partgroupid || r.partGroupId || '').trim();
    const name = (r.partgroupname || r.partGroupName || '').trim();
    if (id && name) groups[id] = name;
  }

  const payload = {
    _meta: {
      description: 'NetSuite item.custitem1 (Part Group) internal-ID → display-name mapping. Used by the Sales Map\'s Part Groups filter so items can be shown by human-readable name instead of raw NetSuite IDs. Refresh with `node scripts/refresh_part_groups.js` after new part groups are added in NetSuite.',
      fetchedAt: new Date().toISOString().slice(0, 10),
      source: 'SELECT DISTINCT item.custitem1, BUILTIN.DF(item.custitem1) FROM item'
    },
    groups
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`✓ Wrote ${Object.keys(groups).length} part group${Object.keys(groups).length === 1 ? '' : 's'} → ${OUT_PATH}`);
}

main().catch(e => {
  console.error('Refresh failed:', e.message);
  process.exit(1);
});
