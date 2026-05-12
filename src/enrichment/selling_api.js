/**
 * Selling.com API Client
 * Contact + company enrichment and email verification via the Selling.com Web API.
 * Docs: https://www.selling.com/documentation/web-api
 * Full reference: ../../selling-com-api-reference.md
 *
 * Supported endpoints:
 *   POST /email-verification           verifyEmail(email)
 *   POST /contact                      enrichContact(input)
 *   POST /contacts                     submitBulkContacts(contacts, metadata)
 *   GET  /contacts/results/{id}.json   getBulkContactResults(jobId)
 *   POST /company                      enrichCompany(input)
 *   POST /companies                    submitBulkCompanies(companies, metadata)
 *   GET  /companies/results/{id}.json  getBulkCompanyResults(jobId)
 *
 * NOTE: Selling.com's public API enriches *known* contacts — you must supply
 * at least one of (linkedin_url | business_email | first+last+company_domain
 * | first+last+company_name). It does NOT support "find me contacts at this
 * company matching these titles." findContacts() and findContactsForProject()
 * are kept as warning shims so existing callers don't crash; the contact-
 * discovery flow needs a different data source.
 */

const https = require('https');

const DEFAULT_BASE_URL = 'https://api.selling.com';

class SellingApiClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.SELLING_API_KEY;
    this.baseUrl = (config.baseUrl || process.env.SELLING_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rateLimitDelay = config.rateLimitDelay ?? 200;
    this.maxRetries = config.maxRetries ?? 3;
    this.lastRequestTime = 0;
  }

  hasKey() {
    return !!this.apiKey;
  }

  // ---------- Email verification ----------

  /**
   * Verify a single email. Returns `{ email, status, credit_charged, remaining_credits }`
   * where status is `valid` | `invalid` | `unknown`. Returns null if no API key
   * is configured.
   */
  async verifyEmail(email) {
    if (!this.apiKey) {
      console.warn('  Selling.com API key not configured — skipping email verification');
      return null;
    }
    if (!email || typeof email !== 'string') {
      throw new Error('verifyEmail: email is required');
    }
    return this._request('POST', '/email-verification', { email });
  }

  // ---------- Single contact enrichment ----------

  /**
   * Enrich a single contact. Caller must supply at least one identifying
   * combo (see docs). Returns the raw `{ contact, remaining_credits }`
   * response. Returns null if no API key.
   *
   * @param {object} input
   * @param {string} [input.first_name]
   * @param {string} [input.last_name]
   * @param {string} [input.company_name]
   * @param {string} [input.company_domain]
   * @param {string} [input.business_email]
   * @param {string} [input.linkedin_url]
   * @param {object} [input.metadata]   e.g. { mobile_phone_enrichment: true }
   */
  async enrichContact(input) {
    if (!this.apiKey) {
      console.warn('  Selling.com API key not configured — skipping contact enrichment');
      return null;
    }
    if (!input || !hasContactIdentifier(input)) {
      throw new Error(
        'enrichContact: requires one of linkedin_url, business_email, ' +
        'or first_name+last_name+(company_domain|company_name)'
      );
    }
    return this._request('POST', '/contact', input);
  }

  // ---------- Single company enrichment ----------

  /**
   * Enrich a single company. Requires `company_name` OR `company_website`.
   * Returns `{ companies: [...], remaining_credits }`.
   *
   * @param {object} input
   * @param {string} [input.company_name]
   * @param {string} [input.company_website]
   * @param {object} [input.metadata]   e.g. { top_matches_returned: 3 }
   */
  async enrichCompany(input) {
    if (!this.apiKey) {
      console.warn('  Selling.com API key not configured — skipping company enrichment');
      return null;
    }
    if (!input || (!input.company_name && !input.company_website)) {
      throw new Error('enrichCompany: requires company_name or company_website');
    }
    return this._request('POST', '/company', input);
  }

  // ---------- Bulk contact enrichment ----------

  /**
   * Submit a bulk contact enrichment job. Returns
   * `{ job_id, download_url, expiration_date }`.
   */
  async submitBulkContacts(contacts, metadata = {}) {
    if (!this.apiKey) return null;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new Error('submitBulkContacts: contacts array is required');
    }
    return this._request('POST', '/contacts', { contacts, metadata });
  }

  /**
   * Fetch results for a bulk contact job. Returns:
   *   { ready: true,  data: { contacts: [...], remaining_credits } }   on 200
   *   { ready: false }                                                  on 202
   *   throws on 404/other errors.
   */
  async getBulkContactResults(jobId) {
    if (!this.apiKey) return null;
    return this._pollBulkResults(`/contacts/results/${encodeURIComponent(jobId)}.json`);
  }

  // ---------- Bulk company enrichment ----------

  async submitBulkCompanies(companies, metadata = {}) {
    if (!this.apiKey) return null;
    if (!Array.isArray(companies) || companies.length === 0) {
      throw new Error('submitBulkCompanies: companies array is required');
    }
    return this._request('POST', '/companies', { companies, metadata });
  }

  async getBulkCompanyResults(jobId) {
    if (!this.apiKey) return null;
    return this._pollBulkResults(`/companies/results/${encodeURIComponent(jobId)}.json`);
  }

  // ---------- Backwards-compat shims ----------

  /**
   * Deprecated. Selling.com's public API does not support title-based
   * contact discovery — you must supply a specific contact identifier.
   * Returns [] so existing callers keep working; logs once per process.
   */
  async findContacts(companyName /*, state, targetTitles, limit */) {
    warnOnce(
      'Selling.com API does not support title-based contact discovery. ' +
      'findContacts() returns []. Use enrichContact() with a known ' +
      'contact identifier, or use a different data source.'
    );
    if (companyName && this.apiKey) {
      // Best-effort: at least surface that the company exists in Selling's data.
      try { await this.enrichCompany({ company_name: companyName }); } catch (_) {}
    }
    return [];
  }

  async findContactsForProject(/* project, icp */) {
    warnOnce(
      'findContactsForProject() is unsupported by Selling.com. Returning [].'
    );
    return [];
  }

  async bulkSearch(/* companies */) {
    warnOnce('bulkSearch() is unsupported by Selling.com. Returning {}.');
    return {};
  }

  // ---------- Internals ----------

  async _pollBulkResults(path) {
    const res = await this._request('GET', path, null, { returnStatus: true });
    if (res.status === 200) return { ready: true, data: res.body };
    if (res.status === 202) return { ready: false };
    throw new Error(`Selling.com bulk results ${res.status}: ${JSON.stringify(res.body)}`);
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitDelay) {
      await new Promise(r => setTimeout(r, this.rateLimitDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async _request(method, endpoint, body, opts = {}) {
    await this._rateLimit();
    return this._requestRaw(method, endpoint, body, opts, 0);
  }

  _requestRaw(method, endpoint, body, opts, attempt) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.baseUrl + endpoint);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
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
          const parsed = data ? safeParse(data) : null;

          // 429 — honor Retry-After, exponential backoff
          if (res.statusCode === 429 && attempt < this.maxRetries) {
            const retryAfterHdr = parseInt(res.headers['retry-after'] || '0', 10);
            const backoff = retryAfterHdr > 0
              ? retryAfterHdr * 1000
              : Math.min(30000, 1000 * Math.pow(2, attempt));
            setTimeout(() => {
              this._requestRaw(method, endpoint, body, opts, attempt + 1).then(resolve).catch(reject);
            }, backoff);
            return;
          }

          // 5xx — retry with backoff
          if (res.statusCode >= 500 && attempt < this.maxRetries) {
            const backoff = Math.min(30000, 1000 * Math.pow(2, attempt));
            setTimeout(() => {
              this._requestRaw(method, endpoint, body, opts, attempt + 1).then(resolve).catch(reject);
            }, backoff);
            return;
          }

          if (opts.returnStatus) {
            resolve({ status: res.statusCode, body: parsed, headers: res.headers });
            return;
          }

          if (res.statusCode >= 400) {
            const msg = parsed && parsed.message ? parsed.message : data || `HTTP ${res.statusCode}`;
            reject(new Error(`Selling.com API ${res.statusCode}: ${msg}`));
            return;
          }

          resolve(parsed);
        });
      });

      req.on('error', reject);
      if (body !== null && body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

function hasContactIdentifier(input) {
  if (input.linkedin_url) return true;
  if (input.business_email) return true;
  if (input.first_name && input.last_name && (input.company_domain || input.company_name)) return true;
  return false;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

const _warned = new Set();
function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(`  [selling.com] ${msg}`);
}

module.exports = SellingApiClient;
