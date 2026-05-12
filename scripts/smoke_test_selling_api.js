#!/usr/bin/env node
/**
 * Selling.com API smoke test.
 *
 * Usage:
 *   node scripts/smoke_test_selling_api.js                 # runs every check
 *   node scripts/smoke_test_selling_api.js --verify        # email verification only
 *   node scripts/smoke_test_selling_api.js --contact       # single contact enrich
 *   node scripts/smoke_test_selling_api.js --company       # single company enrich
 *   node scripts/smoke_test_selling_api.js --bulk          # bulk submit + poll
 *
 * Each enrichment call costs a credit if a match is found. Email verification
 * is also credited. The bulk test uses one contact and polls up to ~30s.
 *
 * Requires SELLING_API_KEY in the environment (or .env).
 */

require('dotenv').config();
const SellingApiClient = require('../src/enrichment/selling_api');

const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;
const want = (flag) => runAll || args.has(flag);

const TEST_EMAIL    = process.env.SMOKE_TEST_EMAIL    || 'jane.doe@example.com';
const TEST_FIRST    = process.env.SMOKE_TEST_FIRST    || 'Satya';
const TEST_LAST     = process.env.SMOKE_TEST_LAST     || 'Nadella';
const TEST_COMPANY  = process.env.SMOKE_TEST_COMPANY  || 'Microsoft';
const TEST_DOMAIN   = process.env.SMOKE_TEST_DOMAIN   || 'https://microsoft.com';
const TEST_WEBSITE  = process.env.SMOKE_TEST_WEBSITE  || TEST_DOMAIN;

function header(label) {
  console.log('\n' + '─'.repeat(60));
  console.log(label);
  console.log('─'.repeat(60));
}

function pretty(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function pollBulk(client, jobId, kind, maxAttempts = 10, intervalMs = 3000) {
  const getter = kind === 'contacts'
    ? client.getBulkContactResults.bind(client)
    : client.getBulkCompanyResults.bind(client);

  for (let i = 1; i <= maxAttempts; i++) {
    process.stdout.write(`  poll ${i}/${maxAttempts}... `);
    const res = await getter(jobId);
    if (res.ready) {
      console.log('ready');
      return res.data;
    }
    console.log('still processing (202)');
    if (i < maxAttempts) await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

async function main() {
  const client = new SellingApiClient();

  if (!client.hasKey()) {
    console.error('✗ SELLING_API_KEY is not set. Add it to .env first.');
    process.exit(1);
  }

  console.log(`Base URL: ${client.baseUrl}`);
  console.log(`Key:      ${client.apiKey.slice(0, 6)}…${client.apiKey.slice(-4)}`);

  let failures = 0;

  if (want('--verify')) {
    header(`POST /email-verification  (email=${TEST_EMAIL})`);
    try {
      const res = await client.verifyEmail(TEST_EMAIL);
      pretty(res);
      if (!res || typeof res.status !== 'string') {
        console.warn('⚠ response missing expected `status` field');
      }
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--contact')) {
    header(`POST /contact  (${TEST_FIRST} ${TEST_LAST} @ ${TEST_COMPANY})`);
    try {
      const res = await client.enrichContact({
        first_name: TEST_FIRST,
        last_name: TEST_LAST,
        company_name: TEST_COMPANY,
        company_domain: TEST_DOMAIN,
        metadata: { mobile_phone_enrichment: false }
      });
      pretty(res);
      if (res && res.contact && res.contact.error) {
        console.warn('⚠ per-record error:', res.contact.error);
      }
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--company')) {
    header(`POST /company  (${TEST_COMPANY})`);
    try {
      const res = await client.enrichCompany({
        company_name: TEST_COMPANY,
        company_website: TEST_WEBSITE,
        metadata: { top_matches_returned: 1 }
      });
      pretty(res);
      if (!res || !Array.isArray(res.companies)) {
        console.warn('⚠ response missing expected `companies` array');
      }
    } catch (e) { failures++; console.error('✗', e.message); }
  }

  if (want('--bulk')) {
    header('POST /contacts (bulk submit)');
    try {
      const submission = await client.submitBulkContacts(
        [{
          first_name: TEST_FIRST,
          last_name: TEST_LAST,
          company_name: TEST_COMPANY,
          company_domain: TEST_DOMAIN,
          custom_fields: { smoke_test: 'true', ts: String(Date.now()) }
        }],
        { real_time_verification: false }
      );
      pretty(submission);
      if (!submission || !submission.job_id) {
        throw new Error('No job_id returned');
      }

      header(`GET /contacts/results/${submission.job_id}.json`);
      const data = await pollBulk(client, submission.job_id, 'contacts');
      if (data) pretty(data);
      else console.warn('⚠ bulk job did not complete within poll window — try again later via download_url');
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

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
