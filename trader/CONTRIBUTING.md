# Contributing

## Setup
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill BOT_API_URL / BOT_TOKEN / Alpaca paper keys
```

The AI Infra Terminal should be running at `BOT_API_URL` (default `http://127.0.0.1:4173`) so `/api/signals` is available. Without a browser-published snapshot the bot falls back to its own Python port of the scoring formulas.

## Workflow
1. Keep changes small and focused.
2. Dry-run first: `.venv/bin/python -m aitrader.live` writes `state/plan_YYYYMMDD.json` and places **no** orders.
3. Publish to the terminal with `.venv/bin/python -m aitrader.publish_all` (or the publisher helpers) — still dry-run until the owner approves live paper.
4. Do not commit `cache/`, `state/`, `.env`, or anything under a personal Alpaca account.

## Style
- Python 3.10+. Prefer clear names over cleverness.
- Never invent missing data — use `null` / `N/A`.
- Signal names and sleeve codes must match `docs/bot-api-contract.md`.
- Env names for the terminal stay `BOT_TOKEN` and `BOT_API_URL` (see `.env.example`).

## Pull requests
- Describe what changed and how you tested (backtest command, dry-run plan path, GET `/api/bot/status` after publish).
- No secrets in the diff. No force-pushes to main.
