"""Minimal Alpaca *paper* REST client. Keys come only from env ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY
and are never printed or logged. submit_order refuses unless dry_run=False AND ALLOW_ORDERS=1."""
import os, requests
from .config import CFG


class Alpaca:
    def __init__(self, base=CFG.ALPACA_BASE):
        if "paper-api" not in base:
            raise RuntimeError("phase 1 is paper-only")
        self.base = base.rstrip("/")
        kid, sec = os.environ.get("ALPACA_API_KEY_ID"), os.environ.get("ALPACA_API_SECRET_KEY")
        if not kid or not sec:
            raise RuntimeError("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set")
        self.s = requests.Session()
        self.s.headers.update({"APCA-API-KEY-ID": kid, "APCA-API-SECRET-KEY": sec})

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
    def orders(self, status="all", limit=200): return self._get("/v2/orders", status=status, limit=limit)

    def submit_order(self, order: dict, dry_run=True):
        if dry_run or CFG.DRY_RUN or os.environ.get("ALLOW_ORDERS") != "1":
            return {"dry_run": True, **order}
        r = self.s.post(self.base + "/v2/orders", json=order, timeout=20)
        if r.status_code >= 400:
            raise RuntimeError(f"order rejected {r.status_code}: {r.text[:200]}")
        return r.json()
