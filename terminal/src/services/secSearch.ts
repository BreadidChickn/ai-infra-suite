import { SEGMENT_LABELS } from '../data/constants';
/**
 * SEC company lookup for the global Search: the public EDGAR ticker files (via the local /api/sec-www proxy,
 * cached 24h server-side) plus a per-CIK "formal filings" check against data.sec.gov submissions.
 */
import { formalFilingForms } from '../lib/secExtract.mjs';
import type { Company } from '../types';
import { SEARCH_ALIASES } from '../data/searchAliases';

export interface SecTickerRow {
  cik: string; // 10-digit, zero-padded
  name: string;
  tickers: string[];
  exchange?: string;
}

let tickersPromise: Promise<SecTickerRow[]> | null = null;

async function getJson(url: string, timeoutMs = 25000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('non-JSON response');
  return res.json();
}

const pad = (n: number | string) => String(n).replace(/\D/g, '').padStart(10, '0');

/** Load + normalise SEC's ticker list (one row per CIK; multiple share classes merged). */
export function loadSecTickers(): Promise<SecTickerRow[]> {
  if (!tickersPromise) {
    tickersPromise = (async () => {
      const byCik = new Map<string, SecTickerRow>();
      const push = (cik: number | string, name: string, ticker: string, exchange?: string) => {
        const k = pad(cik);
        const row = byCik.get(k);
        if (row) {
          if (ticker && !row.tickers.includes(ticker)) row.tickers.push(ticker);
          if (!row.exchange && exchange) row.exchange = exchange;
        } else {
          byCik.set(k, { cik: k, name: String(name || ''), tickers: ticker ? [ticker] : [], exchange: exchange || undefined });
        }
      };
      try {
        const j = (await getJson('/api/sec-www/files/company_tickers_exchange.json')) as { fields: string[]; data: unknown[][] };
        const fi = (f: string) => j.fields.indexOf(f);
        const [ci, ni, ti, ei] = [fi('cik'), fi('name'), fi('ticker'), fi('exchange')];
        for (const r of j.data) push(r[ci] as number, r[ni] as string, String(r[ti] ?? ''), r[ei] ? String(r[ei]) : undefined);
      } catch {
        const j = (await getJson('/api/sec-www/files/company_tickers.json')) as Record<string, { cik_str: number; ticker: string; title: string }>;
        for (const r of Object.values(j)) push(r.cik_str, r.title, r.ticker);
      }
      return [...byCik.values()];
    })();
    tickersPromise.catch(() => {
      tickersPromise = null; // allow a retry after a network failure
    });
  }
  return tickersPromise;
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Rank text against a query: exact > prefix > word-prefix > contains. */
function scoreText(text: string, q: string): number {
  const t = norm(text);
  if (!t || !q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(' ').some((w) => w.startsWith(q))) return 65;
  if (q.length >= 3 && t.includes(q)) return 45;
  // multi-word query: every word must prefix-match some word of the text
  const qw = q.split(' ');
  if (qw.length > 1) {
    const tw = t.split(' ');
    if (qw.every((w) => tw.some((x) => x.startsWith(w)))) return 60;
  }
  return 0;
}

function scoreTicker(ticker: string | undefined, q: string): number {
  if (!ticker) return 0;
  const t = norm(ticker).replace(/ /g, '');
  const qq = q.replace(/ /g, '');
  if (!qq) return 0;
  if (t === qq) return 120;
  if (t.startsWith(qq)) return 75;
  return 0;
}

export interface IndexedHit {
  company: Company;
  score: number;
  why: string;
}

/** Companies already in the terminal (name, ticker, short code, id, aliases, CIK). */
export function searchIndexed(companies: Company[], query: string, limit = 8): IndexedHit[] {
  const q = norm(query);
  const digits = query.replace(/\D/g, '');
  if (!q) return [];
  const hits: IndexedHit[] = [];
  for (const c of companies) {
    let best = 0;
    let why = '';
    const consider = (s: number, w: string) => {
      if (s > best) {
        best = s;
        why = w;
      }
    };
    consider(scoreTicker(c.ticker, q), 'ticker');
    consider(scoreTicker(c.shortCode, q) - 2, 'code');
    consider(scoreText(c.name, q), 'name');
    consider(scoreText(c.id, q) - 5, 'id');
    for (const a of SEARCH_ALIASES[c.id] || []) consider(scoreText(a, q) - 8, `alias “${a}”`);
    if (q.length >= 4) consider(scoreText(SEGMENT_LABELS[c.segment] || '', q) - 15, `segment “${SEGMENT_LABELS[c.segment]}”`);
    if (digits.length >= 4 && c.cik && pad(c.cik).includes(digits.padStart(Math.min(10, digits.length), '0'))) {
      consider(pad(c.cik) === pad(digits) ? 110 : 50, 'CIK');
    }
    if (best > 0) hits.push({ company: c, score: best + Math.min(5, Math.log10(1 + (c.marketCapB || 0))), why });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface SecHit {
  row: SecTickerRow;
  score: number;
}

/** All SEC filers with a ticker, excluding CIKs already indexed. */
export function searchSecRows(rows: SecTickerRow[], query: string, excludeCiks: Set<string>, limit = 8): SecHit[] {
  const q = norm(query);
  if (!q) return [];
  const digits = query.trim().replace(/^cik/i, '').trim();
  const isCik = /^\d{3,10}$/.test(digits);
  const out: SecHit[] = [];
  for (const row of rows) {
    if (excludeCiks.has(row.cik)) continue;
    let s = 0;
    if (isCik) {
      if (row.cik === pad(digits)) s = 130;
      else if (row.cik.replace(/^0+/, '').startsWith(digits.replace(/^0+/, ''))) s = 40;
    }
    for (const t of row.tickers) s = Math.max(s, scoreTicker(t, q));
    s = Math.max(s, scoreText(row.name, q));
    if (s > 0) out.push({ row, score: s });
  }
  return out.sort((a, b) => b.score - a.score || a.row.name.length - b.row.name.length).slice(0, limit);
}

/* ---------------- formal-filings check ---------------- */

export type FilingCheckStatus = 'ok' | 'none' | 'notfound' | 'error';

export interface FilingCheck {
  status: FilingCheckStatus;
  cik: string;
  forms: string[];
  formCounts: Record<string, number>;
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  sub?: unknown;
  error?: string;
}

const checkCache = new Map<string, Promise<FilingCheck>>();

/** Verify on EDGAR that a filer has 10-K / 10-Q / 20-F / 40-F / S-1 / F-1 filings (amendments count). */
export function checkFormalFilings(cikIn: string): Promise<FilingCheck> {
  const cik = pad(cikIn);
  const hit = checkCache.get(cik);
  if (hit) return hit;
  const p = (async (): Promise<FilingCheck> => {
    try {
      const res = await fetch(`/api/sec/submissions/CIK${cik}.json`, { signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return { status: 'notfound', cik, forms: [], formCounts: {} };
      if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('SEC returned non-JSON');
      const sub = (await res.json()) as {
        name?: string;
        tickers?: string[];
        exchanges?: string[];
        filings?: { recent?: { form?: string[] } };
      };
      const forms = formalFilingForms(sub);
      const formCounts: Record<string, number> = {};
      for (const f of sub.filings?.recent?.form || []) {
        const base = String(f).replace(/\/A$/, '');
        if (forms.includes(base)) formCounts[base] = (formCounts[base] || 0) + 1;
      }
      return {
        status: forms.length ? 'ok' : 'none',
        cik,
        forms,
        formCounts,
        name: sub.name,
        tickers: sub.tickers,
        exchanges: sub.exchanges,
        sub,
      };
    } catch (err) {
      checkCache.delete(cik); // transient — allow retry
      return { status: 'error', cik, forms: [], formCounts: {}, error: String((err as Error)?.message || err) };
    }
  })();
  checkCache.set(cik, p);
  return p;
}
