/**
 * SAM.gov Federal Opportunities Searcher
 * Searches federal construction/safety bids matching rep ICP.
 */

const https = require('https');

class SamGovSearcher {
  constructor() {
    this.baseUrl = 'https://api.sam.gov/opportunities/v2/search';
    this.apiKey = process.env.SAM_GOV_API_KEY || '';
  }

  /**
   * Search SAM.gov for opportunities matching ICP
   */
  async search(icp) {
    const results = [];

    // Build search queries from ICP
    const naicsCodes = (icp.naicsCodes || []).join(',');
    const keywords = (icp.triggerKeywords || []).slice(0, 5);

    for (const keyword of keywords) {
      try {
        const opportunities = await this._searchOpportunities(keyword, naicsCodes, icp.geographies);
        results.push(...opportunities);
      } catch (error) {
        console.warn(`  SAM.gov search failed for "${keyword}": ${error.message}`);
      }
    }

    return this._deduplicateResults(results);
  }

  async _searchOpportunities(keyword, naicsCodes, states) {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      q: keyword,
      postedFrom: this._sixMonthsAgo(),
      postedTo: this._today(),
      limit: 25,
      offset: 0
    });

    if (naicsCodes) params.set('naics', naicsCodes);

    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}?${params.toString()}`;
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const opps = parsed.opportunitiesData || [];
            resolve(opps.map(opp => this._normalizeResult(opp, states)));
          } catch (e) {
            resolve([]); // Graceful failure
          }
        });
      });

      req.on('error', () => resolve([]));
      req.end();
    });
  }

  _normalizeResult(opp, icpStates) {
    const state = opp.placeOfPerformance?.state?.code || '';
    const stateMatch = (icpStates || []).includes(state);

    return {
      projectName: opp.title || 'Untitled Opportunity',
      projectType: opp.type || 'Federal Opportunity',
      geography: {
        city: opp.placeOfPerformance?.city?.name || '',
        state: state,
        county: ''
      },
      estimatedValue: 0, // SAM.gov doesn't always provide this
      bidDate: opp.responseDeadLine || '',
      awardDate: opp.awardDate || '',
      owner: opp.department || opp.agency || '',
      generalContractor: '',
      sourceUrl: `https://sam.gov/opp/${opp.noticeId || ''}`,
      source: 'sam.gov',
      relevanceScore: 0, // Will be scored by scorer.js
      matchedIcpFields: stateMatch ? ['geography'] : [],
      notes: opp.description ? opp.description.substring(0, 500) : '',
      naicsCode: opp.naicsCode || '',
      rawData: {
        solicitationNumber: opp.solicitationNumber,
        department: opp.department,
        agency: opp.agency,
        setAside: opp.typeOfSetAside
      }
    };
  }

  _deduplicateResults(results) {
    const seen = new Set();
    return results.filter(r => {
      const key = r.projectName + r.sourceUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _sixMonthsAgo() {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  }

  _today() {
    return new Date().toISOString().split('T')[0];
  }
}

module.exports = SamGovSearcher;
