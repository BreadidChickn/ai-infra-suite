import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { NetworkTab } from './components/NetworkTab';
import { MarketsTab } from './components/MarketsTab';
import { RelationshipsTab } from './components/RelationshipsTab';
import { SentimentTab } from './components/SentimentTab';
import { MockIndexTab } from './components/MockIndexTab';
import { FinancialsTab } from './components/FinancialsTab';
import { TraderTab } from './components/TraderTab';
import { buildSignalsSnapshot, publishSignals } from './services/signals';
import { loadSecSnapshot } from './services/secFinancials';
import { GlossaryTab } from './components/GlossaryTab';
import { GlobalSearch } from './components/GlobalSearch';
import { useUserCompanies } from './hooks/useUserCompanies';
import { GLOSSARY_EVENT } from './data/glossary';
import { useIsMobile } from './hooks/useIsMobile';
import { useNewsFeed } from './hooks/useNewsFeed';
import { allMarketSentiments, sentimentFor, toHeadlines } from './services/newsFeed';
import { loadMarketData } from './services/marketData';
import { deriveThemes } from './services/themeScores';
import { companies as seedCompanies } from './data/companies';
import { relationships as seedRels } from './data/relationships';
import { energySeedHeadlines, headlines as seedHeadlines, themes as seedThemes } from './data/headlines';

const NEWS_SEEDS = [...seedHeadlines, ...energySeedHeadlines];
import type { DataMode, MarketData } from './types';
import './styles/terminal.css';

const fallback: MarketData = {
  companies: seedCompanies,
  relationships: seedRels,
  headlines: seedHeadlines,
  themes: seedThemes,
  asOf: new Date().toISOString(),
};

const TAB_IDS = ['network', 'markets', 'relationships', 'sentiment', 'financials', 'mock', 'trader', 'glossary'];

export default function App() {
  const [tab, setTabState] = useState(() => {
    if (typeof window === 'undefined') return 'network';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t && TAB_IDS.includes(t) ? t : 'network';
  });
  const [glossTerm, setGlossTerm] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('term');
  });

  /** Switch tab and keep ?tab= in the URL so links/refreshes land on the same view. */
  const setTab = useCallback((next: string, term?: string | null, extra?: Record<string, string>) => {
    setTabState(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      if (next === 'glossary' && term) url.searchParams.set('term', term);
      else url.searchParams.delete('term');
      if (next !== 'financials') url.searchParams.delete('company');
      if (next !== 'network') url.searchParams.delete('focus');
      for (const [k, v] of Object.entries(extra || {})) url.searchParams.set(k, v);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  // Info icons elsewhere (e.g. Financials) dispatch this to open a glossary entry.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setGlossTerm(id);
      setTab('glossary', id);
    };
    window.addEventListener(GLOSSARY_EVENT, onOpen);
    return () => window.removeEventListener(GLOSSARY_EVENT, onOpen);
  }, [setTab]);

  const consumeGlossTerm = useCallback(() => setGlossTerm(null), []);
  const [data, setData] = useState<MarketData>(fallback);
  const [quoteMode, setQuoteMode] = useState<DataMode>('illustrative');
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  const user = useUserCompanies(data.companies);
  // Bumped on every "open in Financials" so the tab re-focuses even when it is already showing.
  const [finFocus, setFinFocus] = useState<{ id: string; n: number } | null>(null);
  const [netFocusN, setNetFocusN] = useState(0);

  const openFinancials = useCallback(
    (id: string) => {
      setFinFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
      setTab('financials', null, { company: id });
    },
    [setTab]
  );
  const openNetwork = useCallback(
    (id: string) => {
      setTab('network', null, { focus: id });
      setNetFocusN((n) => n + 1);
    },
    [setTab]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadMarketData();
        if (!cancelled) {
          setData(result.data);
          setQuoteMode(result.liveQuotes > 0 ? 'live' : 'illustrative');
        }
      } catch {
        if (!cancelled) {
          setData(fallback);
          setQuoteMode('illustrative');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // News refresher: fresh headlines on every open (15-min cache), feeding all sentiment calculations.
  const news = useNewsFeed(data.companies, NEWS_SEEDS);
  const headlines = useMemo(() => {
    const live = news.feed.mode === 'seed' ? [] : toHeadlines(news.feed.items, 40);
    const seen = new Set(live.map((h) => h.title.toLowerCase()));
    // Curated political / spotlight seeds stay visible (Trump–Xi and SpaceX panels), deduped against live items.
    const keep = seedHeadlines.filter((h) => (live.length ? h.political || h.spotlight || h.tags.includes('spacex') : true));
    return [...live, ...keep.filter((h) => !seen.has(h.title.toLowerCase()))];
  }, [news.feed]);
  const newsScore = useMemo(() => sentimentFor(news.feed.items).score, [news.feed]);
  const marketScores = useMemo(() => {
    const all = allMarketSentiments(news.feed.items);
    return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.count ? v.score : null]));
  }, [news.feed]);
  const newsLive = news.feed.mode !== 'seed';
  // Theme Scores are re-derived from the live tagged headlines (curated seed score only when a theme has no matches).
  const themes = useMemo(() => deriveThemes(data.themes, news.feed.items, newsLive), [data.themes, news.feed, newsLive]);
  // Publish the dashboard's computed signals for the trading bot (/api/signals, /api/news-feed, /api/mock-index).
  useEffect(() => {
    if (loading || news.status === 'loading') return;
    const t = window.setTimeout(async () => {
      const sec = await loadSecSnapshot().catch(() => null);
      void publishSignals(
        buildSignalsSnapshot({
          companies: data.companies,
          relationships: data.relationships,
          feed: news.feed,
          themes,
          headlines,
          marketScores,
          quotesLive: quoteMode === 'live',
          sec,
        })
      );
    }, 1500);
    return () => window.clearTimeout(t);
  }, [loading, news.status, news.feed, data, themes, headlines, marketScores, quoteMode]);
  const mode: DataMode = quoteMode === 'live' && newsLive ? 'live' : quoteMode === 'live' || newsLive ? 'mixed' : 'illustrative';

  return (
    <div className={`terminal-app ${isMobile ? 'is-mobile' : ''}`}>
      <Header
        active={tab}
        onTab={setTab}
        mode={mode}
        asOf={data.asOf}
        compact={isMobile}
        search={
          <GlobalSearch
            companies={data.companies}
            user={user}
            isMobile={isMobile}
            onOpenFinancials={openFinancials}
            onOpenNetwork={openNetwork}
          />
        }
      />
      {(loading || news.status === 'loading') && (
        <div className="loading-bar">{loading ? 'Enriching live quotes' : 'Live quotes ready'} · {news.status === 'loading' ? 'refreshing headlines…' : 'headlines ready'}</div>
      )}
      <main className="terminal-main">
        {tab === 'network' && (
          <NetworkTab key={`net-${netFocusN}`} companies={data.companies} relationships={data.relationships} />
        )}
        {tab === 'markets' && (
          <MarketsTab
            companies={data.companies}
            relationships={data.relationships}
            headlines={headlines}
            mode={mode}
            news={news}
            newsScore={newsScore}
            isMobile={isMobile}
            onOpenFinancials={openFinancials}
            onOpenTab={(t) => setTab(t)}
          />
        )}
        {tab === 'relationships' && (
          <RelationshipsTab companies={data.companies} relationships={data.relationships} />
        )}
        {tab === 'sentiment' && (
          <SentimentTab
            headlines={headlines}
            themes={themes}
            news={news}
            newsScore={newsScore}
            companies={data.companies}
            relationships={data.relationships}
            isMobile={isMobile}
            onOpenFinancials={openFinancials}
          />
        )}
        {tab === 'mock' && (
          <MockIndexTab
            companies={data.companies}
            newsItems={news.feed.items}
            newsLive={newsLive}
            headlines={headlines}
            themes={themes}
            mode={mode}
            marketScores={marketScores}
          />
        )}
        {tab === 'financials' && (
          <FinancialsTab
            companies={data.companies}
            relationships={data.relationships}
            isMobile={isMobile}
            user={user}
            focus={finFocus}
          />
        )}
        {tab === 'trader' && (
          <TraderTab
            companies={data.companies}
            isMobile={isMobile}
            onOpenFinancials={openFinancials}
            onOpenTab={(t) => setTab(t)}
          />
        )}
        {tab === 'glossary' && (
          <GlossaryTab
            isMobile={isMobile}
            initialTermId={glossTerm}
            onTermConsumed={consumeGlossTerm}
            onOpenTab={(t) => setTab(t)}
          />
        )}
      </main>
      {isMobile && <BottomNav active={tab} onTab={setTab} />}
    </div>
  );
}
