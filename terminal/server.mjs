import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* .env loader (no dependency). serve.py has the identical parser:      */
/*   KEY=VALUE per line, `#` comments, optional `export ` prefix,        */
/*   matching single/double quotes stripped. Real environment variables */
/*   always win over .env. Values are never printed.                     */
/* ------------------------------------------------------------------ */
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, '.env'));

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = (process.env.HOST || '127.0.0.1').trim();
const HOST_IS_LOOPBACK = ['127.0.0.1', '::1', 'localhost'].includes(HOST);

const SEC_UA_PLACEHOLDER = 'AI-Infra-Terminal/1.0 your-email@example.com';
const SEC_UA = (process.env.SEC_USER_AGENT || '').trim() || SEC_UA_PLACEHOLDER;

// Local state files live next to this server (never shipped; see .gitignore).
// NOTE: serve.py implements the same endpoints with identical behaviour — keep them in sync.
const USER_COMPANIES_FILE = path.join(__dirname, 'user-companies.json');
const PENDING_FILE = path.join(__dirname, 'pending-requests.json');
const WEBHOOK_FILE = path.join(__dirname, 'grokbot-webhook.json');
const SEC_CACHE_DIR = path.join(__dirname, '.sec-cache');
const TICKER_FILES = new Set(['/files/company_tickers.json', '/files/company_tickers_exchange.json']);
const TICKER_TTL_MS = 24 * 3600 * 1000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const FORMAL_FORMS = new Set(['10-K', '10-Q', '20-F', '40-F', 'S-1', 'F-1']);

async function proxyFetch(targetUrl, res, extraHeaders = {}) {
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': extraHeaders['User-Agent'] || 'Mozilla/5.0 (compatible; AI-Infra-Terminal/1.0)',
        Accept: '*/*',
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(12000),
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=120');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: 'proxy_failed', message: String(err?.message || err) });
  }
}

app.use('/api/yahoo', async (req, res) => {
  const rest = req.url || '/';
  await proxyFetch('https://query1.finance.yahoo.com' + rest, res);
});

/* ------------------------------------------------------------------ */
/* Google News RSS proxy with a 15-minute in-memory cache.              */
/* Header `X-Refresh: 1` bypasses the cache (manual refresh button).    */
/* On upstream failure a cached copy (≤24h) is served as STALE.         */
/* serve.py implements the identical cache — keep them in sync.         */
/* ------------------------------------------------------------------ */

const NEWS_TTL_MS = 15 * 60 * 1000;
const NEWS_STALE_MS = 24 * 3600 * 1000;
const NEWS_MAX_ENTRIES = 200;
const newsCache = new Map(); // url-rest -> { at, status, body, contentType }

function sendNews(res, entry, state) {
  res.status(entry.status);
  res.setHeader('Content-Type', entry.contentType || 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Cache', state);
  res.setHeader('X-Cache-Age', String(Math.max(0, Math.round((Date.now() - entry.at) / 1000))));
  res.send(entry.body);
}

app.use('/api/news', async (req, res) => {
  const rest = req.url || '/';
  const force = req.get('x-refresh') === '1';
  const hit = newsCache.get(rest);
  if (hit && !force && Date.now() - hit.at < NEWS_TTL_MS) return sendNews(res, hit, 'HIT');
  try {
    const upstream = await fetch('https://news.google.com' + rest, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Infra-Terminal/1.0)', Accept: '*/*' },
      signal: AbortSignal.timeout(12000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const entry = { at: Date.now(), status: upstream.status, body, contentType: upstream.headers.get('content-type') || '' };
    if (upstream.status === 200) {
      newsCache.delete(rest);
      newsCache.set(rest, entry);
      while (newsCache.size > NEWS_MAX_ENTRIES) newsCache.delete(newsCache.keys().next().value);
      return sendNews(res, entry, force ? 'REFRESH' : 'MISS');
    }
    if (hit && Date.now() - hit.at < NEWS_STALE_MS) return sendNews(res, hit, 'STALE');
    return sendNews(res, entry, 'BYPASS');
  } catch (err) {
    if (hit && Date.now() - hit.at < NEWS_STALE_MS) return sendNews(res, hit, 'STALE');
    res.status(502).json({ error: 'proxy_failed', message: String(err?.message || err) });
  }
});

/* ------------------------------------------------------------------ */
/* www.sec.gov proxy (company tickers files cached 24h, memory + disk)  */
/* ------------------------------------------------------------------ */

const tickerMem = new Map(); // path -> { at, body, contentType }

function readTickerDisk(p) {
  try {
    const file = path.join(SEC_CACHE_DIR, path.basename(p));
    const st = fs.statSync(file);
    return { at: st.mtimeMs, body: fs.readFileSync(file), contentType: 'application/json' };
  } catch {
    return null;
  }
}

function sendCached(res, entry, state) {
  res.status(200);
  res.setHeader('Content-Type', entry.contentType || 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Cache', state);
  res.send(entry.body);
}

// Must be registered before /api/sec (express prefix matching is segment-based, but keep the order explicit).
app.use('/api/sec-www', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'method_not_allowed' });
  const rest = req.url || '/';
  const pathname = rest.split('?')[0];
  if (!TICKER_FILES.has(pathname)) {
    return proxyFetch('https://www.sec.gov' + rest, res, { 'User-Agent': SEC_UA });
  }
  let entry = tickerMem.get(pathname) || readTickerDisk(pathname);
  if (entry) tickerMem.set(pathname, entry);
  if (entry && Date.now() - entry.at < TICKER_TTL_MS) return sendCached(res, entry, 'HIT');
  try {
    const upstream = await fetch('https://www.sec.gov' + pathname, {
      headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    const body = Buffer.from(await upstream.arrayBuffer());
    JSON.parse(body.toString('utf8')); // only cache valid JSON
    entry = { at: Date.now(), body, contentType: 'application/json' };
    tickerMem.set(pathname, entry);
    try {
      fs.mkdirSync(SEC_CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(SEC_CACHE_DIR, path.basename(pathname)), body);
    } catch {
      /* disk cache is best-effort */
    }
    return sendCached(res, entry, 'MISS');
  } catch (err) {
    if (entry) return sendCached(res, entry, 'STALE');
    return res.status(502).json({ error: 'proxy_failed', message: String(err?.message || err) });
  }
});

/** SEC data.sec.gov proxy — polite User-Agent required */
app.use('/api/sec', async (req, res) => {
  const rest = req.url || '/';
  // /api/sec/submissions/CIK0001045810.json → https://data.sec.gov/submissions/CIK0001045810.json
  const target = 'https://data.sec.gov' + rest;
  await proxyFetch(target, res, { 'User-Agent': SEC_UA, Accept: 'application/json' });
});

/* ------------------------------------------------------------------ */
/* Local JSON state helpers                                            */
/* ------------------------------------------------------------------ */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Serialise read-modify-write cycles so concurrent requests never clobber each other.
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn, fn);
  lockChain = run.catch(() => {});
  return run;
}

const readList = (file) => {
  const v = readJson(file, []);
  return Array.isArray(v) ? v : [];
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function normCik(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) v = String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  return s.padStart(10, '0');
}

function cleanText(v, max, { required = false } = {}) {
  if (v == null || v === '') return required ? { error: true } : { value: '' };
  if (typeof v !== 'string') return { error: true };
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (required && !s) return { error: true };
  if (s.length > max) return { error: true };
  return { value: s };
}

function cleanTicker(v) {
  const r = cleanText(v, 12);
  if (r.error) return r;
  if (r.value && !/^[A-Za-z0-9.\-]+$/.test(r.value)) return { error: true };
  return { value: r.value.toUpperCase() };
}

function badRequest(res, field) {
  return res.status(400).json({ error: 'invalid_input', field });
}

/** Read a JSON request body with a hard size cap (identical limits in serve.py). */
function readBody(req) {
  return new Promise((resolve) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_BODY_BYTES) return resolve({ error: 'too_large' });
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        resolve({ error: 'too_large' });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      if (!size) return resolve({ value: {} });
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) return resolve({ error: 'invalid_json' });
        resolve({ value: v });
      } catch {
        resolve({ error: 'invalid_json' });
      }
    });
    req.on('error', () => resolve({ error: 'invalid_json' }));
  });
}

async function jsonBody(req, res) {
  const b = await readBody(req);
  if (b.error === 'too_large') {
    res.status(413).json({ error: 'too_large' });
    return null;
  }
  if (b.error) {
    res.status(400).json({ error: 'invalid_json' });
    return null;
  }
  return b.value;
}

/** Verify on EDGAR that the filer has formal periodic / registration filings. */
async function formalFormsFor(cik) {
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) return { notFound: true, forms: [] };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const sub = await r.json();
  const forms = new Set();
  for (const f of sub?.filings?.recent?.form || []) {
    const base = String(f).replace(/\/A$/, '');
    if (FORMAL_FORMS.has(base)) forms.add(base);
  }
  return { forms: [...forms].sort(), name: sub?.name || '' };
}

/* ------------------------------------------------------------------ */
/* /api/user-companies                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/user-companies', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ companies: readList(USER_COMPANIES_FILE) });
});

app.post('/api/user-companies', async (req, res) => {
  const body = await jsonBody(req, res);
  if (!body) return;
  const cik = normCik(body.cik);
  if (!cik) return badRequest(res, 'cik');
  const name = cleanText(body.name, 200, { required: true });
  if (name.error) return badRequest(res, 'name');
  const ticker = cleanTicker(body.ticker);
  if (ticker.error) return badRequest(res, 'ticker');
  const fin = body.fin == null ? null : body.fin;
  if (fin !== null && (typeof fin !== 'object' || Array.isArray(fin))) return badRequest(res, 'fin');
  const filings = body.filings == null ? null : body.filings;
  if (filings !== null && (typeof filings !== 'object' || Array.isArray(filings))) return badRequest(res, 'filings');

  let check;
  try {
    check = await formalFormsFor(cik);
  } catch {
    return res.status(502).json({ error: 'sec_unavailable' });
  }
  if (check.notFound) return res.status(404).json({ error: 'cik_not_found', cik });
  if (!check.forms.length) return res.status(422).json({ error: 'no_formal_filings', cik, forms: [] });

  const out = await withLock(() => {
    const list = readList(USER_COMPANIES_FILE);
    const now = new Date().toISOString();
    const i = list.findIndex((c) => c && c.cik === cik);
    const entry = {
      cik,
      ticker: ticker.value,
      name: name.value,
      addedAt: i >= 0 && list[i].addedAt ? list[i].addedAt : now,
      updatedAt: now,
      formalForms: check.forms,
      fin,
      filings,
    };
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    writeJsonAtomic(USER_COMPANIES_FILE, list);
    return { company: entry, created: i < 0 };
  });
  console.log(`[user-companies] ${out.created ? 'added' : 'updated'} CIK ${cik}`);
  res.json(out);
});

app.delete('/api/user-companies/:cik', async (req, res) => {
  const cik = normCik(req.params.cik);
  if (!cik) return badRequest(res, 'cik');
  const removed = await withLock(() => {
    const list = readList(USER_COMPANIES_FILE);
    const next = list.filter((c) => !(c && c.cik === cik));
    if (next.length !== list.length) writeJsonAtomic(USER_COMPANIES_FILE, next);
    return next.length !== list.length;
  });
  res.json({ removed, cik });
});

/* ------------------------------------------------------------------ */
/* Grok Bot requests                                                   */
/* ------------------------------------------------------------------ */

/**
 * Webhook config: env GROKBOT_WEBHOOK_URL / GROKBOT_WEBHOOK_AUTH first, else grokbot-webhook.json
 * ({ "url": "...", "authorization": "..." }). The authorization value is never logged or returned.
 */
function webhookConfig() {
  const envUrl = (process.env.GROKBOT_WEBHOOK_URL || '').trim();
  if (envUrl) {
    if (!/^https?:\/\//i.test(envUrl)) return null;
    return { url: envUrl, authorization: process.env.GROKBOT_WEBHOOK_AUTH || '' };
  }
  const cfg = readJson(WEBHOOK_FILE, null);
  if (!cfg || typeof cfg !== 'object' || typeof cfg.url !== 'string' || !/^https?:\/\//i.test(cfg.url.trim())) return null;
  return { url: cfg.url.trim(), authorization: typeof cfg.authorization === 'string' ? cfg.authorization : '' };
}

function payloadFor(r) {
  const p = { type: r.type, cik: r.cik, ticker: r.ticker || '', name: r.name, requestedAt: r.requestedAt };
  if (r.note) p.note = r.note;
  return p;
}

/** Try to deliver one request; mutates and returns it with status sent / queued / failed. */
async function deliver(r) {
  const cfg = webhookConfig();
  r.attempts = (r.attempts || 0) + 1;
  r.lastAttemptAt = new Date().toISOString();
  if (!cfg) {
    r.status = 'queued';
    r.httpStatus = null;
    r.error = 'webhook_not_configured';
    return r;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.authorization) headers.Authorization = cfg.authorization;
  try {
    const resp = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payloadFor(r)),
      redirect: 'manual', // never re-send the Authorization header to a redirect target
      signal: AbortSignal.timeout(10000),
    });
    r.httpStatus = resp.status;
    try {
      await resp.arrayBuffer();
    } catch {
      /* ignore body */
    }
    if (resp.status >= 200 && resp.status < 300) {
      r.status = 'sent';
      r.error = null;
    } else {
      r.status = 'failed';
      r.error = 'http_error';
    }
  } catch (err) {
    r.status = 'failed';
    r.httpStatus = null;
    r.error = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network_error';
  }
  console.log(`[grokbot] add_company CIK ${r.cik} -> ${r.status}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}`);
  return r;
}

app.get('/api/grokbot-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ configured: Boolean(webhookConfig()) });
});

app.get('/api/grokbot-request', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ configured: Boolean(webhookConfig()), requests: readList(PENDING_FILE) });
});

app.post('/api/grokbot-request', async (req, res) => {
  const body = await jsonBody(req, res);
  if (!body) return;
  if (body.type !== 'add_company') return badRequest(res, 'type');
  const cik = normCik(body.cik);
  if (!cik) return badRequest(res, 'cik');
  const name = cleanText(body.name, 200, { required: true });
  if (name.error) return badRequest(res, 'name');
  const ticker = cleanTicker(body.ticker);
  if (ticker.error) return badRequest(res, 'ticker');
  const note = cleanText(body.note, 500);
  if (note.error) return badRequest(res, 'note');
  let requestedAt = new Date().toISOString();
  if (body.requestedAt != null) {
    if (typeof body.requestedAt !== 'string' || body.requestedAt.length > 40 || Number.isNaN(Date.parse(body.requestedAt))) {
      return badRequest(res, 'requestedAt');
    }
    requestedAt = new Date(Date.parse(body.requestedAt)).toISOString();
  }

  const out = await withLock(async () => {
    const list = readList(PENDING_FILE);
    const i = list.findIndex((r) => r && r.cik === cik && r.type === 'add_company');
    if (i >= 0 && list[i].status === 'sent') return { request: list[i], deduped: true };
    const r =
      i >= 0
        ? { ...list[i], ticker: ticker.value, name: name.value, note: note.value || null }
        : {
            id: `req-${cik}-${Date.now()}`,
            type: 'add_company',
            cik,
            ticker: ticker.value,
            name: name.value,
            note: note.value || null,
            requestedAt,
            status: 'queued',
            attempts: 0,
            lastAttemptAt: null,
            httpStatus: null,
            error: null,
          };
    await deliver(r);
    if (i >= 0) list[i] = r;
    else list.push(r);
    writeJsonAtomic(PENDING_FILE, list);
    return { request: r, deduped: i >= 0 };
  });
  res.json(out);
});

app.post('/api/grokbot-request/retry', async (req, res) => {
  const body = await jsonBody(req, res);
  if (!body) return;
  let only = null;
  if (body.cik != null) {
    only = normCik(body.cik);
    if (!only) return badRequest(res, 'cik');
  }
  const out = await withLock(async () => {
    const list = readList(PENDING_FILE);
    let retried = 0;
    for (const r of list) {
      if (!r || (r.status !== 'queued' && r.status !== 'failed')) continue;
      if (only && r.cik !== only) continue;
      await deliver(r);
      retried++;
    }
    if (retried) writeJsonAtomic(PENDING_FILE, list);
    return { configured: Boolean(webhookConfig()), retried, requests: list };
  });
  res.json(out);
});

/* ------------------------------------------------------------------ */
/* Trading-bot API (docs/bot-api-contract.md). serve.py is identical.   */
/* Read-only signals published by the dashboard + bot write endpoints. */
/* ------------------------------------------------------------------ */

const SIGNALS_FILE = path.join(__dirname, 'signals-snapshot.json');
const BOT_FILES = {
  trades: path.join(__dirname, 'bot-trades.json'),
  equity: path.join(__dirname, 'bot-equity.json'),
  reports: path.join(__dirname, 'bot-reports.json'),
  backtest: path.join(__dirname, 'bot-backtest.json'),
};
const BOT_TOKEN_FILE = path.join(__dirname, 'bot-token.json');
const BOT_CAPS = { trades: 20000, equity: 50000, reports: 520 };
const SIGNALS_SCHEMA = 'ai-infra-signals/v1';
const SLEEVE_RE = /^[A-E][A-Z0-9_]{0,12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;
const SIDES = new Set(['buy', 'sell', 'short', 'cover']);
const TRADE_STATUS = new Set(['filled', 'partially_filled', 'submitted', 'canceled', 'rejected', 'dry_run']);
const MISSED_KINDS = new Set(['info', 'prediction', 'stat']);

function botToken() {
  const env = (process.env.BOT_TOKEN || '').trim();
  if (env) return env;
  const f = readJson(BOT_TOKEN_FILE, null);
  return f && typeof f.token === 'string' && f.token.trim() ? f.token.trim() : '';
}

// A request relayed by a reverse proxy or tunnel on this machine arrives from 127.0.0.1 but is not local.
const FORWARD_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'];
function remoteIp(req) {
  if (FORWARD_HEADERS.some((h) => req.headers[h] != null)) return 'forwarded';
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';
const isPrivateLan = (ip) =>
  isLoopback(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

function presentedToken(req) {
  const auth = String(req.get('authorization') || '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return String(req.get('x-bot-key') || '').trim();
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/**
 * 'ok' | 'unauthorized' | 'forbidden' | 'bot_token_required'.
 * - BOT_TOKEN configured: it is required (Bearer or X-Bot-Key); the browser's signals publish
 *   (allowLan) may still come token-less from loopback / private LAN.
 * - No token and HOST is loopback: only loopback may write.
 * - No token and HOST is not loopback (LAN / public bind): /api/bot/* writes are refused outright.
 */
function botAuth(req, allowLan = false) {
  const tok = botToken();
  const got = presentedToken(req);
  if (tok) {
    if (got && safeEqual(got, tok)) return 'ok';
    if (!got && allowLan && isPrivateLan(remoteIp(req))) return 'ok';
    return 'unauthorized';
  }
  if (!allowLan && !HOST_IS_LOOPBACK) return 'bot_token_required';
  const ip = remoteIp(req);
  return (allowLan ? isPrivateLan(ip) : isLoopback(ip)) ? 'ok' : 'forbidden';
}

function denyAuth(res, why) {
  return res.status(why === 'unauthorized' ? 401 : 403).json({ error: why });
}

/* -- validators: return [value, null] or [null, fieldPath] (serve.py mirrors each rule) -- */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
function vStr(v, f, max, req = true) {
  if (v == null || v === '') return req ? [null, f] : [null, null, true];
  if (typeof v !== 'string' || v.length > max) return [null, f];
  return [v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim(), null];
}
function optStr(o, out, k, f, max) {
  if (o[k] == null || o[k] === '') return null;
  const [v, e] = vStr(o[k], f + k, max);
  if (e) return e;
  out[k] = v;
  return null;
}
function optNum(o, out, k, f) {
  if (o[k] == null) return null;
  if (!isNum(o[k])) return f + k;
  out[k] = o[k];
  return null;
}
function vSleeve(o, f) {
  if (typeof o.sleeve !== 'string' || !SLEEVE_RE.test(o.sleeve)) return [null, f + 'sleeve'];
  const [label, e] = vStr(o.sleeve_label, f + 'sleeve_label', 60);
  if (e) return [null, e];
  return [{ sleeve: o.sleeve, sleeve_label: label }, null];
}
function vTs(v, f) {
  return typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) ? [new Date(v).toISOString(), null] : [null, f];
}
function vSignals(v, f) {
  if (v == null) return [{}, null];
  if (!isObj(v)) return [null, f];
  const keys = Object.keys(v);
  if (keys.length > 40) return [null, f];
  const out = {};
  for (const k of keys) {
    if (k.length > 60) return [null, f];
    const x = v[k];
    if (x === null || typeof x === 'boolean' || isNum(x)) out[k] = x;
    else if (typeof x === 'string' && x.length <= 200) out[k] = x;
    else return [null, `${f}.${k}`];
  }
  return [out, null];
}

function vTrade(o, f) {
  if (!isObj(o)) return [null, f];
  const p = f ? f + '.' : '';
  const out = {};
  let e;
  [out.id, e] = vStr(o.id, p + 'id', 80);
  if (e) return [null, e];
  [out.ts, e] = vTs(o.ts, p + 'ts');
  if (e) return [null, e];
  if (typeof o.ticker !== 'string' || !TICKER_RE.test(o.ticker)) return [null, p + 'ticker'];
  out.ticker = o.ticker;
  if (!SIDES.has(o.side)) return [null, p + 'side'];
  out.side = o.side;
  if (!isNum(o.qty) || o.qty <= 0) return [null, p + 'qty'];
  out.qty = o.qty;
  if (!isNum(o.price) || o.price <= 0) return [null, p + 'price'];
  out.price = o.price;
  const [sl, se] = vSleeve(o, p);
  if (se) return [null, se];
  Object.assign(out, sl);
  if (!isObj(o.reason)) return [null, p + 'reason'];
  const reason = {};
  [reason.text, e] = vStr(o.reason.text, p + 'reason.text', 4000);
  if (e) return [null, e];
  [reason.signals, e] = vSignals(o.reason.signals, p + 'reason.signals');
  if (e) return [null, e];
  out.reason = reason;
  if (o.status != null) {
    if (!TRADE_STATUS.has(o.status)) return [null, p + 'status'];
    out.status = o.status;
  }
  for (const k of ['notional', 'fee']) if ((e = optNum(o, out, k, p))) return [null, e];
  for (const [k, m] of [['order_id', 80], ['timeframe', 20]]) if ((e = optStr(o, out, k, p, m))) return [null, e];
  if (o.example != null) {
    if (typeof o.example !== 'boolean') return [null, p + 'example'];
    out.example = o.example;
  }
  return [out, null];
}

function vPosition(o, f) {
  if (!isObj(o)) return [null, f];
  const out = {};
  if (typeof o.ticker !== 'string' || !TICKER_RE.test(o.ticker)) return [null, f + '.ticker'];
  out.ticker = o.ticker;
  if (!isNum(o.qty)) return [null, f + '.qty'];
  out.qty = o.qty;
  let e;
  for (const k of ['avg_cost', 'price', 'market_value', 'unrealized_pl']) if ((e = optNum(o, out, k, f + '.'))) return [null, e];
  if (o.hedge != null) {
    if (typeof o.hedge !== 'boolean') return [null, f + '.hedge'];
    out.hedge = o.hedge;
  }
  return [out, null];
}

function vEquity(o, f) {
  if (!isObj(o)) return [null, f];
  const p = f ? f + '.' : '';
  const out = {};
  let e;
  [out.ts, e] = vTs(o.ts, p + 'ts');
  if (e) return [null, e];
  const [sl, se] = vSleeve(o, p);
  if (se) return [null, se];
  Object.assign(out, sl);
  if (!isNum(o.equity) || o.equity < 0) return [null, p + 'equity'];
  out.equity = o.equity;
  if (!isNum(o.cash)) return [null, p + 'cash'];
  out.cash = o.cash;
  if (!Array.isArray(o.positions) || o.positions.length > 500) return [null, p + 'positions'];
  out.positions = [];
  for (let i = 0; i < o.positions.length; i++) {
    const [pos, pe] = vPosition(o.positions[i], `${p}positions[${i}]`);
    if (pe) return [null, pe];
    out.positions.push(pos);
  }
  if (o.example != null) {
    if (typeof o.example !== 'boolean') return [null, p + 'example'];
    out.example = o.example;
  }
  return [out, null];
}

function vStrList(v, f, maxItems, maxLen) {
  if (v == null) return [[], null];
  if (!Array.isArray(v) || v.length > maxItems) return [null, f];
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const [s, e] = vStr(v[i], `${f}[${i}]`, maxLen);
    if (e) return [null, e];
    out.push(s);
  }
  return [out, null];
}

function vReport(o) {
  if (!isObj(o)) return [null, 'body'];
  const out = {};
  let e;
  for (const k of ['week_start', 'week_end']) {
    if (typeof o[k] !== 'string' || !DATE_RE.test(o[k]) || Number.isNaN(Date.parse(o[k]))) return [null, k];
    out[k] = o[k];
  }
  if (out.week_end < out.week_start) return [null, 'week_end'];
  if (!Array.isArray(o.sleeves) || !o.sleeves.length || o.sleeves.length > 20) return [null, 'sleeves'];
  out.sleeves = [];
  for (let i = 0; i < o.sleeves.length; i++) {
    const s = o.sleeves[i];
    const f = `sleeves[${i}]`;
    if (!isObj(s)) return [null, f];
    const [sl, se] = vSleeve(s, f + '.');
    if (se) return [null, se];
    const row = { ...sl };
    if (!isNum(s.return_pct)) return [null, f + '.return_pct'];
    row.return_pct = s.return_pct;
    for (const k of ['start_equity', 'end_equity', 'annualized_pct', 'max_drawdown_pct', 'trades', 'win_rate'])
      if ((e = optNum(s, row, k, f + '.'))) return [null, e];
    out.sleeves.push(row);
  }
  if (!Array.isArray(o.benchmarks) || o.benchmarks.length > 20) return [null, 'benchmarks'];
  out.benchmarks = [];
  for (let i = 0; i < o.benchmarks.length; i++) {
    const b = o.benchmarks[i];
    const f = `benchmarks[${i}]`;
    if (!isObj(b)) return [null, f];
    const [name, ne] = vStr(b.name, f + '.name', 40);
    if (ne) return [null, ne];
    if (!isNum(b.return_pct)) return [null, f + '.return_pct'];
    out.benchmarks.push({ name, return_pct: b.return_pct });
  }
  if (typeof o.target_flag !== 'boolean') return [null, 'target_flag'];
  out.target_flag = o.target_flag;
  if (o.target_annual_pct != null && !isNum(o.target_annual_pct)) return [null, 'target_annual_pct'];
  out.target_annual_pct = o.target_annual_pct ?? 29;
  [out.why, e] = vStr(o.why, 'why', 20000);
  if (e) return [null, e];
  if ((e = optStr(o, out, 'summary', '', 4000))) return [null, e];
  if (!Array.isArray(o.missed) || o.missed.length > 50) return [null, 'missed'];
  out.missed = [];
  for (let i = 0; i < o.missed.length; i++) {
    const m = o.missed[i];
    const f = `missed[${i}]`;
    if (!isObj(m) || !MISSED_KINDS.has(m.kind)) return [null, f + '.kind'];
    const [detail, de] = vStr(m.detail, f + '.detail', 2000);
    if (de) return [null, de];
    out.missed.push({ kind: m.kind, detail });
  }
  [out.paper_vs_real, e] = vStrList(o.paper_vs_real, 'paper_vs_real', 30, 2000);
  if (e) return [null, e];
  if (!out.paper_vs_real.length) return [null, 'paper_vs_real'];
  for (const k of ['went_right', 'went_wrong']) {
    [out[k], e] = vStrList(o[k], k, 30, 2000);
    if (e) return [null, e];
  }
  if (o.example != null) {
    if (typeof o.example !== 'boolean') return [null, 'example'];
    out.example = o.example;
  }
  out.id = `${out.week_start}_${out.week_end}`;
  return [out, null];
}

function vBacktest(o) {
  if (!isObj(o)) return [null, 'body'];
  const out = {};
  let e;
  [out.generated_at, e] = vTs(o.generated_at, 'generated_at');
  if (e) return [null, e];
  if ((e = optStr(o, out, 'universe_note', '', 2000))) return [null, e];
  if ((e = optStr(o, out, 'period', '', 80))) return [null, e];
  if (!Array.isArray(o.rows) || !o.rows.length || o.rows.length > 30) return [null, 'rows'];
  out.rows = [];
  for (let i = 0; i < o.rows.length; i++) {
    const r = o.rows[i];
    const f = `rows[${i}]`;
    if (!isObj(r)) return [null, f];
    const [sl, se] = vSleeve(r, f + '.');
    if (se) return [null, se];
    const row = { ...sl };
    for (const k of ['cagr_pct', 'total_return_pct', 'vol_pct', 'sharpe', 'max_dd_pct', 'hit_rate_pct'])
      if ((e = optNum(r, row, k, f + '.'))) return [null, e];
    if ((e = optStr(r, row, 'note', f + '.', 300))) return [null, e];
    out.rows.push(row);
  }
  [out.newer_names_flagged, e] = vStrList(o.newer_names_flagged, 'newer_names_flagged', 200, 12);
  if (e) return [null, e];
  if (o.example != null) {
    if (typeof o.example !== 'boolean') return [null, 'example'];
    out.example = o.example;
  }
  return [out, null];
}

/** Accept a single record or {<key>: [...]} batch (≤500). */
function batchOf(body, key, validate) {
  const list = Array.isArray(body[key]) ? body[key] : null;
  if (list) {
    if (!list.length || list.length > 500) return [null, key];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const [v, e] = validate(list[i], `${key}[${i}]`);
      if (e) return [null, e];
      out.push(v);
    }
    return [out, null];
  }
  const [v, e] = validate(body, '');
  return e ? [null, e] : [[v], null];
}

function upsert(file, items, keyFn, cap, sortKey) {
  const list = readList(file);
  const idx = new Map(list.map((x, i) => [keyFn(x), i]));
  let added = 0;
  for (const it of items) {
    const k = keyFn(it);
    if (idx.has(k)) list[idx.get(k)] = it;
    else {
      idx.set(k, list.length);
      list.push(it);
      added++;
    }
  }
  list.sort((a, b) => { const x = String(a[sortKey]); const y = String(b[sortKey]); return x < y ? -1 : x > y ? 1 : 0; });
  const kept = list.length > cap ? list.slice(list.length - cap) : list;
  writeJsonAtomic(file, kept);
  return { added, updated: items.length - added, total: kept.length };
}

function filterQuery(list, q) {
  let out = list;
  if (typeof q.sleeve === 'string' && q.sleeve) {
    const want = new Set(q.sleeve.split(','));
    out = out.filter((x) => want.has(x.sleeve) || (Array.isArray(x.sleeves) && x.sleeves.some((s) => want.has(s.sleeve))));
  }
  if (typeof q.since === 'string' && q.since) {
    const t = Date.parse(q.since);
    if (!Number.isNaN(t)) out = out.filter((x) => Date.parse(x.ts || x.week_end) >= t);
  }
  const lim = Number.parseInt(String(q.limit ?? ''), 10);
  if (Number.isFinite(lim) && lim > 0) out = out.slice(Math.max(0, out.length - lim));
  return out;
}

function sendSnapshotPart(res, part) {
  res.setHeader('Cache-Control', 'no-store');
  const snap = readJson(SIGNALS_FILE, null);
  if (!snap || !isObj(snap[part])) {
    return res.status(503).json({ error: 'no_snapshot', hint: 'Open the terminal in a browser once; it publishes signals after quotes and news load.' });
  }
  const age = Math.max(0, Math.round((Date.now() - Date.parse(snap.received_at)) / 1000));
  res.json({ ...snap[part], received_at: snap.received_at, age_seconds: age, stale: age > 3600 });
}

app.get('/api/signals', (_req, res) => sendSnapshotPart(res, 'signals'));
app.get('/api/news-feed', (_req, res) => sendSnapshotPart(res, 'newsFeed'));
app.get('/api/mock-index', (_req, res) => sendSnapshotPart(res, 'mockIndex'));

app.post('/api/signals-snapshot', async (req, res) => {
  const why = botAuth(req, true);
  if (why !== 'ok') return denyAuth(res, why);
  const body = await jsonBody(req, res);
  if (!body) return;
  for (const k of ['signals', 'newsFeed', 'mockIndex']) {
    if (!isObj(body[k]) || body[k].schema !== SIGNALS_SCHEMA) return badRequest(res, k);
  }
  if (!Array.isArray(body.signals.companies)) return badRequest(res, 'signals.companies');
  await withLock(() =>
    writeJsonAtomic(SIGNALS_FILE, { received_at: new Date().toISOString(), signals: body.signals, newsFeed: body.newsFeed, mockIndex: body.mockIndex })
  );
  res.json({ ok: true });
});

app.get('/api/bot/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const last = (file, k) => {
    const l = readList(file);
    return { count: l.length, last: l.length ? l[l.length - 1][k] : null };
  };
  const snap = readJson(SIGNALS_FILE, null);
  res.json({
    token_configured: !!botToken(),
    trades: last(BOT_FILES.trades, 'ts'),
    equity: last(BOT_FILES.equity, 'ts'),
    reports: last(BOT_FILES.reports, 'week_end'),
    backtest: !!readJson(BOT_FILES.backtest, null),
    signals_received_at: snap?.received_at ?? null,
  });
});

const BOT_KINDS = {
  trades: { file: BOT_FILES.trades, key: 'trades', v: vTrade, id: (x) => x.id, sort: 'ts', cap: BOT_CAPS.trades },
  equity: { file: BOT_FILES.equity, key: 'equity', v: vEquity, id: (x) => `${x.sleeve}|${x.ts}`, sort: 'ts', cap: BOT_CAPS.equity },
  'weekly-report': { file: BOT_FILES.reports, key: 'reports', v: (o) => vReport(o), id: (x) => x.id, sort: 'week_end', cap: BOT_CAPS.reports },
};

for (const [name, k] of Object.entries(BOT_KINDS)) {
  app.get(`/api/bot/${name}`, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ [k.key]: filterQuery(readList(k.file), req.query) });
  });
  app.post(`/api/bot/${name}`, async (req, res) => {
    const why = botAuth(req);
    if (why !== 'ok') return denyAuth(res, why);
    const body = await jsonBody(req, res);
    if (!body) return;
    const [items, err] = name === 'weekly-report' ? (() => { const [v, e] = vReport(body); return e ? [null, e] : [[v], null]; })() : batchOf(body, k.key, k.v);
    if (err) return badRequest(res, err || 'body');
    const r = await withLock(() => upsert(k.file, items, k.id, k.cap, k.sort));
    res.json({ ok: true, ...r });
  });
}

app.get('/api/bot/backtest', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ backtest: readJson(BOT_FILES.backtest, null) });
});
app.post('/api/bot/backtest', async (req, res) => {
  const why = botAuth(req);
  if (why !== 'ok') return denyAuth(res, why);
  const body = await jsonBody(req, res);
  if (!body) return;
  const [v, e] = vBacktest(body);
  if (e) return badRequest(res, e);
  await withLock(() => writeJsonAtomic(BOT_FILES.backtest, v));
  res.json({ ok: true });
});

// Unknown API routes → JSON 404 (never fall through to index.html).
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`AI Infra Terminal listening on http://${HOST}:${PORT}`);
  console.log(`Local URL: http://127.0.0.1:${PORT}`);
  console.log(`Grok Bot link: ${webhookConfig() ? 'configured' : 'not configured (requests queue in pending-requests.json)'}`);
  console.log(`Bot writes (/api/bot/*): ${botToken() ? 'BOT_TOKEN required' : HOST_IS_LOOPBACK ? 'loopback only (no BOT_TOKEN set)' : 'DISABLED until BOT_TOKEN is set (HOST is not loopback)'}`);
  if (SEC_UA === SEC_UA_PLACEHOLDER) console.warn('WARNING: SEC_USER_AGENT is not set; SEC asks for a real contact. Set it as an environment variable or in .env (see README).');
});
