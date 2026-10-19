# AI Infra Terminal

A self-hosted, Bloomberg-style dashboard for the **AI infrastructure market**: chips, foundries, equipment,
EDA/IP, memory, cloud and hyperscalers, AI labs, and the energy companies powering data centers. It shows how
the market is **performing** (SEC 10-K / 10-Q financials, returns, investments, business relationships), what is
**influencing** it (partner investments, news and market sentiment), and the **political / regulatory** risks
around it. An **AI Trader** tab shows the live paper-trading performance and weekly reviews posted by a
separate trading-bot component.

It runs in any modern browser on desktop or mobile. All data comes from free public sources. You don't need
any API keys to run the dashboard.

> **Not financial advice.** This is a research and education tool. Prices, headlines and scores can be delayed,
> incomplete or wrong. The trading-bot integration is designed for **paper trading**. Nothing here guarantees
> any return. Live (real-money) trading is opt-in on the trader side only (`TRADING_MODE=live`, off by default);
> when the bot reports live mode the AI Trader tab shows a red **LIVE TRADING — REAL MONEY** banner.

## Run with Grok Bot (easiest)

Grok Bot sets everything up on its own computer. Your contact email and token never go into a file in the repo
or into the chat.

1. In your Grok Bot chat, say:
   *"Set up the AI Infra Terminal from github.com/BreadidChickn/ai-infra-suite (terminal/ folder) and run it."*
2. Grok Bot clones the repo and builds it (`npm install && npm run build`).
3. Grok Bot opens masked secret fields for:
   - **`SEC_USER_AGENT`**: your contact, e.g. `AI-Infra-Terminal/1.0 you@yourdomain.com`. SEC EDGAR requires it.
   - **`BOT_TOKEN`**: a shared secret for the trading bot's writes. Grok Bot can generate one for you.

   Enter the values there, never in the chat. Grok Bot saves them as environment variables. They are not
   committed and not shown back.
4. Grok Bot starts the server and gives you the link (default `http://127.0.0.1:4173`).

**Alpaca keys are entered only on the trader side**, never here. See the
[AI-Infra Trader README](../trader/README.md). The trader reaches this terminal through **`BOT_API_URL`**
(default `http://127.0.0.1:4173`) and must use the **same `BOT_TOKEN`** value.

## Screenshots

| Network | Markets | AI Trader |
|---|---|---|
| ![Network graph](docs/screenshots/network.png) | ![Markets tab](docs/screenshots/markets.png) | ![AI Trader tab (example data)](docs/screenshots/ai-trader.png) |

The AI Trader screenshot shows records the bot labeled `EXAMPLE DATA`.

## Run options

The terminal needs no API keys. Its only settings are plain environment variables, and a `.env` file is
**optional**. Real environment variables **always win** over `.env`, so any of the methods below works with
no `.env` at all.

### 1. Get the code

**Node.js 20+ (build from source):**

```bash
git clone https://github.com/BreadidChickn/ai-infra-suite && cd ai-infra-suite/terminal
npm install
npm run build               # also refreshes the SEC snapshot (prebuild)
```

**Python 3.8+ only:** `serve.py` uses just the standard library and implements every endpoint `server.mjs`
does, with identical behavior. It serves an already-built `dist/` folder, so use a release archive that
contains `dist/`, or build once with Node.

### 2. Set variables and start

**bash / zsh (macOS, Linux):**

```bash
export SEC_USER_AGENT="AI-Infra-Terminal/1.0 you@yourdomain.com"
export BOT_TOKEN="<your-shared-token>"      # optional on 127.0.0.1, required if HOST is not loopback
python3 serve.py                            # or: node server.mjs
```

The same settings work inline, for one run only:

```bash
PORT=4173 SEC_USER_AGENT="AI-Infra-Terminal/1.0 you@yourdomain.com" python3 serve.py
PORT=8080 node server.mjs
```

**PowerShell (Windows):**

```powershell
$env:SEC_USER_AGENT='AI-Infra-Terminal/1.0 you@yourdomain.com'; python serve.py
# Node: $env:PORT='4173'; node server.mjs
```

**cmd.exe (Windows):**

```bat
set "SEC_USER_AGENT=AI-Infra-Terminal/1.0 you@yourdomain.com" && python serve.py
```

The quotes around the whole `NAME=value` stop cmd from adding a trailing space to the value. The servers trim it
anyway, so the unquoted `set SEC_USER_AGENT=... && python serve.py` also works.

**Docker:** build an image that runs `node server.mjs` or `python serve.py`, then pass settings with `-e`:

```bash
docker run -p 4173:4173 \
  -e HOST=0.0.0.0 -e PORT=4173 \
  -e SEC_USER_AGENT="AI-Infra-Terminal/1.0 you@yourdomain.com" \
  -e BOT_TOKEN="<your-shared-token>" \
  ai-infra-terminal
```

**Cloud hosts (Render, Fly.io, Railway, …):** add `SEC_USER_AGENT`, `BOT_TOKEN` and `HOST=0.0.0.0` as the
host's **secrets / environment variables**. Many hosts set `PORT` themselves. No `.env` file is needed.

**`.env` file (optional):** `cp .env.example .env` and fill it in. Both servers load it at startup, but
anything already set in the real environment wins.

Then open **http://127.0.0.1:4173** (or your `PORT`).

### Dev mode (hot reload)

```bash
npm run dev                 # http://127.0.0.1:5173. Proxies Yahoo / Google News / SEC only.
```

The user-company, Grok Bot and trading-bot endpoints need `server.mjs` or `serve.py`.

### Other devices

By default the server only listens on `127.0.0.1` (this computer). To open it from a phone on the same Wi-Fi:

1. Set `HOST=0.0.0.0` and a `BOT_TOKEN`.
2. Run `hostname -I` (Linux), `ipconfig getifaddr en0` (macOS) or `ipconfig` (Windows) to find the
   computer's private IP.
3. On the phone, open `http://<that-IP>:4173`. Allow inbound TCP 4173 in your firewall.

For access away from home, prefer a private network such as Tailscale, or a proper cloud host, over a public
tunnel. Always set `BOT_TOKEN` when the terminal is reachable by anyone other than you.

## Configuration

Every setting is a plain environment variable (see [Run options](#run-options) for how to set them).
A `.env` file next to the servers is **optional** and is read by both servers and the build script. **Real
environment variables always win over `.env`.** `.env` is git-ignored, and `.env.example` lists every key.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | HTTP port. |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` exposes it on your network. Bot writes then require `BOT_TOKEN`. |
| `SEC_USER_AGENT` | `AI-Infra-Terminal/1.0 your-email@example.com` | **Set your own.** The [SEC fair-access policy](https://www.sec.gov/os/accessing-edgar-data) requires a User-Agent with a real contact. Used by both servers, the dev proxy and `scripts/fetch-sec.mjs`. A warning prints while it is unset. |
| `BOT_TOKEN` | *(empty)* | Shared secret for the trading bot's `POST /api/bot/*` writes (`Authorization: Bearer <token>`). Generate one: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. |
| `GROKBOT_WEBHOOK_URL` | *(empty)* | Optional listener that receives "add company" requests from Search. If unset, `grokbot-webhook.json` is used when present. |
| `GROKBOT_WEBHOOK_AUTH` | *(empty)* | Optional `Authorization` header value sent with those requests. It is never logged or returned. |

Secrets are never printed. On startup the server only reports whether the Grok Bot link and bot token are
configured.

### Security defaults

- **Writes to `/api/bot/*`:**
  - With `BOT_TOKEN` set, every write must carry the token (401 otherwise).
  - Without a token, writes are accepted only from `127.0.0.1` / `::1`, and only while `HOST` is loopback.
  - If `HOST` is not loopback and no token is set, writes are refused (`403 bot_token_required`).
- **Forwarded requests:** requests forwarded by a reverse proxy or tunnel (`X-Forwarded-For`, `CF-Connecting-IP`, …) never count as local.
- **Dashboard signals:** the browser publishes them (`POST /api/signals-snapshot`) without a token from loopback or private-LAN addresses.
- **Local state:** all local state (`.env`, `bot-*.json`, `signals-snapshot.json`, `user-companies.json`, `pending-requests.json`,
  `grokbot-webhook.json`, `.sec-cache/`) is git-ignored. See [SECURITY.md](SECURITY.md).

## Connecting the trading bot

The terminal owns a small JSON API that a trading engine reads from and posts to:

- **Reads:** `GET /api/signals`, `/api/news-feed`, `/api/mock-index`. These are the dashboard's computed signals, published while a
  browser has the terminal open.
- **Writes:** `POST /api/bot/trades`, `/api/bot/equity`, `/api/bot/weekly-report`, `/api/bot/backtest`.
- **Status:** `GET /api/bot/status`.

Full schemas, examples and auth rules are in **[docs/bot-api-contract.md](docs/bot-api-contract.md)**.
The architecture is in [PSEUDOCODE.md](PSEUDOCODE.md).

**Broker keys do not belong in this terminal.** The trading engine is the separate
[AI-Infra Trader](../trader/README.md) component. It owns the Alpaca credentials and reads them from its own
environment. These variable names match the trader's `.env.example`:

| Trader variable | Purpose |
|---|---|
| `BOT_API_URL` | This terminal's base URL (default `http://127.0.0.1:4173`) |
| `BOT_TOKEN` | Same value as the terminal's `BOT_TOKEN` |
| `ALPACA_API_KEY_ID` | Your Alpaca **paper** API key ID |
| `ALPACA_API_SECRET_KEY` | Your Alpaca **paper** secret key |
| `DRY_RUN` / `ALLOW_ORDERS` | Order safety switches (default: dry run, no orders) |

By default the trader uses Alpaca's paper endpoint (`https://paper-api.alpaca.markets`).

**Live mode (opt-in, off by default).** Real-money trading is enabled only on the trader side with
`TRADING_MODE=live` plus the trader's own confirmation steps (see the [trader README](../trader/README.md)).
The trader reports `mode` (`paper` \| `live`) to this terminal; whenever it reports `live`, the AI Trader tab
shows a sticky red **LIVE TRADING — REAL MONEY** banner with the time the risk was accepted, and the header badge
switches from `PAPER` to `LIVE`. The software is provided as is, with no warranty; the repository owner and
contributors carry no responsibility for any losses or inaccuracies, and whoever enables live trading bears the
full risk of loss. See `docs/bot-api-contract.md` → *Trading mode*.

## Secrets and Grok Bot

Keys and tokens (`SEC_USER_AGENT` contact, `BOT_TOKEN`, an optional webhook key, and the trader's Alpaca keys) are
supplied through **Grok Bot's masked secret fields** and saved as environment variables.
**Never paste a key into a chat message, an issue, or a commit.** If a key is ever exposed, revoke it at
the provider and create a new one.

## Data sources and disclaimers

| Source | Used for | Notes |
|---|---|---|
| SEC EDGAR (`data.sec.gov`, `www.sec.gov`) | 10-K / 10-Q / 20-F financials, filings, ticker lists | Public data. Follow SEC fair-access rules: real `SEC_USER_AGENT`, ≤10 requests/s. A build-time snapshot ships in `public/data/sec-financials.json`. |
| Yahoo Finance chart endpoint (`query1.finance.yahoo.com`) | Quotes, daily/intraday prices, benchmarks | **Unofficial, undocumented** endpoint. It may change or rate-limit at any time and is subject to Yahoo's terms. Intended for personal, non-commercial use. |
| Google News RSS (`news.google.com`) | Headlines for News Pulse and sentiment | Subject to Google's terms. Headlines link to the original publishers. Cached 15 min server-side. |
| Curated seed data (`src/data/*`) | Companies, relationships, market caps, themes, glossary | Hand-compiled from public reports with source links. Private-company valuations are estimates and labeled as such. May be out of date. |

When live sources fail, the UI falls back to curated data and labels it **ILLUSTRATIVE** / **SEED · OFFLINE**.
Nothing is investment advice. Past or simulated (paper/backtest) performance does not predict real results.

## Project layout

```
server.mjs, serve.py     two interchangeable servers (same endpoints, same JSON)
scripts/fetch-sec.mjs    build-time SEC snapshot → public/data/sec-financials.json
src/                     React + TypeScript app (components/, services/, data/, lib/)
docs/                    bot-api-contract.md, screenshots/
PSEUDOCODE.md            architecture & pseudocode
.env.example             configuration template (copy to .env)
```

Stack: Vite · React · TypeScript · react-force-graph-2d · Recharts · Express (or Python stdlib).

## License

**TODO (owner):** no license has been chosen yet. Until a `LICENSE` file is added, all rights are reserved by the
copyright holder. Add one before accepting outside contributions.

See also: [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

---

# Feature reference

## Tabs

1. **Network** — Force-directed graph of companies & relationships. Node size ∝ √ market cap; color by segment; edges by relationship type. Zoom/pan/drag; filters; legend; tooltips. **Layer** toggle: All / Hide energy / ⚡ Energy + linked; energy nodes carry a dashed amber ring and cluster left; amber dotted edges = power / fuel supply.
2. **Markets** — Performance table (1D / 1M / YTD) with AI-infra vs energy segment filter, YTD bar chart, sentiment gauge (uses live news score), compact **News Pulse** (Today / Week / Month tabs) and a compact **market drill-down** grid. Tap/click a row or card for company drill-down (SEC + outside investors + AI/data-center link for energy names).
3. **Relationships** — Layer (All / AI infra / Energy ↔ AI), type and company filters, grouped lists, adjacency matrix, detail panel.
4. **Sentiment & Politics** — **News Pulse** (Top 3 today, Top 5 this week, Top 10 this month), **market drill-down** cards for every market, composite = 50 % curated themes + 50 % live news, theme scores, political concerns, Trump–Xi spotlight.
5. **Mock Index** — Build a weighted basket, composite scores, horizon returns; sentiment uses the basket-weighted live news score of each member's market; baskets persist in localStorage.
6. **Financials** — Direct SEC filings breakdown per company (picker, Quarterly | Annual, focus-period chips):
   revenue (total, products/services where tagged, QoQ/YoY), costs (cost of revenue, R&D, SG&A, opex, SBC),
   profit & margins (expansion/compression explainer), investment flows in/out (OCF, capex, FCF, M&A,
   securities, buybacks, dividends, debt, diluted shares; TTM + history), and a rule-based retail-investor
   impact view with a not-investment-advice disclaimer. Deep link: `/?tab=financials`.
   Metric labels carry small ⓘ buttons that open the matching Glossary entry.
7. **Glossary** — 123 financial / industry / energy terms in 7 categories (filings, income statement, cash flow &
   investments, markets & valuation, index/risk/sentiment, AI infra & policy, energy & power for AI). Each has a plain-English
   definition, an illustrative example sentence with “how to read it”, clickable related terms, and links to
   the tab where it appears. Search + category chips + A–Z index (desktop list/detail; mobile sticky search
   and accordion cards). Deep links: `/?tab=glossary`, `/?tab=glossary&term=gross-margin`.

## SEC financials data

- Source: SEC XBRL **companyfacts** (`data.sec.gov/api/xbrl/companyfacts/CIK##########.json`) via the `/api/sec` proxy (polite User-Agent).
- `scripts/fetch-sec.mjs` writes a compact snapshot to `public/data/sec-financials.json` (copied to `dist/data/`).
  It runs automatically as `prebuild` (skips if < 24h old); force a refresh with `npm run fetch:sec`.
- In the tab, every figure is badged **LIVE SEC** (pulled this session through `/api/sec`), **SNAPSHOT** (build-time JSON),
  or shown as **N/A**; curated narrative text is badged **ILLUSTRATIVE**. Each value links to its EDGAR filing index (accession number).
- Quarterly cash-flow values are often derived from year-to-date filings (YTD − prior YTD, Q4 = FY − 9M) and are tagged `YTD-diff`;
  arithmetic fallbacks (e.g. gross profit = revenue − cost of revenue, FCF = OCF − capex) are tagged `calc`.
- Product vs service splits are XBRL dimensions, which companyfacts omits, so they show N/A rather than estimates.
- Foreign filers: TSMC (IFRS, TWD) and ASML (US GAAP, EUR) have annual 20-F data only. Samsung, SK hynix, SMIC, SoftBank are not SEC XBRL filers and private companies have no filings → N/A.
- Shared extractor: `src/lib/secExtract.mjs` (used by both the Node script and the browser).

## Data

- **Curated JSON** always loads so the UI is never blank (companies, market caps, relationships, seed headlines/themes).
- **Live enrichment** (no API keys): Yahoo Finance chart endpoint for every public ticker (incl. ENR.DE, VWS.CO, NESTE.HE); Google News RSS for headlines, proxied by `server.mjs` / `serve.py` (15-min cache).
- Header badge: **LIVE** / **MIXED** / **ILLUSTRATIVE** depending on what succeeded.

Private companies (OpenAI, Anthropic, Cerebras, Groq, etc.) use estimated valuations labeled as such.

8. **AI Trader**: paper-trading performance, holdings, trades with the signals behind them, weekly reviews and the
   backtest posted by the trading bot (`?tab=trader`).

## SpaceX (SPCX) — added Oct 8, 2026

- **Status:** Space Exploration Technologies Corp., CIK `0001181412`, public since the Jun 12, 2026 Nasdaq IPO (ticker `SPCX`). Before the IPO it filed only Regulation D notices (paper REGDEX 2002–2008, Form D / D/A 2009–2022).
- **Financials:** pulled from XBRL companyfacts like every other filer. Only one 10-Q exists so far (quarter ended Jun 30, 2026), so:
  - Quarterly income-statement figures: Q2 2026 / Q2 2025 as filed; Q1 2026 / Q1 2025 derived as 6M − Q2 (tagged `YTD-diff`).
  - Cash flows are only filed year-to-date (6M) → shown in a "Year-to-date cash flows — as filed" table; single-quarter cash flows and Annual view are N/A until more filings arrive.
  - The extractor (`src/lib/secExtract.mjs`) now keeps YTD totals (`ytd`) only when no discrete quarters exist and they are newer than the last annual period.
- **Filing history:** `scripts/fetch-sec.mjs` now also stores per-company submissions (form counts + recent key filings) under `filings` in `public/data/sec-financials.json`; SpaceX also has a verified milestone timeline in `src/data/secMeta.ts` (`FILING_PROFILES`).
- **Market cap / returns:** node size uses ≈$2.21T (MarketCapLens, Oct 8, 2026). 6M / YTD returns are N/A (pre-IPO) and excluded from Mock Index averages.
- **Deep links:** `/?tab=network&focus=spacex`, `/?tab=financials&company=spacex`.

## Search + add any SEC filer — added Oct 8, 2026

**Where:** desktop — the search box in the header (press `/` to focus, `Esc` to close, ↑/↓ + Enter to open an indexed hit);
mobile — the magnifier button in the header opens a full-screen search sheet (cards, 44px targets, full-width Add).

Two result groups:

1. **In the terminal** — built-in companies (name, ticker, short code, aliases such as "Alphabet" → Google, CIK) plus anything you added.
   Buttons jump to **Financials** (`?tab=financials&company=<id>`) or **Network** focus (`?tab=network&focus=<id>`).
2. **SEC EDGAR — not in the terminal yet** — every SEC filer with a ticker (from `www.sec.gov/files/company_tickers_exchange.json`,
   falling back to `company_tickers.json`, via the local `/api/sec-www` proxy, cached 24h in memory and in `.sec-cache/`). A bare CIK
   (4–10 digits) is also looked up directly on EDGAR. The top hits are checked against `data.sec.gov/submissions/CIK##########.json`:
   only filers with **10-K, 10-Q, 20-F, 40-F, S-1 or F-1** (amendments count) can be added; others show
   *"No formal financial filings - can't add"* and the Add button is disabled. The server re-verifies before saving.

**Add to terminal** pulls the filer's XBRL company facts through `/api/sec`, runs the same extractor as the build-time snapshot
(`src/lib/secExtract.mjs`), and the company appears immediately in the Financials picker under *"Added by you (pending full
integration)"* with **LIVE SEC** badges, its EDGAR filing list, and N/A wherever a fact isn't tagged — nothing is estimated.
Remove it from its Financials banner or from the search panel (empty query lists everything you added). Once a CIK ships in the
built-in data, the user entry is shown as "Now built in" and the built-in company is used instead.

### Local state files (next to the server, git-ignored, never in the tarball)

| File | What |
| --- | --- |
| `user-companies.json` | Companies you added: `cik, ticker, name, addedAt, updatedAt, formalForms, fin` (cached extracted financials), `filings` |
| `pending-requests.json` | Every Grok Bot add request with `status` (`sent` / `queued` / `failed`), `attempts`, `lastAttemptAt`, `httpStatus`, `error` |
| `grokbot-webhook.json` | Optional Grok Bot link (see below) |
| `.sec-cache/` | Disk copy of the SEC ticker files (24h) |

If the server endpoints are unreachable the browser falls back to `localStorage` ("Saved in this browser only").

### Grok Bot link (add requests)

Every Add also calls `POST /api/grokbot-request` with
`{"type":"add_company","cik":"0001769628","ticker":"CRWV","name":"CoreWeave, Inc.","requestedAt":"<ISO time>","note":"optional"}`.
The server always records it in `pending-requests.json`, and if `GROKBOT_WEBHOOK_URL` is set (or `grokbot-webhook.json` exists) it forwards the same JSON:

```json
{
  "url": "https://YOUR-GROK-BOT-LISTENER-URL",
  "authorization": "PASTE-THE-KEY-EXACTLY-AS-GIVEN"
}
```

1. Preferred: set `GROKBOT_WEBHOOK_URL` and `GROKBOT_WEBHOOK_AUTH` in `.env` (via Grok Bot's secure secret entry). Alternative: copy `grokbot-webhook.example.json` to `grokbot-webhook.json` next to `serve.py` / `server.mjs`.
2. Use the listener URL and key Grok Bot gave you. The key is sent verbatim as the `Authorization` header (include any
   `Bearer ` prefix only if it was given that way), with `Content-Type: application/json`. It is never logged or returned by any endpoint.
3. The JSON file is re-read on each request (no restart needed); `.env` changes need a server restart. The search panel / Financials banner shows **Grok Bot link: configured**.
4. Requests that were *queued* (no webhook yet) or *failed* can be re-sent with **Retry** in the UI (or `POST /api/grokbot-request/retry`).

Requests are de-duplicated by CIK: once one is `sent`, adding the same company again does not resend it. Redirects are not
followed (so the key never goes to another host); a non-2xx answer marks the request `failed` with its HTTP status.

### API (identical in `server.mjs` and `serve.py`)

| Method & path | Body / result |
| --- | --- |
| `GET /api/sec-www/<path>` | Proxy to `https://www.sec.gov/<path>` (SEC User-Agent). `/files/company_tickers.json` and `/files/company_tickers_exchange.json` cached 24h (`X-Cache: HIT/MISS/STALE`) |
| `GET /api/user-companies` | `{companies:[...]}` |
| `POST /api/user-companies` | `{cik, name, ticker?, fin?, filings?}` → `{company, created}`; 400 `invalid_input`, 404 `cik_not_found`, 422 `no_formal_filings`, 413 `too_large` (4 MB), 502 `sec_unavailable` |
| `DELETE /api/user-companies/<cik>` | `{removed, cik}` |
| `GET /api/grokbot-status` | `{configured: boolean}` only |
| `POST /api/grokbot-request` | `{type:"add_company", cik, name, ticker?, requestedAt?, note?}` → `{request, deduped}` |
| `GET /api/grokbot-request` | `{configured, requests:[...]}` |
| `POST /api/grokbot-request/retry` | `{cik?}` → `{configured, retried, requests}` (re-sends `queued` / `failed`) |

Validation: CIK must be 1–10 digits (stored zero-padded to 10), name 1–200 chars, ticker ≤ 12 chars `[A-Za-z0-9.-]`, note ≤ 500 chars.

## Energy layer, News Pulse & market drill-down — added Oct 8, 2026

### Energy companies (`src/data/energyCompanies.ts`)
26 **public** companies with a documented AI / data-center link. Every entry has `aiLink`
`{summary, strength: strong|moderate|weak, source, url, date}`, a CIK where it files with the SEC, and a
`capSource` explaining its market cap (shares × Yahoo price, Oct 8 2026). Segments: utilities & IPPs,
nuclear (operators/SMRs/fuel), natural gas & midstream, gas turbines & on-site power, solar & renewables,
wind, geothermal, biofuels/RNG (labelled **THIN LINK**), grid & electrical equipment. Relationships to AI
names live in `energyRelationships` (type `power_supply` etc.); qualitative Financials notes in
`src/data/energyFinNotes.ts`. US/Canadian filers get SEC XBRL financials via `npm run fetch:sec`
(the script now reads `companies.ts` **and** `energyCompanies.ts`); Siemens Energy, Vestas and Neste are not
SEC filers → N/A.

### News Pulse (`src/services/newsFeed.ts`, `src/hooks/useNewsFeed.ts`, `src/components/NewsPulse.tsx`)
- On every open, if the copy saved in localStorage (`ai-infra:news-feed:v1`) is older than **15 min**, the
  browser fetches 20 Google News RSS searches through `/api/news` (AI segments, policy, SpaceX and each
  energy market). **↻ Refresh** forces a refetch and sends `X-Refresh: 1` so the server skips its cache.
- Near-duplicates (Jaccard ≥ 0.6 on title words) merge; extra outlets count as coverage.
- Tagging: companies by name/alias (namesakes such as Constellation Brands are excluded), markets by
  company segment + market keywords; category by rule weights → Political / Investment / Operations-production / Other.
- Sentiment: lexicon with negation, squashed `s/√(s²+6)` → −1…+1.
- Rank = 0.40·relevance + 0.30·recency + 0.20·source quality + 0.10·coverage, minus a small diversity penalty;
  windows: Top 3 (24 h), Top 5 (7 d), Top 10 (30 d).
- Market / overall score = weighted mean (weight = quality × e^(−age/240h) × (1 + 0.25·log₂(1+dupes))).
- Offline → curated seed headlines with a **SEED · OFFLINE** badge.

### Market drill-down (`src/data/markets.ts`, `src/components/MarketDrilldown.tsx`)
Per market: 30-day score, trend (last 7 d vs days 8–30), 4-week sparkline, and a driver table where
**contribution** = Σ(w·s) of a category ÷ Σw of all the market's headlines × 100 (contributions add up to the
market score) and **share** = Σw of the category ÷ Σw. Each category expands to a rule-based "how this affects
AI infrastructure" sentence + curated note + its headlines; "Affected companies" links to Financials and the
company drill-down. Desktop: side panel; mobile: full-screen sheet with collapsible sections.

### `/api/news` cache (identical in `server.mjs` and `serve.py`)
`GET /api/news/<google-news-path>` — 15-minute in-memory cache keyed by path+query (max 200 entries, only
HTTP 200 cached). Header `X-Refresh: 1` bypasses it. If Google News fails, a cached copy ≤ 24 h old is
served. Response headers: `X-Cache: HIT | MISS | REFRESH | STALE | BYPASS`, `X-Cache-Age: <seconds>`,
`Cache-Control: no-store`.

## Round 2 additions (Oct 2026)

- **Tab order:** Network · Markets · Relationships · Sentiment · Financials · Mock Index · Glossary (desktop header and mobile BottomNav). `?tab=` deep links are unchanged.
- **Markets:** a "read the scores together" strategy callout (links to Sentiment, not financial advice). The YTD chart shows **SEC filers only**: companies with a CIK in `secMeta`/company data (10-K/10-Q or 20-F/40-F/6-K). Non-filers (SoftBank, Samsung, SMIC, SK hynix, Siemens Energy, Vestas, Neste) and private companies are excluded. The tooltip YTD uses P&L colours.
- **Sentiment:** the composite gauge and Spotlight sit at the top. A sticky composite pill appears once the gauge scrolls away: top-right on desktop, above the BottomNav on mobile. "This month" is a collapsed dropdown.
- **Theme Scores** (`src/services/themeScores.ts`): each theme maps to keywords, markets and categories. score = round(100·Σ(w·s)/Σw) over matching feed headlines from the last 30 days, using the same weight as the market drill-down: w = quality × e^(−age/240h) × (1 + 0.25·log2(1+duplicates)). It needs ≥ 2 matches, otherwise it uses the curated seed (badge NEWS·n / SEED). Colour bands: ≥ +15 green, −15…+15 yellow, ≤ −15 red. Composite = 50% theme average + 50% News Pulse.
- **Mock Index → Estimated vs actual 1D (Experimental)** (`src/services/intraday.ts`, `MockIndexExperimental.tsx`): Yahoo 5-minute intraday via `/api/yahoo`. Auto mode uses the last 3h while the US session is open or ended < 2h ago, otherwise end of day (latest close vs prior close). Shows per-member and index estimate vs actual, the gap, a benchmark split (SOXX/QQQ/SPY) and matching feed headlines. Missing data shows N/A.
- **Financials:** "AI products & services" panel (`src/data/aiExposure.ts`) for all 61 curated companies. AI exposure tag (Pure-play / Major / Partial / Indirect). Diversified companies get a whole-company notice and their most AI-relevant segment, named only. User-added companies get a neutral "no curated description yet".

## AI Trader tab + trading-bot API — added Oct 17, 2026

- New **AI Trader** tab (`?tab=trader`, between Mock Index and Glossary): live paper P&L, equity vs SPY/QQQ/SOXX (+ a saved Mock Index basket), drawdown, Sharpe/Sortino/win rate/turnover, holdings & exposure, trades with signal chips, weekly reports (printable) and backtest — filterable by sleeve A–E. Auto-refreshes every 60 s. Shows only what the bot posted; empty/offline states otherwise.
- The terminal now serves the bot API: `GET /api/signals`, `/api/news-feed`, `/api/mock-index` (published by the open dashboard) and `POST/GET /api/bot/{trades,equity,weekly-report,backtest}`, `GET /api/bot/status`. Full schemas: `docs/bot-api-contract.md`. Architecture: `PSEUDOCODE.md`.
- Bot writes need `BOT_TOKEN` (env / `.env`, or legacy `bot-token.json`); see [Security defaults](#security-defaults).
