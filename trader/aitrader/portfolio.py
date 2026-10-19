"""Scoring -> picks -> inverse-vol weights with 35%/name and 50%/segment caps (remainder = cash)."""
import numpy as np
import pandas as pd
from .config import CFG
from .signals import zs


def composite(sig: pd.DataFrame, weights: dict):
    """Weighted sum of cross-sectional z-scores; missing signals are dropped and the remaining weights
    renormalised by absolute weight, so an N/A signal never counts as a fake 0 reading."""
    tot = pd.Series(0.0, index=sig.index); wsum = pd.Series(0.0, index=sig.index)
    for k, w in weights.items():
        if k not in sig or sig[k].notna().sum() < 3: continue
        z = zs(sig[k])
        m = z.notna()
        tot[m] += w * z[m]; wsum[m] += abs(w)
    out = tot / wsum.replace(0, np.nan)
    return out


def cap_weights(raw: pd.Series, groups: pd.Series):
    w = raw / raw.sum()
    for _ in range(20):
        w = w.clip(upper=CFG.MAX_WEIGHT)
        g = w.groupby(groups).transform("sum")
        over = g > CFG.MAX_SEGMENT + 1e-9
        w[over] = w[over] * CFG.MAX_SEGMENT / g[over]
        if w.max() <= CFG.MAX_WEIGHT + 1e-9 and w.groupby(groups).sum().max() <= CFG.MAX_SEGMENT + 1e-9:
            break
    return w  # sums to <= 1; rest is cash (no re-levering past caps)


def build(score: pd.Series, eligible: pd.Series, vol: pd.Series, groups: pd.Series):
    s = score[eligible & score.notna() & vol.notna() & (vol > 0)]
    if s.empty: return pd.Series(dtype=float)
    picks = s.sort_values(ascending=False).index[: CFG.TOP_N]
    return cap_weights(1 / vol[picks], groups[picks])
