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
   * Search for net-new people via /mixed_people/api_search. Free of credits.
   *
   * The search endpoint does NOT return emails, phone numbers, or LinkedIn
   * URLs — only obfuscated last names plus `has_email` / `has_direct_phone`
   * flags. To actually contact these people, call enrichContact() or
   * bulkEnrichContacts() with each result's `providerPersonId`. Combined
   * flow is exposed as findAndEnrichContacts().
   *
   * @param {string} companyName       Used as q_keywords fallback if no domain
   * @param {string} state             Person's location (state or city)
   * @param {string[]} targetTitles    Job titles (substring-matched by default)
   * @param {number} [limit]
   * @param {object} [opts]
   * @param {string} [opts.domain]                 q_organization_domains_list[]  — preferred over name
   * @param {string[]} [opts.seniorities]          owner|founder|c_suite|partner|vp|head|director|manager|senior|entry|intern
   * @param {string[]} [opts.emailStatuses]        verified|unverified|likely to engage|unavailable (default: ['verified'])
   * @param {boolean} [opts.includeSimilarTitles]  default true
   * @param {number}   [opts.page]                 default 1
   */
  async findContacts(companyName, state, targetTitles, limit, opts = {}) {
    if (!this.apiKey) {
      console.warn('  Apollo API key not configured — skipping contact search');
      return [];
    }
    if (!companyName && !opts.domain) return [];

    const perPage = Math.min(
      limit ?? parseInt(process.env.MAX_CONTACTS_PER_PROJECT || '3', 10),
      100
    );

    const params = new URLSearchParams();
    params.append('page', String(opts.page || 1));
    params.append('per_page', String(perPage));

    if (opts.domain) {
      params.append('q_organization_domains_list[]', opts.domain);
    } else if (companyName) {
      params.append('q_keywords', companyName);
    }

    if (Array.isArray(targetTitles)) {
      for (const t of targetTitles) params.append('person_titles[]', t);
    }
    const locationParam = normalizeApolloLocation(state);
    if (locationParam) {
      params.append('person_locations[]', locationParam);
    }
    if (Array.isArray(opts.seniorities)) {
      for (const s of opts.seniorities) params.append('person_seniorities[]', s);
    }
    // Email-status filter: opt-in only. Defaulting to ['verified'] (the
    // previous behaviour) silently dropped every contact whose Apollo email
    // wasn't recently re-verified, which is most of Apollo's index for
    // small/regional firms. Set APOLLO_REQUIRE_VERIFIED_EMAIL=true or pass
    // opts.emailStatuses to re-enable filtering.
    let statuses = opts.emailStatuses;
    if (!statuses && process.env.APOLLO_REQUIRE_VERIFIED_EMAIL === 'true') {
      statuses = ['verified'];
    }
    if (Array.isArray(statuses)) {
      for (const s of statuses) params.append('contact_email_status[]', s);
    }
    if (opts.includeSimilarTitles === false) {
      params.append('include_similar_titles', 'false');
    }

    const endpoint = `/mixed_people/api_search?${params.toString()}`;

    try {
      const res = await this._request('POST', endpoint, null);
      const people = res?.people || [];
      const totalEntries = res?.pagination?.total_entries;
      console.log(`  Apollo search: company="${companyName || opts.domain}" loc="${locationParam || ''}" → ${people.length} returned${totalEntries != null ? ` (${totalEntries} total)` : ''}`);
      return people.map(p => this._normalizeSearchPerson(p, companyName, state));
    } catch (e) {
      if (/API_INACCESSIBLE/.test(e.message)) {
        console.warn('  Apollo search rejected — this endpoint requires a MASTER api key. Regenerate at app.apollo.io and pick the master scope.');
      } else {
        console.warn(`  Apollo search failed for "${companyName}": ${e.message}`);
      }
      return [];
    }
  }

  /**
   * Find contacts for a project opportunity — owner + general contractor.
   * Matches the call shape prospect.js:157 expects.
   *
   * Default behaviour is search-then-enrich: free Search returns candidates,
   * then we call /people/match for each who has `has_email: true` so the
   * approval UI shows usable email + phone. Set `opts.enrich = false` to skip
   * the enrichment step (saves credits but returns obfuscated names).
   */
  async findContactsForProject(project, icp, opts = {}) {
    if (!this.apiKey) return [];

    const targetTitles = (icp && icp.buyerTitles) || [
      'project manager', 'procurement manager', 'site superintendent',
      'safety director', 'purchasing agent'
    ];
    const state = project?.geography?.state || '';
    const enrich = opts.enrich !== false;
    const finder = enrich ? this.findAndEnrichContacts.bind(this) : this.findContacts.bind(this);
    const contacts = [];

    if (project?.owner) {
      const ownerContacts = await finder(project.owner, state, targetTitles);
      contacts.push(...ownerContacts.map(c => ({ ...c, role: 'owner' })));
    }
    if (project?.generalContractor) {
      const gcContacts = await finder(project.generalContractor, state, targetTitles);
      contacts.push(...gcContacts.map(c => ({ ...c, role: 'general_contractor' })));
    }
    return contacts;
  }

  /**
   * Two-step flow: free Search → paid Enrichment. For each candidate Apollo
   * claims has an email (`has_email: true`), call /people/match by Apollo ID
   * to retrieve the actual email/phone/linkedin. Records without
   * `has_email` are returned as-is (obfuscated) so callers can still see them.
   *
   * Credits: 1 per enriched record. Cap with `opts.maxEnrich` (default 10).
   */
  async findAndEnrichContacts(companyName, state, targetTitles, limit, opts = {}) {
    const candidates = await this.findContacts(companyName, state, targetTitles, limit, opts);
    if (!candidates.length) return [];

    const enrichable = candidates.filter(c => c.hasEmail && c.providerPersonId);
    const maxEnrich = opts.maxEnrich ?? 10;
    const toEnrich = enrichable.slice(0, maxEnrich);
    const enrichedById = new Map();

    for (const c of toEnrich) {
      try {
        const res = await this.enrichContact({ id: c.providerPersonId });
        if (res?.person) {
          enrichedById.set(c.providerPersonId, this._normalizeEnrichedPerson(res.person, c.company, state));
        }
      } catch (e) {
        console.warn(`  Apollo enrichment failed for ${c.providerPersonId}: ${e.message}`);
      }
    }

    return candidates.map(c => enrichedById.get(c.providerPersonId) || c);
  }

  // ---------- Single enrichment ----------

  /**
   * Enrich a single known contact via /people/match. Caller supplies at
   * least one of:
   *   - `id` (Apollo person ID, recommended — perfect-match)
   *   - `email`
   *   - `linkedin_url`
   *   - `first_name` + `last_name` + `organization_name`
   *
   * Returns the raw `{ person }` response. Field shapes for /people/match
   * are assumed from Apollo's historical docs; share the People Enrichment
   * docs to verify and tighten this further.
   */
  async enrichContact(input) {
    if (!this.apiKey) {
      console.warn('  Apollo API key not configured — skipping contact enrichment');
      return null;
    }
    if (!input || !hasContactIdentifier(input)) {
      throw new Error(
        'enrichContact: requires id, email, linkedin_url, or ' +
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

  /**
   * Shape returned by /mixed_people/api_search — note: NO email/phone/linkedin
   * available here; last name is obfuscated. Call enrichContact() with the
   * `providerPersonId` to get usable contact info.
   */
  _normalizeSearchPerson(p, fallbackCompany, fallbackState) {
    return {
      firstName: p.first_name || '',
      lastName: p.last_name_obfuscated || '',
      email: '',
      phone: '',
      title: p.title || '',
      company: p.organization?.name || fallbackCompany || '',
      linkedIn: '',
      state: fallbackState || '',
      confidence: scoreSearchPerson(p),
      source: 'apollo.io',
      providerPersonId: p.id || null,
      hasEmail: p.has_email === true,
      hasDirectPhone: p.has_direct_phone === 'Yes',
      lastRefreshedAt: p.last_refreshed_at || null,
      needsEnrichment: true,
    };
  }

  /**
   * Shape returned by /people/match — full contact data including email,
   * phone, and LinkedIn (subject to your Apollo plan). Field names assumed
   * from Apollo's historical docs; verify against current People Enrichment
   * docs and adjust if needed.
   */
  _normalizeEnrichedPerson(p, fallbackCompany, fallbackState) {
    const email = cleanEmail(p.email);
    return {
      firstName: p.first_name || '',
      lastName: p.last_name || p.last_name_obfuscated || '',
      email,
      phone: extractPhone(p),
      title: p.title || '',
      company: p.organization?.name || fallbackCompany || '',
      linkedIn: p.linkedin_url || '',
      state: p.state || fallbackState || '',
      confidence: scoreEnrichedPerson(p, email),
      source: 'apollo.io',
      providerPersonId: p.id || null,
      emailStatus: p.email_status || null,
      hasEmail: !!email,
      hasDirectPhone: !!(p.phone_numbers && p.phone_numbers.length),
      needsEnrichment: false,
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
  if (input.id) return true;
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

function scoreSearchPerson(p) {
  let score = 40;
  if (p.has_email) score += 25;
  if (p.has_direct_phone === 'Yes') score += 20;
  if (p.title) score += 10;
  if (p.organization?.name) score += 5;
  return Math.min(100, score);
}

function scoreEnrichedPerson(p, email) {
  let score = 40;
  if (email) score += 20;
  if (p.email_status === 'verified') score += 25;
  else if (p.email_status === 'guessed') score += 5;
  if (p.linkedin_url) score += 10;
  if (p.phone_numbers && p.phone_numbers.length) score += 5;
  return Math.min(100, score);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

// Apollo's location matcher rejects 2-letter US state codes — "NY" returns
// zero hits, while "New York" or "United States" works. Expand abbreviations
// before sending. Anything we can't recognize is passed through unchanged so
// already-correct values ("Buffalo, New York", etc.) still work.
const US_STATE_CODE_TO_NAME = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
};
function normalizeApolloLocation(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (trimmed.length === 2) {
    return US_STATE_CODE_TO_NAME[trimmed.toUpperCase()] || trimmed;
  }
  return trimmed;
}

module.exports = ApolloClient;
