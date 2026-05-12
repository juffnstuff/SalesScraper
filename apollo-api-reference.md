# Apollo.io API — Integration Reference

> Provider used by `src/enrichment/apollo_client.js`.
> Selected when `ENRICHMENT_PROVIDER=apollo` (the default).
>
> Verified against https://docs.apollo.io/reference/people-api-search.
> Other endpoints (People Enrichment, Bulk People Enrichment, Organizations
> Search/Enrichment) are coded against Apollo's historical surface — share
> those docs to verify and tighten the client further.

---

## 0. Getting an API Key (UI flow)

> ⚠️ **You need a MASTER API key**, not a regular one. The People Search
> endpoint returns `403 API_INACCESSIBLE` for non-master keys. Make sure
> the key you generate is the "master" / full-access scope.

1. **Sign up** at https://www.apollo.io → **Get Started Free**.
2. **Sign in** at https://app.apollo.io.
3. Open **Settings** (gear icon).
4. Navigate to **Integrations → API** (or **Developer → API Keys**).
5. Click **Create new key** and choose the **Master** scope. Name it
   something traceable like `rubberform-prospecting-prod`.
6. **Copy the key immediately** and paste it into `.env`:
   ```
   APOLLO_API_KEY=...
   ```
7. Confirm with the cheapest, credit-free call:
   ```bash
   npm run smoke:apollo -- --search
   ```
   If you see `403 API_INACCESSIBLE`, your key isn't master — regenerate.

---

## 1. Connection Basics

**Base URL:** `https://api.apollo.io/api/v1` (override with
`APOLLO_API_BASE_URL`)

**Auth headers (every request):**
```
x-api-key: YOUR_MASTER_API_KEY
Content-Type: application/json
Cache-Control: no-cache
```

OAuth Bearer auth is also supported and is Apollo's "recommended" path for
production; this client uses API key for simplicity.

**Rate limits:** People Search is 600 req/hour. Other endpoints vary by
plan. 429 responses honour `Retry-After`; the client retries with
exponential backoff (max 3 attempts).

---

## 2. The Two-Step Workflow (Important)

Apollo splits "find people" from "get their contact info":

```
┌─────────────────────────┐      ┌─────────────────────────────┐
│  POST /mixed_people/    │      │  POST /people/match         │
│       api_search        │ ───▶ │       (or bulk_match)       │
│                         │      │                             │
│  FREE, no credits       │      │  COSTS 1 credit per record  │
│  Returns: obfuscated    │      │  Returns: full email, phone,│
│  names + has_email flags│      │  LinkedIn URL               │
└─────────────────────────┘      └─────────────────────────────┘
```

Search alone gives you names like `Jane Do***e` and a `has_email: true`
flag — useful for discovery, but not contactable. To actually push
people to HubSpot, you have to call Enrichment after Search.

`findAndEnrichContacts(company, state, titles)` runs both steps in
sequence, capped at 10 enrichments per call by default. That's the
method `prospect.js` and `web/server.js` use.

---

## 3. Endpoint: People Search

**POST** `/mixed_people/api_search`

⚠️ All parameters go in the **query string** (not the body), even though
the method is POST. The client builds the URL with `URLSearchParams` and
sends no body.

### Useful query parameters

| Param | Type | Notes |
|-------|------|-------|
| `person_titles[]` | string[] | Job titles. Apollo also returns similar titles by default (e.g. searching `marketing manager` includes `content marketing manager`). |
| `include_similar_titles` | bool | Default `true`. Set `false` for strict title matches. |
| `person_seniorities[]` | string[] | One of: `owner`, `founder`, `c_suite`, `partner`, `vp`, `head`, `director`, `manager`, `senior`, `entry`, `intern`. |
| `person_locations[]` | string[] | Cities, US states, or countries. Filters by where the person lives. |
| `organization_locations[]` | string[] | Filters by company HQ location instead. |
| `q_organization_domains_list[]` | string[] | **Preferred** way to scope to a company. Domain only (no `www.`, no `@`). Up to 1,000. |
| `organization_ids[]` | string[] | Apollo's internal company IDs. |
| `organization_num_employees_ranges[]` | string[] | Format: `"min,max"`, e.g. `"50,200"`. |
| `revenue_range[min]`, `revenue_range[max]` | int | No symbols/commas. |
| `contact_email_status[]` | string[] | `verified`, `unverified`, `likely to engage`, `unavailable`. Client defaults to `["verified"]`. |
| `q_keywords` | string | Free-text fallback when you don't have a domain. The client uses this when `companyName` is provided without `opts.domain`. |
| `page`, `per_page` | int | Max 100 per page, max 500 pages, hard cap 50,000 records total. |

### Response shape

```json
{
  "total_entries": 232764882,
  "people": [
    {
      "id": "67bdafd0c3a4c50001bbd7c2",
      "first_name": "Andrew",
      "last_name_obfuscated": "Hu***n",
      "title": "Director of Operations",
      "last_refreshed_at": "2025-11-04T23:20:32.690+00:00",
      "has_email": true,
      "has_city": true,
      "has_state": true,
      "has_country": true,
      "has_direct_phone": "Yes",
      "organization": {
        "name": "Scicomm Media",
        "has_industry": true,
        "has_phone": false,
        ...
      }
    }
  ]
}
```

**Notable absences:** no `email`, no `phone_numbers`, no `linkedin_url`,
no `state`/`city` strings (only `has_*` booleans). Enrichment is required
to get any of that.

`has_direct_phone` returns `"Yes"` or `"Maybe: please request direct dial
via people/bulk_match"`.

### Error responses

| Status | Meaning | Fix |
|--------|---------|-----|
| 401 | Invalid access credentials | Check `APOLLO_API_KEY` |
| 403 `API_INACCESSIBLE` | Key isn't a master key | Regenerate with master scope |
| 422 | Invalid parameters | Check param names — they're picky |
| 429 | 600/hour limit hit | Backoff (auto-handled by client) |

---

## 4. Endpoint: People Enrichment (assumed shape — verify)

**POST** `/people/match`

Used by `enrichContact()` and the second step of `findAndEnrichContacts()`.
Accepts at least one of:

- `id` — Apollo person ID from Search (most reliable, perfect match)
- `email`
- `linkedin_url`
- `first_name` + `last_name` + `organization_name`

Optional flags: `reveal_personal_emails: true` (consumes credits to
unlock obfuscated emails on lower plans).

Returns `{ person: {...} }` with full firmographic + contact data.
**Field shapes here are coded from Apollo's historical docs** — share the
current People Enrichment docs (`https://docs.apollo.io/reference/people-enrichment`)
to confirm `email_status` values, `phone_numbers` array shape, etc.

---

## 5. Normalized Contact Shape (both providers)

`findContacts()` / `findAndEnrichContacts()` return:

```ts
{
  firstName: string,
  lastName: string,              // 'Hu***n' from Search, full name after enrich
  email: string,                 // '' until enriched
  phone: string,                 // '' until enriched
  title: string,
  company: string,
  linkedIn: string,              // '' until enriched
  state: string,
  confidence: number,            // 0–100
  source: 'apollo.io' | 'selling.com',
  providerPersonId: string | null,
  hasEmail: boolean,             // Apollo Search flag
  hasDirectPhone: boolean,
  needsEnrichment: boolean,      // true if from Search only
  emailStatus?: string | null,   // present after enrichment
  lastRefreshedAt?: string | null
}
```

---

## 6. Free-Tier / Gotchas

- **Search returns no contact info.** You can't skip the enrichment step
  if you want to actually email/call anyone.
- **Master key is required for Search.** Non-master keys 403 with
  `API_INACCESSIBLE`.
- **`person_titles[]` is fuzzy by default.** Searching `marketing
  manager` returns `content marketing manager` too. Set
  `include_similar_titles=false` for strict matching.
- **No `organization_names[]` parameter.** You must use the company's
  domain (`q_organization_domains_list[]`) or its Apollo ID
  (`organization_ids[]`), or fall back to `q_keywords` for free-text
  matching against any field.
- **Pagination cap.** 100/page × 500 pages = 50,000 records per query.
  Tighten filters if you need more — this is a display limit, not a
  data-access limit.

---

## 7. Switching Providers

```bash
ENRICHMENT_PROVIDER=apollo    # default
ENRICHMENT_PROVIDER=selling   # falls back to Selling.com client
```

Both clients implement the same surface; `prospect.js` and
`web/server.js` go through `createEnrichmentClient()` and don't care
which provider is active. Selling.com's `findContacts()` is a no-op
warning shim because their public API doesn't support title-based
discovery.
