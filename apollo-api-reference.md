# Apollo.io API — Integration Reference

> Provider used by `src/enrichment/apollo_client.js`.
> Selected when `ENRICHMENT_PROVIDER=apollo` (the default).
>
> ⚠️ Apollo's public docs are at https://docs.apollo.io/reference. Endpoint
> paths and request/response shapes have shifted between versions (notably
> the `/v1` → `/api/v1` move). Verify against current docs before production
> use and run `npm run smoke:apollo` after any change.

---

## 0. Getting an API Key (UI flow)

1. **Sign up** at https://www.apollo.io → **Get Started Free**. The free tier
   gives ~60 mobile credits per year and a limited monthly export allowance —
   enough to validate the integration end-to-end. Email reveals are
   metered separately; on the free tier expect `email_not_unlocked@...` in
   most responses.
2. **Sign in** at https://app.apollo.io.
3. Open **Settings** (gear icon, bottom-left or top-right depending on UI
   version).
4. Navigate to **Integrations → API** (sometimes labelled **Developer** →
   **API Keys** on newer accounts).
5. Click **Create new key**. Name it something traceable like
   `rubberform-prospecting-prod`.
6. **Copy the key immediately** and paste it into `.env`:
   ```
   APOLLO_API_KEY=...
   ```
7. Confirm the key works:
   ```bash
   npm run smoke:apollo -- --company
   ```
   The cheapest call. A `200` with an `organization` object means you're in.

**Rotation:** the same API page lists active keys and lets you revoke them.
Rotate immediately if a key leaks.

**Plan / billing notes:**
- Free tier is heavily metered. Useful for testing, not for production volume.
- `email_status: "verified"` reveals consume an email credit; `guessed`
  reveals are cheaper but lower confidence.
- Phone-number reveals consume mobile credits and may require a paid plan.

---

## 1. Connection Basics

**Base URL:** `https://api.apollo.io/api/v1` (configurable via
`APOLLO_API_BASE_URL`)

**Required headers (every request):**
```
X-Api-Key: YOUR_API_KEY
Content-Type: application/json
Cache-Control: no-cache
```

**Rate limits:** ~50–600 requests/min depending on plan. 429 responses
honour `Retry-After`; the client retries with exponential backoff (max 3
attempts).

---

## 2. Endpoints used by this app

| Method | Path | Purpose | Client method |
|--------|------|---------|---------------|
| POST | `/mixed_people/search` | Find contacts at a company by title/location | `findContacts(company, state, titles)` |
| POST | `/people/match` | Enrich a known contact | `enrichContact({ ... })` |
| POST | `/people/bulk_match` | Bulk enrich (≤10 per call, synchronous) | `bulkEnrichContacts(records)` |
| GET  | `/organizations/enrich?domain=...` | Enrich a company by domain | `enrichCompany({ domain })` |
| POST | `/organizations/bulk_enrich` | Bulk enrich companies | `bulkEnrichCompanies(domains)` |

### `/mixed_people/search` (the title-discovery endpoint)

Body Apollo accepts (subset used here):
```json
{
  "page": 1,
  "per_page": 10,
  "organization_names": ["ExampleCorp"],
  "person_titles": ["Project Manager", "Director of Procurement"],
  "person_locations": ["California, US"],
  "contact_email_status": ["verified"]
}
```

Response shape (subset):
```json
{
  "people": [
    {
      "id": "...",
      "first_name": "Jane",
      "last_name": "Doe",
      "title": "Project Manager",
      "email": "jane@example.com",
      "email_status": "verified",
      "linkedin_url": "https://linkedin.com/in/janedoe",
      "phone_numbers": [{ "type": "mobile", "raw_number": "+1..." }],
      "state": "California",
      "organization": { "name": "ExampleCorp", "primary_domain": "example.com" }
    }
  ],
  "pagination": { "page": 1, "per_page": 10, "total_entries": 42 }
}
```

`email_status` values: `verified` | `guessed` | `unavailable` | `bounced` |
`pending_manual_fulfillment`.

### `/people/match`

Requires at least one of: `email`, `linkedin_url`, or
`first_name + last_name + organization_name`. Returns `{ person: {...} }`.

Set `reveal_personal_emails: true` to consume credits and unlock the email
on free/cheap plans. Controlled by `APOLLO_REVEAL_PERSONAL_EMAILS` env var.

### `/organizations/enrich`

GET with `domain` query param. Returns `{ organization: {...} }` with firmographics, social URLs, employee count, revenue band, etc.

---

## 3. Normalized Contact Shape

`findContacts()` returns the same shape across providers so the web app and
prospect.js are provider-agnostic:

```ts
{
  firstName: string,
  lastName: string,
  email: string,            // '' if obfuscated/missing
  phone: string,
  title: string,
  company: string,
  linkedIn: string,
  state: string,
  confidence: number,       // 0–100, heuristic
  source: 'apollo.io' | 'selling.com',
  providerPersonId: string | null,
  emailStatus: string | null
}
```

---

## 4. Free-Tier Gotchas

- **Obfuscated emails.** Apollo replaces unrevealed emails with
  `email_not_unlocked@domain.com`. The client strips these to `''` so they
  don't accidentally land in HubSpot. Check `emailStatus` to see what
  Apollo claims is true.
- **No standalone email verifier.** `verifyEmail(email)` is implemented as
  a wrapper over `/people/match` and maps `email_status` → `valid` /
  `invalid` / `unknown`. Apollo deprecated the dedicated endpoint.
- **Search results are paginated and ranked.** Use `person_locations` and
  `person_titles` aggressively — the default sort is not by relevance to
  your query, it's by Apollo's internal ranking.

---

## 5. Switching Providers

```bash
ENRICHMENT_PROVIDER=apollo    # default
ENRICHMENT_PROVIDER=selling   # falls back to Selling.com client (no title-search)
```

Both clients implement the same surface; `prospect.js` and `web/server.js`
go through `createEnrichmentClient()` and don't care which provider is
active.
