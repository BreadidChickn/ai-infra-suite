# AI Infra Suite

Public, GrokBot-oriented copy of the **AI Infra Terminal** dashboard and **AI Trader** paper engine. Clone it, configure with plain environment variables or Grok Bot, and use **your own** Alpaca paper keys — never commit secrets.

## Goals

- Ship a runnable Bloomberg-style AI-infrastructure market terminal plus a dry-run / paper trading bot (with an opt-in, at-your-own-risk live mode) that posts into the terminal’s `/api/bot/*` contract.
- Let anyone reproduce the stack with their own credentials (Alpaca paper on the trader; SEC contact + optional bot token on the terminal).
- Keep scope tight: local demo + paper trading by default. Real-money trading is an opt-in switch the owner approved on 2026-10-19, with a disclaimer, typed risk acknowledgement, and hard safety caps. Cloud hosting and public tunnels stay out of scope unless the owner expands it.

## Scope

**In scope**

- `terminal/` — Vite/React dashboard + `server.mjs` / `serve.py` (Yahoo + Google News proxies, SEC snapshot, bot ingest APIs). Default bind `127.0.0.1:4173`.
- `trader/` — Python paper engine (`aitrader/`) that scores sleeves A–E, dry-runs plans, and publishes to the terminal contract via `BOT_API_URL` + shared `BOT_TOKEN`.
- Contract: `terminal/docs/bot-api-contract.md` (also mirrored under `trader/docs/`).

**Out of scope**

- Real-money trading on by default, or without every live condition in `trader/DISCLAIMER.md` (TRADING_MODE=live, DRY_RUN=false, ALLOW_ORDERS=1, exact LIVE_RISK_ACK phrase, separate live keys).
- Margin, shorting, or raising live safety caps by default.
- Bundled API keys, webhook URLs, LAN IPs, personal machine names, or other PII.
- Guaranteeing cloud multi-device sync.

## Project notes

- Re-read this README and `terminal/docs/bot-api-contract.md` before every change.
- Secrets are env-only. Grok Bot is the documented easy path (masked fields in 1:1 chat); plain `.env` / shell / Docker always works. Real environment variables override `.env`.
- Trader defaults to `DRY_RUN=true` and paper Alpaca; orders need `ALLOW_ORDERS=1` and `DRY_RUN=false`. Live mode (`TRADING_MODE=live`) is opt-in at the user's own risk: the repo owner and contributors bear no responsibility for losses or inaccuracies (see `trader/DISCLAIMER.md`). The terminal shows a red LIVE banner when `mode: "live"`.
- If a request inflates scope, degrades performance, or conflicts with Goals/Scope, stop and send the owner an impact report instead of pushing.

## Run with Grok Bot (easiest)

1. Paste into your Grok Bot (1:1 chat):  
   *"Set up AI Infra Suite from github.com/BreadidChickn/ai-infra-suite — configure terminal and trader and run them."*
2. Enter secrets in its **masked fields** only:
   - Terminal: `SEC_USER_AGENT` (required contact), optional `BOT_TOKEN`
   - Trader: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, optional `BOT_TOKEN` (same value), `BOT_API_URL` (default `http://127.0.0.1:4173`)
3. Never paste keys into a group room or commit `.env`.

Half-READMEs have the full one-liner wording: `terminal/README.md`, `trader/README.md`.

## Manual setup (plain environment variables)

```bash
git clone https://github.com/BreadidChickn/ai-infra-suite
cd ai-infra-suite

# Terminal
cd terminal && cp .env.example .env   # or export vars; env wins over .env
# set SEC_USER_AGENT, optional BOT_TOKEN, PORT, HOST
npm install && npm run fetch:sec && npm run build && npm start
# → http://127.0.0.1:4173

# Trader (other shell)
cd ../trader && cp .env.example .env
# set ALPACA_* ; optional BOT_TOKEN / BOT_API_URL / DRY_RUN
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m aitrader.live
```

Bash / PowerShell / cmd / Docker examples live in each half-README. Data sources (Yahoo Finance, Google News, SEC) — check their terms.

## Credential reference

| Variable | Where | Notes |
|---|---|---|
| `SEC_USER_AGENT` | terminal | Required by SEC; placeholder warns until set |
| `BOT_TOKEN` | both | Shared write auth for `/api/bot/*` off loopback |
| `BOT_API_URL` | trader | Default `http://127.0.0.1:4173` |
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | trader | Paper keys only |
| `DRY_RUN` / `ALLOW_ORDERS` | trader | Default dry-run; both gates for live paper orders |
| `PORT` / `HOST` | terminal | Default `4173` / `127.0.0.1` |

See also `docs/SETUP-VIA-GROKBOT.md`, `docs/PROJECT_NOTES.md`.

## License / disclaimer

License TODO — owner chooses (see each half `LICENSE`). Market figures and headlines can be illustrative when live fetch fails — not investment advice.
