"""Rebuild each sleeve's book (cash, shares, peak) from the broker's own fill records.

Why: the planner diffs targets against state/sleeves.json. If nothing writes that file, a sleeve never
sees what it bought, so it never sells or rotates after the first rebalance. reconcile() is the only
writer: it runs before every plan, rebuilds the books from Alpaca orders, writes sleeves.json
atomically, and checks the books against broker positions.

Attribution (tag scheme, set in live.plan_orders / live_guard.LiveExecutor):
  planner  client_order_id = "<sleeve>-<YYYYMMDD>-<SYM>-<side>"
  live     client_order_id = "LIVE-<sleeve>-<YYYYMMDD>-<SYM>-<side>"
An order counts for a sleeve only if its client_order_id matches one of those (sleeve names never
contain '-'). Its filled_qty at filled_avg_price moves shares and cash; status does not matter, so a
partially filled then cancelled order still counts for what filled. Untagged orders are ignored, except
SELL fills submitted at/after a recorded liquidating halt (state/halt_history.jsonl): those are the
broker's close-all orders, applied pro rata to the sleeves that held the symbol (never more than held).

Mismatch: for every symbol the bot holds or has traded, the summed sleeve shares must equal the broker
position within RECON_TOL_USD (default $0.50) of value. Otherwise ok=False and callers must not trade.
Stdlib only, so it is unit-tested without network or pandas."""
import json, os, re, datetime as dt

SLEEVES = ["A", "B", "C", "D_SPY", "D_EW", "E", "EM"]
_TAG = re.compile(r"^(?:LIVE-)?(" + "|".join(sorted(map(re.escape, SLEEVES), key=len, reverse=True)) + r")-\d{8}-")
QTY_EPS = 1e-6


def sleeve_of(client_order_id):
    m = _TAG.match(client_order_id or "")
    return m.group(1) if m else None


def parse_ts(s):
    """Alpaca timestamps may carry nanoseconds and a 'Z'; returns aware UTC datetime or None."""
    if not s: return None
    s = str(s).replace("Z", "+00:00")
    m = re.match(r"^(.*T\d{2}:\d{2}:\d{2})(\.\d+)?(.*)$", s)
    if m: s = m.group(1) + ((m.group(2) or "")[:7]) + m.group(3)
    try: t = dt.datetime.fromisoformat(s)
    except ValueError: return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _f(x, d=0.0):
    try: return float(x)
    except (TypeError, ValueError): return d


def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh: json.dump(obj, fh, indent=1, default=str)
    os.replace(tmp, path)


def fetch_orders(client, after=None, page=500, max_pages=50):
    """All orders (any status) oldest first, paginated by submitted_at; de-duplicated by id."""
    seen, out, cursor = set(), [], after
    for _ in range(max_pages):
        kw = {"status": "all", "limit": page, "direction": "asc"}
        if cursor: kw["after"] = cursor
        batch = client.orders(**kw) or []
        new = [o for o in batch if o.get("id") not in seen]
        for o in new: seen.add(o.get("id")); out.append(o)
        if len(batch) < page or not new: break
        cursor = max(o.get("submitted_at") or "" for o in batch) or cursor
    return out


def halt_times(state_dir):
    f = os.path.join(state_dir, "halt_history.jsonl"); out = []
    if os.path.exists(f):
        with open(f) as fh:
            for line in fh:
                try: t = parse_ts(json.loads(line).get("halted_at"))
                except ValueError: t = None
                if t: out.append(t)
    return out


def rebuild_books(orders, start_cash, halts=()):
    """orders: Alpaca order dicts. start_cash: {sleeve: starting cash}. Returns (books, fills, problems)."""
    books = {s: {"cash": float(c), "shares": {}} for s, c in start_cash.items()}
    fills, problems, last_px = [], [], {}
    first_halt = min(halts) if halts else None
    def key(o): return (parse_ts(o.get("filled_at")) or parse_ts(o.get("submitted_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
    for o in sorted(orders, key=key):
        q, px = _f(o.get("filled_qty")), _f(o.get("filled_avg_price"))
        if q <= 0 or px <= 0: continue
        sym, side, s = o.get("symbol"), o.get("side"), sleeve_of(o.get("client_order_id"))
        last_px[sym] = px
        if s in books:
            b = books[s]; sh = b["shares"]
            if side == "buy": sh[sym] = sh.get(sym, 0.0) + q; b["cash"] -= q * px
            elif side == "sell":
                if q > sh.get(sym, 0.0) + QTY_EPS: problems.append(f"{s} sold {q:g} {sym} but book held {sh.get(sym, 0.0):g}")
                sh[sym] = sh.get(sym, 0.0) - q; b["cash"] += q * px
            else: problems.append(f"unknown side {side!r} on {o.get('client_order_id')}"); continue
            fills.append({"sleeve": s, "symbol": sym, "side": side, "qty": q, "price": px, "client_order_id": o.get("client_order_id")})
        elif s is None and side == "sell" and first_halt and (parse_ts(o.get("submitted_at")) or first_halt) >= first_halt - dt.timedelta(minutes=1):
            holders = {k: b["shares"].get(sym, 0.0) for k, b in books.items() if b["shares"].get(sym, 0.0) > QTY_EPS}
            tot = sum(holders.values())
            if tot <= 0: continue
            take = min(q, tot)
            for k, h in holders.items():
                dq = take * h / tot; books[k]["shares"][sym] = h - dq; books[k]["cash"] += dq * px
                fills.append({"sleeve": k, "symbol": sym, "side": "sell", "qty": dq, "price": px, "client_order_id": o.get("client_order_id"), "liquidation": True})
    for b in books.values():
        b["shares"] = {k: round(v, 9) for k, v in b["shares"].items() if abs(v) > QTY_EPS}
        b["cash"] = round(b["cash"], 6)
    return books, fills, problems, last_px


def compare(books, positions, traded_symbols=(), tol_usd=0.50, prices=None):
    """Mismatches between summed sleeve shares and broker positions for the bot's symbols only."""
    broker, bpx = {}, {}
    for p in positions or []:
        q = _f(p.get("qty")); broker[p["symbol"]] = q
        cp = _f(p.get("current_price")) or (_f(p.get("market_value")) / q if q else 0.0)
        if cp > 0: bpx[p["symbol"]] = cp
    book_q = {}
    for b in books.values():
        for sym, q in b["shares"].items(): book_q[sym] = book_q.get(sym, 0.0) + q
    out = []
    for sym in sorted(set(book_q) | set(traded_symbols)):
        bq, rq = book_q.get(sym, 0.0), broker.get(sym, 0.0)
        px = bpx.get(sym) or (prices or {}).get(sym) or 0.0
        if bq < -QTY_EPS or rq < -QTY_EPS:
            out.append({"symbol": sym, "book_qty": bq, "broker_qty": rq, "reason": "negative quantity (long-only)"}); continue
        d = rq - bq
        if abs(d) > QTY_EPS and (px <= 0 or abs(d) * px > tol_usd):
            out.append({"symbol": sym, "book_qty": round(bq, 9), "broker_qty": round(rq, 9), "diff_usd": round(d * px, 4) if px else None})
    return out


def book_equity(book, prices):
    return book["cash"] + sum(q * _f(prices.get(sym)) for sym, q in book["shares"].items())


def reconcile(client, state_dir, prices=None, prev_state=None, start_cash=None, capital=100.0,
              tol_usd=None, now=None):
    """Rebuild every sleeve book from broker fills, check against positions, write state/sleeves.json.
    Returns {"ok", "state", "mismatches", "problems", "fills", "orders_seen", "at"}. Raises on fetch errors
    (callers must treat that as 'do not trade')."""
    os.makedirs(state_dir, exist_ok=True)
    tol = float(os.environ.get("RECON_TOL_USD", 0.50)) if tol_usd is None else tol_usd
    prev = prev_state or {}
    cash0 = {s: float(capital) for s in SLEEVES}; cash0.update(start_cash or {})
    start = prev.get("start")
    after = None
    if start:
        try: after = (dt.date.fromisoformat(str(start)[:10]) - dt.timedelta(days=1)).isoformat() + "T00:00:00Z"
        except ValueError: after = None
    orders = fetch_orders(client, after=after)
    positions = client.positions() or []
    books, fills, problems, last_px = rebuild_books(orders, cash0, halt_times(state_dir))
    px = dict(last_px)
    for p in positions:
        q = _f(p.get("qty")); cp = _f(p.get("current_price")) or (_f(p.get("market_value")) / q if q else 0.0)
        if cp > 0: px[p["symbol"]] = cp
    px.update({k: v for k, v in (prices or {}).items() if isinstance(v, (int, float)) and v == v and v > 0})
    mism = compare(books, positions, {f["symbol"] for f in fills}, tol, px)
    at = (now or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds")
    sleeves = {}
    for s, b in books.items():
        pb = (prev.get("sleeves") or {}).get(s, {})
        eq = book_equity(b, px)
        sleeves[s] = {"cash": b["cash"], "shares": b["shares"], "start_cash": cash0[s],
                      "peak": round(max(_f(pb.get("peak"), cash0[s]), eq), 6), "paused": bool(pb.get("paused", False))}
    ok = not mism and not problems
    state = {"start": start, "sleeves": sleeves,
             "reconcile": {"ok": ok, "at": at, "orders_seen": len(orders), "fills": len(fills),
                           "mismatches": mism, "problems": problems, "tol_usd": tol}}
    _write(os.path.join(state_dir, "sleeves.json"), state)
    return {"ok": ok, "state": state, "mismatches": mism, "problems": problems, "fills": fills,
            "orders_seen": len(orders), "at": at}
