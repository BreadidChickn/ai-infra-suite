"""Reconcile + bot-equity stop tests. No network: the broker is a FakeBroker; nothing reaches api.alpaca.markets."""
import io, json, os, tempfile, unittest, datetime as dt
from unittest import mock

from aitrader import live_guard as lg, reconcile as rc

PHRASE = lg.ACK_PHRASE


def live_env(**over):
    e = {"TRADING_MODE": "live", "DRY_RUN": "false", "ALLOW_ORDERS": "1", "LIVE_RISK_ACK": PHRASE,
         "ALPACA_LIVE_API_KEY_ID": "live-id", "ALPACA_LIVE_API_SECRET_KEY": "live-secret",
         "ALPACA_API_KEY_ID": "paper-id", "ALPACA_API_SECRET_KEY": "paper-secret", "NONINTERACTIVE": "1"}
    e.update(over); return {k: v for k, v in e.items() if v is not None}


_n = [0]
def fill(coid, sym, side, qty, px, at="2026-10-12T14:00:00.123456789Z", status="filled"):
    _n[0] += 1
    return {"id": f"o{_n[0]}", "client_order_id": coid, "symbol": sym, "side": side, "status": status,
            "filled_qty": str(qty), "filled_avg_price": None if px is None else str(px), "submitted_at": at, "filled_at": at}


def pos(sym, qty, price, lastday=None):
    return {"symbol": sym, "qty": str(qty), "current_price": str(price), "lastday_price": str(lastday or price),
            "market_value": str(qty * price)}


class FakeBroker:
    """account/positions/clock/orders/submit_order/close_all_positions/asset; orders() pages like Alpaca."""
    def __init__(self, orders=(), positions=(), equity=None, last_equity=None, cash=1000.0, is_open=True):
        self._orders, self.pos = list(orders), list(positions)
        eq = equity if equity is not None else 1000.0
        self.acct = {"equity": str(eq), "last_equity": str(last_equity if last_equity is not None else eq), "cash": str(cash), "status": "ACTIVE"}
        self.is_open, self.submitted, self.closed, self.order_calls = is_open, [], 0, []
        self.broker_orders, self.get_calls = {}, 0
    def account(self): return self.acct
    def positions(self): return self.pos
    def clock(self): return {"is_open": self.is_open, "timestamp": "2026-10-19T10:00:00-04:00"}
    def asset(self, sym): return {"tradable": True, "fractionable": True}
    def orders(self, status="all", limit=200, direction="desc", after=None, **kw):
        self.order_calls.append({"status": status, "limit": limit, "direction": direction, "after": after})
        os_ = sorted(self._orders, key=lambda o: o["submitted_at"])
        if after: os_ = [o for o in os_ if o["submitted_at"] > after]
        return os_[:limit]
    fill_mode = "fill"   # "fill" | "none" (sells never fill) | "partial" (half fills, then stays open)
    def submit_order(self, order, dry_run=True):
        if dry_run: return {"dry_run": True, **order}
        self.submitted.append(order); oid = f"b{len(self.submitted)}"
        if order["side"] == "sell":
            p = next(x for x in self.pos if x["symbol"] == order["symbol"]); px = float(p["current_price"])
            q = float(order["qty"]) if "qty" in order else float(order["notional"]) / px
            f = {"fill": 1.0, "none": 0.0, "partial": 0.5}[self.fill_mode] * q
            self.acct["cash"] = str(float(self.acct["cash"]) + f * px)
            self.broker_orders[oid] = {"id": oid, "status": "filled" if self.fill_mode == "fill" else ("new" if not f else "partially_filled"),
                                       "filled_qty": str(f), "filled_avg_price": str(px) if f else None}
        return {"id": oid}
    def get_order(self, oid):
        self.get_calls += 1; return self.broker_orders[oid]
    def close_all_positions(self): raise AssertionError("live code must never close the whole account")


WEEK1 = [fill("LIVE-B-20261012-MSFT-buy", "MSFT", "buy", 0.1, 500), fill("LIVE-B-20261012-AAPL-buy", "AAPL", "buy", 0.2, 200)]
WEEK1_POS = [pos("MSFT", 0.1, 500), pos("AAPL", 0.2, 200)]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.dir = self.tmp.name
        self._err = mock.patch("sys.stderr", io.StringIO()); self._err.start()
    def tearDown(self):
        self._err.stop(); self.tmp.cleanup()
    def sleeves_file(self):
        with open(os.path.join(self.dir, "sleeves.json")) as fh: return json.load(fh)


class TestTags(unittest.TestCase):
    def test_sleeve_of(self):
        self.assertEqual(rc.sleeve_of("LIVE-B-20261019-MSFT-buy"), "B")
        self.assertEqual(rc.sleeve_of("B-20261019-MSFT-buy"), "B")
        self.assertEqual(rc.sleeve_of("LIVE-D_SPY-20261019-SPY-buy"), "D_SPY")
        self.assertEqual(rc.sleeve_of("EM-20261019-SH-buy"), "EM")
        self.assertEqual(rc.sleeve_of("E-20261019-NVDA-buy"), "E")
        for bad in (None, "", "3f2a-uuid-close", "LIVE-Z-20261019-X-buy", "B-2026-X-buy", "BX-20261019-MSFT-buy"):
            self.assertIsNone(rc.sleeve_of(bad), bad)


class TestReconcile(Base):
    def test_rebuild_from_fills_and_atomic_write(self):
        orders = WEEK1 + [
            fill("LIVE-B-20261013-AAPL-sell", "AAPL", "sell", 0.05, 210, at="2026-10-13T15:00:00Z"),
            fill("A-20261012-NVDA-buy", "NVDA", "buy", 0.1, 100),                       # paper tag, sleeve A
            fill("LIVE-B-20261013-NVDA-buy", "NVDA", "buy", 0.05, 100, at="2026-10-13T15:01:00Z", status="canceled"),  # partial fill counts
            fill("LIVE-B-20261013-AMD-buy", "AMD", "buy", 0, None, status="canceled"),  # no fill -> ignored
            fill("manual-order-1", "TSLA", "buy", 1, 250)]                               # untagged -> not the bot's
        b = FakeBroker(orders, [pos("MSFT", 0.1, 520), pos("AAPL", 0.15, 205), pos("NVDA", 0.15, 110), pos("TSLA", 1, 260)])
        r = rc.reconcile(b, self.dir, prices={"MSFT": 520, "AAPL": 205, "NVDA": 110})
        self.assertTrue(r["ok"], r["mismatches"])
        B, A = r["state"]["sleeves"]["B"], r["state"]["sleeves"]["A"]
        self.assertAlmostEqual(B["cash"], 100 - 50 - 40 + 10.5 - 5)
        self.assertEqual(B["shares"], {"MSFT": 0.1, "AAPL": 0.15, "NVDA": 0.05})
        self.assertAlmostEqual(A["cash"], 90.0); self.assertEqual(A["shares"], {"NVDA": 0.1})
        self.assertNotIn("TSLA", json.dumps(r["state"]["sleeves"]))
        self.assertEqual(r["state"]["sleeves"]["C"], {"cash": 100.0, "shares": {}, "start_cash": 100.0, "peak": 100.0, "paused": False})
        self.assertAlmostEqual(B["peak"], 100.0 + 0.1 * 20 + 0.15 * 5 + 0.05 * 10 + 0.5)  # marked equity above start
        self.assertEqual(self.sleeves_file(), json.loads(json.dumps(r["state"])))
        self.assertFalse([f for f in os.listdir(self.dir) if f.endswith(".tmp")])
        self.assertEqual(b.submitted, [])

    def test_peak_and_paused_carried_forward(self):
        prev = {"start": "2026-10-12", "sleeves": {"B": {"cash": 100, "shares": {}, "peak": 130.0, "paused": True}}}
        b = FakeBroker(WEEK1, WEEK1_POS)
        r = rc.reconcile(b, self.dir, prev_state=prev)
        self.assertEqual(r["state"]["sleeves"]["B"]["peak"], 130.0); self.assertTrue(r["state"]["sleeves"]["B"]["paused"])
        self.assertEqual(r["state"]["start"], "2026-10-12")
        self.assertEqual(b.order_calls[0]["after"], "2026-10-11T00:00:00Z")

    def test_pagination_reads_all_orders(self):
        orders = [fill(f"LIVE-B-202610{10 + i // 30:02d}-MSFT-buy", "MSFT", "buy", 0.001, 500, at=f"2026-10-12T14:{i // 60:02d}:{i % 60:02d}Z") for i in range(120)]
        b = FakeBroker(orders, [pos("MSFT", 0.12, 500)])
        got = rc.fetch_orders(b, page=50)
        self.assertEqual(len(got), 120); self.assertEqual(len(b.order_calls), 3)
        self.assertTrue(rc.reconcile(b, self.dir)["ok"])

    def test_start_cash_override_for_live_sleeve(self):
        r = rc.reconcile(FakeBroker(), self.dir, start_cash={"B": 50.0})
        self.assertEqual(r["state"]["sleeves"]["B"]["cash"], 50.0); self.assertEqual(r["state"]["sleeves"]["A"]["cash"], 100.0)


class TestMismatch(Base):
    def test_broker_holds_more_than_book_is_mismatch(self):
        r = rc.reconcile(FakeBroker(WEEK1, [pos("MSFT", 0.3, 500), pos("AAPL", 0.2, 200)]), self.dir)
        self.assertFalse(r["ok"]); self.assertEqual([m["symbol"] for m in r["mismatches"]], ["MSFT"])
        self.assertFalse(self.sleeves_file()["reconcile"]["ok"])

    def test_book_holds_symbol_broker_lacks_is_mismatch(self):
        r = rc.reconcile(FakeBroker(WEEK1, [pos("MSFT", 0.1, 500)]), self.dir)
        self.assertFalse(r["ok"]); self.assertEqual([m["symbol"] for m in r["mismatches"]], ["AAPL"])

    def test_within_tolerance_ok_and_other_holdings_ignored(self):
        p = [pos("MSFT", 0.1005, 500), pos("AAPL", 0.2, 200), pos("TSLA", 3, 250), pos("VOO", 10, 500)]  # $0.25 drift + non-bot names
        self.assertTrue(rc.reconcile(FakeBroker(WEEK1, p), self.dir)["ok"])
        self.assertFalse(rc.reconcile(FakeBroker(WEEK1, p), self.dir, tol_usd=0.10)["ok"])

    def test_sell_more_than_book_is_problem(self):
        o = [WEEK1[0], fill("LIVE-B-20261013-MSFT-sell", "MSFT", "sell", 0.5, 500, at="2026-10-13T15:00:00Z")]
        r = rc.reconcile(FakeBroker(o, []), self.dir)
        self.assertFalse(r["ok"]); self.assertTrue(r["problems"])

    def test_executor_refuses_unreconciled_or_mismatched_book(self):
        b = FakeBroker(WEEK1, [pos("MSFT", 0.3, 500), pos("AAPL", 0.2, 200)], equity=100, cash=100)
        rc.reconcile(b, self.dir)
        with self.assertRaises(lg.LiveRefused):
            lg.LiveExecutor(b, self.dir, live_env()).execute([{"sleeve": "B", "symbol": "NVDA", "side": "buy", "notional": "10.00", "client_order_id": "B-20261019-NVDA-buy"}])
        os.remove(os.path.join(self.dir, "sleeves.json"))
        with self.assertRaises(lg.LiveRefused): lg.LiveExecutor(b, self.dir, live_env()).execute([])
        self.assertEqual(b.submitted, []); self.assertEqual(b.closed, 0)

    def test_halt_liquidation_fills_attributed_after_halt(self):
        with open(os.path.join(self.dir, "halt_history.jsonl"), "w") as fh: fh.write(json.dumps({"halted_at": "2026-10-14T15:00:00+00:00"}) + "\n")
        o = WEEK1 + [fill("9b1c-close-uuid", "MSFT", "sell", 0.1, 450, at="2026-10-14T15:00:01Z"),
                     fill("9b1d-close-uuid", "AAPL", "sell", 0.7, 190, at="2026-10-14T15:00:01Z"),  # 0.5 were the owner's
                     fill("9b1e-older-manual", "MSFT", "sell", 0.05, 480, at="2026-10-13T15:00:00Z")]  # before halt -> ignored
        r = rc.reconcile(FakeBroker(o, []), self.dir)
        self.assertTrue(r["ok"], (r["mismatches"], r["problems"]))
        B = r["state"]["sleeves"]["B"]
        self.assertEqual(B["shares"], {}); self.assertAlmostEqual(B["cash"], 100 - 90 + 45 + 0.2 * 190)


class TestWeek2Rotation(Base):
    def test_sleeve_sells_and_rotates_in_week_2(self):
        import pandas as pd
        from aitrader import live
        b = FakeBroker(WEEK1, [pos("MSFT", 0.1, 500, 500), pos("AAPL", 0.2, 200, 200)], equity=100, last_equity=100, cash=10)
        st = rc.reconcile(b, self.dir)["state"]
        tg = {"B": pd.Series({"AAPL": 0.5, "NVDA": 0.5})}
        orders = live.plan_orders(st, tg, {"MSFT": 500.0, "AAPL": 200.0, "NVDA": 100.0}, dt.date(2026, 10, 19))
        ob = {(o["symbol"], o["side"]): o for o in orders if o["sleeve"] == "B"}
        self.assertEqual(ob[("MSFT", "sell")]["qty"], "0.1")                      # full exit of the dropped name
        self.assertAlmostEqual(float(ob[("NVDA", "buy")]["notional"]), 50.0)
        self.assertAlmostEqual(float(ob[("AAPL", "buy")]["notional"]), 10.0)  # $40 held -> top up to 50%
        self.assertEqual(orders[0]["side"], "sell")  # planner: every sell before any buy
        lg._write(os.path.join(self.dir, "sleeves.json"), st)
        res = lg.LiveExecutor(b, self.dir, live_env(), sleep=lambda _: None).execute(orders, deployed_usd=90.0)
        # the MSFT->NVDA rotation now completes in ONE run: sell first, its $50 proceeds fund NVDA
        self.assertEqual([(o["symbol"], o["side"]) for o in b.submitted], [("MSFT", "sell"), ("AAPL", "buy"), ("NVDA", "buy")])
        self.assertEqual(b.submitted[0]["client_order_id"], "LIVE-B-20261019-MSFT-sell")
        self.assertEqual(b.submitted[0]["qty"], "0.1")
        self.assertEqual([b.submitted[1]["notional"], b.submitted[2]["notional"]], ["10.00", "50.00"])
        self.assertFalse([r for r in res if r["event"] == "refused"])
        self.assertTrue(all(o["client_order_id"].startswith("LIVE-B-") for o in b.submitted))
        self.assertEqual(rc.sleeve_of(b.submitted[0]["client_order_id"]), "B")


ROT = [{"sleeve": "B", "symbol": "MSFT", "side": "sell", "qty": "0.1", "client_order_id": "B-20261019-MSFT-sell", "why": "exit"},
       {"sleeve": "B", "symbol": "AAPL", "side": "buy", "notional": "10.00", "client_order_id": "B-20261019-AAPL-buy", "why": "top up"},
       {"sleeve": "B", "symbol": "NVDA", "side": "buy", "notional": "50.00", "client_order_id": "B-20261019-NVDA-buy", "why": "rotate in"}]


class TestSellsBeforeBuys(Base):
    def setUp(self):
        super().setUp()
        lg._write(os.path.join(self.dir, "sleeves.json"), {"sleeves": {"B": {"cash": 10.0, "shares": {"MSFT": 0.1, "AAPL": 0.2}}}, "reconcile": {"ok": True}})
        self.t = [0.0]

    def broker(self, mode="fill", cash=10.0):
        b = FakeBroker(positions=[pos("MSFT", 0.1, 500), pos("AAPL", 0.2, 200)], equity=100, last_equity=100, cash=cash)
        b.fill_mode = mode; return b

    def run_(self, b, orders, **env):
        def sleep(sec): self.t[0] += sec
        ex = lg.LiveExecutor(b, self.dir, live_env(**env), sleep=sleep, monotonic=lambda: self.t[0])
        return ex.execute(orders, deployed_usd=90.0)

    def buys(self, b): return sum(float(o["notional"]) for o in b.submitted if o["side"] == "buy")

    def test_planner_puts_sells_and_trims_first(self):
        import pandas as pd
        from aitrader import live
        st = {"sleeves": {"B": {"cash": 0.0, "shares": {"AAPL": 0.25, "MSFT": 0.1, "ZS": 0.1}, "peak": 100, "paused": False}}}
        tg = {"B": pd.Series({"AAPL": 0.4, "MSFT": 0.6})}  # AAPL trim (50 -> 40), ZS full exit, MSFT top-up
        o = live.plan_orders(st, tg, {"AAPL": 200.0, "MSFT": 500.0, "ZS": 100.0}, dt.date(2026, 10, 19))
        self.assertEqual([(x["symbol"], x["side"]) for x in o], [("AAPL", "sell"), ("ZS", "sell"), ("MSFT", "buy")])
        self.assertIn("notional", o[0]); self.assertEqual(o[1]["qty"], "0.1")

    def test_executor_reorders_even_if_given_buys_first(self):
        b = self.broker()
        self.run_(b, [ROT[2], ROT[1], ROT[0]])
        self.assertEqual(b.submitted[0]["side"], "sell"); self.assertEqual(self.buys(b), 60.0)

    def test_unfilled_sells_cap_buys_at_cash(self):
        b = self.broker("none")
        res = self.run_(b, ROT, LIVE_FILL_WAIT_S="5")
        self.assertEqual(self.buys(b), 10.0)                 # only the $10 cash on hand, never margin
        self.assertGreaterEqual(self.t[0], 5.0)              # waited the full window
        self.assertTrue(any(r["event"] == "refused" for r in res))
        with open(os.path.join(self.dir, "live_orders.jsonl")) as fh:
            ev = [json.loads(l) for l in fh if '"sell_fills"' in l][0]
        self.assertEqual((ev["proceeds"], ev["unfilled"]), (0.0, ["b1"]))

    def test_partial_fill_only_counts_filled_proceeds(self):
        b = self.broker("partial")
        self.run_(b, ROT, LIVE_FILL_WAIT_S="3")
        self.assertAlmostEqual(self.buys(b), 35.0)           # $10 cash + $25 filled of the $50 sell

    def test_buys_never_exceed_broker_cash(self):
        b = self.broker()
        orig = b.account
        state = {"n": 0}
        def acct():  # after the sell the broker reports less cash than expected (e.g. fees / unsettled)
            state["n"] += 1; a = dict(orig()); a["cash"] = "100" if state["n"] == 1 else "30"; return a
        b.account = acct
        self.run_(b, ROT, LIVE_MAX_ORDER_USD="1000")
        self.assertLessEqual(self.buys(b), 30.0 + 1e-9)

    def test_buys_never_exceed_cash_or_cap_many_orders(self):
        b = self.broker()
        many = [ROT[0]] + [dict(ROT[2], symbol=s, client_order_id=f"B-20261019-{s}-buy", notional="20.00") for s in ("NVDA", "AMD", "AVGO", "TSM")]
        self.run_(b, many)
        self.assertLessEqual(self.buys(b), 60.0 + 1e-9)      # 10 cash + 50 proceeds; also $100 cap - 90 + 50
        self.assertEqual(b.submitted[0]["side"], "sell")

    def test_kill_switch_after_sells_stops_all_buys(self):
        b = self.broker(); d = self.dir; orig = b.submit_order
        def sub(o, dry_run=True):
            r = orig(o, dry_run); open(os.path.join(d, "KILL"), "w").close(); return r
        b.submit_order = sub
        res = self.run_(b, ROT)
        self.assertEqual([o["side"] for o in b.submitted], ["sell"])
        self.assertEqual(res[-1]["reason"], "kill switch"); self.assertEqual(len(res), 2)

    def test_kill_switch_mid_sells_stops_remaining(self):
        b = FakeBroker(positions=[pos("MSFT", 0.1, 500), pos("AAPL", 0.2, 200)], equity=100, cash=10); d = self.dir; orig = b.submit_order
        def sub(o, dry_run=True):
            r = orig(o, dry_run); open(os.path.join(d, "KILL"), "w").close(); return r
        b.submit_order = sub
        res = self.run_(b, [ROT[0], dict(ROT[0], symbol="AAPL", qty="0.2", client_order_id="B-20261019-AAPL-sell")] + ROT[1:])
        self.assertEqual([(o["symbol"], o["side"]) for o in b.submitted], [("MSFT", "sell")])
        self.assertEqual(res[-1]["reason"], "kill switch")

    def test_no_get_order_means_no_proceeds(self):
        from test_live_guard import FakeClient  # older client without get_order -> conservative: cash only
        c = FakeClient(cash=10.0, positions=[{"symbol": "MSFT", "qty": "0.1", "market_value": "50", "current_price": "500"},
                                             {"symbol": "AAPL", "qty": "0.2", "market_value": "40", "current_price": "200"}])
        lg.LiveExecutor(c, self.dir, live_env(), sleep=lambda _: None).execute(ROT, 90.0)
        self.assertEqual(sum(float(o["notional"]) for o in c.submitted if o["side"] == "buy"), 10.0)


class TestBotEquityStops(Base):
    def book(self, cash, shares):
        lg._write(os.path.join(self.dir, "sleeves.json"), {"sleeves": {"B": {"cash": cash, "shares": shares}}, "reconcile": {"ok": True}})

    def exec_(self, b, **env):
        return lg.LiveExecutor(b, self.dir, live_env(**env)).execute([{"sleeve": "B", "symbol": "NVDA", "side": "buy", "notional": "5.00", "client_order_id": "B-20261019-NVDA-buy"}], 60.0)

    def test_account_up_but_bot_down_6pct_halts(self):
        self.book(40.0, {"MSFT": 0.1})  # $100 at yesterday's close, $94 now
        b = FakeBroker(positions=[pos("MSFT", 0.1, 540, 600), pos("VOO", 20, 520, 500)], equity=10454, last_equity=10060)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertEqual([(o["symbol"], o["side"], o["qty"]) for o in b.submitted], [("MSFT", "sell", "0.1")])  # VOO untouched
        h = lg._read(os.path.join(self.dir, "LIVE_HALTED.json"))
        self.assertIn("bot daily loss -6.00%", h["reason"])
        self.assertTrue(os.path.exists(os.path.join(self.dir, "halt_history.jsonl")))


    def test_other_holdings_down_does_not_trigger_stop(self):
        self.book(40.0, {"MSFT": 0.1})  # bot flat at $100
        b = FakeBroker(positions=[pos("MSFT", 0.1, 600, 600), pos("TSLA", 10, 160, 250)], equity=1700, last_equity=2600)  # account -35%
        self.exec_(b)
        self.assertEqual(b.closed, 0); self.assertEqual(len(b.submitted), 1)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "LIVE_HALTED.json")))

    def test_day_start_persisted_and_reused_same_day(self):
        self.book(40.0, {"MSFT": 0.1})
        self.exec_(FakeBroker(positions=[pos("MSFT", 0.1, 600, 600)], equity=100, last_equity=100))
        rec = lg._read(os.path.join(self.dir, "live_day_start.json"))
        self.assertEqual((rec["date"], rec["equity"], rec["basis"]), ("2026-10-19", 100.0, "sleeve"))
        # later the same day the broker's lastday_price says nothing new, but the stored day start is used
        b = FakeBroker(positions=[pos("MSFT", 0.1, 540, 540)], equity=94, last_equity=94)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertEqual([(o["symbol"], o["side"]) for o in b.submitted], [("MSFT", "sell")])

    def test_drawdown_uses_bot_peak_not_account(self):
        lg._write(os.path.join(self.dir, "live_peak.json"), {"peak": 100.0, "basis": "sleeve", "sleeve": "B"})
        self.book(10.0, {"MSFT": 0.1})  # bot $70 (-30% from its peak) while the account is large and flat
        b = FakeBroker(positions=[pos("MSFT", 0.1, 600, 600)], equity=50000, last_equity=50000)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertIn("bot drawdown", lg._read(os.path.join(self.dir, "LIVE_HALTED.json"))["reason"])

    def test_large_account_does_not_mask_bot_drawdown_and_old_peak_ignored(self):
        lg._write(os.path.join(self.dir, "live_peak.json"), {"peak": 100.0})  # old whole-account basis -> restarted
        self.book(80.0, {})
        b = FakeBroker(positions=[], equity=50000, last_equity=50000)
        self.exec_(b)
        self.assertEqual(lg._read(os.path.join(self.dir, "live_peak.json"))["peak"], 80.0)
        self.assertEqual(len(b.submitted), 1)

    def test_account_equity_is_extra_cap(self):
        self.book(100.0, {})  # book says $100 but the account only holds $90 -> treated as bot at $90
        lg._write(os.path.join(self.dir, "live_day_start.json"), {"date": "2026-10-19", "equity": 100.0, "basis": "sleeve", "sleeve": "B"})
        b = FakeBroker(positions=[], equity=90, last_equity=100, cash=90)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertEqual(b.submitted, []); self.assertTrue(os.path.exists(os.path.join(self.dir, "LIVE_HALTED.json")))

    def test_missing_price_for_held_symbol_refuses_without_halt(self):
        self.book(40.0, {"MSFT": 0.1})
        b = FakeBroker(positions=[], equity=100, last_equity=100)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertEqual(b.closed, 0); self.assertFalse(os.path.exists(os.path.join(self.dir, "LIVE_HALTED.json")))


class TestSleeveOnlyHalt(Base):
    def test_halt_sells_only_sleeve_symbols_and_quantities(self):
        # sleeve B: 0.1 MSFT + 0.2 AAPL + 0.05 NVDA; the owner also holds VOO, TSLA and EXTRA MSFT/AAPL in the same account
        lg._write(os.path.join(self.dir, "sleeves.json"), {"sleeves": {"B": {"cash": 10.0, "shares": {"MSFT": 0.1, "AAPL": 0.2, "NVDA": 0.05}}}, "reconcile": {"ok": True}})
        b = FakeBroker(positions=[pos("MSFT", 2.1, 400, 500), pos("AAPL", 5.2, 150, 200), pos("NVDA", 0.03, 100, 100),
                                  pos("VOO", 20, 520, 520), pos("TSLA", 10, 250, 250)], equity=50000, last_equity=50000)
        with self.assertRaises(lg.LiveRefused):
            lg.LiveExecutor(b, self.dir, live_env(), now=lambda: dt.datetime(2026, 10, 19, 15, 30, 5, tzinfo=dt.timezone.utc)).execute([])
        got = {o["symbol"]: o for o in b.submitted}
        self.assertEqual(set(got), {"MSFT", "AAPL", "NVDA"})                      # VOO / TSLA never touched
        self.assertEqual((got["MSFT"]["qty"], got["AAPL"]["qty"]), ("0.1", "0.2"))  # sleeve qty, not the owner's 2.1 / 5.2
        self.assertEqual(got["NVDA"]["qty"], "0.03")                               # never more than the broker holds
        self.assertTrue(all(o["side"] == "sell" and o["type"] == "market" for o in b.submitted))
        self.assertEqual(got["MSFT"]["client_order_id"], "LIVE-B-20261019-MSFT-halt153005")
        self.assertTrue(all(rc.sleeve_of(o["client_order_id"]) == "B" for o in b.submitted))
        h = lg._read(os.path.join(self.dir, "LIVE_HALTED.json")); self.assertIn("sleeve B only (3 tagged sells)", h["close_all"])
        with open(os.path.join(self.dir, "halt_history.jsonl")) as fh: self.assertEqual(json.loads(fh.readline())["method"], "sleeve_tagged")

    def test_reconcile_after_sleeve_halt_matches_broker(self):
        lg._write(os.path.join(self.dir, "sleeves.json"), {"sleeves": {"B": {"cash": 10.0, "shares": {"MSFT": 0.1, "AAPL": 0.2}}}, "reconcile": {"ok": True}})
        b = FakeBroker(positions=[pos("MSFT", 0.1, 400, 500), pos("AAPL", 0.2, 150, 200), pos("VOO", 20, 520, 520)], equity=50000, last_equity=50000)
        with self.assertRaises(lg.LiveRefused): lg.LiveExecutor(b, self.dir, live_env()).execute([])
        # broker side after the tagged halt sells fill; the owner then sells some VOO by hand (untagged, after the halt)
        halt_fills = [fill(o["client_order_id"], o["symbol"], "sell", float(o["qty"]), {"MSFT": 400, "AAPL": 150}[o["symbol"]], at="2026-10-19T15:31:00Z") for o in b.submitted]
        after = FakeBroker(WEEK1 + halt_fills + [fill("manual-voo", "VOO", "sell", 5, 520, at="2026-10-19T16:00:00Z")],
                           [pos("VOO", 15, 520)])
        r = rc.reconcile(after, self.dir)
        self.assertTrue(r["ok"], (r["mismatches"], r["problems"]))
        B = r["state"]["sleeves"]["B"]
        self.assertEqual(B["shares"], {}); self.assertAlmostEqual(B["cash"], 100 - 90 + 40 + 30)
        self.assertFalse([f for f in r["fills"] if f.get("liquidation")])  # new halts: no untagged attribution

    def test_live_code_has_no_close_all(self):
        import inspect
        from aitrader import alpaca, live
        for m in (lg, alpaca, live, rc):
            self.assertNotIn("close_all_positions(", inspect.getsource(m), m.__name__)


class TestRunReconcilesFirst(Base):
    """live.run() end to end with signals/targets and the broker mocked."""
    def run_live(self, broker, env=None, mode="live"):
        import pandas as pd
        from aitrader import live, alpaca, config
        sig = pd.DataFrame({"price": {"MSFT": 500.0, "AAPL": 200.0, "NVDA": 100.0}})
        meta = {"asof": "2026-10-16", "spy": 600.0, "sh": 40.0, "prices": {"SPY": 600.0, "SH": 40.0}, "market_news_sent": 0}
        fake = mock.Mock(side_effect=lambda *a, **k: broker); fake.for_mode = lambda *a, **k: broker
        with mock.patch.object(live, "STATE", self.dir), mock.patch.object(live, "REPORTS", self.dir), \
             mock.patch.object(alpaca, "STATE", self.dir), mock.patch.object(alpaca, "Alpaca", fake), \
             mock.patch.object(live, "compute_signals", return_value=(sig, None, meta, [], None, None)), \
             mock.patch.object(live, "targets", return_value={"B": pd.Series({"AAPL": 0.5, "NVDA": 0.5})}), \
             mock.patch.object(config.CFG, "TRADING_MODE", mode), \
             mock.patch.dict(os.environ, env or live_env(), clear=False):
            snap, f = live.run()
        return snap

    def test_run_reconciles_before_planning_and_rotates(self):
        b = FakeBroker(WEEK1, WEEK1_POS, equity=100, last_equity=100, cash=10)
        snap = self.run_live(b)
        self.assertTrue(snap["reconcile"]["ok"])
        self.assertEqual(self.sleeves_file()["sleeves"]["B"]["shares"], {"MSFT": 0.1, "AAPL": 0.2})
        self.assertIn(("MSFT", "sell"), [(o["symbol"], o["side"]) for o in b.submitted])

    def test_run_mismatch_halts_and_places_no_orders(self):
        b = FakeBroker(WEEK1, [pos("MSFT", 0.5, 500), pos("AAPL", 0.2, 200)], equity=290, last_equity=290, cash=10)
        snap = self.run_live(b)
        self.assertFalse(snap["reconcile"]["ok"])
        h = lg._read(os.path.join(self.dir, "LIVE_HALTED.json"))
        self.assertIn("reconcile mismatch", h["reason"]); self.assertIn("not requested", h["close_all"])
        self.assertEqual(b.submitted, []); self.assertEqual(b.closed, 0)
        self.assertTrue(snap["live"]["refused"])

    def test_run_reconcile_error_refuses_live(self):
        b = FakeBroker(WEEK1, WEEK1_POS, equity=100, cash=10)
        b.orders = mock.Mock(side_effect=RuntimeError("GET /v2/orders -> 500"))
        snap = self.run_live(b)
        self.assertFalse(snap["reconcile"]["ok"]); self.assertEqual(b.submitted, [])
        self.assertTrue(any("not reconciled" in r for r in snap["live"]["refused"]))

    def test_paper_mode_still_dry_run(self):
        b = FakeBroker(WEEK1, WEEK1_POS, equity=100, cash=10)
        snap = self.run_live(b, env={"TRADING_MODE": "paper", "ALPACA_API_KEY_ID": "p", "ALPACA_API_SECRET_KEY": "q"}, mode="paper")
        self.assertNotIn("live", snap); self.assertEqual(b.submitted, []); self.assertTrue(snap["dry_run"])


if __name__ == "__main__":
    unittest.main()
