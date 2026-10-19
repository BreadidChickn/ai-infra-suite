import { useCallback, useEffect, useRef, useState } from 'react';
import type { Company, Headline } from '../types';
import { fetchLiveFeed, isFresh, readCachedFeed, seedFeed, type NewsFeed } from '../services/newsFeed';

export type NewsStatus = 'loading' | 'ready' | 'refreshing' | 'offline';

export interface NewsFeedState {
  feed: NewsFeed;
  status: NewsStatus;
  /** True when showing the localStorage copy while a fresh fetch runs (or failed). */
  stale: boolean;
  error?: string;
  refresh: () => void;
}

/**
 * Refreshes headlines every time the app opens: a cache younger than 15 min is shown instantly and reused;
 * otherwise the cached copy is shown while a fresh fetch runs. Falls back to curated seeds when offline.
 */
export function useNewsFeed(companies: Company[], seeds: Headline[]): NewsFeedState {
  const companiesRef = useRef(companies);
  companiesRef.current = companies;
  const [feed, setFeed] = useState<NewsFeed>(() => readCachedFeed(companies) ?? seedFeed(seeds, companies));
  const [status, setStatus] = useState<NewsStatus>(() => (isFresh(readCachedFeed(companies)) ? 'ready' : 'loading'));
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inflight = useRef(false);

  const run = useCallback(
    async (force: boolean) => {
      if (inflight.current) return;
      inflight.current = true;
      setStatus((s) => (s === 'loading' ? 'loading' : 'refreshing'));
      setStale(true);
      try {
        const live = await fetchLiveFeed(companiesRef.current, force);
        setFeed(live);
        setStale(false);
        setError(undefined);
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        const cached = readCachedFeed(companiesRef.current);
        setFeed(cached ?? seedFeed(seeds, companiesRef.current));
        setStatus('offline');
      } finally {
        inflight.current = false;
      }
    },
    [seeds]
  );

  useEffect(() => {
    if (!isFresh(feed)) void run(false);
    else setStatus('ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => void run(true), [run]);
  return { feed, status, stale, error, refresh };
}
