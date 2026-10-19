# AI-Infra Trader — Phase 1 backtest

Period: 2023-10-16 → 2026-10-16 (weekly rebalance, signals at close, trade next bar, 5 bps/side). Universe: 47 US-tradable names from the AI Infra Terminal; 44 have SEC quarterly data. Not in backtest (no US listing / private / no data): none.

| Strategy | CAGR | Total | Vol | Sharpe | Max DD | Hit rate | First 15% stop hit |
|---|---|---|---|---|---|---|---|
| A Baseline (mom+trend) | 50.0% | 237.8% | 49.0% | 1.08 | -45.0% | 48.3% | 2024-07-24 |
| B AI-Infra ex-news | 36.7% | 155.4% | 43.4% | 0.94 | -46.9% | 48.3% | 2024-07-25 |
| C Placebo (median of 200) | 23.8% | 89.6% | 26.4% | 0.96 | -31.2% | N/A | 100% of runs hit it |
| D1 SPY buy&hold | 22.0% | 81.5% | 15.3% | 1.38 | -18.8% | N/A | 2025-04-04 |
| D2 Equal-weight universe | 50.3% | 239.9% | 28.4% | 1.59 | -27.9% | N/A | 2024-08-02 |

C row = median of each metric across the placebo runs (the plotted C line is the pointwise median path). Metrics shown with the 15% drawdown stop *not* enforced (so the full signal history is visible); the last column shows when the live rule would have paused the sleeve.

**Ambiguity tests (B-ex-news):** p(placebo Sharpe ≥ B) = 0.520; block-bootstrap p(B ≤ A) = 0.904. Pass threshold is p < 0.05 on both, plus ≥ 60 trading days of forward paper results including the news legs.

## Information coefficient per signal (weekly Spearman vs forward 5-day return)

| Signal | mean IC | t-stat | weeks |
|---|---|---|---|
| momentum | +0.029 | +1.22 | 156 |
| fin_score | +0.044 | +1.42 | 63 |
| growth | +0.012 | +0.49 | 156 |
| risk | +0.026 | +1.07 | 156 |
| B_score | +0.016 | +0.76 | 156 |

fin_score is only available from 2025-07-28 (the SEC snapshot holds ~10 quarters and YoY needs 4 of them).

## What could NOT be backtested

- **news_sent (30% of B) and graph_sent (20%)**: Google News RSS only returns recent headlines; no free point-in-time archive. These are computed live and validated forward in paper (IC logged each week). Mock-Index *sentiment* likewise.
- The Mock Index '1D estimate' is excluded entirely (it is the realized return).
- The risk-off rule (market news_sent < −60) needs news, so it is inactive in the backtest.

## Caveats

- Survivorship / hindsight bias: the universe was curated in 2026 around AI-infra winners, which flatters every strategy that holds it (incl. D2).
- SEC 'filed' dates in the snapshot are from the latest filing that reported each quarter; some are later than the original release, which delays (never leaks) fundamentals.
- Small sample (~150 weeks, 4 holdings); results are noisy. Education only, not financial advice.

Charts: equity_curves.png, drawdowns.png, rolling_ic.png