/**
 * Theme Scores synthesised from the live news feed.
 *
 * For each curated theme, a headline matches when its title hits the theme's keyword regex OR it is tagged with
 * one of the theme's markets AND (if set) one of the theme's categories. Score = weighted mean sentiment of the
 * matching headlines over the last 30 days, exactly like the market drill-down:
 *     score = 100 × Σ(wᵢ·sᵢ) / Σwᵢ,   wᵢ = source quality × e^(−age/240h) × (1 + 0.25·log₂(1+similar stories))
 * A theme needs ≥ MIN_THEME_HEADLINES matches; otherwise it keeps its curated seed score and is badged SEED.
 */
import type { NewsCategory, SentimentTheme } from '../types';
import { sentimentWeight, type NewsItem } from './newsFeed';
import { ENERGY_MARKET_IDS } from '../data/markets';

export const MIN_THEME_HEADLINES = 2;

/** Colour bands for theme / news figures (documented in the UI tooltip). */
export const SENT_BANDS = { green: 15, red: -15 } as const;
export function sentBand(score: number): 'pos' | 'neu' | 'neg' {
  return score >= SENT_BANDS.green ? 'pos' : score <= SENT_BANDS.red ? 'neg' : 'neu';
}
export const SENT_BAND_HELP = `Green ≥ +${SENT_BANDS.green} · Yellow between −${-SENT_BANDS.red} and +${SENT_BANDS.green} · Red ≤ ${SENT_BANDS.red} (scale −100 bearish … +100 bullish)`;

interface ThemeRule {
  keywords: RegExp;
  markets?: string[];
  /** When set, a market-tag match only counts for these categories (keyword matches always count). */
  categories?: NewsCategory[];
}

export const THEME_RULES: Record<string, ThemeRule> = {
  t0: { keywords: /\btrump\b.*\bxi\b|\bxi\b.*\btrump\b|rare[- ]earths?|critical minerals?|\bbessent\b.*china|china.*\bbessent\b/i },
  t1: {
    keywords: /\bcapex\b|capital spending|ai spending|ai (build-?out|infrastructure spending)|data[- ]cent(er|re) (build|investment|spending|deal)|stargate|gpu (deal|order|purchase)|compute (deal|contract)/i,
    markets: ['cloud', 'ai_labs'],
    categories: ['investment'],
  },
  t2: { keywords: /export (controls?|curbs?|ban|rules?|licen[cs]es?)|entity list|chip curbs|\bh20\b|smuggl/i },
  t3: { keywords: /chips act|chips and science|chip subsid|fab (grant|subsid)|commerce (department )?(stake|grant)/i },
  t4: { keywords: /\btaiwan\b(?! semiconductor)|taiwan strait|cross-strait/i },
  t5: { keywords: /tariffs?|section 232|trade war|import duties/i },
  t6: {
    keywords: /\bpower (grid|demand|supply|deal|shortage|prices?)\b|electricity|\bgrid\b|nuclear|gas turbines?|\bppas?\b|power purchase|utilit(y|ies)|interconnection/i,
    markets: ENERGY_MARKET_IDS,
  },
  t7: { keywords: /antitrust|\bftc\b|\bdoj\b|monopol|competition (watchdog|regulator|authority)|anti-competitive/i },
  t8: { keywords: /\bhbm\d?e?\b|\bdram\b|memory (chips?|prices?|shortage|bottleneck)|\bnand\b/i, markets: ['memory'] },
  t9: { keywords: /\basml\b|\beuv\b|lithograph|chip(making)? equipment|wafer fab equipment|applied materials|lam research|\bkla\b/i, markets: ['equipment'] },
  t10: { keywords: /custom (chips?|silicon|asics?)|\basics?\b|\btpus?\b|trainium|rivals? nvidia|challenge nvidia|nvidia rival|alternative to nvidia|market share/i },
};

export interface DerivedTheme extends SentimentTheme {
  source: 'news' | 'seed';
  seedScore: number;
  matchCount: number;
  /** Top matching headlines (most weight first) */
  matches: NewsItem[];
}

export function matchesTheme(rule: ThemeRule, i: NewsItem): boolean {
  if (rule.keywords.test(i.title)) return true;
  if (rule.markets && i.markets.some((m) => rule.markets!.includes(m))) {
    return !rule.categories || rule.categories.includes(i.category);
  }
  return false;
}

export function deriveThemes(seed: SentimentTheme[], items: NewsItem[], live: boolean, now = Date.now()): DerivedTheme[] {
  const recent = items.filter((i) => now - Date.parse(i.publishedAt) <= 30 * 24 * 3600 * 1000);
  return seed.map((t) => {
    const rule = THEME_RULES[t.id];
    const m = rule && live ? recent.filter((i) => matchesTheme(rule, i)) : [];
    let sw = 0;
    let s = 0;
    for (const i of m) {
      const w = sentimentWeight(i, now);
      sw += w;
      s += w * i.sentiment;
    }
    const useNews = m.length >= MIN_THEME_HEADLINES && sw > 0;
    const score = useNews ? Math.round((100 * s) / sw) : t.score;
    const matches = [...m].sort((a, b) => sentimentWeight(b, now) - sentimentWeight(a, now)).slice(0, 4);
    return { ...t, score, source: useNews ? 'news' : 'seed', seedScore: t.score, matchCount: m.length, matches };
  });
}
