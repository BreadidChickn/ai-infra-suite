"""Publisher conforming to ../terminal/docs/bot-api-contract.md (v1).
POST /api/bot/trades | /equity | /weekly-report | /backtest. Auth: env BOT_TOKEN -> 'Authorization: Bearer'
(never logged); with no token the server accepts loopback writes. Every payload is also written to outbox/."""
import os, json, datetime as dt
import requests
from .config import CFG, ROOT

OUTBOX = os.path.join(ROOT, "outbox")
LABELS = {"A": "Baseline (momentum + trend)", "B": "AI-Infra (dashboard signals)", "C": "Placebo",
          "D_SPY": "SPY buy&hold", "D_EW": "Equal-weight universe", "E": "Mock Index baskets", "EM": "Emerging names (hedged)"}
BT_CODE = {"A Baseline": "A", "B AI-Infra ex-news": "B", "E Mock-Index baskets": "E", "EM Emerging hedged": "EM",
           "D1 SPY": "D_SPY", "D2 EW core": "D_EW"}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _pct(x):
    return None if x is None or x != x else round(float(x) * 100, 3)


def _clean(d):
    return {k: v for k, v in d.items() if v is not None}


def trades_from_plan(plan):
    ts = now_iso(); out = []
    for o in plan["orders"]:
        sig = (plan.get("signals") or {}).get(o["symbol"], {}) or {}
        price = sig.get("price") or plan["meta"].get("prices", {}).get(o["symbol"])
        if not price or price <= 0: continue
        notional = float(o["notional"]) if "notional" in o else float(o["qty"]) * price
        qty = float(o["qty"]) if "qty" in o else notional / price
        signals = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in {
            "news_sent": sig.get("news_sent"), "mock_sentiment": sig.get("mock_sentiment"),
            "mock_growth": sig.get("growth"), "mock_risk": sig.get("risk"), "sec_fin_score": sig.get("fin_score"),
            "sec_rev_yoy": sig.get("sec_rev_yoy"), "rel_degree": sig.get("rel_degree"), "graph_sent": sig.get("graph_sent"),
            "mom_6m_skip1w": sig.get("momentum"), "vol_60d": sig.get("vol"), "trend_sma50": sig.get("trend_ok"),
            "b_score": sig.get("B_score"), "src_news": sig.get("src_news"), "src_mock": sig.get("src_mock")}.items()}
        out.append(_clean({
            "id": o["client_order_id"], "order_id": o["client_order_id"], "ts": ts, "ticker": o["symbol"],
            "side": o["side"], "qty": round(qty, 6), "price": round(float(price), 4), "notional": round(notional, 2),
            "sleeve": o["sleeve"], "sleeve_label": LABELS[o["sleeve"]], "status": "dry_run", "timeframe": "weekly",
            "reason": {"text": f"DRY RUN (no order placed) — {o.get('why', 'weekly rebalance to target weight')}; plan as of close {plan['meta']['asof']}.",
                       "signals": signals}}))
    return out


def equity_from_state(state, prices):
    ts = now_iso(); out = []
    for s, b in state["sleeves"].items():
        pos = [{"ticker": t, "qty": q, "price": prices.get(t), "market_value": round(q * prices.get(t, 0), 4)} for t, q in b["shares"].items()]
        eq = b["cash"] + sum(p["market_value"] for p in pos)
        out.append({"ts": ts, "sleeve": s, "sleeve_label": LABELS[s], "equity": round(eq, 4), "cash": round(b["cash"], 4), "positions": pos})
    return out


def backtest_payload(metrics_csv, period, universe_note, newer):
    import pandas as pd
    m = pd.read_csv(metrics_csv, index_col=0); rows = []
    for name, r in m.iterrows():
        code = BT_CODE.get(name, "C" if name.startswith("C Placebo") else None)
        if not code: continue
        rows.append(_clean({"sleeve": code, "sleeve_label": LABELS[code], "cagr_pct": _pct(r.CAGR), "total_return_pct": _pct(r.Total),
                            "vol_pct": _pct(r.Vol), "sharpe": round(float(r.Sharpe), 3), "max_dd_pct": _pct(r.MaxDD),
                            "hit_rate_pct": _pct(r.HitRate),
                            "note": (f"{name}; with {CFG.STOP_DRAWDOWN:.0%} stop: CAGR {r.CAGR_stop:.1%}, maxDD {r.MaxDD_stop:.1%}; "
                                     f"{'MEETS' if r.CAGR >= CFG.TARGET_RETURN else 'BEHIND'} {CFG.TARGET_RETURN:.0%}/yr target")[:300]}))
    return {"generated_at": now_iso(), "period": period[:80], "universe_note": universe_note[:2000], "rows": rows, "newer_names_flagged": newer}


class Publisher:
    def __init__(self, base=None):
        self.base = (base or CFG.BOT_API).rstrip("/")
        self.h = {"Content-Type": "application/json"}
        tok = os.environ.get("BOT_TOKEN")
        if tok: self.h["Authorization"] = f"Bearer {tok}"
        os.makedirs(OUTBOX, exist_ok=True)

    def post(self, path, payload, send=True, name=None):
        fn = os.path.join(OUTBOX, (name or path.strip("/").replace("/", "_")) + ".json")
        json.dump(payload, open(fn, "w"), indent=1, default=str)
        if not send: return {"sent": False, "outbox": fn}
        r = requests.post(self.base + path, data=json.dumps(payload, default=str), headers=self.h, timeout=20)
        try: body = r.json()
        except ValueError: body = r.text[:200]
        return {"sent": True, "status": r.status_code, "body": body, "outbox": fn}

    def get(self, path):
        return requests.get(self.base + path, timeout=10).json()
