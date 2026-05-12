#!/usr/bin/env node
/**
 * Phase 1 Validation — Apollo hit rate on named-GC/owner projects.
 *
 * Pulls a sample of projects that already have an owner or general_contractor
 * populated, runs the same Apollo People Search the heatmap button uses, and
 * reports per-project results plus aggregate metrics.
 *
 * Uses the free `/mixed_people/api_search` endpoint only — no enrichment
 * credits consumed. The `hasEmail` field on each result tells us whether
 * Apollo CLAIMS to have an unlockable email; that's the right gate for
 * "would Phase 1 produce an actionable contact if we paid for enrichment?".
 *
 * Usage:
 *   node scripts/validate_phase1_apollo.js                # default 15 projects
 *   node scripts/validate_phase1_apollo.js 30             # sample size 30
 *   node scripts/validate_phase1_apollo.js 15 --json      # dump JSON for parsing
 *
 * Requires APOLLO_API_KEY + DATABASE_URL in env (.env or `railway run`).
 */

require('dotenv').config();

const db = require('../src/web/db');
const { createEnrichmentClient } = require('../src/enrichment');

const argv = process.argv.slice(2);
const SAMPLE_SIZE = parseInt(argv.find(a => /^\d+$/.test(a)) || '15', 10);
const JSON_MODE = argv.includes('--json');

const BUYER_TITLES = [
  'Project Manager', 'Procurement Manager', 'Purchasing Manager',
  'Operations Manager', 'VP Operations', 'VP Construction',
  'Director of Procurement', 'Director of Operations',
  'Safety Manager', 'Facilities Manager', 'Site Manager',
  'General Manager', 'Owner', 'President'
];

function log(...args) { if (!JSON_MODE) console.log(...args); }

async function main() {
  if (!(await db.isReady())) {
    console.error('✗ DATABASE_URL not set or DB not reachable. Aborting.');
    process.exit(1);
  }

  const enrichment = createEnrichmentClient();
  if (!enrichment.hasKey()) {
    console.error('✗ APOLLO_API_KEY not set. Aborting.');
    process.exit(1);
  }

  const provider = (process.env.ENRICHMENT_PROVIDER || 'apollo').toLowerCase();
  log(`Provider: ${provider}`);
  log(`Sample size: ${SAMPLE_SIZE}`);
  log(`Endpoint: free People Search (no enrichment credits charged)\n`);

  const { rows: projects } = await db.query(`
    SELECT id, project_name, owner, general_contractor, state, city
    FROM projects
    WHERE (COALESCE(general_contractor, '') <> '' OR COALESCE(owner, '') <> '')
    ORDER BY id DESC
    LIMIT $1
  `, [SAMPLE_SIZE]);

  if (projects.length === 0) {
    console.error('✗ No projects in DB have owner or general_contractor populated.');
    console.error('  Either the DB is empty or Phase 1 has no eligible inputs yet.');
    process.exit(2);
  }

  log(`Found ${projects.length} eligible project${projects.length === 1 ? '' : 's'} with a named company.\n`);
  log('─'.repeat(80));

  const results = [];

  for (const p of projects) {
    const targets = [];
    if (p.owner) targets.push({ name: p.owner, role: 'owner' });
    if (p.general_contractor) targets.push({ name: p.general_contractor, role: 'gc' });

    const targetResults = [];
    for (const t of targets) {
      try {
        const contacts = await enrichment.findContacts(t.name, p.state || '', BUYER_TITLES);
        const withEmail = contacts.filter(c => c.hasEmail || c.email).length;
        const withPhone = contacts.filter(c => c.hasDirectPhone || c.phone).length;
        targetResults.push({
          target: t.name,
          role: t.role,
          count: contacts.length,
          withEmail,
          withPhone,
          sampleTitles: contacts.slice(0, 3).map(c => c.title || '(no title)')
        });
      } catch (e) {
        targetResults.push({ target: t.name, role: t.role, error: e.message });
      }
    }

    const projTotal = targetResults.reduce((s, r) => s + (r.count || 0), 0);
    const projWithEmail = targetResults.reduce((s, r) => s + (r.withEmail || 0), 0);
    const projWithPhone = targetResults.reduce((s, r) => s + (r.withPhone || 0), 0);
    const hadError = targetResults.some(r => r.error);

    results.push({
      projectId: p.id,
      projectName: p.project_name,
      state: p.state || '',
      city: p.city || '',
      targets: targetResults,
      totalContacts: projTotal,
      contactsWithEmail: projWithEmail,
      contactsWithPhone: projWithPhone,
      hadError
    });

    log(`#${p.id}  ${truncate(p.project_name || '(no name)', 55).padEnd(55)}  ${(p.state || '').padEnd(3)}`);
    for (const tr of targetResults) {
      if (tr.error) {
        log(`   ✗ ${tr.role.padEnd(5)}  "${truncate(tr.target, 40)}"  → ERROR: ${tr.error}`);
      } else {
        const marker = tr.count > 0 ? '✓' : '·';
        log(`   ${marker} ${tr.role.padEnd(5)}  "${truncate(tr.target, 40)}"  → ${tr.count} contacts (${tr.withEmail} w/ email, ${tr.withPhone} w/ phone)`);
        if (tr.count > 0 && tr.sampleTitles.length) {
          log(`        titles: ${tr.sampleTitles.join(' | ')}`);
        }
      }
    }
    log('');
  }

  // Aggregate
  const totalProjects = results.length;
  const projectsAnyContact = results.filter(r => r.totalContacts > 0).length;
  const projectsEmailContact = results.filter(r => r.contactsWithEmail > 0).length;
  const projectsErrored = results.filter(r => r.hadError).length;
  const totalContacts = results.reduce((s, r) => s + r.totalContacts, 0);
  const totalEmail = results.reduce((s, r) => s + r.contactsWithEmail, 0);
  const totalPhone = results.reduce((s, r) => s + r.contactsWithPhone, 0);

  const summary = {
    sampleSize: totalProjects,
    hitRateAny: pct(projectsAnyContact, totalProjects),
    hitRateEmailable: pct(projectsEmailContact, totalProjects),
    projectsWithErrors: projectsErrored,
    avgContactsPerProject: round1(totalContacts / totalProjects),
    totalContactsReturned: totalContacts,
    totalWithEmail: totalEmail,
    totalWithPhone: totalPhone
  };

  log('═'.repeat(80));
  log('PHASE 1 VALIDATION SUMMARY');
  log('═'.repeat(80));
  log(`Projects tested:                ${totalProjects}`);
  log(`Hit rate (≥1 contact found):    ${summary.hitRateAny}%  (${projectsAnyContact}/${totalProjects})`);
  log(`Hit rate (≥1 emailable contact):${summary.hitRateEmailable}%  (${projectsEmailContact}/${totalProjects})`);
  log(`Projects with Apollo errors:    ${projectsErrored}`);
  log(`Avg contacts / project:         ${summary.avgContactsPerProject}`);
  log(`Total contacts returned:        ${totalContacts}`);
  log(`  w/ hasEmail flag:             ${totalEmail}`);
  log(`  w/ hasDirectPhone flag:       ${totalPhone}`);
  log('═'.repeat(80));
  log('');
  log('Verdict thresholds (rough):');
  log('  ≥50% emailable hit rate → ship Phase 1 as-is.');
  log('  20–50%                  → iterate on call shape (org-name match, location).');
  log('  <20%                    → Apollo is the wrong source for this segment; rethink.');

  if (JSON_MODE) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  }

  process.exit(0);
}

function pct(n, d) { return d === 0 ? 0 : Math.round((n / d) * 100); }
function round1(n) { return Math.round(n * 10) / 10; }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

main().catch(e => {
  console.error('Validation script failed:', e);
  process.exit(1);
});
