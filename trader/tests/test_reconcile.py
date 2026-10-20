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
    def account(self): return self.acct
    def positions(self): return self.pos
    def clock(self): return {"is_open": self.is_open, "timestamp": "2026-10-19T10:00:00-04:00"}
    def asset(self, sym): return {"tradable": True, "fractionable": True}
    def orders(self, status="all", limit=200, direction="desc", after=None, **kw):
        self.order_calls.append({"status": status, "limit": limit, "direction": direction, "after": after})
        os_ = sorted(self._orders, key=lambda o: o["submitted_at"])
        if after: os_ = [o for o in os_ if o["submitted_at"] > after]
        return os_[:limit]
    def submit_order(self, order, dry_run=True):
        if dry_run: return {"dry_run": True, **order}
        self.submitted.append(order); return {"id": f"b{len(self.submitted)}"}
    def close_all_positions(self): self.closed += 1; return []


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
        lg._write(os.path.join(self.dir, "sleeves.json"), st)
        res = lg.LiveExecutor(b, self.dir, live_env()).execute(orders, deployed_usd=90.0)
        self.assertEqual([(o["symbol"], o["side"]) for o in b.submitted], [("AAPL", "buy"), ("MSFT", "sell")])
        self.assertEqual(b.submitted[1]["client_order_id"], "LIVE-B-20261019-MSFT-sell")
        self.assertEqual(b.submitted[1]["qty"], "0.1")
        self.assertTrue(any(r["event"] == "refused" and r["order"]["symbol"] == "NVDA" for r in res))  # $100 cap (90 deployed + 10) / cash
        self.assertTrue(all(o["client_order_id"].startswith("LIVE-B-") for o in b.submitted))
        self.assertEqual(rc.sleeve_of(b.submitted[0]["client_order_id"]), "B")


class TestBotEquityStops(Base):
    def book(self, cash, shares):
        lg._write(os.path.join(self.dir, "sleeves.json"), {"sleeves": {"B": {"cash": cash, "shares": shares}}, "reconcile": {"ok": True}})

    def exec_(self, b, **env):
        return lg.LiveExecutor(b, self.dir, live_env(**env)).execute([{"sleeve": "B", "symbol": "NVDA", "side": "buy", "notional": "5.00", "client_order_id": "B-20261019-NVDA-buy"}], 60.0)

    def test_account_up_but_bot_down_6pct_halts(self):
        self.book(40.0, {"MSFT": 0.1})  # $100 at yesterday's close, $94 now
        b = FakeBroker(positions=[pos("MSFT", 0.1, 540, 600), pos("VOO", 20, 520, 500)], equity=10454, last_equity=10060)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertEqual(b.closed, 1); self.assertEqual(b.submitted, [])
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
        self.assertEqual(b.closed, 1)

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
        self.assertEqual(b.closed, 1)

    def test_missing_price_for_held_symbol_refuses_without_halt(self):
        self.book(40.0, {"MSFT": 0.1})
        b = FakeBroker(positions=[], equity=100, last_equity=100)
        with self.assertRaises(lg.LiveRefused): self.exec_(b)
        self.assertEqual(b.closed, 0); self.assertFalse(os.path.exists(os.path.join(self.dir, "LIVE_HALTED.json")))


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
