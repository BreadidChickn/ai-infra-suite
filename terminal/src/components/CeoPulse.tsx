import { useEffect, useMemo, useState } from 'react';
import type { Company, Relationship, Segment } from '../types';
import type { CeoPulseState } from '../hooks/useCeoPulse';
import { KEY_MAN_RULES, MIN_CEO_HEADLINES, ceoShare, sleeveExposure, type CeoHeadline, type CeoResult, type KeyManRisk } from '../services/ceoPulse';
import { loadTraderData, type TraderData } from '../services/trader';
import { SENT_BAND_HELP, sentBand } from '../services/themeScores';
import { fmtLocal, relTime } from './NewsPulse';
import type { NewsItem } from '../services/newsFeed';
import { openGlossary } from '../data/glossary';

/** Segment groups for the filter. */
const GROUPS: { id: string; label: string; segs: Segment[] }[] = [
  { id: 'chips', label: 'Chips & design', segs: ['chip_designer', 'ip', 'eda', 'investor'] },
  { id: 'fab', label: 'Foundry & equipment', segs: ['foundry', 'equipment'] },
  { id: 'memory', label: 'Memory', segs: ['memory'] },
  { id: 'cloud', label: 'Cloud & hyperscalers', segs: ['hyperscaler', 'cloud'] },
  { id: 'ai', label: 'AI labs & compute', segs: ['ai_lab', 'startup', 'space', 'oem'] },
  { id: 'energy', label: 'Power & energy', segs: ['energy_utility', 'energy_nuclear', 'energy_gas', 'energy_turbines', 'energy_renewables', 'energy_wind', 'energy_geothermal', 'energy_biofuel', 'energy_grid'] },
];
const groupOf = (s?: Segment) => GROUPS.find((g) => s && g.segs.includes(s))?.id ?? 'other';

type SortKey = 'score' | 'score_asc' | 'coverage' | 'risk';
const RISK_ORDER: Record<KeyManRisk, number> = { High: 0, Elevated: 1, Low: 2, 'Not rated': 3 };

export const NOT_IN_COMPOSITE =
  'Context only: CEO news sentiment is a soft, headline-only signal. It is NOT included in the composite score and NOT used by the trader.';

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="ceo-score none" title={`Fewer than ${MIN_CEO_HEADLINES} matching headlines in 30 days`}>n/a</span>;
  return (
    <span className={`ceo-score bg-${sentBand(score)}`} title={SENT_BAND_HELP}>
      {score > 0 ? '+' : ''}
      {score}
    </span>
  );
}

function RiskBadge({ risk }: { risk: KeyManRisk }) {
  return (
    <span className={`ceo-risk risk-${risk.replace(' ', '-').toLowerCase()}`} title={KEY_MAN_RULES}>
      key-man: {risk}
    </span>
  );
}

function HeadlineRow({ h }: { h: CeoHeadline }) {
  return (
    <li>
      <div className="hl-row">
        <span className={`sent-chip ${h.sentiment >= 0 ? 'up' : 'down'}`}>
          {h.sentiment >= 0 ? '+' : ''}
          {(h.sentiment * 100).toFixed(0)}
        </span>
        <a href={h.url} target="_blank" rel="noreferrer">
          {h.title}
        </a>
      </div>
      <div className="hl-meta">
        <span>{h.source}</span>
        <span title={fmtLocal(h.publishedAt, true)}>{relTime(h.publishedAt)}</span>
        <span className="ceo-tags">
          {h.events.length ? h.events.map((t) => <span key={t} className={`ceo-tag tag-${t.replace(' ', '-')}`}>{t}</span>) : <span className="ceo-tag tag-none">no event tag</span>}
        </span>
      </div>
    </li>
  );
}

function CeoCard({ r, onOpen, spotlight, share }: { r: CeoResult; onOpen: (id: string) => void; spotlight?: boolean; share: { share: number; n: number } | null }) {
  const [more, setMore] = useState(false);
  const list = more ? r.items.slice(0, 12) : r.top;
  return (
    <article className={`ceo-card ${spotlight ? 'spot' : ''} risk-border-${r.risk.replace(' ', '-').toLowerCase()}`}>
      <header>
        <div className="ceo-id">
          <h4>{r.ceo.name}</h4>
          <div className="tiny muted">
            {r.ceo.title} ·{' '}
            {r.company ? (
              <button type="button" className="linkish" onClick={() => onOpen(r.company!.id)} title="Open company drill-down">
                {r.company.name}
                {r.ceo.ticker ? ` (${r.ceo.ticker})` : ''}
              </button>
            ) : (
              r.ceo.companyId
            )}
          </div>
        </div>
        <ScorePill score={r.score} />
      </header>
      <div className="ceo-meta">
        <span className="ts-badge news">{r.count} headline{r.count === 1 ? '' : 's'} · 30d</span>
        <RiskBadge risk={r.risk} />
        {!r.fetched && <span className="ts-badge seed">not loaded</span>}
        <span className="ts-badge seed" title="Of the live main-feed headlines tagged with this company (30d), the share that also name the CEO. Rough gauge of how much the company's coverage runs through one person.">
          CEO share {share ? `${Math.round(share.share * 100)}% of ${share.n}` : 'n/a'}
        </span>
      </div>
      {r.riskItems.length > 0 && (
        <p className="ceo-flag tiny">
          Flag set by {r.riskItems.length} headline{r.riskItems.length === 1 ? '' : 's'}, e.g. “{r.riskItems[0].title}” — {r.riskItems[0].source}
        </p>
      )}
      {r.score == null && r.fetched && <p className="panel-note">Not enough coverage (needs ≥{MIN_CEO_HEADLINES} matching headlines).</p>}
      <p className="ceo-driver">{r.driver}</p>
      {list.length > 0 && (
        <ul className="headline-list dense ceo-hl">
          {list.map((h) => (
            <HeadlineRow key={h.id} h={h} />
          ))}
        </ul>
      )}
      <div className="ceo-foot tiny muted">
        {r.items.length > 3 && (
          <button type="button" className="linkish" onClick={() => setMore((m) => !m)}>
            {more ? 'Show top 3' : `Show latest ${Math.min(12, r.items.length)}`}
          </button>
        )}
        <a href={r.ceo.sourceUrl} target="_blank" rel="noreferrer" title={`Role verified ${r.ceo.verifiedAt}`}>
          role source ({r.ceo.verifiedAt})
        </a>
      </div>
    </article>
  );
}

/** Sleeve exposure to Elevated/High key-man-risk CEOs — used in CEO Pulse and on the AI Trader tab. */
export function SleeveCeoExposure({
  data,
  results,
  companies,
  relationships,
  compact,
}: {
  data: TraderData | null;
  results: CeoResult[];
  companies: Company[];
  relationships: Relationship[];
  compact?: boolean;
}) {
  const rows = useMemo(() => sleeveExposure(data, results, companies, relationships), [data, results, companies, relationships]);
  const flagged = results.filter((r) => r.risk === 'High' || r.risk === 'Elevated');
  const anyHoldings = rows.some((r) => r.basis === 'positions');
  const anyPlan = rows.some((r) => r.basis === 'plan');
  const anyDry = rows.some((r) => r.dryRun);
  return (
    <div className={`ceo-exposure ${compact ? 'compact' : ''}`}>
      <h4>
        Sleeve exposure to flagged CEOs{' '}
        {anyDry && <span className="ts-badge seed">DRY-RUN</span>}{' '}
        {rows.some((r) => r.mode === 'paper') && <span className="ts-badge seed">PAPER</span>}{' '}
        {rows.some((r) => r.example) && <span className="ts-badge seed">EXAMPLE DATA</span>}
      </h4>
      <p className="tiny muted">
        Flagged = key-man risk Elevated or High ({flagged.length ? flagged.map((r) => `${r.ceo.name} · ${r.ceo.ticker ?? r.company?.name ?? ''} · ${r.risk}`).join('; ') : 'none right now'}).
        Direct = % of sleeve value in the flagged company. <b>Linked exposure</b> = % in companies connected to a flagged company in the relationship graph (suppliers, customers, partners, investors, power and cloud links; competitors excluded) — indirect, shown separately. Display-only.
      </p>
      {!data ? (
        <p className="panel-note">Loading the bot&apos;s records…</p>
      ) : !data.ok ? (
        <p className="panel-note">The bot&apos;s records aren&apos;t available on this terminal ({data.error}). No exposure is estimated.</p>
      ) : !rows.length ? (
        <p className="panel-note">No per-sleeve equity records posted yet, so holdings per sleeve aren&apos;t available. No exposure is estimated.</p>
      ) : (
        <>
          <p className="tiny muted">
            Basis:{' '}
            {anyHoldings ? 'positions in each sleeve’s latest equity record' : 'no sleeve holds positions in its latest equity record (all cash)'}
            {anyPlan ? '; where a sleeve holds nothing, its latest cycle’s planned orders are shown instead (PLAN — no orders placed when DRY-RUN)' : ''}.
          </p>
          <div className="table-wrap">
            <table className="ceo-exp-table">
              <thead>
                <tr>
                  <th>Sleeve</th>
                  <th>Basis</th>
                  <th className="num">Direct</th>
                  <th>Names</th>
                  <th className="num">Linked</th>
                  {!compact && <th>Linked via</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sleeve}>
                    <td title={r.label}>
                      <b>{r.sleeve}</b> <span className="tiny muted">${r.sleeveValue.toFixed(0)}</span>
                    </td>
                    <td className="tiny">
                      {r.basis === 'positions' ? 'holdings' : r.basis === 'plan' ? (r.dryRun ? 'dry-run plan' : 'plan') : 'all cash'} · {r.mode}
                    </td>
                    <td className="num mono">{r.basis === 'none' ? '—' : `${r.directPct.toFixed(1)}%`}</td>
                    <td className="tiny">{r.direct.length ? r.direct.map((l) => `${l.ticker} ${l.pct.toFixed(1)}% (${l.note})`).join('; ') : '—'}</td>
                    <td className="num mono">{r.basis === 'none' ? '—' : `${r.linkedPct.toFixed(1)}%`}</td>
                    {!compact && <td className="tiny">{r.linked.length ? r.linked.map((l) => `${l.ticker} ${l.pct.toFixed(1)}% ↔ ${l.note}`).join('; ') : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Plain-language explainer for the key-man risk dilemma (advisor draft, edited). Live figures only; no invented stats. */
function KeyManSection({ results, isMobile }: { results: CeoResult[]; isMobile: boolean }) {
  const rated = results.filter((r) => r.risk !== 'Not rated');
  const high = results.filter((r) => r.risk === 'High');
  const elev = results.filter((r) => r.risk === 'Elevated');
  return (
    <details className="keyman-section" open={!isMobile}>
      <summary>
        <b>Key-man risk — the dilemma</b>{' '}
        <span className="tiny muted">
          live now: {high.length} High · {elev.length} Elevated of {rated.length} rated CEOs
        </span>
      </summary>
      <div className="keyman-body">
        <p>
          <b>What it is.</b> Key-man risk is the chance that a company&apos;s value depends heavily on one person, usually a founder-CEO. If that
          person leaves, falls ill, faces an investigation or loses the board&apos;s confidence, the stock can reprice quickly.
        </p>
        <p>
          <b>The dilemma.</b> The same person who creates the premium creates the risk. A visionary CEO can be the reason a stock trades richly —
          vision, customer relationships, hiring pull and credibility with investors. That concentration also means one event (succession, health,
          a departure, legal or political exposure) can take part of the premium away. In AI infrastructure a few highly visible, founder-led CEOs —
          for example Jensen Huang at NVIDIA, or Elon Musk across SpaceX and Tesla — are closely tied to their companies&apos; strategy, partnerships and
          coverage. These are examples of concentration, not claims about any event; because those companies sit at the centre of supply chains,
          the risk can spread to suppliers and customers.
        </p>
        <p><b>How the terminal reads it.</b></p>
        <ul>
          <li><b>Sentiment score</b> — tone of the last 30 days of headlines naming the CEO (same weighting as Theme Scores). There is no history yet, so it is not compared with a “normal” level.</li>
          <li><b>Key-man flag</b> (Low / Elevated / High) — set by event-tagged headlines about departure, succession, health, investigation, controversy / legal matters, or insider selling. The headline that set it off is shown on each card.</li>
          <li><b>CEO share</b> — how much of the company&apos;s live news also names the CEO, a rough gauge of dependence on one person.</li>
          <li><b>Sleeve exposure</b> — the share of each trader sleeve held in companies with a flagged CEO, directly and (separately) through the relationship graph.</li>
        </ul>
        <p><b>How to use it.</b></p>
        <ul>
          <li>A warning light for risk sizing and for weighing short- vs long-term views — not a buy or sell signal. Display-only: it does not feed the composite score or the trader.</li>
          <li>One negative headline is noise; a flag matters when several sources report the same event.</li>
          <li>Ways to reduce the risk: hold more names, cap each name&apos;s weight, and watch linked exposure, not just direct holdings.</li>
        </ul>
        <p>
          <b>Limits.</b> News sentiment has no point-in-time history in this terminal, so this panel <b>has not been backtested yet</b> (a planned test
          uses past CEO departures from SEC 8-K Item 5.02 filings, where leadership changes are formally disclosed). Headlines can be wrong,
          duplicated or about the wrong person. Education only, not financial advice.
        </p>
        <p className="tiny">
          Glossary:{' '}
          <button type="button" className="linkish" onClick={() => openGlossary('key-man-risk')}>Key-man risk</button> ·{' '}
          <button type="button" className="linkish" onClick={() => openGlossary('ceo-pulse')}>CEO Pulse</button> ·{' '}
          <button type="button" className="linkish" onClick={() => openGlossary('sentiment-score')}>Sentiment score</button> ·{' '}
          <button type="button" className="linkish" onClick={() => openGlossary('headline-risk')}>Headline risk</button>
        </p>
      </div>
    </details>
  );
}

export function CeoPulse({
  pulse,
  companies,
  relationships,
  onOpenCompany,
  feedItems,
  isMobile,
}: {
  pulse: CeoPulseState;
  companies: Company[];
  relationships: Relationship[];
  onOpenCompany: (id: string) => void;
  /** Live main-feed items (empty when the feed is seed/offline) — for CEO share */
  feedItems: NewsItem[];
  isMobile: boolean;
}) {
  const shares = useMemo(
    () => new Map(pulse.results.map((r) => [`${r.ceo.companyId}-${r.ceo.name}`, ceoShare(r.ceo, feedItems, companies)])),
    [pulse.results, feedItems, companies]
  );
  const [group, setGroup] = useState('all');
  const [sort, setSort] = useState<SortKey>('score');
  const [trader, setTrader] = useState<TraderData | null>(null);
  // Deep link: ?tab=sentiment#ceo-pulse scrolls the panel into view once the page has laid out.
  useEffect(() => {
    if (window.location.hash !== '#ceo-pulse') return;
    const t = window.setTimeout(() => document.getElementById('ceo-pulse')?.scrollIntoView({ block: 'start' }), 2500);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    let off = false;
    void loadTraderData().then((d) => !off && setTrader(d));
    return () => {
      off = true;
    };
  }, []);

  const spot = pulse.results.filter((r) => r.ceo.spotlight);
  const rest = useMemo(() => {
    const list = pulse.results.filter((r) => !r.ceo.spotlight && (group === 'all' || groupOf(r.company?.segment) === group));
    const rated = list.filter((r) => r.score != null);
    const unrated = list.filter((r) => r.score == null);
    const cmp: Record<SortKey, (a: CeoResult, b: CeoResult) => number> = {
      score: (a, b) => (b.score ?? 0) - (a.score ?? 0),
      score_asc: (a, b) => (a.score ?? 0) - (b.score ?? 0),
      coverage: (a, b) => b.count - a.count,
      risk: (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.score ?? 0) - (b.score ?? 0),
    };
    // Default: rank by tone among CEOs with enough coverage — never by raw volume. Thin coverage goes last.
    if (sort === 'coverage') return [...list].sort(cmp.coverage);
    if (sort === 'risk') return [...list].sort(cmp.risk);
    return [...rated.sort(cmp[sort]), ...unrated.sort((a, b) => b.count - a.count)];
  }, [pulse.results, group, sort]);

  const loaded = pulse.queriesOk;
  return (
    <div className="panel ceo-panel" id="ceo-pulse">
      <h3>
        CEO Pulse <span className="tiny muted">(news sentiment about the people running AI infrastructure · −100 → +100)</span>
        <span className="help-dot" title={`Per-CEO Google News query (≤4 at a time, 15-min cache). A headline counts only if it names the CEO and relates to the company. Score = weighted mean sentiment over 30 days (quality × recency × coverage), shown only with ≥${MIN_CEO_HEADLINES} headlines. ${SENT_BAND_HELP}. Key-man risk: ${KEY_MAN_RULES}`}>
          ⓘ
        </span>
      </h3>
      <p className="ceo-note">{NOT_IN_COMPOSITE}</p>
      <KeyManSection results={pulse.results} isMobile={isMobile} />
      <div className="ceo-status tiny muted">
        {pulse.status === 'loading' ? `Refreshing CEO headlines… ${loaded}/${pulse.queriesTotal} loaded` : `${loaded}/${pulse.queriesTotal} CEO queries loaded`}
        {pulse.fetchedAt && ` · updated ${fmtLocal(pulse.fetchedAt, true)}`}
        <button type="button" className="linkish" onClick={pulse.refresh} disabled={pulse.status === 'loading'}>
          ↻ Refresh
        </button>
      </div>

      {spot.map((r) => (
        <CeoCard key={r.ceo.name} r={r} onOpen={onOpenCompany} spotlight share={shares.get(`${r.ceo.companyId}-${r.ceo.name}`) ?? null} />
      ))}

      <SleeveCeoExposure data={trader} results={pulse.results} companies={companies} relationships={relationships} compact={isMobile} />

      <div className="ceo-controls">
        <label>
          Segment{' '}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">All segments</option>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="score">Score (high → low)</option>
            <option value="score_asc">Score (low → high)</option>
            <option value="risk">Key-man risk</option>
            <option value="coverage">Coverage (headline count)</option>
          </select>
        </label>
        <span className="tiny muted">{rest.length} CEOs · coverage = headline count only (no history yet, so no “vs typical” baseline)</span>
      </div>
      <div className="ceo-grid">
        {rest.map((r) => (
          <CeoCard key={`${r.ceo.companyId}-${r.ceo.name}`} r={r} onOpen={onOpenCompany} share={shares.get(`${r.ceo.companyId}-${r.ceo.name}`) ?? null} />
        ))}
      </div>
    </div>
  );
}
