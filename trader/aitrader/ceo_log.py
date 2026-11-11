"""CEO Pulse daily log (informational only; never used for weights or orders).

Saves the terminal's /api/signals `ceo` array each run so the key-man flag's threshold can be
calibrated over time, and lists which sleeve holdings have a CEO flagged Elevated/High.
"""
import json, os

FLAGGED = ("Elevated", "High")
KEEP = ("name", "company", "company_id", "ticker", "score", "headlines", "key_man_risk", "key_man_evidence", "event_tags", "updated_at")
MISSING = (None, "insufficient", "Not enough coverage")


def build(ceo, state, day):
    rows = [{k: c.get(k) for k in KEEP} for c in (ceo or []) if isinstance(c, dict)]
    by_tk = {}
    for r in rows:
        if r.get("ticker"): by_tk.setdefault(r["ticker"], r)
    held = {}
    for s, book in ((state or {}).get("sleeves") or {}).items():
        hits = [{"symbol": sym, "ceo": by_tk[sym]["name"], "key_man_risk": by_tk[sym]["key_man_risk"], "score": by_tk[sym]["score"]}
                for sym, q in (book.get("shares") or {}).items() if q and sym in by_tk and by_tk[sym].get("key_man_risk") in FLAGGED]
        if hits: held[s] = hits
    for r in rows:  # thin coverage is missing data, never neutral
        r["missing"] = r.get("score") is None or str(r.get("key_man_risk") or "").strip().lower() in ("", "insufficient", "not enough coverage")
    n_missing = sum(r["missing"] for r in rows)
    return {"date": str(day), "informational_only": True, "count": len(rows), "scored": len(rows) - n_missing,
            "missing": n_missing, "ceo": rows, "held_flagged": held}


def write(state_dir, ceo, state, day):
    d = os.path.join(state_dir, "ceo_log"); os.makedirs(d, exist_ok=True)
    out = build(ceo, state, day)
    f = os.path.join(d, f"ceo_{day:%Y%m%d}.json")
    with open(f, "w") as fh: json.dump(out, fh, indent=1, default=str)
    return f, out
