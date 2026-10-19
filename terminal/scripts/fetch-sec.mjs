#!/usr/bin/env node
// Build-time SEC snapshot: pulls XBRL companyfacts for every company with a CIK in src/data/companies.ts
// and writes a compact JSON to public/data/sec-financials.json (copied into dist/ by Vite).
//
// Usage: node scripts/fetch-sec.mjs            (skips if snapshot < 24h old)
//        node scripts/fetch-sec.mjs --force    (always refresh)
// Never fails the build: on network errors it keeps the previous snapshot entries.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractFinancials, summarizeSubmissions } from '../src/lib/secExtract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'data', 'sec-financials.json');
const UA = process.env.SEC_UA || 'AI-Infra-Terminal/1.0 contact@example.com';
const force = process.argv.includes('--force');
const MAX_AGE_MS = 24 * 3600 * 1000;

function readCompanies() {
  // Core AI-infra companies + the energy layer (both files list one company object per `{` block).
  const out = [];
  for (const file of ['companies.ts', 'energyCompanies.ts']) {
    const p = path.join(ROOT, 'src', 'data', file);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const block of src.split(/\n\s*\{\s*\n/)) {
      const id = block.match(/\bid:\s*['"]([^'"]+)['"]/)?.[1];
      const cik = block.match(/\bcik:\s*['"](\d+)['"]/)?.[1];
      const ticker = block.match(/\bticker:\s*['"]([^'"]+)['"]/)?.[1];
      if (id && cik && !out.some((o) => o.id === id)) out.push({ id, cik: cik.padStart(10, '0'), ticker });
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* no previous snapshot */
  }
  if (prev && !force && Date.now() - Date.parse(prev.generatedAt) < MAX_AGE_MS) {
    console.log(`[fetch-sec] snapshot is fresh (${prev.generatedAt}); skip (use --force to refresh)`);
    return;
  }
  const list = readCompanies();
  console.log(`[fetch-sec] fetching companyfacts for ${list.length} companies…`);
  const companies = {};
  const filings = {};
  const failures = [];
  for (const c of list) {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const fin = extractFinancials(json);
      companies[c.id] = { id: c.id, ticker: c.ticker, ...fin, fetchedAt: new Date().toISOString(), status: fin.taxonomy ? 'ok' : 'no_xbrl' };
      console.log(`  ✓ ${c.id.padEnd(16)} ${fin.taxonomy || 'no-xbrl'} ${fin.currency || ''} missing=[${fin.missing.join(',')}]`);
    } catch (err) {
      const msg = String(err?.message || err);
      failures.push(`${c.id}: ${msg}`);
      if (prev?.companies?.[c.id]) {
        companies[c.id] = prev.companies[c.id];
        console.log(`  ! ${c.id} failed (${msg}); kept previous snapshot entry`);
      } else {
        companies[c.id] = { id: c.id, ticker: c.ticker, cik: c.cik, status: 'error', error: msg, metrics: {}, missing: [], tagsUsed: {} };
        console.log(`  ✗ ${c.id} failed (${msg})`);
      }
    }
    // Submissions: form counts + recent periodic / IPO documents (used by the Financials filing-history panel).
    try {
      await sleep(160);
      const subRes = await fetch(`https://data.sec.gov/submissions/CIK${c.cik}.json`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (subRes.ok) {
        const sub = await subRes.json();
        filings[c.id] = summarizeSubmissions(sub, c.cik);
      }
    } catch (err) {
      if (prev?.filings?.[c.id]) filings[c.id] = prev.filings[c.id];
    }
    await sleep(160); // stay well under SEC's 10 req/s fair-access limit
  }
  const okCount = Object.values(companies).filter((c) => c.status === 'ok').length;
  if (!okCount && prev) {
    console.log('[fetch-sec] all fetches failed; keeping previous snapshot untouched');
    return;
  }
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'SEC EDGAR XBRL companyfacts (data.sec.gov/api/xbrl/companyfacts) + submissions',
    failures,
    companies,
    filings: { ...(prev?.filings || {}), ...filings },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`[fetch-sec] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${okCount}/${list.length} ok)`);
}

main().catch((err) => {
  console.error('[fetch-sec] unexpected error (build continues):', err);
  process.exit(0);
});
