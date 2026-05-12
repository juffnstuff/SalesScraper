/**
 * Apollo.io API Client
 * Contact + company enrichment via Apollo's public REST API.
 * Docs: https://docs.apollo.io/reference
 *
 * Endpoints used:
 *   POST /mixed_people/search          findContacts(company, titles, location)
 *   POST /people/match                 enrichContact({ first_name, last_name, ... })
 *   POST /people/bulk_match            bulkEnrichContacts(records)           (≤10 per call)
 *   GET  /organizations/enrich         enrichCompany({ domain })
 *   POST /organizations/bulk_enrich    bulkEnrichCompanies(domains)
 *
 * IMPORTANT: Apollo's free tier obfuscates emails as `email_not_unlocked@domain.com`
 * until you "unlock" via a paid plan or by calling /people/match with
 * `reveal_personal_emails: true` (costs credits). The client strips obfuscated
 * emails to '' so callers don't store them.
 *
 * Verify endpoint paths against current docs.apollo.io before production use —
 * Apollo's surface has shifted between v1 and the newer `/api/v1` prefix.
 */

const https = require('https');

const DEFAULT_BASE_URL = 'https://api.apollo.io/api/v1';
const OBFUSCATED_EMAIL_PATTERNS = [
  'email_not_unlocked',
  'not_unlocked@',
  'domain.com',
];

class ApolloClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.APOLLO_API_KEY;
    this.baseUrl = (config.baseUrl || process.env.APOLLO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rateLimitDelay = config.rateLimitDelay ?? 250;
    this.maxRetries = config.maxRetries ?? 3;
    this.revealPersonalEmails = config.revealPersonalEmails ?? (process.env.APOLLO_REVEAL_PERSONAL_EMAILS === 'true');
    this.lastRequestTime = 0;
  }

  hasKey() {
    return !!this.apiKey;
  }

  // ---------- Title-based contact discovery ----------

  /**
   * Find contacts at a company matching target titles. Apollo supports this
   * natively via /mixed_people/search.
   *
   * Returns the normalized contact shape that prospect.js and web/server.js
   * already expect: { firstName, lastName, email, phone, title, company,
   * linkedIn, state, confidence, source, providerPersonId }.
   */
  async findContacts(companyName, state, targetTitles, limit) {
    if (!this.apiKey) {
      console.warn('  Apollo API key not configured — skipping contact search');
      return [];
    }
    if (!companyName) return [];

    const perPage = Math.min(
      limit ?? parseInt(process.env.MAX_CONTACTS_PER_PROJECT || '3', 10),
      25
    );

    const body = {
      page: 1,
      per_page: perPage,
      organization_names: [companyName],
    };
    if (Array.isArray(targetTitles) && targetTitles.length > 0) {
      body.person_titles = targetTitles;
    }
    if (state) {
      body.person_locations = [`${state}, US`];
    }

    try {
      const res = await this._request('POST', '/mixed_people/search', body);
      const people = res.people || [];
      return people.map(p => this._normalizePerson(p, companyName, state));
    } catch (e) {
      console.warn(`  Apollo lookup failed for "${companyName}": ${e.message}`);
      return [];
    }
  }

  /**
   * Find contacts for a project opportunity — owner + general contractor.
   * Matches the call shape prospect.js:157 expects.
   */
  async findContactsForProject(project, icp) {
    if (!this.apiKey) return [];

    const targetTitles = (icp && icp.buyerTitles) || [
      'project manager', 'procurement manager', 'site superintendent',
      'safety director', 'purchasing agent'
    ];
    const state = project?.geography?.state || '';
    const contacts = [];

    if (project?.owner) {
      const ownerContacts = await this.findContacts(project.owner, state, targetTitles);
      contacts.push(...ownerContacts.map(c => ({ ...c, role: 'owner' })));
    }
    if (project?.generalContractor) {
      const gcContacts = await this.findContacts(project.generalContractor, state, targetTitles);
      contacts.push(...gcContacts.map(c => ({ ...c, role: 'general_contractor' })));
    }
    return contacts;
  }

  // ---------- Single enrichment ----------

  /**
   * Enrich a single known contact. Caller supplies at least one of:
   * email | linkedin_url | (first_name + last_name + organization_name).
   * Returns the raw `{ person }` response or null.
   */
  async enrichContact(input) {
    if (!this.apiKey) {
      console.warn('  Apollo API key not configured — skipping contact enrichment');
      return null;
    }
    if (!input || !hasContactIdentifier(input)) {
      throw new Error(
        'enrichContact: requires email, linkedin_url, or ' +
        'first_name+last_name+organization_name'
      );
    }
    const body = {
      ...input,
      reveal_personal_emails: input.reveal_personal_emails ?? this.revealPersonalEmails,
    };
    return this._request('POST', '/people/match', body);
  }

  /**
   * Enrich a single company by domain. Apollo's endpoint is GET with a
   * `domain` query param.
   */
  async enrichCompany(input) {
    if (!this.apiKey) {
      console.warn('  Apollo API key not configured — skipping company enrichment');
      return null;
    }
    if (!input || !input.domain) {
      throw new Error('enrichCompany: requires { domain }');
    }
    const path = `/organizations/enrich?domain=${encodeURIComponent(input.domain)}`;
    return this._request('GET', path, null);
  }

  /**
   * Email "verification" via Apollo: Apollo doesn't expose a standalone email
   * verification endpoint, but /people/match returns an `email_status` field
   * (`verified` | `guessed` | `unavailable` | `bounced` | etc.) which is what
   * callers actually want. Normalize that into the same shape Selling.com
   * returns so the call site can be provider-agnostic.
   */
  async verifyEmail(email) {
    if (!this.apiKey) return null;
    if (!email) throw new Error('verifyEmail: email is required');

    const res = await this.enrichContact({ email });
    const status = res?.person?.email_status;
    const map = {
      verified: 'valid',
      bounced: 'invalid',
      unavailable: 'invalid',
      guessed: 'unknown',
      pending_manual_fulfillment: 'unknown',
    };
    return {
      email,
      status: map[status] || 'unknown',
      raw_status: status || null,
      provider: 'apollo',
    };
  }

  // ---------- Bulk enrichment (synchronous, ≤10 records) ----------

  async bulkEnrichContacts(records, opts = {}) {
    if (!this.apiKey) return null;
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('bulkEnrichContacts: records array is required');
    }
    if (records.length > 10) {
      throw new Error('bulkEnrichContacts: Apollo limits bulk_match to 10 records per call');
    }
    return this._request('POST', '/people/bulk_match', {
      details: records,
      reveal_personal_emails: opts.revealPersonalEmails ?? this.revealPersonalEmails,
    });
  }

  async bulkEnrichCompanies(domains) {
    if (!this.apiKey) return null;
    if (!Array.isArray(domains) || domains.length === 0) {
      throw new Error('bulkEnrichCompanies: domains array is required');
    }
    return this._request('POST', '/organizations/bulk_enrich', { domains });
  }

  // ---------- Compat alias used elsewhere ----------

  async bulkSearch(companies) {
    if (!this.apiKey) return {};
    const results = {};
    for (const { companyName, state, titles } of companies) {
      const contacts = await this.findContacts(companyName, state, titles);
      if (contacts.length > 0) results[companyName] = contacts;
    }
    return results;
  }

  // ---------- Internals ----------

  _normalizePerson(p, fallbackCompany, fallbackState) {
    const email = cleanEmail(p.email);
    const phone = extractPhone(p);
    return {
      firstName: p.first_name || '',
      lastName: p.last_name || '',
      email,
      phone,
      title: p.title || '',
      company: p.organization?.name || fallbackCompany || '',
      linkedIn: p.linkedin_url || '',
      state: p.state || fallbackState || '',
      confidence: scoreContact(p, email),
      source: 'apollo.io',
      providerPersonId: p.id || null,
      emailStatus: p.email_status || null,
    };
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitDelay) {
      await new Promise(r => setTimeout(r, this.rateLimitDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async _request(method, endpoint, body) {
    await this._rateLimit();
    return this._requestRaw(method, endpoint, body, 0);
  }

  _requestRaw(method, endpoint, body, attempt) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.baseUrl + endpoint);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const parsed = data ? safeParse(data) : null;

          if (res.statusCode === 429 && attempt < this.maxRetries) {
            const retryAfter = parseInt(res.headers['retry-after'] || '0', 10);
            const backoff = retryAfter > 0
              ? retryAfter * 1000
              : Math.min(30000, 1000 * Math.pow(2, attempt));
            setTimeout(() => {
              this._requestRaw(method, endpoint, body, attempt + 1).then(resolve).catch(reject);
            }, backoff);
            return;
          }

          if (res.statusCode >= 500 && attempt < this.maxRetries) {
            const backoff = Math.min(30000, 1000 * Math.pow(2, attempt));
            setTimeout(() => {
              this._requestRaw(method, endpoint, body, attempt + 1).then(resolve).catch(reject);
            }, backoff);
            return;
          }

          if (res.statusCode >= 400) {
            const msg = (parsed && (parsed.error || parsed.message)) || data || `HTTP ${res.statusCode}`;
            reject(new Error(`Apollo API ${res.statusCode}: ${msg}`));
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
  if (input.email) return true;
  if (input.linkedin_url) return true;
  if (input.first_name && input.last_name && input.organization_name) return true;
  return false;
}

function cleanEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const lower = email.toLowerCase();
  if (OBFUSCATED_EMAIL_PATTERNS.some(p => lower.includes(p))) return '';
  return email;
}

function extractPhone(person) {
  const phones = person.phone_numbers || [];
  if (!phones.length) return '';
  const mobile = phones.find(p => p.type === 'mobile' || p.type === 'mobile_phone');
  const direct = phones.find(p => p.type === 'direct' || p.type === 'direct_phone');
  const pick = mobile || direct || phones[0];
  return pick.raw_number || pick.sanitized_number || '';
}

function scoreContact(person, email) {
  let score = 40;
  if (email) score += 20;
  if (person.email_status === 'verified') score += 25;
  else if (person.email_status === 'guessed') score += 5;
  if (person.linkedin_url) score += 10;
  if (person.phone_numbers && person.phone_numbers.length) score += 5;
  return Math.min(100, score);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

module.exports = ApolloClient;
