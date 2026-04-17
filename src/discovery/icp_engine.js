/**
 * ICP Engine
 * Derives per-rep Ideal Customer Profiles from NetSuite + Email data.
 * Uses Claude to synthesize patterns into structured ICPs.
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const NetSuiteClient = require('./netsuite_client');
const EmailClient = require('./email_client');

const ICP_DIR = path.join(__dirname, '../../config/icps');
const ICP_MAX_AGE_DAYS = 30;

class ICPEngine {
  constructor() {
    this.anthropic = new Anthropic();
    this.netsuite = new NetSuiteClient();
    this.email = new EmailClient();
  }

  /**
   * Get or generate ICP for a rep. Uses cache unless forced refresh.
   */
  async getICP(rep, forceRefresh = false) {
    const icpPath = path.join(ICP_DIR, `${rep.id}_icp.json`);

    if (!forceRefresh && fs.existsSync(icpPath)) {
      const stat = fs.statSync(icpPath);
      const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays < ICP_MAX_AGE_DAYS) {
        return JSON.parse(fs.readFileSync(icpPath, 'utf8'));
      }
    }

    const icp = await this.deriveICP(rep);
    fs.mkdirSync(ICP_DIR, { recursive: true });
    fs.writeFileSync(icpPath, JSON.stringify(icp, null, 2));
    return icp;
  }

  /**
   * Derive a fresh ICP from NetSuite + email data
   */
  async deriveICP(rep) {
    console.log(`  Gathering NetSuite signals for ${rep.name}...`);
    const netsuiteSignals = await this._gatherNetSuiteSignals(rep);

    console.log(`  Analyzing email patterns for ${rep.name}...`);
    const emailPatterns = await this._gatherEmailPatterns(rep);

    console.log(`  Synthesizing ICP with Claude for ${rep.name}...`);
    const icp = await this._synthesizeICP(rep, netsuiteSignals, emailPatterns);

    return {
      repId: rep.id,
      repName: rep.name,
      generatedAt: new Date().toISOString(),
      ...icp
    };
  }

  async _gatherNetSuiteSignals(rep) {
    try {
      const [categories, products, geographies, dealSize, lostQuotes] = await Promise.all([
        this.netsuite.getCustomerCategories(rep.netsuiteId),
        this.netsuite.getTopProducts(rep.netsuiteId),
        this.netsuite.getTopGeographies(rep.netsuiteId),
        this.netsuite.getDealSizeStats(rep.netsuiteId),
        this.netsuite.getLostQuotes(rep.netsuiteId)
      ]);

      return { categories, products, geographies, dealSize, lostQuotes };
    } catch (error) {
      console.warn(`  Warning: NetSuite query failed for ${rep.name}: ${error.message}`);
      return { categories: [], products: [], geographies: [], dealSize: [], lostQuotes: [] };
    }
  }

  async _gatherEmailPatterns(rep) {
    try {
      return await this.email.analyzeEmailPatterns(rep.email);
    } catch (error) {
      console.warn(`  Warning: Email analysis failed for ${rep.name}: ${error.message}`);
      return { patterns: [], companies: [], keywords: [] };
    }
  }

  async _synthesizeICP(rep, netsuiteSignals, emailPatterns) {
    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are a B2B sales analyst for RubberForm Recycled Products, a Buffalo, NY manufacturer of recycled rubber and thermoplastic safety products.
Products include: trackout/construction entrance mats, speed bumps/humps, cable protectors, wheel stops, bollards, sign post bases, parking curbs, drainage products, spill containment berms, portable electric cable support towers, rumble strips, delineators, and custom molded rubber/thermoplastic safety items.
Markets: construction, parking, municipal, DOT/highway, utility, industrial, military.
Analyze the provided sales data and email patterns to produce a structured ICP.
Return ONLY valid JSON, no markdown.`,
      messages: [{
        role: 'user',
        content: `Sales rep: ${rep.name} (${rep.title}, territory: ${rep.territory})
NetSuite signals (last 12 months): ${JSON.stringify(netsuiteSignals, null, 2)}
Email patterns: ${JSON.stringify(emailPatterns, null, 2)}

Return a JSON ICP object with these fields:
{
  "companyTypes": ["e.g. general contractor", "municipality", "parking lot operator"],
  "projectTypes": ["e.g. highway construction", "commercial development", "DOT project"],
  "geographies": ["top 5 states by revenue"],
  "dealSizeRange": { "min": 0, "max": 0, "sweet_spot": 0 },
  "buyerTitles": ["e.g. project manager", "site superintendent", "procurement officer"],
  "triggerKeywords": ["words/phrases that predict a sale for this rep"],
  "productAffinities": ["top products this rep sells most"],
  "naicsCodes": ["relevant NAICS codes"],
  "bidSources": ["recommend which bid databases to prioritize for this rep"],
  "searchQueries": ["5-10 specific web search queries to find prospects matching this ICP"]
}`
      }]
    });

    try {
      const block = (message.content || []).find(b => b && b.type === 'text');
      if (!block || typeof block.text !== 'string') {
        throw new Error('no text block in Claude response');
      }
      let text = block.text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('ICP response was not a JSON object');
      }
      return parsed;
    } catch (e) {
      console.error(`  Failed to parse ICP response: ${e.message}`);
      return this._fallbackICP(rep);
    }
  }

  _fallbackICP(rep) {
    return {
      companyTypes: ['general contractor', 'municipality', 'utility company', 'parking operator'],
      projectTypes: ['highway construction', 'commercial development', 'municipal infrastructure'],
      geographies: ['NY', 'PA', 'OH', 'TX', 'FL'],
      dealSizeRange: { min: 500, max: 50000, sweet_spot: 5000 },
      buyerTitles: ['project manager', 'procurement manager', 'site superintendent', 'safety director'],
      triggerKeywords: ['construction', 'bid', 'RFP', 'safety', 'trackout', 'cable protection'],
      productAffinities: ['trackout mats', 'cable protectors', 'speed bumps', 'wheel stops'],
      naicsCodes: ['237310', '237110', '237990', '236220'],
      bidSources: ['sam.gov', 'state DOT portals', 'bidnet.com', 'constructconnect.com'],
      searchQueries: [
        `"construction entrance" trackout mat bid ${new Date().getFullYear()}`,
        `highway construction safety products RFP`,
        `parking lot construction bid ${rep.territory || 'USA'}`
      ]
    };
  }
}

module.exports = ICPEngine;
