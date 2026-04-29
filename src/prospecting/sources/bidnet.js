/**
 * BidNet / DemandStar / Periscope Searcher
 * Searches government bid aggregator platforms.
 */

const https = require('https');
const { retry, parseRetryAfter } = require('../../util/retry');

const REQUEST_TIMEOUT_MS = 15000;

class BidAggregatorSearcher {
  constructor() {
    this.sources = [
      {
        name: 'BidNet',
        searchUrl: 'https://www.bidnet.com/bids/search',
        baseUrl: 'https://www.bidnet.com'
      },
      {
        name: 'DemandStar',
        searchUrl: 'https://www.demandstar.com/search',
        baseUrl: 'https://www.demandstar.com'
      }
    ];
  }

  /**
   * Search bid aggregators based on ICP
   */
  async search(icp) {
    const results = [];
    const searchTerms = this._buildSearchTerms(icp);

    for (const source of this.sources) {
      for (const term of searchTerms) {
        try {
          const bids = await this._searchSource(source, term, icp);
          results.push(...bids);
        } catch (error) {
          console.warn(`  ${source.name} search failed for "${term}": ${error.message}`);
        }
      }
    }

    return this._deduplicateResults(results);
  }

  _buildSearchTerms(icp) {
    const terms = new Set();
    // Combine product affinities with project types
    for (const product of (icp.productAffinities || []).slice(0, 3)) {
      terms.add(product);
    }
    for (const keyword of (icp.triggerKeywords || []).slice(0, 3)) {
      terms.add(keyword);
    }
    // Add general construction safety terms
    terms.add('construction safety products');
    terms.add('rubber safety products');
    return [...terms];
  }

  async _searchSource(source, searchTerm, icp) {
    const params = new URLSearchParams({
      q: searchTerm,
      category: 'construction',
      state: (icp.geographies || []).join(',')
    });
    const url = `${source.searchUrl}?${params.toString()}`;

    return retry(() => this._fetchSourceOnce(source, url, searchTerm, icp), {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      label: `${source.name} "${searchTerm}"`,
    });
  }

  _fetchSourceOnce(source, url, searchTerm, icp) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RubberFormProspector/1.0)',
          'Accept': 'text/html,application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`${source.name} HTTP ${res.statusCode} for "${searchTerm}"`);
            err.statusCode = res.statusCode;
            err.retryAfterMs = parseRetryAfter(res.headers['retry-after']);
            return reject(err);
          }
          resolve(this._parseResults(data, source, searchTerm, icp));
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        const err = new Error(`${source.name} timed out after ${REQUEST_TIMEOUT_MS}ms for "${searchTerm}"`);
        err.code = 'ETIMEDOUT';
        req.destroy(err);
      });
      req.end();
    });
  }

  _parseResults(html, source, searchTerm, icp) {
    const results = [];
    // Look for bid listing patterns in HTML
    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Extract bid-like entries (title, agency, date patterns)
    const bidPattern = /(?:bid|solicitation|rfp|rfq|itb)\s*#?\s*[\w-]+/gi;
    const matches = textContent.match(bidPattern) || [];

    // Return structured results for any matches found
    for (const match of matches.slice(0, 5)) {
      results.push({
        projectName: match.trim(),
        projectType: 'Government Bid',
        geography: { city: '', state: '', county: '' },
        estimatedValue: 0,
        bidDate: '',
        awardDate: '',
        owner: '',
        generalContractor: '',
        sourceUrl: source.baseUrl,
        source: source.name,
        relevanceScore: 0,
        matchedIcpFields: [`keyword:${searchTerm}`],
        notes: `Found via ${source.name} search for "${searchTerm}"`
      });
    }

    return results;
  }

  _deduplicateResults(results) {
    const seen = new Set();
    return results.filter(r => {
      const key = `${r.source}:${r.projectName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = BidAggregatorSearcher;
