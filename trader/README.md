# AI-Infra Trader

Paper / dry-run engine for the AI Infra Terminal. Lives next to `../terminal` (set `TERMINAL_ROOT` to override).

- `aitrader/config.py` — tunables (period, capital, caps, stops, target return)
- `aitrader/universe.py` — companies + relationships → `aitrader/data/universe.json`
- `aitrader/signals.py` / `portfolio.py` / `live.py` — scoring + dry-run plans
- `aitrader/alpaca.py` — paper-only REST; keys from env only; orders blocked unless `ALLOW_ORDERS=1` and `DRY_RUN=False`
- `aitrader/publisher.py` — posts to terminal `/api/bot/*` per `../terminal/docs/bot-api-contract.md`

Secrets: see repo root `docs/SETUP-VIA-GROKBOT.md`.
