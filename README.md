# AI Infra Suite

Public, GrokBot-oriented copy of the **AI Infra Terminal** dashboard and **AI Trader** paper engine. Clone it, hand it to a GrokBot assistant, and insert **your own** Alpaca paper keys — never commit secrets.

## Goals

- Ship a runnable Bloomberg-style AI-infrastructure market terminal plus a dry-run / paper trading bot that posts into the terminal’s `/api/bot/*` contract.
- Let anyone reproduce the stack with their own Alpaca paper credentials, configured only through GrokBot (no keys in git, chat dumps, or docs).
- Keep scope tight: local demo + paper trading. Live (non-paper) brokerage, cloud hosting, and public tunnels are out of scope unless Juan explicitly expands it.

## Scope

**In scope**

- `terminal/` — Vite/React dashboard + `server.mjs` / `serve.py` (Yahoo + Google News proxies, SEC snapshot, bot ingest APIs).
- `trader/` — Python paper engine (`aitrader/`) that scores sleeves A–E, dry-runs plans, and publishes to the terminal contract.
- Contract docs: `terminal/docs/bot-api-contract.md`.
- Placeholder env files and GrokBot setup instructions only.

**Out of scope**

- Real (non-paper) order routing.
- Bundled API keys, webhook URLs, LAN IPs, personal machine names, or other PII.
- Guaranteeing cloud multi-device sync (local loopback / LAN only unless you add your own host).

## Project notes

- **Source of truth for layout and APIs:** this README + `terminal/docs/bot-api-contract.md`. Agents must re-read them before every change.
- **Secrets:** `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, optional `BOT_TOKEN` — env only. GrokBot sets them; they must never appear in commits, screenshots of env files, or public docs.
- **Defaults:** trader `DRY_RUN=True`; orders require `ALLOW_ORDERS=1` and `DRY_RUN=False`. Paper Alpaca base URL only.
- **Change policy:** if a request inflates scope, degrades performance, or conflicts with Goals/Scope, stop and send Juan an impact report instead of pushing.
- **SEC snapshot:** run `npm run fetch:sec` inside `terminal/` after install (not shipped in this repo to keep the tree small).

## Quick start (after GrokBot has set your env)

```bash
# Terminal
cd terminal
npm install
npm run fetch:sec   # first time / when stale
npm run build && npm start
# → http://127.0.0.1:4173

# Trader (separate shell; same machine)
cd trader
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt   # if present; else: pip install requests pandas
# GrokBot should have exported ALPACA_* into this environment
python -m aitrader.live           # dry-run plan → state/ + optional POST to terminal
```

Open `http://127.0.0.1:4173/?tab=trader` once the bot has published.

## Credential setup

See [docs/SETUP-VIA-GROKBOT.md](docs/SETUP-VIA-GROKBOT.md). **Do not** paste Alpaca keys into this repository or into group chats.

## License / disclaimer

Personal / local use. Market figures and headlines can be illustrative when live fetch fails — not investment advice.
