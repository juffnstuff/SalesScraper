/**
 * Reporter
 * Saves run logs and generates summary reports.
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const LOGS_DIR = path.join(__dirname, '../../logs/runs');

class Reporter {
  /**
   * Save a complete run log
   */
  static saveRunLog(repId, data) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `${date}_${repId}.json`;
    const filepath = path.join(LOGS_DIR, filename);

    const log = {
      runDate: new Date().toISOString(),
      repId: repId,
      ...data
    };

    fs.writeFileSync(filepath, JSON.stringify(log, null, 2));
    console.log(`  Run log saved: ${filepath}`);
    return filepath;
  }

  /**
   * Display last run summary for all reps
   */
  static showLastRunSummary() {
    if (!fs.existsSync(LOGS_DIR)) {
      console.log(chalk.yellow('No run logs found. Run the engine first.'));
      return;
    }

    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.log(chalk.yellow('No run logs found.'));
      return;
    }

    // Group by date, show most recent
    const latestDate = files[0].split('_')[0];
    const latestRuns = files.filter(f => f.startsWith(latestDate));

    console.log('');
    console.log(chalk.cyan.bold(`  Last Run Summary — ${latestDate}`));
    console.log(chalk.cyan('  ═══════════════════════════════════════'));

    let totalProspects = 0;
    let totalCreated = 0;
    let totalSkipped = 0;

    for (const file of latestRuns) {
      const filepath = path.join(LOGS_DIR, file);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

      const repName = data.repName || data.repId;
      const results = data.searchResults || {};
      const pushResults = data.pushResults || [];

      const created = pushResults.filter(r => r.action === 'created').length;
      const skipped = pushResults.filter(r => r.action === 'skipped').length;

      totalProspects += results.qualified || 0;
      totalCreated += created;
      totalSkipped += skipped;

      console.log(`\n  ${chalk.bold(repName)}`);
      console.log(`    Bids Found: ${results.total || 0}  │  Qualified: ${results.qualified || 0}`);
      console.log(`    Pushed to HubSpot: ${chalk.green(created)} created, ${chalk.yellow(skipped)} skipped`);

      // Show top 3 results
      if (results.results) {
        const top = results.results.slice(0, 3);
        for (const r of top) {
          console.log(`    ${r.relevanceScore >= 85 ? '★' : '●'} ${r.relevanceScore}/100 ${r.projectName}`);
        }
      }
    }

    console.log(chalk.cyan('\n  ═══════════════════════════════════════'));
    console.log(`  ${chalk.bold('Totals:')} ${totalProspects} qualified prospects, ${totalCreated} pushed, ${totalSkipped} duplicates\n`);
  }

  /**
   * Get historical run data for a rep
   */
  static getRunHistory(repId, limit = 10) {
    if (!fs.existsSync(LOGS_DIR)) return [];

    return fs.readdirSync(LOGS_DIR)
      .filter(f => f.endsWith('.json') && f.includes(repId))
      .sort()
      .reverse()
      .slice(0, limit)
      .map(f => {
        const filepath = path.join(LOGS_DIR, f);
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
      });
  }
}

module.exports = Reporter;
