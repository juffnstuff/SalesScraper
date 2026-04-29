# Handoff: RubberForm Trackout Mats — Spec Sheet & Install Guide

## Overview
Two-direction product documentation for **RFRP Trackout Mats** (SKU `RF-TM-810`) — a single-page interactive document that toggles between a **Spec Sheet** view and an **Install Guide** view. Two parallel design directions are included so the team can pick (or merge) before production:

- **Variant A — "Safe":** Engineering-doc tone. B2B-credibility-first. Light or dark mode. Structured grid, technical typography, clean tables.
- **Variant B — "Bold":** Rebel-brand, editorial, high contrast. Dark navy + sky-blue + salmon. Large cursive display type, full-bleed hero strip, alternating step layout.

Both variants render the **same product data** (`product-data.jsx`) so copy stays consistent between the two — only the presentation layer changes.

## About the Design Files
The files in this bundle are **design references created in HTML** — interactive prototypes that show intended look and behavior, not production code to copy directly.

Your task is to **recreate these designs in the target codebase's existing environment** (e.g. the RFRP marketing site's React/Next stack, or whichever framework is in use), using its established component patterns, layout primitives, and typography system. If no environment exists yet, choose the most appropriate framework for the project and implement there.

The HTML/JSX in this bundle is for visual reference only. Lift values (colors, type sizes, spacing, copy) — don't copy the file structure.

## Fidelity
**High-fidelity (hifi).** All colors, typography, spacing, and layout are final. The developer should reproduce pixel-for-pixel in the target stack, swapping only:
- The placeholder hero / step-diagram blocks → real product photography & illustrations
- The web-font `@import` → whatever font-loading strategy the host site uses
- The inline-style approach → host's CSS/SCSS/styled-components/etc.

Imagery is intentionally placeholder (diagonal-stripe fills with caption labels) — RFRP to supply finals before launch.

## Screens / Views

### Variant A — Safe (Engineering Doc)

#### A1. Header / Hero
- **Layout:** Full-width header on `palette.paper` background. `40px 56px 28px` padding. Two-row composition:
  - Row 1: Logo (left) + document-type metadata (right, mono caps).
  - Row 2: 7fr/5fr grid — title block (left) + hero placeholder (right).
- **Logo:** Custom `<RFLogo>` lockup — Yellowtail cursive "RFRP" wordmark with a hand-drawn flag stroke through the x-height, "RECYCLED PRODUCTS" subtitle in Oswald, "since 1995" italic in salmon. Wrapped in a thin double frame.
- **Title block:**
  - Eyebrow: Mono, `12px / 0.18em tracking / uppercase`, in `palette.accent`. Reads `{family} Family · SKU {sku}`.
  - H1: Oswald 700, `64px / 0.96 line-height / uppercase`. Product name.
  - Tagline: Inter Tight 400, `17px / 1.5 / max-width 540px`, color `palette.inkDim`.
- **Hero placeholder:** `220px` tall, diagonal-stripe fill, label chip "[ PRODUCT HERO ]" + caption.

#### A2. Utility bar (above header)
- `14px 56px` padding, `1px` bottom border in `palette.rule`.
- Mono caps, `11px / 0.08em tracking`, color `palette.inkDim`.
- Three columns: doc id + rev / company / page count.

#### A3. Tabs
- Sticky to top of body. `0 56px` padding on `palette.paper`.
- Two buttons: "Spec Sheet" / "Install Guide". Oswald 600, `14px / 0.12em tracking / uppercase`.
- Inactive: `palette.inkFaint`. Active: `palette.ink` with `2px` bottom border in `palette.accent`.
- Right side: section-of-N indicator in mono caps.

#### A4. Spec Sheet body
- **Overview block:** 5fr/7fr grid. Left = section label + paragraph. Right = 2×2 highlight grid (Material / Footprint / Service life / Origin) inside a `1px` rule border, `4px` radius. Each cell has mono kicker (10px, 0.14em tracking) + Oswald 500 value (17px uppercase).
- **Spec tables:** Three groups — Dimensions / Site & Load Ratings / Material Properties / Compliance. Each:
  - SectionLabel: Oswald 600, 12px/0.16em tracking, uppercase, with `2px` bottom border in `palette.ink`.
  - Table: 50/28/22 column split. Property = inkDim Inter. Value = ink mono 13px. Notes = inkDim mono 13px. `1px` row dividers in `palette.rule`.
- **Dimensional drawing:** Final placeholder, `260px` tall.

#### A5. Install Guide body
- **At-a-glance strip:** 3-column grid (Time / Crew / Tools count) inside a `1px` border. Same kicker+value treatment as highlights.
- **Tools list:** Section label + 2-column `<ul>`. Each item: `18px` square checkbox-style border, label, `1px` row divider.
- **Pre-flight callout:** `palette.chip` background (10–18% accent tint), `1px` accent border, `4px` left accent stripe. Oswald label "Before you begin" + body paragraph.
- **Steps:** Six steps. Each row is an 80px / 1fr / 220px grid:
  - Big numeral (Oswald 700, `56px`, in `palette.accent`, zero-padded).
  - Title (Oswald 600, `20px` uppercase) + body paragraph + optional callout (mono 12px in accent, prefixed with ⚠).
  - Step diagram placeholder, `140px` tall.
- **Warnings:** Section label + list, mono `! 01` prefix in accent, dashed dividers between rows.
- **Warranty card:** `palette.bg` background, Oswald label + body paragraph.

#### A6. Footer
- `palette.bg` background, mono caps 11px, color inkDim. Phone + copyright.

### Variant B — Bold (Rebel Editorial)

#### B1. Crawler bar (top)
- Sky-blue (`#a8d8e8`) on deep teal (`#0e3447`), `8px 32px` padding.
- Oswald 600, `12px / 0.18em tracking / uppercase`.
- Five chips separated by spacing: `★ Made in Lockport, NY` · doc id · `Won't Crack · Won't Crumble · Won't Corrode` · rev · `★ A Rebel Brand`.

#### B2. Hero
- `40px 48px 48px` padding, `1px` bottom border in rule.
- **Top row:** Logo (left) + page count + live chip (right, mono caps).
- **Title row:** 8fr/4fr grid.
  - Left: Eyebrow (mono caps with leading 24px hairline rule) + H1 in **Yellowtail cursive** `168px / 0.85 line-height / -2° rotation / sky-blue`. Word "Mats" in italic. Below: "Since 1995 · Lockport, NY" in salmon Oswald 500, 14px, 0.20em tracking. Tagline 19px white.
  - Right: Three highlight stats stacked. Each has `1px` top border, mono kicker (10px sky-blue), Oswald 500 value (22px uppercase white).

#### B3. Full-bleed hero placeholder
- `280px` tall, diagonal-stripe fill (`#1d5673` / `#16475f`).
- Center: caption chip in mono caps. Four corner crop marks (16×16, 1.5px sky-blue L-brackets).

#### B4. Tabs
- Sticky. Two buttons: `01 — Spec Sheet` / `02 — Install Guide`. Oswald 700, 15px, 0.14em tracking, uppercase.
- Active: sky-blue background, deep-teal text. Inactive: transparent, dim white.

#### B5. Spec Sheet body
- **Pull-quote intro:** 120px / 1fr grid. Left = giant Oswald 700 `"` glyph (96px sky-blue). Right = intro paragraph set in Oswald uppercase 22px.
- **Spec groups:** Each group has a header row — sky-blue chip with two-digit number (Oswald 700, 11px, deep-teal text on sky-blue) + Oswald 600 28px group title + horizontal rule filling remaining width.
- **Spec rows:** 5fr/4fr/3fr grid. Property (15px Inter white). Value (Oswald 600, **22px sky-blue uppercase** — values are the visual hero). Notes (mono 13px dim white).
- **Drawing block:** `320px`, white `palette.paper` panel inverted from the surrounding navy.

#### B6. Install Guide body
- **Stat strip:** 3 columns inside top+bottom rules. Mono kicker (sky-blue 10px) + **Oswald 700, 56px white, line-height 0.9** numeric values.
- **Tools chips:** Flex-wrap row. Each chip: `10px 16px`, `1px` rule border, mono number prefix in sky-blue.
- **Pre-flight banner:** Solid sky-blue background, deep-teal text. 160px label / 1fr body grid. "Read first." in Oswald 700 24px.
- **Steps:** Alternating left/right diagram layout. Diagram column 280px. Body has Oswald 700 88px sky-blue numeral + 28px white title + paragraph + optional callout (salmon-tint background, sky-blue left stripe, mono in sky-blue).
- **Warnings:** 60px / 1fr grid. Big sky-blue Oswald 700 28px number + 15px white text. `1px` row dividers.
- **Warranty card:** `2px` sky-blue border. 160px / 1fr grid. `10YR` in Oswald 700 64px sky-blue + label & body.

#### B7. Footer
- Solid sky-blue, deep-teal text. `32px 48px` padding.
- Left: "Rules are made *to be broken.*" in Oswald 700 32px (italic 400 for "to be broken").
- Right: Mono caps, web + phone.

## Interactions & Behavior
- **Tabs:** Clicking a tab swaps the body between Spec Sheet and Install Guide. State is local to each variant; no URL routing in the prototype, but production should mirror tabs in the URL hash (`#spec` / `#install`) for deep-linking and printing.
- **Tweaks panel** (prototype-only, removable in production):
  - Toggle: dark mode for Variant A.
  - Radio: jump-to tab for each variant.
- **Variant A dark-mode toggle:** Inverts `palette` between light-paper and deep-teal versions. All semantic roles (`bg`, `paper`, `ink`, `inkDim`, `accent`, etc.) swap together.
- **Print:** Both variants are designed at `1100px` artboard width / `1500px` height. For PDF export, force a fixed-width print stylesheet matching the design grid.

## State Management
Minimal:
```ts
type Tab = 'spec' | 'install';
const [tab, setTab] = useState<Tab>('spec');
const [dark, setDark] = useState<boolean>(true); // Variant A only
```
Product data is static (`RF_PRODUCT`). No fetching needed for the prototype, but in production the spec rows / install steps should be CMS-driven (one entry per SKU).

## Design Tokens

### Variant A — Safe (Light)
| Token | Value |
|---|---|
| `bg` | `#f0f7fa` |
| `paper` | `#ffffff` |
| `ink` | `#0e3447` |
| `inkDim` | `rgba(14,52,71,0.70)` |
| `inkFaint` | `rgba(14,52,71,0.38)` |
| `rule` | `rgba(14,52,71,0.18)` |
| `accent` | `#1a6b87` (sky blue, AA on white) |
| `accentWarm` | `#c45947` (salmon, AA on white) |
| `chip` | `rgba(196,89,71,0.10)` |

### Variant A — Safe (Dark)
| Token | Value |
|---|---|
| `bg` | `#0e3447` |
| `paper` | `#16475f` |
| `ink` | `#ffffff` |
| `inkDim` | `rgba(255,255,255,0.74)` |
| `inkFaint` | `rgba(255,255,255,0.40)` |
| `rule` | `rgba(168,216,232,0.32)` |
| `accent` | `#a8d8e8` (sky blue) |
| `accentWarm` | `#f08977` (salmon) |
| `chip` | `rgba(240,137,119,0.18)` |

### Variant B — Bold
| Token | Value |
|---|---|
| `bg` | `#0e3447` (deep teal) |
| `bgDeep` | `#08222e` |
| `ink` | `#ffffff` |
| `inkDim` | `rgba(255,255,255,0.74)` |
| `inkFaint` | `rgba(255,255,255,0.36)` |
| `rule` | `rgba(168,216,232,0.30)` |
| `yellow` (sky blue accent) | `#a8d8e8` |
| `orange` (salmon accent) | `#f08977` |
| `paper` | `#ffffff` (inverted blocks) |

### Typography
- **Display / structural:** Oswald (300/400/500/600/700) — uppercase with 0.005–0.18em tracking depending on size.
- **Body / UI:** Inter Tight (300/400/500/600/700).
- **Monospace (eyebrows, kickers, codes, table values in Variant A):** JetBrains Mono (400/500/600).
- **Cursive display (Variant B H1, Logo wordmark):** Yellowtail.

Type scale used:
```
Logo cursive:    1.7 × size (parametric)
H1 (A):          64px / 0.96 lh
H1 (B):          168px / 0.85 lh / -2° rotate
H3 group (B):    28px Oswald 600 uppercase
Step numeral:    56px (A) / 88px (B)
Stat numeral:    56px (B install)
Eyebrow / kicker: 10–12px mono / 0.14–0.20em
Body:            14–17px Inter Tight
Table value (A): 13px JetBrains Mono
Table value (B): 22px Oswald 600 uppercase
```

### Spacing
- Outer page padding (A): `56px`. (B): `48px`.
- Section gaps: `32–56px`.
- Table row padding: `10–14px` vertical.
- Button padding (tabs): `18–20px` × `28px`.
- Border radius: `2–4px` only (technical/editorial — no large radii).

## Assets
- **Logo:** Generated programmatically in `logo.jsx` (see `<RFLogo>`). Uses Yellowtail web font + an inline SVG flag-stroke. Deliver as SVG once finalized — current React rendering is for prototype reference.
- **Hero / step diagrams:** **Placeholders only.** Diagonal-stripe fills with mono caption chips. RFRP to supply:
  - 1× full-bleed product hero photo (rec. 2200×600 for Variant B's 280px strip)
  - 1× orthographic dimensional drawing (top/side/front)
  - 6× step diagrams (one per install step)
- **Fonts:** Loaded from Google Fonts in the prototype. Production should self-host.

## Files
HTML/JSX prototype files included in this handoff (under `prototype/`):
- `RubberForm Spec & Install.html` — entry point. Loads scripts and renders both variants on a Design Canvas.
- `product-data.jsx` — `RF_PRODUCT` data object (specs, install steps, warnings, warranty). **Single source of truth — both variants read from this.**
- `safe-variant.jsx` — Variant A component + sub-components (`SafePlaceholder`, `SafeSpecBody`, `SafeInstallBody`, `SectionLabel`).
- `bold-variant.jsx` — Variant B component + sub-components (`BoldSpecBody`, `BoldInstallBody`, `BoldStepDiagram`).
- `logo.jsx` — `<RFLogo>` lockup component.
- `design-canvas.jsx`, `tweaks-panel.jsx` — prototype scaffolding (canvas pan/zoom, tweaks panel). **Not for production.**

To preview: open `RubberForm Spec & Install.html` in a browser.
