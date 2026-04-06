/**
 * Bid Searcher Orchestrator
 * Runs all bid/project sources in parallel for a given ICP,
 * then passes results through the scorer.
 */

const SamGovSearcher = require('./sources/sam_gov');
const StateDOTSearcher = require('./sources/state_dots');
const BidAggregatorSearcher = require('./sources/bidnet');
const WebSearchSource = require('./sources/web_search');
const Scorer = require('./scorer');

class BidSearcher {
  constructor() {
    this.sources = {
      samGov: new SamGovSearcher(),
      stateDOT: new StateDOTSearcher(),
      bidAggregator: new BidAggregatorSearcher(),
      webSearch: new WebSearchSource()
    };
    this.scorer = new Scorer();
  }

  /**
   * Search all sources for a rep's ICP and return scored results
   */
  async searchForRep(rep, icp) {
    console.log(`\n  Searching bid sources for ${rep.name}...`);
    const allResults = [];

    // Run all sources in parallel
    const sourceResults = await Promise.allSettled([
      this._runSource('SAM.gov', () => this.sources.samGov.search(icp)),
      this._runSource('State DOTs', () => this.sources.stateDOT.search(icp)),
      this._runSource('Bid Aggregators', () => this.sources.bidAggregator.search(icp)),
      this._runSource('Web Search', () => this.sources.webSearch.search(icp))
    ]);

    for (const result of sourceResults) {
      if (result.status === 'fulfilled' && result.value) {
        allResults.push(...result.value);
      }
    }

    console.log(`  Found ${allResults.length} raw results across all sources`);

    // Deduplicate across sources
    const deduplicated = this._deduplicateAcrossSources(allResults);
    console.log(`  ${deduplicated.length} unique results after deduplication`);

    // Score all results against the ICP
    console.log(`  Scoring results against ${rep.name}'s ICP...`);
    const scored = await this.scorer.scoreResults(deduplicated, icp);

    // Filter by minimum relevance score
    const minScore = parseInt(process.env.MIN_RELEVANCE_SCORE || '60');
    const qualified = scored.filter(r => r.relevanceScore >= minScore);

    console.log(`  ${qualified.length} results scored ≥${minScore}`);
    return {
      total: allResults.length,
      unique: deduplicated.length,
      qualified: qualified.length,
      results: qualified.sort((a, b) => b.relevanceScore - a.relevanceScore)
    };
  }

  async _runSource(name, searchFn) {
    try {
      console.log(`    Searching ${name}...`);
      const results = await searchFn();
      console.log(`    ${name}: ${results.length} results`);
      return results;
    } catch (error) {
      console.warn(`    ${name} failed: ${error.message}`);
      return [];
    }
  }

  _deduplicateAcrossSources(results) {
    const seen = new Map();
    for (const result of results) {
      // Create a fuzzy key from project name + geography
      const key = this._normalizeKey(result);
      if (!seen.has(key)) {
        seen.set(key, result);
      } else {
        // Merge: keep the one with more data
        const existing = seen.get(key);
        seen.set(key, this._mergeResults(existing, result));
      }
    }
    return [...seen.values()];
  }

  _normalizeKey(result) {
    const name = (result.projectName || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    const state = (result.geography?.state || '').toLowerCase();
    return `${name}:${state}`;
  }

  _mergeResults(a, b) {
    return {
      ...a,
      estimatedValue: a.estimatedValue || b.estimatedValue,
      bidDate: a.bidDate || b.bidDate,
      awardDate: a.awardDate || b.awardDate,
      generalContractor: a.generalContractor || b.generalContractor,
      owner: a.owner || b.owner,
      notes: [a.notes, b.notes].filter(Boolean).join(' | '),
      matchedIcpFields: [...new Set([...(a.matchedIcpFields || []), ...(b.matchedIcpFields || [])])],
      source: `${a.source}, ${b.source}`
    };
  }
}

module.exports = BidSearcher;
