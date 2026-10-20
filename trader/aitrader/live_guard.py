"""Opt-in real-money trading guard + hard safety rails.

Live trading is REFUSED unless every one of these holds:
  TRADING_MODE=live, DRY_RUN=false, ALLOW_ORDERS=1,
  LIVE_RISK_ACK == 'I ACCEPT FULL RISK OF LOSS' (exact),
  separate live keys ALPACA_LIVE_API_KEY_ID / ALPACA_LIVE_API_SECRET_KEY (never the paper keys),
  no kill switch (state/KILL file or TRADING_HALT=1), not halted by a previous breach.
Rails while live: LIVE_MAX_CAPITAL across all sleeves, one LIVE_SLEEVE only, LIVE_MAX_ORDER_USD per order,
LIVE_DAILY_LOSS_LIMIT and LIVE_STOP_DRAWDOWN (halt + sell the live sleeve's own positions only), market hours only,
long-only cash (no shorts, no margin; hedges via SH inverse ETF only). Every order is logged with reason.
The two stops measure the BOT's own LIVE_SLEEVE equity (reconciled book cash + market value of its own
shares, from state/sleeves.json written by reconcile.py), never whole-account equity; the account's
equity / last_equity only ever lower that figure (extra cap). Day-start and peak persist under state/.
No reconciled, matching book -> refused.
Stdlib only so it can be unit-tested without network or pandas."""
import json, os, sys, datetime as dt


def _read(path):
    with open(path) as fh: return json.load(fh)


def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh: json.dump(obj, fh, indent=1)
    os.replace(tmp, path)

ACK_PHRASE = "I ACCEPT FULL RISK OF LOSS"
LIVE_BASE = "https://api.alpaca.markets"
PAPER_BASE = "https://paper-api.alpaca.markets"

DISCLAIMER = """\
================================================================================
  REAL-MONEY TRADING — READ BEFORE CONTINUING
================================================================================
You are about to enable LIVE trading with REAL money through your own brokerage
account. By continuing you acknowledge and agree that:

  * This software is provided "AS IS", without warranty of any kind, express or
    implied, including fitness for a particular purpose. It is NOT financial,
    investment, tax or legal advice, and nobody involved is acting as your
    adviser or broker.
  * The repository owner and all contributors bear NO responsibility or
    liability for any losses, missed gains, fees, taxes, or other damages,
    including those caused by bugs, outages, data errors, stale or inaccurate
    data, model or signal errors, broker/API behaviour, or misconfiguration.
  * YOU alone bear ALL risk of loss, up to and including the entire amount you
    allow the bot to trade, and you are responsible for complying with all laws,
    broker terms and tax obligations that apply to you.
  * Past performance, backtests and paper-trading results do NOT guarantee or
    predict future results. Backtests contain biases and simplifications.
  * Automated strategies — including every strategy in this repository — can
    and do lose money, sometimes quickly. Safety limits reduce but do not
    remove risk (gaps, halts and partial fills can exceed any limit).
  * Only trade money you can afford to lose entirely. You can stop at any time
    by creating state/KILL or setting TRADING_HALT=1.

To proceed, the exact phrase  "I ACCEPT FULL RISK OF LOSS"  must be provided.
================================================================================
"""


class LiveRefused(RuntimeError):
    pass


def write_halt(state_dir, reason, now=None, close_all="not requested"):
    """Persist a halt (blocks live until a human removes state/LIVE_HALTED.json). Places no orders."""
    os.makedirs(state_dir, exist_ok=True)
    rec = {"halted_at": (now or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds"), "reason": reason, "close_all": close_all}
    _write(os.path.join(state_dir, "LIVE_HALTED.json"), rec)
    return rec


def _num(x, d=0.0):
    try: return float(x)
    except (TypeError, ValueError): return d


def sleeve_equity(book, positions):
    """(equity now, equity at previous close) of one sleeve book, valued only at broker prices of the
    book's own symbols. Raises LiveRefused if a held symbol has no broker price (book/broker mismatch)."""
    px, prev = {}, {}
    for p in positions or []:
        q = _num(p.get("qty"))
        cp = _num(p.get("current_price")) or (_num(p.get("market_value")) / q if q else 0.0)
        px[p["symbol"]] = cp; prev[p["symbol"]] = _num(p.get("lastday_price")) or cp
    now_eq, start_eq = float(book["cash"]), float(book["cash"])
    for sym, q in (book.get("shares") or {}).items():
        if not px.get(sym): raise LiveRefused(f"cannot value {sym}: no broker position/price for a symbol the sleeve book holds")
        now_eq += q * px[sym]; start_eq += q * prev[sym]
    return now_eq, start_eq


def _f(env, k, d):
    try: return float(env.get(k, d))
    except (TypeError, ValueError): return float(d)


def settings(env=None):
    env = os.environ if env is None else env
    return {
        "mode": env.get("TRADING_MODE", "paper").strip().lower(),
        "dry_run": env.get("DRY_RUN", "true").strip().lower() not in ("false", "0", "no"),
        "allow_orders": env.get("ALLOW_ORDERS") == "1",
        "ack": env.get("LIVE_RISK_ACK", ""),
        "max_capital": _f(env, "LIVE_MAX_CAPITAL", 100),
        "sleeve": env.get("LIVE_SLEEVE", "B"),
        "max_order": _f(env, "LIVE_MAX_ORDER_USD", 50),
        "daily_loss": _f(env, "LIVE_DAILY_LOSS_LIMIT", 0.05),
        "stop_dd": _f(env, "LIVE_STOP_DRAWDOWN", env.get("STOP_DRAWDOWN", 0.25)),
        "halt_env": env.get("TRADING_HALT") == "1",
        "fill_wait": _f(env, "LIVE_FILL_WAIT_S", 30),   # seconds to wait for sell fills before sizing buys
    }


def kill_switch(state_dir, env=None):
    env = os.environ if env is None else env
    return env.get("TRADING_HALT") == "1" or os.path.exists(os.path.join(state_dir, "KILL"))


def live_refusals(env=None, state_dir="state"):
    """List of reasons live trading is refused ([] = all conditions met)."""
    env = os.environ if env is None else env
    s = settings(env); r = []
    if s["mode"] != "live": r.append("TRADING_MODE is not 'live'")
    if s["dry_run"]: r.append("DRY_RUN is not false")
    if not s["allow_orders"]: r.append("ALLOW_ORDERS is not 1")
    if s["ack"] != ACK_PHRASE: r.append("LIVE_RISK_ACK is not the exact phrase")
    lk, ls = env.get("ALPACA_LIVE_API_KEY_ID"), env.get("ALPACA_LIVE_API_SECRET_KEY")
    if not lk or not ls: r.append("ALPACA_LIVE_API_KEY_ID / ALPACA_LIVE_API_SECRET_KEY not set")
    elif lk == env.get("ALPACA_API_KEY_ID") or ls == env.get("ALPACA_API_SECRET_KEY"): r.append("live keys must differ from paper keys")
    if s["max_capital"] <= 0: r.append("LIVE_MAX_CAPITAL must be > 0")
    if kill_switch(state_dir, env): r.append("kill switch active (state/KILL or TRADING_HALT=1)")
    if os.path.exists(os.path.join(state_dir, "LIVE_HALTED.json")): r.append("halted by a previous risk breach (remove state/LIVE_HALTED.json after review)")
    return r


def ensure_ack(state_dir, env=None, isatty=None, input_fn=input, out=None, now=None):
    """Show the disclaimer on first live start, require the phrase (env always; also typed if a TTY),
    and log the acknowledgement. Returns the ack record."""
    env = os.environ if env is None else env
    os.makedirs(state_dir, exist_ok=True)
    f = os.path.join(state_dir, "live_ack.json")
    if env.get("LIVE_RISK_ACK", "") != ACK_PHRASE:
        raise LiveRefused("LIVE_RISK_ACK is not the exact phrase")
    if os.path.exists(f):
        rec = _read(f)
        if rec.get("phrase") == ACK_PHRASE: return rec
    print(DISCLAIMER, file=out or sys.stderr, flush=True)
    isatty = sys.stdin.isatty() if isatty is None else isatty
    if isatty:
        typed = input_fn(f'Type "{ACK_PHRASE}" to continue: ').strip()
        if typed != ACK_PHRASE:
            raise LiveRefused("acknowledgement phrase not typed exactly; live trading refused")
        how = "tty+env"
    else:
        how = "env (non-interactive)"
    rec = {"phrase": ACK_PHRASE, "acknowledged_at": (now or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds"),
           "method": how, "disclaimer_version": 1}
    _write(f, rec)
    return rec


def read_ack(state_dir):
    f = os.path.join(state_dir, "live_ack.json")
    try:
        with open(f) as fh: return json.load(fh)
    except (OSError, ValueError): return None


def current_mode(env=None, state_dir="state"):
    """'live' only if every live condition holds, else 'paper'."""
    return "live" if not live_refusals(env, state_dir) else "paper"


class LiveExecutor:
    """Applies the hard rails and submits (or refuses) orders on a client exposing
    account(), positions(), clock(), submit_order(order, dry_run=False), optional get_order(id).
    It never closes the whole account: a halt sells only the live sleeve's own reconciled holdings."""

    def __init__(self, client, state_dir="state", env=None, now=None, sleep=None, monotonic=None):
        self.env = os.environ if env is None else env
        self.c, self.dir, self.s = client, state_dir, settings(self.env)
        self.now = now or (lambda: dt.datetime.now(dt.timezone.utc))
        import time as _t
        self.sleep, self.mono = sleep or _t.sleep, monotonic or _t.monotonic
        os.makedirs(state_dir, exist_ok=True)

    # -- logging / state
    def _log(self, rec):
        rec = {"ts": self.now().isoformat(timespec="seconds"), "mode": "live", **rec}
        with open(os.path.join(self.dir, "live_orders.jsonl"), "a") as f: f.write(json.dumps(rec) + "\n")
        return rec

    def _peak(self, equity):
        """Peak of the bot's own sleeve equity (state/live_peak.json, basis 'sleeve'). A file from the old
        whole-account basis is ignored and restarted from the current sleeve equity."""
        f = os.path.join(self.dir, "live_peak.json")
        rec = _read(f) if os.path.exists(f) else {}
        p = float(rec["peak"]) if rec.get("basis") == "sleeve" and rec.get("sleeve") == self.s["sleeve"] else equity
        p = max(p, equity); _write(f, {"peak": p, "basis": "sleeve", "sleeve": self.s["sleeve"]}); return p

    def _day_start(self, day, start_equity):
        """Bot equity at the start of trading day `day` (state/live_day_start.json); set on the first check
        of each day from the previous close of the sleeve's own holdings, then reused all day."""
        f = os.path.join(self.dir, "live_day_start.json")
        rec = _read(f) if os.path.exists(f) else {}
        if rec.get("date") == day and rec.get("basis") == "sleeve" and rec.get("sleeve") == self.s["sleeve"]:
            return float(rec["equity"])
        _write(f, {"date": day, "equity": start_equity, "basis": "sleeve", "sleeve": self.s["sleeve"]})
        return start_equity

    def _book(self):
        f = os.path.join(self.dir, "sleeves.json")
        try: st = _read(f)
        except (OSError, ValueError): raise LiveRefused("no reconciled sleeve book (state/sleeves.json) — run reconcile first")
        rc = st.get("reconcile") or {}
        if not rc.get("ok"): raise LiveRefused("sleeve book not reconciled with broker (reconcile missing or mismatched)")
        b = (st.get("sleeves") or {}).get(self.s["sleeve"])
        if not b: raise LiveRefused(f"no book for LIVE_SLEEVE {self.s['sleeve']}")
        return b

    def _trading_day(self, clk):
        ts = str(clk.get("timestamp") or "")
        if len(ts) >= 10 and ts[4] == "-": return ts[:10]  # Alpaca clock is in US/Eastern
        try:
            from zoneinfo import ZoneInfo
            return self.now().astimezone(ZoneInfo("America/New_York")).date().isoformat()
        except Exception:
            return (self.now() - dt.timedelta(hours=5)).date().isoformat()

    def _flatten_sleeve(self, book):
        """Sell ONLY the live sleeve's reconciled holdings with tagged orders
        'LIVE-<sleeve>-<YYYYMMDD>-<SYM>-halt<HHMMSS>' (reconcile.py attributes them like any tagged sell).
        Never touches other positions in the account; never sells more than the sleeve's book or the broker holds."""
        if not book or not book.get("shares"): return []
        try: broker = {p["symbol"]: _num(p.get("qty")) for p in self.c.positions()}
        except Exception as e: return [{"event": "error", "error": f"positions: {str(e)[:150]}"}]
        t = self.now(); out = []
        for sym, q in sorted(book["shares"].items()):
            qty = round(min(float(q), broker.get(sym, 0.0)), 9)
            if qty <= 1e-9:
                out.append({"event": "skipped", "symbol": sym, "reason": "broker holds none of the sleeve's shares"}); continue
            send = {"symbol": sym, "side": "sell", "type": "market", "time_in_force": "day", "qty": str(qty),
                    "client_order_id": f"LIVE-{self.s['sleeve']}-{t:%Y%m%d}-{sym}-halt{t:%H%M%S}"[:48]}
            try:
                res = self.c.submit_order(send, dry_run=False)
                out.append({"event": "submitted", "order": send, "broker_id": (res or {}).get("id")})
            except Exception as e:
                out.append({"event": "error", "order": send, "error": str(e)[:200]})
        return out

    def halt(self, reason, book=None):
        """Risk-breach halt: sell the live sleeve's own positions (tagged), then persist the halt. The sells go
        out BEFORE LIVE_HALTED.json exists, because the client refuses every order once it does."""
        try: book = book if book is not None else self._book()
        except LiveRefused: book = None
        sold = self._flatten_sleeve(book)
        rec = write_halt(self.dir, reason, self.now(), close_all=f"sleeve {self.s['sleeve']} only ({len([x for x in sold if x['event'] == 'submitted'])} tagged sells)")
        rec["method"] = "sleeve_tagged"  # reconcile: no untagged-sell attribution for this halt
        with open(os.path.join(self.dir, "halt_history.jsonl"), "a") as fh: fh.write(json.dumps(rec) + "\n")
        self._log({"event": "halt", "reason": reason, "sleeve_sells": sold})
        return rec

    # -- rails
    def preflight(self):
        refusals = live_refusals(self.env, self.dir)
        if refusals: raise LiveRefused("; ".join(refusals))
        ensure_ack(self.dir, self.env, isatty=False if self.env.get("NONINTERACTIVE") == "1" else None)
        clk = self.c.clock()
        if not clk.get("is_open"): raise LiveRefused("market closed — live orders only during market hours")
        ac = self.c.account()
        book = self._book()
        bot_now, bot_prev = sleeve_equity(book, self.c.positions())
        # account equity is only an extra cap: it can lower the bot's figure, never raise or replace it
        acct_eq, acct_last = _num(ac.get("equity"), None), _num(ac.get("last_equity"), None)
        eq = min(bot_now, acct_eq) if acct_eq is not None else bot_now
        start = self._day_start(self._trading_day(clk), min(bot_prev, acct_last) if acct_last and acct_last > 0 else bot_prev)
        self.bot = {"sleeve": self.s["sleeve"], "equity": round(eq, 4), "day_start": round(start, 4)}
        if start > 0 and (eq - start) / start <= -self.s["daily_loss"]:
            self.halt(book=book, reason=f"bot daily loss {(eq-start)/start:.2%} (sleeve {self.s['sleeve']} ${eq:.2f} vs day start ${start:.2f}) breached limit -{self.s['daily_loss']:.0%}")
            raise LiveRefused("daily loss limit hit — halted and selling the sleeve's positions")
        peak = self._peak(eq); self.bot["peak"] = round(peak, 4)
        if peak > 0 and eq < peak * (1 - self.s["stop_dd"]):
            self.halt(book=book, reason=f"bot drawdown {eq/peak-1:.2%} (sleeve {self.s['sleeve']} ${eq:.2f} vs peak ${peak:.2f}) breached stop -{self.s['stop_dd']:.0%}")
            raise LiveRefused("drawdown stop hit — halted and selling the sleeve's positions")
        return ac

    def _await_sell_fills(self, ids):
        """Poll the broker for the submitted sells; returns filled proceeds (filled_qty x filled_avg_price).
        Stops at LIVE_FILL_WAIT_S; whatever has not filled by then is NOT counted (buys get capped by cash)."""
        get = getattr(self.c, "get_order", None)
        if get is None: return 0.0
        deadline = self.mono() + max(0.0, self.s["fill_wait"])
        done, filled = {}, {}
        while True:
            for i in ids:
                if i in done: continue
                try: od = get(i) or {}
                except Exception: continue
                filled[i] = _num(od.get("filled_qty")) * _num(od.get("filled_avg_price"))
                if od.get("status") in ("filled", "canceled", "expired", "rejected", "done_for_day"): done[i] = od.get("status")
            if len(done) == len(ids) or self.mono() >= deadline or kill_switch(self.dir, self.env): break
            self.sleep(1.0)
        total = round(sum(filled.values()), 2)
        self._log({"event": "sell_fills", "proceeds": total, "orders": len(ids),
                   "unfilled": [i for i in ids if done.get(i) != "filled"]})
        return total

    def _one(self, o, held, box):
        """Rails + submit for one order. box = {"budget","cash"} for buys (mutated), None for sells."""
        base = {k: o[k] for k in ("symbol", "side", "type", "time_in_force") if k in o}
        why = o.get("why", "")
        if o.get("sleeve") != self.s["sleeve"]:
            return self._log({"event": "skipped", "reason": f"sleeve {o.get('sleeve')} is not LIVE_SLEEVE {self.s['sleeve']}", "order": base})
        if o.get("side") not in ("buy", "sell"):
            return self._log({"event": "refused", "reason": "long-only: shorts/covers not allowed", "order": base})
        if o.get("side") == "sell":
            q = float(o.get("qty") or 0) or None
            if held.get(o["symbol"], 0) <= 0 or (q and q > held[o["symbol"]] + 1e-9):
                return self._log({"event": "refused", "reason": "long-only: cannot sell more than held (no shorts)", "order": base})
        notional = float(o["notional"]) if "notional" in o else None
        if o.get("side") == "buy":
            if notional is None:
                return self._log({"event": "refused", "reason": "buys must be notional", "order": base})
            cap = min(notional, self.s["max_order"], box["budget"], box["cash"])
            if cap < 1.0:
                return self._log({"event": "refused", "reason": "capital cap / cash / max-order leaves < $1 (no margin)", "order": base})
            if cap < notional: why += f" [clipped from ${notional:.2f} by live caps]"
            notional = round(cap, 2); box["budget"] -= notional; box["cash"] -= notional
        elif notional is not None and notional > self.s["max_order"]:
            notional = round(self.s["max_order"], 2); why += " [sell clipped to LIVE_MAX_ORDER_USD]"
        send = {**base, "type": "market", "time_in_force": "day",
                "client_order_id": ("LIVE-" + o.get("client_order_id", ""))[:48]}
        if notional is not None and "qty" not in o: send["notional"] = f"{notional:.2f}"
        else: send["qty"] = str(o["qty"])
        try:
            res = self.c.submit_order(send, dry_run=False)
            return self._log({"event": "submitted", "reason": why, "sleeve": o.get("sleeve"), "order": send, "broker_id": (res or {}).get("id")})
        except Exception as e:
            return self._log({"event": "error", "reason": why, "order": send, "error": str(e)[:200]})

    def execute(self, orders, deployed_usd=0.0):
        """orders: planner dicts (sleeve, symbol, side, notional|qty, client_order_id, why).
        deployed_usd: current market value already held by the bot across ALL sleeves."""
        ac = self.preflight()
        cash = float(ac.get("cash", 0))
        held = {p["symbol"]: float(p["qty"]) for p in self.c.positions()}
        budget = max(0.0, self.s["max_capital"] - deployed_usd)
        results = []
        # Phase 1: every sell (full exits and partial trims) goes out before any buy.
        # Phase 2: wait for those sells to fill; only FILLED proceeds are added to cash and budget.
        # Phase 3: buys, sized against cash after the sells (never more than the account holds: no margin).
        sells = [o for o in orders if o.get("side") == "sell"]
        rest = [o for o in orders if o.get("side") != "sell"]
        killed, sell_ids = False, []
        for o in sells:
            if kill_switch(self.dir, self.env):
                results.append(self._log({"event": "refused", "reason": "kill switch", "order": o})); killed = True; break
            r = self._one(o, held, None)
            results.append(r)
            if r["event"] == "submitted" and r.get("broker_id"): sell_ids.append(r["broker_id"])
        if killed: return results
        proceeds = self._await_sell_fills(sell_ids) if sell_ids else 0.0
        if proceeds > 0:
            budget += proceeds  # sold market value leaves the $LIVE_MAX_CAPITAL deployed total
            cash += proceeds
            try:  # the broker's own cash figure is the hard ceiling: never buy with money the account does not show
                fresh = _num(self.c.account().get("cash"), None)
                if fresh is not None: cash = min(cash, fresh)
            except Exception: pass
        box = {"budget": budget, "cash": cash}
        for o in rest:
            if kill_switch(self.dir, self.env):
                results.append(self._log({"event": "refused", "reason": "kill switch", "order": o})); break
            results.append(self._one(o, held, box))
        return results
