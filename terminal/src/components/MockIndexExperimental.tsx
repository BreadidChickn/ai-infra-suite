import { useEffect, useMemo, useState } from 'react';
import type { Company } from '../types';
import type { NewsItem } from '../services/newsFeed';
import { autoMode, fetchRealizedMany, type CompareMode, type RealizedQuote } from '../services/intraday';
import { marketOfSegment, MARKET_BY_ID } from '../data/markets';
import { displayCode, fmtPct, pctClass } from '../utils/format';
import { fmtLocal } from './NewsPulse';

interface Props {
  members: Company[];
  weights: Map<string, number>;
  /** The model's index-level 1D estimate (weighted member 1D used everywhere else in Mock Index) */
  estimate1D?: number;
  newsItems: NewsItem[];
  newsLive: boolean;
}

const BENCH = ['SPY', 'QQQ', 'SOXX'] as const;
type Bench = (typeof BENCH)[number];
const SEMI_MARKETS = new Set(['chips', 'foundry', 'equipment', 'eda_ip', 'memory']);
const TECH_MARKETS = new Set(['cloud', 'ai_labs', 'devices', 'space']);
/** Benchmark used to judge whether a member's move was market-wide or company-specific. */
function benchFor(c: Company): Bench {
  const m = marketOfSegment(c.segment) ?? '';
  return SEMI_MARKETS.has(m) ? 'SOXX' : TECH_MARKETS.has(m) ? 'QQQ' : 'SPY';
}
const COMPANY_SPECIFIC_PP = 1.0;

const fmtPP = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 'N/A' : `${n > 0 ? '+' : ''}${n.toFixed(2)} pp`);
const pct = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 'N/A' : fmtPct(n, 2));

export function MockIndexExperimental({ members, weights, estimate1D, newsItems, newsLive }: Props) {
  const [quotes, setQuotes] = useState<Map<string, RealizedQuote> | null>(null);
  const [loading, setLoading] = useState(false);
  const [pref, setPref] = useState<'auto' | CompareMode>('auto');
  const [runN, setRunN] = useState(0);

  const tickers = useMemo(() => members.filter((c) => !c.isPrivate && c.ticker).map((c) => c.ticker!), [members]);
  const key = tickers.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRealizedMany([...BENCH, ...tickers]).then((m) => {
      if (!cancelled) {
        setQuotes(m);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, runN]);

  const now = Date.now();
  const spy = quotes?.get('SPY');
  const auto = autoMode(spy, now);
  const mode: CompareMode = pref === 'auto' ? auto : pref;
  const val = (q?: RealizedQuote) => (q?.ok ? (mode === 'intraday3h' ? q.move3h : q.moveEod) : null);

  const calc = useMemo(() => {
    if (!quotes) return null;
    const rows = members.map((c) => {
      const q = c.ticker && !c.isPrivate ? quotes.get(c.ticker) : undefined;
      const act = val(q);
      const b = benchFor(c);
      const bAct = val(quotes.get(b));
      return {
        c,
        w: weights.get(c.id) || 0,
        est: c.change1D ?? null,
        act,
        gap: act != null && c.change1D != null ? act - c.change1D : null,
        bench: b,
        excess: act != null && bAct != null ? act - bAct : null,
        nonUS: !!q?.exchangeTz && q.exchangeTz !== 'America/New_York',
        q,
      };
    });
    const cov = rows.filter((r) => r.act != null);
    const wCov = cov.reduce((s, r) => s + r.w, 0);
    const idxAct = wCov > 0 ? cov.reduce((s, r) => s + (r.w / wCov) * (r.act as number), 0) : null;
    const benchMix = wCov > 0 && cov.every((r) => val(quotes.get(r.bench)) != null) ? cov.reduce((s, r) => s + (r.w / wCov) * (val(quotes.get(r.bench)) as number), 0) : null;
    const contrib = cov.map((r) => ({ ...r, wc: (r.w / wCov) * (r.act as number) })).sort((a, b) => b.wc - a.wc);
    const ups = contrib.filter((r) => r.wc > 0).slice(0, 3);
    const downs = [...contrib].reverse().filter((r) => r.wc < 0).slice(0, 3);
    // window label from the members' own bars (latest end; earliest start)
    const usQ = cov.map((r) => r.q!).filter((q) => q.exchangeTz === 'America/New_York');
    const ref = usQ[0] ?? spy;
    return { rows, cov, wCov, idxAct, benchMix, ups, downs, ref };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, members, weights, mode]);

  const gapIdx = calc?.idxAct != null && estimate1D != null ? calc.idxAct - estimate1D : null;
  const excessIdx = calc?.idxAct != null && calc.benchMix != null ? calc.idxAct - calc.benchMix : null;
  const marketWide =
    excessIdx == null || calc?.benchMix == null
      ? null
      : Math.abs(excessIdx) <= Math.max(0.35, 0.35 * Math.abs(calc.benchMix));

  const headlinesFor = (c: Company) => {
    const cutoff = now - (mode === 'intraday3h' ? 48 : 96) * 3600 * 1000;
    const recent = newsItems.filter((i) => Date.parse(i.publishedAt) >= cutoff);
    const own = recent.filter((i) => i.companies.includes(c.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    if (own.length) return { kind: 'company' as const, items: own.slice(0, 2) };
    const mk = marketOfSegment(c.segment);
    const mkt = mk ? recent.filter((i) => i.markets.includes(mk)).sort((a, b) => b.quality - a.quality || b.publishedAt.localeCompare(a.publishedAt)) : [];
    return { kind: 'market' as const, items: mkt.slice(0, 1) };
  };

  const ref = calc?.ref;
  const modeLabel =
    mode === 'intraday3h'
      ? ref?.win3hStartMs && ref.win3hEndMs
        ? `Last 3 hours of intraday data (5-min bars, ${fmtLocal(new Date(ref.win3hStartMs).toISOString())} → ${fmtLocal(new Date(ref.win3hEndMs).toISOString(), true)})${ref.open ? ' · market open' : ' · session closed'}`
        : 'Last 3 hours of intraday data — window unavailable'
      : ref?.lastBarMs
        ? `End of day: latest close (session ended ${fmtLocal(new Date(ref.lastBarMs).toISOString(), true)}) vs prior close`
        : 'End of day: latest close vs prior close';

  return (
    <div className="panel exp-panel">
      <h3>
        Estimated vs actual 1D <span className="exp-badge">EXPERIMENTAL</span>
      </h3>
      <p className="panel-note">
        Compares the model’s 1D estimate (the weighted member 1D used above — Yahoo daily chart at page load, or curated seed if quotes failed) with
        the realized move from Yahoo intraday data. Rule-based, for research only — not financial advice.
      </p>
      <div className="exp-toolbar">
        <div className="seg-control small" role="tablist" aria-label="Comparison mode">
          {(
            [
              ['auto', `Auto (${auto === 'intraday3h' ? '3h' : 'EOD'})`],
              ['intraday3h', 'Last 3h'],
              ['eod', 'End of day'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={pref === k ? 'on' : ''} onClick={() => setPref(k)}>
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="chip" onClick={() => setRunN((n) => n + 1)} disabled={loading}>
          {loading ? 'Loading…' : '↻ Re-check'}
        </button>
      </div>
      <div className="exp-mode tiny">
        <strong>Using:</strong> {modeLabel}
      </div>

      {!quotes ? (
        <p className="muted tiny">Loading intraday data…</p>
      ) : !calc || calc.idxAct == null ? (
        <p className="muted">
          N/A — no realized {mode === 'intraday3h' ? '3-hour intraday' : 'end-of-day'} data for these members right now (market data unavailable,
          private names, or too little intraday history). Nothing is estimated in its place.
        </p>
      ) : (
        <>
          <div className="exp-kpis">
            <div>
              <span className="perf-label">Model estimate (1D)</span>
              <span className={`mk-kpi-val mono ${pctClass(estimate1D)}`}>{pct(estimate1D)}</span>
            </div>
            <div>
              <span className="perf-label">Actual ({mode === 'intraday3h' ? 'last 3h' : 'EOD'})</span>
              <span className={`mk-kpi-val mono ${pctClass(calc.idxAct)}`}>{pct(calc.idxAct)}</span>
            </div>
            <div>
              <span className="perf-label">Gap (actual − est.)</span>
              <span className={`mk-kpi-val mono ${pctClass(gapIdx)}`}>{fmtPP(gapIdx)}</span>
            </div>
            <div>
              <span className="perf-label">Coverage</span>
              <span className="mk-kpi-val mono">
                {calc.cov.length}/{members.length} · {(calc.wCov * 100).toFixed(0)}% wt
              </span>
            </div>
          </div>

          <div className="exp-insight">
            <div className="perf-label">Why it moved (rule-based)</div>
            <p>
              <strong>{marketWide == null ? 'Market context N/A.' : marketWide ? 'Mostly market-wide.' : 'Basket-specific.'}</strong>{' '}
              Basket {pct(calc.idxAct)} vs its benchmark mix {pct(calc.benchMix)} (semis → SOXX, cloud/AI labs/devices/space → QQQ, energy & others →
              SPY){excessIdx != null && <> — excess {fmtPP(excessIdx)}</>}. Benchmarks: {BENCH.map((b) => `${b} ${pct(val(quotes.get(b)))}`).join(' · ')}.
            </p>
            <div className="exp-movers">
              {(
                [
                  ['Top contributors', calc.ups],
                  ['Top detractors', calc.downs],
                ] as const
              ).map(([title, list]) => (
                <div key={title}>
                  <div className="perf-label">{title}</div>
                  {!list.length && <p className="tiny muted">None.</p>}
                  <ul className="exp-mover-list">
                    {list.map((r) => {
                      const h = headlinesFor(r.c);
                      const specific = r.excess != null && Math.abs(r.excess) >= COMPANY_SPECIFIC_PP;
                      return (
                        <li key={r.c.id}>
                          <div className="exp-mover-head">
                            <strong className="mono">{displayCode(r.c)}</strong>
                            <span className={`mono ${pctClass(r.act)}`}>{pct(r.act)}</span>
                            <span className="tiny muted">
                              {(r.wc >= 0 ? '+' : '') + r.wc.toFixed(2)} pp to index
                            </span>
                            <span className={`exp-tag ${specific ? 'spec' : 'mkt'}`} title={`Move vs ${r.bench}: ${fmtPP(r.excess)} (company-specific when |excess| ≥ ${COMPANY_SPECIFIC_PP} pp)`}>
                              {r.excess == null ? 'vs bench N/A' : specific ? `company-specific (${fmtPP(r.excess)} vs ${r.bench})` : `in line with ${r.bench}`}
                            </span>
                          </div>
                          {h.items.length ? (
                            <ul className="exp-news">
                              {h.items.map((i) => (
                                <li key={i.id}>
                                  <span className="tiny muted">{h.kind === 'company' ? 'News' : `${MARKET_BY_ID[marketOfSegment(r.c.segment) ?? '']?.short ?? 'Market'} news`} · </span>
                                  <a href={i.url} target="_blank" rel="noreferrer">
                                    {i.title}
                                  </a>{' '}
                                  <span className="tiny muted">
                                    {i.source}, {fmtLocal(i.publishedAt)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="tiny muted">No matching headlines in the news feed{newsLive ? '' : ' (offline seed)'}.</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table compact exp-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Weight</th>
                  <th>Est. 1D</th>
                  <th>Actual</th>
                  <th>Gap</th>
                  <th>vs bench</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map((r) => (
                  <tr key={r.c.id}>
                    <td className="mono">
                      {displayCode(r.c)}
                      {r.nonUS && <span className="tag-priv" title={`Non-US session (${r.q?.exchangeTz}); its own latest session is used`}>non-US</span>}
                    </td>
                    <td className="mono">{(r.w * 100).toFixed(1)}%</td>
                    <td className={`mono ${pctClass(r.est)}`}>{pct(r.est)}</td>
                    <td className={`mono ${pctClass(r.act)}`}>{r.c.isPrivate ? 'N/A (private)' : pct(r.act)}</td>
                    <td className={`mono ${pctClass(r.gap)}`}>{fmtPP(r.gap)}</td>
                    <td className="mono tiny">{r.excess == null ? 'N/A' : `${fmtPP(r.excess)} ${r.bench}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted">
            Index actual re-weights over members with data. Gap compares a 1-day estimate with a {mode === 'intraday3h' ? '3-hour' : '1-session'} realized move, so
            {mode === 'intraday3h' ? ' differences are expected — the estimate spans a full day' : ' they should be close when the estimate came from live Yahoo quotes'}.
            Weekends and holidays fall back to the latest completed session; missing series show N/A.
          </p>
        </>
      )}
    </div>
  );
}
