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

    for (const query of queries) {
      try {
        console.log(`    [News+] ${query}`);
        const found = await this._runNewsSearch(query, category, icp, defaultStage);
        results.push(...found);
      } catch (error) {
        console.warn(`    [News+] Failed: ${error.message}`);
      }
      // Rate limit
      await new Promise(r => setTimeout(r, 800));
    }

    return results;
  }

  /**
   * Run a single news-focused web search using Claude
   */
  async _runNewsSearch(query, category, icp, defaultStage) {
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
          content: `You are a construction industry research assistant for RubberForm Recycled Products, a manufacturer of recycled rubber safety products (cable support towers, trackout mats, speed bumps, spill containment berms, wheel stops, bollards, sign bases, rubber curbs, speed cushions, delineators, etc.).

Search for: ${query}

Find REAL, CURRENT construction projects in the United States that are:
- Recently awarded or breaking ground
- In the planning/bidding phase
- Major projects where contractors or municipalities would need safety products

For EACH project found, I need:
1. The actual project name
2. The general contractor, developer, or municipality
3. The specific location (city, state)
4. Estimated project value if mentioned
5. Any bid deadlines or construction start dates
6. The source URL where you found this

Focus on ACTIONABLE opportunities — real projects with real companies or agencies we can contact.

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
        return (Array.isArray(parsed) ? parsed : []).map(r => {
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
          // Classify lifecycle stage
          result.lifecycleStage = ConstructionNewsExpanded.classifyLifecycleStage(result) || defaultStage;
          return result;
        });
      } catch (e) {
        return [];
      }
    } catch (error) {
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
      const key = (r.projectName + r.geography?.state).toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
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

  // ── Contractor Discovery (secondary search for bid winners) ──

  async searchContractor(project) {
    try {
      const location = [project.city, project.state].filter(Boolean).join(', ');
      const sourceUrl = project.sourceUrl || '';
      const owner = project.owner || 'Unknown';
      const gc = project.generalContractor || '';

      // Two-step approach:
      // Step 1: Read the original source article to extract company names and clues
      // Step 2: Use those clues to search for more info on the companies found
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
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
${sourceUrl ? `- Original article: ${sourceUrl}` : ''}

STEP 1: ${sourceUrl ? `First, read the original article at ${sourceUrl}. Look for:` : 'Search for this project and look for:'}
- General contractor (GC) name
- Subcontractors mentioned
- Developer or owner company
- Architecture/engineering firm
- Any company names, especially those doing site work, paving, concrete, safety, or infrastructure

STEP 2: Once you have company names from the article, search for each one to find:
- Their company website
- Phone number or contact info
- What they specialize in

STEP 3: Also try searching for:
- "${project.projectName}" contractor
- "${project.projectName}" bid award
- Any local construction news about this project with additional company names

Be thorough. The companies involved in construction projects are who we sell safety products to (wheel stops, speed bumps, cable support towers, trackout mats, spill containment, etc).

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
