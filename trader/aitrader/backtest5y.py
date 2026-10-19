"""Phase-2 5-year backtest.
Core universe = names with >=5y of prices AND >=5 annual SEC revenue filings (no look-ahead universe growth inside
the window). Names failing that go to a separate EMERGING sleeve with reduced sizing + SPY beta hedge.
Strategies: A baseline, B AI-Infra ex-news, C placebo, E Mock-Index promising baskets, EM emerging hedged,
D1 SPY, D2 equal-weight core. Configurable drawdown stop (default 25%) and a max-drawdown target flag (<29%)
with a WHY breakdown of each failing strategy's worst drawdown."""
import json, os
import numpy as np, pandas as pd
from scipy.stats import spearmanr
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from .config import CFG, REPORTS, CACHE
from .universe import tradable, market_of
from . import data, signals, portfolio
from .backtest import B_EX_NEWS

OUT = os.path.join(REPORTS, "phase2_5y")
clamp = lambda x, lo, hi: min(hi, max(lo, x))


def split_universe(px, sec_raw, asof):
    cut = asof - pd.DateOffset(years=CFG.MIN_HISTORY_YEARS)
    core, emerging, why = [], [], {}
    for tk, cid in TICK2ID.items():
        first = px[tk].first_valid_index() if tk in px else None
        n_ann = len(sec_raw.get(cid, {}).get("metrics", {}).get("revenue", {}).get("annual", []))
        ok_px = first is not None and first <= cut
        ok_sec = n_ann >= CFG.MIN_HISTORY_YEARS
        (core if ok_px and ok_sec else emerging).append(tk)
        if not (ok_px and ok_sec):
            why[tk] = f"first price {first.date() if first is not None else 'N/A'}, {n_ann} annual SEC filings"
    return core, emerging, why


def basket_scores(h, members, t):
    """MockIndexTab basket formulas (equal weight). Sentiment needs news -> N/A, not used."""
    rows = []
    for tk in members:
        s = h[tk].dropna()
        if len(s) < 70: continue
        r = lambda n: (s.iloc[-1] / s.iloc[-1 - n] - 1) * 100
        base = s[s.index < t.replace(month=1, day=1)]
        ytd = (s.iloc[-1] / base.iloc[-1] - 1) * 100 if len(base) else np.nan
        c = BY_TK[tk]
        rows.append(dict(r1d=r(1), r1m=r(21), r1q=r(63), ytd=ytd, priv=bool(c.get("isPrivate")),
                         geo=c.get("country") in ("CN", "TW")))
    if len(rows) < 2: return None
    d = pd.DataFrame(rows)
    ytd = d.ytd.fillna(0)
    risk = clamp(d.priv.mean() * 35 + d.geo.mean() * 40 + (d.r1d.abs() + 0.3 * d.r1m.abs()).mean() * 2.5 + 15, 0, 100)
    prof = clamp(40 + (ytd > 0).mean() * 35 + clamp(ytd.mean() * 0.35, -20, 25), 0, 100)
    growth = clamp(50 + 0.9 * (d.r1m.mean() * 0.3 + d.r1q.mean() * 0.35 + ytd.mean() * 0.2), 0, 100)
    return dict(risk=risk, profitability=prof, growth=growth, n=len(d))


def apply_stop(r: pd.Series, stop=None, cool=None):
    stop = CFG.STOP_DRAWDOWN if stop is None else stop; cool = cool or CFG.STOP_COOLDOWN_DAYS
    out, eq, peak, off, events = [], 1.0, 1.0, 0, []
    for d, x in r.items():
        if off > 0:
            out.append(0.0); off -= 1
            if off == 0: peak = eq  # restart: new peak baseline
            continue
        eq *= 1 + x; peak = max(peak, eq); out.append(x)
        if eq < peak * (1 - stop):
            off = cool; events.append(str(d.date()))
    return pd.Series(out, index=r.index), events


def metrics(eq):
    r = eq.pct_change().dropna(); yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    dd = eq / eq.cummax() - 1
    return dict(CAGR=(eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1, Total=eq.iloc[-1] / eq.iloc[0] - 1,
                Vol=r.std() * np.sqrt(252), Sharpe=r.mean() / r.std() * np.sqrt(252) if r.std() else np.nan, MaxDD=dd.min())


def run(years=5, seeds=100):
    global TICK2ID, BY_TK
    os.makedirs(OUT, exist_ok=True)
    cos = tradable(); TICK2ID = {c["ticker"]: c["id"] for c in cos}; BY_TK = {c["ticker"]: c for c in cos}
    raw = pd.read_pickle(os.path.join(CACHE, "prices_7y.pkl"))
    spy = raw["SPY"].ffill()
    px = raw[[t for t in TICK2ID if t in raw]].ffill(limit=3)
    sec_raw = json.load(open(data.SEC_JSON))["companies"]
    asof = px.index[-1]
    core, emerging, em_why = split_universe(px, sec_raw, asof)
    groups = pd.Series({t: market_of(TICK2ID[t]) for t in px.columns})
    sec = data.sec_quarterly(); rets = px.pct_change(fill_method=None); spy_r = spy.pct_change()
    days = px.index[px.index >= asof - pd.DateOffset(years=years)]
    rebal = [pd.Timestamp(x) for x in pd.Series(days, index=days).groupby(days.to_period("W")).first().values]
    pc, pe = px[core], px[emerging]
    t2c = {t: TICK2ID[t] for t in core}
    T = {k: {} for k in ("A", "B", "E", "EM")}; PL = [dict() for _ in range(seeds)]
    ic_rows, hits, e_log = [], {k: [] for k in ("A", "B", "E")}, []
    rng = np.random.default_rng(11)
    for t in rebal:
        mom = signals.momentum(pc, t); v = signals.vol(pc, t); ok = signals.trend_ok(pc, t)
        mi = signals.mock_idx(pc, t, t2c); fs = signals.fin_score(sec, t, t2c)
        sig = pd.DataFrame({"momentum": mom, "fin_score": fs, "growth": mi.growth, "risk": mi.risk})
        sB = portfolio.composite(sig, B_EX_NEWS)
        T["A"][t] = portfolio.build(mom, ok, v, groups)
        T["B"][t] = portfolio.build(sB, ok, v, groups)
        el = sB[ok & sB.notna() & v.notna()]
        for k in range(seeds):
            PL[k][t] = portfolio.build(pd.Series(rng.permutation(el.values), index=el.index), ok, v, groups)
        # E: Mock Index baskets (= terminal markets) over core names
        h = pc.loc[:t]; bs = {}
        for g in groups[core].unique():
            sc = basket_scores(h, [x for x in core if groups[x] == g], t)
            if sc: bs[g] = sc
        bdf = pd.DataFrame(bs).T
        if len(bdf):
            bdf["promise"] = bdf.growth + bdf.profitability - bdf.risk
            bdf["passes_risk"] = bdf.risk <= CFG.E_RISK_MAX
            chosen = bdf[bdf.passes_risk].sort_values("promise", ascending=False).index[: CFG.E_TOP_BASKETS].tolist()
        else: chosen = []
        e_log.append({"date": str(t.date()), "chosen": chosen, "rejected_risk": bdf.index[~bdf.passes_risk].tolist() if len(bdf) else []})
        inb = pd.Series({x: groups[x] in chosen for x in core})
        T["E"][t] = portfolio.build(mom, ok & inb, v, groups)
        # EM: emerging sleeve, reduced sizing + beta hedge
        me = signals.momentum(pe, t); ve = signals.vol(pe, t); oe = signals.trend_ok(pe, t)
        s = me[oe & me.notna() & ve.notna()].sort_values(ascending=False).index[:CFG.TOP_N]
        if len(s):
            w = (1 / ve[s]); w = (w / w.sum()).clip(upper=CFG.EMERGING_MAX_WEIGHT / CFG.EMERGING_GROSS) * CFG.EMERGING_GROSS
            rr = rets.loc[:t, s].iloc[-120:]; sr = spy_r.loc[:t].iloc[-120:]
            beta = float(np.nansum([w[x] * rr[x].cov(sr) / sr.var() for x in s]) / max(w.sum(), 1e-9))
            w = pd.concat([w, pd.Series({"SPY": -CFG.EMERGING_HEDGE * beta * w.sum()})])
        else: w = pd.Series(dtype=float)
        T["EM"][t] = w
        j = px.index.get_loc(t)
        if j + 5 < len(px):
            fwd = pc.iloc[j + 5] / pc.iloc[j] - 1; med = fwd.median(); row = {"date": t}
            for k2 in ["momentum", "fin_score", "growth", "risk"]:
                x = sig[k2]; m = x.notna() & fwd.notna()
                row[k2] = spearmanr(x[m], fwd[m]).statistic if m.sum() >= 8 else np.nan
            row["B_score"] = spearmanr(sB[sB.notna() & fwd.notna()], fwd[sB.notna() & fwd.notna()]).statistic
            ic_rows.append(row)
            for k2 in hits: hits[k2] += list((fwd[T[k2][t].index] > med).astype(int))

    R = pd.concat([rets, spy_r.rename("SPY")], axis=1).reindex(days).fillna(0)

    def sim(tg):
        w = pd.DataFrame(tg).T.reindex(columns=R.columns).fillna(0.0).reindex(days).ffill().fillna(0).shift(1).fillna(0)
        turn = w.diff().abs().sum(axis=1).fillna(0)
        return (w * R).sum(axis=1) - turn * CFG.COST_BPS / 1e4, w

    daily, W = {}, {}
    for k, name in [("A", "A Baseline"), ("B", "B AI-Infra ex-news"), ("E", "E Mock-Index baskets"), ("EM", "EM Emerging hedged")]:
        daily[name], W[name] = sim(T[k])
    plr = pd.DataFrame({k: sim(p)[0] for k, p in enumerate(PL)})
    daily["D1 SPY"] = spy_r.reindex(days).fillna(0)
    daily["D2 EW core"] = rets[core].reindex(days).mean(axis=1).fillna(0)
    for r_ in daily.values(): r_.iloc[0] = 0
    plr.iloc[0] = 0

    rows, eqs, eqs_s, stops = {}, {}, {}, {}
    for k, r in daily.items():
        e = CFG.CAPITAL * (1 + r).cumprod(); rs, ev = apply_stop(r); es = CFG.CAPITAL * (1 + rs).cumprod()
        eqs[k], eqs_s[k], stops[k] = e, es, ev
        m, ms = metrics(e), metrics(es)
        rows[k] = {**m, "CAGR_stop": ms["CAGR"], "MaxDD_stop": ms["MaxDD"], "Sharpe_stop": ms["Sharpe"], "stops": len(ev),
                   "HitRate": np.mean(hits[k[0]]) if k[0] in hits and k != "EM Emerging hedged" else np.nan}
    pm = pd.DataFrame([metrics(CFG.CAPITAL * (1 + plr[c]).cumprod()) for c in plr])
    pms = pd.DataFrame([metrics(CFG.CAPITAL * (1 + apply_stop(plr[c])[0]).cumprod()) for c in plr])
    rows[f"C Placebo (median of {seeds})"] = {**pm.median().to_dict(), "CAGR_stop": pms.CAGR.median(), "MaxDD_stop": pms.MaxDD.median(),
                                               "Sharpe_stop": pms.Sharpe.median(), "stops": np.nan, "HitRate": np.nan}
    met = pd.DataFrame(rows).T
    sh_b = met.loc["B AI-Infra ex-news", "Sharpe"]
    tests = {"p_placebo_ge_B": float((pm.Sharpe >= sh_b).mean()), "p_placebo_ge_E": float((pm.Sharpe >= met.loc["E Mock-Index baskets", "Sharpe"]).mean())}
    d = (daily["B AI-Infra ex-news"] - daily["A Baseline"]).values; bsm = []
    for _ in range(2000):
        idx = np.concatenate([np.arange(s, s + 20) % len(d) for s in rng.integers(0, len(d), len(d) // 20 + 1)])[:len(d)]
        bsm.append(d[idx].mean())
    tests["p_B_le_A"] = float((np.array(bsm) <= 0).mean())
    ic = pd.DataFrame(ic_rows).set_index("date")
    ics = pd.DataFrame({"meanIC": ic.mean(), "t": ic.mean() / ic.std() * np.sqrt(ic.count()), "weeks": ic.count()})

    d2c = float(met.loc['D2 EW core', 'CAGR'])
    flags = {k: why(k, eqs[k], daily[k], W.get(k), rets, groups, spy_r, met.loc[k], stops[k], d2c) for k in daily}
    flags[f"C Placebo (median of {seeds})"] = {"flag": "BEHIND" if met.iloc[-1].CAGR < CFG.TARGET_RETURN else "MEETS",
                                               "cagr_pct": float(met.iloc[-1].CAGR) * 100, "risk_max_dd_pct": float(met.iloc[-1].MaxDD) * 100,
                                               "note": "median of placebo runs; no single path to attribute",
                                               "why": ["random selection inside the same trend-filtered universe"]}

    # charts
    paths = {}
    fig, ax = plt.subplots(figsize=(12, 6)); e_pl = CFG.CAPITAL * (1 + plr).cumprod()
    ax.fill_between(days, e_pl.quantile(.05, axis=1), e_pl.quantile(.95, axis=1), color="grey", alpha=.25, label="C placebo 5–95%")
    for k, e in eqs.items(): ax.plot(e.index, e, label=k)
    ax.set_yscale("log"); ax.set_title("5y equity (log), $100 sleeves, no stop"); ax.legend(fontsize=8); ax.grid(alpha=.3)
    fig.tight_layout(); paths["equity"] = os.path.join(OUT, "equity_5y.png"); fig.savefig(paths["equity"], dpi=130); plt.close(fig)
    fig, ax = plt.subplots(figsize=(12, 6))
    for k, e in eqs_s.items(): ax.plot(e.index, e, label=f"{k} ({len(stops[k])} stops)")
    ax.set_yscale("log"); ax.set_title(f"5y equity WITH {CFG.STOP_DRAWDOWN:.0%} drawdown stop ({CFG.STOP_COOLDOWN_DAYS}-day cool-off)"); ax.legend(fontsize=8); ax.grid(alpha=.3)
    fig.tight_layout(); paths["equity_stop"] = os.path.join(OUT, "equity_5y_with_stop.png"); fig.savefig(paths["equity_stop"], dpi=130); plt.close(fig)
    fig, ax = plt.subplots(figsize=(12, 4.5))
    for k, e in eqs.items(): ax.plot(e.index, e / e.cummax() - 1, label=k, lw=1)
    ax.axhline(-CFG.STOP_DRAWDOWN, color="orange", ls=":", label=f"stop −{CFG.STOP_DRAWDOWN:.0%}")
    ax.set_title("Drawdowns (no stop)"); ax.legend(fontsize=7); ax.grid(alpha=.3)
    fig.tight_layout(); paths["drawdowns"] = os.path.join(OUT, "drawdowns_5y.png"); fig.savefig(paths["drawdowns"], dpi=130); plt.close(fig)

    met.to_csv(os.path.join(OUT, "metrics_5y.csv")); ics.to_csv(os.path.join(OUT, "ic_5y.csv"))
    pd.DataFrame(eqs).to_csv(os.path.join(OUT, "equity_5y.csv"))
    json.dump(flags, open(os.path.join(OUT, "dd_flags.json"), "w"), indent=1, default=str)
    json.dump(e_log, open(os.path.join(OUT, "E_basket_log.json"), "w"), indent=1)
    res = dict(met=met, ics=ics, tests=tests, flags=flags, paths=paths, core=core, emerging=em_why, start=str(days[0].date()),
               end=str(days[-1].date()), stops=stops, e_last=e_log[-1], e_counts=pd.Series([c for x in e_log for c in x["chosen"]]).value_counts().to_dict())
    report(res); return res


def why(name, eq, r, w, rets, groups, spy_r, m, stop_events, d2_cagr=None):
    """Return-target flag: FAIL when annualised return < TARGET_RETURN. Drawdown kept as a separate risk metric."""
    tgt = CFG.TARGET_RETURN; cagr = float(m.CAGR)
    dd = eq / eq.cummax() - 1
    out = {"flag": "BEHIND" if cagr < tgt else "MEETS", "target_annual_pct": tgt * 100, "cagr_pct": cagr * 100,
           "gap_pp": (cagr - tgt) * 100, "cagr_with_stop_pct": float(m.CAGR_stop) * 100,
           "flag_with_stop": "BEHIND" if m.CAGR_stop < tgt else "MEETS",
           "risk_max_dd_pct": float(m.MaxDD) * 100, "risk_vol_pct": float(m.Vol) * 100, "stop_events": stop_events,
           "time_underwater_pct": float((dd < -0.05).mean() * 100)}
    yr = (1 + r).groupby(r.index.year).prod() - 1
    out["calendar_returns_pct"] = {int(k): round(v * 100, 1) for k, v in yr.items()}
    spy_y = (1 + spy_r.reindex(r.index).fillna(0)).groupby(r.index.year).prod() - 1
    reasons = []
    if w is not None:
        cols = [c for c in w.columns if c in rets]
        contrib = (w[cols] * rets.reindex(w.index)[cols].fillna(0)).sum()
        hedged = "SPY" in w.columns and w["SPY"].abs().sum() > 0
        if hedged: contrib["SPY(hedge)"] = float((w["SPY"] * spy_r.reindex(w.index).fillna(0)).sum())
        contrib = contrib.drop(labels=["SPY"], errors="ignore")
        seg = contrib.drop(labels=["SPY(hedge)"], errors="ignore").groupby(groups).sum().sort_values()
        out["best_names_pct_pts"] = {k: round(v * 100, 1) for k, v in contrib.sort_values().tail(4)[::-1].items()}
        out["worst_names_pct_pts"] = {k: round(v * 100, 1) for k, v in contrib.sort_values().head(4).items()}
        out["segment_contrib_pct_pts"] = {k: round(v * 100, 1) for k, v in seg.items() if abs(v) > 1e-9}
        g = w.drop(columns=["SPY"], errors="ignore").clip(lower=0).sum(axis=1)
        out["avg_gross_exposure_pct"] = float(g.mean() * 100)
        turn = w.diff().abs().sum(axis=1).fillna(0)
        out["cost_drag_pct_per_yr"] = float(turn.sum() * CFG.COST_BPS / 1e4 / ((r.index[-1] - r.index[0]).days / 365.25) * 100)
        if g.mean() < 0.9: reasons.append(f"cash drag: only {g.mean():.0%} invested on average (trend filter / 35%-name & 50%-segment caps leave cash)")
        if hedged: reasons.append(f"hedge cost: SPY short contributed {contrib['SPY(hedge)']*100:+.1f} pts (simple sum) while SPY rose; half-size sleeve caps upside by design")
        if out["cost_drag_pct_per_yr"] > 0.5: reasons.append(f"turnover cost ~{out['cost_drag_pct_per_yr']:.1f}%/yr at 5 bps/side")
        if len(seg) and seg.iloc[0] < -0.05: reasons.append(f"loser segment: '{seg.index[0]}' cost {-seg.iloc[0]*100:.0f} pts; worst names {out['worst_names_pct_pts']}")
    if d2_cagr is not None and name not in ("D2 EW core", "D1 SPY"):
        reasons.append(f"selection vs simply holding the core basket: {cagr-d2_cagr:+.1%}/yr vs D2 EW ({d2_cagr:.1%}) — " + ("signal subtracted value" if cagr < d2_cagr else "signal added value"))
    bad = [y for y in yr.index if yr[y] < tgt]
    if bad: reasons.append("years below 29%: " + ", ".join(f"{y} {yr[y]:+.0%} (SPY {spy_y[y]:+.0%})" for y in bad) + f" ({r.index[0].year} and {r.index[-1].year} are partial years)")
    if m.CAGR_stop < m.CAGR - 0.01: reasons.append(f"the {CFG.STOP_DRAWDOWN:.0%} stop lowers CAGR to {m.CAGR_stop:.1%} (sits in cash through rebounds)")
    elif m.CAGR_stop > m.CAGR + 0.01: reasons.append(f"the {CFG.STOP_DRAWDOWN:.0%} stop raises CAGR to {m.CAGR_stop:.1%}")
    if out["time_underwater_pct"] > 50: reasons.append(f"spent {out['time_underwater_pct']:.0f}% of days >5% below its peak (max DD {m.MaxDD:.0%}) — compounding lost to drawdowns")
    out["why"] = reasons
    return out


def report(r):
    f = lambda x: "N/A" if pd.isna(x) else f"{x:.1%}"
    L = ["# Phase 2 — 5-year backtest", "", f"{r['start']} → {r['end']}, weekly, 5 bps/side. Core universe ({len(r['core'])}): ≥{CFG.MIN_HISTORY_YEARS}y prices and ≥{CFG.MIN_HISTORY_YEARS} annual SEC filings: {', '.join(r['core'])}.",
         "", "Emerging sleeve (excluded from core): " + "; ".join(f"{k} ({v})" for k, v in r["emerging"].items()), "",
         f"Stop: {CFG.STOP_DRAWDOWN:.0%} from peak → cash for {CFG.STOP_COOLDOWN_DAYS} trading days (stand-in for manual restart). Return target: > {CFG.TARGET_RETURN:.0%} annualised (drawdown is reported separately as risk).", "",
         "| Strategy | CAGR | Total | Vol | Sharpe | Max DD | CAGR w/ stop | Max DD w/ stop | Stops | Hit | ≥29%/yr? (no stop / stop) |", "|" + "---|" * 11]
    for k, x in r["met"].iterrows():
        fl = r["flags"][k]; L.append(f"| {k} | {f(x.CAGR)} | {f(x.Total)} | {f(x.Vol)} | {x.Sharpe:.2f} | {f(x.MaxDD)} | {f(x.CAGR_stop)} | {f(x.MaxDD_stop)} | {'' if pd.isna(x.stops) else int(x.stops)} | {f(x.HitRate)} | {fl['flag']} / {fl.get('flag_with_stop','N/A')} |")
    t = r["tests"]
    L += ["", f"Ambiguity tests: p(placebo Sharpe ≥ B) = {t['p_placebo_ge_B']:.2f}; p(placebo ≥ E) = {t['p_placebo_ge_E']:.2f}; block-bootstrap p(B ≤ A) = {t['p_B_le_A']:.2f} (pass needs < 0.05).", "",
          "| Signal (core) | mean IC | t | weeks |", "|---|---|---|---|"] + [f"| {k} | {x.meanIC:+.3f} | {x.t:+.2f} | {int(x.weeks)} |" for k, x in r["ics"].iterrows()]
    L += ["", f"E basket selection frequency (weeks chosen): {r['e_counts']}. Latest: {r['e_last']}.", "", "## Return-target flags (>29%/yr) — WHY", ""]
    for k, fl in r["flags"].items():
        L.append(f"### {k}: {fl['flag']} — CAGR {fl['cagr_pct']:.1f}% vs target {CFG.TARGET_RETURN:.0%} (risk: max DD {fl['risk_max_dd_pct']:.1f}%)")
        if "calendar_returns_pct" in fl: L.append(f"Calendar returns %: {fl['calendar_returns_pct']}; with stop: {fl['flag_with_stop']} ({fl['cagr_with_stop_pct']:.1f}%).")
        if "segment_contrib_pct_pts" in fl: L.append(f"Avg invested {fl['avg_gross_exposure_pct']:.0f}%; best names {fl['best_names_pct_pts']}; segment contributions (simple-sum pts) {fl['segment_contrib_pct_pts']}.")
        L += [f"- {x}" for x in fl.get("why", [])] + [fl.get("note", ""), ""]
    L += ["News legs (news_sent, graph_sent, Mock sentiment, risk-off) still cannot be backtested; B and E here are ex-news. Universe survivorship bias remains. Education only."]
    open(os.path.join(OUT, "phase2_report.md"), "w").write("\n".join(L))


if __name__ == "__main__":
    r = run(); print(open(os.path.join(OUT, "phase2_report.md")).read())
