"""Minimal Alpaca REST client. Paper by default (paper-api.alpaca.markets, env ALPACA_API_KEY_ID /
ALPACA_API_SECRET_KEY). Live (api.alpaca.markets) only via Alpaca.for_mode('live'), which requires every
live condition in live_guard and the SEPARATE keys ALPACA_LIVE_API_KEY_ID / ALPACA_LIVE_API_SECRET_KEY.
Keys are never printed or logged. submit_order refuses unless dry_run=False AND DRY_RUN=false AND ALLOW_ORDERS=1."""
import os, requests
from .config import CFG, STATE
from . import live_guard


class Alpaca:
    def __init__(self, base=CFG.ALPACA_BASE, mode="paper", env=None, session=None):
        env = os.environ if env is None else env
        self.mode, self.env = mode, env
        if mode == "paper":
            if "paper-api" not in base: raise RuntimeError("paper mode must use paper-api.alpaca.markets")
            kid, sec = env.get("ALPACA_API_KEY_ID"), env.get("ALPACA_API_SECRET_KEY")
            if not kid or not sec: raise RuntimeError("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set")
        elif mode == "live":
            refusals = live_guard.live_refusals(env, STATE)
            if refusals: raise live_guard.LiveRefused("; ".join(refusals))
            base = live_guard.LIVE_BASE
            kid, sec = env["ALPACA_LIVE_API_KEY_ID"], env["ALPACA_LIVE_API_SECRET_KEY"]
        else:
            raise RuntimeError(f"unknown TRADING_MODE {mode!r}")
        self.base = base.rstrip("/")
        self.s = session or requests.Session()
        self.s.headers.update({"APCA-API-KEY-ID": kid, "APCA-API-SECRET-KEY": sec})

    @classmethod
    def for_mode(cls, env=None, **kw):
        env = os.environ if env is None else env
        mode = env.get("TRADING_MODE", "paper").strip().lower()
        return cls(mode=mode, env=env, **kw)

    def _get(self, path, **params):
        r = self.s.get(self.base + path, params=params, timeout=20)
        if r.status_code >= 400:
            raise RuntimeError(f"GET {path} -> {r.status_code}: {r.text[:200]}")
        return r.json()

    def account(self): return self._get("/v2/account")
    def positions(self): return self._get("/v2/positions")
    def clock(self): return self._get("/v2/clock")
    def asset(self, sym):
        try: return self._get(f"/v2/assets/{sym}")
        except RuntimeError: return None
    def orders(self, status="all", limit=200, **params):
        # read-only; reconcile() pages through with direction="asc" and after=<submitted_at>
        return self._get("/v2/orders", status=status, limit=limit, **params)

    def close_all_positions(self):
        # closing positions is always allowed in any mode: it only reduces risk (used by halt / kill switch)
        r = self.s.delete(self.base + "/v2/positions", params={"cancel_orders": "true"}, timeout=30)
        return r.json() if r.content else {}

    def submit_order(self, order: dict, dry_run=True):
        env = self.env
        dry_env = env.get("DRY_RUN", "true").strip().lower() not in ("false", "0", "no")
        if dry_run or dry_env or env.get("ALLOW_ORDERS") != "1":
            return {"dry_run": True, **order}
        if self.mode == "live":
            refusals = live_guard.live_refusals(env, STATE)
            if refusals: raise live_guard.LiveRefused("; ".join(refusals))
            if order.get("side") not in ("buy", "sell"): raise live_guard.LiveRefused("long-only")
        r = self.s.post(self.base + "/v2/orders", json=order, timeout=20)
        if r.status_code >= 400:
            raise RuntimeError(f"order rejected {r.status_code}: {r.text[:200]}")
        return r.json()
