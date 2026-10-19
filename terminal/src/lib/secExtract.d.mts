export interface FinPoint {
  start: string;
  end: string;
  val: number;
  form: string;
  accn: string;
  filed: string;
  tag: string;
  /** ytd-diff = quarter derived from YTD differences; sum = composite of tags; calc = arithmetic derivation */
  derived?: 'ytd-diff' | 'sum' | 'calc';
  /** Months covered by a year-to-date point (6 or 9) */
  ytdMonths?: number;
}

export interface FinSeries {
  annual: FinPoint[];
  quarterly: FinPoint[];
  /** Year-to-date (6M/9M) totals — only present when no discrete quarters exist (e.g. first 10-Q after an IPO) */
  ytd?: FinPoint[];
}

export type MetricKey =
  | 'revenue'
  | 'revenueProducts'
  | 'revenueServices'
  | 'costOfRevenue'
  | 'rnd'
  | 'sga'
  | 'opex'
  | 'operatingIncome'
  | 'netIncome'
  | 'grossProfit'
  | 'ocf'
  | 'capex'
  | 'acquisitions'
  | 'investPurchases'
  | 'investProceeds'
  | 'buybacks'
  | 'dividends'
  | 'debtIssued'
  | 'debtRepaid'
  | 'sbc'
  | 'dilutedShares'
  | 'fcf';

export interface ExtractedFinancials {
  entityName: string;
  cik: string;
  taxonomy: 'us-gaap' | 'ifrs-full' | null;
  currency: string | null;
  metrics: Partial<Record<MetricKey, FinSeries>>;
  missing: MetricKey[];
  tagsUsed: Partial<Record<MetricKey, string[]>>;
  stale?: { key: MetricKey; latest: string; tags?: string[] }[];
}

export const METRIC_DEFS: Record<string, Record<string, { tags: string[]; sum?: string[][]; additive?: boolean; unit?: string }>>;
export const METRIC_KEYS: MetricKey[];
export function extractFinancials(
  json: unknown,
  opts?: { maxAnnual?: number; maxQuarterly?: number }
): ExtractedFinancials;
export function filingIndexUrl(cik: string, accn: string): string;

export interface FilingSummary {
  formCounts: Record<string, number>;
  recent: { form: string; filed: string; accn: string; desc?: string; url: string }[];
  fetchedAt: string;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
}
export const FORMAL_FORMS: string[];
export function formalFilingForms(sub: unknown): string[];
export function summarizeSubmissions(sub: unknown, cik: string, maxRecent?: number): FilingSummary;
