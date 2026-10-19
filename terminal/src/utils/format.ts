import type { Company } from '../types';

export function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(digits)}%`;
}

export function pctClass(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return 'flat';
  if (n > 0.05) return 'up';
  if (n < -0.05) return 'down';
  return 'flat';
}

export function pnlColor(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '#8fa3c4';
  if (n > 0.05) return '#00e676';
  if (n < -0.05) return '#ef5350';
  return '#8fa3c4';
}

export function displayCode(c: Pick<Company, 'ticker' | 'shortCode' | 'name'>): string {
  if (c.shortCode) return c.shortCode;
  if (c.ticker) {
    const t = c.ticker.includes('.') ? c.ticker.split('.')[0]! : c.ticker;
    return t.slice(0, 6).toUpperCase();
  }
  return c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
}

export function padCik(cik: string): string {
  return cik.replace(/\D/g, '').padStart(10, '0');
}

export function edgarBrowseUrl(cik: string, type = '10-K'): string {
  const raw = cik.replace(/\D/g, '');
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${raw}&type=${encodeURIComponent(type)}&dateb=&owner=include&count=10`;
}

export function edgarSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

export function fmtUsdM(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}B`;
  return `$${n.toLocaleString()}M`;
}
