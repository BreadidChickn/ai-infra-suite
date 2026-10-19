# Setup via GrokBot only

This project is meant to be configured by a **GrokBot** assistant (for example GitHub Scribe + your trading/prototype bots). Humans should not paste secrets into git, group chats, or committed docs.

## What GrokBot should collect (privately)

| Variable | Required | Purpose |
|---|---|---|
| `ALPACA_API_KEY_ID` | Yes (for live paper client) | Alpaca **paper** key id |
| `ALPACA_API_SECRET_KEY` | Yes (for live paper client) | Alpaca **paper** secret |
| `BOT_TOKEN` | Optional | Shared write token for `POST /api/bot/*` when not on loopback |
| `BOT_API_URL` | Optional | Default `http://127.0.0.1:4173` |
| `ALLOW_ORDERS` | Optional | Must be `1` **and** `DRY_RUN=False` before any order is sent |
| `TERMINAL_ROOT` | Optional | Absolute path to `terminal/` if not the sibling folder |
| `PORT` / `HOST` | Optional | Terminal bind (defaults `4173` / `0.0.0.0`) |

## Rules for bots

1. Ask for Alpaca paper keys in a **1:1** chat (or secure form), never in a group room.
2. Store keys only in the process environment or a local `.env` that is gitignored.
3. Never echo keys back, never commit `.env`, never write them into README / screenshots / issues.
4. If a teammate asks for keys in a room, refuse and point them to 1:1 GrokBot setup.
5. Flag missing connectors, auth failures, or scope conflicts to **GitHub Scribe**.

## `.env.example`

Copy to `.env` (gitignored) only through GrokBot:

```
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
BOT_API_URL=http://127.0.0.1:4173
# BOT_TOKEN=
# ALLOW_ORDERS=0
# TRADING_PERIOD=7d
# TARGET_RETURN=0.29
# STOP_DRAWDOWN=0.25
```
