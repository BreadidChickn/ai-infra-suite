"""Read-only client for the AI Infra Terminal (contract v1 §3). Returns None on 503 no_snapshot / unreachable,
so callers fall back to the bot's own Python computation."""
import requests
from .config import CFG


def get(path, timeout=8):
    try:
        r = requests.get(CFG.BOT_API.rstrip("/") + path, timeout=timeout)
        if r.status_code == 200: return r.json()
        return None  # 503 no_snapshot or other -> fallback
    except requests.RequestException:
        return None


def signals(): return get("/api/signals")
def news_feed(): return get("/api/news-feed")
def mock_index(): return get("/api/mock-index")
