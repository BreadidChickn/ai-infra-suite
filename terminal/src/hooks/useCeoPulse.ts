import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Company } from '../types';
import { CEO_TTL_MS, computeCeoResults, readCeoCache, refreshCeoNews, type CeoResult } from '../services/ceoPulse';
import { CEOS } from '../data/ceos';

export interface CeoPulseState {
  results: CeoResult[];
  status: 'idle' | 'loading' | 'ready';
  /** Newest successful query time */
  fetchedAt: string | null;
  queriesOk: number;
  queriesTotal: number;
  refresh: () => void;
}

/**
 * Refresh-on-open, like the News refresher: once `enabled` (after the main feed has loaded), stale CEO queries
 * are fetched (≤4 at a time); fresh ones come from the per-query cache. No refetch on re-render.
 */
export function useCeoPulse(companies: Company[], enabled: boolean): CeoPulseState {
  const [cache, setCache] = useState(() => readCeoCache());
  const [status, setStatus] = useState<CeoPulseState['status']>('idle');
  const companiesRef = useRef(companies);
  companiesRef.current = companies;
  const started = useRef(false);

  const run = useCallback(async (force: boolean) => {
    setStatus('loading');
    const c = await refreshCeoNews(companiesRef.current, force, (partial) => setCache(partial));
    setCache(c);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    const now = Date.now();
    const stale = CEOS.some((c) => {
      const e = cache[`${c.companyId}:${c.name}`];
      return !e || now - Date.parse(e.fetchedAt) >= CEO_TTL_MS;
    });
    if (stale) void run(false);
    else setStatus('ready');
  }, [enabled, cache, run]);

  const results = useMemo(() => computeCeoResults(cache, companies), [cache, companies]);
  const fetchedAt = useMemo(() => {
    const ts = results.map((r) => r.fetchedAt).filter((x): x is string => !!x).sort();
    return ts.at(-1) ?? null;
  }, [results]);
  const refresh = useCallback(() => void run(true), [run]);
  return { results, status, fetchedAt, queriesOk: results.filter((r) => r.fetched).length, queriesTotal: CEOS.length, refresh };
}
