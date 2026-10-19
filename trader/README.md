# AI-Infra Trader

Paper-trading bot that scores the AI-infrastructure / energy universe from the [AI Infra Terminal](../terminal) and runs several $100 sleeves (baseline, AI-signal, placebo, Mock Index baskets, emerging-hedged, SPY, equal-weight).

**Education / paper only — not financial advice.**

## Setup — pick one

Every setting is a plain environment variable, so any method works. Precedence: real environment variables win over `.env`.

### Option A: Run with Grok Bot (easiest)

Grok Bot sets everything up on its own computer, and your keys never touch a file or the chat.

1. Create a free [Alpaca](https://alpaca.markets) account and generate **paper** API keys.
2. In your Grok Bot chat, say: *"Set up the AI-Infra Trader from github.com/BreadidChickn/ai-infra-suite and connect my Alpaca paper account."*
3. Grok Bot opens two masked fields, **Alpaca API Key ID** and **Alpaca Secret Key**. Paste your keys there (never into the chat). It saves them as `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`.
4. Grok Bot installs dependencies, starts the terminal, checks the Alpaca connection, and runs a dry-run plan. Ask it for the backtest, daily reports, or to start a paper run.

Orders still need your explicit go-ahead (`DRY_RUN=false` and `ALLOW_ORDERS=1`).

### Option B: Manual (any machine with Python 3.10+)

```bash
git clone https://github.com/BreadidChickn/ai-infra-suite && cd ai-infra-suite/trader
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Then provide your keys in **any** of these ways:

| Method | How |
|---|---|
| `.env` file (auto-loaded) | `cp .env.example .env` and fill in values. Point elsewhere with `AITRADER_ENV=/path/to/file`. |
| Shell (macOS/Linux) | `export ALPACA_API_KEY_ID=... ALPACA_API_SECRET_KEY=...` |
| PowerShell (Windows) | `$env:ALPACA_API_KEY_ID="..."; $env:ALPACA_API_SECRET_KEY="..."` |
| Docker / CI / cloud host | Set them as container env vars or repository/host secrets. |

Run:

```bash
# start the terminal (see ../terminal) at http://127.0.0.1:4173 and open it once in a browser
.venv/bin/python -m aitrader.live          # dry-run plan -> state/plan_YYYYMMDD.json
.venv/bin/python -m aitrader.publish_all   # POST trades/equity/backtest/weekly-report
.venv/bin/python -m aitrader.backtest5y    # 5y walk-forward -> reports/phase2_5y/
```

Never commit `.env` (it is git-ignored). Orders are never placed unless `DRY_RUN=false` **and** `ALLOW_ORDERS=1`.

## Data sources

Prices come from Yahoo Finance and news from Google News RSS, proxied by the terminal; financials come from SEC EDGAR. These are free but have their own terms of use. Check them before any commercial or high-volume use.

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
| `DRY_RUN` / `ALLOW_ORDERS` | Order safety switches (default: dry-run, no orders) |
| `TRADING_PERIOD`, `STOP_DRAWDOWN`, `TARGET_RETURN` | Strategy tunables |
| `AITRADER_ENV` | Optional path to a custom `.env` file |

See `SECURITY.md`. License: see `LICENSE` (TODO — owner chooses).
