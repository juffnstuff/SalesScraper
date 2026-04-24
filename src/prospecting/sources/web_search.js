/**
 * Web Search Source
 * Uses Anthropic Claude with web_search tool for targeted prospect discovery.
 * Also performs direct Google-style searches via news/gov sites.
 */

const Anthropic = require('@anthropic-ai/sdk');

class WebSearchSource {
  constructor() {
    this.anthropic = new Anthropic();
  }

  /**
   * Run ICP-targeted web searches using Claude's web search capability
   */
  async search(icp) {
    const queries = icp.searchQueries || this._generateQueries(icp);
    const results = [];

    for (const query of queries.slice(0, 10)) {
      try {
        console.log(`    Searching: "${query}"`);
        const searchResults = await this._runWebSearch(query, icp);
        results.push(...searchResults);
      } catch (error) {
        console.warn(`    Web search failed for "${query}": ${error.message}`);
      }

      // Rate limit: small delay between searches
      await new Promise(r => setTimeout(r, 1000));
    }

    return this._deduplicateResults(results);
  }

  _generateQueries(icp) {
    const queries = [];
    const year = new Date().getFullYear();
    const products = icp.productAffinities || ['safety products', 'rubber products'];
    const states = icp.geographies || ['NY', 'PA', 'OH'];
    const keywords = icp.triggerKeywords || ['construction', 'bid'];

    // Product + geography + bid queries
    for (const product of products.slice(0, 3)) {
      for (const state of states.slice(0, 3)) {
        queries.push(`"${product}" contractor bid ${state} ${year}`);
      }
    }

    // Project type + geography queries
    for (const projectType of (icp.projectTypes || []).slice(0, 3)) {
      queries.push(`${projectType} bid RFP ${year}`);
    }

    // Trigger keyword + site:.gov queries
    for (const keyword of keywords.slice(0, 3)) {
      queries.push(`site:*.gov "${keyword}" bid OR RFP OR "invitation to bid" ${year}`);
    }

    // Construction news queries
    queries.push(`construction project awarded ${states[0] || 'USA'} ${year}`);
    queries.push(`highway construction bid letting ${year}`);

    return queries;
  }

  async _runWebSearch(query, icp) {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3
        }],
        messages: [{
          role: 'user',
          content: `Search the web for this query and extract any construction bids, RFPs, or project opportunities that might need safety products (speed bumps, cable protectors, trackout mats, bollards, wheel stops, etc.):

Query: ${query}

For each result found, extract:
- Project name
- Project type (highway, commercial, municipal, etc.)
- Location (city, state)
- Estimated value (if available)
- Bid/response deadline
- Owner/agency
- General contractor (if known)
- Source URL

Return results as a JSON array. If no relevant results found, return [].
Return ONLY the JSON array, no other text.`
        }]
      });

      // Extract text from response
      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock) return [];

      try {
        const parsed = JSON.parse(textBlock.text);
        return (Array.isArray(parsed) ? parsed : []).map(r => ({
          projectName: r.projectName || r.project_name || 'Unknown Project',
          projectType: r.projectType || r.project_type || 'Construction',
          geography: {
            city: r.city || r.location?.city || '',
            state: r.state || r.location?.state || '',
            county: r.county || ''
          },
          estimatedValue: parseFloat(r.estimatedValue || r.value || 0) || 0,
          bidDate: r.bidDate || r.deadline || r.bid_date || '',
          awardDate: r.awardDate || '',
          owner: r.owner || r.agency || '',
          generalContractor: r.generalContractor || r.gc || '',
          sourceUrl: r.sourceUrl || r.url || r.source_url || '',
          source: 'web_search',
          relevanceScore: 0,
          matchedIcpFields: ['web_search'],
          notes: r.notes || `Found via web search: "${query}"`
        }));
      } catch (e) {
        return [];
      }
    } catch (error) {
      console.warn(`    Claude web search error: ${error.message}`);
      return [];
    }
  }

  _deduplicateResults(results) {
    const seen = new Set();
    return results.filter(r => {
      const key = `${r.projectName}:${r.sourceUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = WebSearchSource;
