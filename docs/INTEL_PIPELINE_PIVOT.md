# Repurposing the SalesScraper Intel Pipeline for Market Intelligence

> **Status:** Strategy document only. No implementation yet.
> **Author context:** Drafted for a follow-up Claude Code session where this repo (SalesScraper) is connected alongside TRDESK (trading cockpit) and RFMKT (market regime / economy analyzer).
> **Last updated:** 2026-05-14

---

## TL;DR

SalesScraper's value isn't construction — it's the **multi-source, entity-linked, AI-classified regional-news pipeline with two-stage enrichment (cheap discovery → paid resolution) and a cohort-building "cart" workflow on top of it.** Construction is one application of that engine. The same engine ports cleanly to market intelligence, where it has a real edge in the long tail of regional and government data that Bloomberg/FactSet under-cover.

Three concrete plays, in order of conviction:

1. **AI Infrastructure CapEx Tracker** (standalone product / monetizable today). Aggregates every datacenter, semis fab, EV battery, and CHIPS-Act build from regional news + utility filings + zoning records into a per-ticker forward CapEx pipeline. Marketable to family offices, sector funds, corp dev teams at $5k–$10k/mo.
2. **TRDESK per-ticker intel feed** (alpha for an existing tool). Real-time classified event stream per watchlist ticker — capex, customer wins, supply disruptions, labor, M&A whispers, lawsuits — sourced from the same regional-news firehose.
3. **RFMKT leading-indicator stack** (regime input). Aggregated event-count time series (construction starts, layoffs, bond issuance, permits) as leading indicators feeding the regime model.

Don't fork SalesScraper. **Abstract the engine into a shared package** that all three apps import.

---

## What you actually have, valued correctly

Before talking about pivots: the IP is not the sales angle. It's the underlying engine. Specifically transferable:

| Capability | File / pattern in SalesScraper | Why it ports |
|---|---|---|
| Multi-source scraper framework | `src/prospecting/sources/*` (SAM.gov, state DOTs, BidNet, construction news, Claude web search) | The interface is generic. Add new sources without changing downstream consumers. |
| Structured extraction from unstructured prose | Claude with JSON-schema responses, cached results | Works for any extraction task. Cost is per-article ~pennies. |
| Entity resolution + dedup | project ↔ owner ↔ GC ↔ state ↔ contact | Same logic works for ticker ↔ subsidiary ↔ project ↔ location. |
| ICP / thesis matching | `config/icps/*_icp.json` + `src/discovery/icp_engine.js` | "ICP" is just a saved JSON profile of triggers, entities, geos, NAICS, keywords. Repurpose as "Strategy" / "Thesis". |
| Two-tier cost discipline | Apollo Search (free) → Apollo Match (paid) | Same pattern: cheap firehose filter → AI/paid enrichment only on the shortlist. |
| Scheduling backbone | Nightly scrapes, weekly heatmap scans, 7am/2pm syncs | Already cron-pattern in `server.js`. Reusable for any cadence. |
| Cart → batch action | Heatmap → list → push to HubSpot | Reusable as: watchlist → batch action (alert / position note / order ticket). |
| Geographic + entity clustering UI | Leaflet heatmap, marker clusters, sidebar drill-down | Reusable for geographic intel (datacenter sites, factory builds, drought zones) or refactored for ticker/sector clustering. |
| Postgres + JSON fallback data layer | `src/web/data.js`, `src/web/db.js` | Production-grade pattern; works for any document or relational shape. |

That's a real moat for alt-data work. **Most quants have structured-data muscle (prices, options chains, fundamentals). Very few have systematic unstructured-news muscle outside the Bloomberg corpus.** Local-paper, state-agency, and trade-press coverage is the long tail nobody systematically harvests.

---

## Play 1 — AI Infrastructure CapEx Tracker (standalone, monetizable now)

You already do this for construction. You may be sleeping on how valuable that is on its own.

### The thesis
Hyperscaler capex is the dominant 2025–2028 macro story. NVDA/MSFT/AMZN/META/GOOGL combined ~$400B/yr. The bottleneck is power, not silicon. **Every new datacenter announcement = quantifiable MW of new load + identified GC + identified power utility + identified supplier chain.** Sell-side analysts hand-count from press releases. Nobody systematically aggregates this from regional news.

### Named beneficiaries the data already touches
- **Power generation:** CEG, VST, TLN (nuclear monopoly plays), NEE, DUK, SO (utility-scale solar / new build)
- **Grid + power infra:** ETN, VRT, JCI, HUBB, AME (UPS, cooling, switchgear)
- **Datacenter REITs / colocation:** EQIX, DLR, IRM, AMT (towers + small DC)
- **Industrial GCs:** PWR, MTZ, EME (electrical), ACM, J (engineering)
- **Materials & aggregates:** MLM, VMC, EXP, USCR, CX
- **Semis tailwind:** NVDA (obvious), but also smaller suppliers named in regional press as building or being built for
- **CHIPS Act / fab beneficiaries:** AMAT, LRCX, KLAC, ASML, TSM (US plants), INTC

### Product shape
Monthly report (or interactive dashboard, similar to current heatmap):
- Rolling 12-month forward CapEx pipeline by named supplier / power source / REIT landlord
- Every announcement linked to source URL + extracted quote (audit trail, no hallucination tolerance)
- Cross-index: hyperscaler tenant ↔ REIT landlord ↔ GC ↔ MEP/electrical ↔ utility ↔ semis demand

### Monetization
Standalone subscription, $5k–$10k/mo. 20–30 subscribers (family offices, sector specialists, IR teams at named beneficiaries) = real revenue against marginal cost ≈ Claude API spend.

### Why it works first
- You've already proven the engine on construction.
- The data set is *already in your DB* — just needs re-aggregating and re-presenting against tickers instead of sales reps.
- No compliance risk (all public news, government filings, public utility commission records).
- Validates the pipeline at scale before staking it on TRDESK/RFMKT integrations.

---

## Play 2 — TRDESK per-ticker intel feed

### Current state
TRDESK tracks ~1000 tickers. Users currently get prices, options chains, fundamentals — structured data. The intel layer (news, capex precursors, lawsuits, M&A whispers) is either Bloomberg (expensive, gated, weak on small-caps) or manual.

### The play
Per-ticker real-time classified event feed. Each watchlist row gains an unread-badge counter:

```
NVDA  ●3 new signals    [click → drawer]
  ┌────────────────────────────────────────────────────┐
  │ ● HIGH   capex_precursor    2h ago                │
  │   Texas Independent School District announces      │
  │   400MW datacenter campus permit. Source: Houston  │
  │   Chronicle. Quote: "...primary GPU supplier      │
  │   confirmed as Nvidia..."                          │
  │   [Source URL] [Mark actionable] [Mute]            │
  ├────────────────────────────────────────────────────┤
  │ ● MED    customer_named     1d ago                │
  │   Press release from XYZ Robotics names NVDA as   │
  │   exclusive Orin platform for their LE1 product…  │
  └────────────────────────────────────────────────────┘
```

### Event taxonomy
Each classification produces:
- **type:** capex_precursor | customer_win | customer_loss | supply_disruption | labor_event | regulatory | lawsuit | m_and_a_whisper | product_launch | partnership | plant_closure | hiring_freeze | insider_signal | other
- **severity:** low | med | high
- **time_horizon:** immediate | next_quarter | 12mo+
- **confidence:** 0–100 (AI self-rated)
- **source_url + extracted_quote:** audit trail required, no exceptions

### Backend shape (so the new session has the architecture in mind)
```
intel-pipeline (shared package, lives in or is published from SalesScraper repo)
  ├── sources/                  # regional news, SEC EDGAR, SAM.gov, state agencies, PACER, EMMA
  ├── classifiers/              # Claude prompts + JSON schemas per event type
  ├── enrichment/               # ticker resolution, NAICS lookup, executive lookup
  ├── storage/                  # Postgres + sync metadata
  └── feed-api/                 # GET /api/intel/feed?tickers=NVDA,CEG,... etc.

TRDESK
  └── consumes feed-api, renders the drawer UI
```

### Wins
- Eats Bloomberg's lunch for small/mid-cap coverage where Bloomberg is thin.
- Reps the alt-data desk that hedge funds pay $200k/yr for, in-house.
- Per-ticker signal density tunable to user appetite (top 50 tickers full coverage, long tail keyword-only).

### Risks
- Signal-to-noise. SalesScraper's bar is "5 good contractors a week per rep." TRDESK needs "5 good signals per ticker per week across 1000 tickers" = 5000 signals/week with high precision. Tier the coverage (paragraph below).
- Hallucination. **Every event must carry a source URL + verbatim quote.** Audit on click. SalesScraper already does this with `source_url` on projects — keep that discipline.
- API cost. AI-classifying a regional-news firehose at scale is real money. Solve with a two-stage filter:
  1. **Cheap pre-filter:** NER for ticker mentions, keyword presence (from per-ticker keyword list), source-priority scoring. Free / pennies per article.
  2. **AI classification:** only on the survivors. Pennies per article × small-N survivors.

---

## Play 3 — RFMKT leading-indicator stack

Different unit of analysis. RFMKT isn't tracking individual tickers — it's aggregating signals into regime calls (recession risk, bull/bear, sector rotation timing).

### What the same scraper unlocks as leading indicators
| Signal | Source | What it leads |
|---|---|---|
| Commercial construction starts count, by region | Regional papers, ABC press releases, permit records | ABI, housing starts (with ~30–60 day lead) |
| Layoff announcement volume, by sector | Regional papers (WARN-style filings), local business journals | BLS NFP, unemployment claims |
| Bond issuance volume + spread color | Local financial press, EMMA filings | Muni credit cycle |
| Building permit filings, normalized by metro | Permit feeds (some are public) | Real activity vs reported |
| Local-paper sentiment by region | Regional news firehose, Claude sentiment classifier | "Vibecession" / consumer-confidence divergence |
| Strike-threat / labor-unrest mentions | Local papers, trade press | Wage pressure |
| Foreign news: port strikes, freight, FX black-market color | International regional press, FT regional pages | Supply-chain stress, EM currency |
| Plant-closure announcements by industry | Local papers | Sector capex decline, regional GDP drag |

### What the architecture buys
You're not paying $10k/seat for Severn Trent, Indeed Hiring Lab, or Goldman's quantamental subscription — you're running comparable signals in-house off your own scraper. The marginal cost is the AI classification, which is pennies per article.

### Integration shape
- Aggregate event counts into time-series tables (region × event_type × week).
- Expose as RFMKT data input alongside existing macro inputs.
- Backtest signal stacks (e.g. layoff count + housing starts + ABI as recession lead).

### Caveats
- Backtesting discipline matters. Out-of-sample, walk-forward, realistic transaction costs. The "I built a model in 2026 and the backtest is great" trap is real.
- Survivor bias: regional-news availability has expanded over time. Older periods are sparser. Document the data set's vintage.

---

## Architecture — how to actually slot it together

### Don't fork. Abstract.

SalesScraper today is a monorepo with `sources/`, `enrichment/`, `crm/`, `prospecting/`, web UI. Forking it for TRDESK/RFMKT would create three drifting copies of the same engine.

**Right answer: extract the engine into a shared package.**

```
new repo or monorepo workspace: rubberform-intel-pipeline
  ├── sources/        # generic scraper interface + per-source impls
  ├── classifiers/    # Claude prompts (versioned) + JSON schemas + cache
  ├── enrichment/     # entity resolution, paid lookup adapters (Apollo, SEC EDGAR, etc.)
  ├── storage/        # Postgres + sync metadata + JSON fallback (port from src/web/data.js + db.js)
  ├── scheduling/     # cron patterns (port from server.js startup helpers)
  └── api/            # consumer-agnostic HTTP layer; or import as a library

SalesScraper       — imports intel-pipeline, adds construction-specific sources + sales UI
TRDESK             — imports intel-pipeline, adds per-ticker UI + alerting
RFMKT              — imports intel-pipeline, adds time-series aggregation + regime models
```

The abstractions that need renaming on extraction:

| SalesScraper concept | Generic concept | TRDESK use | RFMKT use |
|---|---|---|---|
| Sales Rep | Strategy / Thesis | "AI infra long," "small-cap industrial" | "Recession lead-indicator" |
| ICP (`config/icps/*.json`) | Thesis profile | Per-strategy event filters | Per-regime input config |
| Contractor / Owner | Entity (ticker, issuer, region) | Watchlist ticker | Aggregation dimension |
| Project (DB row) | Event | Classified signal | Time-series increment |
| Apollo enrichment | Generic enrichment adapter | SEC EDGAR / paid feeds | Aggregation lookup |
| HubSpot push | Action sink | Alert / position note / ticket | Append to regime input series |
| Heatmap | Geographic UI | Optional sector/exposure heatmap | Geographic event volume |
| Lists (cart) | Cohort | Watchlist / trade idea bucket | Manual override set |

---

## Phased plan

### Phase 0 — Extract the engine
- Identify the modules in SalesScraper that aren't construction-specific (most of `sources/`, all of `enrichment/`, all of `db.js` + data-layer, scheduling helpers).
- Move them into a new package (`@rubberform/intel-pipeline` or similar). Keep version pinning so SalesScraper continues to work.
- SalesScraper becomes a consumer of the package, just like TRDESK and RFMKT will be.
- **Don't break the working construction app.** Run extraction on a branch, validate SalesScraper still functions end-to-end, then merge.

### Phase 1 — Productize the AI Infra CapEx Tracker
- Same engine, new strategy profile ("AI Infrastructure CapEx" ICP).
- Output: per-ticker event log (NVDA, CEG, VST, EQIX, DLR, ETN, VRT, etc.) with construction-project provenance.
- Validate against known events you already track. **If the engine catches 80%+ of announced datacenter projects within 7 days of public disclosure, you have a saleable product.**
- Decide: standalone web app, or PDF/newsletter, or live dashboard. Recommend live dashboard — same UI muscle as the heatmap.

### Phase 2 — TRDESK integration
- New endpoint in intel-pipeline: `GET /api/intel/feed?tickers=...` returning classified events per ticker.
- TRDESK row gets a small indicator + click-through to event detail.
- Tight feedback loop: trader marks signals as actionable / noise → that signal trains the classifier (RLHF-lite via prompt tuning).
- Initially: top 50 tickers full coverage, rest keyword-only. Tune cost vs precision.

### Phase 3 — Broaden source taxonomy
Add sources in priority order:
1. **SEC EDGAR** (8-K, 10-Q, 13-D, 13-G) — text mining for named-customer mentions, supply disclosures, buyback authorizations, insider activity
2. **EMMA** — municipal bond filings
3. **PACER** — federal court filings for named corporate defendants
4. **USPTO** — patent assignments (M&A precursor, R&D velocity)
5. **Local-paper aggregators** — already half-built
6. **State PUC filings** — utility capex disclosures

### Phase 4 — RFMKT integration
- Aggregate event-count time series by sector, region, severity.
- Build dashboards that drive regime calls.
- Backtest signal stacks.
- Decide which signals become live regime inputs vs research-only.

### Phase 5 — Productization
- Decide which plays become external products vs internal-only:
  - AI Infra CapEx Tracker: external, subscription
  - TRDESK intel feed: internal, but could become a paid TRDESK tier
  - RFMKT regime inputs: internal-only (the regime model itself is the product, not the inputs)

---

## Hard caveats (put these in front of any partner discussion)

### Compliance
Trading on public information is fine. Trading on private information from a source you have a contractual relationship with is **not**. SalesScraper today scrapes public web — keep it that way for the trading apps. If you ever buy proprietary data with redistribution restrictions or insider color, segregate it from any system that pre-positions trades. **Talk to securities counsel before external launch.**

### Hallucination is alpha-killing
Every Claude-extracted event must carry source_url + verbatim quote so a human can audit on click. SalesScraper already does this with `source_url` — keep that discipline. **If an LLM-extracted signal can't be tied back to a specific sentence in a specific URL, it doesn't go into the system.**

### Cost discipline
Classifying a regional-news firehose with Claude on every article gets expensive fast. The two-stage pattern SalesScraper already uses (free search → paid enrichment only on shortlist) is the right shape. Pre-filter by ticker mention (NER), keyword presence, source priority. Only AI-classify the survivors. Budget per-ticker per-month and tier coverage (top 50 full, long tail keyword-only).

### The 1000-ticker scale problem
SalesScraper's "find me 5 contractors a week per rep" cost model doesn't directly extrapolate. 1000 tickers × meaningful news rate × per-event AI cost is real money. Solve via the heuristic pre-filter above. Build a knob for per-ticker monthly budget.

### Don't try to beat Bloomberg on names they care about
Compete on the long tail — small-caps, regional papers, government filings, industrial trade press. **That's where Bloomberg is thin and you can be fat.** Don't waste effort trying to outpace Bloomberg's coverage of AAPL.

### Backtest before you trade
Out-of-sample, walk-forward, realistic transaction costs. Document data vintage so survivor bias is visible. **The "I built a model in 2026 and the backtest is great" trap is real.**

---

## Hand-off checklist for the new Claude Code session

When you open the new session with SalesScraper + TRDESK + RFMKT all three connected, hand it this doc plus:

- [ ] Walk through `src/prospecting/sources/*.js` and tag which sources are construction-specific vs general
- [ ] Walk through `src/web/data.js` and identify the entity-agnostic data layer vs the contacts/projects-specific bits
- [ ] Walk through `src/discovery/icp_engine.js` to understand how Claude is being used to generate structured profiles — that's the template for thesis profiles
- [ ] Walk through `src/enrichment/apollo_client.js` to see the two-stage discovery → enrichment pattern in production
- [ ] Compare TRDESK's current data ingestion and decide where the intel-pipeline feed plugs in (likely a new table + API endpoint)
- [ ] Compare RFMKT's current regime inputs and identify which event-count time series would be the highest-leverage new inputs
- [ ] Decide: extract the engine into a separate repo, or keep as a workspace package in a monorepo, or as a published private npm package — depends on how TRDESK and RFMKT are structured today
- [ ] **Build a small POC first** before any extraction: in SalesScraper, add an "AI Infrastructure CapEx" thesis profile alongside the existing ICPs, repoint the scrapers, see how many real datacenter projects it catches in a 7-day window. That validates the engine works for tickers before you do the extraction work.

---

## Bottom line

SalesScraper's bones are good. Don't waste them on construction alone. Construction is the proof point — the AI Infra CapEx Tracker is the standalone product, and TRDESK/RFMKT are the natural homes for the engine.

**Yes, repurpose. Don't fork. Abstract. Phase the work. Validate at each step.**
