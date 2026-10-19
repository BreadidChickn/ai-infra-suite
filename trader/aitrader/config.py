"""All tunables. Edit here (or override via env) — nothing else hard-codes these."""
import os
from dataclasses import dataclass, field


def _load_dotenv():
    """Load KEY=VALUE lines from .env (repo root or $AITRADER_ENV) without overriding real env vars.
    Stdlib only, so it works anywhere Python runs."""
    path = os.environ.get("AITRADER_ENV") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip().removeprefix("export ").strip(), v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v


_load_dotenv()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PKG = os.path.dirname(os.path.abspath(__file__))
# SEC snapshot ships with the package; override with SEC_JSON env if you point at a live terminal copy.
SEC_JSON = os.environ.get("SEC_JSON", os.path.join(_PKG, "data", "sec-financials.json"))
UNIVERSE_JSON = os.path.join(_PKG, "data", "universe.json")
CACHE = os.path.join(ROOT, "cache")
REPORTS = os.path.join(ROOT, "reports")
STATE = os.path.join(ROOT, "state")


@dataclass
class Config:
    TRADING_PERIOD: str = os.environ.get("TRADING_PERIOD", "7d")  # "7d", "14d", ... or "ongoing"
    START_DATE: str | None = os.environ.get("TRADING_START")       # ISO date; set at launch
    CAPITAL: float = 100.0            # USD hard cap per strategy sleeve
    REBALANCE: str = "weekly"         # first trading day of each week
    TOP_N: int = 4
    MAX_WEIGHT: float = 0.35          # per name
    MAX_SEGMENT: float = 0.50         # per market group (chips / power / cloud ...)
    MIN_ORDER_USD: float = 1.0        # skip orders below $1
    STOP_DRAWDOWN: float = float(os.environ.get("STOP_DRAWDOWN", "0.25"))  # configurable; phase 2 default 25%
    STOP_COOLDOWN_DAYS: int = 20      # backtest stand-in for "manual restart": re-enter after N days if trend ok
    TARGET_RETURN: float = float(os.environ.get("TARGET_RETURN", "0.29"))  # Owner's goal: >29% annualised return
    BOT_API: str = os.environ.get("BOT_API_URL", "http://127.0.0.1:4173")
    MIN_HISTORY_YEARS: int = 5        # core universe: >=5y prices AND >=5 annual SEC filings
    EMERGING_GROSS: float = 0.50      # emerging sleeve: only 50% of sleeve deployed
    EMERGING_MAX_WEIGHT: float = 0.15
    EMERGING_HEDGE: float = 0.50      # short 0.5 x beta x exposure of SPY (live: SH inverse ETF)
    E_RISK_MAX: float = 60.0          # strategy E: reject baskets with Mock risk > 60
    E_TOP_BASKETS: int = 2
    RISK_OFF_NEWS: float = -60.0      # market-wide news_sent below this -> cash
    TREND_SMA: int = 50
    MOM_LOOKBACK: int = 126           # momentum = return(t-126, t-5)
    MOM_SKIP: int = 5
    VOL_WINDOW: int = 60
    COST_BPS: float = 5.0             # slippage+fees per side in backtest
    WEIGHTS_B: dict = field(default_factory=lambda: {
        "news_sent": 0.30, "graph_sent": 0.20, "fin_score": 0.20,
        "growth": 0.15, "risk": -0.15, "momentum": 0.20})
    PLACEBO_SEEDS: int = 200
    DRY_RUN: bool = os.environ.get("DRY_RUN", "true").lower() not in ("false", "0", "no")  # default: never place orders
    ALPACA_BASE: str = "https://paper-api.alpaca.markets"
    ALPACA_DATA: str = "https://data.alpaca.markets"

    def period_days(self):
        if self.TRADING_PERIOD == "ongoing":
            return None
        return int(self.TRADING_PERIOD.rstrip("d"))


CFG = Config()
