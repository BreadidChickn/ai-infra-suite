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
