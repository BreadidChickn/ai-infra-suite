# Security

## Secrets
- **Never** commit `.env`, Alpaca keys, `BOT_TOKEN`, or `bot-token.json`.
- Keys are read only from the environment (`ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `BOT_TOKEN`). The code never prints them.
- Paper trading is the default. Live/paper **order placement** requires both `DRY_RUN=false` and `ALLOW_ORDERS=1`; otherwise every order stays dry-run.

## Auth to the AI Infra Terminal
- `POST /api/bot/*` uses `Authorization: Bearer $BOT_TOKEN` (contract also accepts `X-Bot-Key`).
- If no token is configured on the terminal, only loopback (`127.0.0.1`) may write. Do not expose the terminal to the public internet without a token.

## Reporting a vulnerability
Contact the repo owner privately. Do not open a public issue that includes credentials, account numbers, or order details.

## Scope
This project is for education and paper trading. It is not licensed investment advice. Treat any live-money use as at-your-own-risk and under your own compliance rules.

## Real-money trading (opt-in)
- Default is paper. Live requires **all** of `TRADING_MODE=live`, `DRY_RUN=false`, `ALLOW_ORDERS=1`, `LIVE_RISK_ACK="I ACCEPT FULL RISK OF LOSS"`, and **separate** live keys `ALPACA_LIVE_API_KEY_ID` / `ALPACA_LIVE_API_SECRET_KEY` (rejected if equal to the paper keys). Anything missing → paper; the reasons are listed in the plan file.
- Live keys can move real money: store them only in your own `.env` or a secret manager, give them the narrowest broker permissions available, and rotate them if they are ever exposed. Never paste them into chat, issues or logs.
- Hard rails (cannot be turned off by config, only tuned): `LIVE_MAX_CAPITAL` across all sleeves, one `LIVE_SLEEVE`, `LIVE_MAX_ORDER_USD`, `LIVE_DAILY_LOSS_LIMIT` and `LIVE_STOP_DRAWDOWN` (measured on the bot's own sleeve equity; halt + sell only the live sleeve's own positions with tagged orders, never the rest of the account, then stay halted until `state/LIVE_HALTED.json` is removed), market hours only, long-only cash (no shorts/margin; hedges via SH).
- Kill switch: `touch state/KILL` or `TRADING_HALT=1` stops new orders immediately, including mid-batch.
- Every live order is logged with its reason and `LIVE-` client_order_id prefix in `state/live_orders.jsonl`. `state/` is git-ignored — keep it private.
- Automated agents (e.g. Grok Bot) must show `DISCLAIMER.md` and get explicit human confirmation in chat before setting `LIVE_RISK_ACK`. Tests use a mocked broker and never call the live endpoint.
