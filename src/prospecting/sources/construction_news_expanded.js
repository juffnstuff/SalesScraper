/**
 * Construction News Expanded Searcher
 * Extends construction news coverage with 6 additional categories
 * covering the full RubberForm product lifecycle:
 *   - Construction starts → trackout mats, cable towers, trench guards
 *   - Parking & industrial → wheel stops, sign bases, bollards, speed bumps
 *   - Municipal traffic calming → speed cushions, rubber curbs, delineators
 *
 * Also exports a static lifecycle classifier used by the heatmap data API.
 */

const Anthropic = require('@anthropic-ai/sdk');

// RubberForm's 4 market verticals — keyword classification
const LIFECYCLE_KEYWORDS = {
  municipal: [
    'traffic calming', 'speed cushion', 'speed table', 'vision zero', 'safe streets',
    'complete streets', 'safe routes', 'bike lane', 'bus lane', 'roundabout',
    'mini roundabout', 'school zone', 'pedestrian safety', 'crosswalk',
    'speed reduction', 'road diet', 'protected intersection', 'curb extension',
    'city council', 'neighborhood safety', 'traffic study', 'bicycle',
    'municipal', 'traffic safety', 'speed limit', 'speed hump',
    'traffic island', 'delineator', 'meridian'
  ],
  parking: [
    'parking', 'parking garage', 'parking lot', 'parking deck', 'parking structure',
    'parking facility', 'wheel stop', 'sign base', 'bollard', 'cart corral',
    'speed bump', 'resurfacing', 'repaving', 'striping', 'pavement marking',
    'shopping center', 'strip mall', 'retail center', 'mixed-use',
    'hotel', 'office building', 'property management', 'commercial development',
    'airport parking', 'asphalt'
  ],
  industrial: [
    'data center', 'cable support', 'cord tree', 'spill containment', 'osha',
    'industrial plant', 'power plant', 'substation', 'utility', 'solar farm',
    'battery', 'gigafactory', 'semiconductor', 'fab ', 'ev charging',
    'renewable energy', 'rooftop', 'chemical plant', 'refinery', 'oil gas',
    'manufacturing', 'warehouse', 'distribution center', 'logistics',
    'cold storage', 'fulfillment center', 'wind farm', 'transmission line',
    'campus', 'hospital', 'medical center', 'university'
  ],
  construction: [
    'construction entrance', 'trackout', 'sediment control', 'erosion control',
    'stormwater', 'npdes', 'site preparation', 'earthwork', 'grading',
    'highway', 'bridge', 'road construction', 'groundbreaking', 'breaking ground',
    'construction start', 'awarded contractor', 'general contractor',
    'foundation', 'excavation', 'waterline', 'water main', 'sewer',
    'pipeline', 'infrastructure', 'dot ', 'site work', 'paving'
  ]
};

class ConstructionNewsExpanded {
  constructor() {
    this.anthropic = new Anthropic();
  }

  /**
   * Classify a project result into a lifecycle stage.
   * Exported as static so the heatmap API can reuse it.
   */
  static classifyLifecycleStage(result) {
    const text = [
      result.projectName || '',
      result.projectType || '',
      result.notes || '',
      result.owner || '',
      result.generalContractor || ''
    ].join(' ').toLowerCase();

    // Check most specific first, broadest last
    for (const kw of LIFECYCLE_KEYWORDS.municipal) {
      if (text.includes(kw)) return 'municipal';
    }
    for (const kw of LIFECYCLE_KEYWORDS.parking) {
      if (text.includes(kw)) return 'parking';
    }
    for (const kw of LIFECYCLE_KEYWORDS.industrial) {
      if (text.includes(kw)) return 'industrial';
    }
    for (const kw of LIFECYCLE_KEYWORDS.construction) {
      if (text.includes(kw)) return 'construction';
    }
    return 'construction';
  }

  /**
   * Search all expanded categories for construction news
   */
  async search(icp) {
    const results = [];

    // Category 1: Parking lot & garage construction
    const parkingResults = await this._searchCategory(
      'parking construction',
      [
        'parking garage construction groundbreaking 2026',
        'parking lot resurfacing paving project awarded 2026',
        'new parking structure construction start',
        'municipal parking facility construction bid',
        'commercial parking lot construction contractor awarded',
        'parking deck expansion project breaking ground'
      ],
      icp,
      'parking_industrial'
    );
    results.push(...parkingResults);

    // Category 2: Municipal traffic calming / Vision Zero
    const municipalResults = await this._searchCategory(
      'municipal traffic calming',
      [
        'Vision Zero traffic calming project 2026 city',
        'speed cushion speed hump installation project municipal',
        'school zone safety improvement construction 2026',
        'complete streets project construction awarded',
        'pedestrian safety improvement project bid 2026',
        'traffic calming neighborhood speed reduction project'
      ],
      icp,
      'municipal'
    );
    results.push(...municipalResults);

    // Category 3: Warehouse & logistics centers
    const warehouseResults = await this._searchCategory(
      'warehouse construction',
      [
        'Amazon distribution center construction groundbreaking 2026',
        'warehouse logistics facility construction awarded',
        'FedEx UPS distribution hub construction start 2026',
        'cold storage warehouse construction breaking ground',
        'fulfillment center construction project awarded contractor',
        'industrial warehouse development construction 2026'
      ],
      icp,
      'construction'
    );
    results.push(...warehouseResults);

    // Category 4: Retail & commercial development
    const retailResults = await this._searchCategory(
      'commercial development',
      [
        'shopping center construction groundbreaking 2026',
        'mixed-use development construction start 2026',
        'hotel construction project breaking ground',
        'retail center development construction awarded',
        'commercial office building construction 2026 contractor'
      ],
      icp,
      'parking_industrial'
    );
    results.push(...retailResults);

    // Category 5: University & hospital campus
    const campusResults = await this._searchCategory(
      'campus construction',
      [
        'university campus construction project 2026',
        'hospital medical center expansion construction awarded',
        'college dormitory construction groundbreaking',
        'medical campus construction breaking ground 2026',
        'university research building construction start'
      ],
      icp,
      'construction'
    );
    results.push(...campusResults);

    // Category 6: Renewable energy & EV infrastructure
    const energyResults = await this._searchCategory(
      'energy infrastructure',
      [
        'EV charging station construction project 2026',
        'battery manufacturing plant construction groundbreaking',
        'solar farm construction awarded contractor 2026',
        'electric vehicle infrastructure construction project',
        'battery gigafactory construction breaking ground'
      ],
      icp,
      'construction'
    );
    results.push(...energyResults);

    return this._deduplicateResults(results);
  }

  /**
   * Search a category of construction news
   */
  async _searchCategory(category, queries, icp, defaultStage) {
    const results = [];
    let errors = 0;

    for (const query of queries) {
      try {
        console.log(`    [News+] ${query}`);
        const found = await this._runNewsSearch(query, category, icp, defaultStage);
        console.log(`    [News+] → ${found.length} projects found`);
        results.push(...found);
      } catch (error) {
        errors++;
        console.warn(`    [News+] Failed: ${error.message}`);
      }
      // Rate limit
      await new Promise(r => setTimeout(r, 800));
    }

    console.log(`    [News+] ${category}: ${results.length} results, ${errors} errors from ${queries.length} queries`);
    return results;
  }

  /**
   * Run a single news-focused web search using Claude
   */
  async _runNewsSearch(query, category, icp, defaultStage) {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5
        }],
        messages: [{
          role: 'user',
          content: `You are a construction industry research assistant for RubberForm Recycled Products, a manufacturer of recycled rubber safety products (cable support towers, trackout mats, speed bumps, spill containment berms, wheel stops, bollards, sign bases, rubber curbs, speed cushions, delineators, etc.).

Today is ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Search ID: ${Date.now().toString(36)}.

Search for: ${query}

Find REAL, CURRENT construction projects in the United States that are:
- Recently awarded or breaking ground (especially in the last 30-60 days)
- In the planning/bidding phase
- Major projects where contractors or municipalities would need safety products
- Try to find projects you haven't returned before — look for DIFFERENT results each time

For EACH project found, I need:
1. The actual project name
2. The general contractor, developer, or municipality
3. The specific location (city, state)
4. Estimated project value if mentioned
5. Any bid deadlines or construction start dates
6. The source URL where you found this

Focus on ACTIONABLE opportunities — real projects with real companies or agencies we can contact.

IMPORTANT: Return as many distinct projects as you can find (aim for 5-10+ per search). Use all your web_search calls to find different projects, not just details about one.

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

      let text = textBlock.text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      try {
        const parsed = JSON.parse(text);
        const results = (Array.isArray(parsed) ? parsed : []).map(r => {
          const result = {
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
            source: 'construction_news_expanded',
            relevanceScore: 0,
            matchedIcpFields: ['construction_news_expanded', category],
            notes: r.notes || `Found via expanded news: "${query}"`
          };
          result.lifecycleStage = ConstructionNewsExpanded.classifyLifecycleStage(result) || defaultStage;
          return result;
        });
        return results;
      } catch (e) {
        console.warn(`    [News+] JSON parse failed: ${text.substring(0, 100)}...`);
        return [];
      }
    } catch (error) {
      console.error(`    [News+] API error: ${error.message}`);
      return [];
    }
  }

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
      const key = (r.projectName + r.geography?.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Regional Search (state-by-state via region batching) ──

  static REGIONS = {
    'Northeast': ['CT','ME','MA','NH','RI','VT','NJ','NY','PA'],
    'Southeast': ['AL','FL','GA','KY','MS','NC','SC','TN','VA','WV'],
    'Midwest-East': ['IL','IN','MI','OH','WI'],
    'Midwest-West': ['IA','KS','MN','MO','NE','ND','SD'],
    'South-Central': ['AR','LA','OK','TX'],
    'Mountain': ['AZ','CO','ID','MT','NV','NM','UT','WY'],
    'Pacific': ['CA','OR','WA','HI','AK'],
    'Mid-Atlantic': ['DC','DE','MD']
  };

  _buildRegionalQuery(vertical, stateList) {
    const year = new Date().getFullYear();
    const queries = {
      parking: `parking garage parking lot construction project awarded ${year} in ${stateList}`,
      industrial: `data center warehouse industrial plant construction groundbreaking ${year} in ${stateList}`,
      municipal: `traffic calming Vision Zero speed cushion bike lane project ${year} in ${stateList}`,
      construction: `highway bridge road construction project awarded contractor ${year} in ${stateList}`
    };
    return queries[vertical] || `construction project ${year} in ${stateList}`;
  }

  /**
   * Run a single regional query (one region + one vertical).
   * Returns raw results (not deduped against cache).
   */
  async searchSingleRegion(regionName, vertical) {
    const states = ConstructionNewsExpanded.REGIONS[regionName];
    if (!states) return [];
    const stateList = states.join(', ');
    const query = this._buildRegionalQuery(vertical, stateList);

    try {
      console.log(`    [News+Regional] ${regionName} / ${vertical}`);
      const found = await this._runNewsSearch(query, vertical, {}, vertical);
      console.log(`    [News+Regional] ${regionName}/${vertical} → ${found.length} results`);
      return found;
    } catch (error) {
      console.warn(`    [News+Regional] ${regionName}/${vertical} failed: ${error.message}`);
      return [];
    }
  }

  async searchByRegion(options = {}) {
    const regionNames = options.regions || Object.keys(ConstructionNewsExpanded.REGIONS);
    const verticals = options.verticals || ['parking', 'municipal', 'industrial', 'construction'];
    const results = [];

    for (const regionName of regionNames) {
      const states = ConstructionNewsExpanded.REGIONS[regionName];
      if (!states) continue;
      const stateList = states.join(', ');

      for (const vertical of verticals) {
        const query = this._buildRegionalQuery(vertical, stateList);
        try {
          console.log(`    [News+Regional] ${regionName} / ${vertical}`);
          const found = await this._runNewsSearch(query, vertical, {}, vertical);
          results.push(...found);
        } catch (error) {
          console.warn(`    [News+Regional] ${regionName}/${vertical} failed: ${error.message}`);
        }
        await new Promise(r => setTimeout(r, 800));
      }
    }

    return this._deduplicateResults(results);
  }

  // ── Article Fetcher (pre-fetch source article for Claude) ──

  async _fetchArticleText(url) {
    if (!url) return '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RubberForm-Bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        redirect: 'follow'
      });
      clearTimeout(timeout);
      if (!resp.ok) return '';
      const html = await resp.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      return text.substring(0, 6000);
    } catch {
      return '';
    }
  }

  // ── Contractor Discovery (secondary search for bid winners) ──

  async searchContractor(project) {
    try {
      const location = [project.city, project.state].filter(Boolean).join(', ');
      const sourceUrl = project.sourceUrl || '';
      const owner = project.owner || 'Unknown';
      const gc = project.generalContractor || '';

      // Pre-fetch the source article so Claude has the full text
      const articleText = await this._fetchArticleText(sourceUrl);
      if (articleText) {
        console.log(`    [Contractor] Fetched article (${articleText.length} chars) from ${sourceUrl}`);
      } else if (sourceUrl) {
        console.log(`    [Contractor] Could not fetch article from ${sourceUrl}, will search from scratch`);
      }

      // Build the prompt — include article text if we got it
      const articleSection = articleText
        ? `\nSOURCE ARTICLE CONTENT (extracted from ${sourceUrl}):\n---\n${articleText}\n---\n\nRead the article above carefully. Extract EVERY company, contractor, developer, engineer, architect, and firm mentioned by name. Then use web_search to find their website and phone number.`
        : sourceUrl
          ? `\nWe could not fetch the original article at ${sourceUrl}. Search for this project to find companies involved.`
          : '\nNo source article available. Search for this project to find companies involved.';

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5
        }],
        messages: [{
          role: 'user',
          content: `You are researching a construction project to find every company involved. Your goal is to identify the contractors, developers, engineers, and architects so a building products manufacturer can market to them.

PROJECT INFO:
- Name: ${project.projectName}
- Location: ${location}
- Owner/Developer: ${owner}
- General Contractor: ${gc || 'Unknown'}
- Type: ${project.projectType || 'Construction'}
${articleSection}

INSTRUCTIONS:
1. Extract all company names from the article text above (if provided). Look for:
   - General contractor (GC)
   - Subcontractors
   - Developer or owner company
   - Architecture/engineering firm
   - Any company doing site work, paving, concrete, safety, or infrastructure
2. For each company found, search the web for their website and phone number
3. Also search for additional companies not in the article:
   - "${project.projectName}" contractor awarded
   - "${project.projectName}" bid award ${location}
4. Include companies already known (owner: ${owner}${gc ? `, GC: ${gc}` : ''}) — search for their contact info too

Be thorough. These companies are who we sell recycled rubber safety products to (wheel stops, speed bumps, cable support towers, trackout mats, spill containment, bollards, sign bases, etc).

Return a JSON array of ALL companies found:
[{
  "name": "Company Name",
  "role": "General Contractor|Subcontractor|Developer|Engineer|Architect|Owner",
  "specialty": "what they do (e.g. earthwork, paving, electrical, site prep)",
  "website": "https://...",
  "phone": "xxx-xxx-xxxx",
  "source": "URL where you found this info"
}]

If no companies found, return []. Return ONLY the JSON array, no other text.`
        }]
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock) return [];

      let text = textBlock.text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    } catch (error) {
      console.warn(`    [Contractor] Search failed for "${project.projectName}": ${error.message}`);
      return [];
    }
  }
}

module.exports = ConstructionNewsExpanded;
