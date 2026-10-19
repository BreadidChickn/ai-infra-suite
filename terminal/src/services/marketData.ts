import { companies as seedCompanies } from '../data/companies';
import { relationships } from '../data/relationships';
import { headlines as seedHeadlines, themes as seedThemes } from '../data/headlines';
import type { Company, DataMode, MarketData } from '../types';

export interface QuoteResult {
  ticker: string;
  change1D?: number;
  change1M?: number;
  changeYTD?: number;
  change1Q?: number;
  change6M?: number;
  price?: number;
}

async function fetchYahooQuote(ticker: string): Promise<QuoteResult | null> {
  try {
    const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const timestamps: number[] = result.timestamp ?? [];
    const price = meta?.regularMarketPrice ?? closes.filter((c) => c != null).at(-1);
    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;

    const valid = closes
      .map((c, i) => ({ c, t: timestamps[i] }))
      .filter((x) => x.c != null && x.t != null) as { c: number; t: number }[];

    if (!valid.length || price == null) return null;

    const last = valid[valid.length - 1];
    const dayAgo = valid.length >= 2 ? valid[valid.length - 2].c : prevClose;
    const monthAgoTs = last.t - 30 * 24 * 3600;
    const ytdStart = Date.UTC(new Date(last.t * 1000).getUTCFullYear(), 0, 1) / 1000;

    const findNear = (target: number) => {
      // No price before the first trade (e.g. a recent IPO): the horizon is undefined rather than "since listing".
      if (target < valid[0].t - 5 * 24 * 3600) return undefined;
      let best = valid[0];
      for (const v of valid) {
        if (Math.abs(v.t - target) < Math.abs(best.t - target)) best = v;
      }
      return best.c;
    };

    const change1D =
      dayAgo && dayAgo !== 0 ? ((price - dayAgo) / dayAgo) * 100 : undefined;
    const mPrice = findNear(monthAgoTs);
    const change1M = mPrice ? ((price - mPrice) / mPrice) * 100 : undefined;
    const yPrice = findNear(ytdStart);
    const changeYTD = yPrice ? ((price - yPrice) / yPrice) * 100 : undefined;
    const qAgoTs = last.t - 90 * 24 * 3600;
    const sixAgoTs = last.t - 180 * 24 * 3600;
    const qPrice = findNear(qAgoTs);
    const sixPrice = findNear(sixAgoTs);
    const change1Q = qPrice ? ((price - qPrice) / qPrice) * 100 : undefined;
    const change6M = sixPrice ? ((price - sixPrice) / sixPrice) * 100 : undefined;

    return {
      ticker,
      price,
      change1D: change1D != null ? Math.round(change1D * 100) / 100 : undefined,
      change1M: change1M != null ? Math.round(change1M * 100) / 100 : undefined,
      changeYTD: changeYTD != null ? Math.round(changeYTD * 100) / 100 : undefined,
      change1Q: change1Q != null ? Math.round(change1Q * 100) / 100 : undefined,
      change6M: change6M != null ? Math.round(change6M * 100) / 100 : undefined,
    };
  } catch {
    return null;
  }
}

/** Drop horizons that start before a recent IPO (no comparable price exists). */
function preIpoGuard(c: Company, q: QuoteResult): Partial<Company> {
  const ipo = Date.parse(c.ipoDate!);
  const now = Date.now();
  const startsBefore = (days: number) => now - days * 86400000 < ipo - 3 * 86400000;
  const ytdStart = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  return {
    change1M: startsBefore(30) ? undefined : q.change1M ?? c.change1M,
    change1Q: startsBefore(90) ? undefined : q.change1Q ?? c.change1Q,
    change6M: startsBefore(180) ? undefined : q.change6M,
    changeYTD: ytdStart < ipo ? undefined : q.changeYTD,
  };
}

/** Run async jobs with a concurrency cap (Yahoo throttles bursts of 60+ parallel requests). */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/**
 * Live quotes for every public ticker (AI infra + energy layer). Headlines are handled separately by the
 * news refresher (src/services/newsFeed.ts) so they can refresh on their own cadence.
 */
export async function loadMarketData(): Promise<{ data: MarketData; mode: DataMode; liveQuotes: number; liveHeadlines: number }> {
  const publicTickers = [...new Set(seedCompanies.filter((c) => c.ticker && !c.isPrivate).map((c) => c.ticker!))];

  const quotes = await pool(publicTickers, 8, (t) => fetchYahooQuote(t));
  const quoteMap = new Map<string, QuoteResult>();
  for (const q of quotes) if (q?.ticker) quoteMap.set(q.ticker, q);

  const companies: Company[] = seedCompanies.map((c) => {
    if (!c.ticker) return { ...c };
    const q = quoteMap.get(c.ticker);
    if (!q) return { ...c };
    return {
      ...c,
      change1D: q.change1D ?? c.change1D,
      change1M: q.change1M ?? c.change1M,
      changeYTD: q.changeYTD ?? c.changeYTD,
      change1Q: q.change1Q ?? c.change1Q,
      change6M: q.change6M ?? c.change6M,
      ...(c.ipoDate ? preIpoGuard(c, q) : {}),
    };
  });

  const liveQuotes = quoteMap.size;
  return {
    data: {
      companies,
      relationships,
      headlines: seedHeadlines,
      themes: seedThemes,
      asOf: new Date().toISOString(),
    },
    mode: liveQuotes > 0 ? 'mixed' : 'illustrative',
    liveQuotes,
    liveHeadlines: 0,
  };
}
