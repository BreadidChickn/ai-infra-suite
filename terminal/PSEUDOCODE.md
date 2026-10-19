# AI Infra Terminal — pseudocode & architecture

Local-first "Bloomberg terminal" for the AI-infrastructure market (chips, foundry, equipment, EDA/IP,
cloud/hyperscalers, AI labs, energy). Vite + React + TypeScript SPA served by **either** `server.mjs`
(Node/Express) **or** `serve.py` (Python stdlib). The two servers MUST stay behaviour-identical.

```
repo/
  server.mjs, serve.py          # same endpoints, same JSON, same validation
  scripts/fetch-sec.mjs         # builds public/data/sec-financials.json (SEC XBRL snapshot)
  src/App.tsx                   # tab router (?tab=), global data loading, news hook, signals publisher
  src/data/*                    # curated seed data: companies, relationships, markets, headlines, glossary…
  src/services/*                # pure logic: marketData, newsFeed, themeScores, mockScores, signals, trader, sec*
  src/components/*Tab.tsx       # one component per tab (+ drill-downs, search, nav)
  docs/bot-api-contract.md      # trading-bot API (JSON Schemas + EXAMPLE payloads)
```

## 1. Boot / data flow (App.tsx)

```
on app open:
  data      ← loadMarketData()                  # seed companies + live Yahoo quotes (1y daily) → change1D/1M/1Q/6M/YTD
  news      ← useNewsFeed(companies, seeds)     # localStorage cache if <15 min old, else fetchLiveFeed()
  headlines ← toHeadlines(news.items) ∪ curated political/spotlight seeds
  newsScore ← sentimentFor(news.items).score
  marketScores[m] ← sentimentFor(items, market=m).score  (null when no headlines)
  themes    ← deriveThemes(seedThemes, news.items, live)
  user      ← useUserCompanies()                # /api/user-companies (SEC filers added via Search)
  mode      ← LIVE if quotes and news live, MIXED if one, else ILLUSTRATIVE
  after quotes+news settle (1.5 s debounce):
     POST /api/signals-snapshot ← buildSignalsSnapshot(...)   # feeds the trading bot
render Header (desktop tabs) / BottomNav (mobile ≤768px or coarse pointer ≤1024px)
tabs: network, markets, relationships, sentiment, financials, mock, trader, glossary
URL params: ?tab=  &company= (financials)  &focus= (network)  &term= (glossary)
```

## 2. Servers (server.mjs ≡ serve.py)

| Endpoint | Behaviour |
|---|---|
| `GET /api/yahoo/*` | proxy → query1.finance.yahoo.com, 12 s timeout, 502 `{error:"proxy_failed"}` |
| `GET /api/news/*` | proxy → news.google.com RSS; 15-min memory cache; `X-Refresh: 1` bypass; ≤24 h STALE fallback |
| `GET /api/sec/*` | proxy → data.sec.gov with SEC User-Agent |
| `GET /api/sec-www/files/company_tickers*.json` | proxy → www.sec.gov, 24 h disk cache `.sec-cache/` |
| `GET/POST/DELETE /api/user-companies` | user-added SEC filers (`user-companies.json`); POST verifies formal forms (10-K/10-Q/20-F/40-F/S-1/F-1) on EDGAR |
| `GET /api/grokbot-status`, `GET/POST /api/grokbot-request`, `POST …/retry` | forwards "add company" requests to the Grok Bot webhook (`grokbot-webhook.json`), queue in `pending-requests.json` |
| `POST /api/signals-snapshot` | dashboard publishes computed signals → `signals-snapshot.json` (token or loopback/LAN) |
| `GET /api/signals`, `/api/news-feed`, `/api/mock-index` | parts of the snapshot + `received_at`, `age_seconds`, `stale` (>1 h); 503 `no_snapshot` |
| `GET/POST /api/bot/trades`, `/api/bot/equity`, `/api/bot/weekly-report`, `/api/bot/backtest`, `/api/bot/status` (GET adds `mode`) | trading-bot records (see docs/bot-api-contract.md) |
| `/*` | static `dist/`, SPA fallback to index.html |

Common rules: JSON body cap 4 MiB (413), `invalid_json` 400, `invalid_input` 400 with `field`, file writes
are atomic (tmp + rename) and serialised (Node promise lock / Python `STATE_LOCK`).

Bot write auth:
```
token ← env BOT_TOKEN or bot-token.json.token
if token: require "Authorization: Bearer token" or "X-Bot-Key: token" (constant-time compare) else 401
else:     only 127.0.0.1/::1 may write, else 403
signals-snapshot additionally allows private-LAN IPs without a token (it is the browser publishing)
```
Record validation (identical both sides): sleeve `^[A-E][A-Z0-9_]{0,12}$` + label; ISO timestamps with
zone, normalised to UTC ms; tickers `^[A-Z0-9.\-]{1,12}$`; numbers finite (booleans rejected); upsert keys
trades=`id`, equity=`sleeve|ts`, reports=`week_start_week_end`; caps 20k/50k/520 (oldest dropped).

## 3. Scoring formulas (all in src/services, reused by the snapshot so bot == UI)

### News (newsFeed.ts)
```
NEWS_QUERIES (≈40 Google News RSS queries) → parseRss → dedupe (token-set Jaccard, dupes counted)
enrich(item):
  companies ← tagCompanies(title)     markets ← tagMarkets(title, companies) (keywords + company segment)
  category  ← classify(title) ∈ {political, investment, operations, other}
  sentiment ← scoreSentiment(title): phrases + lexicon, negation ×−0.7, s = Σ/√(Σ²+6) ∈ (−1,1)
  quality   ← sourceQuality(source) tier 0..1
  relevance ← min(1, 0.25·min(#companies,2) + 0.15·min(#markets,2) + 0.25·[core AI-infra term])
rankScore(i,w) = 0.40·relevance + 0.30·e^(−ageH/τw) + 0.20·quality + 0.10·min(1, log2(1+dupes)/3),  τ = day 12h, week 72h, month 240h
topForWindow: day 3, week 5, month 10 — greedy pick with diversity penalty −0.08/repeat company, −0.04/repeat market
sentimentWeight(i) = quality · e^(−ageH/240) · (1 + 0.25·log2(1+dupes))
sentimentFor(items, market?) over last 30 days:
  score = 100·Σ(w·s)/Σw ;  categories[c].contribution = 100·Σc(w·s)/Σw (sums to score)
  trend = score(≤7 d) − score(8–30 d) ; weekly = 4 weekly buckets
```
### Theme scores (themeScores.ts)
```
for each seed theme with regex rule: matches = last-30-day items hitting keywords (or markets+categories)
score = round(100·Σ(w·s)/Σw) if ≥2 matches else curated seed score
band: green ≥ +15, red ≤ −15, else yellow
```
### Mock Index (mockScores.ts — used by Mock Index tab and /api/mock-index)
```
weights: equal = 1/n ; mcap = max(cap,0.1)/Σ
wavg(f, horizonDays) skips members whose IPO is younger than 0.85·horizon
sentiment     = clamp(50 + 0.25·avg(theme scores) + 20·wavg(marketScore/100) + 1.5·wavg(1D%), 0, 100)
risk          = clamp(35·privateShare + 40·(CN|TW share) + 2.5·avg(|1D| + 0.3·|1M|) + 15, 0, 100)
profitability = clamp(40 + 35·share(YTD>0) + clamp(0.35·wavg(YTD), −20, 25), 0, 100)
growth        = clamp(50 + 0.9·(0.3·wavg(1M) + 0.35·wavg(1Q) + 0.2·wavg(YTD)), 0, 100)
per-company scores in /api/signals = single-member equal-weight basket
```
### SEC financials (lib/secExtract.mjs, services/secFinancials.ts, finAnalysis.ts)
```
companyfacts (us-gaap | ifrs-full) → per metric: annual (10-K/20-F FY) + quarterly (10-Q; Q4 & cash flows by YTD-diff)
metrics: revenue(+products/services), costOfRevenue, rnd, sga, opex, operatingIncome, netIncome, grossProfit,
         ocf, capex, acquisitions, investPurchases/Proceeds, buybacks, dividends, debtIssued…
badges: LIVE SEC (fetched now) / SNAPSHOT (public/data/sec-financials.json) / N/A — never invented
QoQ, YoY deltas; TTM sums; derived values tagged calc / ytd-diff
```

## 4. Tabs

- **Network** — force graph (react-force-graph-2d), node radius ∝ √market cap, ticker inside, P&L colour ring, relationship edges by type.
- **Markets** — strategy note; performance chart (SEC filers only), YTD tooltip green when up; News Pulse (3/5/10); per-market drill-down (political/investment/operations contribution + AI-infra impact text); company drill-down with SEC links.
- **Relationships** — relationship types/filters, outside-infra investors (> $1M).
- **Sentiment** — sticky composite gauge + Spotlight at top; Today/This Week lists, This Month dropdown; theme scores (white label, green/yellow/red figure); market drill-down.
- **Financials** — SEC revenue/cost/profit with sources, cash-flow in/out (QoQ, YoY), retail-investor impact, "what it sells to AI" + whole-company earnings notice.
- **Mock Index** — custom basket, weights, 1D/1M/1Q/6M/YTD, four scores; Experimental panel compares previous-day 1D with realised 3h / EOD move (note: the "estimate" is not yet a true forecast).
- **AI Trader** (new) — see §5.
- **Glossary** — definitions + worked examples; deep-link `?term=`.
- **Search** — indexed companies, any SEC filer (EDGAR tickers), add to Financials + Grok Bot add request.

## 5. AI Trader tab (components/TraderTab.tsx, services/trader.ts)

```
every 60 s while tab open: loadTraderData() = GET /api/bot/status, trades, equity, weekly-report, backtest
sleeves ← distinct (sleeve, label) in equity ∪ trades; filter chips (multi-select); headline sleeve (default B)
mode ← currentMode(): status.mode, else newest equity/trade record's mode; only "live" is live, anything else → paper
if mode = live: sticky red banner (role=alert, top: header height) "LIVE TRADING — REAL MONEY",
  "Enabled with TRADING_MODE=live · Risk accepted <local time of live_ack_at>", as-is / no-warranty /
  no-liability / full-risk-of-loss text
header strip: status (ENGINE ACTIVE if last equity < 2 h old, IDLE, OFFLINE on fetch error), mode badge (PAPER blue-grey | LIVE red),
  last update (viewer local time), equity, day/week P&L (value − value ≥24h/7d ago), since inception,
  annualised pace = (E_last/E_first)^(365/days) − 1  (null before 7 days) vs 29 % goal bar;
  red flag banner when pace < 29 % → link to latest weekly report
performance: range 1D/1W/1M/YTD/ALL(=since first bot record); lines = % change from range start for each
  selected sleeve + SPY/QQQ/SOXX (/api/yahoo) + optional saved Mock Index basket (weighted, rebased);
  drawdown = E/peak − 1 of headline sleeve
metrics per sleeve (real records only, else N/A):
  return, alpha = return − SPY return (same window), Sharpe/Sortino = daily returns (last record per day)
  ×√252 (≥5 days), max DD, win rate = closing trades vs running avg cost, turnover = traded notional / avg equity
holdings: latest equity record per sleeve → qty, avg cost, price, unrealised P&L, weight = MV/equity;
  hedge rows highlighted (hedge flag or qty<0); exposure by terminal market (segment → market) gross
  tickers → Financials drill-down (or Markets when untracked)
trades feed: last 200, side badge, rationale text, signal chips grouped by name keyword
  (News / Mock Index / SEC / Relationships / Price / Other)
weekly review: list (⚑ = target_flag) + reader: summary, sleeves vs benchmarks table, went right/wrong,
  why, missed[] (Information / Prediction / Statistic), paper-vs-real caveats; Print/PDF (print CSS isolates reader)
backtest: rows from /api/bot/backtest (CAGR coloured vs 29 %), newer names flagged
records with example:true show an "EXAMPLE DATA" tag; no record → empty state; no fabricated numbers
```

## 6. Trading bot integration (separate trader component; see docs/bot-api-contract.md)

```
bot reads   GET /api/signals, /api/news-feed, /api/mock-index   (check stale / age_seconds)
bot writes  POST /api/bot/trades (fills), /api/bot/equity (per sleeve, hourly/daily),
            /api/bot/weekly-report (weekly, with target_flag/why/missed/paper_vs_real), /api/bot/backtest
auth        Authorization: Bearer $BOT_TOKEN; no token → loopback only when HOST is loopback,
            refused (403 bot_token_required) when HOST is not loopback; proxied requests never count as local
sleeves     A baseline · B AI-Infra · C placebo · D benchmarks (D_SPY, D_EW) · E Mock Index (EM …)
mode        trader switch TRADING_MODE=live (off by default). Bot sends mode "paper"|"live" (+ live_ack_at when live)
            on trades/equity and POST /api/bot/status {mode, live_ack_at?, ts?} → bot-status.json.
            Server keeps only valid values (unknown → dropped → paper). GET /api/bot/status.mode = newest of
            status / last equity / last trade by ts (tie → live); also live_ack_at, mode_source, mode_ts
```

## 7. Local state files (git-ignored, never shipped in the tarball)

`user-companies.json`, `pending-requests.json`, `grokbot-webhook.json`, `.sec-cache/`, `signals-snapshot.json`,
`bot-trades.json`, `bot-equity.json`, `bot-reports.json`, `bot-backtest.json`, `bot-status.json`, `bot-token.json`, and `.env`.

## 8. Build / ship

```
cp .env.example .env                    # set SEC_USER_AGENT (+ BOT_TOKEN if HOST is not 127.0.0.1)
npm install && npm run build            # → dist/  (prebuild refreshes the SEC snapshot)
node server.mjs  |  python serve.py     # both read .env
tar -czf ai-infra-terminal-portable.tgz dist server.mjs serve.py package.json package-lock.json README.md .env.example grokbot-webhook.example.json
```

## 9. Configuration (server.mjs ≡ serve.py ≡ scripts/fetch-sec.mjs)

```
loadDotEnv(.env next to the server)       # KEY=VALUE, # comments, optional "export ", quotes stripped;
                                          # real env vars win; values never printed
PORT            default 4173
HOST            default 127.0.0.1 (LAN: 0.0.0.0 → BOT_TOKEN required for /api/bot/* writes)
SEC_USER_AGENT  default "AI-Infra-Terminal/1.0 your-email@example.com" (warning printed when unset)
BOT_TOKEN       shared secret for POST /api/bot/* (fallback: bot-token.json)
GROKBOT_WEBHOOK_URL / GROKBOT_WEBHOOK_AUTH   optional; fallback: grokbot-webhook.json
```
