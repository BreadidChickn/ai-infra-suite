import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Company, DataMode, Headline, Relationship, Segment } from '../types';
import { ENERGY_SEGMENTS, SEGMENT_COLORS, SEGMENT_LABELS, isEnergySegment } from '../data/constants';
import type { NewsFeedState } from '../hooks/useNewsFeed';
import { NewsPulse } from './NewsPulse';
import { MarketGrid } from './MarketDrilldown';
import { SPOTLIGHT_SEARCH_LINKS } from '../data/headlines';
import { COMPANY_CIKS } from '../data/secMeta';
import { SentimentGauge } from './SentimentGauge';
import { CompanyDrilldown } from './CompanyDrilldown';
import { displayCode, fmtPct, pctClass, pnlColor } from '../utils/format';

interface Props {
  companies: Company[];
  relationships: Relationship[];
  headlines: Headline[];
  mode: DataMode;
  news: NewsFeedState;
  /** Weighted live-news sentiment, −100…100 */
  newsScore: number;
  isMobile: boolean;
  onOpenFinancials: (id: string) => void;
  onOpenTab?: (tab: string) => void;
}

type SegFilter = Segment | 'all' | 'core' | 'energy';

type SortKey = 'name' | 'marketCapB' | 'change1D' | 'change1M' | 'changeYTD' | 'segment';

export function MarketsTab({ companies, relationships, headlines, mode, news, newsScore, isMobile, onOpenFinancials, onOpenTab }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('marketCapB');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [segFilter, setSegFilter] = useState<SegFilter>('all');
  const [marketOpen, setMarketOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Company | null>(null);

  const sorted = useMemo(() => {
    let list = [...companies];
    if (segFilter === 'energy') list = list.filter((c) => isEnergySegment(c.segment));
    else if (segFilter === 'core') list = list.filter((c) => !isEnergySegment(c.segment));
    else if (segFilter !== 'all') list = list.filter((c) => c.segment === segFilter);
    list.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av) || 0;
      const bn = Number(bv) || 0;
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return list;
  }, [companies, sortKey, sortDir, segFilter]);

  const sentimentScore = useMemo(() => {
    const publics = companies.filter((c) => !c.isPrivate && c.change1D != null);
    if (!publics.length) return 20;
    const avg1d = publics.reduce((s, c) => s + (c.change1D || 0), 0) / publics.length;
    const avgYtd = publics.reduce((s, c) => s + (c.changeYTD || 0), 0) / publics.length;
    // Live news refresher score (−100…100) replaces the old static headline average.
    const news = newsScore / 100;
    return Math.max(-100, Math.min(100, avg1d * 8 + avgYtd * 0.8 + news * 40));
  }, [companies, newsScore]);

  // Performance chart: SEC filers only (10-K/10-Q or 20-F/40-F/6-K — i.e. a CIK on file); names without SEC filings are
  // excluded, and companies without a YTD figure are skipped rather than plotted as 0.
  const barData = useMemo(
    () =>
      companies
        .filter((c) => isSecFiler(c) && c.changeYTD != null && !Number.isNaN(c.changeYTD))
        .sort((a, b) => (b.changeYTD as number) - (a.changeYTD as number))
        .slice(0, 12)
        .map((c) => ({
          name: displayCode(c),
          full: c.name,
          ytd: Number((c.changeYTD as number).toFixed(1)),
        })),
    [companies]
  );
  const excludedNonSec = useMemo(() => companies.filter((c) => !c.isPrivate && !isSecFiler(c)).map(displayCode), [companies]);

  const spotlight = useMemo(
    () => headlines.filter((h) => h.spotlight || h.theme?.includes('Trump') || h.theme?.includes('Rare')),
    [headlines]
  );

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'name' || k === 'segment' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="markets-layout">
      <aside className="strategy-note" role="note">
        <span className="strategy-note-icon" aria-hidden>ⓘ</span>
        <div>
          <strong>Read the scores together.</strong> Weigh the news-pulse and sentiment scores alongside your time horizon: headline
          sentiment moves fast and mostly matters for short-term positioning, while long-term theses rest on fundamentals (see Financials)
          and durable themes.{' '}
          {onOpenTab && (
            <button type="button" className="link-btn" onClick={() => onOpenTab('sentiment')}>
              Open Sentiment →
            </button>
          )}
          <div className="strategy-note-nfa">Not financial advice — for research and education only.</div>
        </div>
      </aside>
      {spotlight.length > 0 && (
        <div className="panel spotlight-card">
          <h3>Spotlight — Trump–Xi Rare Earths &amp; AI</h3>
          <p className="muted">
            Political risk: rare-earth leverage, AI guardrails talks, chip export controls, trade
            truce extension themes (as of Sep 24, 2026).
          </p>
          <ul className="headline-list">
            {spotlight.slice(0, 5).map((h) => (
              <li key={h.id}>
                <a href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>
                <div className="hl-meta">
                  <span>{h.source}</span>
                  <span>{new Date(h.publishedAt).toLocaleDateString()}</span>
                  <span className={`mono ${pctClass((h.sentiment ?? 0) * 100)}`}>
                    {fmtPct((h.sentiment ?? 0) * 100, 0)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="sec-links">
            {SPOTLIGHT_SEARCH_LINKS.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="markets-top">
        <div className="panel gauge-panel">
          <SentimentGauge score={sentimentScore} label="Overall Infra Sentiment" />
          <p className="panel-note">
            {mode !== 'live'
              ? 'Price changes may include curated illustrative figures when live quotes are unavailable.'
              : 'Quotes enriched via Yahoo Finance chart endpoint (free, no API key).'}
          </p>
        </div>
        <div className="panel chart-panel">
          <h3>YTD Performance — Top Public Names</h3>
          <div className="chart-sub tiny muted" title={excludedNonSec.length ? `Excluded (no SEC filings): ${excludedNonSec.join(', ')}` : undefined}>
            SEC filers only (10-K/10-Q or 20-F/40-F) · top 12 by YTD
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="name" tick={{ fill: '#8FA3C4', fontSize: 11 }} />
              <YAxis tick={{ fill: '#8FA3C4', fontSize: 11 }} unit="%" />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<YtdTooltip />} />
              <Bar dataKey="ytd" radius={[3, 3, 0, 0]}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={pnlColor(d.ytd)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="headlines-panel pulse-slot">
          <NewsPulse news={news} companies={companies} compact onOpenMarket={setMarketOpen} />
        </div>
      </div>

      <MarketGrid
        items={news.feed.items}
        companies={companies}
        relationships={relationships}
        isMobile={isMobile}
        compact
        openId={marketOpen}
        onOpen={setMarketOpen}
        onOpenFinancials={onOpenFinancials}
        onOpenCompany={(c) => setSelected(c)}
      />

      <div className="panel table-panel">
        <div className="table-toolbar">
          <h3>Company Performance — click row to drill down</h3>
          <select
            value={segFilter}
            onChange={(e) => setSegFilter(e.target.value as SegFilter)}
            aria-label="Filter by segment"
          >
            <option value="all">All segments ({companies.length})</option>
            <option value="core">AI infrastructure only</option>
            <option value="energy">Energy layer only</option>
            <optgroup label="AI infrastructure">
              {(Object.keys(SEGMENT_LABELS) as Segment[])
                .filter((s) => !isEnergySegment(s))
                .map((s) => (
                  <option key={s} value={s}>
                    {SEGMENT_LABELS[s]}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Energy">
              {ENERGY_SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="table-scroll desktop-only-table">
          <table className="data-table">
            <thead>
              <tr>
                {(
                  [
                    ['name', 'Company'],
                    ['segment', 'Segment'],
                    ['marketCapB', 'Mkt Cap ($B)'],
                    ['change1D', '1D'],
                    ['change1M', '1M'],
                    ['changeYTD', 'YTD'],
                  ] as [SortKey, string][]
                ).map(([k, label]) => (
                  <th key={k} onClick={() => toggleSort(k)}>
                    {label}
                    {sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="clickable-row" onClick={() => setSelected(c)}>
                  <td>
                    <strong className="mono">{displayCode(c)}</strong>{' '}
                    <span>{c.name}</span>
                    {c.isPrivate && <span className="tag-priv">PRIV</span>}
                    {c.aiLink && (
                      <span className={`strength-pill ${c.aiLink.strength}`} title={c.aiLink.summary}>
                        ⚡ {c.aiLink.strength}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="seg-pill" style={{ borderColor: SEGMENT_COLORS[c.segment] }}>
                      {SEGMENT_LABELS[c.segment]}
                    </span>
                  </td>
                  <td className="mono">{c.marketCapB.toLocaleString()}</td>
                  <td className={`mono ${pctClass(c.change1D)}`}>{fmtPct(c.change1D)}</td>
                  <td className={`mono ${pctClass(c.change1M)}`}>{fmtPct(c.change1M)}</td>
                  <td className={`mono ${pctClass(c.changeYTD)}`}>{fmtPct(c.changeYTD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="markets-card-list" role="list">
          {sorted.map((c) => (
            <button
              key={c.id}
              type="button"
              className="market-card"
              role="listitem"
              onClick={() => setSelected(c)}
            >
              <div className="market-card-top">
                <div>
                  <span className="mono market-card-code">{displayCode(c)}</span>
                  {c.isPrivate && <span className="tag-priv">PRIV</span>}
                  {c.aiLink && <span className={`strength-pill ${c.aiLink.strength}`}>⚡ {c.aiLink.strength}</span>}
                  <div className="market-card-name">{c.name}</div>
                </div>
                <span className="seg-pill" style={{ borderColor: SEGMENT_COLORS[c.segment] }}>
                  {SEGMENT_LABELS[c.segment]}
                </span>
              </div>
              <div className="market-card-metrics">
                <div>
                  <span className="perf-label">Mkt Cap</span>
                  <span className="mono">{c.marketCapB.toLocaleString()}B</span>
                </div>
                <div>
                  <span className="perf-label">1D</span>
                  <span className={`mono ${pctClass(c.change1D)}`}>{fmtPct(c.change1D)}</span>
                </div>
                <div>
                  <span className="perf-label">1M</span>
                  <span className={`mono ${pctClass(c.change1M)}`}>{fmtPct(c.change1M)}</span>
                </div>
                <div>
                  <span className="perf-label">YTD</span>
                  <span className={`mono ${pctClass(c.changeYTD)}`}>{fmtPct(c.changeYTD)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selected && <CompanyDrilldown company={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const isSecFiler = (c: Company) => !c.isPrivate && Boolean((c.cik || COMPANY_CIKS[c.id] || '').replace(/\D/g, ''));

/** Chart hover: YTD value coloured with the P&L tokens (green > 0, red < 0, grey at 0). */
function YtdTooltip({ active, payload }: { active?: boolean; payload?: { payload: { name: string; full: string; ytd: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">
        <span className="mono">{d.name}</span> {d.full}
      </div>
      <div>
        YTD: <span className={`mono ${pctClass(d.ytd)}`} style={{ color: pnlColor(d.ytd) }}>{fmtPct(d.ytd)}</span>
      </div>
    </div>
  );
}
