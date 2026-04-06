/**
 * Email Client (Microsoft 365)
 * Wraps Outlook MCP tool calls for email pattern analysis.
 * Standalone mode uses Microsoft Graph API.
 */

const https = require('https');

class EmailClient {
  constructor(config = {}) {
    this.tenantId = config.tenantId || process.env.MS365_TENANT_ID;
    this.clientId = config.clientId || process.env.MS365_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.MS365_CLIENT_SECRET;
    this.accessToken = null;
  }

  /**
   * Authenticate with Microsoft Graph API
   */
  async authenticate() {
    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default'
    }).toString();

    return new Promise((resolve, reject) => {
      const url = new URL(tokenUrl);
      const options = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            this.accessToken = parsed.access_token;
            resolve(this.accessToken);
          } catch (e) {
            reject(new Error(`Auth failed: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Search sent emails for a specific rep
   */
  async getSentEmails(repEmail, limit = 200) {
    const endpoint = `/users/${repEmail}/mailFolders/sentitems/messages`;
    const params = `?$top=${limit}&$orderby=sentDateTime desc&$select=subject,toRecipients,sentDateTime,bodyPreview`;
    return this._graphRequest(endpoint + params);
  }

  /**
   * Analyze email patterns for ICP derivation
   * Returns structured patterns from sent emails
   */
  async analyzeEmailPatterns(repEmail, limit = 200) {
    const emails = await this.getSentEmails(repEmail, limit);
    if (!emails || !emails.value) return { patterns: [], companies: [], keywords: [] };

    const companies = new Map();
    const keywords = new Map();
    const industries = new Map();
    const projectTypes = new Map();

    // Product keywords to look for
    const productKeywords = [
      'trackout', 'speed bump', 'cable protector', 'wheel stop', 'bollard',
      'sign post', 'parking curb', 'drainage', 'spill containment', 'berm',
      'cable tower', 'cable support', 'rumble strip', 'delineator', 'barricade',
      'recycled rubber', 'thermoplastic'
    ];

    // Industry keywords
    const industryKeywords = [
      'construction', 'highway', 'DOT', 'municipal', 'parking', 'contractor',
      'utility', 'mining', 'military', 'government', 'airport', 'warehouse',
      'manufacturing', 'oil', 'gas', 'solar', 'wind', 'renewable'
    ];

    for (const email of (emails.value || [])) {
      // Extract company from recipient domain
      if (email.toRecipients) {
        for (const recipient of email.toRecipients) {
          const addr = recipient.emailAddress?.address || '';
          const domain = addr.split('@')[1];
          if (domain && !domain.includes('rubberform')) {
            const company = domain.replace(/\.(com|net|org|gov|edu)$/i, '');
            companies.set(company, (companies.get(company) || 0) + 1);
          }
        }
      }

      // Scan subject and body preview for keywords
      const text = `${email.subject || ''} ${email.bodyPreview || ''}`.toLowerCase();

      for (const kw of productKeywords) {
        if (text.includes(kw)) {
          keywords.set(kw, (keywords.get(kw) || 0) + 1);
        }
      }

      for (const kw of industryKeywords) {
        if (text.includes(kw)) {
          industries.set(kw, (industries.get(kw) || 0) + 1);
        }
      }

      // Extract project type mentions
      const projectPatterns = [
        /(?:highway|road|bridge|interchange)\s*(?:project|construction|expansion)/gi,
        /(?:parking\s*(?:lot|garage|structure))\s*(?:project|construction)/gi,
        /(?:commercial|industrial|residential)\s*(?:development|construction|project)/gi,
        /(?:DOT|department of transportation)\s*(?:project|bid|contract)/gi
      ];

      for (const pattern of projectPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          for (const match of matches) {
            const normalized = match.toLowerCase().trim();
            projectTypes.set(normalized, (projectTypes.get(normalized) || 0) + 1);
          }
        }
      }
    }

    return {
      totalEmails: (emails.value || []).length,
      topCompanies: this._sortMap(companies, 20),
      topKeywords: this._sortMap(keywords),
      topIndustries: this._sortMap(industries),
      projectTypes: this._sortMap(projectTypes),
      dateRange: {
        earliest: emails.value?.[emails.value.length - 1]?.sentDateTime,
        latest: emails.value?.[0]?.sentDateTime
      }
    };
  }

  _sortMap(map, limit = 10) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  async _graphRequest(endpoint) {
    if (!this.accessToken) await this.authenticate();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'graph.microsoft.com',
        path: `/v1.0${endpoint}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Graph API parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = EmailClient;
