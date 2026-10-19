import { useMemo, useState } from 'react';
import type { Company } from '../types';
import type { NewsFeedState } from '../hooks/useNewsFeed';
import { LEXICON_SIZE, PHRASE_COUNT, sentimentFor, topForWindow, type NewsItem, type NewsWindow, WINDOW_N } from '../services/newsFeed';
import { CATEGORY_COLORS, CATEGORY_LABELS, MARKET_BY_ID } from '../data/markets';
import { displayCode } from '../utils/format';

interface Props {
  news: NewsFeedState;
  companies: Company[];
  compact?: boolean;
  /** Full mode: render "This month" as a collapsible dropdown (collapsed by default) below Today / This week. */
  collapsibleMonth?: boolean;
  onOpenMarket?: (marketId: string) => void;
}

const WINDOWS: { id: NewsWindow; label: string; sub: string }[] = [
  { id: 'day', label: 'Today', sub: 'Top 3 · last 24h' },
  { id: 'week', label: 'This week', sub: 'Top 5 · last 7 days' },
  { id: 'month', label: 'This month', sub: 'Top 10 · last 30 days' },
];

/** Viewer's local time (their browser time zone); `tz` appends the zone label, e.g. "MST". */
export function fmtLocal(iso: string, tz = false): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZoneName: 'short' } : {}) });
}

export function relTime(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function SentChip({ v }: { v: number }) {
  const n = Math.round(v * 100);
  return (
    <span className={`sent-chip ${n > 2 ? 'up' : n < -2 ? 'down' : 'flat'}`} title="Headline sentiment (−100…+100)">
      {n > 0 ? '+' : ''}
      {n}
    </span>
  );
}

export function CategoryPill({ c }: { c: NewsItem['category'] }) {
  return (
    <span className="cat-pill" style={{ borderColor: CATEGORY_COLORS[c], color: CATEGORY_COLORS[c] }}>
      {c === 'operations' ? 'Ops / Prod' : CATEGORY_LABELS[c]}
    </span>
  );
}

export function NewsRow({
  item,
  rank,
  byId,
  onOpenMarket,
  now,
}: {
  item: NewsItem;
  rank?: number;
  byId: Map<string, Company>;
  onOpenMarket?: (id: string) => void;
  now: number;
}) {
  return (
    <li className="news-row">
      <div className="news-row-main">
        {rank != null && <span className="news-rank mono">{rank}</span>}
        <SentChip v={item.sentiment} />
        <a href={item.url} target="_blank" rel="noreferrer" className="news-title">
          {item.title}
        </a>
      </div>
      <div className="news-meta">
        <span className="news-src" title={`Source quality ${Math.round(item.quality * 100)}/100`}>
          <span className={`q-dot q${item.quality >= 1 ? 1 : item.quality >= 0.8 ? 2 : item.quality >= 0.5 ? 3 : 4}`} />
          {item.source}
        </span>
        <time dateTime={item.publishedAt} title={new Date(item.publishedAt).toString()}>
          {fmtLocal(item.publishedAt)} · {relTime(item.publishedAt, now)}
        </time>
        <CategoryPill c={item.category} />
        {item.dupes > 0 && <span className="tiny muted">+{item.dupes} similar</span>}
      </div>
      {(item.markets.length > 0 || item.companies.length > 0) && (
        <div className="news-tags">
          {item.markets.slice(0, 3).map((m) => {
            const def = MARKET_BY_ID[m];
            if (!def) return null;
            return (
              <button
                key={m}
                type="button"
                className="mk-tag"
                style={{ borderColor: def.color, color: def.color }}
                onClick={() => onOpenMarket?.(m)}
                disabled={!onOpenMarket}
              >
                {def.short}
              </button>
            );
          })}
          {item.companies.slice(0, 4).map((id) => {
            const c = byId.get(id);
            return c ? (
              <span key={id} className="co-tag mono">
                {displayCode(c)}
              </span>
            ) : null;
          })}
        </div>
      )}
    </li>
  );
}

export function NewsPulse({ news, companies, compact, collapsibleMonth, onOpenMarket }: Props) {
  const { feed, status, stale, refresh } = news;
  const [win, setWin] = useState<NewsWindow>('day');
  const [help, setHelp] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const now = Date.now();
  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const seed = feed.mode === 'seed';
  const tops = useMemo(
    () => ({
      day: topForWindow(feed.items, 'day', now, WINDOW_N.day, seed),
      week: topForWindow(feed.items, 'week', now, WINDOW_N.week, seed),
      month: topForWindow(feed.items, 'month', now, WINDOW_N.month, seed),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed]
  );
  const overall = useMemo(() => sentimentFor(feed.items, now), [feed, now]);
  const monthCount = overall.count;

  const badge =
    feed.mode === 'live' ? (
      <span className="badge live">LIVE</span>
    ) : feed.mode === 'cache' ? (
      <span className="badge mixed" title="Showing the copy saved on this device">
        CACHED
      </span>
    ) : (
      <span className="badge illus" title="Google News unreachable — curated seed headlines">
        SEED · OFFLINE
      </span>
    );

  const header = (
    <div className="pulse-head">
      <div>
        <h3>
          News Pulse {badge}
          <span className={`pulse-overall ${overall.score >= 0 ? 'up' : 'down'}`} title="Weighted news sentiment, last 30 days">
            {overall.score >= 0 ? '+' : ''}
            {overall.score.toFixed(0)}
          </span>
        </h3>
        <div className="tiny muted">
          {status === 'loading' || status === 'refreshing' ? 'Refreshing headlines…' : `Refreshed ${fmtLocal(feed.fetchedAt, true)}`}
          {stale && status !== 'loading' && status !== 'refreshing' ? ' · stale' : ''} · {feed.items.length} stories
          {feed.mode !== 'seed' ? ` from ${feed.queriesOk}/${feed.queriesTotal} feeds` : ''}
        </div>
      </div>
      <div className="pulse-actions">
        <button type="button" className="chip" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          {help ? 'Hide method' : 'How scoring works'}
        </button>
        <button type="button" className="chip on" onClick={refresh} disabled={status === 'refreshing' || status === 'loading'}>
          {status === 'refreshing' || status === 'loading' ? '↻ …' : '↻ Refresh'}
        </button>
      </div>
    </div>
  );

  const helpBox = help && (
    <div className="pulse-help">
      <p>
        <strong>Fetch.</strong> On every open (if the saved copy is older than 15 min) the terminal pulls {feed.queriesTotal} Google News RSS
        searches covering AI chips, foundry, equipment, memory, cloud/hyperscalers, AI labs, policy/export controls, SpaceX and every energy market,
        plus the company universe. Near-duplicate stories (≥60% shared words) are merged; the extra outlets count as coverage.
      </p>
      <p>
        <strong>Tagging.</strong> Companies are matched by name/alias; markets by the company’s segment plus market keywords. Category is the
        best-scoring rule set: <em>Political</em> (tariffs, export controls, regulators, courts, permits), <em>Investment</em> (deals, funding,
        earnings, stock moves, PPAs/contracts), <em>Operations / Production</em> (capacity, supply, construction, restarts, delays, outages), else <em>Other</em>.
      </p>
      <p>
        <strong>Sentiment.</strong> A rule-based lexicon ({LEXICON_SIZE} finance/energy words + {PHRASE_COUNT} phrases, weighted −2…+2, e.g. “surge” +2, “delay” −1.2, “force majeure”
        −1.6). A negator within two words flips a term (×−0.7). The sum is squashed with s/√(s²+6) to −1…+1 and shown ×100. Titles only — no article text.
      </p>
      <p>
        <strong>Ranking.</strong> 0.40×relevance + 0.30×recency (half-life ≈ 8h day / 2d week / 7d month) + 0.20×source quality (Reuters/Bloomberg
        tier 1 → aggregator tier 4) + 0.10×coverage, with a small penalty for repeating the same company or market.
      </p>
      <p>
        <strong>Market & overall sentiment.</strong> Weighted mean of headline scores over 30 days; weight = source quality × recency (10-day decay)
        × (1 + 0.25·log₂(1+similar stories)). It feeds the Markets gauge, the Sentiment composite, Mock Index scores and every market drill-down.
      </p>
    </div>
  );

  if (compact) {
    const list = tops[win];
    return (
      <div className="panel news-pulse compact">
        {header}
        {helpBox}
        <div className="seg-control" role="tablist">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" role="tab" aria-selected={win === w.id} className={win === w.id ? 'on' : ''} onClick={() => setWin(w.id)}>
              {w.label} <span className="tiny">({WINDOW_N[w.id]})</span>
            </button>
          ))}
        </div>
        <ol className="news-list">
          {list.map((i, k) => (
            <NewsRow key={i.id} item={i} rank={k + 1} byId={byId} onOpenMarket={onOpenMarket} now={now} />
          ))}
          {!list.length && <li className="muted tiny">No headlines in this window yet.</li>}
        </ol>
      </div>
    );
  }

  return (
    <div className="panel news-pulse">
      {header}
      {helpBox}
      {seed && <p className="panel-note">Offline: showing curated seed headlines (dates may fall outside the window).</p>}
      <div className={`pulse-grid ${collapsibleMonth ? 'two' : ''}`}>
        {WINDOWS.filter((w) => !(collapsibleMonth && w.id === 'month')).map((w) => (
          <section key={w.id} className={`pulse-col pulse-${w.id}`}>
            <header>
              <h4>{w.label}</h4>
              <span className="tiny muted">{w.sub}</span>
            </header>
            <ol className="news-list">
              {tops[w.id].map((i, k) => (
                <NewsRow key={i.id} item={i} rank={k + 1} byId={byId} onOpenMarket={onOpenMarket} now={now} />
              ))}
              {!tops[w.id].length && <li className="muted tiny">No headlines in this window yet.</li>}
            </ol>
          </section>
        ))}
      </div>
      {collapsibleMonth && (
        <section className={`pulse-col pulse-month pulse-month-drop ${monthOpen ? 'open' : ''}`}>
          <button type="button" className="pulse-month-head" onClick={() => setMonthOpen((o) => !o)} aria-expanded={monthOpen}>
            <h4>This month</h4>
            <span className="tiny muted">
              Top {tops.month.length} of {monthCount} headlines · last 30 days
            </span>
            <span className={`pulse-month-score mono ${overall.score >= 0 ? 'up' : 'down'}`} title="Weighted news sentiment of the last 30 days (same as the overall News Pulse score)">
              month {overall.score >= 0 ? '+' : ''}
              {overall.score.toFixed(0)}
            </span>
            <span className="mk-cat-chev" aria-hidden>
              {monthOpen ? '▾' : '▸'}
            </span>
          </button>
          {monthOpen && (
            <ol className="news-list">
              {tops.month.map((i, k) => (
                <NewsRow key={i.id} item={i} rank={k + 1} byId={byId} onOpenMarket={onOpenMarket} now={now} />
              ))}
              {!tops.month.length && <li className="muted tiny">No headlines in this window yet.</li>}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
