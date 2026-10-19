/**
 * News refresher — runs on every app open (when the cache is stale) and on demand.
 *
 * Pipeline: Google News RSS (via /api/news proxy, many queries) → parse → dedupe (title similarity) →
 * tag companies + markets → classify category → lexicon sentiment → rank per window (day / week / month).
 * Everything is client-side so server.mjs and serve.py stay identical simple proxies (they add a 15-min cache).
 */
import type { Company, Headline, NewsCategory } from '../types';
import { MARKETS, marketOfSegment } from '../data/markets';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface RawNews {
  title: string;
  source: string;
  sourceUrl?: string;
  url: string;
  publishedAt: string;
  query: string;
}

export interface NewsItem extends Headline {
  sourceUrl?: string;
  /** 0..1 source quality tier */
  quality: number;
  /** 0..1 relevance to the AI-infra + energy universe */
  relevance: number;
  /** Near-duplicate stories merged into this one (coverage breadth) */
  dupes: number;
  /** Lexicon terms that moved the sentiment score (for the help / tooltip) */
  hits: string[];
  markets: string[];
  companies: string[];
  category: NewsCategory;
  sentiment: number;
}

export type FeedMode = 'live' | 'cache' | 'seed';

export interface NewsFeed {
  fetchedAt: string;
  mode: FeedMode;
  items: NewsItem[];
  queriesOk: number;
  queriesTotal: number;
  /** Raw (pre-dedupe) item count */
  rawCount: number;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const NEWS_QUERIES: string[] = [
  'Nvidia OR "AI chips" OR semiconductor when:7d',
  'AI chip stocks when:1d',
  'TSMC OR foundry OR "Samsung Foundry" OR "Intel Foundry" when:30d',
  'ASML OR "Applied Materials" OR "Lam Research" OR KLA chip equipment when:30d',
  'HBM OR "SK Hynix" OR Micron memory chips when:30d',
  'Synopsys OR Cadence OR "Arm Holdings" chip design when:30d',
  'hyperscaler capex "data center" Microsoft OR Amazon OR Google OR Meta when:7d',
  'OpenAI OR Anthropic OR xAI compute deal when:7d',
  '"AI infrastructure" when:1d',
  '"export controls" chips China OR tariffs semiconductors when:30d',
  'Trump Xi rare earths AI chips when:30d',
  'SpaceX OR Starlink OR SPCX when:7d',
  '"data center" nuclear power OR PPA OR SMR when:30d',
  '"data center" "natural gas" OR "gas turbines" OR pipeline when:30d',
  'utility "data center" load OR "large load" OR interconnection when:30d',
  '"data center" solar OR wind OR geothermal OR hydro power deal when:30d',
  'Constellation OR Vistra OR Talen OR Oklo OR NuScale OR Cameco when:30d',
  '"GE Vernova" OR "Siemens Energy" OR "Bloom Energy" OR Vertiv OR Eaton data center when:30d',
  'biofuel OR "renewable diesel" OR "renewable natural gas" "data center" when:30d',
  'AI power demand electricity grid when:1d',
];

/* ------------------------------------------------------------------ */
/* RSS parsing                                                         */
/* ------------------------------------------------------------------ */

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&/g, '&')
    .trim();
}

export function parseRss(xml: string, query: string): RawNews[] {
  const out: RawNews[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const b = m[1];
    let title = decodeXml(b.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const link = decodeXml(b.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? '');
    const pub = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
    const srcM = b.match(/<source([^>]*)>([\s\S]*?)<\/source>/i);
    const source = srcM ? decodeXml(srcM[2]) : 'Google News';
    const sourceUrl = srcM?.[1].match(/url="([^"]+)"/)?.[1];
    // Google News appends " - Source" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const t = pub ? Date.parse(pub) : NaN;
    if (!title || !link || Number.isNaN(t)) continue;
    out.push({ title, source, sourceUrl, url: link, publishedAt: new Date(t).toISOString(), query });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Source quality                                                      */
/* ------------------------------------------------------------------ */

const TIER1 = /reuters|bloomberg|wall street journal|wsj|financial times|\bft\b|associated press|\bap news\b|cnbc|the information|barron|nikkei|the economist/i;
const TIER2 = /utility dive|datacenterdynamics|\bdcd\b|power magazine|powermag|world nuclear news|data center frontier|latitude media|heatmap|canary media|s&p global|marketwatch|yahoo finance|fortune|axios|business insider|new york times|washington post|techcrunch|the verge|tom's hardware|semianalysis|eetimes|ars technica|wired|forbes|politico|the register|investor's business daily|digitimes|trendforce|naturalgasintel|ngi|e&e news|siliconangle|construction dive|anandtech|ieee spectrum|bnef|platts|argus|nasdaq|globe and mail|nikkei asia/i;
const LOW = /motley fool|fool\.com|zacks|investorplace|benzinga|seeking alpha|stocktitan|marketbeat|simply wall|tipranks|gurufocus|insidermonkey|ad hoc news|ad-hoc|finviz|24\/7 wall|msn$|blockchain|coin/i;

export function sourceQuality(source: string, url?: string): number {
  const s = `${source} ${url ?? ''}`;
  if (TIER1.test(s)) return 1;
  if (TIER2.test(s)) return 0.8;
  if (LOW.test(s)) return 0.35;
  return 0.55;
}

/* ------------------------------------------------------------------ */
/* Company + market tagging                                            */
/* ------------------------------------------------------------------ */

/**
 * Patterns per company. Prefix "=" → case-sensitive (used for tickers / short names that are also words).
 * Ambiguous tickers (D, SO, ET, BE, SMR, LEU, ENR …) are intentionally not matched — names only.
 */
const NEWS_ALIASES: Record<string, string[]> = {
  nvidia: ['Nvidia', '=NVDA'],
  amd: ['=AMD', 'Advanced Micro Devices'],
  intel: ['Intel'],
  broadcom: ['Broadcom', '=AVGO'],
  qualcomm: ['Qualcomm'],
  arm: ['Arm Holdings', '=Arm'],
  softbank: ['SoftBank'],
  tsmc: ['TSMC', 'Taiwan Semiconductor'],
  'samsung-foundry': ['Samsung Foundry'],
  samsung: ['Samsung'],
  globalfoundries: ['GlobalFoundries'],
  smic: ['=SMIC'],
  asml: ['ASML'],
  amat: ['Applied Materials'],
  lam: ['Lam Research'],
  kla: ['=KLA'],
  synopsys: ['Synopsys'],
  cadence: ['Cadence Design', '=Cadence'],
  microsoft: ['Microsoft', 'Azure', '=MSFT'],
  amazon: ['Amazon', '=AWS'],
  google: ['Google', 'Alphabet', 'DeepMind', '=Gemini'],
  meta: ['=Meta', 'Meta Platforms', 'Facebook'],
  oracle: ['Oracle', '=OCI'],
  openai: ['OpenAI', 'ChatGPT', '=Stargate'],
  anthropic: ['Anthropic', '=Claude'],
  cerebras: ['Cerebras'],
  groq: ['=Groq'],
  sambanova: ['SambaNova'],
  marvell: ['Marvell'],
  micron: ['Micron'],
  skhynix: ['SK Hynix', 'SK hynix', 'Hynix'],
  apple: ['=Apple', 'iPhone'],
  tesla: ['Tesla'],
  spacex: ['SpaceX', 'Starlink', '=xAI', '=SPCX', '=Starship'],
  huawei: ['Huawei'],
  constellation: ['Constellation Energy', '=Constellation', '=CEG', 'Three Mile Island', 'Crane Clean Energy'],
  vistra: ['Vistra', 'Comanche Peak'],
  talen: ['Talen', 'Susquehanna nuclear'],
  nrg: ['=NRG'],
  nextera: ['NextEra', 'Florida Power & Light', 'Duane Arnold'],
  dominion: ['Dominion Energy', '=Dominion'],
  duke: ['Duke Energy'],
  southern: ['Southern Company', 'Southern Co', 'Georgia Power', 'Alabama Power'],
  gevernova: ['GE Vernova', '=GEV'],
  siemensenergy: ['Siemens Energy'],
  bloom: ['Bloom Energy'],
  oklo: ['Oklo'],
  nuscale: ['NuScale'],
  cameco: ['Cameco', 'Westinghouse'],
  centrus: ['Centrus'],
  ormat: ['Ormat'],
  eqt: ['=EQT', 'Homer City'],
  williams: ['Williams Cos', 'Williams Companies', '=Transco'],
  kindermorgan: ['Kinder Morgan'],
  energytransfer: ['Energy Transfer'],
  brookfieldrenewable: ['Brookfield Renewable', '=BEP'],
  firstsolar: ['First Solar'],
  vestas: ['Vestas'],
  neste: ['Neste'],
  vertiv: ['Vertiv'],
  eaton: ['=Eaton'],
};

/** Titles matching these are NOT about the company (namesakes). */
const NEWS_EXCLUDE: Record<string, RegExp> = {
  constellation: /Constellation Brands|\bSTZ\b|\bbeer\b|\bwine\b|Corona|Modelo|SpikedAde/i,
  dominion: /Dominion Voting/i,
  eaton: /Eaton (Vance|fire|Canyon)/i,
  cameco: /Westinghouse Air Brake|Wabtec/i,
  eqt: /EQT (AB|Partners|Group|Private|Exeter|Infrastructure|Real Estate)|private[- ]equity|buyout/i,
};
/** Ambiguous names must also co-occur with energy context. */
const NEWS_CONTEXT: Record<string, RegExp> = {
  constellation: /energy|nuclear|power|reactor|\bPPA\b|Calpine|data cent|uprate|\bCEG\b|grid|electric|Three Mile|Crane/i,
  eqt: /gas|pipeline|Appalachia|Marcellus|power|energy|data cent|Homer City|\bLNG\b|shale/i,
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Matcher {
  id: string;
  market?: string;
  res: RegExp[];
}

let matcherCache: { key: string; list: Matcher[] } | null = null;

function matchersFor(companies: Company[]): Matcher[] {
  const key = companies.map((c) => c.id).join(',');
  if (matcherCache?.key === key) return matcherCache.list;
  const list: Matcher[] = companies.map((c) => {
    const pats = NEWS_ALIASES[c.id] ?? [c.name, ...(c.ticker && c.ticker.length >= 3 ? [`=${c.ticker}`] : [])];
    const res = pats.map((p) =>
      p.startsWith('=') ? new RegExp(`\\b${esc(p.slice(1))}\\b`) : new RegExp(`\\b${esc(p)}\\b`, 'i')
    );
    return { id: c.id, market: marketOfSegment(c.segment), res };
  });
  matcherCache = { key, list };
  return list;
}

export function tagCompanies(title: string, companies: Company[]): string[] {
  const ids: string[] = [];
  for (const m of matchersFor(companies)) {
    if (!m.res.some((r) => r.test(title))) continue;
    if (NEWS_EXCLUDE[m.id]?.test(title)) continue;
    if (NEWS_CONTEXT[m.id] && !NEWS_CONTEXT[m.id].test(title)) continue;
    ids.push(m.id);
  }
  return ids;
}

export function tagMarkets(title: string, companyIds: string[], companies: Company[]): string[] {
  const set = new Set<string>();
  const byId = new Map(companies.map((c) => [c.id, c]));
  for (const id of companyIds) {
    const c = byId.get(id);
    const mk = c ? marketOfSegment(c.segment) : undefined;
    if (mk) set.add(mk);
  }
  for (const m of MARKETS) if (m.keywords.test(title)) set.add(m.id);
  return [...set];
}

/* ------------------------------------------------------------------ */
/* Category classifier                                                 */
/* ------------------------------------------------------------------ */

const CAT_RULES: Record<Exclude<NewsCategory, 'other'>, [RegExp, number][]> = {
  political: [
    [/\b(tariffs?|export controls?|export (curbs|rules|ban|restrictions)|sanctions?|embargo)\b/i, 3],
    [/\b(trump|xi|biden|white house|congress|senate|lawmakers?|legislat\w+|bill|executive order|beijing|washington|kremlin)\b/i, 2],
    [/\b(regulators?|regulat\w+|ferc|nrc|public service commission|psc|puc|utility commission|antitrust|ftc|doj|european commission|eu)\b/i, 2],
    [/\b(chips act|subsid\w+|tax credits?|permit(s|ting)?|moratorium|pause|governor|state law|court|judge|lawsuit|sues|ruling|policy|government|national security|geopolit\w+|taiwan|ratepayers?|rate case|election|ban)\b/i, 1.5],
  ],
  investment: [
    [/\b(invest(s|ed|ment|ments|ors?)?|funding|raises?|raised|ipo|acquir\w+|acquisition|merger|takeover|stake|buyback|dividend|valuation|financing|bonds?|debt|notes offering|prepay\w*)\b/i, 2],
    [/\b(earnings|revenue|profit|guidance|outlook|quarter(ly)?|results|q[1-4]|forecast|beats?|miss(es)?|price target|upgrades?|downgrades?|analysts?)\b/i, 1.5],
    [/\b(stocks?|shares|market cap|rally|sell-?off|investors|fund|capex|spending|billion|\$\d)\b/i, 1],
    [/\b(deal|agreement|contract|ppa|power purchase|signs|inks|partnership)\b/i, 1],
  ],
  operations: [
    [/\b(production|capacity|output|supply|shortages?|bottlenecks?|backlog|deliver(y|ies)|ship(s|ments|ping)?|yields?|ramp(s|ing)?)\b/i, 2],
    [/\b(factory|fab|plant|reactor|restart|uprates?|construction|build(s|ing)?|commission\w*|online|energiz\w+|interconnection|grid connection|outage|blackout|delay(s|ed)?|launch(es|ed)?|deploy\w*|rollout)\b/i, 1.5],
    [/\b(turbines?|megawatts?|gigawatts?|\d+\s?(mw|gw)|data cent(er|re) campus|pipeline lateral|drilling|wells?)\b/i, 1],
  ],
};

export function classify(title: string): NewsCategory {
  let best: NewsCategory = 'other';
  let bestScore = 0;
  for (const cat of ['political', 'operations', 'investment'] as const) {
    let s = 0;
    for (const [re, w] of CAT_RULES[cat]) if (re.test(title)) s += w;
    if (s > bestScore + 0.01) {
      best = cat;
      bestScore = s;
    }
  }
  return bestScore >= 1 ? best : 'other';
}

/* ------------------------------------------------------------------ */
/* Lexicon sentiment                                                   */
/* ------------------------------------------------------------------ */

/** Phrases first (matched on the raw lower-case title), then single tokens. Weights roughly −2…+2. */
const PHRASES: [string, number][] = [
  ['force majeure', -1.6],
  ['sell-off', -1.6],
  ['all-time high', 1.8],
  ['record high', 1.8],
  ['price target raised', 1.4],
  ['raises guidance', 1.5],
  ['cuts guidance', -1.6],
  ['falls short', -1.3],
  ['stop-work', -1.5],
  ['data center pause', -1.2],
  ['supply crunch', -1.1],
  ['sold out', 0.8],
];

export const LEXICON: Record<string, number> = {
  // positive
  excite: 1, excites: 1, upbeat: 1.2,
  surge: 2, surges: 2, soar: 2, soars: 2, jump: 1.5, jumps: 1.5, rally: 1.5, rallies: 1.5, gain: 1, gains: 1,
  rise: 1, rises: 1, climbs: 1, climb: 1, beat: 1.5, beats: 1.5, record: 1.2, boost: 1.2, boosts: 1.2,
  win: 1.2, wins: 1.2, won: 1.1, expand: 1, expands: 1, expansion: 0.8, strong: 1, stronger: 1, growth: 1,
  upgrade: 1.5, upgraded: 1.5, upgrades: 1.4, approve: 1.2, approves: 1.2, approved: 1.2, approval: 1,
  deal: 0.6, agreement: 0.5, partnership: 0.6, invest: 0.6, invests: 0.7, investment: 0.5, secures: 1,
  signs: 0.6, inks: 0.6, lands: 0.8, accelerate: 0.8, accelerates: 0.8, optimism: 1.2, optimistic: 1.2,
  relief: 1, truce: 1, eases: 0.8, ease: 0.8, lifts: 1, tops: 1, profit: 0.6, milestone: 1, breakthrough: 1.5,
  outperform: 1.5, bullish: 1.5, restart: 0.7, revive: 0.8, revives: 0.8, landmark: 0.8, boom: 1.2,
  demand: 0.3, launches: 0.4, unveils: 0.4, online: 0.4, recover: 0.9, recovers: 0.9, rebound: 1.1, rebounds: 1.1,
  // negative
  plunge: -2, plunges: -2, plummet: -2, plummets: -2, slump: -1.8, slumps: -1.8, tumble: -1.8, tumbles: -1.8,
  crash: -2, crashes: -2, sink: -1.5, sinks: -1.5, falls: -1.2, fall: -1, drop: -1.2, drops: -1.2,
  slide: -1.2, slides: -1.2, decline: -1, declines: -1, cut: -1, cuts: -1, miss: -1.5, misses: -1.5,
  downgrade: -1.5, downgraded: -1.5, downgrades: -1.4, warn: -1.3, warns: -1.3, warning: -1.2, risk: -0.7, risks: -0.8,
  delay: -1.2, delays: -1.2, delayed: -1.2, halt: -1.5, halts: -1.5, halted: -1.5, pause: -1, paused: -1,
  ban: -1.5, bans: -1.5, banned: -1.5, restrict: -1.2, restricts: -1.2, restrictions: -1.2, curbs: -1.2, curb: -1.1,
  sanction: -1.3, sanctions: -1.3, tariff: -1, tariffs: -1, probe: -1.2, investigation: -1, lawsuit: -1.2,
  sues: -1.2, shortage: -1.2, shortages: -1.2, bottleneck: -1, bottlenecks: -1, outage: -1.3, outages: -1.3,
  blackout: -1.5, glut: -1, bubble: -1.3, selloff: -1.6, loss: -1, losses: -1, layoffs: -1.3, concerns: -0.8,
  concern: -0.7, fears: -1.1, fear: -1, worries: -1, slow: -0.8, slows: -0.8, slowdown: -1.2, weak: -1,
  weaker: -1, struggle: -1, struggles: -1, oppose: -0.8, opposition: -0.8, backlash: -1.1, strain: -1,
  strains: -1, crisis: -1.5, war: -1.2, tension: -1, tensions: -1, threat: -1, threatens: -1.1, bearish: -1.5,
  overvalued: -1.2, cancel: -1.4, cancels: -1.4, cancelled: -1.4, canceled: -1.4, scrap: -1.3, scraps: -1.3,
  rejects: -1.2, rejected: -1.2, denied: -1.1, denies: -1, hurdles: -0.9, hurdle: -0.9, squeeze: -0.9,
  volatile: -0.6, volatility: -0.6, uncertainty: -0.9, shortfall: -1.2, writedown: -1.4, 'write-down': -1.4,
};

/** Shown in the UI help so the documented size never drifts from the code. */
export const LEXICON_SIZE = Object.keys(LEXICON).length;
export const PHRASE_COUNT = PHRASES.length;

const NEGATORS = new Set(['not', 'no', 'never', 'without', "won't", "isn't", "doesn't", "didn't", 'fail', 'fails', 'failed', 'lack', 'lacks']);

/**
 * Rule-based headline sentiment in [-1, 1].
 * sum of lexicon weights (phrases first; a negator within the previous 2 tokens flips a term ×−0.7),
 * normalised as s / √(s² + 6) — a VADER-style squash so one strong word ≈ ±0.6 and stacked words approach ±1.
 */
export function scoreSentiment(title: string): { score: number; hits: string[] } {
  let lower = ` ${title.toLowerCase()} `;
  let sum = 0;
  const hits: string[] = [];
  for (const [p, w] of PHRASES) {
    if (lower.includes(p)) {
      sum += w;
      hits.push(`${p} ${w > 0 ? '+' : ''}${w}`);
      lower = lower.split(p).join(' ');
    }
  }
  const toks = lower.split(/[^a-z0-9'-]+/).filter(Boolean);
  toks.forEach((t, i) => {
    const w = LEXICON[t];
    if (w == null) return;
    const negated = NEGATORS.has(toks[i - 1]) || NEGATORS.has(toks[i - 2]);
    const v = negated ? -0.7 * w : w;
    sum += v;
    hits.push(`${negated ? 'not ' : ''}${t} ${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`);
  });
  const score = sum === 0 ? 0 : sum / Math.sqrt(sum * sum + 6);
  return { score: Math.round(score * 1000) / 1000, hits };
}

/* ------------------------------------------------------------------ */
/* Dedupe                                                              */
/* ------------------------------------------------------------------ */

const STOP = new Set('the a an and or of to in on for with as at by from is are be its it this that after over into new says say amid us'.split(' '));
const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
  );

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Merge near-identical stories (Jaccard ≥ 0.6 on content words); keep the best-quality / earliest source, count dupes. */
export function dedupe(raw: RawNews[]): { item: RawNews; dupes: number; queries: Set<string> }[] {
  const sorted = [...raw].sort(
    (a, b) => sourceQuality(b.source, b.sourceUrl) - sourceQuality(a.source, a.sourceUrl) || a.publishedAt.localeCompare(b.publishedAt)
  );
  const kept: { item: RawNews; dupes: number; queries: Set<string>; w: Set<string>; key: string }[] = [];
  const byKey = new Map<string, number>();
  for (const r of sorted) {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const exact = byKey.get(key);
    if (exact != null) {
      kept[exact].queries.add(r.query);
      if (kept[exact].item.source !== r.source) kept[exact].dupes++;
      continue;
    }
    const w = words(r.title);
    let merged = false;
    for (const k of kept) {
      if (jaccard(w, k.w) >= 0.6) {
        k.dupes++;
        k.queries.add(r.query);
        merged = true;
        break;
      }
    }
    if (!merged) {
      byKey.set(key, kept.length);
      kept.push({ item: r, dupes: 0, queries: new Set([r.query]), w, key });
    }
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Enrichment                                                          */
/* ------------------------------------------------------------------ */

const CORE = /\b(ai|a\.i\.|artificial intelligence|data cent(er|re)s?|chips?|semiconductors?|gpus?|hyperscal\w+|compute|cloud|power demand|electricity)\b/i;

function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function enrich(r: RawNews, dupes: number, companies: Company[], live: boolean): NewsItem {
  const comp = tagCompanies(r.title, companies);
  const markets = tagMarkets(r.title, comp, companies);
  const category = classify(r.title);
  const { score, hits } = scoreSentiment(r.title);
  const relevance = Math.min(1, 0.25 * Math.min(comp.length, 2) + 0.15 * Math.min(markets.length, 2) + (CORE.test(r.title) ? 0.25 : 0));
  return {
    id: `n-${hashId(r.title)}`,
    title: r.title,
    source: r.source,
    sourceUrl: r.sourceUrl,
    url: r.url,
    publishedAt: r.publishedAt,
    tags: live ? ['live'] : ['seed'],
    sentiment: score,
    hits,
    political: category === 'political',
    markets,
    companies: comp,
    category,
    live,
    quality: sourceQuality(r.source, r.sourceUrl),
    relevance,
    dupes,
  };
}

/* ------------------------------------------------------------------ */
/* Fetch + cache                                                       */
/* ------------------------------------------------------------------ */

const LS_KEY = 'ai-infra:news-feed:v1';
export const NEWS_TTL_MS = 15 * 60 * 1000;
const MAX_AGE_DAYS = 31;

interface CachedFeed {
  fetchedAt: string;
  raw: { item: RawNews; dupes: number }[];
  queriesOk: number;
  queriesTotal: number;
  rawCount: number;
}

export function readCachedFeed(companies: Company[]): NewsFeed | null {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null') as CachedFeed | null;
    if (!c?.fetchedAt || !Array.isArray(c.raw)) return null;
    return {
      fetchedAt: c.fetchedAt,
      mode: 'cache',
      items: c.raw.map((x) => enrich(x.item, x.dupes, companies, true)).filter((i) => i.relevance >= 0.15),
      queriesOk: c.queriesOk,
      queriesTotal: c.queriesTotal,
      rawCount: c.rawCount,
    };
  } catch {
    return null;
  }
}

export const isFresh = (feed: NewsFeed | null, now = Date.now()) =>
  !!feed && feed.mode !== 'seed' && now - Date.parse(feed.fetchedAt) < NEWS_TTL_MS;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/** Fetch every query (6 in parallel), dedupe, enrich. `force` bypasses the server's 15-min cache. */
export async function fetchLiveFeed(companies: Company[], force = false): Promise<NewsFeed> {
  let ok = 0;
  const lists = await pool(NEWS_QUERIES, 6, async (q) => {
    try {
      const url = `/api/news/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
        headers: force ? { 'X-Refresh': '1' } : undefined,
      });
      if (!res.ok) return [] as RawNews[];
      const items = parseRss(await res.text(), q);
      if (items.length) ok++;
      return items;
    } catch {
      return [] as RawNews[];
    }
  });
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const raw = lists.flat().filter((r) => Date.parse(r.publishedAt) >= cutoff && Date.parse(r.publishedAt) <= Date.now() + 3600000);
  if (!raw.length) throw new Error('no live headlines');
  const merged = dedupe(raw);
  const fetchedAt = new Date().toISOString();
  const items = merged.map((m) => enrich(m.item, m.dupes, companies, true)).filter((i) => i.relevance >= 0.15);
  try {
    // Keep only relevant items in the cache to stay well under localStorage limits.
    const keep = new Set(items.map((i) => i.title));
    const cache: CachedFeed = {
      fetchedAt,
      raw: merged.filter((m) => keep.has(m.item.title)).map((m) => ({ item: m.item, dupes: m.dupes })),
      queriesOk: ok,
      queriesTotal: NEWS_QUERIES.length,
      rawCount: raw.length,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* storage full / private mode */
  }
  return { fetchedAt, mode: 'live', items, queriesOk: ok, queriesTotal: NEWS_QUERIES.length, rawCount: raw.length };
}

/** Offline fallback: curated seed headlines run through the same tagger / scorer. */
export function seedFeed(seeds: Headline[], companies: Company[]): NewsFeed {
  const items = seeds.map((h) => {
    const n = enrich({ title: h.title, source: h.source, url: h.url, publishedAt: h.publishedAt, query: 'seed' }, 0, companies, false);
    return {
      ...n,
      id: h.id,
      markets: [...new Set([...(h.markets ?? []), ...n.markets])],
      companies: [...new Set([...(h.companies ?? []), ...n.companies])],
      category: h.category ?? n.category,
      relevance: Math.max(n.relevance, 0.5),
    };
  });
  return { fetchedAt: new Date().toISOString(), mode: 'seed', items, queriesOk: 0, queriesTotal: NEWS_QUERIES.length, rawCount: items.length };
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

export type NewsWindow = 'day' | 'week' | 'month';
export const WINDOW_HOURS: Record<NewsWindow, number> = { day: 24, week: 24 * 7, month: 24 * 30 };
const TAU_HOURS: Record<NewsWindow, number> = { day: 12, week: 72, month: 240 };
export const WINDOW_N: Record<NewsWindow, number> = { day: 3, week: 5, month: 10 };

const ageH = (iso: string, now: number) => Math.max(0, (now - Date.parse(iso)) / 3600000);

/** rank = 0.40·relevance + 0.30·recency + 0.20·source quality + 0.10·coverage (dupes), with a diversity penalty. */
export function rankScore(i: NewsItem, w: NewsWindow, now: number): number {
  const rec = Math.exp(-ageH(i.publishedAt, now) / TAU_HOURS[w]);
  const cov = Math.min(1, Math.log2(1 + i.dupes) / 3);
  return 0.4 * i.relevance + 0.3 * rec + 0.2 * i.quality + 0.1 * cov;
}

export function topForWindow(items: NewsItem[], w: NewsWindow, now = Date.now(), n = WINDOW_N[w], allowOutside = false): NewsItem[] {
  let pool = items.filter((i) => ageH(i.publishedAt, now) <= WINDOW_HOURS[w]);
  if (!pool.length && allowOutside) pool = [...items];
  const scored = pool.map((i) => ({ i, s: rankScore(i, w, now) })).sort((a, b) => b.s - a.s);
  const picked: NewsItem[] = [];
  const compCount = new Map<string, number>();
  const mkCount = new Map<string, number>();
  while (picked.length < n && scored.length) {
    let bestK = 0;
    let bestV = -Infinity;
    for (let k = 0; k < Math.min(scored.length, 40); k++) {
      const { i, s } = scored[k];
      const pc = i.companies[0] ? compCount.get(i.companies[0]) ?? 0 : 0;
      const pm = i.markets[0] ? mkCount.get(i.markets[0]) ?? 0 : 0;
      const v = s - 0.08 * pc - 0.04 * pm;
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    const [{ i }] = scored.splice(bestK, 1);
    picked.push(i);
    if (i.companies[0]) compCount.set(i.companies[0], (compCount.get(i.companies[0]) ?? 0) + 1);
    if (i.markets[0]) mkCount.set(i.markets[0], (mkCount.get(i.markets[0]) ?? 0) + 1);
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* Sentiment aggregation                                               */
/* ------------------------------------------------------------------ */

/** Headline weight for sentiment = quality × recency (10-day decay) × (1 + 0.25·log2(1+dupes)). */
export function sentimentWeight(i: NewsItem, now: number): number {
  return i.quality * Math.exp(-ageH(i.publishedAt, now) / 240) * (1 + 0.25 * Math.log2(1 + i.dupes));
}

export interface CategoryBreakdown {
  category: NewsCategory;
  count: number;
  /** Weighted mean sentiment of this category's headlines (−100…100) */
  avg: number;
  /** Points this category adds to the market score (sums to the market score) */
  contribution: number;
  /** Share of total headline weight (0…1) */
  share: number;
  items: NewsItem[];
}

export interface MarketSentiment {
  marketId: string;
  score: number;
  count: number;
  /** Score of last 7 days minus score of days 8–30 (NaN when either side is empty) */
  trend: number;
  weekly: (number | null)[];
  categories: CategoryBreakdown[];
  items: NewsItem[];
}

function weightedScore(list: NewsItem[], now: number): number | null {
  let sw = 0;
  let s = 0;
  for (const i of list) {
    const w = sentimentWeight(i, now);
    sw += w;
    s += w * i.sentiment;
  }
  return sw > 0 ? (100 * s) / sw : null;
}

export function sentimentFor(items: NewsItem[], now = Date.now(), marketId?: string): MarketSentiment {
  const list = items.filter((i) => ageH(i.publishedAt, now) <= 24 * 30 && (!marketId || i.markets.includes(marketId)));
  const total = list.reduce((a, i) => a + sentimentWeight(i, now), 0);
  const cats: NewsCategory[] = ['political', 'investment', 'operations', 'other'];
  const categories = cats.map((category) => {
    const ci = list.filter((i) => i.category === category);
    const cw = ci.reduce((a, i) => a + sentimentWeight(i, now), 0);
    const cs = ci.reduce((a, i) => a + sentimentWeight(i, now) * i.sentiment, 0);
    return {
      category,
      count: ci.length,
      avg: cw > 0 ? (100 * cs) / cw : 0,
      contribution: total > 0 ? (100 * cs) / total : 0,
      share: total > 0 ? cw / total : 0,
      items: [...ci].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    };
  });
  const recent = list.filter((i) => ageH(i.publishedAt, now) <= 24 * 7);
  const older = list.filter((i) => ageH(i.publishedAt, now) > 24 * 7);
  const r = weightedScore(recent, now);
  const o = weightedScore(older, now);
  const weekly = [3, 2, 1, 0].map((k) => {
    const wk = list.filter((i) => {
      const h = ageH(i.publishedAt, now);
      return h > k * 168 && h <= (k + 1) * 168;
    });
    const v = weightedScore(wk, now);
    return v == null ? null : Math.round(v);
  });
  return {
    marketId: marketId ?? 'all',
    score: total > 0 ? categories.reduce((a, c) => a + c.contribution, 0) : 0,
    count: list.length,
    trend: r != null && o != null ? r - o : NaN,
    weekly,
    categories,
    items: [...list].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  };
}

export function allMarketSentiments(items: NewsItem[], now = Date.now()): Record<string, MarketSentiment> {
  return Object.fromEntries(MARKETS.map((m) => [m.id, sentimentFor(items, now, m.id)]));
}

/** Convert ranked news items into the legacy Headline list used by older panels (spotlight, SpaceX, Mock Index). */
export function toHeadlines(items: NewsItem[], n = 40, now = Date.now()): Headline[] {
  return [...items]
    .sort((a, b) => rankScore(b, 'week', now) - rankScore(a, 'week', now))
    .slice(0, n)
    .map((i) => ({ ...i, theme: guessTheme(i.title) }));
}

function guessTheme(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/export|sanction|huawei|ascend/.test(t)) return 'Export Controls';
  if (/chips act|subsidy/.test(t)) return 'CHIPS Act';
  if (/taiwan|strait/.test(t)) return 'Taiwan Risk';
  if (/tariff/.test(t)) return 'China Tariffs';
  if (/power|energy|grid|electricity|nuclear|gas|turbine/.test(t)) return 'Energy & Power';
  if (/antitrust|doj|ftc|probe/.test(t)) return 'Antitrust';
  if (/hbm|dram|memory|micron|hynix/.test(t)) return 'Memory Bottleneck';
  if (/trump|\bxi\b|rare earth/.test(t)) return 'Trump–Xi Rare Earths & AI';
  return 'AI Capex Boom';
}
