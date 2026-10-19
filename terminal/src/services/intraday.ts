/**
 * Realized-move fetcher for the Mock Index "Experimental" panel.
 * One Yahoo chart call per ticker: /api/yahoo/v8/finance/chart/<t>?range=1d&interval=5m
 *   • intraday 3h move  = last 5-min close ÷ close of the bar ~3h earlier − 1 (same session)
 *   • end-of-day move   = regularMarketPrice ÷ chartPreviousClose − 1 (latest session vs prior close)
 * Nothing is estimated: if a series is missing or too short the value is null (rendered N/A).
 */

export interface RealizedQuote {
  ticker: string;
  ok: boolean;
  exchangeTz?: string;
  /** Last regular-session bar time (ms) */
  lastBarMs?: number;
  /** Regular session window of the *current/next* trading period (ms) */
  sessionStartMs?: number;
  sessionEndMs?: number;
  /** True when "now" is inside the regular session and data is fresh */
  open: boolean;
  /** Intraday move over the last 3h of the latest session (%) */
  move3h: number | null;
  /** Start / end of the 3h window actually used (ms) */
  win3hStartMs?: number;
  win3hEndMs?: number;
  /** Latest session close (or last price) vs prior close (%) */
  moveEod: number | null;
  eodPrice?: number;
  prevClose?: number;
  error?: string;
}

const cache = new Map<string, { at: number; q: RealizedQuote }>();
const TTL = 2 * 60 * 1000;
const THREE_H = 3 * 3600 * 1000;

interface YahooChart {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        exchangeTimezoneName?: string;
        currentTradingPeriod?: { regular?: { start?: number; end?: number } };
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

export async function fetchRealized(ticker: string, now = Date.now()): Promise<RealizedQuote> {
  const hit = cache.get(ticker);
  if (hit && now - hit.at < TTL) return hit.q;
  const base: RealizedQuote = { ticker, ok: false, open: false, move3h: null, moveEod: null };
  try {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as YahooChart;
    const r = json.chart?.result?.[0];
    const meta = r?.meta;
    if (!r || !meta) throw new Error('no data');
    const ts = r.timestamp ?? [];
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const pts: { t: number; c: number }[] = [];
    for (let k = 0; k < ts.length; k++) {
      const c = closes[k];
      if (c != null && Number.isFinite(c)) pts.push({ t: ts[k] * 1000, c });
    }
    const q: RealizedQuote = { ...base, ok: true, exchangeTz: meta.exchangeTimezoneName };
    const reg = meta.currentTradingPeriod?.regular;
    if (reg?.start && reg?.end) {
      q.sessionStartMs = reg.start * 1000;
      q.sessionEndMs = reg.end * 1000;
    }
    const last = pts[pts.length - 1];
    if (last) {
      q.lastBarMs = last.t;
      const from = last.t - THREE_H;
      // first bar at/after the window start; require ≥ 2.5h of coverage so a late open isn't passed off as 3h
      const first = pts.find((p) => p.t >= from - 60_000);
      if (first && last.t - first.t >= 2.5 * 3600 * 1000) {
        q.move3h = (last.c / first.c - 1) * 100;
        q.win3hStartMs = first.t;
        q.win3hEndMs = last.t;
      }
    }
    q.open = Boolean(q.sessionStartMs && q.sessionEndMs && now >= q.sessionStartMs && now <= q.sessionEndMs && last && now - last.t < 20 * 60 * 1000);
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    if (price != null && prev) {
      q.moveEod = (price / prev - 1) * 100;
      q.eodPrice = price;
      q.prevClose = prev;
    }
    if (!q.lastBarMs && meta.regularMarketTime) q.lastBarMs = meta.regularMarketTime * 1000;
    cache.set(ticker, { at: now, q });
    return q;
  } catch (err) {
    return { ...base, error: String((err as Error)?.message || err) };
  }
}

export async function fetchRealizedMany(tickers: string[], pool = 6): Promise<Map<string, RealizedQuote>> {
  const out = new Map<string, RealizedQuote>();
  const queue = [...new Set(tickers)];
  await Promise.all(
    Array.from({ length: Math.min(pool, queue.length) }, async () => {
      while (queue.length) {
        const t = queue.shift()!;
        out.set(t, await fetchRealized(t));
      }
    })
  );
  return out;
}

export type CompareMode = 'intraday3h' | 'eod';

/**
 * Auto mode from the US reference (SPY): intraday-3h while the US regular session is open or ended < 2h ago
 * (the last 3h of that session is then the most recent realized move); otherwise end-of-day.
 */
export function autoMode(ref: RealizedQuote | undefined, now = Date.now()): CompareMode {
  if (!ref?.ok) return 'eod';
  if (ref.open && ref.move3h != null) return 'intraday3h';
  if (ref.lastBarMs && now - ref.lastBarMs < 2 * 3600 * 1000 && ref.move3h != null) return 'intraday3h';
  return 'eod';
}
