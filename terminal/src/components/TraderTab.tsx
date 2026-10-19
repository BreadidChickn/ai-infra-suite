import { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Company } from '../types';
import { MARKETS, marketOfSegment } from '../data/markets';
import { fmtPct, pnlColor } from '../utils/format';
import {
  annualized, basketSeries, currentMode, benchSeries, dailyReturns, drawdownSeries, loadTraderData, maxDrawdown, pctChange,
  rangeStart, savedBaskets, sharpe, sleeveColor, sleeveSeries, sleevesIn, sortino, turnover, winRate,
  type BotReport, type BotTrade, type Pt, type Range, type TraderData,
} from '../services/trader';

interface Props {
  companies: Company[];
  isMobile: boolean;
  onOpenFinancials: (id: string) => void;
  onOpenTab: (tab: string) => void;
}

const TARGET = 29;
const RANGES: Range[] = ['1D', '1W', '1M', 'YTD', 'ALL'];
const BENCH = ['SPY', 'QQQ', 'SOXX'];
const BENCH_COLORS: Record<string, string> = { SPY: '#ffffff', QQQ: '#90caf9', SOXX: '#ffcc80', BASKET: '#ce93d8' };
const fmtUsd = (v?: number | null, d = 2) =>
  v == null || Number.isNaN(v) ? 'N/A' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmtLocal = (iso?: string | number | null) => (iso == null ? '—' : new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }));
const fmtN = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? 'N/A' : v.toFixed(d));
const pct = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? 'N/A' : fmtPct(v, d));

function signalGroup(name: string): { group: string; cls: string } {
  const n = name.toLowerCase();
  if (/news|sent|headline/.test(n)) return { group: 'News', cls: 'sig-news' };
  if (/mock|index|basket/.test(n)) return { group: 'Mock Index', cls: 'sig-mock' };
  if (/sec|fin|revenue|margin|ocf|capex|eps|10-?[kq]/.test(n)) return { group: 'SEC', cls: 'sig-sec' };
  if (/rel|graph|degree|network|partner/.test(n)) return { group: 'Relationships', cls: 'sig-rel' };
  if (/mom|trend|vol|price|rsi/.test(n)) return { group: 'Price', cls: 'sig-price' };
  return { group: 'Other', cls: 'sig-other' };
}

function ExampleTag({ on }: { on?: boolean }) {
  return on ? <span className="example-tag" title="Sample payload, not real trading data">EXAMPLE DATA</span> : null;
}

export function TraderTab({ companies, isMobile, onOpenFinancials, onOpenTab }: Props) {
  const [data, setData] = useState<TraderData | null>(null);
  const [range, setRange] = useState<Range>('ALL');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [lead, setLead] = useState<string | null>(null);
  const [bench, setBench] = useState<Record<string, Pt[]>>({});
  const [basketName, setBasketName] = useState<string>('');
  const [reportId, setReportId] = useState<string | null>(null);
  const baskets = useMemo(() => savedBaskets(), []);

  const refresh = useCallback(async () => setData(await loadTraderData()), []);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 60000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const sleeves = useMemo(() => (data ? sleevesIn(data.equity, data.trades) : []), [data]);
  const active = useMemo(() => picked ?? new Set(sleeves.map((s) => s.code)), [picked, sleeves]);
  const leadCode = lead && sleeves.some((s) => s.code === lead) ? lead : sleeves.find((s) => s.code === 'B')?.code ?? sleeves[0]?.code ?? null;
  const toggle = (c: string) => {
    const next = new Set(active);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setPicked(next);
  };

  // Benchmarks via the existing Yahoo proxy (+ optional saved Mock Index basket).
  useEffect(() => {
    let off = false;
    (async () => {
      const out: Record<string, Pt[]> = {};
      await Promise.all(BENCH.map(async (t) => (out[t] = await benchSeries(t, range))));
      const b = baskets.find((x) => x.name === basketName);
      if (b) {
        const mem = companies.filter((c) => b.ids.includes(c.id) && c.ticker && !c.isPrivate);
        const tot = mem.reduce((a, c) => a + Math.max(c.marketCapB, 0.1), 0);
        const series = await Promise.all(mem.map(async (c) => ({ pts: await benchSeries(c.ticker!, range), w: b.weightMode === 'equal' ? 1 : Math.max(c.marketCapB, 0.1) / tot })));
        out.BASKET = basketSeries(series);
      }
      if (!off) setBench(out);
    })();
    return () => {
      off = true;
    };
  }, [range, basketName, baskets, companies]);

  const byTicker = useMemo(() => {
    const m = new Map<string, Company>();
    for (const c of companies) if (c.ticker) m.set(c.ticker.toUpperCase(), c);
    return m;
  }, [companies]);

  const firstRec = useMemo(() => (data && data.equity.length ? Math.min(...data.equity.map((e) => Date.parse(e.ts))) : 0), [data]);
  // ALL = since the bot's first record (benchmarks are clipped to the same window).
  const from = range === 'ALL' ? firstRec : rangeStart(range);
  const leadSeries = useMemo(() => (data && leadCode ? sleeveSeries(data.equity, leadCode) : []), [data, leadCode]);
  const anyExample = !!data && [...data.equity, ...data.trades, ...data.reports].some((x) => x.example);

  /* ---------- header numbers (lead sleeve, real records only) ---------- */
  const eqNow = leadSeries.at(-1)?.v ?? null;
  const dayPnl = leadSeries.length > 1 ? (() => { const v = leadSeries.at(-1)!.v; const b = leadSeries.filter((p) => p.t <= Date.now() - 86400000).at(-1)?.v; return b == null ? null : v - b; })() : null;
  const weekPnl = leadSeries.length > 1 ? (() => { const v = leadSeries.at(-1)!.v; const b = leadSeries.filter((p) => p.t <= Date.now() - 7 * 86400000).at(-1)?.v; return b == null ? null : v - b; })() : null;
  const sinceInc = pctChange(leadSeries, 0);
  const ann = annualized(leadSeries);
  const behind = ann != null && ann.pct < TARGET;
  const latestReport = data?.reports.at(-1) ?? null;

  /* ---------- chart: % change from range start per selected sleeve + benchmarks ---------- */
  const chart = useMemo(() => {
    if (!data) return [] as Record<string, number>[];
    const lines: Record<string, Pt[]> = {};
    for (const s of sleeves) if (active.has(s.code)) lines[s.code] = sleeveSeries(data.equity, s.code).filter((p) => p.t >= from);
    for (const [k, v] of Object.entries(bench)) lines[k] = v.filter((p) => p.t >= from);
    const ts = [...new Set(Object.values(lines).flatMap((l) => l.map((p) => p.t)))].sort((a, b) => a - b);
    const bases: Record<string, number> = {};
    for (const [k, l] of Object.entries(lines)) if (l.length) bases[k] = l[0].v;
    const idx: Record<string, number> = {};
    return ts.map((t) => {
      const row: Record<string, number> = { t };
      for (const [k, l] of Object.entries(lines)) {
        let i = idx[k] ?? 0;
        while (i + 1 < l.length && l[i + 1].t <= t) i++;
        idx[k] = i;
        if (l.length && l[0].t <= t && bases[k]) row[k] = (l[i].v / bases[k] - 1) * 100;
      }
      return row;
    });
  }, [data, sleeves, active, bench, from]);

  const dd = useMemo(() => drawdownSeries(leadSeries.filter((p) => p.t >= from)).map((p) => ({ t: p.t, dd: p.v })), [leadSeries, from]);

  const metrics = useMemo(() => {
    if (!data) return [];
    const spy = (bench.SPY ?? []).filter((p) => p.t >= from);
    const spyRet = spy.length > 1 ? (spy.at(-1)!.v / spy[0].v - 1) * 100 : null;
    return sleeves.filter((s) => active.has(s.code)).map((s) => {
      const ser = sleeveSeries(data.equity, s.code).filter((p) => p.t >= from);
      const r = dailyReturns(ser);
      const ret = pctChange(ser, from);
      const tr = data.trades.filter((t) => t.sleeve === s.code && Date.parse(t.ts) >= from);
      return {
        ...s,
        ret,
        alpha: ret != null && spyRet != null ? ret - spyRet : null,
        sharpe: sharpe(r),
        sortino: sortino(r),
        mdd: maxDrawdown(ser),
        win: winRate(tr),
        turn: turnover(tr, ser, from),
        days: r.length,
      };
    });
  }, [data, sleeves, active, bench, from]);

  /* ---------- holdings ---------- */
  const holdings = useMemo(() => {
    if (!data) return [];
    return sleeves.filter((s) => active.has(s.code)).map((s) => {
      const last = data.equity.filter((e) => e.sleeve === s.code).at(-1);
      return { ...s, rec: last ?? null };
    });
  }, [data, sleeves, active]);
  const exposure = useMemo(() => {
    const m = new Map<string, number>();
    let tot = 0;
    for (const h of holdings) {
      if (!h.rec) continue;
      for (const p of h.rec.positions) {
        const mv = p.market_value ?? (p.price != null ? p.price * p.qty : null);
        if (mv == null) continue;
        const c = byTicker.get(p.ticker);
        const mk = c ? marketOfSegment(c.segment) ?? 'other' : /^(SPY|QQQ|SOXX|IWM|DIA|SH|PSQ|SQQQ|SOXS)$/.test(p.ticker) ? 'index' : 'other';
        m.set(mk, (m.get(mk) ?? 0) + Math.abs(mv));
        tot += Math.abs(mv);
      }
    }
    return [...m.entries()].map(([k, v]) => ({ k, label: MARKETS.find((x) => x.id === k)?.label ?? (k === 'index' ? 'Index ETFs / hedges' : 'Untracked'), w: tot ? (v / tot) * 100 : 0 })).sort((a, b) => b.w - a.w);
  }, [holdings, byTicker]);

  const trades = useMemo(() => (data ? data.trades.filter((t) => active.has(t.sleeve)).slice(-200).reverse() : []), [data, active]);
  const reports = useMemo(() => (data ? [...data.reports].filter((r) => r.sleeves.some((s) => active.has(s.sleeve)) || !sleeves.length).reverse() : []), [data, active, sleeves.length]);
  const report: BotReport | null = reports.find((r) => r.id === reportId) ?? reports[0] ?? null;

  const openTicker = (t: string) => {
    const c = byTicker.get(t);
    if (c) onOpenFinancials(c.id);
    else onOpenTab('markets');
  };

  const offline = data != null && !data.ok;
  const empty = data != null && data.ok && !data.equity.length && !data.trades.length && !data.reports.length;
  const { mode, ackAt } = currentMode(data);
  const isLive = mode === 'live';
  const live = data?.ok && data.status?.equity.last ? Date.now() - Date.parse(data.status.equity.last) < 2 * 3600000 : false;
  const xFmt = (t: number) => new Date(t).toLocaleString(undefined, range === '1D' || range === '1W' ? { month: 'numeric', day: 'numeric', hour: '2-digit' } : { month: 'short', day: 'numeric' });

  return (
    <div className={`trader-tab ${isMobile ? 'is-mobile' : ''} ${isLive ? 'is-live-mode' : ''}`}>
      {isLive && (
        <section className="live-banner" role="alert" aria-live="assertive">
          <div className="live-banner-head">
            <span className="live-banner-dot" aria-hidden />
            <strong>LIVE TRADING — REAL MONEY</strong>
            <span className="live-banner-meta">
              Enabled with <code>TRADING_MODE=live</code>
              {ackAt ? <> · Risk accepted {fmtLocal(ackAt)}</> : <> · Risk acceptance time not reported</>}
            </span>
          </div>
          <p>
            This bot is placing real orders with real funds. This software is provided as is, with no warranty. The repository owner and
            contributors carry no responsibility for any losses or inaccuracies. By enabling live trading you accepted full risk of loss.
          </p>
        </section>
      )}
      {/* 1. Header strip */}
      <section className="panel trader-strip">
        <div className="trader-strip-top">
          <span className={`data-badge ${offline ? 'badge-down' : live ? 'badge-live' : 'badge-mixed'}`}>{data == null ? 'CONNECTING' : offline ? 'OFFLINE' : live ? 'ENGINE ACTIVE' : 'ENGINE IDLE'}</span>
          <span className={`data-badge mode-badge ${isLive ? 'mode-live' : 'mode-paper'}`} title={isLive ? 'Real-money account (TRADING_MODE=live)' : 'Paper account, simulated money (live trading is off by default)'}>
            {data == null ? 'MODE …' : isLive ? 'LIVE' : 'PAPER'}
          </span>
          {anyExample && <ExampleTag on />}
          <span className="muted">Last update: {fmtLocal(data?.status?.equity.last ?? data?.status?.trades.last ?? null)} · refreshed {data ? fmtLocal(data.fetchedAt) : '—'} · auto-refresh 60s</span>
          {sleeves.length > 0 && (
            <label className="muted trader-lead">
              Headline sleeve{' '}
              <select value={leadCode ?? ''} onChange={(e) => setLead(e.target.value)}>
                {sleeves.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="chip" onClick={() => void refresh()}>Refresh</button>
        </div>
        <div className="trader-kpis">
          <div className="kpi"><div className="kpi-label">Equity</div><div className="kpi-val">{fmtUsd(eqNow)}</div></div>
          <div className="kpi"><div className="kpi-label">Day P&amp;amp;L</div><div className="kpi-val" style={{ color: pnlColor(dayPnl) }}>{fmtUsd(dayPnl)}</div></div>
          <div className="kpi"><div className="kpi-label">Week P&amp;amp;L</div><div className="kpi-val" style={{ color: pnlColor(weekPnl) }}>{fmtUsd(weekPnl)}</div></div>
          <div className="kpi"><div className="kpi-label">Since inception</div><div className="kpi-val" style={{ color: pnlColor(sinceInc) }}>{pct(sinceInc)}</div></div>
          <div className="kpi kpi-wide">
            <div className="kpi-label">Annualised pace vs &amp;gt;{TARGET}% target</div>
            <div className="kpi-val" style={{ color: ann ? pnlColor(ann.pct - TARGET) : undefined }}>{ann ? `${fmtPct(ann.pct, 1)} / yr` : 'N/A (<7 days)'}</div>
            <div className="target-bar" aria-hidden>
              <div className="target-fill" style={{ width: `${ann ? Math.max(0, Math.min(100, (ann.pct / (TARGET * 1.5)) * 100)) : 0}%`, background: behind ? 'var(--red)' : 'var(--green)' }} />
              <div className="target-goal" style={{ left: `${(1 / 1.5) * 100}%` }} title={`${TARGET}% goal`} />
            </div>
          </div>
        </div>
        {behind && (
          <div className="trader-flag">
            ⚑ Behind the &amp;gt;{TARGET}% annual pace ({fmtPct(ann!.pct, 1)}/yr over {Math.round(ann!.days)} days).{' '}
            {latestReport ? (
              <a href="#trader-weekly" onClick={() => setReportId(latestReport.id)}>Read the bot's explanation →</a>
            ) : (
              <span className="muted">The bot has not posted a weekly explanation yet.</span>
            )}
          </div>
        )}
        <p className="panel-note">The &amp;gt;{TARGET}% target is a goal the bot tracks and explains when it misses — not a promise. All figures come from records the trading bot posted ({isLive ? 'LIVE account, real money' : 'paper account'}); nothing here is estimated.</p>
      </section>

      {offline && (
        <section className="panel trader-empty">
          <h3>Trading engine data unavailable</h3>
          <p>Could not read the bot endpoints on this terminal server ({data?.error}). Make sure the terminal server (server.mjs or serve.py) is the one serving this page.</p>
        </section>
      )}
      {empty && (
        <section className="panel trader-empty">
          <h3>No trading records yet</h3>
          <p>The AI Trader tab fills in once the trading bot posts to <code>/api/bot/equity</code>, <code>/api/bot/trades</code> and <code>/api/bot/weekly-report</code>. Contract: <code>docs/bot-api-contract.md</code>.</p>
          <p className="muted">Signals the bot reads: <code>/api/signals</code> · <code>/api/news-feed</code> · <code>/api/mock-index</code> — {data?.status?.signals_received_at ? `last published ${fmtLocal(data.status.signals_received_at)}` : 'not published yet'}.</p>
        </section>
      )}

      {/* Sleeve filter */}
      {sleeves.length > 0 && (
        <div className="trader-sleeves">
          <span className="muted">Sleeves:</span>
          {sleeves.map((s, i) => (
            <button key={s.code} type="button" className={`chip ${active.has(s.code) ? 'on' : ''}`} onClick={() => toggle(s.code)} style={{ borderColor: sleeveColor(s.code, i) }}>
              <span className="swatch" style={{ background: sleeveColor(s.code, i) }} /> {s.code} · {s.label}
            </button>
          ))}
          <button type="button" className="chip" onClick={() => setPicked(null)}>All</button>
        </div>
      )}

      {/* 2. Live performance */}
      <section className="panel">
        <div className="trader-sec-head">
          <h3>Live performance vs market</h3>
          <div className="range-toggle">
            {RANGES.map((r) => (
              <button key={r} type="button" className={`chip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
          {baskets.length > 0 && (
            <select value={basketName} onChange={(e) => setBasketName(e.target.value)} aria-label="Mock Index basket benchmark">
              <option value="">+ Mock Index basket…</option>
              {baskets.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          )}
        </div>
        <p className="panel-note">% change from the start of the range. Benchmarks: SPY, QQQ, SOXX{basketName ? `, basket “${basketName}”` : ''} (Yahoo closes).</p>
        <div className="trader-chart">
          <ResponsiveContainer width="100%" height={isMobile ? 220 : 300}>
            <LineChart data={chart} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1e2d4a" strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xFmt} stroke="#8fa3c4" fontSize={10} />
              <YAxis stroke="#8fa3c4" fontSize={10} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <ReferenceLine y={0} stroke="#2a3f66" />
              <Tooltip contentStyle={{ background: '#0a1220', border: '1px solid #2a3f66' }} labelFormatter={(t) => fmtLocal(Number(t))} formatter={(v, n) => [fmtPct(Number(v), 2), String(n)]} />
              {sleeves.filter((s) => active.has(s.code)).map((s, i) => (
                <Line key={s.code} dataKey={s.code} name={`${s.code} ${s.label}`} stroke={sleeveColor(s.code, i)} dot={false} strokeWidth={s.code === leadCode ? 2.4 : 1.4} connectNulls isAnimationActive={false} />
              ))}
              {Object.keys(bench).filter((k) => bench[k].length).map((k) => (
                <Line key={k} dataKey={k} name={k === 'BASKET' ? `Basket ${basketName}` : k} stroke={BENCH_COLORS[k]} strokeDasharray="4 3" dot={false} strokeWidth={1.2} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {!leadSeries.length && <p className="muted">No equity records from the bot yet — only benchmarks are shown.</p>}
        <h4>Drawdown — {leadCode ?? 'n/a'}</h4>
        <ResponsiveContainer width="100%" height={isMobile ? 110 : 140}>
          <AreaChart data={dd} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#1e2d4a" strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={xFmt} stroke="#8fa3c4" fontSize={10} />
            <YAxis stroke="#8fa3c4" fontSize={10} tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: '#0a1220', border: '1px solid #2a3f66' }} labelFormatter={(t) => fmtLocal(Number(t))} formatter={(v) => [fmtPct(Number(v), 2), 'Drawdown']} />
            <Area dataKey="dd" stroke="#ef5350" fill="rgba(239,83,80,0.25)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="table-scroll">
          <table className="trader-table">
            <thead>
              <tr><th>Sleeve</th><th>Return</th><th title="Sleeve return minus SPY return over the same range">Alpha vs SPY</th><th>Sharpe</th><th>Sortino</th><th>Max DD</th><th>Win rate</th><th>Turnover</th></tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.code}>
                  <td>{m.code} · {m.label}</td>
                  <td style={{ color: pnlColor(m.ret) }}>{pct(m.ret)}</td>
                  <td style={{ color: pnlColor(m.alpha) }}>{pct(m.alpha)}</td>
                  <td>{fmtN(m.sharpe)}</td>
                  <td>{fmtN(m.sortino)}</td>
                  <td style={{ color: m.mdd != null && m.mdd < 0 ? 'var(--red)' : undefined }}>{pct(m.mdd)}</td>
                  <td>{m.win ? `${m.win.rate.toFixed(0)}% (${m.win.n})` : 'N/A'}</td>
                  <td>{m.turn != null ? `${m.turn.toFixed(0)}%` : 'N/A'}</td>
                </tr>
              ))}
              {!metrics.length && <tr><td colSpan={8} className="muted">No sleeves reported yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="panel-note">Sharpe/Sortino use daily returns (last record per day, ×√252, rf = 0) and need ≥5 days. Win rate counts closing trades vs running average cost.</p>
      </section>

      {/* 3. Holdings & exposure */}
      <section className="panel">
        <h3>Holdings &amp;amp; exposure</h3>
        {holdings.filter((h) => h.rec).map((h) => (
          <div key={h.code} className="trader-hold">
            <h4>
              {h.code} · {h.label} <span className="muted">equity {fmtUsd(h.rec!.equity)} · cash {fmtUsd(h.rec!.cash)} · {fmtLocal(h.rec!.ts)}</span> <ExampleTag on={h.rec!.example} />
            </h4>
            <div className="table-scroll">
              <table className="trader-table">
                <thead><tr><th>Ticker</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Unrealised P&amp;amp;L</th><th>Weight</th></tr></thead>
                <tbody>
                  {h.rec!.positions.map((p) => {
                    const mv = p.market_value ?? (p.price != null ? p.price * p.qty : null);
                    const upl = p.unrealized_pl ?? (p.price != null && p.avg_cost != null ? (p.price - p.avg_cost) * p.qty : null);
                    return (
                      <tr key={p.ticker} className={p.hedge || p.qty < 0 ? 'is-hedge' : ''}>
                        <td>
                          <button type="button" className="link-btn mono" onClick={() => openTicker(p.ticker)}>{p.ticker}</button>
                          {(p.hedge || p.qty < 0) && <span className="hedge-tag">HEDGE</span>}
                        </td>
                        <td>{p.qty}</td>
                        <td>{fmtUsd(p.avg_cost)}</td>
                        <td>{fmtUsd(p.price)}</td>
                        <td style={{ color: pnlColor(upl) }}>{fmtUsd(upl)}</td>
                        <td>{mv != null && h.rec!.equity > 0 ? `${((mv / h.rec!.equity) * 100).toFixed(1)}%` : 'N/A'}</td>
                      </tr>
                    );
                  })}
                  {!h.rec!.positions.length && <tr><td colSpan={6} className="muted">All cash.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!holdings.some((h) => h.rec) && <p className="muted">No positions reported yet.</p>}
        {exposure.length > 0 && (
          <>
            <h4>Exposure by terminal market (selected sleeves, gross)</h4>
            <div className="exposure-bars">
              {exposure.map((e) => (
                <div key={e.k} className="exp-row">
                  <span className="exp-label">{e.label}</span>
                  <span className="exp-bar"><span style={{ width: `${e.w}%`, background: MARKETS.find((m) => m.id === e.k)?.color ?? '#8fa3c4' }} /></span>
                  <span className="exp-val">{e.w.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 4. Trades feed */}
      <section className="panel">
        <h3>Trades &amp;amp; rationale</h3>
        <div className="trade-feed">
          {trades.map((t: BotTrade) => (
            <div key={t.id} className="trade-row">
              <div className="trade-top">
                <span className={`trade-side side-${t.side}`}>{t.side.toUpperCase()}</span>
                <button type="button" className="link-btn mono" onClick={() => openTicker(t.ticker)}>{t.ticker}</button>
                <span>{t.qty} @ {fmtUsd(t.price)}</span>
                <span className="muted">{t.sleeve} · {t.sleeve_label}</span>
                {t.timeframe && <span className="muted">{t.timeframe}</span>}
                {t.status && <span className="muted">{t.status}</span>}
                <span className="muted trade-ts">{fmtLocal(t.ts)}</span>
                <ExampleTag on={t.example} />
              </div>
              <p className="trade-reason">{t.reason.text}</p>
              <div className="sig-chips">
                {Object.entries(t.reason.signals).map(([k, v]) => {
                  const g = signalGroup(k);
                  return <span key={k} className={`sig-chip ${g.cls}`} title={g.group}>{g.group}: {k} = {typeof v === 'number' ? +v.toFixed(3) : String(v)}</span>;
                })}
              </div>
            </div>
          ))}
          {!trades.length && <p className="muted">No trades posted yet.</p>}
        </div>
      </section>

      {/* 5. Weekly review */}
      <section className="panel" id="trader-weekly">
        <div className="trader-sec-head">
          <h3>Weekly review &amp;amp; report</h3>
          {report && <button type="button" className="chip" onClick={() => window.print()}>Print / PDF</button>}
        </div>
        {!reports.length && <p className="muted">No weekly reports yet. The bot posts one per week to <code>/api/bot/weekly-report</code>.</p>}
        {reports.length > 0 && (
          <div className="report-layout">
            <ul className="report-list">
              {reports.map((r) => (
                <li key={r.id}>
                  <button type="button" className={`report-item ${report?.id === r.id ? 'on' : ''}`} onClick={() => setReportId(r.id)}>
                    <span>{r.week_start} → {r.week_end}</span>
                    {r.target_flag && <span className="flag-dot" title="Behind target">⚑</span>}
                    <ExampleTag on={r.example} />
                  </button>
                </li>
              ))}
            </ul>
            {report && (
              <article className="report-reader print-area">
                <h4>
                  Week {report.week_start} → {report.week_end} <ExampleTag on={report.example} />
                </h4>
                {report.target_flag && <div className="trader-flag">⚑ Below the &amp;gt;{Number(report.target_annual_pct).toFixed(0)}% annualised pace this week.</div>}
                {report.summary && <p>{report.summary}</p>}
                <h5>Bot vs market</h5>
                <div className="table-scroll">
                  <table className="trader-table">
                    <thead><tr><th>Sleeve / benchmark</th><th>Return</th><th>Annualised</th><th>Max DD</th><th>Trades</th></tr></thead>
                    <tbody>
                      {report.sleeves.map((s) => (
                        <tr key={s.sleeve}>
                          <td>{s.sleeve} · {s.sleeve_label}</td>
                          <td style={{ color: pnlColor(s.return_pct) }}>{pct(s.return_pct)}</td>
                          <td style={{ color: s.annualized_pct != null ? pnlColor(s.annualized_pct - report.target_annual_pct) : undefined }}>{pct(s.annualized_pct, 1)}</td>
                          <td>{pct(s.max_drawdown_pct)}</td>
                          <td>{s.trades ?? 'N/A'}</td>
                        </tr>
                      ))}
                      {report.benchmarks.map((b) => (
                        <tr key={b.name} className="bench-row"><td>{b.name}</td><td style={{ color: pnlColor(b.return_pct) }}>{pct(b.return_pct)}</td><td>—</td><td>—</td><td>—</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.went_right.length > 0 && (<><h5 className="up">What went right</h5><ul>{report.went_right.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
                {report.went_wrong.length > 0 && (<><h5 className="down">What went wrong</h5><ul>{report.went_wrong.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
                <h5>{report.target_flag ? 'Why it missed the target' : 'Why it performed this way'}</h5>
                <p className="report-why">{report.why}</p>
                {report.missed.length > 0 && (
                  <>
                    <h5>What the bot missed</h5>
                    <ul className="missed-list">
                      {report.missed.map((m, i) => <li key={i}><span className={`miss-kind miss-${m.kind}`}>{m.kind === 'info' ? 'Information' : m.kind === 'prediction' ? 'Prediction' : 'Statistic'}</span> {m.detail}</li>)}
                    </ul>
                  </>
                )}
                <h5>Paper vs real-world caveats</h5>
                <ul>{report.paper_vs_real.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </article>
            )}
          </div>
        )}
      </section>

      {/* 6. Backtest */}
      {data?.backtest && (
        <section className="panel">
          <h3>Backtest <ExampleTag on={data.backtest.example} /></h3>
          <p className="panel-note">{data.backtest.period ? `${data.backtest.period} · ` : ''}generated {fmtLocal(data.backtest.generated_at)}. {data.backtest.universe_note}</p>
          <div className="table-scroll">
            <table className="trader-table">
              <thead><tr><th>Sleeve</th><th>CAGR</th><th>Total</th><th>Vol</th><th>Sharpe</th><th>Max DD</th><th>Hit rate</th></tr></thead>
              <tbody>
                {data.backtest.rows.map((r) => (
                  <tr key={r.sleeve + r.sleeve_label}>
                    <td>{r.sleeve} · {r.sleeve_label}{r.note ? <div className="muted">{r.note}</div> : null}</td>
                    <td style={{ color: r.cagr_pct != null ? pnlColor(r.cagr_pct - TARGET) : undefined }}>{pct(r.cagr_pct, 1)}</td>
                    <td style={{ color: pnlColor(r.total_return_pct) }}>{pct(r.total_return_pct, 1)}</td>
                    <td>{pct(r.vol_pct, 1)}</td>
                    <td>{fmtN(r.sharpe)}</td>
                    <td>{pct(r.max_dd_pct, 1)}</td>
                    <td>{r.hit_rate_pct != null ? `${r.hit_rate_pct.toFixed(0)}%` : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.backtest.newer_names_flagged.length > 0 && (
            <p className="muted">Newer names (&amp;lt;5 yrs of filings; smaller sizing / hedged): {data.backtest.newer_names_flagged.join(', ')}</p>
          )}
          <p className="panel-note">CAGR coloured vs the {TARGET}% goal. Backtests are hypothetical and overstate live results.</p>
        </section>
      )}
    </div>
  );
}
