# Contributing

Thanks for helping out! A few ground rules:

1. **Setup:** `cp .env.example .env`, set `SEC_USER_AGENT`, then `npm install && npm run build && node server.mjs`.
2. **Keep the two servers identical.** Any endpoint or validation change in `server.mjs` must be mirrored in
   `serve.py` (same status codes, same JSON), and documented in `docs/bot-api-contract.md` / `PSEUDOCODE.md`.
3. **Don't change existing tabs' behaviour** without discussing it in an issue first.
4. **No secrets or personal data** in commits, screenshots, fixtures or issues (see [SECURITY.md](SECURITY.md)).
   Local state files are git-ignored; keep it that way.
5. **No fabricated numbers.** Missing data shows `N/A`; curated or sample data must be labelled
   (`ILLUSTRATIVE`, `EXAMPLE DATA`).
6. **Checks before a PR:** `npm run build` passes (TypeScript + Vite) and `npx oxlint` reports no errors (fix any new warnings you introduce).
7. Keep PRs small, describe what changed and why, and update `PSEUDOCODE.md` when behaviour changes.

Note: no license has been chosen yet (see `LICENSE`); the owner may ask contributors to agree to one later.
