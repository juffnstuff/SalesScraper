/**
 * State DOT Bid Searcher
 * Searches state Department of Transportation bid lettings.
 * Uses web scraping for state DOT portals.
 */

const https = require('https');
const { retry, parseRetryAfter } = require('../../util/retry');

const REQUEST_TIMEOUT_MS = 15000;

// State DOT bid portals URL map
const STATE_DOT_URLS = {
  'NY': 'https://www.dot.ny.gov/doing-business/opportunities/bid-proposals',
  'PA': 'https://www.dot.state.pa.us/Internet/Bureaus/pdBidsAndContracts.nsf',
  'OH': 'https://www.transportation.ohio.gov/working/doing-business-with-odot',
  'TX': 'https://www.txdot.gov/business/letting-bids.html',
  'FL': 'https://fdotwww.blob.core.windows.net/siloLetData/',
  'CA': 'https://dot.ca.gov/programs/construction/advertising-and-awards',
  'NC': 'https://connect.ncdot.gov/letting/Pages/Letting-List.aspx',
  'VA': 'https://www.virginiadot.org/business/const/lettings.asp',
  'GA': 'https://www.dot.ga.gov/PartnerSmart/Business/Pages/Lettings.aspx',
  'MI': 'https://mdotjboss.state.mi.us/BidLetting/BidLetting.htm',
  'IL': 'https://idot.illinois.gov/doing-business/procurements/construction-services/',
  'WI': 'https://wisconsindot.gov/Pages/doing-bus/contractors/hwy-bridge-mtc/bid-let/default.aspx',
  'MN': 'https://www.dot.state.mn.us/bidlet/',
  'IN': 'https://entapps.indot.in.gov/ContractsBidding/',
  'NJ': 'https://www.state.nj.us/transportation/business/procurement/'
};

class StateDOTSearcher {
  /**
   * Search relevant state DOTs based on ICP geographies
   */
  async search(icp) {
    const results = [];
    const targetStates = (icp.geographies || []).slice(0, 5);

    for (const state of targetStates) {
      const url = STATE_DOT_URLS[state];
      if (!url) continue;

      try {
        const bids = await this._scrapeStateDOT(state, url, icp);
        results.push(...bids);
      } catch (error) {
        console.warn(`  State DOT search failed for ${state}: ${error.message}`);
      }
    }

    return results;
  }

  async _scrapeStateDOT(state, url, icp) {
    // Use a lightweight HTTP fetch + HTML parsing approach.
    // For JS-rendered sites, Playwright would be used instead.
    return retry(() => this._fetchStateDOTOnce(state, url, icp), {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      label: `${state} DOT`,
    });
  }

  _fetchStateDOTOnce(state, url, icp) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RubberFormProspector/1.0)',
          'Accept': 'text/html'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`${state} DOT HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.retryAfterMs = parseRetryAfter(res.headers['retry-after']);
            return reject(err);
          }
          resolve(this._parseHTMLForBids(data, state, url, icp));
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        const err = new Error(`${state} DOT timed out after ${REQUEST_TIMEOUT_MS}ms`);
        err.code = 'ETIMEDOUT';
        req.destroy(err);
      });
      req.end();
    });
  }

  /**
   * Parse HTML for bid-related content
   * This is a heuristic parser — specific DOT sites may need custom parsers
   */
  _parseHTMLForBids(html, state, sourceUrl, icp) {
    const results = [];
    const keywords = (icp.triggerKeywords || []).concat([
      'construction', 'safety', 'highway', 'road', 'bridge', 'resurfacing',
      'erosion control', 'traffic', 'parking', 'ADA', 'pedestrian'
    ]);

    // Simple pattern matching for bid tables and listings
    // Look for common bid format patterns in HTML
    const bidPatterns = [
      // Pattern: "Project Name" followed by bid date
      /<tr[^>]*>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>.*?<td[^>]*>(.*?)<\/td>/gis,
      // Pattern: List items with project info
      /<li[^>]*>.*?(?:project|bid|letting).*?<\/li>/gis
    ];

    // Extract text content and look for relevant bids
    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const sentences = textContent.split(/[.!?\n]/);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      const matchedKeywords = keywords.filter(kw => lower.includes(kw.toLowerCase()));

      if (matchedKeywords.length >= 2) {
        // Extract potential bid date (various formats)
        const dateMatch = sentence.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/) ||
                         sentence.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\d{4})\b/i);

        results.push({
          projectName: sentence.trim().substring(0, 200),
          projectType: 'DOT Highway/Road Construction',
          geography: { city: '', state: state, county: '' },
          estimatedValue: 0,
          bidDate: dateMatch ? dateMatch[1] : '',
          awardDate: '',
          owner: `${state} Department of Transportation`,
          generalContractor: '',
          sourceUrl: sourceUrl,
          source: `${state} DOT`,
          relevanceScore: 0,
          matchedIcpFields: ['geography', ...matchedKeywords.map(k => `keyword:${k}`)],
          notes: `Matched keywords: ${matchedKeywords.join(', ')}`
        });
      }
    }

    return results.slice(0, 10); // Limit per state to avoid noise
  }
}

module.exports = StateDOTSearcher;
