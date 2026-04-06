/**
 * BidNet / DemandStar / Periscope Searcher
 * Searches government bid aggregator platforms.
 */

const https = require('https');

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
    return new Promise((resolve) => {
      const params = new URLSearchParams({
        q: searchTerm,
        category: 'construction',
        state: (icp.geographies || []).join(',')
      });

      const url = `${source.searchUrl}?${params.toString()}`;
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RubberFormProspector/1.0)',
          'Accept': 'text/html,application/json'
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const results = this._parseResults(data, source, searchTerm, icp);
          resolve(results);
        });
      });

      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
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
