/**
 * User-added SEC filers ("Added by you — pending full integration") and Grok Bot add requests.
 * Server-backed (GET/POST/DELETE /api/user-companies, /api/grokbot-*) with a localStorage fallback
 * for static hosting / older servers. No numbers are invented: figures come straight from SEC XBRL.
 */
import { extractFinancials, summarizeSubmissions } from '../lib/secExtract.mjs';
import type { Company } from '../types';
import type { CompanyFin, SecFilingSnap } from './secFinancials';
import type { FilingCheck } from './secSearch';

export type RequestStatus = 'sent' | 'queued' | 'failed';

export interface GrokRequest {
  id: string;
  type: 'add_company';
  cik: string;
  ticker: string;
  name: string;
  note?: string | null;
  requestedAt: string;
  status: RequestStatus;
  attempts?: number;
  lastAttemptAt?: string | null;
  httpStatus?: number | null;
  error?: string | null;
  /** Saved in this browser only (server unreachable). */
  local?: boolean;
}

export interface UserCompany {
  cik: string;
  ticker: string;
  name: string;
  addedAt: string;
  updatedAt?: string;
  formalForms?: string[];
  fin: CompanyFin | null;
  filings: SecFilingSnap | null;
  /** Saved in this browser only (server unreachable). */
  local?: boolean;
}

const LS_COMPANIES = 'aiit.userCompanies.v1';
const LS_REQUESTS = 'aiit.grokRequests.v1';

export const userCompanyId = (cik: string) => `user-${cik.replace(/\D/g, '').padStart(10, '0')}`;
export const isUserCompanyId = (id: string) => id.startsWith('user-');

function lsRead<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function lsWrite(key: string, v: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota — ignore */
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  const ct = res.headers.get('content-type') || '';
  // Older servers answer unknown /api routes with index.html — treat that as "endpoint unavailable".
  if (!ct.includes('json')) throw new Error('endpoint unavailable');
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

/* ---------------- reads ---------------- */

export async function fetchUserCompanies(): Promise<{ companies: UserCompany[]; storage: 'server' | 'local' }> {
  const local = lsRead<UserCompany>(LS_COMPANIES).map((c) => ({ ...c, local: true }));
  try {
    const r = await api<{ companies: UserCompany[] }>('/api/user-companies');
    if (!r.ok || !Array.isArray(r.data?.companies)) throw new Error('bad response');
    const server = r.data!.companies;
    const have = new Set(server.map((c) => c.cik));
    // Anything saved locally while the server was unreachable is still shown (and synced on next add).
    return { companies: [...server, ...local.filter((c) => !have.has(c.cik))], storage: 'server' };
  } catch {
    return { companies: local, storage: 'local' };
  }
}

export async function fetchRequests(): Promise<{ requests: GrokRequest[]; configured: boolean | null }> {
  const local = lsRead<GrokRequest>(LS_REQUESTS).map((r) => ({ ...r, local: true }));
  try {
    const r = await api<{ configured: boolean; requests: GrokRequest[] }>('/api/grokbot-request');
    if (!r.ok || !Array.isArray(r.data?.requests)) throw new Error('bad response');
    const have = new Set(r.data!.requests.map((x) => x.cik));
    return { requests: [...r.data!.requests, ...local.filter((x) => !have.has(x.cik))], configured: Boolean(r.data!.configured) };
  } catch {
    return { requests: local, configured: null };
  }
}

export async function fetchGrokStatus(): Promise<boolean | null> {
  try {
    const r = await api<{ configured: boolean }>('/api/grokbot-status');
    return r.ok ? Boolean(r.data?.configured) : null;
  } catch {
    return null;
  }
}

/* ---------------- add / remove ---------------- */

export interface AddInput {
  cik: string;
  ticker: string;
  name: string;
  check: FilingCheck;
  note?: string;
}

/** Pull companyfacts through /api/sec and run the same extractor the build-time snapshot uses. */
export async function pullFinancials(cik: string, ticker: string): Promise<CompanyFin | null> {
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  const res = await fetch(`/api/sec/api/xbrl/companyfacts/CIK${padded}.json`, { signal: AbortSignal.timeout(30000) });
  if (res.status === 404) return null; // filer has no XBRL company facts (e.g. S-1 only, pre-XBRL)
  if (!res.ok) throw new Error(`SEC companyfacts HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('SEC returned non-JSON');
  const fin = extractFinancials(await res.json());
  return {
    id: userCompanyId(padded),
    ticker: ticker || undefined,
    ...fin,
    fetchedAt: new Date().toISOString(),
    status: fin.taxonomy ? 'ok' : 'no_xbrl',
  };
}

/** User-facing add failure (validation / not eligible). */
export class AddError extends Error {}

export async function saveUserCompany(input: AddInput, fin: CompanyFin | null): Promise<UserCompany> {
  const cik = input.cik.replace(/\D/g, '').padStart(10, '0');
  const filings = input.check.sub ? (summarizeSubmissions(input.check.sub, cik) as SecFilingSnap) : null;
  const body = { cik, ticker: input.ticker, name: input.name.slice(0, 200), fin, filings };
  try {
    const r = await api<{ company?: UserCompany; error?: string; field?: string }>('/api/user-companies', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (r.ok && r.data?.company) {
      // Drop any local copy now that the server has it.
      lsWrite(LS_COMPANIES, lsRead<UserCompany>(LS_COMPANIES).filter((c) => c.cik !== cik));
      return r.data.company;
    }
    if (r.status === 422) throw new AddError('No formal financial filings — can’t add');
    if (r.status === 404) throw new AddError('CIK not found on EDGAR');
    if (r.status === 400) throw new AddError(`Invalid input (${r.data?.field || 'request'})`);
    if (r.status === 413) throw new AddError('Financial payload too large to save');
    // 502 (server could not reach SEC to re-verify) or other server trouble → save in this browser instead.
  } catch (err) {
    if (err instanceof AddError) throw err;
  }
  const entry: UserCompany = {
    cik,
    ticker: input.ticker,
    name: input.name.slice(0, 200),
    addedAt: new Date().toISOString(),
    formalForms: input.check.forms,
    fin,
    filings,
    local: true,
  };
  lsWrite(LS_COMPANIES, [...lsRead<UserCompany>(LS_COMPANIES).filter((c) => c.cik !== cik), entry]);
  return entry;
}

export async function removeUserCompany(cik: string): Promise<void> {
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  lsWrite(LS_COMPANIES, lsRead<UserCompany>(LS_COMPANIES).filter((c) => c.cik !== padded));
  try {
    await api(`/api/user-companies/${padded}`, { method: 'DELETE' });
  } catch {
    /* local-only */
  }
}

/* ---------------- Grok Bot requests ---------------- */

export async function sendGrokRequest(input: { cik: string; ticker: string; name: string; note?: string }): Promise<GrokRequest> {
  const cik = input.cik.replace(/\D/g, '').padStart(10, '0');
  const body = {
    type: 'add_company' as const,
    cik,
    ticker: input.ticker,
    name: input.name.slice(0, 200),
    requestedAt: new Date().toISOString(),
    ...(input.note ? { note: input.note.slice(0, 500) } : {}),
  };
  try {
    const r = await api<{ request?: GrokRequest }>('/api/grokbot-request', { method: 'POST', body: JSON.stringify(body) });
    if (r.ok && r.data?.request) {
      lsWrite(LS_REQUESTS, lsRead<GrokRequest>(LS_REQUESTS).filter((x) => x.cik !== cik));
      return r.data.request;
    }
  } catch {
    /* fall back to a local queue */
  }
  const local: GrokRequest = {
    id: `local-${cik}`,
    ...body,
    note: body.note ?? null,
    status: 'queued',
    attempts: 0,
    lastAttemptAt: null,
    httpStatus: null,
    error: 'server_unreachable',
    local: true,
  };
  lsWrite(LS_REQUESTS, [...lsRead<GrokRequest>(LS_REQUESTS).filter((x) => x.cik !== cik), local]);
  return local;
}

export async function retryGrokRequests(cik?: string): Promise<GrokRequest[] | null> {
  // Re-post any browser-only queued requests first, then ask the server to retry its queue.
  for (const r of lsRead<GrokRequest>(LS_REQUESTS)) {
    if (cik && r.cik !== cik) continue;
    await sendGrokRequest({ cik: r.cik, ticker: r.ticker, name: r.name, note: r.note || undefined });
  }
  try {
    const r = await api<{ requests: GrokRequest[] }>('/api/grokbot-request/retry', {
      method: 'POST',
      body: JSON.stringify(cik ? { cik } : {}),
    });
    return r.ok && r.data ? r.data.requests : null;
  } catch {
    return null;
  }
}

/* ---------------- adapter for existing tabs ---------------- */

/** Minimal Company record so the Financials tab can list a user-added filer. Market data is unknown → 0 / N/A. */
export function toCompany(u: UserCompany): Company {
  return {
    id: userCompanyId(u.cik),
    name: u.name,
    ticker: u.ticker || undefined,
    cik: u.cik,
    segment: 'startup',
    marketCapB: 0,
    country: '—',
    summary:
      'Added by you from SEC search — pending full integration (network links, curated notes and market data come with the Grok Bot build). Figures below are pulled straight from SEC XBRL company facts.',
    userAdded: true,
  };
}
