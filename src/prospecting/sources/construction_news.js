/**
 * Construction News Searcher
 * Monitors construction industry news for groundbreakings, project awards,
 * and major construction starts — especially data centers and infrastructure.
 * Uses Anthropic web_search to find fresh opportunities.
 */

const Anthropic = require('@anthropic-ai/sdk');

class ConstructionNewsSearcher {
  constructor() {
    this.anthropic = new Anthropic();
  }

  /**
   * Search construction news sources for active projects matching ICP
   */
  async search(icp) {
    const results = [];

    // Category 1: Data center construction (high value for cable towers, trackout, etc.)
    const dataCenterResults = await this._searchCategory(
      'data center construction',
      [
        'data center groundbreaking construction 2026',
        'new data center breaking ground site work',
        'Amazon AWS data center construction awarded general contractor',
        'Meta Microsoft Google data center campus construction 2026',
        'hyperscale data center construction start',
        'QTS Vantage CyrusOne Equinix data center build 2026',
        'data center construction billion dollar project awarded'
      ],
      icp
    );
    results.push(...dataCenterResults);

    // Category 2: Major infrastructure & highway projects
    const infraResults = await this._searchCategory(
      'infrastructure construction',
      [
        'highway construction project awarded 2026 general contractor',
        'DOT road construction bid awarded 2026',
        'bridge construction project breaking ground',
        'infrastructure bill construction project started 2026',
        'state DOT letting results awarded contractor'
      ],
      icp
    );
    results.push(...infraResults);

    // Category 3: Commercial & industrial construction starts
    const commercialResults = await this._searchCategory(
      'commercial construction',
      [
        'warehouse distribution center construction groundbreaking 2026',
        'manufacturing plant construction breaking ground',
        'commercial development construction start 2026',
        'industrial park construction awarded',
        'semiconductor fab construction groundbreaking'
      ],
      icp
    );
    results.push(...commercialResults);

    // Category 4: ICP-specific product-driven searches
    const productResults = await this._searchProductOpportunities(icp);
    results.push(...productResults);

    return this._deduplicateResults(results);
  }

  /**
   * Search a category of construction news
   */
  async _searchCategory(category, queries, icp) {
    const results = [];

    for (const query of queries) {
      try {
        console.log(`    [News] ${query}`);
        const found = await this._runNewsSearch(query, category, icp);
        results.push(...found);
      } catch (error) {
        console.warn(`    [News] Failed: ${error.message}`);
      }
      // Rate limit
      await new Promise(r => setTimeout(r, 800));
    }

    return results;
  }

  /**
   * Search for opportunities based on the rep's specific products
   */
  async _searchProductOpportunities(icp) {
    const results = [];
    const products = icp.productAffinities || [];
    const keywords = icp.triggerKeywords || [];

    // Build product-specific queries
    const productQueries = [];

    for (const product of products.slice(0, 4)) {
      const simplified = product.split('(')[0].trim().toLowerCase();
      productQueries.push(`"${simplified}" construction project bid 2026`);
      productQueries.push(`"${simplified}" general contractor procurement`);
    }

    for (const keyword of keywords.slice(0, 3)) {
      productQueries.push(`${keyword} construction project awarded 2026`);
    }

    for (const query of productQueries.slice(0, 8)) {
      try {
        console.log(`    [Product] ${query}`);
        const found = await this._runNewsSearch(query, 'product-specific', icp);
        results.push(...found);
      } catch (error) {
        console.warn(`    [Product] Failed: ${error.message}`);
      }
      await new Promise(r => setTimeout(r, 800));
    }

    return results;
  }

  /**
   * Run a single news-focused web search using Claude
   */
  async _runNewsSearch(query, category, icp) {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3
        }],
        messages: [{
          role: 'user',
          content: `You are a construction industry research assistant for RubberForm Recycled Products, a manufacturer of recycled rubber safety products (cable support towers, trackout mats, speed bumps, spill containment berms, wheel stops, bollards, pipe ramps, etc.).

Search for: ${query}

Find REAL, CURRENT construction projects that are:
- Recently awarded or breaking ground
- In the planning/bidding phase
- Major projects where a general contractor would need safety products

For EACH project found, I need:
1. The actual project name
2. The general contractor or developer
3. The specific location (city, state)
4. Estimated project value if mentioned
5. Any bid deadlines or construction start dates
6. The source URL where you found this

Focus on ACTIONABLE opportunities — real projects with real companies we can contact.

Return a JSON array of objects:
[{
  "projectName": "...",
  "projectType": "...",
  "developer": "...",
  "generalContractor": "...",
  "city": "...",
  "state": "...",
  "estimatedValue": "...",
  "timeline": "...",
  "sourceUrl": "...",
  "notes": "why this is relevant"
}]

If nothing relevant found, return []. Return ONLY the JSON array.`
        }]
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock) return [];

      // Parse JSON from response (handle markdown code blocks)
      let text = textBlock.text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      try {
        const parsed = JSON.parse(text);
        return (Array.isArray(parsed) ? parsed : []).map(r => ({
          projectName: r.projectName || 'Unknown Project',
          projectType: r.projectType || category,
          geography: {
            city: r.city || '',
            state: r.state || '',
            county: ''
          },
          estimatedValue: this._parseValue(r.estimatedValue),
          bidDate: r.timeline || r.bidDate || '',
          awardDate: '',
          owner: r.developer || '',
          generalContractor: r.generalContractor || '',
          sourceUrl: r.sourceUrl || '',
          source: 'construction_news',
          relevanceScore: 0,
          matchedIcpFields: ['construction_news', category],
          notes: r.notes || `Found via construction news: "${query}"`
        }));
      } catch (e) {
        return [];
      }
    } catch (error) {
      return [];
    }
  }

  /**
   * Parse dollar values from various formats
   */
  _parseValue(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const str = String(val).replace(/[^0-9.bmkBMK]/g, '');
    let num = parseFloat(str);
    if (isNaN(num)) return 0;
    const upper = String(val).toUpperCase();
    if (upper.includes('B')) num *= 1000000000;
    else if (upper.includes('M')) num *= 1000000;
    else if (upper.includes('K')) num *= 1000;
    return num;
  }

  _deduplicateResults(results) {
    const seen = new Set();
    return results.filter(r => {
      const key = (r.projectName + r.geography?.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = ConstructionNewsSearcher;
