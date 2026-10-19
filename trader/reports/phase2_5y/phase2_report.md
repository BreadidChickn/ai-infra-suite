# Phase 2 — 5-year backtest

2021-10-18 → 2026-10-16, weekly, 5 bps/side. Core universe (39): ≥5y prices and ≥5 annual SEC filings: NVDA, AMD, INTC, AVGO, QCOM, TSM, ASML, AMAT, LRCX, KLAC, SNPS, CDNS, MSFT, AMZN, GOOGL, META, ORCL, MRVL, MU, AAPL, TSLA, VST, NRG, NEE, D, DUK, SO, BE, CCJ, LEU, ORA, EQT, WMB, KMI, ET, BEP, FSLR, VRT, ETN.

Emerging sleeve (excluded from core): ARM (first price 2023-09-14, 5 annual SEC filings); GFS (first price 2021-10-28, 6 annual SEC filings); SPCX (first price 2026-06-12, 0 annual SEC filings); CEG (first price 2022-01-19, 6 annual SEC filings); TLN (first price 2023-06-02, 6 annual SEC filings); GEV (first price 2024-03-27, 4 annual SEC filings); OKLO (first price 2021-07-08, 0 annual SEC filings); SMR (first price 2022-03-01, 6 annual SEC filings)

Stop: 25% from peak → cash for 20 trading days (stand-in for manual restart). Return target: > 29% annualised (drawdown is reported separately as risk).

| Strategy | CAGR | Total | Vol | Sharpe | Max DD | CAGR w/ stop | Max DD w/ stop | Stops | Hit | ≥29%/yr? (no stop / stop) |
|---|---|---|---|---|---|---|---|---|---|---|
| A Baseline | 20.0% | 148.3% | 38.5% | 0.67 | -47.3% | 22.8% | -45.8% | 3 | 46.8% | BEHIND / BEHIND |
| B AI-Infra ex-news | 15.4% | 104.3% | 35.9% | 0.58 | -45.3% | 15.6% | -45.4% | 3 | 47.5% | BEHIND / BEHIND |
| E Mock-Index baskets | 19.7% | 145.5% | 26.1% | 0.82 | -32.5% | 22.2% | -25.2% | 1 | 48.4% | BEHIND / BEHIND |
| EM Emerging hedged | 15.9% | 109.3% | 13.6% | 1.16 | -14.6% | 15.9% | -14.6% | 0 | N/A | BEHIND / BEHIND |
| D1 SPY | 12.8% | 82.5% | 17.1% | 0.79 | -24.5% | 12.8% | -24.5% | 0 | N/A | BEHIND / BEHIND |
| D2 EW core | 31.1% | 286.9% | 26.1% | 1.17 | -25.9% | 23.0% | -32.9% | 2 | N/A | MEETS / BEHIND |
| C Placebo (median of 100) | 14.2% | 94.3% | 24.5% | 0.66 | -31.6% | 14.1% | -31.1% |  | N/A | BEHIND / N/A |

Ambiguity tests: p(placebo Sharpe ≥ B) = 0.58; p(placebo ≥ E) = 0.26; block-bootstrap p(B ≤ A) = 0.80 (pass needs < 0.05).

| Signal (core) | mean IC | t | weeks |
|---|---|---|---|
| momentum | +0.011 | +0.61 | 260 |
| fin_score | +0.059 | +1.75 | 63 |
| growth | -0.000 | -0.01 | 260 |
| risk | +0.019 | +1.04 | 260 |
| B_score | +0.003 | +0.17 | 260 |

E basket selection frequency (weeks chosen): {'grid': 94, 'equipment': 91, 'utilities': 84, 'gas': 77, 'nuclear': 49, 'chips': 39, 'cloud': 31, 'renewables': 28, 'devices': 15, 'eda_ip': 14}. Latest: {'date': '2026-10-12', 'chosen': ['chips', 'equipment'], 'rejected_risk': []}.

## Return-target flags (>29%/yr) — WHY

### A Baseline: BEHIND — CAGR 20.0% vs target 29% (risk: max DD -47.3%)
Calendar returns %: {2021: 4.0, 2022: -8.2, 2023: 65.4, 2024: 19.8, 2025: 18.4, 2026: 10.9}; with stop: BEHIND (22.8%).
Avg invested 91%; best names {'VRT': 26.0, 'NVDA': 25.7, 'MU': 25.1, 'NRG': 17.9}; segment contributions (simple-sum pts) {'devices': -10.9, 'foundry': -1.8, 'equipment': -1.5, 'renewables': 0.5, 'cloud': 3.9, 'geothermal': 4.7, 'gas': 4.8, 'eda_ip': 7.5, 'nuclear': 10.1, 'turbines': 13.4, 'chips': 21.9, 'memory': 25.1, 'grid': 27.2, 'utilities': 31.4}.
- turnover cost ~1.7%/yr at 5 bps/side
- loser segment: 'devices' cost 11 pts; worst names {'TSLA': -8.2, 'AMD': -5.9, 'CCJ': -5.3, 'ASML': -3.5}
- selection vs simply holding the core basket: -11.1%/yr vs D2 EW (31.1%) — signal subtracted value
- years below 29%: 2021 +4% (SPY +7%), 2022 -8% (SPY -18%), 2024 +20% (SPY +25%), 2025 +18% (SPY +18%), 2026 +11% (SPY +13%) (2021 and 2026 are partial years)
- the 25% stop raises CAGR to 22.8%
- spent 74% of days >5% below its peak (max DD -47%) — compounding lost to drawdowns


### B AI-Infra ex-news: BEHIND — CAGR 15.4% vs target 29% (risk: max DD -45.3%)
Calendar returns %: {2021: 2.5, 2022: -7.6, 2023: 61.3, 2024: 4.6, 2025: 27.5, 2026: 0.2}; with stop: BEHIND (15.6%).
Avg invested 91%; best names {'NVDA': 33.4, 'VRT': 30.9, 'MU': 27.6, 'BE': 13.4}; segment contributions (simple-sum pts) {'equipment': -5.8, 'gas': -4.7, 'devices': -2.5, 'renewables': -0.2, 'geothermal': 2.4, 'utilities': 6.2, 'eda_ip': 7.9, 'nuclear': 10.1, 'chips': 12.5, 'turbines': 13.4, 'cloud': 13.7, 'memory': 27.6, 'grid': 32.7}.
- turnover cost ~1.9%/yr at 5 bps/side
- loser segment: 'equipment' cost 6 pts; worst names {'INTC': -14.4, 'AMD': -7.2, 'ET': -4.9, 'MRVL': -4.2}
- selection vs simply holding the core basket: -15.7%/yr vs D2 EW (31.1%) — signal subtracted value
- years below 29%: 2021 +3% (SPY +7%), 2022 -8% (SPY -18%), 2024 +5% (SPY +25%), 2025 +27% (SPY +18%), 2026 +0% (SPY +13%) (2021 and 2026 are partial years)
- spent 75% of days >5% below its peak (max DD -45%) — compounding lost to drawdowns


### E Mock-Index baskets: BEHIND — CAGR 19.7% vs target 29% (risk: max DD -32.5%)
Calendar returns %: {2021: -3.5, 2022: 6.1, 2023: 26.7, 2024: 31.0, 2025: 32.9, 2026: 8.6}; with stop: BEHIND (22.2%).
Avg invested 71%; best names {'VRT': 28.1, 'LRCX': 14.8, 'VST': 12.7, 'ETN': 11.2}; segment contributions (simple-sum pts) {'eda_ip': -10.1, 'devices': -1.9, 'gas': -1.6, 'renewables': 1.6, 'chips': 3.0, 'nuclear': 14.4, 'cloud': 15.9, 'equipment': 26.2, 'utilities': 27.3, 'grid': 39.3}.
- cash drag: only 71% invested on average (trend filter / 35%-name & 50%-segment caps leave cash)
- turnover cost ~1.5%/yr at 5 bps/side
- loser segment: 'eda_ip' cost 10 pts; worst names {'SNPS': -6.6, 'KMI': -6.1, 'AMD': -5.8, 'ASML': -4.4}
- selection vs simply holding the core basket: -11.4%/yr vs D2 EW (31.1%) — signal subtracted value
- years below 29%: 2021 -3% (SPY +7%), 2022 +6% (SPY -18%), 2023 +27% (SPY +26%), 2026 +9% (SPY +13%) (2021 and 2026 are partial years)
- the 25% stop raises CAGR to 22.2%
- spent 62% of days >5% below its peak (max DD -32%) — compounding lost to drawdowns


### EM Emerging hedged: BEHIND — CAGR 15.9% vs target 29% (risk: max DD -14.6%)
Calendar returns %: {2021: 0.0, 2022: -1.2, 2023: 2.3, 2024: 52.6, 2025: 20.0, 2026: 13.2}; with stop: BEHIND (15.9%).
Avg invested 27%; best names {'TLN': 21.5, 'CEG': 19.5, 'OKLO': 16.7, 'ARM': 13.2}; segment contributions (simple-sum pts) {'foundry': 2.6, 'turbines': 11.8, 'eda_ip': 13.2, 'nuclear': 67.9}.
- cash drag: only 27% invested on average (trend filter / 35%-name & 50%-segment caps leave cash)
- hedge cost: SPY short contributed -15.2 pts (simple sum) while SPY rose; half-size sleeve caps upside by design
- selection vs simply holding the core basket: -15.2%/yr vs D2 EW (31.1%) — signal subtracted value
- years below 29%: 2021 +0% (SPY +7%), 2022 -1% (SPY -18%), 2023 +2% (SPY +26%), 2025 +20% (SPY +18%), 2026 +13% (SPY +13%) (2021 and 2026 are partial years)


### D1 SPY: BEHIND — CAGR 12.8% vs target 29% (risk: max DD -24.5%)
Calendar returns %: {2021: 6.6, 2022: -18.2, 2023: 26.2, 2024: 24.9, 2025: 17.7, 2026: 12.8}; with stop: BEHIND (12.8%).
- years below 29%: 2021 +7% (SPY +7%), 2022 -18% (SPY -18%), 2023 +26% (SPY +26%), 2024 +25% (SPY +25%), 2025 +18% (SPY +18%), 2026 +13% (SPY +13%) (2021 and 2026 are partial years)


### D2 EW core: MEETS — CAGR 31.1% vs target 29% (risk: max DD -25.9%)
Calendar returns %: {2021: 10.3, 2022: -18.0, 2023: 57.1, 2024: 40.1, 2025: 52.1, 2026: 27.8}; with stop: BEHIND (23.0%).
- years below 29%: 2021 +10% (SPY +7%), 2022 -18% (SPY -18%), 2026 +28% (SPY +13%) (2021 and 2026 are partial years)
- the 25% stop lowers CAGR to 23.0% (sits in cash through rebounds)


### C Placebo (median of 100): BEHIND — CAGR 14.2% vs target 29% (risk: max DD -31.6%)
- random selection inside the same trend-filtered universe
median of placebo runs; no single path to attribute

News legs (news_sent, graph_sent, Mock sentiment, risk-off) still cannot be backtested; B and E here are ex-news. Universe survivorship bias remains. Education only.