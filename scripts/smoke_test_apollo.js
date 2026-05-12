#!/usr/bin/env node
/**
 * Apollo.io API smoke test.
 *
 * Usage:
 *   node scripts/smoke_test_apollo.js               # runs every check
 *   node scripts/smoke_test_apollo.js --search      # mixed_people/search only
 *   node scripts/smoke_test_apollo.js --match       # people/match (single)
 *   node scripts/smoke_test_apollo.js --company     # organizations/enrich
 *   node scripts/smoke_test_apollo.js --bulk        # people/bulk_match
 *
 * Each call may consume credits depending on your plan. On the free tier
 * emails come back obfuscated; the client strips those to ''.
 *
 * Requires APOLLO_API_KEY in the environment (or .env).
 */

require('dotenv').config();
const ApolloClient = require('../src/enrichment/apollo_client');

const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;
const want = (flag) => runAll || args.has(flag);

const TEST_COMPANY = process.env.SMOKE_TEST_COMPANY || 'Microsoft';
const TEST_DOMAIN  = process.env.SMOKE_TEST_DOMAIN  || 'microsoft.com';
const TEST_STATE   = process.env.SMOKE_TEST_STATE   || 'Washington';
const TEST_TITLES  = (process.env.SMOKE_TEST_TITLES || 'CEO,Chief Executive Officer').split(',');
const TEST_FIRST   = process.env.SMOKE_TEST_FIRST   || 'Satya';
const TEST_LAST    = process.env.SMOKE_TEST_LAST    || 'Nadella';

function header(label) {
  console.log('\n' + '─'.repeat(60));
  console.log(label);
  console.log('─'.repeat(60));
}
function pretty(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const client = new ApolloClient();

  if (!client.hasKey()) {
    console.error('✗ APOLLO_API_KEY is not set. Add it to .env first.');
    process.exit(1);
  }

  console.log(`Base URL: ${client.baseUrl}`);
  console.log(`Key:      ${client.apiKey.slice(0, 6)}…${client.apiKey.slice(-4)}`);

  let failures = 0;

  if (want('--search')) {
    header(`POST /mixed_people/api_search  (${TEST_COMPANY}, titles=${TEST_TITLES.join('|')})`);
    console.log('(credit-free endpoint; returns obfuscated names + has_email/has_phone flags)');
    try {
      const contacts = await client.findContacts(TEST_COMPANY, TEST_STATE, TEST_TITLES, 3);
      console.log(`returned ${contacts.length} candidates`);
      contacts.forEach((c, i) => {
        console.log(`  [${i}] ${c.firstName} ${c.lastName} — ${c.title || '(no title)'} @ ${c.company}`);
        console.log(`       id=${c.providerPersonId} hasEmail=${c.hasEmail} hasDirectPhone=${c.hasDirectPhone} conf=${c.confidence}`);
      });
      if (contacts.length === 0) {
        console.warn('⚠ no candidates returned — try a broader company or remove the state filter');
      } else {
        console.log('\nNext step: call --match (or findAndEnrichContacts) with one of the IDs above to reveal email/phone.');
      }
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--find-enrich')) {
    header(`Search + Enrich  (${TEST_COMPANY}, max 3)`);
    console.log('(Search is free; each enrichment costs 1 credit)');
    try {
      const contacts = await client.findAndEnrichContacts(TEST_COMPANY, TEST_STATE, TEST_TITLES, 3, { maxEnrich: 3 });
      console.log(`returned ${contacts.length} contacts (${contacts.filter(c => !c.needsEnrichment).length} enriched)`);
      contacts.forEach((c, i) => {
        console.log(`  [${i}] ${c.firstName} ${c.lastName} — ${c.title || '(no title)'}`);
        console.log(`       email=${c.email || '(none)'} phone=${c.phone || '(none)'} linkedIn=${c.linkedIn ? 'yes' : 'no'} conf=${c.confidence}`);
      });
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--match')) {
    header(`POST /people/match  (${TEST_FIRST} ${TEST_LAST} @ ${TEST_COMPANY})`);
    try {
      const res = await client.enrichContact({
        first_name: TEST_FIRST,
        last_name: TEST_LAST,
        organization_name: TEST_COMPANY,
      });
      pretty(res?.person ? { person: trimPerson(res.person) } : res);
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--company')) {
    header(`GET /organizations/enrich  (domain=${TEST_DOMAIN})`);
    try {
      const res = await client.enrichCompany({ domain: TEST_DOMAIN });
      pretty(res?.organization ? { organization: trimOrg(res.organization) } : res);
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--bulk')) {
    header(`POST /people/bulk_match  (2 records)`);
    try {
      const res = await client.bulkEnrichContacts([
        { first_name: TEST_FIRST, last_name: TEST_LAST, organization_name: TEST_COMPANY },
        { first_name: 'Bill', last_name: 'Gates', organization_name: TEST_COMPANY },
      ]);
      const matches = res?.matches || res?.people || [];
      console.log(`returned ${matches.length} matches`);
      matches.slice(0, 3).forEach((m, i) => {
        console.log(`  [${i}] ${m?.first_name} ${m?.last_name} — ${m?.title || '(no title)'} status=${m?.email_status || 'n/a'}`);
      });
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  console.log('\n' + '═'.repeat(60));
  if (failures === 0) {
    console.log('✓ smoke test complete — no errors');
    process.exit(0);
  } else {
    console.log(`✗ smoke test had ${failures} failure(s)`);
    process.exit(2);
  }
}

function trimPerson(p) {
  return {
    id: p.id,
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    title: p.title,
    email: p.email,
    email_status: p.email_status,
    linkedin_url: p.linkedin_url,
    organization: p.organization && { name: p.organization.name, domain: p.organization.primary_domain || p.organization.website_url },
  };
}
function trimOrg(o) {
  return {
    id: o.id,
    name: o.name,
    domain: o.primary_domain || o.website_url,
    industry: o.industry,
    employees: o.estimated_num_employees,
    revenue: o.annual_revenue,
    location: [o.city, o.state, o.country].filter(Boolean).join(', '),
  };
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
