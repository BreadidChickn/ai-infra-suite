"""Signal scoring, ported from the terminal (newsFeed.ts, MockIndexTab.tsx, finAnalysis-style ratios).
Every function takes an as-of date and only uses data available at that date."""
import numpy as np
import pandas as pd
from .universe import BY_ID, neighbors
from .config import CFG


def zs(s):
    s = pd.Series(s, dtype=float)
    sd = s.std()
    return (s - s.mean()) / sd if sd and sd > 0 else s * 0


def momentum(px, t):
    i = px.index.get_loc(t)
    if i < CFG.MOM_LOOKBACK: return pd.Series(np.nan, index=px.columns)
    return px.iloc[i - CFG.MOM_SKIP] / px.iloc[i - CFG.MOM_LOOKBACK] - 1


def vol(px, t):
    r = px.loc[:t].pct_change().iloc[-CFG.VOL_WINDOW:]
    v = r.std() * np.sqrt(252)
    v[r.count() < CFG.VOL_WINDOW * 0.8] = np.nan
    return v


def trend_ok(px, t):
    h = px.loc[:t]
    sma = h.iloc[-CFG.TREND_SMA:].mean()
    ok = h.iloc[-1] > sma
    ok[h.iloc[-CFG.TREND_SMA:].count() < CFG.TREND_SMA] = False
    return ok


def _ret(h, n):
    if len(h) <= n or pd.isna(h.iloc[-1 - n]): return np.nan
    return (h.iloc[-1] / h.iloc[-1 - n] - 1) * 100


def mock_idx(px, t, tick2id):
    """Per-company version of MockIndexTab scores (single-member basket).
    growth = 50 + 0.9*(0.3*r1M + 0.35*r1Q + 0.2*rYTD)   [% returns]
    risk   = 35*private + 40*(CN/TW) + 2.5*(|r1D| + 0.3*|r1M|) + 15, clamped 0..100
    (sentiment needs news -> see news_sent; the '1D estimate' is NOT used)."""
    h = px.loc[:t]
    ytd_start = h[h.index.year == t.year]
    rows = {}
    for tk in px.columns:
        s = h[tk].dropna()
        if len(s) < 70: rows[tk] = (np.nan, np.nan); continue
        r1d, r1m, r1q = _ret(s, 1), _ret(s, 21), _ret(s, 63)
        y0 = ytd_start[tk].dropna()
        base = s[s.index < t.replace(month=1, day=1)]
        rytd = (s.iloc[-1] / base.iloc[-1] - 1) * 100 if len(base) else np.nan
        g = 0.3 * r1m + 0.35 * r1q + 0.2 * (0 if np.isnan(rytd) else rytd)
        growth = min(100, max(0, 50 + g * 0.9))
        c = BY_ID[tick2id[tk]]
        geo = 1 if c.get("country") in ("CN", "TW") else 0
        risk = min(100, max(0, 35 * bool(c.get("isPrivate")) + 40 * geo + 2.5 * (abs(r1d) + 0.3 * abs(r1m)) + 15))
        rows[tk] = (growth, risk)
    df = pd.DataFrame(rows, index=["growth", "risk"]).T
    return df


def fin_score(sec, t, tick2id):
    """zscore(revenue YoY) + zscore(operating-margin QoQ change) + zscore(FCF margin),
    using only quarters whose 10-Q/10-K was filed on or before t. N/A -> NaN."""
    raw = {}
    for tk, cid in tick2id.items():
        df = sec.get(cid)
        if df is None: raw[tk] = (np.nan,) * 3; continue
        d = df[df["filed"] <= t]
        if len(d) < 2: raw[tk] = (np.nan,) * 3; continue
        last, prev = d.iloc[-1], d.iloc[-2]
        yago = d[(d["end"] <= last["end"] - pd.Timedelta(days=350)) & (d["end"] >= last["end"] - pd.Timedelta(days=380))]
        yoy = last["revenue"] / yago.iloc[-1]["revenue"] - 1 if len(yago) and yago.iloc[-1]["revenue"] else np.nan
        om = lambda r: r["operatingIncome"] / r["revenue"] if r["revenue"] and pd.notna(r.get("operatingIncome")) else np.nan
        dm = om(last) - om(prev)
        fcfm = last["fcf"] / last["revenue"] if pd.notna(last.get("fcf")) and last["revenue"] else np.nan
        raw[tk] = (yoy, dm, fcfm)
    df = pd.DataFrame(raw, index=["rev_yoy", "dmargin", "fcf_margin"]).T.astype(float)
    df = df.clip(df.quantile(0.05), df.quantile(0.95), axis=1)
    score = zs(df["rev_yoy"]).fillna(0) + zs(df["dmargin"]).fillna(0) + zs(df["fcf_margin"]).fillna(0)
    score[df.isna().all(axis=1)] = np.nan
    return score


def graph_sent(news_by_id, tick2id):
    """Strength-weighted mean news_sent of each company's relationship neighbours (relationships.ts)."""
    out = {}
    for tk, cid in tick2id.items():
        num = den = 0.0
        for nb, w in neighbors(cid).items():
            v = news_by_id.get(nb)
            if v is not None: num += w * v; den += w
        out[tk] = num / den if den else np.nan
    return pd.Series(out, dtype=float)
