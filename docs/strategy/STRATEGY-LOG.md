# Strategy Log (kept by Guap, Alpaca Advisor)

Tracks every strategy change: proposed, reviewed, edited, accepted or rejected, and pushed.
Education and decision support only, not financial advice. The owner decides.

## BLUF (as of 2026-10-19 8:55 PM MST)

- The opt-in live switch is on `main`, but the live engine has two known defects (PHASE3-PLAN P0).
  Until they are fixed, recommend **paper only**, or a live account funded with exactly `LIVE_MAX_CAPITAL`.
- No sleeve met the new 0.7%/wk geometric target in the 5-year backtest. The best was D2 equal-weight core at about 0.52%/wk.
  The constraint is Sharpe (return per unit of risk), not missing instruments.
- Next: P0 fixes, then P1, which measures the target weekly and geometrically, then P2, which adds breadth and better signals. Everything stays on paper until the P6 gates pass.

## Status board

| ID | Change | Owner | Status | Reviewed by | Commit / PR |
|---|---|---|---|---|---|
| S-001 | Add `trader/PHASE3-PLAN.md` and `docs/agents/ALPACA-ADVISOR.md` (the owner's 2-commit patch) | GitHub Scribe | Proposed | - | not on main as of 2026-10-19 |
| S-002 | P0: rebuild sleeve books from fills (`state/sleeves.json`), halt on book/broker mismatch (> $0.50) | New Bot | Pushed | GitHub Scribe | `d82693a`, on main at `1700bdf`; 54/54 tests |
| S-003 | P0: drawdown and daily-loss rails measured on the live sleeve's own equity, uncapped (Guap recommends keeping it uncapped) | New Bot | Pushed | GitHub Scribe | `d82693a`, on main at `1700bdf` |
| S-004 | `TRADING_PERIOD` default `ongoing` (currently `7d`) | Owner (decision) | Open | - | - |
| S-005 | P1: weekly geometric target (0.7%/wk, stretch 1.0%) replaces `TARGET_RETURN=0.29`; Trader tab shows the 13/26/52-week geometric and arithmetic averages | New Bot + Prototype Builder | Proposed | GitHub Scribe | - |
| S-007 | Planner places sells before buys; buys are sized on cash received (`LIVE_FILL_WAIT_S`, 30 s) | New Bot | Built, awaiting review | GitHub Scribe | local `cd67279`, 66/66 tests |
| S-008 | Halt sells only the live sleeve's shares, using tagged orders; `close_all_positions()` removed. README tells older releases to fund the account with exactly `LIVE_MAX_CAPITAL` | New Bot | Built, awaiting review | GitHub Scribe | local `8ecf39a`, 66/66 tests |
| S-006 | Owner's drawdown limit vs the `LIVE_STOP_DRAWDOWN` default of 0.25 | Owner (decision) | Open | - | private setting, not committed |

## Findings (evidence)

- 2026-10-19, `main`: nothing writes `state/sleeves.json`. `live.py` line 188 updates books "only from real fills", but no code does it.
  `config.py` sets `TRADING_PERIOD` to "7d", `STOP_DRAWDOWN` to 0.25 and `TARGET_RETURN` to 0.29 annual.
- 5y backtest (`reports/phase2_5y`): D2 0.52%/wk geometric with a -25.9% max drawdown; B 0.28%/wk, and B did not beat its placebo (p = 0.58).

## Detailed log

### 2026-10-19: Guap joins
- The owner asked Guap to advise on financial strategy and to push strategy edits through the group.
- Process for each change: Guap writes the proposal and an impact report, New Bot and Prototype Builder build it,
  GitHub Scribe reviews it against the README and project notes, the owner approves, GitHub Scribe pushes,
  and Guap records the result here.

### 2026-10-19 9:05 PM MST: P0 built
- New Bot built `reconcile()`, the mismatch halt and stops measured on the bot's own equity in local commit `d82693a`.
  All 54 tests pass, including 23 new ones that use a fake broker with no network.
- Guap's review: the stops should stay uncapped. Capping them at $100 would hide a fall from a gain, for example $130 back to $100.
  This matches PHASE3-PLAN P0 (`bot_equity` = the live sleeve's positions plus its cash).
- Still for the owner to decide: switching `TRADING_PERIOD` to `ongoing`, and replacing the >29% a year target with 0.7% a week.

### 2026-10-19 9:06 PM MST: P0 pushed, new risk found
- GitHub Scribe pushed `d82693a` to main (`1700bdf`), and all 9 files match the release copy.
- GitHub Scribe found that the halt calls `close_all_positions()`, which liquidates the whole Alpaca account, not just the sleeve. This is logged as S-008.

### 2026-10-19 9:10 PM MST: S-007 and S-008 built
- `cd67279`: sells go out first, buys are sized on cash that has actually come in, and the MSFT to NVDA rotation now finishes in one run.
- `8ecf39a`: a halt sells only the sleeve's own shares. It was tested on an account that also holds VOO, TSLA and extra shares. Both commits are waiting on GitHub Scribe's review.
