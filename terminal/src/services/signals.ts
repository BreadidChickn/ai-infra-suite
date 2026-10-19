import type { Company, Headline, Relationship, SentimentTheme } from '../types';
import { MARKETS, marketOfSegment } from '../data/markets';
import { SEGMENT_LABELS } from '../data/constants';
import { allMarketSentiments, rankScore, sentimentFor, sentimentWeight, topForWindow, type NewsFeed } from './newsFeed';
import { basketWeights, computeMockScores } from './mockScores';
import type { SecSnapshot } from './secFinancials';
import type { MetricKey } from '../lib/secExtract.mjs';

/**
 * Builds the read-only snapshot served at /api/signals, /api/news-feed and /api/mock-index.
 * It reuses the exact UI functions (sentimentFor, rankScore, computeMockScores), so the bot sees the
 * same numbers as the dashboard. The browser publishes it via POST /api/signals-snapshot after every
 * news / quote refresh; the servers persist it to signals-snapshot.json. See docs/bot-api-contract.md.
 */
export const SIGNALS_SCHEMA = 'ai-infra-signals/v1';

const SEC_KEYS: MetricKey[] = ['revenue', 'operatingIncome', 'netIncome', 'ocf', 'capex'];

function secKeyFigures(sec: SecSnapshot | null, id: string) {
  const f = sec?.companies?.[id];
  if (!f || f.status !== 'ok') return null;
  const out: Record<string, { annual: { end: string; val: number; form: string } | null; quarterly: { end: string; val: number; form: string } | null }> = {};
  for (const k of SEC_KEYS) {
    const s = f.metrics?.[k];
    if (!s) continue;
    const last = (arr?: { end: string; val: number; form: string }[]) => {
      const p = arr && arr.length ? arr[arr.length - 1] : null;
      return p ? { end: p.end, val: p.val, form: p.form } : null;
    };
    out[k] = { annual: last(s.annual), quarterly: last(s.quarterly) };
  }
  return { cik: f.cik ?? null, currency: f.currency ?? null, fetchedAt: f.fetchedAt ?? null, metrics: out };
}

const r1 = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export function buildSignalsSnapshot(args: {
  companies: Company[];
  relationships: Relationship[];
  feed: NewsFeed;
  themes: SentimentTheme[];
  headlines: Headline[];
  marketScores: Record<string, number | null>;
  quotesLive: boolean;
  sec: SecSnapshot | null;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  const { companies, relationships, feed, themes, headlines, marketScores } = args;
  const degree = new Map<string, number>();
  for (const r of relationships) {
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  }
  const inputs = { themes, headlines, marketScores };
  const perCompany = companies.map((c) => {
    const ms = computeMockScores([c], basketWeights([c], 'equal'), inputs);
    const mk = marketOfSegment(c.segment) ?? null;
    const own = sentimentFor(feed.items.filter((i) => i.companies.includes(c.id)), now);
    return { c, ms, mk, own };
  });
  const generatedAt = new Date(now).toISOString();
  const meta = {
    schema: SIGNALS_SCHEMA,
    generated_at: generatedAt,
    news_mode: feed.mode,
    news_fetched_at: feed.fetchedAt,
    quotes: args.quotesLive ? 'live' : 'illustrative',
    sec_generated_at: args.sec?.generatedAt ?? null,
  };

  const signals = {
    ...meta,
    companies: perCompany.map(({ c, ms, mk, own }) => ({
      id: c.id,
      ticker: c.ticker ?? null,
      name: c.name,
      segment: c.segment,
      segment_label: SEGMENT_LABELS[c.segment],
      market: mk,
      country: c.country,
      is_private: !!c.isPrivate,
      ipo_date: c.ipoDate ?? null,
      market_cap_b: c.marketCapB,
      // Returns are % and only present when live quotes loaded; otherwise null (never seed numbers).
      returns: args.quotesLive && !c.isPrivate
        ? { d1: r1(c.change1D), m1: r1(c.change1M), q1: r1(c.change1Q), m6: r1(c.change6M), ytd: r1(c.changeYTD) }
        : null,
      news: {
        company_score: own.count ? r1(own.score, 1) : null,
        company_count: own.count,
        market_score: mk ? marketScores[mk] ?? null : null,
      },
      mock_index: ms,
      sec: secKeyFigures(args.sec, c.id),
      relationship_degree: degree.get(c.id) ?? 0,
      ai_link: c.aiLink ? { strength: c.aiLink.strength, summary: c.aiLink.summary, source: c.aiLink.url } : null,
    })),
  };

  const all = sentimentFor(feed.items, now);
  const mkts = allMarketSentiments(feed.items, now);
  const item = (i: NewsFeed['items'][number]) => ({
    id: i.id,
    title: i.title,
    source: i.source,
    url: i.sourceUrl ?? i.url ?? null,
    published_at: i.publishedAt,
    sentiment: r1(i.sentiment, 3),
    weight: r1(sentimentWeight(i, now), 4),
    rank: r1(rankScore(i, 'week', now), 4),
    category: i.category,
    tags: i.tags,
    markets: i.markets,
    companies: i.companies,
  });
  const newsFeed = {
    ...meta,
    composite: { score: r1(all.score, 1), count: all.count, trend: Number.isNaN(all.trend) ? null : r1(all.trend, 1) },
    top: {
      day: topForWindow(feed.items, 'day', now).map(item),
      week: topForWindow(feed.items, 'week', now).map(item),
      month: topForWindow(feed.items, 'month', now).map(item),
    },
    markets: MARKETS.map((m) => {
      const s = mkts[m.id];
      return {
        id: m.id,
        label: m.label,
        score: s.count ? r1(s.score, 1) : null,
        count: s.count,
        trend: Number.isNaN(s.trend) ? null : r1(s.trend, 1),
        weekly: s.weekly,
        categories: s.categories.map((k) => ({ category: k.category, count: k.count, avg: r1(k.avg, 1), contribution: r1(k.contribution, 1), share: r1(k.share, 3) })),
      };
    }),
    themes: themes.map((t) => ({ id: t.id, name: t.name, score: r1(t.score, 1), political: t.political })),
    items: [...feed.items].sort((a, b) => rankScore(b, 'week', now) - rankScore(a, 'week', now)).slice(0, 150).map(item),
  };

  const themeAvg = themes.reduce((s, t) => s + t.score, 0) / Math.max(themes.length, 1);
  const mockIndex = {
    ...meta,
    formula: {
      sentiment: 'clamp(50 + 0.25*themeAvg + 20*basketMarketNews/100 + 1.5*basket1D%, 0, 100)',
      risk: 'clamp(35*privateShare + 40*CN/TW share + 2.5*avg(|1D|+0.3*|1M|) + 15, 0, 100)',
      profitability: 'clamp(40 + 35*share(YTD>0) + clamp(0.35*YTD%, -20, 25), 0, 100)',
      growth: 'clamp(50 + 0.9*(0.3*1M + 0.35*1Q + 0.2*YTD), 0, 100)',
    },
    inputs: { theme_avg: r1(themeAvg, 2), market_scores: marketScores, headline_count: headlines.length },
    companies: perCompany.map(({ c, ms }) => ({ id: c.id, ticker: c.ticker ?? null, ...ms })),
  };
  return { signals, newsFeed, mockIndex };
}

/** Fire-and-forget publish; failures are silent (static hosting / old server). */
export async function publishSignals(snap: ReturnType<typeof buildSignalsSnapshot>): Promise<boolean> {
  try {
    const r = await fetch('/api/signals-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snap),
    });
    return r.ok;
  } catch {
    return false;
  }
}
