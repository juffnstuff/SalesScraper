# RubberForm Prospecting Engine

AI-powered multi-rep sales prospecting tool for RubberForm Recycled Products, LLC.

## Architecture

```
prospect.js                  ← CLI entry point
config/
  rep_profiles.json          ← 4 sales reps (discovered from NetSuite + Outlook)
  icps/{repId}_icp.json      ← Auto-generated ICPs (cached 30 days)
src/
  discovery/
    icp_engine.js            ← Derives ICPs from NetSuite + email data via Claude
    netsuite_client.js       ← NetSuite SuiteQL wrapper
    email_client.js          ← Microsoft 365 / Graph API wrapper
  prospecting/
    bid_searcher.js          ← Orchestrates all bid sources
    scorer.js                ← Heuristic + Claude-powered relevance scoring
    sources/
      sam_gov.js             ← Federal opportunities (SAM.gov API)
      state_dots.js          ← State DOT bid portals (web scraping)
      bidnet.js              ← BidNet / DemandStar aggregators
      web_search.js          ← Claude web_search tool for open-web discovery
  enrichment/
    selling_api.js           ← Selling.com contact enrichment API
  crm/
    hubspot_client.js        ← HubSpot contact/company/task creation
  ui/
    cli_display.js           ← Terminal UI with chalk
    reporter.js              ← Run logs and summary reports
```

## Sales Reps (from Step 1 Discovery)

| Rep | NetSuite ID | Email | Territory |
|-----|------------|-------|-----------|
| Galen Reich | 442081 | galen@rubberform.com | North-Central USA |
| Andrew Gibson | 26 | andrew@rubberform.com | National |
| Nick Zielinski | 150925 | nickz@rubberform.com | National |
| Brad Backman | 443337 | bradb@rubberform.com | National |
| Bill Robbins | -5 | bill@rubberform.com | National |
| Jake Robbins | 16 | jake@rubberform.com | National |

## Key NetSuite Fields

- `transaction.employee` → Sales Rep (joins to `employee` table)
- `transaction.total` → Transaction amount
- `transaction.entity` → Customer (joins to `entity` table)
- `transaction.type` → 'Estimate', 'SalesOrd', 'Invoice'
- `transaction.tranDate` → Date (use `TO_DATE('YYYY-MM-DD', 'YYYY-MM-DD')` format)

## Running

```bash
npm install
cp .env.example .env   # Fill in credentials
node prospect.js --rep all --dry-run     # Preview mode
node prospect.js --rep galen_reich       # Single rep
node prospect.js --report                # Show last run
```

## Build Rules

1. Default to --dry-run until Jeff approves live pushes
2. ICPs cached in /config/icps/ — regenerate with --refresh-icp or after 30 days
3. All API calls have exponential backoff and respect Retry-After headers
4. Contacts deduplicated by email AND name+company before HubSpot push
5. All secrets via .env — never in code
6. Selling.com API: REST with Bearer token auth, supports contact enrichment + email verification
