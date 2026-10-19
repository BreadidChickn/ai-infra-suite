import { useEffect, useMemo, useState } from 'react';
import type { Company, NewsCategory, Relationship } from '../types';
import type { NewsItem, MarketSentiment, CategoryBreakdown } from '../services/newsFeed';
import { allMarketSentiments } from '../services/newsFeed';
import { CATEGORY_COLORS, CATEGORY_LABELS, MARKETS, MARKET_BY_ID, companiesInMarket, type MarketDef } from '../data/markets';
import { RELATION_LABELS, isEnergySegment } from '../data/constants';
import { displayCode, fmtPct, pctClass } from '../utils/format';
import { NewsRow, SentChip } from './NewsPulse';

interface GridProps {
  items: NewsItem[];
  companies: Company[];
  relationships: Relationship[];
  isMobile: boolean;
  compact?: boolean;
  /** Controlled open market (lets other widgets, e.g. News Pulse tags, open the panel) */
  openId: string | null;
  onOpen: (id: string | null) => void;
  onOpenFinancials: (companyId: string) => void;
  onOpenCompany?: (c: Company) => void;
}

const CATS: NewsCategory[] = ['political', 'investment', 'operations', 'other'];

const scoreClass = (v: number) => (v > 5 ? 'up' : v < -5 ? 'down' : 'flat');

export function Sparkline({ values, color = '#8fa3c4', w = 64, h = 20 }: { values: (number | null)[]; color?: string; w?: number; h?: number }) {
  const pts = values.map((v, i) => ({ v, x: (i / Math.max(values.length - 1, 1)) * (w - 4) + 2 }));
  const y = (v: number) => h / 2 - (v / 100) * (h / 2 - 2);
  const path = pts
    .filter((p) => p.v != null)
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${y(p.v!).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="sparkline" aria-hidden>
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="#243354" strokeDasharray="2,2" />
      {path && <path d={path} fill="none" stroke={color} strokeWidth={1.6} />}
      {pts.map((p, i) => (p.v != null ? <circle key={i} cx={p.x} cy={y(p.v)} r={1.8} fill={color} /> : null))}
    </svg>
  );
}

function ContributionBar({ cats }: { cats: CategoryBreakdown[] }) {
  return (
    <div className="contrib-bar" aria-label="Share of headline weight by category">
      {cats
        .filter((c) => c.share > 0)
        .map((c) => (
          <span
            key={c.category}
            style={{ width: `${c.share * 100}%`, background: CATEGORY_COLORS[c.category] }}
            title={`${CATEGORY_LABELS[c.category]}: ${(c.share * 100).toFixed(0)}% of weight, ${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(1)} pts`}
          />
        ))}
    </div>
  );
}

function TrendTag({ t }: { t: number }) {
  if (Number.isNaN(t)) return <span className="tiny muted">trend n/a</span>;
  const cls = t > 3 ? 'up' : t < -3 ? 'down' : 'flat';
  return (
    <span className={`mono tiny ${cls}`} title="Last 7 days vs days 8–30">
      {t > 3 ? '▲' : t < -3 ? '▼' : '▶'} {t >= 0 ? '+' : ''}
      {t.toFixed(0)}
    </span>
  );
}

function MarketCard({ m, s, n, onOpen }: { m: MarketDef; s: MarketSentiment; n: number; onOpen: () => void }) {
  return (
    <button type="button" className="mk-card" onClick={onOpen} style={{ borderTopColor: m.color }}>
      <div className="mk-card-top">
        <span className="mk-card-label">{m.label}</span>
        <span className={`mk-card-score mono ${scoreClass(s.score)}`}>
          {s.count ? `${s.score >= 0 ? '+' : ''}${s.score.toFixed(0)}` : '—'}
        </span>
      </div>
      <ContributionBar cats={s.categories} />
      <div className="mk-card-foot">
        <TrendTag t={s.trend} />
        <Sparkline values={s.weekly} color={m.color} w={52} h={16} />
        <span className="tiny muted">
          {s.count} news · {n} cos
        </span>
      </div>
    </button>
  );
}

/** Rule-based "how this affects AI infra" sentence for a category's net contribution. */
function templateFor(m: MarketDef, c: CategoryBreakdown): string {
  if (!c.count) return `No ${CATEGORY_LABELS[c.category].toLowerCase()} headlines tagged to ${m.short} in the last 30 days.`;
  const strong = Math.abs(c.avg) >= 25;
  const pos = c.avg > 5;
  const neg = c.avg < -5;
  const share = `${(c.share * 100).toFixed(0)}% of this market’s news weight`;
  switch (c.category) {
    case 'political':
      return pos
        ? `Policy news is net supportive (${share}) — approvals, financing or eased restrictions tend to de-risk ${m.aiChannel}.`
        : neg
          ? `Policy news is net negative${strong ? ' and loud' : ''} (${share}) — expect delay or higher cost for ${m.aiChannel}.`
          : `Policy news is mixed (${share}) — no clear push on ${m.aiChannel} yet.`;
    case 'investment':
      return pos
        ? `Capital and contracts are flowing in (${share}) — more funded capacity behind ${m.aiChannel}.`
        : neg
          ? `Financing / valuation headwinds (${share}) — watch for slower or smaller commitments to ${m.aiChannel}.`
          : `Investment news is balanced (${share}) — commitments are steady rather than accelerating.`;
    case 'operations':
      return pos
        ? `Execution and production news is constructive (${share}) — supports delivery timelines for ${m.aiChannel}.`
        : neg
          ? `Operational bottlenecks — delays, shortages or outages (${share}) — are a timeline risk for ${m.aiChannel}.`
          : `Operations news is neutral (${share}) — no major bottleneck or breakthrough flagged.`;
    default:
      return `General coverage (${share}) without a clear policy, capital or production angle.`;
  }
}

function MarketPanel({
  m,
  s,
  companies,
  relationships,
  isMobile,
  onClose,
  onOpenFinancials,
  onOpenCompany,
}: {
  m: MarketDef;
  s: MarketSentiment;
  companies: Company[];
  relationships: Relationship[];
  isMobile: boolean;
  onClose: () => void;
  onOpenFinancials: (id: string) => void;
  onOpenCompany?: (c: Company) => void;
}) {
  const now = Date.now();
  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const members = useMemo(() => companiesInMarket(companies, m.id).sort((a, b) => b.marketCapB - a.marketCapB), [companies, m.id]);
  const memberIds = useMemo(() => new Set(members.map((c) => c.id)), [members]);
  const links = useMemo(
    () =>
      relationships.filter((r) => {
        const inS = memberIds.has(r.source);
        const inT = memberIds.has(r.target);
        if (inS === inT) return false;
        // For energy markets show links into the AI-infra core; for AI markets show links into energy.
        const other = byId.get(inS ? r.target : r.source);
        return !!other && (m.energy ? !isEnergySegment(other.segment) : isEnergySegment(other.segment));
      }),
    [relationships, memberIds, byId, m.energy]
  );
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const top = [...s.categories].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0];
    return { [top?.category ?? 'political']: true, companies: !isMobile };
  });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const body = (
    <>
      <header className="mk-panel-head" style={{ borderBottomColor: m.color }}>
        <div>
          <div className="mk-panel-kicker" style={{ color: m.color }}>
            {m.energy ? 'Energy market' : 'AI-infra market'} · drill-down
          </div>
          <h2>{m.label}</h2>
          <p className="drawer-summary">{m.blurb}</p>
        </div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close market drill-down">
          ✕
        </button>
      </header>

      <div className="mk-kpis">
        <div>
          <span className="perf-label">Sentiment (30d)</span>
          <span className={`mk-kpi-val mono ${scoreClass(s.score)}`}>
            {s.count ? `${s.score >= 0 ? '+' : ''}${s.score.toFixed(0)}` : '—'}
          </span>
        </div>
        <div>
          <span className="perf-label">Trend 7d vs prior</span>
          <span className="mk-kpi-val">
            <TrendTag t={s.trend} />
          </span>
        </div>
        <div>
          <span className="perf-label">Weekly (4w)</span>
          <Sparkline values={s.weekly} color={m.color} w={80} h={26} />
        </div>
        <div>
          <span className="perf-label">Headlines</span>
          <span className="mk-kpi-val mono">{s.count}</span>
        </div>
      </div>

      <section className="drawer-section">
        <h3>Sentiment drivers</h3>
        <ContributionBar cats={s.categories} />
        <table className="data-table compact mk-driver-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>News</th>
              <th title="Weighted mean sentiment of this category">Avg</th>
              <th title="Points added to the market score (sum = market score)">Contrib.</th>
              <th title="Share of total headline weight">Share</th>
            </tr>
          </thead>
          <tbody>
            {s.categories.map((c) => (
              <tr key={c.category}>
                <td>
                  <span className="swatch" style={{ background: CATEGORY_COLORS[c.category] }} /> {CATEGORY_LABELS[c.category]}
                </td>
                <td className="mono">{c.count}</td>
                <td className={`mono ${scoreClass(c.avg)}`}>{c.count ? c.avg.toFixed(0) : '—'}</td>
                <td className={`mono ${scoreClass(c.contribution)}`}>
                  {c.count ? `${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(1)}` : '—'}
                </td>
                <td className="mono">{c.count ? `${(c.share * 100).toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny muted">
          Contribution = Σ(weight × sentiment) of the category ÷ Σ weight of all the market’s headlines × 100, so the four contributions add up to
          the market score. Weight = source quality × recency × coverage.
        </p>
      </section>

      {CATS.map((cat) => {
        const c = s.categories.find((x) => x.category === cat)!;
        if (cat === 'other' && !c.count) return null;
        const isOpen = !!open[cat];
        return (
          <section key={cat} className={`drawer-section mk-cat ${isOpen ? 'open' : ''}`}>
            <button type="button" className="mk-cat-head" onClick={() => toggle(cat)} aria-expanded={isOpen}>
              <span className="swatch" style={{ background: CATEGORY_COLORS[cat] }} />
              <span className="mk-cat-title">{CATEGORY_LABELS[cat]}</span>
              <span className={`mono ${scoreClass(c.contribution)}`}>
                {c.count ? `${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(1)} pts` : '—'}
              </span>
              <span className="tiny muted">{c.count} news</span>
              <span className="mk-cat-chev" aria-hidden>
                {isOpen ? '▾' : '▸'}
              </span>
            </button>
            {isOpen && (
              <div className="mk-cat-body">
                <div className="mk-impact">
                  <div className="perf-label">How this affects AI infrastructure</div>
                  <p>
                    <strong>Now: </strong>
                    {templateFor(m, c)}
                  </p>
                  {cat !== 'other' && <p className="muted">{m.impact[cat]}</p>}
                </div>
                {c.items.length ? (
                  <ul className="news-list">
                    {c.items.slice(0, 8).map((i) => (
                      <NewsRow key={i.id} item={i} byId={byId} now={now} />
                    ))}
                  </ul>
                ) : (
                  <p className="tiny muted">No headlines in this category.</p>
                )}
              </div>
            )}
          </section>
        );
      })}

      <section className={`drawer-section mk-cat ${open.companies ? 'open' : ''}`}>
        <button type="button" className="mk-cat-head" onClick={() => toggle('companies')} aria-expanded={!!open.companies}>
          <span className="swatch" style={{ background: m.color }} />
          <span className="mk-cat-title">Affected companies</span>
          <span className="tiny muted">{members.length}</span>
          <span className="mk-cat-chev" aria-hidden>
            {open.companies ? '▾' : '▸'}
          </span>
        </button>
        {open.companies && (
          <div className="mk-cat-body">
            <ul className="mk-co-list">
              {members.map((c) => {
                const mentions = s.items.filter((i) => i.companies.includes(c.id));
                const avg = mentions.length ? mentions.reduce((a, i) => a + i.sentiment, 0) / mentions.length : null;
                return (
                  <li key={c.id}>
                    <div className="mk-co-main">
                      <strong className="mono">{displayCode(c)}</strong>
                      <span>{c.name}</span>
                      {c.aiLink && <span className={`strength-pill ${c.aiLink.strength}`}>{c.aiLink.strength} AI link</span>}
                    </div>
                    <div className="mk-co-meta">
                      <span className={`mono ${pctClass(c.change1D)}`}>1D {fmtPct(c.change1D)}</span>
                      <span className={`mono ${pctClass(c.changeYTD)}`}>YTD {fmtPct(c.changeYTD)}</span>
                      <span className="tiny muted">
                        {mentions.length} news{avg != null ? ` · avg ` : ''}
                      </span>
                      {avg != null && <SentChip v={avg} />}
                    </div>
                    {c.aiLink && (
                      <p className="tiny muted mk-co-link">
                        {c.aiLink.summary}{' '}
                        <a href={c.aiLink.url} target="_blank" rel="noreferrer">
                          {c.aiLink.source}, {c.aiLink.date}
                        </a>
                      </p>
                    )}
                    <div className="mk-co-actions">
                      <button type="button" className="chip" onClick={() => onOpenFinancials(c.id)}>
                        Financials →
                      </button>
                      {onOpenCompany && (
                        <button type="button" className="chip" onClick={() => onOpenCompany(c)}>
                          Drill-down
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {links.length > 0 && (
        <section className="drawer-section">
          <h3>{m.energy ? 'AI-infra counterparties' : 'Energy suppliers & partners'}</h3>
          <ul className="mk-links">
            {links.map((r) => {
              const a = byId.get(r.source);
              const b = byId.get(r.target);
              if (!a || !b) return null;
              return (
                <li key={r.id}>
                  <span className="mono">
                    {displayCode(a)} → {displayCode(b)}
                  </span>{' '}
                  <span className="tiny" style={{ color: '#FFAB40' }}>
                    {RELATION_LABELS[r.type]}
                  </span>{' '}
                  <strong>{r.label}</strong>
                  <p className="tiny muted">{r.detail}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="mk-sheet" role="dialog" aria-modal="true" aria-label={`${m.label} drill-down`}>
        {body}
      </div>
    );
  }
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="company-drawer mk-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${m.label} drill-down`}>
        {body}
      </aside>
    </div>
  );
}

export function MarketGrid({ items, companies, relationships, isMobile, compact, openId, onOpen, onOpenFinancials, onOpenCompany }: GridProps) {
  const sentiments = useMemo(() => allMarketSentiments(items), [items]);
  const [layer, setLayer] = useState<'all' | 'ai' | 'energy'>('all');
  const groups = [
    { id: 'ai', title: 'AI infrastructure markets', list: MARKETS.filter((m) => !m.energy) },
    { id: 'energy', title: 'Energy markets', list: MARKETS.filter((m) => m.energy) },
  ].filter((g) => layer === 'all' || g.id === layer);
  const counts = useMemo(() => Object.fromEntries(MARKETS.map((m) => [m.id, companiesInMarket(companies, m.id).length])), [companies]);
  const openDef = openId ? MARKET_BY_ID[openId] : null;
  return (
    <div className={`panel mk-grid-panel ${compact ? 'compact' : ''}`}>
      <div className="table-toolbar">
        <h3>Market drill-down — tap a market</h3>
        <div className="seg-control small">
          {(['all', 'ai', 'energy'] as const).map((l) => (
            <button key={l} type="button" className={layer === l ? 'on' : ''} onClick={() => setLayer(l)}>
              {l === 'all' ? 'All' : l === 'ai' ? 'AI infra' : 'Energy'}
            </button>
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="mk-group">
          <div className="mk-group-title">{g.title}</div>
          <div className="mk-grid">
            {g.list.map((m) => (
              <MarketCard key={m.id} m={m} s={sentiments[m.id]} n={counts[m.id]} onOpen={() => onOpen(m.id)} />
            ))}
          </div>
        </div>
      ))}
      <p className="tiny muted">
        Score = weighted news sentiment over 30 days (−100…+100). Bar = share of news weight by driver:{' '}
        {(['political', 'investment', 'operations', 'other'] as NewsCategory[]).map((c) => (
          <span key={c} className="legend-inline">
            <span className="swatch" style={{ background: CATEGORY_COLORS[c] }} /> {CATEGORY_LABELS[c]}
          </span>
        ))}
      </p>
      {openDef && (
        <MarketPanel
          key={openDef.id}
          m={openDef}
          s={sentiments[openDef.id]}
          companies={companies}
          relationships={relationships}
          isMobile={isMobile}
          onClose={() => onOpen(null)}
          onOpenFinancials={(id) => {
            onOpen(null);
            onOpenFinancials(id);
          }}
          onOpenCompany={
            onOpenCompany
              ? (c) => {
                  onOpen(null);
                  onOpenCompany(c);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
