#!/usr/bin/env node
/**
 * Export all rep ICPs (config/icps/*.json) into a single markdown file.
 *
 * Usage:
 *   node scripts/export_icps.js              # writes ICPs.md in cwd
 *   node scripts/export_icps.js path/to.md   # writes to custom path
 *
 * The ICPs themselves are AI-generated (see src/discovery/icp_engine.js) and
 * cached for 30 days under config/icps/. Regenerate before exporting if you
 * want fresh values: `node prospect.js --rep <id> --refresh-icp`.
 */

const fs = require('fs');
const path = require('path');

const ICP_DIR = path.join(__dirname, '..', 'config', 'icps');
const REPS_PATH = path.join(__dirname, '..', 'config', 'rep_profiles.json');
const OUT_PATH = path.resolve(process.argv[2] || 'ICPs.md');

function loadReps() {
  try { return JSON.parse(fs.readFileSync(REPS_PATH, 'utf8')); }
  catch { return []; }
}

function loadIcps() {
  if (!fs.existsSync(ICP_DIR)) return [];
  return fs.readdirSync(ICP_DIR)
    .filter(f => f.endsWith('_icp.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(ICP_DIR, f), 'utf8')));
}

function bullets(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '_(none)_';
  return arr.map(x => `- ${x}`).join('\n');
}

function inline(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '_(none)_';
  return arr.join(', ');
}

function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderRep(icp, repProfile) {
  const territory = repProfile?.territory || '—';
  const verticals = repProfile?.verticals && repProfile.verticals.length
    ? repProfile.verticals.join(', ')
    : '—';
  const generated = icp.generatedAt
    ? new Date(icp.generatedAt).toISOString().slice(0, 10)
    : '—';

  const ds = icp.dealSizeRange || {};
  const dealSize = `${fmtMoney(ds.min)} – ${fmtMoney(ds.max)} (sweet spot ${fmtMoney(ds.sweet_spot)})`;

  return `## ${icp.repName || icp.repId}

| Field | Value |
|---|---|
| Rep ID | \`${icp.repId}\` |
| Territory | ${territory} |
| Verticals | ${verticals} |
| Deal size | ${dealSize} |
| ICP generated | ${generated} |

### Target company types
${bullets(icp.companyTypes)}

### Target project types
${bullets(icp.projectTypes)}

### Buyer titles
${bullets(icp.buyerTitles)}

### Product affinities
${bullets(icp.productAffinities)}

### Trigger keywords
${inline(icp.triggerKeywords)}

### NAICS codes
${inline(icp.naicsCodes)}

### Geographies
${inline(icp.geographies)}

### Bid sources
${bullets(icp.bidSources)}

### Search queries
<details>
<summary>${(icp.searchQueries || []).length} queries (click to expand)</summary>

${bullets(icp.searchQueries)}
</details>
`;
}

function main() {
  const reps = loadReps();
  const repsById = Object.fromEntries(reps.map(r => [r.id, r]));
  const icps = loadIcps();

  if (icps.length === 0) {
    console.error('No ICPs found under config/icps/. Run prospect.js to generate them first.');
    process.exit(1);
  }

  // Sort: follow rep_profiles.json order if present, otherwise alphabetical.
  icps.sort((a, b) => {
    const ai = reps.findIndex(r => r.id === a.repId);
    const bi = reps.findIndex(r => r.id === b.repId);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return (a.repName || '').localeCompare(b.repName || '');
  });

  const today = new Date().toISOString().slice(0, 10);
  const toc = icps.map(i => `- [${i.repName || i.repId}](#${slug(i.repName || i.repId)})`).join('\n');

  const body = icps.map(icp => renderRep(icp, repsById[icp.repId])).join('\n---\n\n');

  const md = `# RubberForm Sales Rep ICPs

_Generated ${today} from \`config/icps/*.json\`._

ICPs are derived by \`src/discovery/icp_engine.js\` from each rep's NetSuite
transaction history and Outlook email patterns, then cached for 30 days. To
refresh a single rep before re-exporting:

\`\`\`
node prospect.js --rep <rep_id> --refresh-icp
\`\`\`

## Reps

${toc}

---

${body}`;

  fs.writeFileSync(OUT_PATH, md);
  console.log(`✓ Wrote ${icps.length} ICP${icps.length === 1 ? '' : 's'} → ${OUT_PATH}`);
}

main();
