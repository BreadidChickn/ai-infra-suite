"""Live (paper) cycle: compute today's full signal set incl. news, build each sleeve's targets,
diff vs its virtual $100 book, and emit orders tagged via client_order_id. Phase 1 = dry-run only.

Sleeves: A, B, C (placebo, fixed seed per date), D_SPY, D_EW. Each sleeve's book lives in state/sleeves.json
(cash + shares), so sleeves sharing one paper account never get mixed up; Alpaca orders are tagged
'<sleeve>-<YYYYMMDD>-<SYM>-<side>' (live: 'LIVE-' prefix) so fills can be attributed back.
reconcile.reconcile() rebuilds those books from the broker's fills before every plan (the only writer of
state/sleeves.json); a book/broker mismatch in live mode halts (state/LIVE_HALTED.json) with no orders."""
import json, os, sys, time, datetime as dt
import numpy as np, pandas as pd
from .config import CFG, STATE, REPORTS
from .universe import tradable, market_of
from . import data, signals, portfolio, news, terminal_api
from . import backtest5y as b5
from .universe import neighbors
from . import reconcile as recon_mod

SLEEVES = recon_mod.SLEEVES


def load_state():
    f = os.path.join(STATE, "sleeves.json")
    if os.path.exists(f): return json.load(open(f))
    return {"start": CFG.START_DATE, "sleeves": {s: {"cash": CFG.CAPITAL, "shares": {}, "peak": CFG.CAPITAL, "paused": False} for s in SLEEVES}}


def compute_signals(refresh_prices=True):
    cos = tradable(); tick2id = {c["ticker"]: c["id"] for c in cos}
    px = data.prices(list(tick2id) + ["SPY", "SH"], period="1y", refresh=refresh_prices).ffill(limit=3)
    spy = px.pop("SPY"); sh = px.pop("SH"); px = px.dropna(axis=1, how="all")
    tick2id = {t: tick2id[t] for t in px.columns}
    t = px.index[-1]
    snap = terminal_api.signals(); nf = terminal_api.news_feed()
    items, fails = news.fetch_feed()
    now = time.time()
    by_id = news.company_news_sent(items, now)
    market_sent = news.weighted_score(items, now)
    src = "bot-python-port (terminal /api/signals 503 no_snapshot or unreachable)"
    mock_sent, t_mock, t_news = {}, {}, set()
    if snap and not snap.get("stale"):
        src = f"terminal /api/signals ({snap.get('generated_at')})"
        for c in snap.get("companies", []):
            if c.get("news", {}).get("company_score") is not None:
                by_id[c["id"]] = c["news"]["company_score"]; t_news.add(c.get("ticker"))
            elif c["id"] in by_id:
                by_id.pop(c["id"])  # terminal says no headlines -> N/A (do not mix sources)
            if c.get("mock_index"):
                mock_sent[c["ticker"]] = c["mock_index"].get("sentiment"); t_mock[c["ticker"]] = c["mock_index"]
        if nf and nf.get("composite", {}).get("score") is not None: market_sent = nf["composite"]["score"]
    mi = signals.mock_idx(px, t, tick2id)
    sig = pd.DataFrame({
        "news_sent": pd.Series({tk: by_id.get(cid) for tk, cid in tick2id.items()}, dtype=float),
        "graph_sent": signals.graph_sent(by_id, tick2id),
        "fin_score": signals.fin_score(data.sec_quarterly(), t, tick2id),
        "growth": mi["growth"], "risk": mi["risk"],
        "momentum": signals.momentum(px, t), "vol": signals.vol(px, t), "trend_ok": signals.trend_ok(px, t),
        "price": px.iloc[-1],
        "mock_sentiment": pd.Series(mock_sent, dtype=float).reindex(list(tick2id)),
        "rel_degree": pd.Series({tk: len(neighbors(cid)) for tk, cid in tick2id.items()}, dtype=float)})
    for tk, m in t_mock.items():  # terminal is primary for mock_* scores
        if tk in sig.index:
            for k in ("growth", "risk"):
                if m.get(k) is not None: sig.loc[tk, k] = float(m[k])
    sig["src_news"] = ["terminal" if tk in t_news else ("bot" if pd.notna(sig.news_sent.get(tk)) else "N/A") for tk in sig.index]
    sig["src_mock"] = ["terminal" if tk in t_mock else "bot" for tk in sig.index]
    sec = data.sec_quarterly(); yoy = {}
    for tk, cid in tick2id.items():
        d = sec.get(cid); d = d[d.filed <= t] if d is not None else None
        if d is not None and len(d) >= 5:
            last = d.iloc[-1]; ya = d[(d.end <= last.end - pd.Timedelta(days=350)) & (d.end >= last.end - pd.Timedelta(days=380))]
            yoy[tk] = last.revenue / ya.iloc[-1].revenue - 1 if len(ya) and ya.iloc[-1].revenue else None
    sig["sec_rev_yoy"] = pd.Series(yoy, dtype=float).reindex(sig.index)
    groups = pd.Series({tk: market_of(cid) for tk, cid in tick2id.items()})
    meta = {"asof": str(t.date()), "headlines": len(items), "news_failures": len(fails), "signal_source": src,
            "market_news_sent": market_sent, "snapshot_meta": {k: snap.get(k) for k in ("generated_at", "news_mode", "quotes", "age_seconds", "stale")} if snap else None, "spy": float(spy.iloc[-1]), "sh": float(sh.iloc[-1]),
            "prices": {"SPY": float(spy.iloc[-1]), "SH": float(sh.iloc[-1])}}
    return sig, groups, meta, items, px, spy


def targets(sig, groups, meta, date_seed, px=None, spy=None):
    ok = sig.trend_ok.astype(bool)
    out = {"A": portfolio.build(sig.momentum, ok, sig.vol, groups)}
    sB = portfolio.composite(sig, CFG.WEIGHTS_B); sig["B_score"] = sB
    out["B"] = portfolio.build(sB, ok, sig.vol, groups)
    elig = sB[ok & sB.notna() & sig.vol.notna()]
    rng = np.random.default_rng(date_seed)
    out["C"] = portfolio.build(pd.Series(rng.permutation(elig.values), index=elig.index), ok, sig.vol, groups)
    out["D_SPY"] = pd.Series({"SPY": 1.0})
    # E + EM need the 5y core/emerging split (>=5y prices and >=5 annual SEC filings)
    import json as _j
    b5.TICK2ID = {tk: c["id"] for tk, c in ((c["ticker"], c) for c in tradable())}
    b5.BY_TK = {c["ticker"]: c for c in tradable()}
    hist = pd.read_pickle(os.path.join(b5.CACHE, "prices_7y.pkl"))
    core, emerging, _ = b5.split_universe(hist, _j.load(open(data.SEC_JSON))["companies"], hist.index[-1])
    core = [c for c in core if c in sig.index]; emerging = [c for c in emerging if c in sig.index]
    t = px.index[-1]; bs = {}
    for g in groups[core].unique():
        sc = b5.basket_scores(px.loc[:t], [x for x in core if groups[x] == g], t)
        if sc: bs[g] = sc
    bdf = pd.DataFrame(bs).T; bdf["promise"] = bdf.growth + bdf.profitability - bdf.risk
    chosen = bdf[bdf.risk <= CFG.E_RISK_MAX].sort_values("promise", ascending=False).index[:CFG.E_TOP_BASKETS].tolist()
    meta["E_baskets"] = {"chosen": chosen, "scores": bdf.round(1).to_dict(orient="index")}
    inb = pd.Series({x: (x in core and groups[x] in chosen) for x in sig.index})
    out["E"] = portfolio.build(sig.momentum, ok & inb, sig.vol, groups)
    em = pd.Series({x: x in emerging for x in sig.index})
    s_ = sig.momentum[ok & em & sig.momentum.notna() & sig.vol.notna()].sort_values(ascending=False).index[:CFG.TOP_N]
    if len(s_):
        w = 1 / sig.vol[s_]; w = (w / w.sum()).clip(upper=CFG.EMERGING_MAX_WEIGHT / CFG.EMERGING_GROSS) * CFG.EMERGING_GROSS
        rr = px[s_].pct_change().iloc[-120:]; sr = spy.pct_change().iloc[-120:]
        beta = float(sum(w[x] * rr[x].cov(sr) / sr.var() for x in s_) / w.sum())
        meta["EM_beta"] = beta
        out["EM"] = pd.concat([w, pd.Series({"SH": CFG.EMERGING_HEDGE * beta * w.sum()})])  # long SH = short-SPY hedge
    else: out["EM"] = pd.Series(dtype=float)
    names = sig.index[sig.price.notna()]
    out["D_EW"] = pd.Series(1 / len(names), index=names)
    if meta["market_news_sent"] is not None and meta["market_news_sent"] < CFG.RISK_OFF_NEWS:
        for k in ("A", "B", "C", "E", "EM"): out[k] = pd.Series(dtype=float)  # risk-off -> cash
    return out


def plan_orders(state, tg, prices, day, close_all=False):
    orders = []
    for s, book in state["sleeves"].items():
        eq = book["cash"] + sum(q * prices.get(sym, np.nan) for sym, q in book["shares"].items())
        eq = min(eq, CFG.CAPITAL * 10)  # sanity
        book["peak"] = max(book["peak"], eq)
        if eq < book["peak"] * (1 - CFG.STOP_DRAWDOWN): book["paused"] = True
        w = pd.Series(dtype=float) if (close_all or book["paused"]) else tg.get(s, pd.Series(dtype=float))
        budget = min(eq, CFG.CAPITAL)  # hard cap: never deploy more than $100 per sleeve
        syms = set(w.index) | set(book["shares"])
        for sym in sorted(syms):
            px = prices.get(sym)
            if px is None or np.isnan(px): continue
            cur = book["shares"].get(sym, 0) * px
            tgt = float(w.get(sym, 0)) * budget
            diff = tgt - cur
            if abs(diff) < CFG.MIN_ORDER_USD and not (tgt == 0 and cur > 0): continue
            side = "buy" if diff > 0 else "sell"
            o = {"symbol": sym, "side": side, "type": "market", "time_in_force": "day",
                 "client_order_id": f"{s}-{day:%Y%m%d}-{sym}-{side}"[:48]}
            if tgt == 0 and cur > 0: o["qty"] = str(round(book["shares"][sym], 9))  # full exit by qty
            else: o["notional"] = f"{abs(diff):.2f}"
            o["why"] = (f"target {float(w.get(sym, 0)):.1%} of ${budget:.0f} sleeve" + (" (SPY-beta hedge via SH)" if sym == "SH" else ""))
            orders.append({"sleeve": s, "est_usd": round(diff, 2), **o})
    # sells (full exits and trims) before buys, so buys can be funded by the sells' proceeds (stable sort)
    orders.sort(key=lambda o: o["side"] != "sell")
    return orders


def run(dry_run=True):
    os.makedirs(STATE, exist_ok=True); os.makedirs(REPORTS, exist_ok=True)
    sig, groups, meta, items, px, spy = compute_signals()
    state = load_state()
    start = dt.date.fromisoformat(state["start"]) if state.get("start") else dt.date.today()
    nd = CFG.period_days(); end = start + dt.timedelta(days=nd) if nd else None
    today = dt.date.today()
    close_all = bool(end and today >= end)
    tg = targets(sig, groups, meta, int(today.strftime("%Y%m%d")), px, spy)
    prices = sig.price.to_dict(); prices["SPY"] = meta["spy"]; prices["SH"] = meta["sh"]
    # Rebuild every sleeve book from broker fills BEFORE planning (writes state/sleeves.json atomically).
    from . import live_guard
    live_ready = CFG.TRADING_MODE == "live" and not live_guard.live_refusals(state_dir=STATE)
    try:
        from .alpaca import Alpaca
        rc_client = Alpaca.for_mode() if live_ready else Alpaca()
        start_cash = {CFG.LIVE_SLEEVE: min(CFG.CAPITAL, CFG.LIVE_MAX_CAPITAL)} if live_ready else None
        rc = recon_mod.reconcile(rc_client, STATE, prices=prices, prev_state=state, start_cash=start_cash, capital=CFG.CAPITAL)
        state = rc["state"]
        recon = {k: rc[k] for k in ("ok", "at", "orders_seen", "mismatches", "problems")}
    except Exception as e:
        recon = {"ok": False, "error": str(e)[:200]}
    if live_ready and not recon["ok"] and (recon.get("mismatches") or recon.get("problems")):
        # books disagree with the broker: never trade on a wrong book. Halt, place no orders (no close-all).
        live_guard.write_halt(STATE, "reconcile mismatch: " + json.dumps(recon.get("mismatches") or recon.get("problems"), default=str)[:400],
                              close_all="not requested (book/broker mismatch; review manually)")
    orders = plan_orders(state, tg, prices, today, close_all)
    acct = None
    try:
        from .alpaca import Alpaca
        a = Alpaca(); ac = a.account()
        acct = {"status": ac.get("status"), "equity": ac.get("equity"), "buying_power": ac.get("buying_power")}
        for o in orders:
            asset = a.asset(o["symbol"])
            o["alpaca_tradable"] = bool(asset and asset.get("tradable"))
            o["fractionable"] = bool(asset and asset.get("fractionable"))
            o["result"] = a.submit_order({k: v for k, v in o.items() if k in ("symbol", "side", "type", "time_in_force", "client_order_id", "qty", "notional")}, dry_run=True)
    except Exception as e:
        acct = {"error": str(e)[:200]}
    snap = {"meta": meta, "period": {"start": str(start), "end": str(end) if end else "ongoing", "close_all": close_all},
            "account": acct, "reconcile": recon, "targets": {k: v.round(4).to_dict() for k, v in tg.items()},
            "signals": sig.astype(object).where(sig.notna(), None).to_dict(orient="index"), "orders": orders, "dry_run": True}
    f = os.path.join(STATE, f"plan_{today:%Y%m%d}.json")
    json.dump(snap, open(f, "w"), indent=1, default=str)
    # Real money: only when every live condition holds (live_guard). Otherwise this block is a no-op.
    if CFG.TRADING_MODE == "live":
        refusals = live_guard.live_refusals(state_dir=STATE)
        if not recon["ok"]: refusals = refusals + ["sleeve books not reconciled with broker: " + str(recon.get("error") or recon.get("mismatches") or recon.get("problems"))[:300]]
        if refusals:
            snap["live"] = {"refused": refusals}
        else:
            from .alpaca import Alpaca
            client = Alpaca.for_mode()
            deployed = sum(float(p.get("market_value", 0)) for p in client.positions())
            try:
                snap["live"] = {"results": live_guard.LiveExecutor(client, STATE).execute(orders, deployed)}
            except live_guard.LiveRefused as e:
                snap["live"] = {"refused": [str(e)]}
            json.dump(snap, open(f, "w"), indent=1, default=str)
    # NOTE: books in state/sleeves.json are rebuilt from broker fills by reconcile() at the start of the next run.
    return snap, f


if __name__ == "__main__":
    snap, f = run()
    print("plan:", f); print(json.dumps({k: snap[k] for k in ("meta", "period", "account", "targets")}, indent=1, default=str))
    for o in snap["orders"]: print(o["sleeve"], o["side"], o["symbol"], o.get("notional", o.get("qty")), "tradable=", o.get("alpaca_tradable"), "frac=", o.get("fractionable"))
