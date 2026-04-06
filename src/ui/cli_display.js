/**
 * CLI Display
 * Terminal UI for the prospecting engine using chalk for colors.
 */

const chalk = require('chalk');

class CLIDisplay {
  /**
   * Display the run header
   */
  static header() {
    const date = new Date().toISOString().split('T')[0];
    console.log('');
    console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan(`║  ${chalk.bold('RubberForm Prospecting Engine')} — Run: ${date}            ║`));
    console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════╝'));
  }

  /**
   * Display rep section header
   */
  static repHeader(rep, icp, searchResults) {
    const geos = (icp.geographies || []).slice(0, 4).join(', ');
    const companyTypes = (icp.companyTypes || []).slice(0, 2).join(' / ');
    const projectTypes = (icp.projectTypes || []).slice(0, 2).join(' / ');

    console.log('');
    console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════╣'));
    console.log(chalk.cyan(`║  Rep: ${chalk.bold.white(rep.name)}`));
    console.log(chalk.cyan(`║  ICP: ${companyTypes} / ${projectTypes} / ${geos}`));
    console.log(chalk.cyan(`║  Bids Found: ${searchResults.total}  │  Scored ≥60: ${searchResults.qualified}  │  New: ${searchResults.results.length}`));
    console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════╣'));
  }

  /**
   * Display a single prospect result
   */
  static prospectResult(result, index) {
    const score = result.relevanceScore;
    const scoreColor = score >= 85 ? chalk.green.bold : score >= 70 ? chalk.yellow.bold : chalk.white;
    const star = score >= 85 ? '★' : score >= 70 ? '●' : '○';

    const geo = [result.geography?.city, result.geography?.state].filter(Boolean).join(', ');
    const value = result.estimatedValue
      ? chalk.green(`$${result.estimatedValue.toLocaleString()}`)
      : chalk.gray('Value unknown');

    console.log('');
    console.log(`  ${star} ${scoreColor(`${score}/100`)}  ${chalk.bold.white(result.projectName)}`);
    console.log(`            ${chalk.gray('Type:')} ${result.projectType}  │  ${chalk.gray('Location:')} ${geo}`);

    if (result.owner || result.generalContractor) {
      const parts = [];
      if (result.owner) parts.push(`Owner: ${result.owner}`);
      if (result.generalContractor) parts.push(`GC: ${result.generalContractor}`);
      console.log(`            ${parts.join('  │  ')}`);
    }

    if (result.bidDate) {
      console.log(`            ${chalk.gray('Bid Date:')} ${chalk.yellow(result.bidDate)}  │  ${value}`);
    }

    if (result.contacts && result.contacts.length > 0) {
      for (const contact of result.contacts) {
        console.log(`            ${chalk.gray('Contact:')} ${chalk.white(contact.firstName + ' ' + contact.lastName)}, ${contact.title}`);
      }
    }

    if (result.sourceUrl) {
      console.log(`            ${chalk.gray('Source:')} ${chalk.underline.blue(result.sourceUrl)}`);
    }
  }

  /**
   * Display the summary footer with push prompt
   */
  static summary(totalNew, dryRun) {
    console.log('');
    console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════╝'));

    if (dryRun) {
      console.log(chalk.yellow.bold(`\n  DRY RUN: ${totalNew} prospects found. No data pushed to HubSpot.`));
      console.log(chalk.gray('  Run without --dry-run to push to HubSpot.\n'));
    }
  }

  /**
   * Display push results
   */
  static pushResults(results) {
    let created = 0, skipped = 0, failed = 0;
    for (const r of results) {
      if (r.action === 'created') created++;
      else if (r.action === 'skipped') skipped++;
      else failed++;
    }

    console.log('');
    console.log(chalk.cyan('  ── HubSpot Push Results ──'));
    if (created) console.log(chalk.green(`  ✓ ${created} new contacts created`));
    if (skipped) console.log(chalk.yellow(`  ○ ${skipped} duplicates skipped`));
    if (failed) console.log(chalk.red(`  ✗ ${failed} failed`));
    console.log('');
  }

  /**
   * Display ICP generation status
   */
  static icpStatus(rep, icp) {
    console.log(`\n  ${chalk.green('✓')} ICP generated for ${chalk.bold(rep.name)}`);
    console.log(`    Company Types: ${(icp.companyTypes || []).join(', ')}`);
    console.log(`    Geographies: ${(icp.geographies || []).join(', ')}`);
    console.log(`    Top Products: ${(icp.productAffinities || []).slice(0, 5).join(', ')}`);
    console.log(`    Deal Range: $${icp.dealSizeRange?.min || 0} - $${icp.dealSizeRange?.max || 0} (sweet spot: $${icp.dealSizeRange?.sweet_spot || 0})`);
  }

  /**
   * Spinner for long-running operations
   */
  static progress(message) {
    process.stdout.write(`  ${chalk.gray('⟳')} ${message}...`);
    return {
      done: (result) => {
        process.stdout.write(`\r  ${chalk.green('✓')} ${message}: ${result}\n`);
      },
      fail: (error) => {
        process.stdout.write(`\r  ${chalk.red('✗')} ${message}: ${error}\n`);
      }
    };
  }
}

module.exports = CLIDisplay;
