"""Walk-forward weekly backtest of the backtestable parts of each strategy (~3y).
News-based signals (news_sent, graph_sent, Mock 'sentiment') have no free point-in-time history,
so strategy B is backtested as B-ex-news and the news legs are validated forward in paper."""
import json, os
import numpy as np, pandas as pd
from scipy.stats import spearmanr
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from .config import CFG, REPORTS
from .universe import tradable, market_of
from . import data, signals, portfolio

B_EX_NEWS = {k: v for k, v in CFG.WEIGHTS_B.items() if k not in ("news_sent", "graph_sent")}


def metrics(eq: pd.Series):
    r = eq.pct_change().dropna()
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    dd = eq / eq.cummax() - 1
    stop = dd[dd <= -CFG.STOP_DRAWDOWN]
    return {"CAGR": (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1, "TotalReturn": eq.iloc[-1] / eq.iloc[0] - 1,
            "Vol": r.std() * np.sqrt(252), "Sharpe": r.mean() / r.std() * np.sqrt(252) if r.std() else np.nan,
            "MaxDD": dd.min(), "FirstStop15": str(stop.index[0].date()) if len(stop) else "never"}


def run(years=3, seeds=CFG.PLACEBO_SEEDS, out=REPORTS):
    os.makedirs(out, exist_ok=True)
    cos = tradable()
    tick2id = {c["ticker"]: c["id"] for c in cos}
    tickers = list(tick2id)
    px_all = data.prices(tickers + ["SPY"], period="4y")
    missing = [t for t in tickers if t not in px_all or px_all[t].dropna().empty]
    px = px_all[[t for t in tickers if t not in missing]].ffill(limit=3)
    tick2id = {t: tick2id[t] for t in px.columns}
    spy = px_all["SPY"].ffill()
    groups = pd.Series({t: market_of(tick2id[t]) for t in px.columns})
    sec = data.sec_quarterly()
    rets = px.pct_change(fill_method=None)

    start = px.index[-1] - pd.DateOffset(years=years)
    days = px.index[px.index >= start]
    wk = pd.Series(days, index=days).groupby(days.to_period("W")).first()
    rebal = list(wk.values)

    sig_log, targets = {}, {"A": {}, "B": {}}
    placebo_targets = [dict() for _ in range(seeds)]
    ic_rows, hits = [], {"A": [], "B": []}
    rng = np.random.default_rng(7)
    for i, t in enumerate(rebal):
        t = pd.Timestamp(t)
        mom = signals.momentum(px, t); v = signals.vol(px, t); ok = signals.trend_ok(px, t)
        mi = signals.mock_idx(px, t, tick2id); fs = signals.fin_score(sec, t, tick2id)
        sig = pd.DataFrame({"momentum": mom, "fin_score": fs, "growth": mi["growth"], "risk": mi["risk"], "vol": v})
        sig.loc[mom.isna(), :] = np.nan
        sB = portfolio.composite(sig, B_EX_NEWS)
        sig["B_score"] = sB
        sig_log[t] = sig
        targets["A"][t] = portfolio.build(mom, ok, v, groups)
        targets["B"][t] = portfolio.build(sB, ok, v, groups)
        elig = sB[ok & sB.notna() & v.notna()]
        for k in range(seeds):
            sh = pd.Series(rng.permutation(elig.values), index=elig.index)
            placebo_targets[k][t] = portfolio.build(sh, ok, v, groups)
        # forward 5d return for IC / hit rate (only for evaluation, never fed back)
        j = px.index.get_loc(t)
        if j + 5 < len(px):
            fwd = px.iloc[j + 5] / px.iloc[j] - 1
            med = fwd.median()
            row = {"date": t}
            for s in ["momentum", "fin_score", "growth", "risk", "B_score"]:
                x = sig[s]; m = x.notna() & fwd.notna()
                row[s] = spearmanr(x[m], fwd[m]).statistic if m.sum() >= 8 else np.nan
            ic_rows.append(row)
            for n in ("A", "B"):
                p = targets[n][t].index
                hits[n] += list((fwd[p] > med).astype(int)) if len(p) else []

    def simulate(tg):
        w = pd.DataFrame(tg).T.reindex(columns=px.columns).fillna(0.0)
        w = w.reindex(days).ffill().fillna(0.0).shift(1).fillna(0.0)  # trade at close t, earn from t+1
        turn = w.diff().abs().sum(axis=1).fillna(w.abs().sum(axis=1))
        r = (w * rets.reindex(days).fillna(0)).sum(axis=1) - turn * CFG.COST_BPS / 1e4
        return CFG.CAPITAL * (1 + r).cumprod()

    eq = {"A Baseline (mom+trend)": simulate(targets["A"]), "B AI-Infra ex-news": simulate(targets["B"])}
    plac = pd.DataFrame({k: simulate(pt) for k, pt in enumerate(placebo_targets)})
    eq["C Placebo (median of %d)" % seeds] = plac.median(axis=1)  # chart only; metrics = median of per-run metrics
    eq["D1 SPY buy&hold"] = CFG.CAPITAL * spy.reindex(days) / spy.reindex(days).iloc[0]
    ew = rets.reindex(days).mean(axis=1).fillna(0); ew.iloc[0] = 0
    eq["D2 Equal-weight universe"] = CFG.CAPITAL * (1 + ew).cumprod()
    eqdf = pd.DataFrame(eq)

    met = pd.DataFrame({k: metrics(v) for k, v in eq.items()}).T
    pm = pd.DataFrame([metrics(plac[c]) for c in plac.columns])
    ck = "C Placebo (median of %d)" % seeds
    for col in ["CAGR", "TotalReturn", "Vol", "Sharpe", "MaxDD"]:
        met.loc[ck, col] = pm[col].median()
    met.loc[ck, "FirstStop15"] = f"{(pm.FirstStop15 != 'never').mean():.0%} of runs hit it"
    met["HitRate"] = np.nan
    met.loc["A Baseline (mom+trend)", "HitRate"] = np.mean(hits["A"])
    met.loc["B AI-Infra ex-news", "HitRate"] = np.mean(hits["B"])
    plac_sh = plac.apply(lambda s: metrics(s)["Sharpe"])
    b_sh = met.loc["B AI-Infra ex-news", "Sharpe"]
    p_vs_placebo = float((plac_sh >= b_sh).mean())
    # B vs A: stationary block bootstrap of daily return differences
    d = (eq["B AI-Infra ex-news"].pct_change() - eq["A Baseline (mom+trend)"].pct_change()).dropna().values
    bs = []
    for _ in range(2000):
        idx = np.concatenate([np.arange(s, s + 20) % len(d) for s in rng.integers(0, len(d), len(d) // 20 + 1)])[: len(d)]
        bs.append(d[idx].mean())
    p_vs_A = float((np.array(bs) <= 0).mean())

    ic = pd.DataFrame(ic_rows).set_index("date")
    ics = pd.DataFrame({"meanIC": ic.mean(), "stdIC": ic.std(), "n_weeks": ic.count()})
    ics["t_stat"] = ics.meanIC / ics.stdIC * np.sqrt(ics.n_weeks)
    ics.loc["risk", "note"] = "risk enters B with NEGATIVE weight; negative IC here = helpful"
    fs_first = ic["fin_score"].first_valid_index()

    # charts
    fig, ax = plt.subplots(figsize=(11, 5.5))
    ax.fill_between(plac.index, plac.quantile(0.05, axis=1), plac.quantile(0.95, axis=1), color="grey", alpha=0.25, label="C placebo 5–95% band")
    for k, s in eq.items(): ax.plot(s.index, s, label=k, lw=1.6 if k.startswith(("A", "B")) else 1.1)
    ax.set_title("Equity curves — $100 sleeves, weekly rebalance, 5 bps/side costs"); ax.set_ylabel("USD"); ax.legend(fontsize=8); ax.grid(alpha=.3)
    fig.tight_layout(); p1 = os.path.join(out, "equity_curves.png"); fig.savefig(p1, dpi=130); plt.close(fig)
    fig, ax = plt.subplots(figsize=(11, 4))
    for k, s in eq.items(): ax.plot(s.index, s / s.cummax() - 1, label=k, lw=1.2)
    ax.axhline(-CFG.STOP_DRAWDOWN, color="red", ls="--", lw=1, label="15% stop"); ax.set_title("Drawdowns"); ax.legend(fontsize=8); ax.grid(alpha=.3)
    fig.tight_layout(); p2 = os.path.join(out, "drawdowns.png"); fig.savefig(p2, dpi=130); plt.close(fig)
    fig, ax = plt.subplots(figsize=(11, 4))
    ic.drop(columns=["B_score"]).rolling(12, min_periods=6).mean().plot(ax=ax); ax.axhline(0, color="k", lw=.8)
    ax.set_title("Rolling 12-week mean IC (Spearman vs fwd 5d return)"); ax.grid(alpha=.3)
    fig.tight_layout(); p3 = os.path.join(out, "rolling_ic.png"); fig.savefig(p3, dpi=130); plt.close(fig)

    eqdf.to_csv(os.path.join(out, "equity_curves.csv")); ic.to_csv(os.path.join(out, "ic_weekly.csv"))
    met.to_csv(os.path.join(out, "metrics.csv")); ics.to_csv(os.path.join(out, "ic_summary.csv"))
    latest = sig_log[pd.Timestamp(rebal[-1])]
    res = dict(metrics=met, ic=ics, p_vs_placebo=p_vs_placebo, p_vs_A=p_vs_A, start=str(days[0].date()), end=str(days[-1].date()),
               n_universe=len(px.columns), missing=missing, fin_first=str(fs_first.date()) if fs_first is not None else "N/A",
               charts=[p1, p2, p3], latest=latest, last_targets={k: targets[k][pd.Timestamp(rebal[-1])] for k in targets},
               n_sec=sum(1 for t in tick2id.values() if t in sec))
    write_report(res, out)
    return res


def write_report(r, out):
    m = r["metrics"].copy()
    fmt = lambda x: "N/A" if pd.isna(x) else f"{x:.1%}"
    lines = [f"# AI-Infra Trader — Phase 1 backtest", "",
             f"Period: {r['start']} → {r['end']} (weekly rebalance, signals at close, trade next bar, 5 bps/side). "
             f"Universe: {r['n_universe']} US-tradable names from the AI Infra Terminal; {r['n_sec']} have SEC quarterly data. "
             f"Not in backtest (no US listing / private / no data): {', '.join(r['missing']) or 'none'}.", "",
             "| Strategy | CAGR | Total | Vol | Sharpe | Max DD | Hit rate | First 15% stop hit |", "|---|---|---|---|---|---|---|---|"]
    for k, row in m.iterrows():
        lines.append(f"| {k} | {fmt(row.CAGR)} | {fmt(row.TotalReturn)} | {fmt(row.Vol)} | {row.Sharpe:.2f} | {fmt(row.MaxDD)} | {fmt(row.HitRate)} | {row.FirstStop15} |")
    lines += ["", "C row = median of each metric across the placebo runs (the plotted C line is the pointwise median path). Metrics shown with the 15% drawdown stop *not* enforced (so the full signal history is visible); the last column shows when the live rule would have paused the sleeve.", "",
              f"**Ambiguity tests (B-ex-news):** p(placebo Sharpe ≥ B) = {r['p_vs_placebo']:.3f}; block-bootstrap p(B ≤ A) = {r['p_vs_A']:.3f}. "
              f"Pass threshold is p < 0.05 on both, plus ≥ 60 trading days of forward paper results including the news legs.", "",
              "## Information coefficient per signal (weekly Spearman vs forward 5-day return)", "",
              "| Signal | mean IC | t-stat | weeks |", "|---|---|---|---|"]
    for k, row in r["ic"].iterrows():
        lines.append(f"| {k} | {row.meanIC:+.3f} | {row.t_stat:+.2f} | {int(row.n_weeks)} |")
    lines += ["", f"fin_score is only available from {r['fin_first']} (the SEC snapshot holds ~10 quarters and YoY needs 4 of them).", "",
              "## What could NOT be backtested", "",
              "- **news_sent (30% of B) and graph_sent (20%)**: Google News RSS only returns recent headlines; no free point-in-time archive. "
              "These are computed live and validated forward in paper (IC logged each week). Mock-Index *sentiment* likewise.",
              "- The Mock Index '1D estimate' is excluded entirely (it is the realized return).",
              "- The risk-off rule (market news_sent < −60) needs news, so it is inactive in the backtest.", "",
              "## Caveats", "",
              "- Survivorship / hindsight bias: the universe was curated in 2026 around AI-infra winners, which flatters every strategy that holds it (incl. D2).",
              "- SEC 'filed' dates in the snapshot are from the latest filing that reported each quarter; some are later than the original release, which delays (never leaks) fundamentals.",
              "- Small sample (~150 weeks, 4 holdings); results are noisy. Education only, not financial advice.", "",
              "Charts: equity_curves.png, drawdowns.png, rolling_ic.png"]
    open(os.path.join(out, "backtest_report.md"), "w").write("\n".join(lines))


if __name__ == "__main__":
    r = run()
    print(r["metrics"].to_string()); print(r["ic"].to_string()); print(r["p_vs_placebo"], r["p_vs_A"], r["missing"], r["fin_first"])
