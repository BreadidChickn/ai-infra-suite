"""Publish 5y backtest + today's dry-run plan (trades status=dry_run, sleeve equity) + simulated weekly report."""
import json, glob, os, datetime as dt
import pandas as pd
from .config import CFG, STATE, REPORTS
from .publisher import Publisher, trades_from_plan, equity_from_state, backtest_payload, status_payload, mode_info, LABELS, BT_CODE
from .live import load_state

P5 = os.path.join(REPORTS, "phase2_5y")


def weekly_from_backtest(flags):
    eq = pd.read_csv(os.path.join(P5, "equity_5y.csv"), index_col=0, parse_dates=True)
    wk = eq.loc[eq.index >= eq.index[-1] - pd.Timedelta(days=eq.index[-1].weekday())]
    prev = eq.loc[:wk.index[0]].iloc[-2]
    rows, bench = [], []
    for name, code in BT_CODE.items():
        r = (wk[name].iloc[-1] / prev[name] - 1) * 100
        fl = flags[name]
        rows.append({"sleeve": code, "sleeve_label": LABELS[code], "return_pct": round(r, 3), "start_equity": round(prev[name], 2),
                     "end_equity": round(wk[name].iloc[-1], 2), "annualized_pct": round(fl["cagr_pct"], 2), "max_drawdown_pct": round(fl["risk_max_dd_pct"], 2)})
        if code.startswith("D"): bench.append({"name": "SPY" if code == "D_SPY" else "EW universe", "return_pct": round(r, 3)})
    behind = [r["sleeve"] for r in rows if r["annualized_pct"] < CFG.TARGET_RETURN * 100]
    why = "\n".join(f"{n} ({BT_CODE[n]}): CAGR {flags[n]['cagr_pct']:.1f}% vs {CFG.TARGET_RETURN:.0%} — " + "; ".join(flags[n].get("why", [])) for n in BT_CODE if BT_CODE[n] in behind)
    return {"week_start": str(wk.index[0].date()), "week_end": str(wk.index[-1].date()), "sleeves": rows, "benchmarks": bench,
            "target_flag": bool(behind), "target_annual_pct": CFG.TARGET_RETURN * 100,
            "summary": "BACKTEST SIMULATION of the week (no live or paper trading has happened yet). annualized_pct = 5y backtest CAGR. "
                       f"Behind the >{CFG.TARGET_RETURN:.0%}/yr target: {', '.join(behind) or 'none'}.",
            "why": why[:20000] or "All sleeves meet target.",
            "missed": [{"kind": "info", "detail": "News signals (news_sent, graph_sent, mock_sentiment) are not in the backtest; no point-in-time headline history."},
                       {"kind": "stat", "detail": "No signal IC is statistically significant over 5y (best: SEC fin_score t=1.75, 63 weeks)."}],
            "paper_vs_real": ["Simulated at closing prices with 5 bps/side; no fills, slippage beyond that, or fractional-order partials.",
                              "Universe chosen in 2026 (survivorship bias)."],
            "example": True}


def main():
    pub = Publisher(); res = {}
    plan_f = sorted(glob.glob(os.path.join(STATE, "plan_*.json")))[-1]; plan = json.load(open(plan_f))
    flags = json.load(open(os.path.join(P5, "dd_flags.json")))
    rep = open(os.path.join(P5, "phase2_report.md")).read().splitlines()
    core_line = next(l for l in rep if l.startswith("2021") or "Core universe" in l)
    em = [k.split(" (")[0] for k in next(l for l in rep if l.startswith("Emerging sleeve")).split(": ", 1)[1].split("; ")]
    bt = backtest_payload(os.path.join(P5, "metrics_5y.csv"), "2021-10-18 → 2026-10-16 (5y, weekly, 5 bps/side)",
                          core_line + f" Return target >{CFG.TARGET_RETURN:.0%}/yr; B/E ex-news.", em)
    res["backtest"] = pub.post("/api/bot/backtest", bt)
    trades = trades_from_plan(plan, mode_info())
    res["trades"] = pub.post("/api/bot/trades", {"trades": trades})
    prices = {k: v.get("price") for k, v in plan["signals"].items() if v.get("price")}; prices.update(plan["meta"]["prices"])
    res["equity"] = pub.post("/api/bot/equity", {"equity": equity_from_state(load_state(), prices)})
    res["status"] = pub.post("/api/bot/status", status_payload())
    res["weekly"] = pub.post("/api/bot/weekly-report", weekly_from_backtest(flags), name="api_bot_weekly-report")
    return res


if __name__ == "__main__":
    for k, v in main().items(): print(k, v["status"], v["body"])
