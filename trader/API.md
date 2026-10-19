# AI-Trader ⇄ AI Infra Terminal API (conforms to contract v1)
Source of truth: `/workspace/ai-infra-terminal/docs/bot-api-contract.md` (read-only). Base `http://127.0.0.1:4173` (env `BOT_API_URL`).
Code: `aitrader/publisher.py` (mapping), `aitrader/publish_all.py` (run), `aitrader/terminal_api.py` (reads). Samples: `outbox/*.json`.

## Auth
`Authorization: Bearer $BOT_TOKEN` if env `BOT_TOKEN` is set (never logged); otherwise no header — the server allows loopback writes when it has no token.

## Reads (§3) — fallback on 503 `no_snapshot`
| GET | used for | fallback |
|---|---|---|
| `/api/signals` | `news.company_score` → news_sent, `mock_index.sentiment` → mock_sentiment (skipped if `stale`) | Python port of newsFeed.ts |
| `/api/news-feed` | `composite.score` → market_news_sent (risk-off) | Python port |
| `/api/mock-index` | reserved (basket formulas) | own basket_scores() |

## Writes (§4) and mapping (§6)
| Endpoint | Built from | Mapping |
|---|---|---|
| `POST /api/bot/trades` `{"trades":[…]}` | `state/plan_YYYYMMDD.json` orders | `symbol→ticker`, `client_order_id→id`+`order_id`, `notional` string→number, `qty = notional/price` (or exit qty), `price` = last close, `status:"dry_run"` until fills exist, `timeframe:"weekly"`, `reason.text` + `reason.signals` |
| `POST /api/bot/equity` `{"equity":[…]}` | `state/sleeves.json` books at mark | one record per sleeve: `equity`, `cash`, `positions[{ticker,qty,price,market_value}]` |
| `POST /api/bot/backtest` | `reports/phase2_5y/metrics_5y.csv` | fractions ×100 → `cagr_pct,total_return_pct,vol_pct,max_dd_pct,hit_rate_pct`; `note` has stop variant + target verdict; `newer_names_flagged` = emerging list |
| `POST /api/bot/weekly-report` | backtest equity, last week | `target_flag` = any sleeve annualised < 29; `why` = per-sleeve WHY; marked `example:true` while it is simulated |

Sleeves: `A` Baseline, `B` AI-Infra, `C` Placebo, `D_SPY`, `D_EW`, `E` Mock Index baskets, `EM` Emerging (hedged).
`reason.signals` names: `news_sent, mock_sentiment, mock_growth, mock_risk, sec_fin_score, sec_rev_yoy, rel_degree, graph_sent, mom_6m_skip1w, vol_60d, trend_sma50, b_score` (null = N/A). Momentum is 6-month skip-1-week, so it is not called `mom_12_1`.
Timestamps ISO-8601 UTC `Z`. Percent fields are percent units.
Verify: `GET /api/bot/status`, `/api/bot/{trades,equity,weekly-report,backtest}`.
