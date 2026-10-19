import { useEffect, useMemo, useRef, useState } from 'react';
import type { Company, Headline, Relationship, SentimentTheme } from '../types';
import type { NewsFeedState } from '../hooks/useNewsFeed';
import { NewsPulse } from './NewsPulse';
import { MarketGrid } from './MarketDrilldown';
import { SentimentGauge } from './SentimentGauge';
import { SPOTLIGHT_SEARCH_LINKS } from '../data/headlines';
import { fmtPct } from '../utils/format';
import { SENT_BAND_HELP, sentBand, MIN_THEME_HEADLINES, type DerivedTheme } from '../services/themeScores';
import { fmtLocal } from './NewsPulse';

interface Props {
  headlines: Headline[];
  themes: (SentimentTheme | DerivedTheme)[];
  news: NewsFeedState;
  newsScore: number;
  companies: Company[];
  relationships: Relationship[];
  isMobile: boolean;
  onOpenFinancials: (id: string) => void;
}

export function SentimentTab({ headlines, themes, news, newsScore, companies, relationships, isMobile, onOpenFinancials }: Props) {
  const [marketOpen, setMarketOpen] = useState<string | null>(null);
  const themeAvg = useMemo(() => {
    if (!themes.length) return 0;
    return themes.reduce((s, t) => s + t.score, 0) / themes.length;
  }, [themes]);
  // Composite = 50% Theme Scores (now synthesised from live news, seed fallback per theme) + 50% overall news score.
  const overall = 0.5 * themeAvg + 0.5 * newsScore;
  const newsThemes = themes.filter((t) => (t as DerivedTheme).source === 'news').length;

  // Sticky composite: visible once the gauge panel has scrolled out of view.
  const gaugeRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const el = gaugeRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => setShowSticky(!e.isIntersecting && e.boundingClientRect.top < 0),
      { threshold: 0, rootMargin: `-${isMobile ? 52 : 64}px 0px 0px 0px` }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isMobile]);

  const political = themes.filter((t) => t.political).sort((a, b) => a.score - b.score);
  const investor = themes.filter((t) => !t.political).sort((a, b) => b.score - a.score);

  const sortedThemes = [...themes].sort((a, b) => b.score - a.score);

  const byId = useMemo(() => new Map(headlines.map((h) => [h.id, h])), [headlines]);

  const citedPolitical = headlines
    .filter((h) => h.political)
    .sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0));

  const spotlight = headlines.filter(
    (h) => h.spotlight || (h.theme != null && /Trump|Rare Earth|Xi/i.test(h.theme))
  );

  // SpaceX (SPCX) — newly public AI-infra name: live Google News items when available, else curated seeds.
  const spaceRe = /spacex|starlink|spcx|xai|colossus|starship/i;
  const spacexNews = headlines.filter((h) => spaceRe.test(h.title) || h.tags.includes('spacex')).slice(0, 8);
  const spacexAvg = spacexNews.length ? spacexNews.reduce((s, h) => s + (h.sentiment ?? 0), 0) / spacexNews.length : 0;
  const SPACEX_SEARCH = [
    { label: 'SpaceX SPCX stock news', url: 'https://news.google.com/search?q=SpaceX+SPCX+stock&hl=en-US&gl=US&ceid=US:en' },
    { label: 'SpaceX Nvidia $40B financing', url: 'https://news.google.com/search?q=SpaceX+Nvidia+financing&hl=en-US&gl=US&ceid=US:en' },
    { label: 'SpaceX AI compute deals (Anthropic / Google)', url: 'https://news.google.com/search?q=SpaceX+compute+Anthropic+Google&hl=en-US&gl=US&ceid=US:en' },
    { label: 'SpaceX / Starlink regulation & government', url: 'https://news.google.com/search?q=SpaceX+Starlink+FCC+OR+FAA+OR+Pentagon&hl=en-US&gl=US&ceid=US:en' },
  ];

  const compositeSub = `${newsThemes}/${themes.length} themes from live news + news pulse ${newsScore >= 0 ? '+' : ''}${newsScore.toFixed(0)}`;

  return (
    <div className="sentiment-layout">
      <div className={`sent-hero ${spotlight.length ? '' : 'solo'}`}>
        <div className="panel gauge-panel composite-panel" ref={gaugeRef}>
          <SentimentGauge score={overall} label="Composite Sentiment" size={180} />
          <p className="panel-note">
            Composite = 50% Theme Scores (avg {themeAvg >= 0 ? '+' : ''}
            {themeAvg.toFixed(0)}; {newsThemes} of {themes.length} themes synthesised from live headlines, the rest curated seed) + 50% News Pulse (
            {newsScore >= 0 ? '+' : ''}
            {newsScore.toFixed(0)}, {news.feed.mode === 'seed' ? 'seed headlines — offline' : `${news.feed.items.length} stories`}).
          </p>
          <p className="tiny muted">Updated {fmtLocal(news.feed.fetchedAt, true)} · stays pinned while you scroll</p>
        </div>
        {spotlight.length > 0 && (
        <div className="panel spotlight-card">
          <h3>Spotlight — Trump–Xi Rare Earths &amp; AI (Sep 2026)</h3>
          <p className="muted">
            Political risk: rare-earth leverage, AI guardrails talks, chip export controls, trade
            truce extension themes.
          </p>
          <ul className="headline-list">
            {spotlight.map((h) => (
              <li key={h.id}>
                <div className="hl-row">
                  <span className={`sent-chip ${(h.sentiment ?? 0) >= 0 ? 'up' : 'down'}`}>
                    {fmtPct((h.sentiment ?? 0) * 100, 0)}
                  </span>
                  <a href={h.url} target="_blank" rel="noreferrer">
                    {h.title}
                  </a>
                </div>
                <div className="hl-meta">
                  <span>{h.source}</span>
                  <span>{new Date(h.publishedAt).toLocaleDateString()}</span>
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
      </div>

      <div className={`composite-sticky ${showSticky ? 'show' : ''} band-${sentBand(overall)}`} aria-hidden={!showSticky} title={compositeSub}>
        <span className="cs-label">Composite</span>
        <span className="cs-val mono">
          {overall >= 0 ? '+' : ''}
          {overall.toFixed(0)}
        </span>
        {!isMobile && <span className="cs-sub tiny">{compositeSub}</span>}
        <button
          type="button"
          className="cs-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to composite gauge"
          tabIndex={showSticky ? 0 : -1}
        >
          ↑
        </button>
      </div>

      <NewsPulse news={news} companies={companies} collapsibleMonth onOpenMarket={setMarketOpen} />
      <MarketGrid
        items={news.feed.items}
        companies={companies}
        relationships={relationships}
        isMobile={isMobile}
        openId={marketOpen}
        onOpen={setMarketOpen}
        onOpenFinancials={onOpenFinancials}
      />

      <div className="panel theme-panel">
        <h3>
          Theme Scores <span className="tiny muted">(−100 bearish → +100 bullish)</span>
          <span className="help-dot" title={`${SENT_BAND_HELP}. Score = weighted mean sentiment of headlines matching the theme's keywords / markets over 30 days (weight = source quality × recency × coverage, like the market drill-down). Themes with fewer than ${MIN_THEME_HEADLINES} matching headlines keep their curated seed score (SEED badge).`}>
            ⓘ
          </span>
        </h3>
        <ul className="theme-score-list">
          {sortedThemes.map((t) => {
            const d = t as DerivedTheme;
            const band = sentBand(t.score);
            return (
              <li key={t.id}>
                <span className="ts-name">
                  {t.name}
                  {t.political && <span className="tag-pol">POL</span>}
                </span>
                <span className={`ts-badge ${d.source === 'news' ? 'news' : 'seed'}`} title={d.source === 'news' ? `${d.matchCount} matching headlines (30d)` : 'No matching live headlines — curated seed score'}>
                  {d.source === 'news' ? `NEWS · ${d.matchCount}` : 'SEED'}
                </span>
                <span className="ts-bar" aria-hidden>
                  <span className={`ts-fill band-${band}`} style={{ width: `${Math.min(50, Math.abs(t.score) / 2)}%`, [t.score >= 0 ? 'left' : 'right']: '50%' }} />
                </span>
                <span className={`ts-val mono band-${band}`}>
                  {t.score > 0 ? '+' : ''}
                  {t.score}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="tiny muted">{SENT_BAND_HELP}</p>
      </div>

      <div className="panel spotlight-card spacex-card">
        <h3>
          SpaceX (SPCX) — investor &amp; policy watch{' '}
          <span className={`sent-chip ${spacexAvg >= 0 ? 'up' : 'down'}`}>avg {fmtPct(spacexAvg * 100, 0)}</span>
        </h3>
        <p className="muted">
          Public since the Jun 12, 2026 IPO. Investor focus: AI compute leasing (Anthropic, Google), debt-funded NVIDIA GPU purchases, Starship
          milestones. Policy / governance concerns: related-party dealings with Tesla, FAA launch licensing, FCC spectrum and government-contract
          dependence. Keyword sentiment from headline titles only.
        </p>
        {spacexNews.length ? (
          <ul className="headline-list">
            {spacexNews.map((h) => (
              <li key={h.id}>
                <div className="hl-row">
                  <span className={`sent-chip ${(h.sentiment ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtPct((h.sentiment ?? 0) * 100, 0)}</span>
                  <a href={h.url} target="_blank" rel="noreferrer">
                    {h.title}
                  </a>
                </div>
                <div className="hl-meta">
                  <span>{h.source}</span>
                  <span>{new Date(h.publishedAt).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-note">No SpaceX headlines loaded — use the search links below.</p>
        )}
        <div className="sec-links">
          {SPACEX_SEARCH.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
        </div>
      </div>
      <div className="sent-grid">
        <div className="panel">
          <h3>Political Concerns & Challenges</h3>
          <div className="theme-cards">
            {political.map((t) => (
              <ThemeCard key={t.id} theme={t} byId={byId} political />
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Investor / Customer Sentiment Themes</h3>
          <div className="theme-cards">
            {investor.map((t) => (
              <ThemeCard key={t.id} theme={t} byId={byId} />
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Cited Political Headlines</h3>
        <ul className="headline-list dense">
          {citedPolitical.map((h) => (
            <li key={h.id}>
              <div className="hl-row">
                <span className={`sent-chip ${(h.sentiment ?? 0) >= 0 ? 'up' : 'down'}`}>
                  {(h.sentiment ?? 0) >= 0 ? '+' : ''}
                  {((h.sentiment ?? 0) * 100).toFixed(0)}
                </span>
                <a href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>
              </div>
              <div className="hl-meta">
                <span>{h.source}</span>
                <span>{h.theme}</span>
                <span>{new Date(h.publishedAt).toLocaleDateString()}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  byId,
  political,
}: {
  theme: SentimentTheme | DerivedTheme;
  byId: Map<string, Headline>;
  political?: boolean;
}) {
  const d = theme as DerivedTheme;
  const band = sentBand(theme.score);
  return (
    <article className={`theme-card ${political ? 'pol' : ''}`}>
      <header>
        <h4>{theme.name}</h4>
        <span className={`ts-badge ${d.source === 'news' ? 'news' : 'seed'}`}>{d.source === 'news' ? `NEWS · ${d.matchCount}` : 'SEED'}</span>
        <span className={`theme-score band-${band}`} title={SENT_BAND_HELP}>
          {theme.score > 0 ? '+' : ''}
          {theme.score}
        </span>
      </header>
      <p>{theme.description}</p>
      <ul className="cite-list">
        {d.source === 'news' &&
          d.matches.map((h) => (
            <li key={h.id}>
              <a href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>{' '}
              <span className="tiny muted">— {h.source}</span>
            </li>
          ))}
        {d.source !== 'news' && theme.headlineIds.map((id) => {
          const h = byId.get(id);
          if (!h) return null;
          return (
            <li key={id}>
              <a href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
