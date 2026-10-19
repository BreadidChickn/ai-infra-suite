# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
**"Report a vulnerability"** button (Security → Advisories) on this repository to send a private report,
or contact the maintainers privately as listed on the repository profile.

Include what you found, steps to reproduce, and the impact. We aim to acknowledge reports within a few days.

## Secrets: never commit them

- Configuration lives in `.env`, which is **git-ignored**. Only `.env.example` (placeholders, no real values)
  is committed.
- Never commit or paste into issues/chats: `BOT_TOKEN`, `GROKBOT_WEBHOOK_AUTH`, broker keys
  (`ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`), or files such as `grokbot-webhook.json` and `bot-token.json`.
- Broker (Alpaca) keys belong only to the separate trading-engine component, never to this terminal.
- When setting up with Grok Bot, enter secrets through its secure secret entry; they are stored as environment
  variables, not in chat history.
- If a secret leaks, **revoke and rotate it** at the provider immediately; removing it from git history is not
  enough.

## Safe defaults

- The server binds to `127.0.0.1` by default.
- `POST /api/bot/*` requires `BOT_TOKEN` whenever one is set, and is refused entirely when the server is bound
  to a non-loopback address without a token. Requests relayed by a proxy/tunnel are never treated as local.
- Secrets are never logged or returned by any endpoint.
- If you expose the terminal beyond your own machine, set `BOT_TOKEN`, prefer a private network (e.g. Tailscale)
  or an authenticated reverse proxy, and use paper-trading credentials only.

## Supported versions

Only the latest commit on the default branch receives fixes.
