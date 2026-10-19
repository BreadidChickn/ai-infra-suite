import type { Company, Headline, SentimentTheme } from '../types';
import { marketOfSegment } from '../data/markets';

/**
 * Mock Index scoring — the single source of truth used by the Mock Index tab AND the
 * /api/signals + /api/mock-index snapshot published for the trading bot. Do not fork.
 */
export interface MockScores {
  sentiment: number;
  risk: number;
  profitability: number;
  growth: number;
}

export interface MockScoreInputs {
  themes: SentimentTheme[];
  headlines: Headline[];
  /** Live news sentiment per market id (−100…100, null when no headlines) */
  marketScores?: Record<string, number | null>;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function basketWeights(members: Company[], weightMode: 'equal' | 'mcap'): Map<string, number> {
  const map = new Map<string, number>();
  if (!members.length) return map;
  if (weightMode === 'equal') {
    const w = 1 / members.length;
    members.forEach((c) => map.set(c.id, w));
  } else {
    const total = members.reduce((s, c) => s + Math.max(c.marketCapB, 0.1), 0);
    members.forEach((c) => map.set(c.id, Math.max(c.marketCapB, 0.1) / total));
  }
  return map;
}

/** Skip members whose IPO is too recent for the requested horizon (no price history). */
export function hasHistory(c: Company, horizonDays: number, now = Date.now()) {
  if (!c.ipoDate) return true;
  const age = (now - Date.parse(c.ipoDate)) / 86400000;
  return age >= horizonDays * 0.85;
}

export function makeWeightedAvg(members: Company[], weights: Map<string, number>) {
  return (getter: (c: Company) => number | undefined, horizonDays = 0) => {
    let sum = 0;
    let wSum = 0;
    for (const c of members) {
      if (horizonDays && !hasHistory(c, horizonDays)) continue;
      const v = getter(c);
      if (v == null || Number.isNaN(v)) continue;
      const w = weights.get(c.id) || 0;
      sum += v * w;
      wSum += w;
    }
    return wSum > 0 ? sum / wSum : undefined;
  };
}

export function computeMockScores(members: Company[], weights: Map<string, number>, inp: MockScoreInputs): MockScores {
  if (!members.length) return { sentiment: 0, risk: 0, profitability: 0, growth: 0 };
  const { themes, headlines, marketScores } = inp;
  const weightedAvg = makeWeightedAvg(members, weights);

  const themeAvg = themes.reduce((s, t) => s + t.score, 0) / Math.max(themes.length, 1);
  const fallbackHl = headlines.reduce((s, h) => s + (h.sentiment ?? 0), 0) / Math.max(headlines.length, 1);
  const hlAvg =
    weightedAvg((c) => {
      const mk = marketOfSegment(c.segment);
      const v = mk ? marketScores?.[mk] : null;
      return v == null ? undefined : v / 100;
    }) ?? fallbackHl;
  const mom = weightedAvg((c) => c.change1D) ?? 0;
  const sentiment = clamp(50 + themeAvg * 0.25 + hlAvg * 20 + mom * 1.5, 0, 100);

  const privShare = members.filter((c) => c.isPrivate).length / members.length;
  const geoRisk = members.filter((c) => c.country === 'CN' || c.country === 'TW').length / members.length;
  const vol =
    members.reduce((s, c) => s + Math.abs(c.change1D ?? 0) + Math.abs(c.change1M ?? 0) * 0.3, 0) / members.length;
  const risk = clamp(privShare * 35 + geoRisk * 40 + vol * 2.5 + 15, 0, 100);

  const ytd = weightedAvg((c) => c.changeYTD) ?? 0;
  const posShare = members.filter((c) => (c.changeYTD ?? 0) > 0).length / members.length;
  const profitability = clamp(40 + posShare * 35 + Math.max(-20, Math.min(25, ytd * 0.35)), 0, 100);

  const g =
    (weightedAvg((c) => c.change1M) ?? 0) * 0.3 +
    (weightedAvg((c) => c.change1Q) ?? 0) * 0.35 +
    (weightedAvg((c) => c.changeYTD) ?? 0) * 0.2;
  const growth = clamp(50 + g * 0.9, 0, 100);

  return {
    sentiment: Math.round(sentiment),
    risk: Math.round(risk),
    profitability: Math.round(profitability),
    growth: Math.round(growth),
  };
}
