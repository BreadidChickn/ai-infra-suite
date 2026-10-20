"""Live-trading guard tests. No network: Alpaca is mocked (FakeClient / FakeSession); nothing reaches api.alpaca.markets."""
import io, json, os, tempfile, unittest, datetime as dt
from unittest import mock

from aitrader import live_guard as lg

PHRASE = lg.ACK_PHRASE


def live_env(**over):
    e = {"TRADING_MODE": "live", "DRY_RUN": "false", "ALLOW_ORDERS": "1", "LIVE_RISK_ACK": PHRASE,
         "ALPACA_LIVE_API_KEY_ID": "live-id", "ALPACA_LIVE_API_SECRET_KEY": "live-secret",
         "ALPACA_API_KEY_ID": "paper-id", "ALPACA_API_SECRET_KEY": "paper-secret", "NONINTERACTIVE": "1"}
    e.update(over)
    return {k: v for k, v in e.items() if v is not None}


class FakeClient:
    def __init__(self, equity=100.0, last_equity=100.0, cash=100.0, is_open=True, positions=None):
        self.acct = {"equity": str(equity), "last_equity": str(last_equity), "cash": str(cash)}
        self.is_open, self.pos = is_open, positions or []
        self.submitted, self.closed = [], 0

    def account(self): return self.acct
    def positions(self): return self.pos
    def clock(self): return {"is_open": self.is_open}
    def submit_order(self, order, dry_run=True):
        assert dry_run is False
        self.submitted.append(order); return {"id": f"oid{len(self.submitted)}"}
    def close_all_positions(self): raise AssertionError("live code must never close the whole account")


def order(sym="MSFT", side="buy", notional=30.0, sleeve="B", **kw):
    o = {"sleeve": sleeve, "symbol": sym, "side": side, "type": "market", "time_in_force": "day",
         "client_order_id": f"{sleeve}-20261019-{sym}-{side}", "why": "test"}
    if notional is not None: o["notional"] = f"{notional:.2f}"
    o.update(kw); return o


def write_book(state_dir, cash=100.0, shares=None, sleeve="B", ok=True):
    """A reconciled sleeve book as reconcile.py writes it (the executor refuses without one)."""
    lg._write(os.path.join(state_dir, "sleeves.json"), {"start": None, "sleeves": {sleeve: {"cash": cash, "shares": shares or {}, "peak": cash, "paused": False}},
                                                       "reconcile": {"ok": ok, "at": "2026-10-19T14:00:00+00:00", "mismatches": []}})


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.dir = self.tmp.name
        write_book(self.dir)
        self._err = mock.patch("sys.stderr", io.StringIO()); self._err.start()
    def tearDown(self):
        self._err.stop(); self.tmp.cleanup()


class TestRefusal(Base):
    def test_all_conditions_met(self):
        self.assertEqual(lg.live_refusals(live_env(), self.dir), [])
        self.assertEqual(lg.current_mode(live_env(), self.dir), "live")

    def test_each_condition_required(self):
        cases = {"TRADING_MODE": "paper", "DRY_RUN": "true", "ALLOW_ORDERS": "0",
                 "LIVE_RISK_ACK": "i accept full risk of loss", "ALPACA_LIVE_API_KEY_ID": None, "ALPACA_LIVE_API_SECRET_KEY": None}
        for k, v in cases.items():
            with self.subTest(missing=k):
                r = lg.live_refusals(live_env(**{k: v}), self.dir)
                self.assertTrue(r, k); self.assertEqual(lg.current_mode(live_env(**{k: v}), self.dir), "paper")

    def test_unset_vars_default_to_refused(self):
        self.assertEqual(lg.current_mode({}, self.dir), "paper")
        self.assertEqual(len(lg.live_refusals({}, self.dir)), 5)

    def test_ack_phrase_must_be_exact(self):
        for bad in ["", PHRASE.lower(), PHRASE + ".", " " + PHRASE, "I ACCEPT"]:
            self.assertIn("LIVE_RISK_ACK is not the exact phrase", lg.live_refusals(live_env(LIVE_RISK_ACK=bad), self.dir))

    def test_live_keys_must_differ_from_paper(self):
        r = lg.live_refusals(live_env(ALPACA_LIVE_API_KEY_ID="paper-id"), self.dir)
        self.assertIn("live keys must differ from paper keys", r)

    def test_dry_run_any_falsy_spelling_needed(self):
        self.assertTrue(lg.live_refusals(live_env(DRY_RUN="yes"), self.dir))
        for ok in ("false", "0", "no", "FALSE"):
            self.assertEqual(lg.live_refusals(live_env(DRY_RUN=ok), self.dir), [])

    def test_executor_refuses_without_conditions(self):
        c = FakeClient()
        with self.assertRaises(lg.LiveRefused):
            lg.LiveExecutor(c, self.dir, live_env(ALLOW_ORDERS="0")).execute([order()])
        self.assertEqual(c.submitted, [])


class TestAck(Base):
    def test_noninteractive_env_ack_logged_with_timestamp(self):
        out = io.StringIO(); now = dt.datetime(2026, 10, 19, 17, 0, tzinfo=dt.timezone.utc)
        rec = lg.ensure_ack(self.dir, live_env(), isatty=False, out=out, now=now)
        self.assertIn("REAL-MONEY TRADING", out.getvalue())
        self.assertIn("bear NO responsibility", out.getvalue())
        saved = lg._read(os.path.join(self.dir, "live_ack.json"))
        self.assertEqual(saved["acknowledged_at"], "2026-10-19T17:00:00+00:00"); self.assertEqual(rec, saved)
        out2 = io.StringIO(); lg.ensure_ack(self.dir, live_env(), isatty=False, out=out2)
        self.assertEqual(out2.getvalue(), "", "disclaimer shown only on first live start")

    def test_tty_requires_typed_phrase(self):
        with self.assertRaises(lg.LiveRefused):
            lg.ensure_ack(self.dir, live_env(), isatty=True, input_fn=lambda _: "yes", out=io.StringIO())
        self.assertFalse(os.path.exists(os.path.join(self.dir, "live_ack.json")))
        rec = lg.ensure_ack(self.dir, live_env(), isatty=True, input_fn=lambda _: PHRASE, out=io.StringIO())
        self.assertEqual(rec["method"], "tty+env")

    def test_env_phrase_still_required_even_if_typed(self):
        with self.assertRaises(lg.LiveRefused):
            lg.ensure_ack(self.dir, live_env(LIVE_RISK_ACK=""), isatty=True, input_fn=lambda _: PHRASE, out=io.StringIO())


class TestCaps(Base):
    def run_exec(self, orders, client=None, deployed=0.0, **env):
        c = client or FakeClient()
        with mock.patch("sys.stderr", io.StringIO()):
            res = lg.LiveExecutor(c, self.dir, live_env(**env)).execute(orders, deployed)
        return c, res

    def test_single_sleeve_only(self):
        c, res = self.run_exec([order(sleeve="A"), order(sleeve="C"), order(sleeve="B", notional=10)])
        self.assertEqual(len(c.submitted), 1); self.assertTrue(c.submitted[0]["client_order_id"].startswith("LIVE-B-"))
        self.assertEqual(sum(r["event"] == "skipped" for r in res), 2)

    def test_live_sleeve_configurable(self):
        write_book(self.dir, sleeve="A")
        c, _ = self.run_exec([order(sleeve="A", notional=10), order(sleeve="B", notional=10)], LIVE_SLEEVE="A")
        self.assertEqual([o["client_order_id"][:7] for o in c.submitted], ["LIVE-A-"])

    def test_max_capital_across_sleeves(self):
        orders = [order(s, notional=40) for s in ("MSFT", "AAPL", "SNPS", "DUK")]
        c, res = self.run_exec(orders, deployed=30.0, LIVE_MAX_ORDER_USD="1000")
        total = sum(float(o["notional"]) for o in c.submitted)
        self.assertLessEqual(total, 70.0 + 1e-9)  # 100 cap - 30 already deployed
        self.assertTrue(any(r["event"] == "refused" for r in res))

    def test_default_capital_100(self):
        orders = [order(s, notional=45) for s in ("MSFT", "AAPL", "SNPS")]
        c, _ = self.run_exec(orders, client=FakeClient(equity=10000, last_equity=10000, cash=10000), LIVE_MAX_ORDER_USD="1000")
        self.assertLessEqual(sum(float(o["notional"]) for o in c.submitted), 100.0)

    def test_max_order_notional(self):
        c, res = self.run_exec([order(notional=90)], LIVE_MAX_ORDER_USD="25")
        self.assertEqual(c.submitted[0]["notional"], "25.00"); self.assertIn("clipped", res[0]["reason"])

    def test_no_margin_cash_limit(self):
        c, _ = self.run_exec([order(notional=40)], client=FakeClient(cash=12.0))
        self.assertEqual(c.submitted[0]["notional"], "12.00")

    def test_long_only_no_shorts(self):
        c, res = self.run_exec([order(side="short"), order(side="sell", notional=None, qty="1"),
                                order(sym="SPY", side="sell", notional=None, qty="0.5")])
        self.assertEqual(c.submitted, []); self.assertTrue(all(r["event"] == "refused" for r in res))

    def test_sell_within_holdings_ok_and_hedge_via_sh_buy(self):
        cl = FakeClient(positions=[{"symbol": "MSFT", "qty": "0.1", "market_value": "50"}])
        c, _ = self.run_exec([order(side="sell", notional=None, qty="0.1"), order(sym="SH", notional=10)], client=cl)
        self.assertEqual([(o["symbol"], o["side"]) for o in c.submitted], [("MSFT", "sell"), ("SH", "buy")])

    def test_market_hours_only(self):
        c = FakeClient(is_open=False)
        with self.assertRaises(lg.LiveRefused): self.run_exec([order()], client=c)
        self.assertEqual(c.submitted, [])

    def test_every_order_logged_with_reason_and_tag(self):
        self.run_exec([order(notional=10), order(sleeve="A")])
        with open(os.path.join(self.dir, "live_orders.jsonl")) as fh: lines = [json.loads(l) for l in fh]
        self.assertEqual(len(lines), 2)
        sub = [l for l in lines if l["event"] == "submitted"][0]
        self.assertEqual(sub["mode"], "live"); self.assertTrue(sub["reason"]); self.assertTrue(sub["order"]["client_order_id"].startswith("LIVE-"))


MSFT_DOWN6 = [{"symbol": "MSFT", "qty": "0.1", "current_price": "540", "lastday_price": "600", "market_value": "54"}]


class TestHaltsAndKill(Base):
    def test_daily_loss_limit_halts_and_closes(self):
        # bot sleeve: $40 cash + 0.1 MSFT; MSFT 600 -> 540 => sleeve $100 -> $94 (-6%)
        write_book(self.dir, cash=40.0, shares={"MSFT": 0.1})
        c = FakeClient(equity=94, last_equity=100, positions=MSFT_DOWN6)
        with self.assertRaises(lg.LiveRefused):
            lg.LiveExecutor(c, self.dir, live_env()).execute([order()])
        # halt sells only the sleeve's own 0.1 MSFT, tagged; the planned buy never goes out
        self.assertEqual([(o["symbol"], o["side"], o["qty"]) for o in c.submitted], [("MSFT", "sell", "0.1")])
        self.assertTrue(c.submitted[0]["client_order_id"].startswith("LIVE-B-") and "-MSFT-halt" in c.submitted[0]["client_order_id"])
        self.assertTrue(os.path.exists(os.path.join(self.dir, "LIVE_HALTED.json")))
        self.assertIn("halted by a previous risk breach", " ".join(lg.live_refusals(live_env(), self.dir)))

    def test_daily_loss_limit_configurable(self):
        write_book(self.dir, cash=40.0, shares={"MSFT": 0.1})
        c = FakeClient(equity=94, last_equity=100, positions=MSFT_DOWN6)
        with mock.patch("sys.stderr", io.StringIO()):
            lg.LiveExecutor(c, self.dir, live_env(LIVE_DAILY_LOSS_LIMIT="0.10")).execute([order(notional=5)])
        self.assertEqual(len(c.submitted), 1)

    def test_drawdown_stop_halts_and_closes(self):
        lg._write(os.path.join(self.dir, "live_peak.json"), {"peak": 100.0, "basis": "sleeve", "sleeve": "B"})
        write_book(self.dir, cash=70.0)
        c = FakeClient(equity=70, last_equity=71)
        with self.assertRaises(lg.LiveRefused):
            lg.LiveExecutor(c, self.dir, live_env(LIVE_STOP_DRAWDOWN="0.25")).execute([order()])
        self.assertEqual(c.submitted, [])  # all-cash sleeve: nothing to sell, nothing else touched
        self.assertTrue(os.path.exists(os.path.join(self.dir, "LIVE_HALTED.json")))

    def test_kill_file(self):
        open(os.path.join(self.dir, "KILL"), "w").close()
        self.assertIn("kill switch active (state/KILL or TRADING_HALT=1)", lg.live_refusals(live_env(), self.dir))
        c = FakeClient()
        with self.assertRaises(lg.LiveRefused): lg.LiveExecutor(c, self.dir, live_env()).execute([order()])
        self.assertEqual(c.submitted, [])

    def test_kill_env(self):
        self.assertEqual(lg.current_mode(live_env(TRADING_HALT="1"), self.dir), "paper")

    def test_kill_mid_batch_stops_remaining(self):  # noqa
        c = FakeClient(); d = self.dir
        orig = c.submit_order
        def sub(o, dry_run=True):
            r = orig(o, dry_run); open(os.path.join(d, "KILL"), "w").close(); return r
        c.submit_order = sub
        with mock.patch("sys.stderr", io.StringIO()):
            res = lg.LiveExecutor(c, d, live_env()).execute([order("MSFT", notional=10), order("AAPL", notional=10)])
        self.assertEqual(len(c.submitted), 1); self.assertEqual(res[-1]["reason"], "kill switch")


class FakeSession:
    def __init__(self): self.headers, self.calls = {}, []
    def _r(self, body):
        r = mock.Mock(); r.status_code = 200; r.json.return_value = body; r.content = b"x"; r.text = ""; return r
    def get(self, url, **kw): self.calls.append(("GET", url)); return self._r({})
    def post(self, url, **kw): self.calls.append(("POST", url)); return self._r({"id": "x"})
    def delete(self, url, **kw): self.calls.append(("DELETE", url)); return self._r([])


class TestAlpacaClient(Base):
    def test_live_client_refused_without_conditions(self):
        from aitrader import alpaca
        with mock.patch.object(alpaca, "STATE", self.dir):
            with self.assertRaises(lg.LiveRefused):
                alpaca.Alpaca(mode="live", env=live_env(LIVE_RISK_ACK=""), session=FakeSession())

    def test_live_client_uses_live_keys_and_endpoint_mocked(self):
        from aitrader import alpaca
        s = FakeSession()
        with mock.patch.object(alpaca, "STATE", self.dir):
            a = alpaca.Alpaca.for_mode(env=live_env(), session=s)
            self.assertEqual(a.base, "https://api.alpaca.markets")
            self.assertEqual(s.headers["APCA-API-KEY-ID"], "live-id")
            a.submit_order({"symbol": "MSFT", "side": "buy", "notional": "5.00"}, dry_run=False)
            with self.assertRaises(lg.LiveRefused):
                a.submit_order({"symbol": "MSFT", "side": "short", "qty": "1"}, dry_run=False)
        self.assertEqual(s.calls, [("POST", "https://api.alpaca.markets/v2/orders")])  # mocked session only

    def test_paper_default_and_dry_run_never_posts(self):
        from aitrader import alpaca
        s = FakeSession()
        a = alpaca.Alpaca.for_mode(env={"ALPACA_API_KEY_ID": "p", "ALPACA_API_SECRET_KEY": "q"}, session=s)
        self.assertEqual(a.mode, "paper"); self.assertIn("paper-api", a.base)
        self.assertTrue(a.submit_order({"symbol": "MSFT"}, dry_run=False)["dry_run"])
        self.assertEqual(s.calls, [])

    def test_kill_switch_blocks_live_client_submit(self):
        from aitrader import alpaca
        s = FakeSession()
        with mock.patch.object(alpaca, "STATE", self.dir):
            a = alpaca.Alpaca.for_mode(env=live_env(), session=s)
            open(os.path.join(self.dir, "KILL"), "w").close()
            with self.assertRaises(lg.LiveRefused):
                a.submit_order({"symbol": "MSFT", "side": "buy", "notional": "5.00"}, dry_run=False)
        self.assertEqual(s.calls, [])


class TestPublisherMode(Base):
    def test_equity_and_status_carry_mode_and_ack(self):
        from aitrader import publisher, config
        st = {"sleeves": {"B": {"cash": 100.0, "shares": {}}}}
        with mock.patch.object(config, "STATE", self.dir), mock.patch.dict(os.environ, {"TRADING_MODE": "paper"}, clear=False):
            eq = publisher.equity_from_state(st, {})
            self.assertEqual(eq[0]["mode"], "paper"); self.assertNotIn("live_ack_at", eq[0])
            with open(os.path.join(self.dir, "live_ack.json"), "w") as fh:
                json.dump({"phrase": PHRASE, "acknowledged_at": "2026-10-19T17:00:00+00:00"}, fh)
            with mock.patch.dict(os.environ, live_env(), clear=False):
                eq = publisher.equity_from_state(st, {}); stt = publisher.status_payload()
        self.assertEqual(eq[0]["mode"], "live"); self.assertEqual(eq[0]["live_ack_at"], "2026-10-19T17:00:00+00:00")
        self.assertEqual(stt["live_ack_at"], "2026-10-19T17:00:00+00:00")
        self.assertEqual(stt["mode"], "live"); self.assertIn("kill_switch", stt)


if __name__ == "__main__":
    unittest.main()
