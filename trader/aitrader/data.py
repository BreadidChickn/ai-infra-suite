"""Price history (Yahoo via yfinance, cached) + point-in-time SEC fundamentals from the terminal's snapshot."""
import os, json
import pandas as pd
import yfinance as yf
from .config import CACHE, SEC_JSON


def prices(tickers, period="4y", refresh=False):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, f"prices_{period}.pkl")
    if os.path.exists(f) and not refresh:
        px = pd.read_pickle(f)
        if set(tickers) <= set(px.columns):
            return px[tickers]
    df = yf.download(tickers, period=period, auto_adjust=True, progress=False, threads=True)["Close"]
    df = df.dropna(how="all")
    df.to_pickle(f)
    return df


def sec_quarterly():
    """{company_id: DataFrame(end, filed, revenue, operatingIncome, fcf)} using filing dates for no look-ahead."""
    d = json.load(open(SEC_JSON))["companies"]
    out = {}
    for cid, c in d.items():
        m = c.get("metrics", {})
        frames = []
        for k in ("revenue", "operatingIncome", "fcf"):
            q = m.get(k, {}).get("quarterly", [])
            if q:
                frames.append(pd.DataFrame(q)[["end", "filed", "val"]].rename(columns={"val": k}).set_index(["end"]))
        if not frames or "revenue" not in m:
            continue
        df = frames[0]
        for f in frames[1:]:
            df = df.join(f.drop(columns="filed"), how="left")
        df = df.reset_index()
        df["end"] = pd.to_datetime(df["end"]); df["filed"] = pd.to_datetime(df["filed"])
        out[cid] = df.sort_values("end").reset_index(drop=True)
    return out
