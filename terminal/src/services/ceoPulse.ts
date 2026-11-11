/**
 * CEO Pulse — live news sentiment about the CEOs of AI-infrastructure companies.
 *
 * Display-only context: NOT part of the composite score and NOT used by the trader.
 *
 * Pipeline (all client-side, reusing the News refresher):
 *   one Google News RSS query per CEO via the existing /api/news proxy (server 15-min cache, X-Refresh on force)
 *   → parseRss → relevance filter (must name the CEO AND relate to their company) → dedupe → enrich
 *   (same lexicon sentiment, source quality, category) → event tags → per-CEO score.
 *
 * Score  = round(100 × Σ(wᵢ·sᵢ) / Σwᵢ) over the last 30 days, wᵢ = sentimentWeight (quality × recency × coverage),
 *          identical to Theme Scores. Fewer than MIN_CEO_HEADLINES headlines → null ("not enough coverage").
 *          No seed numbers, no invented headlines, no volume baseline (there is no history yet).
 */
import type { Company, Relationship } from '../types';
import { CEOS, type CeoEntry } from '../data/ceos';
import { dedupe, enrich, parseRss, pool, sentimentWeight, tagCompanies, type NewsItem, type RawNews } from './newsFeed';
import type { BotEquity, BotTrade, TraderData } from './trader';

export const MIN_CEO_HEADLINES = 2;
export const CEO_TTL_MS = 15 * 60 * 1000;
export const CEO_CONCURRENCY = 4;
const WINDOW_MS = 30 * 24 * 3600 * 1000;
const LS_KEY = 'ai-infra:ceo-pulse:v1';
const MAX_PER_CEO = 40;

/* ------------------------------------------------------------------ */
/* Queries + relevance                                                 */
/* ------------------------------------------------------------------ */

export const ceoKey = (c: CeoEntry) => `${c.companyId}:${c.name}`;
export const ceoQuery = (c: CeoEntry) => `"${c.name}"${c.queryHint ? ` ${c.queryHint}` : ''} when:30d`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Full name, case-insensitive; dots / hyphens optional ("C.C. Wei" ~ "CC Wei", "Lip-Bu" ~ "Lip Bu"). */
function fullNameRe(name: string): RegExp {
  const body = esc(name).replace(/\\\./g, '\\.?').replace(/\\?-/g, '[- ]?').replace(/ +/g, '\\s*');
  return new RegExp(`(^|[^A-Za-z])${body}($|[^A-Za-z])`, 'i');
}
/** AI / tech / energy context accepted with the full name when the company itself isn't named. */
const CONTEXT = /\b(ai|a\.i\.|artificial intelligence|chips?|semiconductors?|gpus?|data cent(er|re)s?|cloud|compute|tech|software|nuclear|power|energy|grid|electric\w*|utility|utilities|gas|pipeline|reactor|stocks?|shares|ipo|earnings|investors?)\b/i;
/** For distinctive names (no queryHint) the CEO role itself is enough context. */
const ROLE = /\b(ceo|chief executive|founder|chairman|chair)\b/i;
/** Spam / namesake noise dropped outright (crypto price bait using famous names). */
const NOISE = /\b(btc|bitcoin|crypto\w*|memecoin|price prediction|token presale|xrp|dogecoin)\b/i;

export function ceoMatch(c: CeoEntry, title: string, companies: Company[]): string | null {
  if (NOISE.test(title)) return null;
  const ids = [c.companyId, ...(c.alsoIds ?? [])];
  const tagged = tagCompanies(title, companies).filter((id) => ids.includes(id));
  const full = fullNameRe(c.name).test(title);
  const alias = (c.aliases ?? []).some((a) => new RegExp(`\\b${esc(a)}\\b`).test(title));
  if (tagged.length && (full || alias)) return tagged[0];
  if (full && (CONTEXT.test(title) || (!c.queryHint && ROLE.test(title)))) return c.companyId;
  return null;
}

/* ------------------------------------------------------------------ */
/* Event tags (from headline text only)                                */
/* ------------------------------------------------------------------ */

export type CeoEventTag =
  | 'departure' | 'succession' | 'health' | 'investigation' | 'controversy' | 'insider selling'
  | 'political' | 'deal' | 'product' | 'earnings';

export const EVENT_RULES: [CeoEventTag, RegExp][] = [
  // Departure is about the leader: generic "exit scheme", "retiree" or "staff quit" do not count.
  ['departure', /\b(steps? down|stepping down|step aside|steps aside|resign(s|ed|ing|ation)?|ousted|ouster|oust(s|ing)?|fired as|(to|will|plans to) (retire|leave|exit)|retire(s|d)? as|retirement|leaves (the )?(company|role|post|board)|quits as|exit as|exits as|departure|replaced as)\b/i],
  ['succession', /\b(successor|succession|succeeds?|succeeding|next ceo|new ceo|interim ceo|to become ceo|names? .{0,30}\bceo\b|heir apparent)\b/i],
  ['health', /\b(health|medical|illness|hospital\w*|surgery|cancer|diagnos\w*|leave of absence|sick)\b/i],
  ['investigation', /\b(probes?|investigat\w*|inquiry|subpoena\w*|indict\w*|charged|whistleblower|fbi|\bsec\b charges|counterintelligence|review of)\b/i],
  ['controversy', /\b(scandal|affair|spy|spies|espionage|allegations?|alleged|accus\w*|misconduct|apolog\w*|backlash|controvers\w*|criticism|critics|under fire|embattled|scrutiny|crisis)\b/i],
  ['insider selling', /\b(sells? (\$?[\d.]+\s?(m|b|million|billion) (in|of|worth of) )?(shares|stock)|sold (\$?[\d.]+\s?(m|b|million|billion) (in|of|worth of) )?(shares|stock)|stock sales?|share sales?|insider (selling|sales?)|10b5-1|unloads?|offloads?)\b/i],
  ['political', /\b(trump|white house|congress|senat\w*|lawmakers?|export (controls?|curbs?|rules|ban)|tariffs?|regulat\w*|antitrust|ftc|doj|beijing|china|chinese|government|policy|election|midterms?|governor|ferc|national security|pentagon)\b/i],
  ['deal', /\b(deals?|agreements?|partner\w*|acquir\w*|acquisition|merger|merge|invest\w*|stake|contracts?|ppas?|signs|inks|financing|funding|raises?|ipo|buyout)\b/i],
  ['product', /\b(launch\w*|unveil\w*|keynote|gtc|roadmap|releases?|released|debuts?|rollout|introduc\w*|new (chips?|models?|gpus?|products?|platform|reactor))\b/i],
  ['earnings', /\b(earnings|quarter(ly)?|q[1-4]|revenue|guidance|profits?|outlook|forecasts?|eps|results)\b/i],
];

export function eventTags(title: string): CeoEventTag[] {
  return EVENT_RULES.filter(([, re]) => re.test(title)).map(([t]) => t);
}

/* ------------------------------------------------------------------ */
/* Key-man risk (headline heuristic, display-only)                     */
/* ------------------------------------------------------------------ */

export type KeyManRisk = 'High' | 'Elevated' | 'Low' | 'Not rated';
export const RISK_TAGS: CeoEventTag[] = ['departure', 'succession', 'health', 'investigation', 'controversy', 'insider selling'];
export const KEY_MAN_RULES =
  `High = the same kind of event reported by ≥3 different sources in 14d — departure/health (any), or investigation/controversy. ` +
  `Elevated = ≥1 risk headline (departure, succession, health, investigation, controversy, insider selling) in 30d, OR score ≤ −30 with ≥3 headlines. ` +
  `Low = ≥${MIN_CEO_HEADLINES} headlines and neither. Not rated = fewer than ${MIN_CEO_HEADLINES} headlines.`;

function keyManRisk(items: CeoHeadline[], score: number | null, now: number): KeyManRisk {
  if (items.length < MIN_CEO_HEADLINES) return 'Not rated';
  const d14 = items.filter((i) => now - Date.parse(i.publishedAt) <= 14 * 86400000);
  const risky = items.filter((i) => i.events.some((t) => RISK_TAGS.includes(t)));
  const sources = (tags: CeoEventTag[]) => new Set(d14.filter((i) => i.events.some((t) => tags.includes(t))).map((i) => i.source.toLowerCase())).size;
  if (sources(['departure', 'health']) >= 3 || sources(['investigation', 'controversy']) >= 3) return 'High';
  if (risky.length >= 1 || (score != null && score <= -30 && items.length >= 3)) return 'Elevated';
  return 'Low';
}

/* ------------------------------------------------------------------ */
/* Fetch + cache (per CEO query)                                       */
/* ------------------------------------------------------------------ */

interface CacheEntry { fetchedAt: string; ok: boolean; raw: RawNews[] }
type Cache = Record<string, CacheEntry>;

export function readCeoCache(): Cache {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return c && typeof c === 'object' ? (c as Cache) : {};
  } catch {
    return {};
  }
}
function writeCeoCache(c: Cache) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {
    /* storage full / private mode */
  }
}

let inflight: Promise<Cache> | null = null;

/**
 * Refresh stale CEO queries (≤ CEO_CONCURRENCY at once). Fresh cache entries (< 15 min) are reused, so
 * reopening the tab or re-rendering never refires requests. `force` bypasses both caches (X-Refresh).
 * Only headlines that pass the relevance filter are stored.
 */
export function refreshCeoNews(companies: Company[], force = false, onProgress?: (c: Cache) => void): Promise<Cache> {
  if (inflight) return inflight;
  inflight = (async () => {
    const cache = readCeoCache();
    const now = Date.now();
    const todo = CEOS.filter((c) => {
      const e = cache[ceoKey(c)];
      return force || !e || now - Date.parse(e.fetchedAt) >= CEO_TTL_MS;
    });
    let n = 0;
    await pool(todo, CEO_CONCURRENCY, async (c) => {
      const q = ceoQuery(c);
      try {
        const res = await fetch(`/api/news/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
          signal: AbortSignal.timeout(12000),
          cache: 'no-store',
          headers: force ? { 'X-Refresh': '1' } : undefined,
        });
        if (!res.ok) throw new Error(String(res.status));
        const cutoff = Date.now() - WINDOW_MS;
        const raw = parseRss(await res.text(), q)
          .filter((r) => Date.parse(r.publishedAt) >= cutoff && Date.parse(r.publishedAt) <= Date.now() + 3600000)
          .filter((r) => ceoMatch(c, r.title, companies))
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, MAX_PER_CEO);
        cache[ceoKey(c)] = { fetchedAt: new Date().toISOString(), ok: true, raw };
      } catch {
        // Keep the previous copy if there is one; otherwise mark the query as failed (no data, never invented).
        if (!cache[ceoKey(c)]) cache[ceoKey(c)] = { fetchedAt: new Date(0).toISOString(), ok: false, raw: [] };
      }
      if (++n % 4 === 0) onProgress?.({ ...cache });
    });
    writeCeoCache(cache);
    return cache;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/* ------------------------------------------------------------------ */
/* Per-CEO results                                                     */
/* ------------------------------------------------------------------ */

export interface CeoHeadline extends NewsItem {
  events: CeoEventTag[];
  /** Company id the headline is tied to */
  companyId: string;
}

export interface CeoResult {
  ceo: CeoEntry;
  company: Company | null;
  score: number | null;
  count: number;
  items: CeoHeadline[];
  top: CeoHeadline[];
  tagCounts: [CeoEventTag, number][];
  driver: string;
  risk: KeyManRisk;
  /** Headlines carrying a key-man event tag (what set the flag) */
  riskItems: CeoHeadline[];
  fetchedAt: string | null;
  fetched: boolean;
}

export function computeCeoResults(cache: Cache, companies: Company[], now = Date.now()): CeoResult[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  return CEOS.map((ceo) => {
    const e = cache[ceoKey(ceo)];
    const raw = (e?.raw ?? []).filter((r) => now - Date.parse(r.publishedAt) <= WINDOW_MS);
    const items: CeoHeadline[] = dedupe(raw)
      .map((m) => {
        const companyId = ceoMatch(ceo, m.item.title, companies);
        if (!companyId) return null;
        return { ...enrich(m.item, m.dupes, companies, true), events: eventTags(m.item.title), companyId };
      })
      .filter((x): x is CeoHeadline => !!x);
    let sw = 0;
    let s = 0;
    for (const i of items) {
      const w = sentimentWeight(i, now);
      sw += w;
      s += w * i.sentiment;
    }
    const score = items.length >= MIN_CEO_HEADLINES && sw > 0 ? Math.round((100 * s) / sw) : null;
    const top = [...items].sort((a, b) => sentimentWeight(b, now) - sentimentWeight(a, now)).slice(0, 3);
    const counts = new Map<CeoEventTag, number>();
    for (const i of items) for (const t of i.events) counts.set(t, (counts.get(t) ?? 0) + 1);
    const tagCounts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const pos = items.filter((i) => i.sentiment > 0.05).length;
    const neg = items.filter((i) => i.sentiment < -0.05).length;
    const driver = !items.length
      ? 'No matching headlines in the last 30 days.'
      : `${tagCounts.length ? `Driven by ${tagCounts.slice(0, 3).map(([t, n]) => `${t} (${n})`).join(', ')}` : 'No event keywords in headlines'} · ${pos} positive / ${neg} negative / ${items.length - pos - neg} neutral headlines`;
    return {
      ceo,
      company: byId.get(ceo.companyId) ?? null,
      score,
      count: items.length,
      items: items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
      top,
      tagCounts,
      driver,
      risk: keyManRisk(items, score, now),
      riskItems: items.filter((i) => i.events.some((t) => RISK_TAGS.includes(t))),
      fetchedAt: e?.ok ? e.fetchedAt : null,
      fetched: !!e?.ok,
    };
  });
}

/**
 * CEO share of company news: of the live main-feed headlines tagged with the company (30d), the share that also
 * name the CEO. null when the company has fewer than 3 tagged headlines (too thin to say anything).
 */
export function ceoShare(ceo: CeoEntry, feedItems: NewsItem[], companies: Company[], now = Date.now()): { share: number; n: number } | null {
  const ids = [ceo.companyId, ...(ceo.alsoIds ?? [])];
  const list = feedItems.filter((i) => i.live && now - Date.parse(i.publishedAt) <= WINDOW_MS && i.companies.some((c) => ids.includes(c)));
  if (list.length < 3) return null;
  const hit = list.filter((i) => ceoMatch(ceo, i.title, companies)).length;
  return { share: hit / list.length, n: list.length };
}

/** Optional `ceo` array for the signals snapshot (informational; never feeds composite or trader). */
export function ceoSnapshot(results: CeoResult[]) {
  return results
    .filter((r) => r.fetched)
    .map((r) => ({
      name: r.ceo.name,
      company: r.company?.name ?? r.ceo.companyId,
      company_id: r.ceo.companyId,
      ticker: r.ceo.ticker,
      title: r.ceo.title,
      score: r.score,
      headlines: r.count,
      key_man_risk: r.risk,
      event_tags: Object.fromEntries(r.tagCounts),
      updated_at: r.fetchedAt,
    }));
}

/* ------------------------------------------------------------------ */
/* Sleeve exposure to flagged CEOs                                     */
/* ------------------------------------------------------------------ */

export interface ExposureLine { ticker: string; value: number; pct: number; note: string }
export interface SleeveExposure {
  sleeve: string;
  label: string;
  ts: string;
  /** positions = holdings in the latest equity record; plan = dry-run / planned orders of the latest cycle; none = nothing held */
  basis: 'positions' | 'plan' | 'none';
  mode: string;
  dryRun: boolean;
  example: boolean;
  sleeveValue: number;
  directPct: number;
  linkedPct: number;
  direct: ExposureLine[];
  linked: ExposureLine[];
}

export function flaggedCeos(results: CeoResult[]): CeoResult[] {
  return results.filter((r) => r.risk === 'High' || r.risk === 'Elevated');
}

/**
 * Per sleeve: % of sleeve value in companies whose CEO is Elevated/High key-man risk (direct), and separately
 * % in companies linked to one of those in the relationship graph (linked). Reads ONLY the bot's records:
 * the latest equity record's positions; if it holds no positions, the latest cycle's planned (dry-run) orders.
 */
export function sleeveExposure(data: TraderData | null, results: CeoResult[], companies: Company[], relationships: Relationship[]): SleeveExposure[] {
  if (!data?.ok || !data.equity.length) return [];
  const byTicker = new Map(companies.filter((c) => c.ticker).map((c) => [c.ticker!.toUpperCase(), c]));
  const byId = new Map(companies.map((c) => [c.id, c]));
  const flagged = new Map<string, CeoResult[]>();
  for (const r of flaggedCeos(results)) for (const id of [r.ceo.companyId, ...(r.ceo.alsoIds ?? [])]) flagged.set(id, [...(flagged.get(id) ?? []), r]);
  const latest = new Map<string, BotEquity>();
  for (const e of data.equity) {
    const cur = latest.get(e.sleeve);
    if (!cur || Date.parse(e.ts) >= Date.parse(cur.ts)) latest.set(e.sleeve, e);
  }
  const out: SleeveExposure[] = [];
  for (const [sleeve, eq] of latest) {
    let holdings: { ticker: string; value: number }[] = (eq.positions ?? [])
      .map((p) => ({ ticker: p.ticker.toUpperCase(), value: Math.max(0, p.market_value ?? (p.price != null ? p.qty * p.price : 0)) }))
      .filter((h) => h.value > 0);
    let basis: SleeveExposure['basis'] = holdings.length ? 'positions' : 'none';
    let dryRun = false;
    const sTrades = data.trades.filter((t) => t.sleeve === sleeve);
    if (!holdings.length && sTrades.length) {
      const lastTs = sTrades.reduce((m, t) => Math.max(m, Date.parse(t.ts)), 0);
      const cycle = sTrades.filter((t) => Date.parse(t.ts) === lastTs);
      const net = new Map<string, number>();
      for (const t of cycle) {
        const v = t.notional ?? t.qty * t.price;
        const sign = t.side === 'buy' || t.side === 'cover' ? 1 : -1;
        net.set(t.ticker.toUpperCase(), (net.get(t.ticker.toUpperCase()) ?? 0) + sign * v);
      }
      holdings = [...net.entries()].map(([ticker, value]) => ({ ticker, value })).filter((h) => h.value > 0);
      if (holdings.length) {
        basis = 'plan';
        dryRun = cycle.some((t: BotTrade) => t.status === 'dry_run' || /dry run/i.test(t.reason?.text ?? ''));
      }
    }
    const total = eq.equity > 0 ? eq.equity : holdings.reduce((a, h) => a + h.value, 0);
    const direct: ExposureLine[] = [];
    const linked: ExposureLine[] = [];
    for (const h of holdings) {
      const c = byTicker.get(h.ticker);
      if (!c) continue;
      const pct = total > 0 ? (100 * h.value) / total : 0;
      const f = flagged.get(c.id);
      if (f) {
        direct.push({ ticker: h.ticker, value: h.value, pct, note: f.map((r) => `${r.ceo.name} (${r.risk})`).join(', ') });
        continue;
      }
      const links = relationships
        // Competitors are not exposure; every other edge (supplier, customer, partner, investor, power, cloud…) is.
        .filter((r) => r.type !== 'competitor')
        .filter((r) => (r.source === c.id && flagged.has(r.target)) || (r.target === c.id && flagged.has(r.source)))
        .map((r) => {
          const other = byId.get(r.source === c.id ? r.target : r.source);
          return `${other?.ticker ?? other?.name ?? '?'} ${r.type}`;
        });
      if (links.length) linked.push({ ticker: h.ticker, value: h.value, pct, note: [...new Set(links)].join(', ') });
    }
    out.push({
      sleeve,
      label: eq.sleeve_label,
      ts: eq.ts,
      basis,
      mode: eq.mode ?? sTrades.at(-1)?.mode ?? 'paper',
      dryRun,
      example: !!eq.example,
      sleeveValue: total,
      directPct: direct.reduce((a, l) => a + l.pct, 0),
      linkedPct: linked.reduce((a, l) => a + l.pct, 0),
      direct,
      linked,
    });
  }
  return out.sort((a, b) => a.sleeve.localeCompare(b.sleeve));
}
