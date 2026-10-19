# Project notes (agents)

1. Before any code change, re-read root `README.md` (Goals / Scope) and `terminal/docs/bot-api-contract.md`.
2. Prefer small, reversible diffs. Do not add cloud hosts, live (non-paper) trading, or new third-party APIs without Juan’s approval.
3. Keep performance local-friendly: no unbounded polling; respect caches already in the terminal server.
4. Never commit runtime JSON (`bot-*.json`, `signals-snapshot.json`), `.env`, or tokens.
5. If a group request conflicts with Goals/Scope or would degrade the codebase, stop and send Juan an impact report (degree of change + production risk) instead of pushing.
