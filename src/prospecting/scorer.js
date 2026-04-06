/**
 * Relevance Scorer
 * Uses Claude to score project opportunities against a rep's ICP.
 * Includes both heuristic pre-scoring and AI-powered deep scoring.
 */

const Anthropic = require('@anthropic-ai/sdk');

class Scorer {
  constructor() {
    this.anthropic = new Anthropic();
  }

  /**
   * Score all results against an ICP
   * Uses heuristic pre-filter + Claude for top candidates
   */
  async scoreResults(results, icp) {
    // Phase 1: Quick heuristic pre-score to filter obvious misses
    const preScored = results.map(r => ({
      ...r,
      relevanceScore: this._heuristicScore(r, icp)
    }));

    // Only send results scoring ≥30 to Claude (save API calls)
    const candidates = preScored.filter(r => r.relevanceScore >= 30);
    const rejected = preScored.filter(r => r.relevanceScore < 30);

    if (candidates.length === 0) return preScored;

    // Phase 2: AI-powered scoring in batches of 5
    const batchSize = 5;
    const scored = [];

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      try {
        const batchScored = await this._aiScoreBatch(batch, icp);
        scored.push(...batchScored);
      } catch (error) {
        console.warn(`  AI scoring batch failed: ${error.message}`);
        scored.push(...batch); // Keep heuristic scores on failure
      }

      // Rate limiting
      if (i + batchSize < candidates.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return [...scored, ...rejected];
  }

  /**
   * Quick heuristic scoring (0-100) based on field matching
   */
  _heuristicScore(result, icp) {
    let score = 0;

    // Geography match (25 points)
    const resultState = (result.geography?.state || '').toUpperCase();
    if ((icp.geographies || []).map(s => s.toUpperCase()).includes(resultState)) {
      score += 25;
    }

    // Project type match (20 points)
    const projectLower = (result.projectType || '').toLowerCase();
    const projectName = (result.projectName || '').toLowerCase();
    for (const pt of (icp.projectTypes || [])) {
      if (projectLower.includes(pt.toLowerCase()) || projectName.includes(pt.toLowerCase())) {
        score += 20;
        break;
      }
    }

    // Keyword match (20 points, 5 per keyword up to 4)
    const fullText = `${result.projectName} ${result.notes} ${result.projectType}`.toLowerCase();
    let keywordHits = 0;
    for (const kw of (icp.triggerKeywords || [])) {
      if (fullText.includes(kw.toLowerCase())) {
        keywordHits++;
        if (keywordHits >= 4) break;
      }
    }
    score += keywordHits * 5;

    // Has bid date (10 points) — actionable timing
    if (result.bidDate) {
      score += 10;
      // Bonus: bid date in the future (5 points)
      const bidDate = new Date(result.bidDate);
      if (bidDate > new Date()) score += 5;
    }

    // Has estimated value in sweet spot (10 points)
    if (result.estimatedValue > 0 && icp.dealSizeRange) {
      const { min, max } = icp.dealSizeRange;
      if (result.estimatedValue >= min && result.estimatedValue <= max) {
        score += 10;
      }
    }

    // Has owner/GC info (5 points) — contact enrichment possible
    if (result.owner || result.generalContractor) {
      score += 5;
    }

    // NAICS code match (5 points)
    if (result.naicsCode && (icp.naicsCodes || []).includes(result.naicsCode)) {
      score += 5;
    }

    return Math.min(score, 100);
  }

  /**
   * AI-powered deep scoring using Claude
   */
  async _aiScoreBatch(projects, icp) {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are a B2B sales scoring engine for RubberForm Recycled Products (recycled rubber safety products for construction/parking/municipal markets).
Score each project opportunity against the provided ICP on a scale of 0-100.
Consider: geography match, project type relevance, potential product needs, deal timing, and buyer accessibility.
Return ONLY a JSON array of objects with: { "index": 0, "score": 0, "reasoning": "...", "matchedFields": [] }`,
      messages: [{
        role: 'user',
        content: `ICP: ${JSON.stringify(icp, null, 2)}

Projects to score:
${projects.map((p, i) => `[${i}] ${JSON.stringify(p)}`).join('\n\n')}

Score each project 0-100 and explain why. Return JSON array only.`
      }]
    });

    try {
      const text = response.content[0].text;
      const scores = JSON.parse(text);

      return projects.map((project, i) => {
        const scoreData = scores.find(s => s.index === i) || {};
        return {
          ...project,
          relevanceScore: scoreData.score || project.relevanceScore,
          matchedIcpFields: scoreData.matchedFields || project.matchedIcpFields,
          scoringReasoning: scoreData.reasoning || ''
        };
      });
    } catch (e) {
      console.warn(`  Failed to parse AI scores: ${e.message}`);
      return projects;
    }
  }
}

module.exports = Scorer;
