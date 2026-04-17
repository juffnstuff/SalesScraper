#!/usr/bin/env node

/**
 * RubberForm Prospecting Engine — CLI Entry Point
 *
 * Usage:
 *   node prospect.js --rep all              Run all reps
 *   node prospect.js --rep galen_reich      Run single rep
 *   node prospect.js --rep all --dry-run    Preview without pushing to HubSpot
 *   node prospect.js --rep all --refresh-icp  Re-derive ICPs before searching
 *   node prospect.js --report               Show last run summary
 */

require('dotenv').config();

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const ICPEngine = require('./src/discovery/icp_engine');
const BidSearcher = require('./src/prospecting/bid_searcher');
const SellingApiClient = require('./src/enrichment/selling_api');
const HubSpotClient = require('./src/crm/hubspot_client');
const CLIDisplay = require('./src/ui/cli_display');
const Reporter = require('./src/ui/reporter');

const REP_PROFILES_PATH = path.join(__dirname, 'config/rep_profiles.json');

// Warn early when credentials the pipeline relies on are missing — easier to
// diagnose than the auth/API errors that surface deep in the run otherwise.
function warnMissingEnv() {
  const required = {
    ANTHROPIC_API_KEY: 'ICP synthesis + Claude scoring',
    HUBSPOT_ACCESS_TOKEN: 'HubSpot push (unless --dry-run)',
    NETSUITE_ACCOUNT_ID: 'NetSuite SuiteQL queries'
  };
  const missing = Object.entries(required).filter(([k]) => !process.env[k]);
  if (missing.length > 0) {
    const chalk = require('chalk');
    console.warn(chalk.yellow(`\n  ⚠  Missing env vars (features will degrade):`));
    for (const [k, why] of missing) console.warn(chalk.yellow(`      - ${k}: ${why}`));
    console.warn('');
  }
}

program
  .name('prospect')
  .description('RubberForm AI-Powered Sales Prospecting Engine')
  .version('1.0.0');

program
  .option('--rep <id>', 'Rep ID to run (or "all" for all reps)', 'all')
  .option('--dry-run', 'Preview results without pushing to HubSpot', false)
  .option('--refresh-icp', 'Force re-derivation of ICPs', false)
  .option('--report', 'Show last run summary', false)
  .option('--skip-search', 'Skip bid search (use cached results)', false)
  .option('--skip-enrich', 'Skip Selling.com contact enrichment', false);

program.parse();
const opts = program.opts();

async function main() {
  // Report mode
  if (opts.report) {
    Reporter.showLastRunSummary();
    return;
  }

  // Load rep profiles
  if (!fs.existsSync(REP_PROFILES_PATH)) {
    console.error('Error: config/rep_profiles.json not found. Run Step 1 discovery first.');
    process.exit(1);
  }

  const allReps = JSON.parse(fs.readFileSync(REP_PROFILES_PATH, 'utf8'));
  const reps = opts.rep === 'all'
    ? allReps
    : allReps.filter(r => r.id === opts.rep);

  if (reps.length === 0) {
    console.error(`Error: Rep "${opts.rep}" not found. Available: ${allReps.map(r => r.id).join(', ')}`);
    process.exit(1);
  }

  // Force dry-run if DRY_RUN env is set
  const dryRun = opts.dryRun || process.env.DRY_RUN === 'true';

  warnMissingEnv();

  // Initialize engines
  const icpEngine = new ICPEngine();
  const bidSearcher = new BidSearcher();
  const sellingApi = new SellingApiClient();
  const hubspot = new HubSpotClient();

  CLIDisplay.header();

  if (dryRun) {
    const chalk = require('chalk');
    console.log(chalk.yellow.bold('\n  ⚠  DRY RUN MODE — No data will be pushed to HubSpot\n'));
  }

  // Build a lookup for rep routing (e.g. Bill -> Jake)
  const repLookup = {};
  for (const r of allReps) { repLookup[r.id] = r; }

  let totalNewProspects = 0;
  const allPushResults = [];

  for (const rep of reps) {
    try {
      // Resolve HubSpot assignment: if rep has hubspotAssignTo, route to that rep
      const assignToRep = rep.hubspotAssignTo ? repLookup[rep.hubspotAssignTo] || rep : rep;
      const hubspotRep = {
        ...rep,
        hubspotOwnerId: assignToRep.hubspotOwnerId
      };

      if (rep.hubspotAssignTo) {
        const chalk = require('chalk');
        console.log(chalk.gray(`\n  (${rep.name}'s prospects will be assigned to ${assignToRep.name} in HubSpot)`));
      }

      // Step 1: Get or generate ICP
      console.log(`\n▶ Processing ${rep.name}...`);
      const icp = await icpEngine.getICP(rep, opts.refreshIcp);
      CLIDisplay.icpStatus(rep, icp);

      // Step 2: Search for bids/projects
      const searchResults = await bidSearcher.searchForRep(rep, icp);

      CLIDisplay.repHeader(rep, icp, searchResults);

      if (searchResults.results.length === 0) {
        console.log('  No qualified results found for this rep.');
        Reporter.saveRunLog(rep.id, {
          repName: rep.name,
          icp,
          searchResults,
          pushResults: []
        });
        continue;
      }

      // Step 3: Enrich contacts via Selling.com
      if (!opts.skipEnrich) {
        console.log(`\n  Enriching contacts via Selling.com...`);
        for (const result of searchResults.results) {
          const contacts = await sellingApi.findContactsForProject(result, icp);
          result.contacts = contacts;
        }
      }

      // Step 4: Display results
      searchResults.results.forEach((result, i) => {
        CLIDisplay.prospectResult(result, i);
      });

      // Step 5: Push to HubSpot (unless dry-run)
      const repPushResults = [];
      if (!dryRun) {
        console.log(`\n  Pushing ${searchResults.results.length} prospects to HubSpot...`);

        for (const result of searchResults.results) {
          const contacts = result.contacts || [];
          if (contacts.length === 0) {
            // Create a placeholder contact from the project
            contacts.push({
              firstName: '',
              lastName: result.owner || result.generalContractor || 'Unknown',
              email: '',
              phone: '',
              title: 'Decision Maker',
              company: result.owner || result.generalContractor || result.projectName,
              state: result.geography?.state || ''
            });
          }

          for (const contact of contacts) {
            const pushResult = await hubspot.pushProspect(contact, result, hubspotRep);
            repPushResults.push(pushResult);
          }
        }

        CLIDisplay.pushResults(repPushResults);
      }

      totalNewProspects += searchResults.results.length;
      allPushResults.push(...repPushResults);

      // Save run log
      Reporter.saveRunLog(rep.id, {
        repName: rep.name,
        icp,
        searchResults: {
          total: searchResults.total,
          unique: searchResults.unique,
          qualified: searchResults.qualified,
          results: searchResults.results
        },
        pushResults: repPushResults
      });

    } catch (error) {
      console.error(`\n  Error processing ${rep.name}: ${error.message}`);
      console.error(`  Stack: ${error.stack}`);
    }
  }

  CLIDisplay.summary(totalNewProspects, dryRun);

  if (!dryRun && allPushResults.length > 0) {
    CLIDisplay.pushResults(allPushResults);
  }
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
