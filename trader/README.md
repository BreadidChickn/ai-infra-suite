# AI-Infra Trader

Paper-trading bot that scores the AI-infrastructure / energy universe from the [AI Infra Terminal](../ai-infra-terminal) and runs several $100 sleeves (baseline, AI-signal, placebo, Mock Index baskets, emerging-hedged, SPY, equal-weight).

**Education / paper only — not financial advice.**

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # BOT_API_URL, BOT_TOKEN, Alpaca paper keys
# start the terminal at http://127.0.0.1:4173 and open it once in a browser
.venv/bin/python -m aitrader.live          # dry-run plan → state/plan_YYYYMMDD.json
.venv/bin/python -m aitrader.publish_all   # POST trades/equity/backtest/weekly-report
.venv/bin/python -m aitrader.backtest5y    # 5y walk-forward → reports/phase2_5y/
```

Orders are never placed unless `DRY_RUN=false` **and** `ALLOW_ORDERS=1`.

## Layout

| Path | Role |
|---|---|
| `aitrader/` | Package: signals, strategies, backtest, Alpaca paper client, publisher |
| `docs/bot-api-contract.md` | Terminal ⇄ bot API (copied from the terminal release) |
| `PSEUDOCODE.md` / `API.md` | Strategy + publisher mapping |
| `reports/` | Example 3y / 5y backtest charts and metrics |
| `outbox/` | Sample POST bodies (`status: dry_run`) |
| `.env.example` | `BOT_API_URL`, `BOT_TOKEN`, Alpaca paper keys |

Sleeves: `A` baseline, `B` AI-Infra, `C` placebo, `D_SPY`, `D_EW`, `E` Mock Index baskets, `EM` emerging (hedged).

## Env names (match the terminal)

| Variable | Purpose |
|---|---|
| `BOT_API_URL` | Terminal base URL (default `http://127.0.0.1:4173`) |
| `BOT_TOKEN` | Bearer token for `POST /api/bot/*` (same name the terminal reads) |
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | Alpaca **paper** keys |

See `SECURITY.md`. License: see `LICENSE` (TODO — owner chooses).
