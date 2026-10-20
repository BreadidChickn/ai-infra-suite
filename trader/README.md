# AI-Infra Trader

Trading bot (paper by default) that scores the AI-infrastructure / energy universe from the [AI Infra Terminal](../terminal) and runs several $100 sleeves (baseline, AI-signal, placebo, Mock Index baskets, emerging-hedged, SPY, equal-weight).

**Paper by default. Real-money trading is opt-in and entirely at your own risk; see [DISCLAIMER.md](DISCLAIMER.md). Not financial advice.**

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

## Real-money trading (opt-in, at your own risk)

> **Read [DISCLAIMER.md](DISCLAIMER.md) first.** Software is provided as-is, not financial advice; the repo owner and contributors bear no responsibility for any losses. You bear all risk of loss. Backtest and paper results guarantee nothing.

Paper is the default. Live trading (`https://api.alpaca.markets`) is refused unless **all** of these are set:

| Variable | Required value |
|---|---|
| `TRADING_MODE` | `live` |
| `DRY_RUN` | `false` |
| `ALLOW_ORDERS` | `1` |
| `LIVE_RISK_ACK` | exactly `I ACCEPT FULL RISK OF LOSS` |
| `ALPACA_LIVE_API_KEY_ID` / `ALPACA_LIVE_API_SECRET_KEY` | your **live** keys (separate from, and different to, the paper keys) |

Safety rails while live: `LIVE_MAX_CAPITAL` (default $100, across all sleeves) · only `LIVE_SLEEVE` trades (default `B`) · `LIVE_MAX_ORDER_USD` per order · `LIVE_DAILY_LOSS_LIMIT` (default 5%) and `LIVE_STOP_DRAWDOWN` (default 25%), measured on the bot's own sleeve equity (not the whole account), halt trading **and close positions** · sleeve books are rebuilt from Alpaca fills before every run, and a book/broker mismatch halts with no orders · kill switch `state/KILL` or `TRADING_HALT=1` · market hours only · long-only cash, no margin/shorts (EM hedge via SH). Every live order is logged with its reason in `state/live_orders.jsonl` and tagged `LIVE-…`.

On the first live start the disclaimer is printed; in an interactive terminal you must type the phrase. The acknowledgement is logged with a timestamp to `state/live_ack.json` and sent to the dashboard as `live_ack_at` with `mode: "live"` (LIVE banner).

**With Grok Bot:** Grok Bot must show you the full disclaimer in chat and get your explicit confirmation ("I ACCEPT FULL RISK OF LOSS") **before** it sets `LIVE_RISK_ACK`. It runs non-interactively, so the env phrase is the acknowledgement; live keys go into masked secret fields, never into chat. Say "pause", "close all", or "halt" to have it create `state/KILL`.

Tests (mocked broker, no live calls): `python -m unittest discover -s tests -v`

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
