# AI-Infra Trader — current pseudocode (phase 2)
Code: `aitrader/` (config.py holds every constant below). Education/paper only.

```
# ---------- CONFIG (aitrader/config.py; env overrides) ----------
TRADING_PERIOD   = "7d" | "Nd" | "ongoing"   # end of period -> close all + final report
CAPITAL          = 100   # USD hard cap per sleeve (A, B, C, E, EM, D_SPY, D_EW)
REBALANCE        = weekly (first trading day of ISO week), signals at close, trade next bar
TOP_N = 4; MAX_WEIGHT = 0.35; MAX_SEGMENT = 0.50 (of sleeve; remainder cash); MIN_ORDER = $1
STOP_DRAWDOWN    = 0.25 (env STOP_DRAWDOWN) -> sleeve to cash, notify, manual restart
                   (backtest: re-enter after STOP_COOLDOWN_DAYS = 20)
TARGET_RETURN    = 0.29 (env TARGET_RETURN) # Owner's goal: >29% annualised RETURN; flag BEHIND + WHY
                   (max drawdown is reported separately as a risk metric, not a target)
BOT_API          = http://127.0.0.1:4173 (env BOT_API_URL); BOT_TOKEN env -> Bearer (none => loopback)
RISK_OFF_NEWS    = -60   # market-wide news_sent below -> A/B/C/E to cash
MIN_HISTORY_YEARS= 5     # core = >=5y prices AND >=5 annual SEC revenue filings
EMERGING_GROSS = 0.50; EMERGING_MAX_WEIGHT = 0.15; EMERGING_HEDGE = 0.50
E_RISK_MAX = 60; E_TOP_BASKETS = 2; COST_BPS = 5; PLACEBO_SEEDS = 100-200

# ---------- UNIVERSE (copy of AI Infra Terminal src/data -> data/universe.json) ----------
companies = 61; tradable = public + US-listed (47); markets = 18 baskets (segment groups)
core      = tradable with first_price <= today-5y AND annual_SEC_filings >= 5     (39)
emerging  = tradable - core   (ARM, GFS, SPCX, CEG, TLN, GEV, OKLO, SMR)
graph     = relationships.ts edges (strength 1-10), competitor edges ignored

# ---------- SIGNAL SOURCE ----------
snap = GET /api/signals, /api/news-feed, /api/mock-index   # terminal's own TS formulas
if snap ok and not stale: news_sent = snap.news.company_score; mock_sentiment = snap.mock_index.sentiment;
                          market_news_sent = news-feed.composite.score
else (503 no_snapshot / unreachable): use the Python port below (same formulas)

# ---------- SIGNALS at date t (only data available at t) ----------
momentum   = P[t-5]/P[t-126] - 1
vol        = stdev(daily ret, 60) * sqrt(252)
trend_ok   = P[t] > SMA50
fin_score  = z(rev_YoY) + z(op_margin_QoQ_change) + z(FCF_margin)   # quarters with filed <= t; N/A -> NaN
mock.growth= clamp(50 + 0.9*(0.3*r1M + 0.35*r1Q + 0.2*rYTD))
mock.risk  = clamp(35*private + 40*(CN|TW) + 2.5*(|r1D| + 0.3*|r1M|) + 15)
mock.profitability (baskets) = clamp(40 + 35*share(YTD>0) + clip(0.35*YTD, -20, 25))
news_sent  = 100 * sum(sent_h*w_h)/sum(w_h), w_h = quality*exp(-age_h/240)*(1+0.25*log2(1+dupes))
             sent_h = lexicon score s/sqrt(s^2+6) (port of newsFeed.ts), 30-day window; no headlines -> N/A
graph_sent = strength-weighted mean news_sent of neighbours
market_news_sent = news_sent over all headlines
NEVER used: Mock Index "1D estimate" (it is the realized return)

# ---------- SCORE ----------
composite(sig, W) = sum_k W_k*z(sig_k) / sum_k |W_k|   over signals that are not N/A

# ---------- STRATEGIES ----------
A  baseline : score = momentum; eligible = trend_ok
B  AI-Infra : W = {news .30, graph .20, fin .20, growth .15, risk -.15, momentum .20}; eligible = trend_ok
              (backtest = B ex-news: news/graph have no point-in-time history)
C  placebo  : B's scores randomly permuted across eligible names (N seeds; live: seed = date)
E  Mock baskets: for each market basket (core members) compute mock {growth, profitability, risk}
              reject basket if risk > E_RISK_MAX; promise = growth + profitability - risk
              take top E_TOP_BASKETS; inside them pick top 4 trend_ok names by momentum
EM emerging : emerging names, trend_ok, top 4 by momentum, inverse-vol,
              gross = 50% of sleeve, <=15%/name, hedge = short 0.5*beta(120d vs SPY)*gross in SPY
              (live, long-only cash account: buy SH inverse ETF for that notional)
D1 SPY buy & hold ; D2 equal-weight core (live D_EW: equal-weight tradable)

# ---------- PORTFOLIO ----------
picks = top TOP_N by score among eligible with vol
w = (1/vol) normalised; loop: clip 35%/name, scale segments to <=50%; leftover -> cash
target_$ = w * min(sleeve_equity, CAPITAL)

# ---------- RISK ----------
per sleeve: peak = max(peak, equity); if equity < peak*(1-STOP_DRAWDOWN): paused -> close all, alert
if market_news_sent < RISK_OFF_NEWS: A/B/C/E targets = cash
if today >= start + TRADING_PERIOD: close_all for every sleeve, final report

# ---------- LIVE PLAN (aitrader/live.py) sleeves: A, B, C, D_SPY, D_EW, E, EM ----------
E  : baskets scored with today's prices; chosen baskets' trend_ok names (all fail -> E holds cash)
EM : emerging trend_ok names, 50% gross, <=15%/name, + buy SH for 0.5*beta*gross (hedge)

# ---------- REAL MONEY (opt-in; aitrader/live_guard.py, DISCLAIMER.md) ----------
TRADING_MODE = paper (default) | live          # live endpoint https://api.alpaca.markets
live allowed only if ALL: TRADING_MODE=live, DRY_RUN=false, ALLOW_ORDERS=1,
     LIVE_RISK_ACK == "I ACCEPT FULL RISK OF LOSS", ALPACA_LIVE_API_KEY_ID/SECRET set and != paper keys,
     no kill switch (state/KILL | TRADING_HALT=1), no state/LIVE_HALTED.json
     else -> paper (refusal reasons written to the plan)
first live start: print DISCLAIMER; if TTY require typing the phrase; log state/live_ack.json {acknowledged_at}
each live run (LiveExecutor):
  preflight: refusals? -> stop | ack | clock.is_open else stop
             day P&L = equity/last_equity - 1 <= -LIVE_DAILY_LOSS_LIMIT (5%) -> HALT
             bot_eq = min(equity, LIVE_MAX_CAPITAL); bot_eq < peak*(1-LIVE_STOP_DRAWDOWN) -> HALT
  HALT = close_all_positions + write LIVE_HALTED.json (manual review to resume)
  budget = LIVE_MAX_CAPITAL (100) - market value already held (all sleeves)
  for order in plan:
     kill switch -> stop batch
     sleeve != LIVE_SLEEVE (B) -> skip          # only one sleeve trades real money
     side not buy/sell -> refuse; sell > held -> refuse  # long-only, no shorts
     buy notional = min(order, LIVE_MAX_ORDER_USD, budget, cash) ; < $1 -> refuse   # no margin
     EM hedge only as a long SH buy
     submit with client_order_id "LIVE-<sleeve>-<date>-<sym>-<side>"; log reason to state/live_orders.jsonl
publisher: equity/trades/status carry mode ('paper'|'live') and live_ack_at -> dashboard LIVE banner

# ---------- EXECUTION (aitrader/live.py, alpaca.py) ----------
for sleeve: diff = target_$ - held_$ ; skip |diff| < $1 unless full exit
  order = market/day, notional (or qty for full exit),
          client_order_id = "<sleeve>-<YYYYMMDD>-<SYM>-<side>"
  check asset tradable & fractionable
  DRY_RUN (default) -> write state/plan_YYYYMMDD.json, place nothing
  live paper only if DRY_RUN=False AND ALLOW_ORDERS=1 (after the owner approves)
books: state/sleeves.json (cash, shares, peak, paused) updated from fills (phase 3)

# ---------- EVALUATION / AMBIGUITY ----------
IC_k = Spearman(signal_k[t], fwd_5d_ret) weekly; hit = % picks beating median
p_placebo = share of placebo Sharpe >= strategy Sharpe; p(B<=A) block bootstrap (20d blocks)
PROVEN only if p < 0.05 on both AND >= 60 forward trading days incl. news legs; else "signal not proven"
TARGET flag: BEHIND if CAGR < TARGET_RETURN (with and without stop) -> WHY:
  calendar-year returns vs SPY, best/worst names & segment contributions, cash drag (avg invested),
  hedge cost, turnover cost, value added vs D2 equal-weight, stop effect on CAGR, time under water
  weekly report: target_flag = any sleeve annualised < 29%

# ---------- OUTPUT ----------
reports/ (3y), reports/phase2_5y/ (5y: metrics, IC, charts, dd_flags.json, E_basket_log.json)
publish_all.py -> POST /api/bot/backtest, /trades (status dry_run), /equity (per sleeve book), /weekly-report
                  copies in outbox/*.json; schema per docs/bot-api-contract.md v1 (see API.md)
```
