/**
 * Selling.com API Client
 * Contact enrichment and discovery via Selling.com's Web API.
 * Docs: https://www.selling.com/documentation/web-api
 *
 * Supports:
 * - Single contact enrichment
 * - Bulk contact enrichment
 * - Email verification
 * - Company contact search
 */

const https = require('https');

class SellingApiClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.SELLING_API_KEY;
    this.baseUrl = config.baseUrl || process.env.SELLING_API_BASE_URL || 'https://api.selling.com/v1';
    this.rateLimitDelay = 200; // ms between requests
    this.lastRequestTime = 0;
  }

  /**
   * Find contacts at a company matching target titles
   */
  async findContacts(companyName, state, targetTitles, limit = 3) {
    if (!this.apiKey) {
      console.warn('  Selling.com API key not configured — skipping contact enrichment');
      return [];
    }

    await this._rateLimit();

    try {
      const response = await this._request('POST', '/contacts/search', {
        company: companyName,
        state: state,
        titles: targetTitles,
        limit: Math.min(limit, parseInt(process.env.MAX_CONTACTS_PER_PROJECT || '3'))
      });

      return (response.contacts || response.data || []).map(c => ({
        firstName: c.firstName || c.first_name || '',
        lastName: c.lastName || c.last_name || '',
        email: c.email || '',
        phone: c.phone || c.directPhone || c.direct_phone || '',
        title: c.title || c.jobTitle || c.job_title || '',
        company: c.company || companyName,
        linkedIn: c.linkedIn || c.linkedin_url || '',
        state: c.state || state,
        confidence: c.confidence || c.score || 0,
        source: 'selling.com'
      }));
    } catch (error) {
      console.warn(`  Selling.com lookup failed for "${companyName}": ${error.message}`);
      return [];
    }
  }

  /**
   * Enrich a single contact with additional data
   */
  async enrichContact(email) {
    if (!this.apiKey) return null;

    await this._rateLimit();

    try {
      const response = await this._request('POST', '/contacts/enrich', { email });
      return response;
    } catch (error) {
      console.warn(`  Contact enrichment failed for ${email}: ${error.message}`);
      return null;
    }
  }

  /**
   * Verify an email address
   */
  async verifyEmail(email) {
    if (!this.apiKey) return { valid: false, reason: 'API key not configured' };

    await this._rateLimit();

    try {
      const response = await this._request('POST', '/email/verify', { email });
      return {
        valid: response.valid || response.is_valid || false,
        reason: response.reason || response.status || 'unknown'
      };
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Bulk contact search for multiple companies
   */
  async bulkSearch(companies) {
    if (!this.apiKey) return {};

    const results = {};
    for (const { companyName, state, titles } of companies) {
      const contacts = await this.findContacts(companyName, state, titles);
      if (contacts.length > 0) {
        results[companyName] = contacts;
      }
    }
    return results;
  }

  /**
   * Find contacts for a project opportunity
   * Searches owner, GC, and relevant subs
   */
  async findContactsForProject(project, icp) {
    const contacts = [];
    const targetTitles = icp.buyerTitles || [
      'project manager', 'procurement manager', 'site superintendent',
      'safety director', 'purchasing agent'
    ];
    const state = project.geography?.state || '';

    // Search owner organization
    if (project.owner) {
      const ownerContacts = await this.findContacts(project.owner, state, targetTitles);
      contacts.push(...ownerContacts.map(c => ({ ...c, role: 'owner' })));
    }

    // Search general contractor
    if (project.generalContractor) {
      const gcContacts = await this.findContacts(project.generalContractor, state, targetTitles);
      contacts.push(...gcContacts.map(c => ({ ...c, role: 'general_contractor' })));
    }

    return contacts;
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitDelay) {
      await new Promise(r => setTimeout(r, this.rateLimitDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async _request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.baseUrl + endpoint);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429) {
            // Rate limited — retry after delay
            const retryAfter = parseInt(res.headers['retry-after'] || '5') * 1000;
            setTimeout(() => {
              this._request(method, endpoint, body).then(resolve).catch(reject);
            }, retryAfter);
            return;
          }

          if (res.statusCode >= 400) {
            reject(new Error(`Selling.com API error ${res.statusCode}: ${data}`));
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

module.exports = SellingApiClient;
