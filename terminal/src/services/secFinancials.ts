import {
  extractFinancials,
  filingIndexUrl,
  type ExtractedFinancials,
  type FinPoint,
  type MetricKey,
} from '../lib/secExtract.mjs';

export type { ExtractedFinancials, FinPoint, MetricKey };
export type FinSource = 'live' | 'snapshot' | 'illustrative';
export type PeriodMode = 'quarterly' | 'annual';

export interface CompanyFin extends ExtractedFinancials {
  id: string;
  ticker?: string;
  fetchedAt?: string;
  status?: 'ok' | 'no_xbrl' | 'error';
  error?: string;
}

export interface SecFilingSnap {
  formCounts?: Record<string, number>;
  recent?: { form: string; filed: string; accn: string; desc?: string; url: string }[];
  fetchedAt?: string;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
}

export interface SecSnapshot {
  generatedAt: string;
  source: string;
  failures?: string[];
  companies: Record<string, CompanyFin>;
  filings?: Record<string, SecFilingSnap>;
}

let snapshotPromise: Promise<SecSnapshot | null> | null = null;

export function loadSecSnapshot(): Promise<SecSnapshot | null> {
  if (!snapshotPromise) {
    snapshotPromise = fetch(`${import.meta.env.BASE_URL}data/sec-financials.json`)
      .then((r) => (r.ok ? (r.json() as Promise<SecSnapshot>) : null))
      .catch(() => null);
  }
  return snapshotPromise;
}

const liveCache = new Map<string, CompanyFin>();

/** Live refresh straight from SEC companyfacts through the local /api/sec proxy. */
export async function fetchLiveFinancials(id: string, cik: string, ticker?: string): Promise<CompanyFin> {
  const cached = liveCache.get(id);
  if (cached) return cached;
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  const res = await fetch(`/api/sec/api/xbrl/companyfacts/CIK${padded}.json`, {
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('SEC returned non-JSON');
  const json = await res.json();
  const fin = extractFinancials(json);
  const out: CompanyFin = {
    id,
    ticker,
    ...fin,
    fetchedAt: new Date().toISOString(),
    status: fin.taxonomy ? 'ok' : 'no_xbrl',
  };
  liveCache.set(id, out);
  return out;
}

export { filingIndexUrl };

/* ---------------- period helpers ---------------- */

const DAY = 86400000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export function series(fin: CompanyFin | null | undefined, key: MetricKey, mode: PeriodMode): FinPoint[] {
  return fin?.metrics?.[key]?.[mode] ?? [];
}

/** Period ends available for the mode (driven by revenue, falling back to net income / OCF). */
export function periodEnds(fin: CompanyFin | null | undefined, mode: PeriodMode): string[] {
  for (const k of ['revenue', 'netIncome', 'ocf'] as MetricKey[]) {
    const s = series(fin, k, mode);
    if (s.length) return s.map((p) => p.end);
  }
  return [];
}

export function pointAt(fin: CompanyFin | null | undefined, key: MetricKey, mode: PeriodMode, end?: string): FinPoint | undefined {
  if (!end) return undefined;
  return series(fin, key, mode).find((p) => Math.abs(daysBetween(p.end, end)) <= 7);
}

/** Previous sequential period end (QoQ for quarterly, YoY for annual). Returns undefined across gaps
 *  (e.g. a newly public filer with Q1–Q2 of two years but no Q3/Q4) so QoQ never compares non-adjacent periods. */
export function prevEnd(ends: string[], end: string): string | undefined {
  const i = ends.indexOf(end);
  if (i <= 0) return undefined;
  const prev = ends[i - 1]!;
  const gap = daysBetween(prev, end);
  // quarterly ≈ 91 days, annual ≈ 365 days — anything far beyond the series' own cadence is a gap
  const cadence = ends.length >= 2 ? Math.min(...ends.slice(1).map((e, k) => daysBetween(ends[k]!, e))) : gap;
  return gap > cadence * 1.6 ? undefined : prev;
}

/** Same period one year earlier (±25 days). */
export function yearAgoEnd(ends: string[], end: string): string | undefined {
  return ends.find((e) => {
    const d = daysBetween(e, end);
    return d >= 340 && d <= 390;
  });
}

export interface Delta {
  abs: number;
  pct: number | null;
}

export function delta(cur?: number, prev?: number): Delta | null {
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  const pct = prev !== 0 ? (abs / Math.abs(prev)) * 100 : null;
  return { abs, pct };
}

function fyLabelFromEnd(end: string): string {
  const d = new Date(end + 'T00:00:00Z');
  let y = d.getUTCFullYear();
  if (d.getUTCMonth() === 0 && d.getUTCDate() <= 7) y -= 1; // 52/53-week years ending first days of January
  return `FY${String(y).slice(-2)}`;
}

/** Human label: annual → FY26; quarterly → Q2 FY27 (fiscal, inferred from annual period ends). */
export function periodLabel(fin: CompanyFin | null | undefined, mode: PeriodMode, end: string): string {
  if (mode === 'annual') return fyLabelFromEnd(end);
  const annualEnds = periodEnds(fin, 'annual');
  // Fiscal year containing this quarter: the first annual end ≥ quarter end (within a year), else extrapolate.
  const containing = annualEnds.find((a) => {
    const d = daysBetween(end, a);
    return d >= -7 && d < 358;
  });
  let fyEnd: string | undefined = containing;
  if (!fyEnd) {
    const prior = [...annualEnds].reverse().find((a) => daysBetween(a, end) > 0);
    if (prior) {
      const n = Math.max(1, Math.round(daysBetween(prior, end) / 365.25));
      const d = new Date(prior + 'T00:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() + n);
      fyEnd = d.toISOString().slice(0, 10);
    }
  }
  if (!fyEnd) {
    // No annual filing yet (e.g. first 10-Q after an IPO): label by calendar quarter.
    const d = new Date(end + 'T00:00:00Z');
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} CY${String(d.getUTCFullYear()).slice(-2)}`;
  }
  const monthsLeft = daysBetween(end, fyEnd) / 30.44;
  const q = Math.min(4, Math.max(1, 4 - Math.round(monthsLeft / 3)));
  return `Q${q} ${fyLabelFromEnd(fyEnd)}`;
}

export function shortDate(end: string): string {
  return new Date(end + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/** Trailing-twelve-month sum ending at `end` (needs 4 consecutive quarters). */
export function ttm(fin: CompanyFin | null | undefined, key: MetricKey, end: string): number | undefined {
  const s = series(fin, key, 'quarterly');
  const i = s.findIndex((p) => Math.abs(daysBetween(p.end, end)) <= 7);
  if (i < 3) return undefined;
  const four = s.slice(i - 3, i + 1);
  const span = daysBetween(four[0]!.end, four[3]!.end);
  if (span < 250 || span > 300) return undefined;
  return four.reduce((a, p) => a + p.val, 0);
}

/** Value for analysis windows: annual point, or TTM in quarterly mode. */
export function windowVal(fin: CompanyFin | null | undefined, key: MetricKey, mode: PeriodMode, end?: string): number | undefined {
  if (!end) return undefined;
  if (mode === 'annual') return pointAt(fin, key, 'annual', end)?.val;
  return ttm(fin, key, end);
}

/* ---------------- formatting ---------------- */

const CUR_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', TWD: 'NT$', JPY: '¥', KRW: '₩', GBP: '£' };

export function fmtMoney(v: number | undefined | null, currency?: string | null): string {
  if (v == null || Number.isNaN(v)) return 'N/A';
  const sym = CUR_SYMBOL[currency || 'USD'] ?? `${currency} `;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e12) return `${sign}${sym}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${sym}${(a / 1e9).toFixed(a >= 1e11 ? 0 : a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${sym}${a.toFixed(0)}`;
}

export function fmtShares(v: number | undefined | null): string {
  if (v == null) return 'N/A';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B sh`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M sh`;
  return `${v.toFixed(0)} sh`;
}

export function fmtDeltaPct(p: number | null | undefined, digits = 1): string {
  if (p == null || Number.isNaN(p)) return 'N/A';
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(digits)}%`;
}

export function fmtPp(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return 'N/A';
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)} pp`;
}

/** Chart-scale helper (values in billions/millions of reporting currency). */
export function scaleFor(maxAbs: number): { div: number; unit: string } {
  if (maxAbs >= 1e12) return { div: 1e12, unit: 'T' };
  if (maxAbs >= 1e9) return { div: 1e9, unit: 'B' };
  if (maxAbs >= 1e6) return { div: 1e6, unit: 'M' };
  return { div: 1, unit: '' };
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: 'Total revenue',
  revenueProducts: 'Product revenue',
  revenueServices: 'Service revenue',
  costOfRevenue: 'Cost of revenue',
  rnd: 'R&D',
  sga: 'SG&A',
  opex: 'Total operating expenses',
  operatingIncome: 'Operating income',
  netIncome: 'Net income',
  grossProfit: 'Gross profit',
  ocf: 'Operating cash flow',
  capex: 'Capex (PP&E purchases)',
  acquisitions: 'Acquisitions (net of cash)',
  investPurchases: 'Investment purchases',
  investProceeds: 'Investment sales / maturities',
  buybacks: 'Share buybacks',
  dividends: 'Dividends paid',
  debtIssued: 'Debt issued',
  debtRepaid: 'Debt repaid',
  sbc: 'Stock-based comp',
  dilutedShares: 'Diluted shares (avg)',
  fcf: 'Free cash flow',
};
