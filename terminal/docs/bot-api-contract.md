# AI Infra Terminal ⇄ Trading Bot API contract (v1)

The **terminal server owns the API**. `server.mjs` (Node/Express) and `serve.py` (Python stdlib) implement
every endpoint below with identical validation, status codes and JSON. Default base URL:
`http://127.0.0.1:4173`.

## 1. Auth

| Endpoint kind | Rule |
|---|---|
| All `GET` | Open (read-only). |
| `POST /api/bot/*` | If a token is configured (env `BOT_TOKEN`, else `bot-token.json` → `{"token":"…"}` next to the server): header `Authorization: Bearer <token>` (or `X-Bot-Key: <token>`) required → else **401** `{"error":"unauthorized"}`. If no token is configured: only loopback (`127.0.0.1` / `::1`) may write → else **403** `{"error":"forbidden"}`. |
| `POST /api/signals-snapshot` | Published by the dashboard in the browser. Allowed with a valid token, or without a token from loopback / private-LAN IPs (10/8, 172.16/12, 192.168/16). |

Errors: `400 {"error":"invalid_json"}`, `400 {"error":"invalid_input","field":"<path>"}` (first failing field,
e.g. `trades[2].reason.text`), `413 {"error":"too_large"}` (body > 4 MiB), `503 {"error":"no_snapshot"}`.

## 2. Sleeves

Every bot record carries `sleeve` + `sleeve_label`.

| code | label |
|---|---|
| `A` | Baseline (momentum + trend) |
| `B` | AI-Infra (dashboard signals) |
| `C` | Placebo |
| `D` | Benchmarks — sub-codes allowed: `D_SPY`, `D_EW`, … |
| `E` | Mock Index — sub-codes allowed, e.g. `EM` (emerging names) |

`sleeve` must match `^[A-E][A-Z0-9_]{0,12}$`; `sleeve_label` is a 1–60 char string.

## 3. Read-only signals (for the bot)

Scoring runs in the dashboard's TypeScript (`src/services/newsFeed.ts`, `themeScores.ts`, `mockScores.ts`).
To keep the formulas **identical to the UI**, the browser builds the snapshot with the same functions
(`src/services/signals.ts → buildSignalsSnapshot`) and `POST`s it to `/api/signals-snapshot` ~1.5 s after
quotes + news load and after every refresh. The server persists it to `signals-snapshot.json` and serves the
three parts below. **A browser tab must have opened the terminal at least once**; check `age_seconds` /
`stale` (true when > 1 h old). Until then the GETs return `503 no_snapshot`.

Every part carries: `schema` (`"ai-infra-signals/v1"`), `generated_at`, `news_mode` (`live|cache|seed`),
`news_fetched_at`, `quotes` (`live|illustrative`), `sec_generated_at`, `received_at`, `age_seconds`, `stale`.

### GET /api/signals
```jsonc
{ "schema": "ai-infra-signals/v1", "...meta": "…",
  "companies": [{
    "id": "nvidia", "ticker": "NVDA", "name": "NVIDIA", "segment": "chip_designer", "segment_label": "Chip Designer",
    "market": "chips", "country": "US", "is_private": false, "ipo_date": null, "market_cap_b": 4400,
    "returns": { "d1": 1.2, "m1": 5.3, "q1": 12.1, "m6": 30.2, "ytd": 41.0 },   // % ; null unless live quotes loaded
    "news": { "company_score": 18.4, "company_count": 22, "market_score": 9.1 }, // −100…100; null = no headlines
    "mock_index": { "sentiment": 63, "risk": 31, "profitability": 75, "growth": 72 }, // single-name basket, 0…100
    "sec": { "cik": "0001045810", "currency": "USD", "fetchedAt": "…",
             "metrics": { "revenue": { "annual": {"end":"2026-01-25","val":1.3e11,"form":"10-K"}, "quarterly": {…} },
                          "operatingIncome": {…}, "netIncome": {…}, "ocf": {…}, "capex": {…} } },  // null if no XBRL
    "relationship_degree": 14,
    "ai_link": null   // energy names: { strength, summary, source }
  }] }
```

### GET /api/news-feed
```jsonc
{ "...meta": "…",
  "composite": { "score": 7.9, "count": 412, "trend": 2.1 },
  "top": { "day": [Item×≤3], "week": [Item×≤5], "month": [Item×≤10] },
  "markets": [{ "id": "chips", "label": "AI Chips & Semis", "score": 9.1, "count": 88, "trend": -1.2,
                "weekly": [4, 7, 12, 9],
                "categories": [{ "category": "political", "count": 12, "avg": -20.5, "contribution": -3.1, "share": 0.15 }, …] }],
  "themes": [{ "id": "export-controls", "name": "Export Controls", "score": -22, "political": true }],
  "items": [Item×≤150]   // ranked by week rank
}
// Item = { id, title, source, url, published_at, sentiment (−1…1), weight, rank, category, tags[], markets[], companies[] }
```
Formulas (same as UI): `weight = quality × e^(−ageH/240) × (1 + 0.25·log2(1+dupes))`;
market/composite score = `100 × Σ(w·sentiment)/Σw` over the last 30 days;
`rank = 0.40·relevance + 0.30·recency + 0.20·quality + 0.10·coverage`.

### GET /api/mock-index
```jsonc
{ "...meta": "…",
  "formula": { "sentiment": "clamp(50 + 0.25*themeAvg + 20*basketMarketNews/100 + 1.5*basket1D%, 0, 100)", "risk": "…", "profitability": "…", "growth": "…" },
  "inputs": { "theme_avg": 3.4, "market_scores": { "chips": 9.1, "cloud": null }, "headline_count": 61 },
  "companies": [{ "id": "nvidia", "ticker": "NVDA", "sentiment": 63, "risk": 31, "profitability": 75, "growth": 72 }] }
```
To score a custom basket, apply `formula` with your weights to the per-company inputs in `/api/signals`
(the UI's implementation is `computeMockScores` in `src/services/mockScores.ts`).

## 4. Write endpoints (bot → terminal)

All POSTs upsert and answer `200 {"ok":true,"added":n,"updated":n,"total":n}` (backtest: `{"ok":true}`).
Records are stored in `bot-trades.json`, `bot-equity.json`, `bot-reports.json`, `bot-backtest.json` next to the
server (git-ignored, never in the tarball). Timestamps: ISO-8601 **with zone** (`Z` or `±hh:mm`); the server
normalises them to UTC `…sss Z`. Optional `"example": true` marks sample data; the tab shows an
**EXAMPLE DATA** tag on it.

### POST /api/bot/trades — single object or `{"trades":[…≤500]}`; upsert key `id`; cap 20 000
JSON Schema:
```json
{
  "type": "object",
  "required": ["id", "ts", "ticker", "side", "qty", "price", "sleeve", "sleeve_label", "reason"],
  "properties": {
    "id": { "type": "string", "minLength": 1, "maxLength": 80 },
    "ts": { "type": "string", "format": "date-time" },
    "ticker": { "type": "string", "pattern": "^[A-Z0-9.\\-]{1,12}$" },
    "side": { "enum": ["buy", "sell", "short", "cover"] },
    "qty": { "type": "number", "exclusiveMinimum": 0 },
    "price": { "type": "number", "exclusiveMinimum": 0 },
    "sleeve": { "type": "string", "pattern": "^[A-E][A-Z0-9_]{0,12}$" },
    "sleeve_label": { "type": "string", "minLength": 1, "maxLength": 60 },
    "reason": {
      "type": "object", "required": ["text"],
      "properties": {
        "text": { "type": "string", "minLength": 1, "maxLength": 4000 },
        "signals": { "type": "object", "maxProperties": 40,
          "additionalProperties": { "type": ["number", "string", "boolean", "null"], "maxLength": 200 } }
      }
    },
    "status": { "enum": ["filled", "partially_filled", "submitted", "canceled", "rejected", "dry_run"] },
    "notional": { "type": "number" }, "fee": { "type": "number" },
    "order_id": { "type": "string", "maxLength": 80 }, "timeframe": { "type": "string", "maxLength": 20 },
    "example": { "type": "boolean" }
  }
}
```
Signal names are grouped into chips by keyword: `news|sent|headline` → News, `mock|index|basket` → Mock Index,
`sec|fin|revenue|margin|ocf|capex|eps` → SEC, `rel|graph|degree|network|partner` → Relationships,
`mom|trend|vol|price|rsi` → Price. Suggested names: `news_sent`, `mock_sentiment`, `mock_risk`, `sec_rev_yoy`, `rel_degree`, `mom_12_1`.

EXAMPLE:
```json
{ "trades": [{ "id": "B-20261017-MSFT-buy", "ts": "2026-10-17T13:35:00Z", "ticker": "MSFT", "side": "buy",
  "qty": 0.0342, "price": 500.12, "sleeve": "B", "sleeve_label": "AI-Infra", "status": "filled",
  "timeframe": "weekly", "order_id": "B-20261017-MSFT-buy",
  "reason": { "text": "EXAMPLE — top-4 AI-infra composite; positive cloud news week.",
    "signals": { "news_sent": 0.21, "mock_sentiment": 64, "sec_rev_yoy": 0.18, "rel_degree": 19, "mom_12_1": 0.31 } },
  "example": true }] }
```

### POST /api/bot/equity — single object or `{"equity":[…≤500]}`; upsert key `sleeve|ts`; cap 50 000
```json
{
  "type": "object",
  "required": ["ts", "sleeve", "sleeve_label", "equity", "cash", "positions"],
  "properties": {
    "ts": { "type": "string", "format": "date-time" },
    "sleeve": { "type": "string", "pattern": "^[A-E][A-Z0-9_]{0,12}$" },
    "sleeve_label": { "type": "string", "minLength": 1, "maxLength": 60 },
    "equity": { "type": "number", "minimum": 0 },
    "cash": { "type": "number" },
    "positions": { "type": "array", "maxItems": 500, "items": {
      "type": "object", "required": ["ticker", "qty"],
      "properties": {
        "ticker": { "type": "string", "pattern": "^[A-Z0-9.\\-]{1,12}$" },
        "qty": { "type": "number", "description": "negative = short" },
        "avg_cost": { "type": "number" }, "price": { "type": "number" },
        "market_value": { "type": "number" }, "unrealized_pl": { "type": "number" },
        "hedge": { "type": "boolean" } } } },
    "example": { "type": "boolean" }
  }
}
```
EXAMPLE:
```json
{ "ts": "2026-10-17T20:00:00Z", "sleeve": "B", "sleeve_label": "AI-Infra", "equity": 100.42, "cash": 0.31,
  "positions": [{ "ticker": "MSFT", "qty": 0.0342, "avg_cost": 500.12, "price": 503.0, "market_value": 17.2, "unrealized_pl": 0.1 },
                { "ticker": "SH", "qty": 0.1, "price": 40.0, "market_value": 4.0, "hedge": true }], "example": true }
```
Post one record per sleeve at least daily (hourly is better). The tab's equity curve, P&L, drawdown, Sharpe,
Sortino and turnover are computed only from these records.

### POST /api/bot/weekly-report — one object; upsert key `week_start_week_end`; cap 520
```json
{
  "type": "object",
  "required": ["week_start", "week_end", "sleeves", "benchmarks", "target_flag", "why", "missed", "paper_vs_real"],
  "properties": {
    "week_start": { "type": "string", "format": "date" }, "week_end": { "type": "string", "format": "date" },
    "sleeves": { "type": "array", "minItems": 1, "maxItems": 20, "items": {
      "type": "object", "required": ["sleeve", "sleeve_label", "return_pct"],
      "properties": { "sleeve": {"type":"string"}, "sleeve_label": {"type":"string"}, "return_pct": {"type":"number"},
        "start_equity": {"type":"number"}, "end_equity": {"type":"number"}, "annualized_pct": {"type":"number"},
        "max_drawdown_pct": {"type":"number"}, "trades": {"type":"number"}, "win_rate": {"type":"number"} } } },
    "benchmarks": { "type": "array", "maxItems": 20, "items": { "type": "object", "required": ["name", "return_pct"],
      "properties": { "name": {"type":"string","maxLength":40}, "return_pct": {"type":"number"} } } },
    "target_flag": { "type": "boolean", "description": "true = behind the >29% annualised pace" },
    "target_annual_pct": { "type": "number", "default": 29 },
    "summary": { "type": "string", "maxLength": 4000 },
    "why": { "type": "string", "minLength": 1, "maxLength": 20000 },
    "missed": { "type": "array", "maxItems": 50, "items": { "type": "object", "required": ["kind", "detail"],
      "properties": { "kind": { "enum": ["info", "prediction", "stat"] }, "detail": { "type": "string", "maxLength": 2000 } } } },
    "paper_vs_real": { "type": "array", "minItems": 1, "maxItems": 30, "items": { "type": "string", "maxLength": 2000 } },
    "went_right": { "type": "array", "maxItems": 30, "items": { "type": "string" } },
    "went_wrong": { "type": "array", "maxItems": 30, "items": { "type": "string" } },
    "example": { "type": "boolean" }
  }
}
```
EXAMPLE:
```json
{ "week_start": "2026-10-12", "week_end": "2026-10-16",
  "sleeves": [{ "sleeve": "B", "sleeve_label": "AI-Infra", "return_pct": 0.4, "annualized_pct": 23.0, "trades": 6 },
              { "sleeve": "D_SPY", "sleeve_label": "SPY buy&hold", "return_pct": 0.6 }],
  "benchmarks": [{ "name": "SPY", "return_pct": 0.6 }, { "name": "SOXX", "return_pct": 1.4 }],
  "target_flag": true, "target_annual_pct": 29,
  "summary": "EXAMPLE — B lagged SPY by 0.2 pp.",
  "why": "EXAMPLE — utilities overweight lagged as semis rallied on earnings.",
  "missed": [{ "kind": "info", "detail": "EXAMPLE — TSMC monthly sales beat." },
             { "kind": "prediction", "detail": "EXAMPLE — expected export-control headline did not land." },
             { "kind": "stat", "detail": "EXAMPLE — 1-week news IC was negative." }],
  "paper_vs_real": ["Paper fills ignore slippage and partial fills on fractional orders."],
  "went_right": ["EXAMPLE — MSFT add"], "went_wrong": ["EXAMPLE — DUK overweight"], "example": true }
```

### POST /api/bot/backtest — one object; replaces the stored backtest
```json
{ "type": "object", "required": ["generated_at", "rows"],
  "properties": {
    "generated_at": { "type": "string", "format": "date-time" },
    "period": { "type": "string", "maxLength": 80 }, "universe_note": { "type": "string", "maxLength": 2000 },
    "rows": { "type": "array", "minItems": 1, "maxItems": 30, "items": { "type": "object", "required": ["sleeve", "sleeve_label"],
      "properties": { "sleeve": {"type":"string"}, "sleeve_label": {"type":"string"}, "cagr_pct": {"type":"number"},
        "total_return_pct": {"type":"number"}, "vol_pct": {"type":"number"}, "sharpe": {"type":"number"},
        "max_dd_pct": {"type":"number"}, "hit_rate_pct": {"type":"number"}, "note": {"type":"string","maxLength":300} } } },
    "newer_names_flagged": { "type": "array", "maxItems": 200, "items": { "type": "string", "maxLength": 12 } },
    "example": { "type": "boolean" } } }
```
Percent fields are **percent units** (50.0 = 50 %), not fractions.

## 5. Read-back GETs (used by the AI Trader tab)

| GET | Response | Query |
|---|---|---|
| `/api/bot/trades` | `{"trades":[…]}` sorted by `ts` | `sleeve=B,C`, `since=<iso>`, `limit=n` (last n) |
| `/api/bot/equity` | `{"equity":[…]}` sorted by `ts` | same |
| `/api/bot/weekly-report` | `{"reports":[…]}` sorted by `week_end` | same (`since` vs `week_end`) |
| `/api/bot/backtest` | `{"backtest":{…}\|null}` | — |
| `/api/bot/status` | `{"token_configured","trades":{count,last},"equity":{count,last},"reports":{count,last},"backtest":bool,"signals_received_at"}` | — |

## 6. Mapping from the bot's current provisional publisher

`aitrader/publisher.py` currently POSTs one `provisional-v0` blob to `/api/ai-trader/snapshot` with header
`X-Bot-Key`. That path does not exist; split it into: each filled order → `/api/bot/trades`, each sleeve book
(`state/sleeves.json`) valued at mark; `orders[].symbol` → `ticker`, `client_order_id` → `id`/`order_id`, string `notional` → number; only fills (or `status:"dry_run"`) become trades; `market_news_sent` is already on `/api/news-feed` `composite.score`; → `/api/bot/equity`, `reports/metrics.csv` → `/api/bot/backtest`
(convert fractions to percent), and the weekly review → `/api/bot/weekly-report`. `X-Bot-Key` is accepted
as an alternative to `Authorization: Bearer`.
