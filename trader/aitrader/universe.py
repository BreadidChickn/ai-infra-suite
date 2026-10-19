"""Universe + relationship graph exported from the AI Infra Terminal copy (src/data/*.ts -> data/universe.json)."""
import json
from .config import UNIVERSE_JSON

_D = json.load(open(UNIVERSE_JSON))
COMPANIES = _D["companies"]
RELATIONSHIPS = _D["relationships"]
MARKETS = _D["markets"]
SEG_TO_MARKET = {s: m["id"] for m in MARKETS for s in m["segments"]}
BY_ID = {c["id"]: c for c in COMPANIES}


def tradable(us_only=True):
    """Public companies with a US-listed symbol (Alpaca trades US equities only)."""
    out = []
    for c in COMPANIES:
        t = c.get("ticker")
        if not t or c.get("isPrivate"):
            continue
        if us_only and ("." in t or t[0].isdigit()):
            continue
        out.append(c)
    return out


def market_of(cid):
    return SEG_TO_MARKET.get(BY_ID[cid]["segment"], "other")


def neighbors(cid):
    """Undirected neighbours with edge strength (1-10); competitor edges excluded from contagion."""
    out = {}
    for r in RELATIONSHIPS:
        if r["type"] == "competitor":
            continue
        for a, b in ((r["source"], r["target"]), (r["target"], r["source"])):
            if a == cid:
                out[b] = max(out.get(b, 0), r.get("strength", 5))
    return out
