/**
 * Typed client + metrics for the AI Trader tab. Data comes ONLY from the bot's records posted to
 * this terminal (/api/bot/*, see docs/bot-api-contract.md) and benchmark closes from /api/yahoo.
 * Every metric returns null when there is not enough real data — nothing is estimated or invented.
 */
export type SleeveCode = string; // A | B | C | D | E, optionally suffixed: D_SPY, D_EW
export const SLEEVE_INFO: Record<string, { label: string; color: string }> = {
  A: { label: 'Baseline', color: '#4fc3f7' },
  B: { label: 'AI-Infra', color: '#00e676' },
  C: { label: 'Placebo', color: '#8fa3c4' },
  D: { label: 'Benchmarks', color: '#ffb300' },
  E: { label: 'Mock Index', color: '#ce93d8' },
};
const EXTRA_COLORS = ['#ff8a65', '#fff176', '#80cbc4', '#f48fb1', '#b39ddb'];
export function sleeveColor(code: string, i = 0): string {
  if (SLEEVE_INFO[code]) return SLEEVE_INFO[code].color;
  if (code.startsWith('D_')) return ['#ffb300', '#ffd54f', '#ff8f00'][i % 3];
  return EXTRA_COLORS[i % EXTRA_COLORS.length];
}

export interface BotTrade {
  id: string;
  ts: string;
  ticker: string;
  side: 'buy' | 'sell' | 'short' | 'cover';
  qty: number;
  price: number;
  sleeve: SleeveCode;
  sleeve_label: string;
  reason: { text: string; signals: Record<string, number | string | boolean | null> };
  status?: string;
  notional?: number;
  fee?: number;
  order_id?: string;
  timeframe?: string;
  example?: boolean;
}
export interface BotPosition {
  ticker: string;
  qty: number;
  avg_cost?: number;
  price?: number;
  market_value?: number;
  unrealized_pl?: number;
  hedge?: boolean;
}
export interface BotEquity {
  ts: string;
  sleeve: SleeveCode;
  sleeve_label: string;
  equity: number;
  cash: number;
  positions: BotPosition[];
  example?: boolean;
}
export interface BotReport {
  id: string;
  week_start: string;
  week_end: string;
  sleeves: {
    sleeve: SleeveCode;
    sleeve_label: string;
    return_pct: number;
    start_equity?: number;
    end_equity?: number;
    annualized_pct?: number;
    max_drawdown_pct?: number;
    trades?: number;
    win_rate?: number;
  }[];
  benchmarks: { name: string; return_pct: number }[];
  target_flag: boolean;
  target_annual_pct: number;
  summary?: string;
  why: string;
  missed: { kind: 'info' | 'prediction' | 'stat'; detail: string }[];
  paper_vs_real: string[];
  went_right: string[];
  went_wrong: string[];
  example?: boolean;
}
export interface BotBacktest {
  generated_at: string;
  universe_note?: string;
  period?: string;
  rows: {
    sleeve: SleeveCode;
    sleeve_label: string;
    cagr_pct?: number;
    total_return_pct?: number;
    vol_pct?: number;
    sharpe?: number;
    max_dd_pct?: number;
    hit_rate_pct?: number;
    note?: string;
  }[];
  newer_names_flagged: string[];
  example?: boolean;
}
export interface BotStatus {
  token_configured: boolean;
  trades: { count: number; last: string | null };
  equity: { count: number; last: string | null };
  reports: { count: number; last: string | null };
  backtest: boolean;
  signals_received_at: string | null;
}

export interface TraderData {
  ok: boolean;
  error?: string;
  status: BotStatus | null;
  trades: BotTrade[];
  equity: BotEquity[];
  reports: BotReport[];
  backtest: BotBacktest | null;
  fetchedAt: number;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function loadTraderData(): Promise<TraderData> {
  try {
    const [status, t, e, w, b] = await Promise.all([
      getJson<BotStatus>('/api/bot/status'),
      getJson<{ trades: BotTrade[] }>('/api/bot/trades?limit=2000'),
      getJson<{ equity: BotEquity[] }>('/api/bot/equity?limit=20000'),
      getJson<{ reports: BotReport[] }>('/api/bot/weekly-report'),
      getJson<{ backtest: BotBacktest | null }>('/api/bot/backtest'),
    ]);
    return { ok: true, status, trades: t.trades, equity: e.equity, reports: w.reports, backtest: b.backtest, fetchedAt: Date.now() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: null, trades: [], equity: [], reports: [], backtest: null, fetchedAt: Date.now() };
  }
}

/* ---------------------------------------------------------------- metrics */

export type Range = '1D' | '1W' | '1M' | 'YTD' | 'ALL';
export function rangeStart(r: Range, now = Date.now()): number {
  if (r === '1D') return now - 86400000;
  if (r === '1W') return now - 7 * 86400000;
  if (r === '1M') return now - 30 * 86400000;
  if (r === 'YTD') return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  return 0;
}

export interface Pt { t: number; v: number }
export function sleeveSeries(equity: BotEquity[], sleeve: string): Pt[] {
  return equity
    .filter((e) => e.sleeve === sleeve)
    .map((e) => ({ t: Date.parse(e.ts), v: e.equity }))
    .sort((a, b) => a.t - b.t);
}
export function sleevesIn(equity: BotEquity[], trades: BotTrade[]): { code: string; label: string }[] {
  const m = new Map<string, string>();
  for (const x of [...equity, ...trades]) if (!m.has(x.sleeve)) m.set(x.sleeve, x.sleeve_label);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, label]) => ({ code, label }));
}

/** Value at or before t (null when the series starts after t). */
export function valueAt(s: Pt[], t: number): number | null {
  let v: number | null = null;
  for (const p of s) {
    if (p.t <= t) v = p.v;
    else break;
  }
  return v;
}
export function pctChange(s: Pt[], from: number): number | null {
  if (s.length < 2) return null;
  const start = valueAt(s, from) ?? (s[0].t >= from ? s[0].v : null);
  const end = s[s.length - 1].v;
  if (start == null || start <= 0) return null;
  return (end / start - 1) * 100;
}
/** Last value per calendar day (UTC) → daily simple returns. */
export function dailyReturns(s: Pt[]): number[] {
  const byDay = new Map<string, number>();
  for (const p of s) byDay.set(new Date(p.t).toISOString().slice(0, 10), p.v);
  const vals = [...byDay.values()];
  const out: number[] = [];
  for (let i = 1; i < vals.length; i++) if (vals[i - 1] > 0) out.push(vals[i] / vals[i - 1] - 1);
  return out;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
export function sharpe(r: number[]): number | null {
  if (r.length < 5) return null;
  const m = mean(r);
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(252) : null;
}
export function sortino(r: number[]): number | null {
  if (r.length < 5) return null;
  const m = mean(r);
  const dd = Math.sqrt(r.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / r.length);
  return dd > 0 ? (m / dd) * Math.sqrt(252) : null;
}
export function drawdownSeries(s: Pt[]): Pt[] {
  let peak = -Infinity;
  return s.map((p) => {
    peak = Math.max(peak, p.v);
    return { t: p.t, v: peak > 0 ? (p.v / peak - 1) * 100 : 0 };
  });
}
export function maxDrawdown(s: Pt[]): number | null {
  if (s.length < 2) return null;
  return Math.min(...drawdownSeries(s).map((p) => p.v));
}
/** Annualised since-inception return; null before 7 days of history (too noisy to annualise). */
export function annualized(s: Pt[]): { pct: number; days: number } | null {
  if (s.length < 2 || s[0].v <= 0) return null;
  const days = (s[s.length - 1].t - s[0].t) / 86400000;
  if (days < 7) return null;
  return { pct: ((s[s.length - 1].v / s[0].v) ** (365 / days) - 1) * 100, days };
}

/** Realised win rate: closing trades (sell/cover) vs running average cost per sleeve+ticker. */
export function winRate(trades: BotTrade[]): { rate: number; n: number } | null {
  const book = new Map<string, { qty: number; cost: number }>();
  let wins = 0;
  let n = 0;
  for (const t of [...trades].sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (t.status && t.status !== 'filled' && t.status !== 'partially_filled') continue;
    const k = `${t.sleeve}|${t.ticker}`;
    const b = book.get(k) ?? { qty: 0, cost: 0 };
    if (t.side === 'buy' || t.side === 'short') {
      b.cost += t.qty * t.price;
      b.qty += t.qty;
    } else if (b.qty > 0) {
      const avg = b.cost / b.qty;
      const long = t.side === 'sell';
      if (long ? t.price > avg : t.price < avg) wins++;
      n++;
      const q = Math.min(t.qty, b.qty);
      b.cost -= avg * q;
      b.qty -= q;
    }
    book.set(k, b);
  }
  return n ? { rate: (wins / n) * 100, n } : null;
}
/** Turnover = traded notional ÷ average equity over the window (×100 %). */
export function turnover(trades: BotTrade[], s: Pt[], from: number): number | null {
  const win = s.filter((p) => p.t >= from);
  if (!win.length) return null;
  const avgEq = mean(win.map((p) => p.v));
  const traded = trades.filter((t) => Date.parse(t.ts) >= from).reduce((a, t) => a + (t.notional ?? t.qty * t.price), 0);
  return avgEq > 0 ? (traded / avgEq) * 100 : null;
}

/* ---------------------------------------------------------------- benchmarks */

const benchCache = new Map<string, { at: number; pts: Pt[] }>();
export async function benchSeries(ticker: string, range: Range): Promise<Pt[]> {
  const [yr, iv] = range === '1D' ? ['1d', '5m'] : range === '1W' ? ['5d', '30m'] : range === '1M' ? ['1mo', '1d'] : range === 'YTD' ? ['ytd', '1d'] : ['5y', '1d'];
  const key = `${ticker}|${yr}|${iv}`;
  const hit = benchCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.pts;
  try {
    const r = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(ticker)}?range=${yr}&interval=${iv}`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const cl: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    const pts = ts.map((t, i) => ({ t: t * 1000, v: cl[i] as number })).filter((p) => p.v != null && Number.isFinite(p.v));
    benchCache.set(key, { at: Date.now(), pts });
    return pts;
  } catch {
    return [];
  }
}

/** Weighted basket index (base 100) from member closes, rebased at the first common timestamp. */
export function basketSeries(members: { pts: Pt[]; w: number }[]): Pt[] {
  const ok = members.filter((m) => m.pts.length > 1);
  if (!ok.length) return [];
  const start = Math.max(...ok.map((m) => m.pts[0].t));
  const grid = ok[0].pts.filter((p) => p.t >= start).map((p) => p.t);
  const wSum = ok.reduce((a, m) => a + m.w, 0);
  return grid.map((t) => {
    let v = 0;
    for (const m of ok) {
      const base = valueAt(m.pts, start)!;
      const cur = valueAt(m.pts, t) ?? base;
      v += (m.w / wSum) * (cur / base);
    }
    return { t, v: v * 100 };
  });
}

export const MOCK_BASKETS_KEY = 'ai-infra-mock-baskets-v1';
export function savedBaskets(): { name: string; ids: string[]; weightMode: 'equal' | 'mcap' }[] {
  try {
    const v = JSON.parse(localStorage.getItem(MOCK_BASKETS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
