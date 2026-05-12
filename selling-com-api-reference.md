# Selling.com Enrichment API — Complete Reference

> Generated from official Selling.com API Documentation  
> Source: https://www.selling.com/documentation/web-api

---

## 0. Getting an API Key (UI flow)

> ⚠️ The public docs URL (https://www.selling.com/documentation/web-api) is
> behind a 403 to our environment, so the exact button labels below were not
> visually verified against the live app — they follow the docs' written
> guidance ("API keys are generated and managed at `app.selling.com` →
> API Keys section"). If the labels differ in the live UI, prefer what you
> see and update this section.

1. Go to **https://app.selling.com** and sign in (or create an account at
   https://www.selling.com → **Sign Up** if you don't have one). A paid plan
   or trial with API access enabled is required — billing is per-credit and
   credits are consumed per enrichment match.
2. Open your account menu (top-right avatar) → **Settings**.
3. In the left nav, choose **API Keys** (sometimes nested under
   *Integrations* or *Developer*).
4. Click **Create API Key** (or **Generate New Key**). Give it a name like
   `rubberform-prospecting-prod` and, if prompted, scope it to the
   enrichment endpoints you'll use.
5. **Copy the key immediately** — Selling.com only shows the full secret
   once. Paste it into your local `.env` as `SELLING_API_KEY=...`.
6. Confirm credit balance on the **Billing** or **Credits** page; each
   match-returning enrichment call consumes one credit.
7. (Optional) Set up an IP allowlist or webhook secret on the same page if
   your plan supports it.
8. Smoke-test the key:
   ```bash
   node scripts/smoke_test_selling_api.js --verify
   ```
   A `200` response with `"status": "valid" | "invalid" | "unknown"` confirms
   the key works.

**Rotating / revoking:** the same **API Keys** page lets you revoke a key.
Revoke immediately if a key leaks, then issue a new one and update `.env`.

---

## 1. Connection Basics

**Base URL:** `https://api.selling.com/`

**Required Headers (every request):**
```
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

**HTTP Methods:**
- `POST` — submit enrichment requests (single or bulk)
- `GET` — retrieve bulk job results

**Authentication:** API keys are generated and managed at `app.selling.com` → API Keys section. Store keys in environment variables, never hardcode them.

**Rate Limits:** Communicated via a `rate_limit` field in response headers (requests per minute). Exceeding limits returns `429 Too Many Requests`. Use exponential backoff retry logic and prefer bulk endpoints to reduce call volume.

---

## 2. Error Codes

| Code | Name | Cause | Fix |
|------|------|-------|-----|
| 400 | Bad Request | Missing/invalid fields or JSON | Check required fields and formatting |
| 401 | Unauthorized | Missing, invalid, or revoked API key | Verify `Authorization` header and key |
| 403 | Forbidden | Inactive account or insufficient key permissions | Contact support |
| 404 | Not Found | Wrong endpoint URL or non-existent resource | Check URL path |
| 429 | Too Many Requests | Rate limit exceeded | Retry with exponential backoff |
| 500 | Internal Server Error | Server-side issue | Retry later; contact support if persistent |

**Standard error response shape:**
```json
{
  "status": 400,
  "error": "Bad Request",
  "message": "Human-readable description"
}
```

---

## 3. Endpoint: Single Email Verification

**POST** `/email-verification`

### Request Body

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | ✅ | Must be valid email format |

### Response Fields

| Field | Type | Notes |
|-------|------|-------|
| `email` | string | The email that was submitted |
| `status` | string | `valid`, `invalid`, or `unknown` |
| `credit_charged` | boolean | Whether a credit was consumed |
| `remaining_credits` | integer | Credits left after this call |

### cURL Example
```bash
curl -X POST "https://api.selling.com/email-verification" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{ "email": "jane.doe@example.com" }'
```

### Response Example
```json
{
  "email": "jane.doe@example.com",
  "status": "valid",
  "credit_charged": true,
  "remaining_credits": 142
}
```

---

## 4. Endpoint: Single Contact Enrichment

**POST** `/contact`

**Minimum required:** at least one of:
- `linkedin_url`
- `business_email`
- `first_name` + `last_name` + `company_domain`
- `first_name` + `last_name` + `company_name`

### Request Body

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `first_name` | string | conditional | Max 255 chars |
| `last_name` | string | conditional | Max 255 chars |
| `company_name` | string | conditional | Max 255 chars |
| `company_domain` | string | conditional | e.g. `https://example.com` |
| `business_email` | string | conditional | Work email, max 255 chars |
| `linkedin_url` | string | conditional | Full LinkedIn profile URL |
| `metadata.business_email_exists` | boolean | optional | Filter to contacts with work email. Default: `false` |
| `metadata.mobile_phone_enrichment` | boolean | optional | Include mobile phone if available |
| `metadata.mobile_phone_exists` | boolean | optional | Filter to contacts with mobile. Requires `mobile_phone_enrichment: true` |

### Response Fields (inside `contact` object)

| Field | Type | Notes |
|-------|------|-------|
| `first_name` | string | |
| `last_name` | string | |
| `email` | string | Work email |
| `office_phone` | string | e.g. `+18005551234` |
| `mobile_phone` | string | e.g. `+18005555678` |
| `title` | string | Job title |
| `job_level` | string | e.g. `Executive` |
| `department` | string | e.g. `General Management` |
| `linkedin` | string | LinkedIn URL |
| `location` | object | `{ country, state, zip_code }` |
| `company` | object | See company sub-object fields below |
| `error` | string | Populated if enrichment failed |
| `credit_charged` | boolean | |
| `remaining_credits` | number | |

**Company sub-object fields:** `name`, `description`, `website`, `employees_category`, `revenue_category`, `location { country, state, zip_code }`

### cURL Example
```bash
curl -X POST "https://api.selling.com/contact" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "company_name": "ExampleCorp",
    "company_domain": "https://example.com",
    "business_email": "john.doe@example.com",
    "linkedin_url": "https://www.linkedin.com/in/johndoe",
    "metadata": {
      "mobile_phone_enrichment": true,
      "mobile_phone_exists": true,
      "business_email_exists": true
    }
  }'
```

### Response Example
```json
{
  "contact": {
    "credit_charged": true,
    "first_name": "John",
    "last_name": "Doe",
    "email": "john.doe@example.com",
    "office_phone": "+18005551234",
    "mobile_phone": "+18005555678",
    "location": {
      "country": "United States",
      "state": "California",
      "zip_code": "90001"
    },
    "title": "Chief Executive Officer",
    "job_level": "Executive",
    "department": "General Management",
    "linkedin": "https://www.linkedin.com/in/johndoe",
    "company": {
      "name": "ExampleCorp",
      "description": "ExampleCorp is a leading provider of business solutions...",
      "website": "https://example.com",
      "employees_category": "500-1,000",
      "revenue_category": "$10 - 49 M",
      "location": {
        "country": "United States",
        "state": "California",
        "zip_code": "90001"
      }
    }
  },
  "remaining_credits": 10
}
```

---

## 5. Endpoint: Bulk Contact Enrichment Submission

**POST** `/contacts`

Same field requirements as single contact — at least one valid combo required per record.

### Request Body

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `contacts` | array | ✅ | Array of contact objects |
| `contacts[].first_name` | string | conditional | Max 255 chars |
| `contacts[].last_name` | string | conditional | Max 255 chars |
| `contacts[].company_name` | string | conditional | Max 255 chars |
| `contacts[].company_domain` | string | conditional | |
| `contacts[].business_email` | string | conditional | |
| `contacts[].linkedin_url` | string | conditional | |
| `contacts[].custom_fields` | object | ✅ | Arbitrary key-value metadata (e.g. Salesforce IDs) |
| `metadata.business_email_exists` | boolean | optional | |
| `metadata.mobile_phone_enrichment` | boolean | optional | |
| `metadata.mobile_phone_exists` | boolean | optional | Requires `mobile_phone_enrichment: true` |
| `metadata.real_time_verification` | boolean | optional | Send contacts through real-time verification |

### Response Fields

| Field | Type | Notes |
|-------|------|-------|
| `job_id` | string | UUID to track the job |
| `download_url` | string | URL to fetch results when ready |
| `expiration_date` | string | Unix timestamp — results deleted after this |

### cURL Example
```bash
curl -X POST "https://api.selling.com/contacts" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "contacts": [
      {
        "first_name": "John",
        "last_name": "Doe",
        "company_name": "ExampleCorp",
        "company_domain": "https://example.com",
        "business_email": "john.doe@example.com",
        "linkedin_url": "https://www.linkedin.com/in/johndoe",
        "custom_fields": { "id": "id_123", "salesforce_key": "key_123" }
      }
    ],
    "metadata": {
      "mobile_phone_enrichment": true,
      "mobile_phone_exists": true,
      "business_email_exists": true,
      "real_time_verification": true
    }
  }'
```

### Response Example
```json
{
  "job_id": "77f3a5bb-c06f-4caa-ac88-f844ab0ec173",
  "download_url": "https://api.selling.com/contacts/results/77f3a5bb-c06f-4caa-ac88-f844ab0ec173.json",
  "expiration_date": 2220091200
}
```

---

## 6. Endpoint: Bulk Contact Enrichment Results

**GET** `/contacts/results/{job_id}.json`

Poll this URL (from `download_url` in the submission response) once the job is complete.

| HTTP Status | Meaning |
|-------------|---------|
| 200 | Results ready |
| 202 | Job still processing — poll again later |
| 404 | Job not found or expired |

### Path Parameter

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `job_id` | string | ✅ | UUID from submission response |

### Response Fields (inside `contacts` array)

All the same contact fields as Single Contact Enrichment, plus:

| Field | Type | Notes |
|-------|------|-------|
| `original_fields` | object | Echo of what you originally submitted |
| `custom_fields` | object | Your custom metadata passed in submission |
| `remaining_credits` | number | Credits left after the bulk job |

### cURL Example
```bash
curl -X GET "https://api.selling.com/contacts/results/e01f423b-70f8-4911-93c7-97a07155354e.json" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json"
```

### Response Example
```json
{
  "contacts": [
    {
      "credit_charged": true,
      "first_name": "John",
      "last_name": "Doe",
      "email": "john.doe@example.com",
      "office_phone": "+18005551234",
      "mobile_phone": "+18005555678",
      "location": { "country": "United States", "state": "California", "zip_code": "90001" },
      "title": "Chief Executive Officer",
      "job_level": "Executive",
      "department": "General Management",
      "linkedin": "https://www.linkedin.com/in/johndoe",
      "company": {
        "name": "ExampleCorp",
        "description": "ExampleCorp is a leading provider of business solutions...",
        "website": "https://example.com",
        "employees_category": "500-1,000",
        "revenue_category": "$10 - 49 M",
        "location": { "country": "United States", "state": "California", "zip_code": "90001" }
      },
      "original_fields": { "first_name": "John", "last_name": "Doe", "email": "john.doe@example.com" },
      "custom_fields": { "id": "id_123", "salesforce_key": "key_123" }
    }
  ],
  "remaining_credits": 999999
}
```

---

## 7. Endpoint: Single Company Enrichment

**POST** `/company`

**Minimum required:** `company_website` OR `company_name`

### Request Body

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `company_name` | string | conditional | Max 255 chars |
| `company_website` | string | conditional | e.g. `https://example.com` |
| `metadata.top_matches_returned` | number | optional | 1–10, default 1. How many matching companies to return |

### Response Fields (inside `companies` array)

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | |
| `website` | string | |
| `phone` | string | |
| `description` | string | |
| `industry` | string | |
| `employees_category` | string | Range, e.g. `10,001+` |
| `employees_number` | number | Exact count |
| `revenue_category` | string | e.g. `$1+ Billion` |
| `revenue_number` | number | |
| `sic_code` | number | |
| `naics_code` | number | |
| `linkedin` | string | |
| `facebook` | string | |
| `twitter` | string | |
| `youtube` | string | |
| `curated_lists` | string | e.g. `Fortune 1000` |
| `number_of_available_locations` | number | |
| `year_founded` | number | |
| `recent_funding_date` | string | `MM/DD/YYYY` |
| `recent_funding_amount` | number | |
| `recent_funding_round` | string | e.g. Series A |
| `hq_address_1` | string | |
| `hq_address_2` | string | |
| `hq_city` | string | |
| `hq_state` | string | |
| `hq_zip_code` | string | |
| `hq_country` | string | |
| `original_fields` | object | Echo of input |
| `custom_fields` | object | Echo of input |
| `credit_charged` | boolean | |
| `error` | string | If enrichment failed |
| `remaining_credits` | number | |

### cURL Example
```bash
curl -X POST "https://api.selling.com/company" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "ExampleCorp",
    "company_website": "https://example.com",
    "metadata": {
      "top_matches_returned": 1
    }
  }'
```

### Response Example
```json
{
  "companies": [
    {
      "credit_charged": true,
      "website": "example.com",
      "name": "ExampleCorp",
      "phone": "+16502530000",
      "employees_category": "10,001+",
      "employees_number": 100000,
      "revenue_category": "$1+ Billion",
      "revenue_number": 100000,
      "sic_code": 7374,
      "naics_code": 518210,
      "industry": "Information Technology and Services",
      "linkedin": "https://www.linkedin.com/company/ExampleCorp",
      "facebook": "https://www.facebook.com/ExampleCorp",
      "twitter": "https://twitter.com/ExampleCorp",
      "youtube": "www.youtube.com/user/ExampleCorp",
      "curated_lists": "Fortune 1000",
      "number_of_available_locations": 158,
      "description": "ExampleCorp is a multinational technology company...",
      "year_founded": 1970,
      "recent_funding_date": "03/23/2021",
      "recent_funding_amount": 41300000,
      "recent_funding_round": "Unknown",
      "hq_address_1": "1600 Amphitheatre Pkwy",
      "hq_address_2": "8200 Ruby Heights Ave",
      "hq_city": "Mountain View",
      "hq_state": "California",
      "hq_zip_code": "94043",
      "hq_country": "United States",
      "original_fields": { "website": "example.com", "name": "ExampleCorp" },
      "custom_fields": { "website": "example.com", "name": "ExampleCorp" }
    }
  ],
  "remaining_credits": 10
}
```

---

## 8. Endpoint: Bulk Company Enrichment Submission

**POST** `/companies`

**Minimum required per record:** `company_website` OR `company_name`

### Request Body

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `companies` | array | ✅ | Array of company objects |
| `companies[].company_name` | string | conditional | Max 255 chars |
| `companies[].company_website` | string | conditional | |
| `companies[].custom_fields` | object | ✅ | Arbitrary metadata |
| `metadata.top_matches_returned` | number | optional | 1–10, default 1 |

### Response Fields

| Field | Type | Notes |
|-------|------|-------|
| `job_id` | string | UUID to track job |
| `download_url` | string | URL to fetch results |
| `expiration_date` | string | Unix timestamp — results deleted after |

### cURL Example
```bash
curl -X POST "https://api.selling.com/companies" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "companies": [
      {
        "company_name": "ExampleCorp",
        "company_website": "https://example.com",
        "custom_fields": { "website": "example.com", "name": "ExampleCorp" }
      }
    ],
    "metadata": {
      "top_matches_returned": 1
    }
  }'
```

### Response Example
```json
{
  "job_id": "77f3a5bb-c06f-4caa-ac88-f844ab0ec173",
  "download_url": "https://api.selling.com/companies/results/77f3a5bb-c06f-4caa-ac88-f844ab0ec173.json",
  "expiration_date": 2220091200
}
```

---

## 9. Endpoint: Bulk Company Enrichment Results

**GET** `/companies/results/{job_id}.json`

Same polling pattern as bulk contacts (200 = ready, 202 = still processing, 404 = not found/expired).

### Path Parameter

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `job_id` | string | ✅ | UUID from submission response |

### Response Fields (inside `companies` array)

All the same fields as Single Company Enrichment, plus:

| Field | Type | Notes |
|-------|------|-------|
| `original_fields` | object | Echo of original submission input |
| `custom_fields` | object | Your custom metadata |
| `remaining_credits` | number | Credits remaining after job |

### cURL Example
```bash
curl -X GET "https://api.selling.com/companies/results/e01f423b-70f8-4911-93c7-97a07155354e.json" \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json"
```

---

## 10. Key Patterns & Best Practices

**Bulk job workflow:**
1. `POST` to `/contacts` or `/companies` → receive `job_id` + `download_url`
2. Poll `GET {download_url}` until you get `200` (vs `202` = still processing)
3. Results expire — save them before the `expiration_date` Unix timestamp

**Credits:**
- Each enrichment call that returns data charges a credit
- `credit_charged: false` means no credit was used (e.g. no match found)
- Always check `remaining_credits` in responses
- Out-of-credits returns an `error` string per record, not a failed HTTP status

**`custom_fields`:** Free-form object attached to each record for cross-referencing (e.g. your internal IDs, Salesforce keys). Echoed back in results.

**`original_fields`:** The API echoes back exactly what you submitted per record — useful for reconciling bulk results with your original data.

**Per-record errors in bulk:** An error on one record does not fail the whole batch. Each record has its own `error` string field — always check it per-record in bulk results.

**Security:**
- Never hardcode your API key — use environment variables
- Regenerate keys immediately if compromised
- API keys can be revoked/managed at `app.selling.com`

---

## 11. Endpoint Quick Reference

| Endpoint | Method | Path |
|----------|--------|------|
| Single Email Verification | POST | `/email-verification` |
| Single Contact Enrichment | POST | `/contact` |
| Bulk Contact Submission | POST | `/contacts` |
| Bulk Contact Results | GET | `/contacts/results/{job_id}.json` |
| Single Company Enrichment | POST | `/company` |
| Bulk Company Submission | POST | `/companies` |
| Bulk Company Results | GET | `/companies/results/{job_id}.json` |
