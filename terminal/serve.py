#!/usr/bin/env python3
"""Serve AI Infra Terminal (dist/) with free Yahoo, Google News, and SEC proxies. No Node needed.

Python stdlib only. Implements the same API as server.mjs (keep the two in sync):
  GET  /api/yahoo/*, /api/news/*, /api/sec/*      upstream proxies (/api/news cached 15 min; X-Refresh: 1 bypasses)
  GET  /api/sec-www/*                            www.sec.gov proxy (company tickers files cached 24h)
  GET/POST /api/user-companies, DELETE /api/user-companies/<cik>
  GET  /api/grokbot-status                       -> {"configured": bool}
  GET/POST /api/grokbot-request, POST /api/grokbot-request/retry
  GET  /api/signals, /api/news-feed, /api/mock-index, /api/bot/*; POST /api/bot/*, /api/signals-snapshot

Configuration: environment variables or a .env file next to this script (see .env.example).
"""
from __future__ import annotations

import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

HERE = Path(__file__).resolve().parent


def load_dot_env(path: Path) -> None:
    """Tiny .env loader, identical rules to server.mjs: KEY=VALUE per line, '#' comments, optional
    'export ' prefix, matching quotes stripped. Real environment variables win. Values are never printed."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m:
            continue
        v = m.group(2).strip()
        if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
            v = v[1:-1]
        else:
            v = re.sub(r"\s+#.*$", "", v)
        os.environ.setdefault(m.group(1), v)


load_dot_env(HERE / ".env")

ROOT = HERE / "dist"
PORT = int(os.environ.get("PORT") or "4173")
HOST = (os.environ.get("HOST") or "127.0.0.1").strip()
HOST_IS_LOOPBACK = HOST in ("127.0.0.1", "::1", "localhost")
UA = "Mozilla/5.0 (compatible; AI-Infra-Terminal/1.0)"
SEC_UA_PLACEHOLDER = "AI-Infra-Terminal/1.0 your-email@example.com"
SEC_UA = (os.environ.get("SEC_USER_AGENT") or "").strip() or SEC_UA_PLACEHOLDER
PROXIES = {
    "/api/yahoo": ("https://query1.finance.yahoo.com", UA),
    "/api/sec": ("https://data.sec.gov", SEC_UA),
}
# /api/news (Google News RSS) has its own handler with a 15-minute cache — see news_proxy().
NEWS_TTL_S = 15 * 60
NEWS_STALE_S = 24 * 3600
NEWS_MAX_ENTRIES = 200
NEWS_LOCK = threading.Lock()
NEWS_CACHE: dict = {}  # url-rest -> {"at", "status", "body", "ct"} (insertion-ordered for eviction)

# Local state files live next to this server (never shipped).
USER_COMPANIES_FILE = HERE / "user-companies.json"
PENDING_FILE = HERE / "pending-requests.json"
WEBHOOK_FILE = HERE / "grokbot-webhook.json"
SEC_CACHE_DIR = HERE / ".sec-cache"
TICKER_FILES = {"/files/company_tickers.json", "/files/company_tickers_exchange.json"}
TICKER_TTL_S = 24 * 3600
MAX_BODY_BYTES = 4 * 1024 * 1024
FORMAL_FORMS = {"10-K", "10-Q", "20-F", "40-F", "S-1", "F-1"}

STATE_LOCK = threading.Lock()
TICKER_LOCK = threading.Lock()
TICKER_MEM: dict = {}  # path -> (at_epoch_s, body_bytes)


def now_iso() -> str:
    # Same shape as JS Date.toISOString(): 2026-10-08T18:06:00.000Z
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


def under(path: str, prefix: str) -> bool:
    """Segment-aware prefix match (so /api/sec-www does not match /api/sec)."""
    return path == prefix or path.startswith(prefix + "/") or path.startswith(prefix + "?")


def send_json(handler, status: int, obj, extra_headers=None) -> None:
    body = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")  # same bytes as Express res.json
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    for k, v in (extra_headers or {}).items():
        handler.send_header(k, v)
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def proxy(target: str, ua: str, handler: SimpleHTTPRequestHandler) -> None:
    req = urllib.request.Request(target, headers={"User-Agent": ua, "Accept": "*/*"})
    try:
        try:
            resp = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as http_err:  # pass upstream status through (e.g. SEC 404)
            resp = http_err
        with resp:
            body = resp.read()
            handler.send_response(resp.status if hasattr(resp, "status") else resp.code)
            ct = resp.headers.get("Content-Type")
            if ct:
                handler.send_header("Content-Type", ct)
            handler.send_header("Cache-Control", "public, max-age=120")
            handler.send_header("Content-Length", str(len(body)))
            handler.end_headers()
            handler.wfile.write(body)
    except Exception as exc:  # noqa: BLE001
        send_json(handler, 502, {"error": "proxy_failed", "message": str(exc)})


# ---------------------------------------------------------------- news (cached)
# Same behaviour as server.mjs: 15-min in-memory cache keyed by path+query; header `X-Refresh: 1`
# bypasses it; on upstream failure a cached copy (<=24h) is served with X-Cache: STALE.


def send_news(handler, entry: dict, state: str) -> None:
    body = entry["body"]
    handler.send_response(entry["status"])
    handler.send_header("Content-Type", entry["ct"] or "application/rss+xml; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Cache", state)
    handler.send_header("X-Cache-Age", str(max(0, round(time.time() - entry["at"]))))
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def news_proxy(handler, rest: str) -> None:
    force = handler.headers.get("X-Refresh") == "1"
    with NEWS_LOCK:
        hit = NEWS_CACHE.get(rest)
    now = time.time()
    if hit and not force and now - hit["at"] < NEWS_TTL_S:
        return send_news(handler, hit, "HIT")
    req = urllib.request.Request("https://news.google.com" + rest, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        try:
            resp = urllib.request.urlopen(req, timeout=12)
        except urllib.error.HTTPError as http_err:
            resp = http_err
        with resp:
            body = resp.read()
            status = resp.status if hasattr(resp, "status") else resp.code
            entry = {"at": time.time(), "status": status, "body": body, "ct": resp.headers.get("Content-Type") or ""}
    except Exception as exc:  # noqa: BLE001
        if hit and time.time() - hit["at"] < NEWS_STALE_S:
            return send_news(handler, hit, "STALE")
        return send_json(handler, 502, {"error": "proxy_failed", "message": str(exc)})
    if status == 200:
        with NEWS_LOCK:
            NEWS_CACHE.pop(rest, None)
            NEWS_CACHE[rest] = entry
            while len(NEWS_CACHE) > NEWS_MAX_ENTRIES:
                NEWS_CACHE.pop(next(iter(NEWS_CACHE)))
        return send_news(handler, entry, "REFRESH" if force else "MISS")
    if hit and time.time() - hit["at"] < NEWS_STALE_S:
        return send_news(handler, hit, "STALE")
    return send_news(handler, entry, "BYPASS")


# ---------------------------------------------------------------- sec-www


def send_cached(handler, body: bytes, state: str) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Cache-Control", "public, max-age=3600")
    handler.send_header("X-Cache", state)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def read_ticker_disk(p: str):
    f = SEC_CACHE_DIR / os.path.basename(p)
    try:
        return (f.stat().st_mtime, f.read_bytes())
    except OSError:
        return None


def sec_www(handler, rest: str) -> None:
    pathname = rest.split("?", 1)[0]
    if pathname not in TICKER_FILES:
        return proxy("https://www.sec.gov" + rest, SEC_UA, handler)
    with TICKER_LOCK:
        entry = TICKER_MEM.get(pathname) or read_ticker_disk(pathname)
        if entry:
            TICKER_MEM[pathname] = entry
        if entry and time.time() - entry[0] < TICKER_TTL_S:
            return send_cached(handler, entry[1], "HIT")
        try:
            req = urllib.request.Request("https://www.sec.gov" + pathname, headers={"User-Agent": SEC_UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
            json.loads(body.decode("utf-8"))  # only cache valid JSON
            entry = (time.time(), body)
            TICKER_MEM[pathname] = entry
            try:
                SEC_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                (SEC_CACHE_DIR / os.path.basename(pathname)).write_bytes(body)
            except OSError:
                pass
            return send_cached(handler, body, "MISS")
        except Exception as exc:  # noqa: BLE001
            if entry:
                return send_cached(handler, entry[1], "STALE")
            return send_json(handler, 502, {"error": "proxy_failed", "message": str(exc)})


# ---------------------------------------------------------------- state helpers


def read_list(path: Path) -> list:
    try:
        v = json.loads(path.read_text(encoding="utf-8"))
        return v if isinstance(v, list) else []
    except Exception:  # noqa: BLE001
        return []


def write_json_atomic(path: Path, data) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------- validation

_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def norm_cik(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int) and v >= 0:
        v = str(v)
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not re.fullmatch(r"\d{1,10}", s):
        return None
    return s.zfill(10)


class Invalid(Exception):
    pass


def clean_text(v, max_len: int, required: bool = False) -> str:
    if v is None or v == "":
        if required:
            raise Invalid()
        return ""
    if not isinstance(v, str):
        raise Invalid()
    s = _CTRL.sub(" ", v).strip()
    if required and not s:
        raise Invalid()
    if len(s) > max_len:
        raise Invalid()
    return s


def clean_ticker(v) -> str:
    s = clean_text(v, 12)
    if s and not re.fullmatch(r"[A-Za-z0-9.\-]+", s):
        raise Invalid()
    return s.upper()


def parse_iso(s: str):
    try:
        t = s.strip()
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        d = datetime.fromisoformat(t)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        d = d.astimezone(timezone.utc)
        return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)
    except Exception:  # noqa: BLE001
        return None


def formal_forms_for(cik: str) -> dict:
    req = urllib.request.Request(f"https://data.sec.gov/submissions/CIK{cik}.json", headers={"User-Agent": SEC_UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            sub = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"notFound": True, "forms": []}
        raise
    forms = set()
    for f in ((sub.get("filings") or {}).get("recent") or {}).get("form") or []:
        base = re.sub(r"/A$", "", str(f))
        if base in FORMAL_FORMS:
            forms.add(base)
    return {"forms": sorted(forms), "name": sub.get("name") or ""}


# ---------------------------------------------------------------- grok bot


def webhook_config():
    """Env GROKBOT_WEBHOOK_URL / GROKBOT_WEBHOOK_AUTH first, else grokbot-webhook.json
    ({"url": "...", "authorization": "..."}). The authorization value is never logged or returned."""
    env_url = (os.environ.get("GROKBOT_WEBHOOK_URL") or "").strip()
    if env_url:
        if not re.match(r"^https?://", env_url, re.I):
            return None
        return {"url": env_url, "authorization": os.environ.get("GROKBOT_WEBHOOK_AUTH") or ""}
    try:
        cfg = json.loads(WEBHOOK_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(cfg, dict):
        return None
    url = cfg.get("url")
    if not isinstance(url, str) or not re.match(r"^https?://", url.strip(), re.I):
        return None
    auth = cfg.get("authorization")
    return {"url": url.strip(), "authorization": auth if isinstance(auth, str) else ""}


def payload_for(r: dict) -> dict:
    p = {"type": r["type"], "cik": r["cik"], "ticker": r.get("ticker") or "", "name": r["name"], "requestedAt": r["requestedAt"]}
    if r.get("note"):
        p["note"] = r["note"]
    return p


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never re-send the Authorization header to a redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def deliver(r: dict) -> dict:
    cfg = webhook_config()
    r["attempts"] = int(r.get("attempts") or 0) + 1
    r["lastAttemptAt"] = now_iso()
    if not cfg:
        r["status"] = "queued"
        r["httpStatus"] = None
        r["error"] = "webhook_not_configured"
        return r
    headers = {"Content-Type": "application/json"}
    if cfg["authorization"]:
        headers["Authorization"] = cfg["authorization"]
    body = json.dumps(payload_for(r), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(cfg["url"], data=body, headers=headers, method="POST")
    try:
        with _OPENER.open(req, timeout=10) as resp:
            resp.read()
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    except (socket.timeout, TimeoutError):
        code = None
        r["error"] = "timeout"
    except urllib.error.URLError as e:
        code = None
        r["error"] = "timeout" if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)) else "network_error"
    except Exception:  # noqa: BLE001
        code = None
        r["error"] = "network_error"
    r["httpStatus"] = code
    if code is None:
        r["status"] = "failed"
    elif 200 <= code < 300:
        r["status"] = "sent"
        r["error"] = None
    else:
        r["status"] = "failed"
        r["error"] = "http_error"
    print(f"[grokbot] add_company CIK {r['cik']} -> {r['status']}" + (f" (HTTP {code})" if code else ""), flush=True)
    return r


# ---------------------------------------------------------------- handler


# ---------------------------------------------------------------- trading-bot API
# Mirrors server.mjs exactly (docs/bot-api-contract.md): read-only signals published by the
# dashboard, plus bot write endpoints persisted to local JSON files.

import hmac
import math
from urllib.parse import parse_qs

SIGNALS_FILE = HERE / "signals-snapshot.json"
BOT_FILES = {
    "trades": HERE / "bot-trades.json",
    "equity": HERE / "bot-equity.json",
    "reports": HERE / "bot-reports.json",
    "backtest": HERE / "bot-backtest.json",
}
BOT_TOKEN_FILE = HERE / "bot-token.json"
BOT_CAPS = {"trades": 20000, "equity": 50000, "reports": 520}
SIGNALS_SCHEMA = "ai-infra-signals/v1"
SLEEVE_RE = re.compile(r"^[A-E][A-Z0-9_]{0,12}$")
ISO_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")
SIDES = {"buy", "sell", "short", "cover"}
TRADE_STATUS = {"filled", "partially_filled", "submitted", "canceled", "rejected", "dry_run"}
MISSED_KINDS = {"info", "prediction", "stat"}
_CTRL_BOT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_PRIV = re.compile(r"^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)")


def read_json_file(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return fallback


def bot_token() -> str:
    env = (os.environ.get("BOT_TOKEN") or "").strip()
    if env:
        return env
    f = read_json_file(BOT_TOKEN_FILE, None)
    if isinstance(f, dict) and isinstance(f.get("token"), str) and f["token"].strip():
        return f["token"].strip()
    return ""


def _is_loopback(ip: str) -> bool:
    return ip in ("127.0.0.1", "::1")


def _is_private_lan(ip: str) -> bool:
    return _is_loopback(ip) or bool(_PRIV.match(ip))


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def is_obj(v) -> bool:
    return isinstance(v, dict)


def v_str(v, f, mx):
    if v is None or v == "":
        return None, f
    if not isinstance(v, str) or len(v) > mx:
        return None, f
    return _CTRL_BOT.sub(" ", v).strip(), None


def opt_str(o, out, k, f, mx):
    if o.get(k) is None or o.get(k) == "":
        return None
    v, e = v_str(o[k], f + k, mx)
    if e:
        return e
    out[k] = v
    return None


def opt_num(o, out, k, f):
    if o.get(k) is None:
        return None
    if not is_num(o[k]):
        return f + k
    out[k] = o[k]
    return None


def v_sleeve(o, f):
    s = o.get("sleeve")
    if not isinstance(s, str) or not SLEEVE_RE.match(s):
        return None, f + "sleeve"
    label, e = v_str(o.get("sleeve_label"), f + "sleeve_label", 60)
    if e:
        return None, e
    return {"sleeve": s, "sleeve_label": label}, None


def v_ts(v, f):
    """Validate ISO-8601 with zone and normalise to JS toISOString() (UTC, milliseconds)."""
    if not isinstance(v, str):
        return None, f
    m = ISO_RE.match(v)
    if not m:
        return None, f
    date, hh, mm, ss, frac, tz = m.groups()
    try:
        tzs = "+00:00" if tz == "Z" else tz
        dt = datetime.fromisoformat(f"{date}T{hh}:{mm}:{ss or '00'}{tzs}")
    except ValueError:
        return None, f
    ms = int((frac or "0").ljust(3, "0")[:3])
    d = dt.astimezone(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % ms, None


def v_signals(v, f):
    if v is None:
        return {}, None
    if not is_obj(v) or len(v) > 40:
        return None, f
    out = {}
    for k, x in v.items():
        if len(k) > 60:
            return None, f
        if x is None or isinstance(x, bool) or is_num(x):
            out[k] = x
        elif isinstance(x, str) and len(x) <= 200:
            out[k] = x
        else:
            return None, f"{f}.{k}"
    return out, None


def v_example(o, out, k):
    if o.get("example") is not None:
        if not isinstance(o["example"], bool):
            return k
        out["example"] = o["example"]
    return None


def v_trade(o, f):
    if not is_obj(o):
        return None, f
    p = f + "." if f else ""
    out = {}
    out["id"], e = v_str(o.get("id"), p + "id", 80)
    if e:
        return None, e
    out["ts"], e = v_ts(o.get("ts"), p + "ts")
    if e:
        return None, e
    t = o.get("ticker")
    if not isinstance(t, str) or not TICKER_RE.match(t):
        return None, p + "ticker"
    out["ticker"] = t
    if not isinstance(o.get("side"), str) or o["side"] not in SIDES:
        return None, p + "side"
    out["side"] = o["side"]
    if not is_num(o.get("qty")) or o["qty"] <= 0:
        return None, p + "qty"
    out["qty"] = o["qty"]
    if not is_num(o.get("price")) or o["price"] <= 0:
        return None, p + "price"
    out["price"] = o["price"]
    sl, e = v_sleeve(o, p)
    if e:
        return None, e
    out.update(sl)
    r = o.get("reason")
    if not is_obj(r):
        return None, p + "reason"
    reason = {}
    reason["text"], e = v_str(r.get("text"), p + "reason.text", 4000)
    if e:
        return None, e
    reason["signals"], e = v_signals(r.get("signals"), p + "reason.signals")
    if e:
        return None, e
    out["reason"] = reason
    if o.get("status") is not None:
        if not isinstance(o["status"], str) or o["status"] not in TRADE_STATUS:
            return None, p + "status"
        out["status"] = o["status"]
    for k in ("notional", "fee"):
        e = opt_num(o, out, k, p)
        if e:
            return None, e
    for k, mx in (("order_id", 80), ("timeframe", 20)):
        e = opt_str(o, out, k, p, mx)
        if e:
            return None, e
    e = v_example(o, out, p + "example")
    if e:
        return None, e
    return out, None


def v_position(o, f):
    if not is_obj(o):
        return None, f
    out = {}
    t = o.get("ticker")
    if not isinstance(t, str) or not TICKER_RE.match(t):
        return None, f + ".ticker"
    out["ticker"] = t
    if not is_num(o.get("qty")):
        return None, f + ".qty"
    out["qty"] = o["qty"]
    for k in ("avg_cost", "price", "market_value", "unrealized_pl"):
        e = opt_num(o, out, k, f + ".")
        if e:
            return None, e
    if o.get("hedge") is not None:
        if not isinstance(o["hedge"], bool):
            return None, f + ".hedge"
        out["hedge"] = o["hedge"]
    return out, None


def v_equity(o, f):
    if not is_obj(o):
        return None, f
    p = f + "." if f else ""
    out = {}
    out["ts"], e = v_ts(o.get("ts"), p + "ts")
    if e:
        return None, e
    sl, e = v_sleeve(o, p)
    if e:
        return None, e
    out.update(sl)
    if not is_num(o.get("equity")) or o["equity"] < 0:
        return None, p + "equity"
    out["equity"] = o["equity"]
    if not is_num(o.get("cash")):
        return None, p + "cash"
    out["cash"] = o["cash"]
    pos = o.get("positions")
    if not isinstance(pos, list) or len(pos) > 500:
        return None, p + "positions"
    out["positions"] = []
    for i, x in enumerate(pos):
        v, e = v_position(x, f"{p}positions[{i}]")
        if e:
            return None, e
        out["positions"].append(v)
    e = v_example(o, out, p + "example")
    if e:
        return None, e
    return out, None


def v_str_list(v, f, max_items, max_len):
    if v is None:
        return [], None
    if not isinstance(v, list) or len(v) > max_items:
        return None, f
    out = []
    for i, x in enumerate(v):
        s, e = v_str(x, f"{f}[{i}]", max_len)
        if e:
            return None, e
        out.append(s)
    return out, None


def _valid_date(s) -> bool:
    if not isinstance(s, str) or not DATE_RE.match(s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def v_report(o):
    if not is_obj(o):
        return None, "body"
    out = {}
    for k in ("week_start", "week_end"):
        if not _valid_date(o.get(k)):
            return None, k
        out[k] = o[k]
    if out["week_end"] < out["week_start"]:
        return None, "week_end"
    sl_list = o.get("sleeves")
    if not isinstance(sl_list, list) or not sl_list or len(sl_list) > 20:
        return None, "sleeves"
    out["sleeves"] = []
    for i, s in enumerate(sl_list):
        f = f"sleeves[{i}]"
        if not is_obj(s):
            return None, f
        sl, e = v_sleeve(s, f + ".")
        if e:
            return None, e
        row = dict(sl)
        if not is_num(s.get("return_pct")):
            return None, f + ".return_pct"
        row["return_pct"] = s["return_pct"]
        for k in ("start_equity", "end_equity", "annualized_pct", "max_drawdown_pct", "trades", "win_rate"):
            e = opt_num(s, row, k, f + ".")
            if e:
                return None, e
        out["sleeves"].append(row)
    bl = o.get("benchmarks")
    if not isinstance(bl, list) or len(bl) > 20:
        return None, "benchmarks"
    out["benchmarks"] = []
    for i, b in enumerate(bl):
        f = f"benchmarks[{i}]"
        if not is_obj(b):
            return None, f
        name, e = v_str(b.get("name"), f + ".name", 40)
        if e:
            return None, e
        if not is_num(b.get("return_pct")):
            return None, f + ".return_pct"
        out["benchmarks"].append({"name": name, "return_pct": b["return_pct"]})
    if not isinstance(o.get("target_flag"), bool):
        return None, "target_flag"
    out["target_flag"] = o["target_flag"]
    if o.get("target_annual_pct") is not None and not is_num(o["target_annual_pct"]):
        return None, "target_annual_pct"
    out["target_annual_pct"] = o["target_annual_pct"] if o.get("target_annual_pct") is not None else 29
    out["why"], e = v_str(o.get("why"), "why", 20000)
    if e:
        return None, e
    e = opt_str(o, out, "summary", "", 4000)
    if e:
        return None, e
    ml = o.get("missed")
    if not isinstance(ml, list) or len(ml) > 50:
        return None, "missed"
    out["missed"] = []
    for i, m in enumerate(ml):
        f = f"missed[{i}]"
        if not is_obj(m) or not isinstance(m.get("kind"), str) or m["kind"] not in MISSED_KINDS:
            return None, f + ".kind"
        detail, e = v_str(m.get("detail"), f + ".detail", 2000)
        if e:
            return None, e
        out["missed"].append({"kind": m["kind"], "detail": detail})
    out["paper_vs_real"], e = v_str_list(o.get("paper_vs_real"), "paper_vs_real", 30, 2000)
    if e:
        return None, e
    if not out["paper_vs_real"]:
        return None, "paper_vs_real"
    for k in ("went_right", "went_wrong"):
        out[k], e = v_str_list(o.get(k), k, 30, 2000)
        if e:
            return None, e
    e = v_example(o, out, "example")
    if e:
        return None, e
    out["id"] = f"{out['week_start']}_{out['week_end']}"
    return out, None


def v_backtest(o):
    if not is_obj(o):
        return None, "body"
    out = {}
    out["generated_at"], e = v_ts(o.get("generated_at"), "generated_at")
    if e:
        return None, e
    for k, mx in (("universe_note", 2000), ("period", 80)):
        e = opt_str(o, out, k, "", mx)
        if e:
            return None, e
    rows = o.get("rows")
    if not isinstance(rows, list) or not rows or len(rows) > 30:
        return None, "rows"
    out["rows"] = []
    for i, r in enumerate(rows):
        f = f"rows[{i}]"
        if not is_obj(r):
            return None, f
        sl, e = v_sleeve(r, f + ".")
        if e:
            return None, e
        row = dict(sl)
        for k in ("cagr_pct", "total_return_pct", "vol_pct", "sharpe", "max_dd_pct", "hit_rate_pct"):
            e = opt_num(r, row, k, f + ".")
            if e:
                return None, e
        e = opt_str(r, row, "note", f + ".", 300)
        if e:
            return None, e
        out["rows"].append(row)
    out["newer_names_flagged"], e = v_str_list(o.get("newer_names_flagged"), "newer_names_flagged", 200, 12)
    if e:
        return None, e
    e = v_example(o, out, "example")
    if e:
        return None, e
    return out, None


def batch_of(body, key, validate):
    lst = body.get(key)
    if isinstance(lst, list):
        if not lst or len(lst) > 500:
            return None, key
        out = []
        for i, x in enumerate(lst):
            v, e = validate(x, f"{key}[{i}]")
            if e:
                return None, e
            out.append(v)
        return out, None
    v, e = validate(body, "")
    return (None, e) if e else ([v], None)


def upsert(path: Path, items, key_fn, cap, sort_key):
    lst = read_list(path)
    idx = {key_fn(x): i for i, x in enumerate(lst)}
    added = 0
    for it in items:
        k = key_fn(it)
        if k in idx:
            lst[idx[k]] = it
        else:
            idx[k] = len(lst)
            lst.append(it)
            added += 1
    lst.sort(key=lambda x: str(x.get(sort_key)))
    kept = lst[len(lst) - cap:] if len(lst) > cap else lst
    write_json_atomic(path, kept)
    return {"added": added, "updated": len(items) - added, "total": len(kept)}


def _iso_ms(s):
    try:
        if isinstance(s, str) and len(s) == 10:
            s = s + "T00:00:00Z"
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


def filter_query(lst, q):
    out = lst
    sleeve = q.get("sleeve", [None])
    if len(sleeve) == 1 and sleeve[0]:
        want = set(sleeve[0].split(","))
        out = [x for x in out if x.get("sleeve") in want or (isinstance(x.get("sleeves"), list) and any(s.get("sleeve") in want for s in x["sleeves"]))]
    since = q.get("since", [None])
    if len(since) == 1 and since[0]:
        t = _iso_ms(since[0])
        if t is not None:
            out = [x for x in out if (_iso_ms(x.get("ts") or x.get("week_end")) or 0) >= t]
    try:
        lim = int(q.get("limit", [""])[0])
    except ValueError:
        lim = 0
    if lim > 0:
        out = out[max(0, len(out) - lim):]
    return out


BOT_KINDS = {
    "trades": {"file": BOT_FILES["trades"], "key": "trades", "v": v_trade, "id": lambda x: x["id"], "sort": "ts", "cap": BOT_CAPS["trades"]},
    "equity": {"file": BOT_FILES["equity"], "key": "equity", "v": v_equity, "id": lambda x: f"{x['sleeve']}|{x['ts']}", "sort": "ts", "cap": BOT_CAPS["equity"]},
    "weekly-report": {"file": BOT_FILES["reports"], "key": "reports", "v": None, "id": lambda x: x["id"], "sort": "week_end", "cap": BOT_CAPS["reports"]},
}


# A request relayed by a reverse proxy or tunnel on this machine arrives from 127.0.0.1 but is not local.
FORWARD_HEADERS = ("X-Forwarded-For", "Forwarded", "X-Real-IP", "CF-Connecting-IP", "True-Client-IP")


class BotApiMixin:
    def bot_remote_ip(self) -> str:
        if any(self.headers.get(h) is not None for h in FORWARD_HEADERS):
            return "forwarded"
        ip = str(self.client_address[0] if self.client_address else "")
        return ip[7:] if ip.startswith("::ffff:") else ip

    def bot_auth(self, allow_lan=False) -> str:
        tok = bot_token()
        auth = self.headers.get("Authorization") or ""
        m = re.match(r"^Bearer\s+(.+)$", auth, re.I)
        got = m.group(1).strip() if m else (self.headers.get("X-Bot-Key") or "").strip()
        ip = self.bot_remote_ip()
        if tok:
            if got and hmac.compare_digest(got.encode(), tok.encode()):
                return "ok"
            if not got and allow_lan and _is_private_lan(ip):
                return "ok"
            return "unauthorized"
        if not allow_lan and not HOST_IS_LOOPBACK:
            return "bot_token_required"  # no token + LAN/public bind: bot writes refused (same as server.mjs)
        return "ok" if (_is_private_lan(ip) if allow_lan else _is_loopback(ip)) else "forbidden"

    def deny(self, why):
        send_json(self, 401 if why == "unauthorized" else 403, {"error": why})

    def snapshot_part(self, part):
        snap = read_json_file(SIGNALS_FILE, None)
        if not isinstance(snap, dict) or not is_obj(snap.get(part)):
            return send_json(self, 503, {"error": "no_snapshot", "hint": "Open the terminal in a browser once; it publishes signals after quotes and news load."}, {"Cache-Control": "no-store"})
        rec = _iso_ms(snap.get("received_at")) or 0
        age = max(0, round(time.time() - rec))
        return send_json(self, 200, {**snap[part], "received_at": snap.get("received_at"), "age_seconds": age, "stale": age > 3600}, {"Cache-Control": "no-store"})

    def bot_get(self, path, query) -> bool:
        if path == "/api/signals":
            self.snapshot_part("signals")
        elif path == "/api/news-feed":
            self.snapshot_part("newsFeed")
        elif path == "/api/mock-index":
            self.snapshot_part("mockIndex")
        elif path == "/api/bot/status":
            def last(p, k):
                lst = read_list(p)
                return {"count": len(lst), "last": lst[-1].get(k) if lst else None}
            snap = read_json_file(SIGNALS_FILE, None)
            send_json(self, 200, {
                "token_configured": bool(bot_token()),
                "trades": last(BOT_FILES["trades"], "ts"),
                "equity": last(BOT_FILES["equity"], "ts"),
                "reports": last(BOT_FILES["reports"], "week_end"),
                "backtest": bool(read_json_file(BOT_FILES["backtest"], None)),
                "signals_received_at": snap.get("received_at") if isinstance(snap, dict) else None,
            }, {"Cache-Control": "no-store"})
        elif path == "/api/bot/backtest":
            send_json(self, 200, {"backtest": read_json_file(BOT_FILES["backtest"], None)}, {"Cache-Control": "no-store"})
        elif path.startswith("/api/bot/") and path[len("/api/bot/"):] in BOT_KINDS:
            k = BOT_KINDS[path[len("/api/bot/"):]]
            send_json(self, 200, {k["key"]: filter_query(read_list(k["file"]), parse_qs(query))}, {"Cache-Control": "no-store"})
        else:
            return False
        return True

    def bot_post(self, path) -> bool:
        if path == "/api/signals-snapshot":
            why = self.bot_auth(True)
            if why != "ok":
                self.deny(why)
                return True
            body = self.read_json_body()
            if body is None:
                return True
            for k in ("signals", "newsFeed", "mockIndex"):
                if not is_obj(body.get(k)) or body[k].get("schema") != SIGNALS_SCHEMA:
                    self.bad(k)
                    return True
            if not isinstance(body["signals"].get("companies"), list):
                self.bad("signals.companies")
                return True
            with STATE_LOCK:
                write_json_atomic(SIGNALS_FILE, {"received_at": now_iso(), "signals": body["signals"], "newsFeed": body["newsFeed"], "mockIndex": body["mockIndex"]})
            send_json(self, 200, {"ok": True})
            return True
        if path == "/api/bot/backtest":
            why = self.bot_auth()
            if why != "ok":
                self.deny(why)
                return True
            body = self.read_json_body()
            if body is None:
                return True
            v, e = v_backtest(body)
            if e:
                self.bad(e)
                return True
            with STATE_LOCK:
                write_json_atomic(BOT_FILES["backtest"], v)
            send_json(self, 200, {"ok": True})
            return True
        name = path[len("/api/bot/"):] if path.startswith("/api/bot/") else None
        if name not in BOT_KINDS:
            return False
        k = BOT_KINDS[name]
        why = self.bot_auth()
        if why != "ok":
            self.deny(why)
            return True
        body = self.read_json_body()
        if body is None:
            return True
        if name == "weekly-report":
            v, e = v_report(body)
            items = None if e else [v]
        else:
            items, e = batch_of(body, k["key"], k["v"])
        if e:
            self.bad(e or "body")
            return True
        with STATE_LOCK:
            r = upsert(k["file"], items, k["id"], k["cap"], k["sort"])
        send_json(self, 200, {"ok": True, **r})
        return True


class Handler(BotApiMixin, SimpleHTTPRequestHandler):
    # Windows can map .js to text/plain via the registry, which breaks module scripts.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".html": "text/html",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def guess_type(self, path):  # noqa: D401
        ext = os.path.splitext(str(path))[1].lower()
        return self.extensions_map.get(ext) or super().guess_type(path)

    def log_message(self, fmt, *args):
        pass

    # -- body ------------------------------------------------------------
    def read_json_body(self):
        """Returns dict, or None after sending an error response (same limits/errors as server.mjs)."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY_BYTES:
            send_json(self, 413, {"error": "too_large"})
            return None
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw:
            return {}
        try:
            v = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            send_json(self, 400, {"error": "invalid_json"})
            return None
        if not isinstance(v, dict):
            send_json(self, 400, {"error": "invalid_json"})
            return None
        return v

    def bad(self, field: str) -> None:
        send_json(self, 400, {"error": "invalid_input", "field": field})

    # -- GET ---------------------------------------------------------------
    def do_HEAD(self):  # noqa: N802
        return self.do_GET()

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if under(path, "/api/sec-www"):
            rest = path[len("/api/sec-www"):] or "/"
            if parsed.query:
                rest = f"{rest}?{parsed.query}"
            return sec_www(self, rest)
        if under(path, "/api/news"):
            rest = path[len("/api/news"):] or "/"
            if parsed.query:
                rest = f"{rest}?{parsed.query}"
            return news_proxy(self, rest)
        for prefix, (base, ua) in PROXIES.items():
            if under(path, prefix):
                rest = path[len(prefix):] or "/"
                if parsed.query:
                    rest = f"{rest}?{parsed.query}"
                return proxy(base + rest, ua, self)
        if self.bot_get(path, parsed.query):
            return None
        if path == "/api/user-companies":
            return send_json(self, 200, {"companies": read_list(USER_COMPANIES_FILE)}, {"Cache-Control": "no-store"})
        if path == "/api/grokbot-status":
            return send_json(self, 200, {"configured": bool(webhook_config())}, {"Cache-Control": "no-store"})
        if path == "/api/grokbot-request":
            return send_json(self, 200, {"configured": bool(webhook_config()), "requests": read_list(PENDING_FILE)}, {"Cache-Control": "no-store"})
        if under(path, "/api"):
            return send_json(self, 404, {"error": "not_found"})
        file_path = ROOT / path.lstrip("/")
        if path == "/" or not file_path.is_file():
            self.path = "/index.html"
        return super().do_GET()

    # -- POST --------------------------------------------------------------
    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if self.bot_post(path):
            return None
        if path == "/api/user-companies":
            return self.post_user_company()
        if path == "/api/grokbot-request":
            return self.post_grokbot_request()
        if path == "/api/grokbot-request/retry":
            return self.post_retry()
        if under(path, "/api"):
            return send_json(self, 404, {"error": "not_found"})
        return send_json(self, 405, {"error": "method_not_allowed"})

    def do_DELETE(self):  # noqa: N802
        path = urlparse(self.path).path
        m = re.fullmatch(r"/api/user-companies/([^/]+)", path)
        if not m:
            return send_json(self, 404, {"error": "not_found"})
        cik = norm_cik(unquote(m.group(1)))
        if not cik:
            return self.bad("cik")
        with STATE_LOCK:
            lst = read_list(USER_COMPANIES_FILE)
            nxt = [c for c in lst if not (isinstance(c, dict) and c.get("cik") == cik)]
            removed = len(nxt) != len(lst)
            if removed:
                write_json_atomic(USER_COMPANIES_FILE, nxt)
        return send_json(self, 200, {"removed": removed, "cik": cik})

    def post_user_company(self):
        body = self.read_json_body()
        if body is None:
            return None
        cik = norm_cik(body.get("cik"))
        if not cik:
            return self.bad("cik")
        try:
            name = clean_text(body.get("name"), 200, required=True)
        except Invalid:
            return self.bad("name")
        try:
            ticker = clean_ticker(body.get("ticker"))
        except Invalid:
            return self.bad("ticker")
        fin = body.get("fin")
        if fin is not None and not isinstance(fin, dict):
            return self.bad("fin")
        filings = body.get("filings")
        if filings is not None and not isinstance(filings, dict):
            return self.bad("filings")
        try:
            check = formal_forms_for(cik)
        except Exception:  # noqa: BLE001
            return send_json(self, 502, {"error": "sec_unavailable"})
        if check.get("notFound"):
            return send_json(self, 404, {"error": "cik_not_found", "cik": cik})
        if not check["forms"]:
            return send_json(self, 422, {"error": "no_formal_filings", "cik": cik, "forms": []})
        with STATE_LOCK:
            lst = read_list(USER_COMPANIES_FILE)
            now = now_iso()
            idx = next((i for i, c in enumerate(lst) if isinstance(c, dict) and c.get("cik") == cik), -1)
            entry = {
                "cik": cik,
                "ticker": ticker,
                "name": name,
                "addedAt": lst[idx].get("addedAt") if idx >= 0 and lst[idx].get("addedAt") else now,
                "updatedAt": now,
                "formalForms": check["forms"],
                "fin": fin,
                "filings": filings,
            }
            if idx >= 0:
                lst[idx] = entry
            else:
                lst.append(entry)
            write_json_atomic(USER_COMPANIES_FILE, lst)
        print(f"[user-companies] {'added' if idx < 0 else 'updated'} CIK {cik}", flush=True)
        return send_json(self, 200, {"company": entry, "created": idx < 0})

    def post_grokbot_request(self):
        body = self.read_json_body()
        if body is None:
            return None
        if body.get("type") != "add_company":
            return self.bad("type")
        cik = norm_cik(body.get("cik"))
        if not cik:
            return self.bad("cik")
        try:
            name = clean_text(body.get("name"), 200, required=True)
        except Invalid:
            return self.bad("name")
        try:
            ticker = clean_ticker(body.get("ticker"))
        except Invalid:
            return self.bad("ticker")
        try:
            note = clean_text(body.get("note"), 500)
        except Invalid:
            return self.bad("note")
        requested_at = now_iso()
        if body.get("requestedAt") is not None:
            ra = body.get("requestedAt")
            parsed = parse_iso(ra) if isinstance(ra, str) and len(ra) <= 40 else None
            if not parsed:
                return self.bad("requestedAt")
            requested_at = parsed
        with STATE_LOCK:
            lst = read_list(PENDING_FILE)
            idx = next((i for i, r in enumerate(lst) if isinstance(r, dict) and r.get("cik") == cik and r.get("type") == "add_company"), -1)
            if idx >= 0 and lst[idx].get("status") == "sent":
                return send_json(self, 200, {"request": lst[idx], "deduped": True})
            if idx >= 0:
                r = dict(lst[idx])
                r.update({"ticker": ticker, "name": name, "note": note or None})
            else:
                r = {
                    "id": f"req-{cik}-{int(time.time() * 1000)}",
                    "type": "add_company",
                    "cik": cik,
                    "ticker": ticker,
                    "name": name,
                    "note": note or None,
                    "requestedAt": requested_at,
                    "status": "queued",
                    "attempts": 0,
                    "lastAttemptAt": None,
                    "httpStatus": None,
                    "error": None,
                }
            deliver(r)
            if idx >= 0:
                lst[idx] = r
            else:
                lst.append(r)
            write_json_atomic(PENDING_FILE, lst)
        return send_json(self, 200, {"request": r, "deduped": idx >= 0})

    def post_retry(self):
        body = self.read_json_body()
        if body is None:
            return None
        only = None
        if body.get("cik") is not None:
            only = norm_cik(body.get("cik"))
            if not only:
                return self.bad("cik")
        with STATE_LOCK:
            lst = read_list(PENDING_FILE)
            retried = 0
            for r in lst:
                if not isinstance(r, dict) or r.get("status") not in ("queued", "failed"):
                    continue
                if only and r.get("cik") != only:
                    continue
                deliver(r)
                retried += 1
            if retried:
                write_json_atomic(PENDING_FILE, lst)
        return send_json(self, 200, {"configured": bool(webhook_config()), "retried": retried, "requests": lst})


if __name__ == "__main__":
    if not ROOT.is_dir():
        raise SystemExit(f"Missing dist at {ROOT}")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"AI Infra Terminal listening on http://{HOST}:{PORT}  (open http://127.0.0.1:{PORT})", flush=True)
    print("Grok Bot link: " + ("configured" if webhook_config() else "not configured (requests queue in pending-requests.json)"), flush=True)
    print("Bot writes (/api/bot/*): " + ("BOT_TOKEN required" if bot_token() else ("loopback only (no BOT_TOKEN set)" if HOST_IS_LOOPBACK else "DISABLED until BOT_TOKEN is set (HOST is not loopback)")), flush=True)
    if SEC_UA == SEC_UA_PLACEHOLDER:
        print("WARNING: SEC_USER_AGENT is not set; SEC asks for a real contact. Set it as an environment variable or in .env (see README).", flush=True)
    httpd.serve_forever()
