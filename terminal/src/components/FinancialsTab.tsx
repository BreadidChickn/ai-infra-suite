import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Company, Relationship } from '../types';
import { COMPANY_CIKS, FILING_PROFILES } from '../data/secMeta';
import { outsideInvestors } from '../data/outsideInvestors';
import { finNoteFor } from '../data/financialNotes';
import { isEnergySegment } from '../data/constants';
import { AI_EXPOSURE_HELP, AI_EXPOSURE_LABELS, aiProfileFor } from '../data/aiExposure';
import {
  delta,
  fetchLiveFinancials,
  filingIndexUrl,
  fmtDeltaPct,
  fmtMoney,
  fmtPp,
  fmtShares,
  loadSecSnapshot,
  METRIC_LABELS,
  periodEnds,
  periodLabel,
  pointAt,
  prevEnd,
  scaleFor,
  shortDate,
  ttm,
  windowVal,
  yearAgoEnd,
  type CompanyFin,
  type Delta,
  type FinPoint,
  type FinSource,
  type MetricKey,
  type PeriodMode,
  type SecSnapshot,
} from '../services/secFinancials';
import { analyze, analyzeYtd, windowName, ytdVal, ytdWindow, type Insight, type YtdWindow } from '../services/finAnalysis';
import { displayCode, fmtUsdM } from '../utils/format';
import { GLOSSARY_BY_ID, openGlossary } from '../data/glossary';
import type { UserCompaniesApi } from '../hooks/useUserCompanies';
import { GrokLinkIndicator, RequestStatusChip } from './GlobalSearch';

interface Props {
  companies: Company[];
  relationships: Relationship[];
  isMobile: boolean;
  /** User-added SEC filers (from Search) — shown as "Added by you — pending full integration". */
  user?: UserCompaniesApi;
  /** Jump request from Search; `n` changes on every request so re-selecting the same company works. */
  focus?: { id: string; n: number } | null;
}

const GREEN = '#00e676';
const RED = '#ef5350';
const AMBER = '#ffb300';
const CYAN = '#4fc3f7';
const MUTED = '#8fa3c4';

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

/** Metric → glossary entry for the small ⓘ buttons. */
const METRIC_GLOSSARY: Partial<Record<MetricKey, string>> = {
  revenue: 'revenue',
  revenueProducts: 'products-services',
  revenueServices: 'products-services',
  costOfRevenue: 'cogs',
  rnd: 'rnd',
  sga: 'sga',
  opex: 'opex',
  operatingIncome: 'operating-income',
  netIncome: 'net-income',
  grossProfit: 'gross-profit',
  ocf: 'ocf',
  capex: 'capex',
  acquisitions: 'acquisitions',
  investPurchases: 'invest-purchases',
  investProceeds: 'invest-sales',
  buybacks: 'buybacks',
  dividends: 'dividends',
  debtIssued: 'debt-issued',
  debtRepaid: 'debt-repaid',
  sbc: 'sbc',
  dilutedShares: 'diluted-shares',
  fcf: 'fcf',
};

function GlossInfo({ id }: { id?: string }) {
  if (!id) return null;
  const t = GLOSSARY_BY_ID[id];
  if (!t) return null;
  return (
    <button
      type="button"
      className="gloss-info"
      title={`${t.term}: ${t.definition} — click for example in Glossary`}
      aria-label={`What is ${t.term}? Open glossary`}
      onClick={(e) => {
        e.stopPropagation();
        openGlossary(id);
      }}
    >
      i
    </button>
  );
}

function SourceBadge({ source, small }: { source: FinSource; small?: boolean }) {
  const map = {
    live: { cls: 'badge-live', text: 'LIVE SEC' },
    snapshot: { cls: 'badge-mixed', text: 'SNAPSHOT' },
    illustrative: { cls: 'badge-illustrative', text: 'ILLUSTRATIVE' },
  } as const;
  const m = map[source];
  return <span className={`data-badge fin-badge ${m.cls} ${small ? 'is-small' : ''}`}>{m.text}</span>;
}

function DerivedTag({ p }: { p?: FinPoint }) {
  if (!p?.derived) return null;
  const title =
    p.derived === 'ytd-diff'
      ? 'Discrete quarter derived from year-to-date filings (YTD − prior YTD, or FY − 9M)'
      : `Derived: ${p.tag}`;
  return (
    <span className="fin-derived" title={title}>
      {p.derived === 'ytd-diff' ? 'YTD-diff' : 'calc'}
    </span>
  );
}

function FilingLink({ fin, p }: { fin: CompanyFin | null; p?: FinPoint }) {
  if (!fin?.cik || !p?.accn) return null;
  return (
    <a
      className="fin-filing"
      href={filingIndexUrl(fin.cik, p.accn)}
      target="_blank"
      rel="noreferrer"
      title={`${p.form} filed ${p.filed} · accession ${p.accn} · tag ${p.tag}`}
    >
      {p.form} ↗
    </a>
  );
}

type Tone = 'good' | 'bad' | 'neutral';
function toneFor(d: Delta | null, invert?: boolean, neutral?: boolean): Tone {
  if (!d || neutral) return 'neutral';
  const v = d.pct ?? d.abs;
  if (Math.abs(v) < 0.05) return 'neutral';
  const up = v > 0;
  return up !== Boolean(invert) ? 'good' : 'bad';
}

function DeltaChip({
  label,
  d,
  currency,
  invert,
  neutral,
  shares,
}: {
  label: string;
  d: Delta | null;
  currency?: string | null;
  invert?: boolean;
  neutral?: boolean;
  shares?: boolean;
}) {
  const tone = toneFor(d, invert, neutral);
  const arrow = !d ? '' : d.abs > 0 ? '▲' : d.abs < 0 ? '▼' : '■';
  return (
    <span className={`delta-chip tone-${tone}`} title={label}>
      <span className="delta-label">{label}</span>
      {d ? (
        <>
          <span className="delta-arrow">{arrow}</span>
          <span>{fmtDeltaPct(d.pct)}</span>
          <span className="delta-abs">
            ({d.abs > 0 ? '+' : ''}
            {shares ? fmtShares(d.abs) : fmtMoney(d.abs, currency)})
          </span>
        </>
      ) : (
        <span className="muted">N/A</span>
      )}
    </span>
  );
}

function Section({
  id,
  title,
  badge,
  children,
  isMobile,
  open,
  onToggle,
  className,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  isMobile: boolean;
  open: boolean;
  onToggle: (id: string) => void;
  className?: string;
}) {
  if (!isMobile) {
    return (
      <section className={`panel fin-card ${className || ''}`} id={`fin-${id}`}>
        <div className="fin-card-head">
          <h3>{title}</h3>
          {badge}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section className={`panel fin-card fin-collapsible ${open ? 'is-open' : ''} ${className || ''}`} id={`fin-${id}`}>
      <button type="button" className="fin-collapse-btn" aria-expanded={open} onClick={() => onToggle(id)}>
        <span className="fin-collapse-title">{title}</span>
        {badge}
        <span className="fin-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="fin-collapse-body">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Metric rows (table on desktop, label/value rows on mobile)          */
/* ------------------------------------------------------------------ */

interface RowDef {
  key: MetricKey;
  invert?: boolean;
  neutral?: boolean;
  label?: string;
  ofRevenue?: boolean;
}

function MetricRows({
  rows,
  fin,
  mode,
  end,
  ends,
  isMobile,
  showTtm,
}: {
  rows: RowDef[];
  fin: CompanyFin | null;
  mode: PeriodMode;
  end?: string;
  ends: string[];
  isMobile: boolean;
  showTtm?: boolean;
}) {
  const cur = fin?.currency;
  const pe = end ? prevEnd(ends, end) : undefined;
  const ye = end ? yearAgoEnd(ends, end) : undefined;
  const rev = pointAt(fin, 'revenue', mode, end)?.val;
  const stale = new Map((fin?.stale || []).map((s) => [s.key, s.latest]));

  const data = rows.map((r) => {
    const p = pointAt(fin, r.key, mode, end);
    const isShares = r.key === 'dilutedShares';
    const qoq = mode === 'quarterly' && pe ? delta(p?.val, pointAt(fin, r.key, mode, pe)?.val) : null;
    const yoy = ye ? delta(p?.val, pointAt(fin, r.key, mode, ye)?.val) : null;
    const t = showTtm && mode === 'quarterly' && end && !isShares ? ttm(fin, r.key, end) : undefined;
    const share = r.ofRevenue && p && rev ? (p.val / rev) * 100 : undefined;
    const naHint = !p
      ? !fin
        ? 'No SEC XBRL filings for this company'
        : stale.get(r.key)
        ? `No discrete value in recent XBRL (last tagged ${stale.get(r.key)})`
        : 'Not tagged in SEC companyfacts for this period'
      : '';
    return { r, p, isShares, qoq, yoy, t, share, naHint };
  });

  if (isMobile) {
    return (
      <div className="fin-rows">
        {data.map(({ r, p, isShares, qoq, yoy, t, share, naHint }) => (
          <div className="fin-row" key={r.key}>
            <div className="fin-row-top">
              <span className="fin-row-label">
                {r.label || METRIC_LABELS[r.key]}
                <GlossInfo id={METRIC_GLOSSARY[r.key]} />
              </span>
              <span className="fin-row-val mono" title={naHint}>
                {p ? (isShares ? fmtShares(p.val) : fmtMoney(p.val, cur)) : 'N/A'}
              </span>
            </div>
            <div className="fin-row-meta">
              {mode === 'quarterly' && (
                <DeltaChip label="QoQ" d={qoq} currency={cur} invert={r.invert} neutral={r.neutral} shares={isShares} />
              )}
              <DeltaChip label="YoY" d={yoy} currency={cur} invert={r.invert} neutral={r.neutral} shares={isShares} />
              {share != null && <span className="fin-pill">{share.toFixed(1)}% of rev</span>}
              {t != null && <span className="fin-pill">TTM {fmtMoney(t, cur)}</span>}
              <DerivedTag p={p} />
              <FilingLink fin={fin} p={p} />
            </div>
            {!p && <div className="tiny muted">{naHint}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table compact fin-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">{end ? periodLabel(fin, mode, end) : '—'}</th>
            {mode === 'quarterly' && <th className="num">QoQ</th>}
            <th className="num">YoY</th>
            {rows.some((r) => r.ofRevenue) && <th className="num">% rev</th>}
            {showTtm && mode === 'quarterly' && <th className="num">TTM</th>}
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ r, p, isShares, qoq, yoy, t, share, naHint }) => (
            <tr key={r.key}>
              <td>
                {r.label || METRIC_LABELS[r.key]}
                <GlossInfo id={METRIC_GLOSSARY[r.key]} />
              </td>
              <td className="num mono" title={naHint}>
                {p ? (isShares ? fmtShares(p.val) : fmtMoney(p.val, cur)) : <span className="muted">N/A</span>}
              </td>
              {mode === 'quarterly' && (
                <td className="num">
                  <DeltaChip label="" d={qoq} currency={cur} invert={r.invert} neutral={r.neutral} shares={isShares} />
                </td>
              )}
              <td className="num">
                <DeltaChip label="" d={yoy} currency={cur} invert={r.invert} neutral={r.neutral} shares={isShares} />
              </td>
              {rows.some((x) => x.ofRevenue) && (
                <td className="num mono">{share != null ? `${share.toFixed(1)}%` : r.ofRevenue ? 'N/A' : ''}</td>
              )}
              {showTtm && mode === 'quarterly' && (
                <td className="num mono">{t != null ? fmtMoney(t, cur) : isShares ? '' : 'N/A'}</td>
              )}
              <td className="fin-src-cell">
                <FilingLink fin={fin} p={p} />
                <DerivedTag p={p} />
                {!p && <span className="tiny muted">{naHint}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main tab                                                            */
/* ------------------------------------------------------------------ */

const SECTION_IDS = ['revenue', 'costs', 'profit', 'flows', 'retail'] as const;

export function FinancialsTab({ companies: builtInCompanies, relationships, isMobile, user, focus }: Props) {
  const pendingUser = user?.pendingCompanies;
  const companies = useMemo(
    () => (pendingUser?.length ? [...builtInCompanies, ...pendingUser] : builtInCompanies),
    [builtInCompanies, pendingUser]
  );
  const [companyId, setCompanyIdState] = useState('nvidia');
  /** Select a company and mirror it in ?company= so refreshes / later list updates keep the choice. */
  const setCompanyId = (id: string) => {
    setCompanyIdState(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('company', id);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* ignore */
    }
  };
  const [modePref, setMode] = useState<PeriodMode>('quarterly');
  const [focusEnd, setFocusEnd] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<SecSnapshot | null | undefined>(undefined);
  const [live, setLive] = useState<Record<string, CompanyFin>>({});
  const [liveState, setLiveState] = useState<Record<string, 'loading' | 'error'>>({});
  const [autoLive, setAutoLive] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({ revenue: true, costs: false, profit: true, flows: false, retail: false });

  // A user-added id whose CIK is now built in resolves to the built-in company.
  const company =
    companies.find((c) => c.id === companyId) ||
    (companyId.startsWith('user-')
      ? builtInCompanies.find((c) => c.cik && c.cik.replace(/\D/g, '').padStart(10, '0') === companyId.slice(5))
      : undefined) ||
    companies[0]!;
  const cik = (company.cik || COMPANY_CIKS[company.id] || '').replace(/\D/g, '');
  const hasCik = Boolean(cik) && !company.isPrivate;
  const userEntry = company.userAdded ? user?.companies.find((u) => u.cik === cik.padStart(10, '0')) : undefined;
  const userFin = userEntry?.fin && userEntry.fin.status === 'ok' ? userEntry.fin : null;
  const baseNote = finNoteFor(company.id, company.isPrivate);
  const note = company.userAdded
    ? {
        ...baseNote,
        naReason:
          'This filer has formal SEC filings but no usable XBRL company facts on EDGAR (e.g. an S-1 / F-1 registration without tagged financials yet), so every figure is N/A rather than estimated.',
      }
    : baseNote;

  useEffect(() => {
    let cancelled = false;
    loadSecSnapshot().then((s) => {
      if (!cancelled) setSnapshot(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Honour ?company= once the company list is available (e.g. deep-link to SpaceX financials).
  useEffect(() => {
    const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('company') : null;
    if (q && companies.some((c) => c.id === q) && companyId !== q) setCompanyIdState(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  // Jump requests from the global Search (works even when this tab is already open).
  useEffect(() => {
    if (focus?.id) setCompanyIdState(focus.id);
  }, [focus]);

  const refreshLive = async (force = false) => {
    if (!hasCik) return;
    if (!force && (live[company.id] || liveState[company.id])) return;
    setLiveState((s) => ({ ...s, [company.id]: 'loading' }));
    try {
      const f = await fetchLiveFinancials(company.id, cik, company.ticker);
      if (f.status !== 'ok') throw new Error('no xbrl');
      setLive((l) => ({ ...l, [company.id]: f }));
      setLiveState((s) => {
        const n = { ...s };
        delete n[company.id];
        return n;
      });
    } catch {
      setLiveState((s) => ({ ...s, [company.id]: 'error' }));
    }
  };

  useEffect(() => {
    if (autoLive && hasCik && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      void refreshLive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id, autoLive]);

  const snapFin = snapshot?.companies?.[company.id];
  // User-added filers carry the figures pulled live from SEC when they were added (refreshed again on view).
  const fin: CompanyFin | null = live[company.id] ?? userFin ?? (snapFin && snapFin.status === 'ok' ? snapFin : null);
  const source: FinSource = live[company.id] || userFin ? 'live' : fin ? 'snapshot' : 'illustrative';
  const filingsSnap = snapshot?.filings?.[company.id] ?? userEntry?.filings ?? undefined;
  const cur = fin?.currency;
  // Annual-only filers (e.g. 20-F without XBRL'd 6-Ks): fall back to Annual without changing the user's preference.
  const noQuarterly = Boolean(fin) && periodEnds(fin, 'quarterly').length === 0 && periodEnds(fin, 'annual').length > 0;
  // Newly public filers (first 10-Q, no 10-K yet): quarterly only.
  const noAnnual = Boolean(fin) && periodEnds(fin, 'annual').length === 0 && periodEnds(fin, 'quarterly').length > 0;
  const mode: PeriodMode = modePref === 'quarterly' && noQuarterly ? 'annual' : modePref === 'annual' && noAnnual ? 'quarterly' : modePref;
  const ytdW = useMemo(() => ytdWindow(fin), [fin]);

  const ends = useMemo(() => periodEnds(fin, mode), [fin, mode]);
  const end = focusEnd && ends.includes(focusEnd) ? focusEnd : ends.at(-1);
  const pe = end ? prevEnd(ends, end) : undefined;
  const ye = end ? yearAgoEnd(ends, end) : undefined;
  const chartEnds = useMemo(() => {
    const i = end ? ends.indexOf(end) : ends.length - 1;
    return ends.slice(Math.max(0, i - (mode === 'quarterly' ? 7 : 5)), i + 1);
  }, [ends, end, mode]);

  useEffect(() => setFocusEnd(undefined), [companyId, mode]);


  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const expandAll = (v: boolean) => setOpen(Object.fromEntries(SECTION_IDS.map((s) => [s, v])));

  const grouped = useMemo(() => {
    const sec: Company[] = [];
    const secEnergy: Company[] = [];
    const nonSec: Company[] = [];
    const priv: Company[] = [];
    const added: Company[] = [];
    for (const c of companies) {
      const k = (c.cik || COMPANY_CIKS[c.id] || '').replace(/\D/g, '');
      if (c.userAdded) added.push(c);
      else if (c.isPrivate) priv.push(c);
      else if (k) (isEnergySegment(c.segment) ? secEnergy : sec).push(c);
      else nonSec.push(c);
    }
    const by = (a: Company, b: Company) => b.marketCapB - a.marketCapB;
    return { sec: sec.sort(by), secEnergy: secEnergy.sort(by), nonSec: nonSec.sort(by), priv: priv.sort(by), added: added.sort((a, b) => a.name.localeCompare(b.name)) };
  }, [companies]);

  const v = (k: MetricKey, e = end) => pointAt(fin, k, mode, e);
  const rev = v('revenue');
  const revQ = mode === 'quarterly' && pe ? delta(rev?.val, v('revenue', pe)?.val) : null;
  const revY = ye ? delta(rev?.val, v('revenue', ye)?.val) : null;

  const margin = (num: MetricKey, e?: string) => {
    const n = v(num, e)?.val;
    const d = v('revenue', e)?.val;
    return n != null && d ? (n / d) * 100 : undefined;
  };

  const lbl = (e: string) => periodLabel(fin, mode, e);

  /* chart data */
  const revData = chartEnds.map((e, i) => {
    const val = v('revenue', e)?.val;
    const prev = i > 0 ? v('revenue', chartEnds[i - 1])?.val : undefined;
    return { name: lbl(e), end: e, val, up: prev == null || val == null ? null : val >= prev };
  });
  const revScale = scaleFor(Math.max(0, ...revData.map((d) => Math.abs(d.val ?? 0))));

  const costData = chartEnds.map((e) => ({
    name: lbl(e),
    cor: v('costOfRevenue', e)?.val,
    rnd: v('rnd', e)?.val,
    sga: v('sga', e)?.val,
  }));
  const costScale = scaleFor(Math.max(0, ...costData.map((d) => (d.cor ?? 0) + (d.rnd ?? 0) + (d.sga ?? 0))));

  const marginData = chartEnds.map((e) => ({
    name: lbl(e),
    gross: margin('grossProfit', e),
    operating: margin('operatingIncome', e),
    net: margin('netIncome', e),
  }));

  const flowData = chartEnds.map((e) => {
    const g = (k: MetricKey) => v(k, e)?.val;
    const ret = (g('buybacks') ?? 0) + (g('dividends') ?? 0);
    return {
      name: lbl(e),
      ocf: g('ocf'),
      capex: g('capex') != null ? -g('capex')! : undefined,
      returns: g('buybacks') != null || g('dividends') != null ? -ret : undefined,
      fcf: g('fcf'),
    };
  });
  const flowScale = scaleFor(
    Math.max(0, ...flowData.flatMap((d) => [d.ocf, d.capex, d.returns, d.fcf].map((x) => Math.abs(x ?? 0))))
  );
  const sc = (x: number | undefined, s: { div: number }) => (x == null ? null : +(x / s.div).toFixed(2));

  const { insights, watch } = useMemo(() => {
    const base = analyze(fin, mode, end, note);
    // When TTM / annual windows are unavailable (first 10-Q), add year-to-date signals from the filed 6M/9M totals.
    if (!ytdW || windowVal(fin, 'revenue', mode, end) != null) return base;
    const y = analyzeYtd(fin, ytdW);
    return { insights: [...y.insights, ...base.insights], watch: [...new Set([...y.watch, ...base.watch])] };
  }, [fin, mode, end, note, ytdW]);

  /* relationship-derived capital flows */
  const relOut = relationships.filter(
    (r) => r.source === company.id && ['investment', 'ownership', 'cloud_capacity'].includes(r.type)
  );
  const relIn = relationships.filter(
    (r) => r.target === company.id && ['investment', 'ownership', 'cloud_capacity'].includes(r.type)
  );
  const oiIn = outsideInvestors.filter((o) => o.targetCompanyId === company.id);
  const oiOut = outsideInvestors.filter((o) => company.ticker && o.investorTicker === company.ticker);
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name || id;

  /* rule-based flow commentary */
  const flowNotes: string[] = [];
  if (fin && end) {
    const W = windowName(mode);
    const wv = (k: MetricKey) => windowVal(fin, k, mode, end);
    const r = wv('revenue');
    const cx = wv('capex');
    const f = wv('fcf');
    const n = wv('netIncome');
    const acq = wv('acquisitions');
    const ip = wv('investPurchases');
    const ipr = wv('investProceeds');
    const b = wv('buybacks');
    const d = wv('dividends');
    if (cx != null && r) flowNotes.push(`Capex intensity: ${((cx / r) * 100).toFixed(1)}% of revenue over the ${W} (${fmtMoney(cx, cur)}).`);
    if (f != null && n != null && n > 0) flowNotes.push(`FCF conversion: free cash flow is ${((f / n) * 100).toFixed(0)}% of net income.`);
    if (acq != null && acq > 0) flowNotes.push(`Acquisitions: ${fmtMoney(acq, cur)} spent on businesses (net of cash acquired).`);
    if (ip != null && ipr != null) {
      const net = ip - ipr;
      flowNotes.push(
        `Securities: purchases ${fmtMoney(ip, cur)} vs sales/maturities ${fmtMoney(ipr, cur)} → net ${net >= 0 ? 'deployed into' : 'pulled from'} investments ${fmtMoney(Math.abs(net), cur)}.`
      );
    }
    if ((b || d) && f != null && f > 0) flowNotes.push(`Shareholder returns (buybacks + dividends) = ${((((b || 0) + (d || 0)) / f) * 100).toFixed(0)}% of FCF.`);
    if (mode === 'quarterly' && cx == null && r == null && !ytdW) flowNotes.push('TTM windows need four consecutive quarters; switch to Annual for longer history.');
  }
  if (fin && ytdW && !flowNotes.some((t) => t.startsWith('Capex intensity'))) {
    const yv = (k: MetricKey) => ytdVal(fin, k, ytdW.start, ytdW.end);
    const W = `${ytdW.months} months to ${ytdW.end}`;
    const r = yv('revenue');
    const cx = yv('capex');
    const o = yv('ocf');
    const f = yv('fcf');
    const ip = yv('investPurchases');
    const b = yv('buybacks');
    const di = yv('debtIssued');
    const dr = yv('debtRepaid');
    if (cx != null && r) flowNotes.push(`Capex intensity: ${((cx / r) * 100).toFixed(0)}% of revenue over the ${W} (${fmtMoney(cx, cur)} capex vs ${fmtMoney(r, cur)} revenue).`);
    if (o != null && f != null) flowNotes.push(`Operating cash flow ${fmtMoney(o, cur)} − capex → free cash flow ${fmtMoney(f, cur)} over the ${W}.`);
    if (ip != null) flowNotes.push(`Securities: ${fmtMoney(ip, cur)} of marketable securities bought over the ${W} (sales/maturities not tagged).`);
    if (di != null || dr != null) flowNotes.push(`Debt: ${fmtMoney(di, cur)} issued vs ${fmtMoney(dr, cur)} repaid over the ${W}.`);
    if (b != null) flowNotes.push(`Equity repurchases: ${fmtMoney(b, cur)} over the ${W}.`);
    flowNotes.push('Cash-flow figures are year-to-date totals as filed; single-quarter cash flows are not reported in a first 10-Q.');
  }

  const pos = insights.filter((i) => i.tone === 'pos');
  const neg = insights.filter((i) => i.tone === 'neg');
  const neu = insights.filter((i) => i.tone === 'neutral');

  const snapshotDate = snapshot?.generatedAt
    ? new Date(snapshot.generatedAt).toLocaleString('en-US', {
        timeZoneName: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const tooltipStyle = { background: '#0d1528', border: '1px solid #2a3f66', fontSize: 12 };
  const chartH = isMobile ? 170 : 190;
  const tickStyle = { fill: MUTED, fontSize: isMobile ? 10 : 11 };
  const moneyTip = (s: { unit: string }) => (val: unknown) => {
    const n = Number(val);
    return Number.isFinite(n) ? `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}${s.unit} ${cur || ''}` : 'N/A';
  };

  const insightItem = (i: Insight, k: number) => (
    <li key={k} className={`fin-insight tone-${i.tone}`}>
      <div className="fin-insight-title">
        {i.title}
        <span className={`fin-basis ${i.basis === 'SEC' ? 'is-sec' : ''}`}>{i.basis === 'SEC' ? 'SEC data' : 'curated'}</span>
      </div>
      <div className="fin-insight-detail">{i.detail}</div>
    </li>
  );

  return (
    <div className={`fin-layout ${isMobile ? 'is-mobile' : ''}`}>
      {/* ---------- Controls ---------- */}
      <div className="panel fin-controls">
        <div className="fin-controls-row">
          <label className="fin-picker">
            <span className="tiny muted">Company</span>
            <select value={company.id} onChange={(e) => setCompanyId(e.target.value)} aria-label="Select company">
              <optgroup label="SEC XBRL filers — AI infrastructure">
                {grouped.sec.map((c) => (
                  <option key={c.id} value={c.id}>
                    {displayCode(c)} — {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="SEC XBRL filers — Energy">
                {grouped.secEnergy.map((c) => (
                  <option key={c.id} value={c.id}>
                    {displayCode(c)} — {c.name}
                  </option>
                ))}
              </optgroup>
              {grouped.added.length > 0 && (
                <optgroup label="Added by you (pending full integration)">
                  {grouped.added.map((c) => (
                    <option key={c.id} value={c.id}>
                      {displayCode(c)} — {c.name} · added by you
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Listed outside SEC (N/A)">
                {grouped.nonSec.map((c) => (
                  <option key={c.id} value={c.id}>
                    {displayCode(c)} — {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Private (N/A)">
                {grouped.priv.map((c) => (
                  <option key={c.id} value={c.id}>
                    {displayCode(c)} — {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="fin-seg" role="tablist" aria-label="Period">
            {(['quarterly', 'annual'] as PeriodMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`fin-seg-btn ${mode === m ? 'on' : ''}`}
                onClick={() => setMode(m)}
                disabled={(m === 'quarterly' && noQuarterly) || (m === 'annual' && noAnnual)}
                title={
                  m === 'quarterly' && noQuarterly
                    ? 'No quarterly XBRL facts for this filer'
                    : m === 'annual' && noAnnual
                      ? 'No annual (10-K) XBRL facts yet — first 10-K pending'
                      : undefined
                }
              >
                {m === 'quarterly' ? 'Quarterly' : 'Annual'}
              </button>
            ))}
          </div>
          <div className="fin-source">
            <SourceBadge source={source} />
            {hasCik && (
              <button
                type="button"
                className="chip"
                onClick={() => void refreshLive(true)}
                disabled={liveState[company.id] === 'loading'}
                title="Pull the latest XBRL company facts from data.sec.gov via the local proxy"
              >
                {liveState[company.id] === 'loading' ? 'Pulling SEC…' : '↻ SEC live'}
              </button>
            )}
            {!isMobile && (
              <label className="fin-auto tiny muted">
                <input type="checkbox" checked={autoLive} onChange={(e) => setAutoLive(e.target.checked)} /> auto-live
              </label>
            )}
          </div>
        </div>

        {ends.length > 0 && (
          <div className="fin-period-chips" role="listbox" aria-label="Focus period">
            {[...ends].reverse().map((e) => (
              <button
                key={e}
                type="button"
                className={`chip fin-period-chip ${e === end ? 'on' : ''}`}
                onClick={() => setFocusEnd(e)}
                aria-selected={e === end}
                title={`Period ending ${e}`}
              >
                {lbl(e)}
              </button>
            ))}
          </div>
        )}

        <div className="fin-meta tiny muted">
          {fin ? (
            <>
              <span>
                {fin.entityName} · CIK {fin.cik} · {fin.taxonomy} · {cur}
              </span>
              {end && <span> · period ending {end}</span>}
              <span>
                {' '}
                · {source === 'live' ? `live pull ${new Date(fin.fetchedAt || '').toLocaleTimeString('en-US', { timeZoneName: 'short', hour: '2-digit', minute: '2-digit' })}` : snapshotDate ? `snapshot ${snapshotDate}` : 'snapshot'}
              </span>
              {liveState[company.id] === 'error' && (
                <span className="down"> · live SEC pull failed — showing {userFin ? 'figures saved when added' : 'snapshot'}</span>
              )}
              {liveState[company.id] === 'loading' && <span> · checking SEC for newer filings…</span>}
            </>
          ) : snapshot === undefined && hasCik ? (
            <span>Loading SEC snapshot…</span>
          ) : (
            <span>{note.naReason || 'No SEC XBRL data available for this company.'}</span>
          )}
          {note.filingNote && <div className="fin-filing-note">ⓘ {note.filingNote}</div>}
          {noQuarterly && modePref === 'quarterly' && (
            <div className="fin-filing-note">ⓘ No quarterly XBRL facts for this filer — showing Annual.</div>
          )}
          {noAnnual && (
            <div className="fin-filing-note">ⓘ No annual 10-K XBRL facts yet — Annual view unavailable; quarterly figures shown.</div>
          )}
        </div>
        {isMobile && (
          <div className="fin-expand-row">
            <button type="button" className="chip" onClick={() => expandAll(true)}>
              Expand all
            </button>
            <button type="button" className="chip" onClick={() => expandAll(false)}>
              Collapse all
            </button>
          </div>
        )}
      </div>


      {company.userAdded && userEntry && (
        <div className="panel fin-user-panel">
          <div className="fin-user-head">
            <span className="pending-tag is-strong">Added by you — pending full integration</span>
            <GrokLinkIndicator configured={user?.configured ?? null} storage={user?.storage} />
          </div>
          <p className="panel-note">
            Pulled straight from SEC EDGAR when you added it on{' '}
            {new Date(userEntry.addedAt).toLocaleString('en-US', { timeZoneName: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {userEntry.formalForms?.length ? <> · formal filings on EDGAR: {userEntry.formalForms.join(', ')}</> : null}. Network links, curated
            revenue notes and market data arrive once Grok Bot builds it into the terminal. Missing items stay N/A.
          </p>
          <div className="fin-user-actions">
            <RequestStatusChip req={user?.requestFor(userEntry.cik)} onRetry={() => void user?.retry(userEntry.cik)} />
            <button
              type="button"
              className="chip fin-user-remove"
              onClick={() => {
                void user?.remove(userEntry.cik);
                setCompanyId('nvidia');
              }}
            >
              Remove from terminal
            </button>
          </div>
          {userEntry.local && (
            <p className="tiny muted">Saved in this browser only — the local server was unreachable when you added it.</p>
          )}
        </div>
      )}

      {!fin && snapshot !== undefined && (
        <div className="panel fin-na-panel">
          <h3>SEC financials N/A — {company.name}</h3>
          <p>{note.naReason || 'No SEC XBRL company facts available.'}</p>
          <p className="panel-note">{company.summary}</p>
          <p className="panel-note">
            All revenue, cost, profit and cash-flow figures below are shown as N/A rather than estimated. Strategic links from the network data are still listed in
            section 4.
          </p>
        </div>
      )}

      {/* ---------- AI products & services ---------- */}
      {(() => {
        const ai = company.userAdded ? undefined : aiProfileFor(company.id);
        if (!ai)
          return (
            <div className="panel ai-profile-panel">
              <div className="ai-profile-head">
                <h3>AI products & services</h3>
                <span className="ai-exp-tag none">AI exposure: not assessed</span>
              </div>
              <p className="muted">
                No curated description yet for {company.name}. Any SEC figures below are for the company as a whole.
              </p>
            </div>
          );
        return (
          <div className="panel ai-profile-panel">
            <div className="ai-profile-head">
              <h3>AI products & services</h3>
              <span className={`ai-exp-tag ${ai.exposure}`} title={AI_EXPOSURE_HELP[ai.exposure]}>
                AI exposure: {AI_EXPOSURE_LABELS[ai.exposure]}
              </span>
            </div>
            <p>{ai.offering}</p>
            {ai.wholeCompany ? (
              <div className="whole-co-notice" role="note">
                <strong>⚠ Whole-company figures.</strong> The revenue, costs, profit and cash flows on this page are reported for {company.name} as a
                whole — not just its AI-related business.
                {ai.aiSegment && (
                  <>
                    {' '}
                    Most AI-relevant reporting line: <strong>{ai.aiSegment}</strong>
                    {/no segment data|No AI/i.test(ai.aiSegment) ? '.' : ' (named only — segment figures are not in this SEC snapshot).'}
                  </>
                )}
              </div>
            ) : (
              <div className="pure-notice" role="note">
                <strong>{ai.exposure === 'pure' ? 'AI pure-play / AI-dominant.' : 'AI is core to this business plan.'}</strong> {ai.note}
                {ai.aiSegment && <> Most AI-relevant reporting line: <strong>{ai.aiSegment}</strong> (named only — segment figures are not in this SEC snapshot).</>}
              </div>
            )}
            {ai.wholeCompany && ai.note && <p className="tiny muted">{ai.note}</p>}
          </div>
        );
      })()}

      {/* ---------- KPI strip ---------- */}
      <div className="fin-kpis">
        {(
          [
            ['revenue', 'Revenue'],
            ['grossProfit', 'Gross profit'],
            ['operatingIncome', 'Operating income'],
            ['netIncome', 'Net income'],
            ['fcf', 'Free cash flow'],
          ] as [MetricKey, string][]
        ).map(([k, label]) => {
          const p = v(k);
          const yoy = ye ? delta(p?.val, v(k, ye)?.val) : null;
          const qoq = mode === 'quarterly' && pe ? delta(p?.val, v(k, pe)?.val) : null;
          return (
            <div className="fin-kpi" key={k}>
              <div className="fin-kpi-label">
                {label}
                <GlossInfo id={METRIC_GLOSSARY[k]} /> {p && <SourceBadge source={source} small />}
              </div>
              <div className={`fin-kpi-val mono ${p && p.val < 0 ? 'down' : ''}`}>{p ? fmtMoney(p.val, cur) : 'N/A'}</div>
              {!p && ytdW && fin && ytdVal(fin, k, ytdW.start, ytdW.end) != null && (
                <div className={`tiny mono ${ytdVal(fin, k, ytdW.start, ytdW.end)! < 0 ? 'down' : 'up'}`} title="Year-to-date total as filed in the 10-Q (single quarter not reported)">
                  {ytdW.months}M YTD: {fmtMoney(ytdVal(fin, k, ytdW.start, ytdW.end), cur)}
                </div>
              )}
              <div className="fin-kpi-deltas">
                {mode === 'quarterly' && <DeltaChip label="QoQ" d={qoq} currency={cur} />}
                <DeltaChip label="YoY" d={yoy} currency={cur} />
              </div>
              <div className="fin-kpi-foot">
                <FilingLink fin={fin} p={p} />
                <DerivedTag p={p} />
              </div>
            </div>
          );
        })}
      </div>

      {(FILING_PROFILES[company.id] || filingsSnap) && (
        <FilingHistory
          companyId={company.id}
          companyName={company.name}
          snapFilings={filingsSnap}
          isMobile={isMobile}
        />
      )}

      <div className="fin-grid">
        {/* ---------- Revenue ---------- */}
        <Section id="revenue" title="1 · Revenue" badge={<SourceBadge source={source} small />} isMobile={isMobile} open={open.revenue!} onToggle={toggle}>
          <div className="fin-headline">
            <div>
              <div className="tiny muted">Total revenue · {end ? lbl(end) : '—'}</div>
              <div className="fin-big mono">{rev ? fmtMoney(rev.val, cur) : 'N/A'}</div>
            </div>
            <div className="fin-kpi-deltas">
              {mode === 'quarterly' && <DeltaChip label="QoQ" d={revQ} currency={cur} />}
              <DeltaChip label="YoY" d={revY} currency={cur} />
            </div>
          </div>
          <div className="fin-split">
            {(['revenueProducts', 'revenueServices'] as MetricKey[]).map((k) => {
              const p = v(k);
              return (
                <div className="fin-split-cell" key={k}>
                  <span className="tiny muted">{k === 'revenueProducts' ? 'Products' : 'Services'}</span>
                  <span className="mono">{p ? fmtMoney(p.val, cur) : 'N/A'}</span>
                  {p && rev ? <span className="tiny muted">{((p.val / rev.val) * 100).toFixed(0)}% of total</span> : null}
                </div>
              );
            })}
          </div>
          <p className="panel-note">
            {note.productService ||
              'Product vs service splits are reported with XBRL dimensions (ProductOrServiceAxis), which SEC companyfacts does not include — shown as N/A rather than estimated.'}
          </p>
          {revData.some((d) => d.val != null) && (
            <div className="fin-chart" style={{ height: chartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revData.map((d) => ({ ...d, v: sc(d.val, revScale) }))} margin={{ top: 6, right: isMobile ? 18 : 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#1e2d4a" vertical={false} />
                  <XAxis dataKey="name" tick={tickStyle} interval={isMobile ? 'preserveStartEnd' : 0} />
                  <YAxis tick={tickStyle} unit={revScale.unit} width={52} />
                  <Tooltip contentStyle={tooltipStyle} formatter={moneyTip(revScale)} cursor={{ fill: 'rgba(255,179,0,0.06)' }} />
                  <Bar isAnimationActive={false} dataKey="v" name="Revenue" radius={[3, 3, 0, 0]}>
                    {revData.map((d) => (
                      <Cell key={d.end} fill={d.up == null ? CYAN : d.up ? GREEN : RED} fillOpacity={d.end === end ? 1 : 0.6} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {note.revenueDrivers.length > 0 && (
            <>
              <h4>
                Major revenue drivers <SourceBadge source="illustrative" small />
              </h4>
              <ul className="fin-bullets">
                {note.revenueDrivers.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {/* ---------- Costs ---------- */}
        <Section id="costs" title="2 · Costs" badge={<SourceBadge source={source} small />} isMobile={isMobile} open={open.costs!} onToggle={toggle}>
          <p className="panel-note fin-legend-note">Cost colours show profit impact: rising costs = red, falling = green.</p>
          <MetricRows
            rows={[
              { key: 'costOfRevenue', invert: true, ofRevenue: true },
              { key: 'rnd', invert: true, ofRevenue: true },
              { key: 'sga', invert: true, ofRevenue: true },
              { key: 'opex', invert: true, ofRevenue: true },
              { key: 'sbc', invert: true, ofRevenue: true, label: 'Stock-based comp (non-cash)' },
            ]}
            fin={fin}
            mode={mode}
            end={end}
            ends={ends}
            isMobile={isMobile}
          />
          {costData.some((d) => d.cor != null || d.rnd != null || d.sga != null) && (
            <div className="fin-chart" style={{ height: chartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={costData.map((d) => ({ name: d.name, cor: sc(d.cor, costScale), rnd: sc(d.rnd, costScale), sga: sc(d.sga, costScale) }))}
                  margin={{ top: 6, right: isMobile ? 18 : 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid stroke="#1e2d4a" vertical={false} />
                  <XAxis dataKey="name" tick={tickStyle} interval={isMobile ? 'preserveStartEnd' : 0} />
                  <YAxis tick={tickStyle} unit={costScale.unit} width={52} />
                  <Tooltip contentStyle={tooltipStyle} formatter={moneyTip(costScale)} cursor={{ fill: 'rgba(255,179,0,0.06)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar isAnimationActive={false} dataKey="cor" stackId="c" name="Cost of revenue" fill="#5c6bc0" />
                  <Bar isAnimationActive={false} dataKey="rnd" stackId="c" name="R&D" fill="#ab47bc" />
                  <Bar isAnimationActive={false} dataKey="sga" stackId="c" name="SG&A" fill="#26a69a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {note.costDrivers.length > 0 && (
            <>
              <h4>
                Major cost sources <SourceBadge source="illustrative" small />
              </h4>
              <ul className="fin-bullets">
                {note.costDrivers.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {/* ---------- Profit ---------- */}
        <Section id="profit" title="3 · Profit" badge={<SourceBadge source={source} small />} isMobile={isMobile} open={open.profit!} onToggle={toggle}>
          <div className="fin-margin-grid">
            {(
              [
                ['grossProfit', 'Gross'],
                ['operatingIncome', 'Operating'],
                ['netIncome', 'Net'],
              ] as [MetricKey, string][]
            ).map(([k, label]) => {
              const m = margin(k);
              const mq = mode === 'quarterly' && pe ? margin(k, pe) : undefined;
              const my = ye ? margin(k, ye) : undefined;
              const dq = m != null && mq != null ? m - mq : null;
              const dy = m != null && my != null ? m - my : null;
              return (
                <div className="fin-margin" key={k}>
                  <div className="tiny muted">
                    {label} margin
                    <GlossInfo id={k === 'grossProfit' ? 'gross-margin' : k === 'operatingIncome' ? 'operating-margin' : 'net-income'} />
                  </div>
                  <div className={`fin-big mono ${m != null && m < 0 ? 'down' : ''}`}>{m != null ? `${m.toFixed(1)}%` : 'N/A'}</div>
                  <div className="fin-kpi-deltas">
                    {mode === 'quarterly' && (
                      <span className={`delta-chip tone-${dq == null || Math.abs(dq) < 0.05 ? 'neutral' : dq > 0 ? 'good' : 'bad'}`}>
                        <span className="delta-label">QoQ</span>
                        {fmtPp(dq)}
                      </span>
                    )}
                    <span className={`delta-chip tone-${dy == null || Math.abs(dy) < 0.05 ? 'neutral' : dy > 0 ? 'good' : 'bad'}`}>
                      <span className="delta-label">YoY</span>
                      {fmtPp(dy)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <MetricRows
            rows={[{ key: 'grossProfit' }, { key: 'operatingIncome' }, { key: 'netIncome' }]}
            fin={fin}
            mode={mode}
            end={end}
            ends={ends}
            isMobile={isMobile}
          />
          {marginData.some((d) => d.gross != null || d.operating != null || d.net != null) && (
            <div className="fin-chart" style={{ height: chartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={marginData} margin={{ top: 6, right: isMobile ? 18 : 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#1e2d4a" vertical={false} />
                  <XAxis dataKey="name" tick={tickStyle} interval={isMobile ? 'preserveStartEnd' : 0} />
                  <YAxis tick={tickStyle} unit="%" width={44} />
                  <ReferenceLine y={0} stroke="#2a3f66" />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: unknown) => (Number.isFinite(Number(val)) ? `${Number(val).toFixed(1)}%` : 'N/A')}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="gross" name="Gross" stroke={CYAN} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  <Line isAnimationActive={false} type="monotone" dataKey="operating" name="Operating" stroke={AMBER} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  <Line isAnimationActive={false} type="monotone" dataKey="net" name="Net" stroke={GREEN} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <MarginExplainer fin={fin} mode={mode} end={end} ye={ye} note={note.marginNote} />
        </Section>

        {/* ---------- Investment flows ---------- */}
        <Section
          id="flows"
          title="4 · Investment flows in & out"
          badge={<SourceBadge source={source} small />}
          isMobile={isMobile}
          open={open.flows!}
          onToggle={toggle}
          className="fin-wide"
        >
          {ytdW && fin && <YtdFlows fin={fin} w={ytdW} />}
          <MetricRows
            rows={(
              [
                { key: 'ocf' },
                { key: 'capex', neutral: true },
                { key: 'fcf' },
                { key: 'acquisitions', neutral: true },
                { key: 'investPurchases', neutral: true },
                { key: 'investProceeds', neutral: true },
                { key: 'buybacks', neutral: true },
                { key: 'dividends', neutral: true },
                { key: 'debtIssued', neutral: true },
                { key: 'debtRepaid', neutral: true },
                { key: 'dilutedShares', invert: true },
              ] as RowDef[]
            ).filter((r) => !ytdW || r.key === 'dilutedShares' || (fin?.metrics?.[r.key]?.[mode]?.length ?? 0) > 0)}
            fin={fin}
            mode={mode}
            end={end}
            ends={ends}
            isMobile={isMobile}
            showTtm
          />
          <p className="panel-note fin-legend-note">
            Capital-allocation lines (capex, M&A, buybacks, debt) are shown with neutral colours — direction is a strategic choice, not good/bad on its own. Quarterly cash-flow values are often derived from YTD filings (tagged “YTD-diff”).
          </p>
          {flowData.some((d) => d.ocf != null || d.capex != null) && (
            <div className="fin-chart" style={{ height: chartH + 30 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={flowData.map((d) => ({
                    name: d.name,
                    ocf: sc(d.ocf, flowScale),
                    capex: sc(d.capex, flowScale),
                    returns: sc(d.returns, flowScale),
                    fcf: sc(d.fcf, flowScale),
                  }))}
                  margin={{ top: 6, right: isMobile ? 18 : 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid stroke="#1e2d4a" vertical={false} />
                  <XAxis dataKey="name" tick={tickStyle} interval={isMobile ? 'preserveStartEnd' : 0} />
                  <YAxis tick={tickStyle} unit={flowScale.unit} width={52} />
                  <ReferenceLine y={0} stroke="#2a3f66" />
                  <Tooltip contentStyle={tooltipStyle} formatter={moneyTip(flowScale)} cursor={{ fill: 'rgba(255,179,0,0.06)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar isAnimationActive={false} dataKey="ocf" name="Operating cash in" fill={GREEN} fillOpacity={0.75} />
                  <Bar isAnimationActive={false} dataKey="capex" name="Capex out" fill={RED} fillOpacity={0.75} />
                  <Bar isAnimationActive={false} dataKey="returns" name="Buybacks + dividends out" fill={AMBER} fillOpacity={0.7} />
                  <Line isAnimationActive={false} type="monotone" dataKey="fcf" name="Free cash flow" stroke={CYAN} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {!isMobile && fin && <FlowHistory fin={fin} mode={mode} ends={chartEnds} lbl={lbl} />}
          <div className="fin-two-col">
            <div>
              <h4>
                Where the cash goes — from the filings <SourceBadge source={fin ? source : 'illustrative'} small />
              </h4>
              {flowNotes.length ? (
                <ul className="fin-bullets">
                  {flowNotes.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              ) : (
                <p className="panel-note">N/A — no SEC cash-flow data for this company.</p>
              )}
              {note.investment.length > 0 && (
                <>
                  <h4>
                    Why — strategy & business support <SourceBadge source="illustrative" small />
                  </h4>
                  <ul className="fin-bullets">
                    {note.investment.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div>
              <h4>
                Strategic capital links (network data) <SourceBadge source="illustrative" small />
              </h4>
              {relOut.length + relIn.length + oiIn.length + oiOut.length === 0 && (
                <p className="panel-note">No investment / ownership / capacity links mapped for this company.</p>
              )}
              <ul className="fin-links">
                {relOut.map((r) => (
                  <li key={r.id}>
                    <span className="fin-dir out">OUT →</span> <b>{nameOf(r.target)}</b> · {r.label}
                    <div className="tiny muted">{r.detail}</div>
                  </li>
                ))}
                {relIn.map((r) => (
                  <li key={r.id}>
                    <span className="fin-dir in">IN ←</span> <b>{nameOf(r.source)}</b> · {r.label}
                    <div className="tiny muted">{r.detail}</div>
                  </li>
                ))}
                {oiIn.map((o) => (
                  <li key={o.id}>
                    <span className="fin-dir in">IN ←</span> <b>{o.investor}</b> · {o.targetInfra}
                    <div className="tiny muted">
                      {fmtUsdM(o.amountUsdM)} curated est. ({o.year}) — {o.amountNote}
                    </div>
                  </li>
                ))}
                {oiOut.map((o) => (
                  <li key={o.id}>
                    <span className="fin-dir out">OUT →</span> <b>{o.targetInfra}</b>
                    <div className="tiny muted">
                      {fmtUsdM(o.amountUsdM)} curated est. ({o.year}) — {o.amountNote}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* ---------- Retail investor impact ---------- */}
        <Section
          id="retail"
          title="5 · Retail investor impact"
          badge={<span className="fin-mini-tag">rule-based</span>}
          isMobile={isMobile}
          open={open.retail!}
          onToggle={toggle}
          className="fin-wide"
        >
          <p className="panel-note">
            Signals computed from{' '}
            {fin
              ? ytdW && windowVal(fin, 'revenue', mode, end) == null
                ? `SEC figures (${ytdW.months} months to ${ytdW.end} year-to-date vs a year earlier, plus the latest quarter)`
                : `SEC figures (${windowName(mode)} ending ${end ? lbl(end) : 'N/A'} vs a year earlier)`
              : 'curated notes only (no SEC data)'}{' '}
            plus curated
            structural notes. No price targets or forecasts.
          </p>
          <div className="fin-retail-grid">
            <div className="fin-retail-col pos">
              <h4 className="up">▲ Potential positives ({pos.length})</h4>
              <ul className="fin-insights">{pos.map(insightItem)}</ul>
              {!pos.length && <p className="panel-note">None flagged.</p>}
            </div>
            <div className="fin-retail-col neg">
              <h4 className="down">▼ Potential negatives ({neg.length})</h4>
              <ul className="fin-insights">{neg.map(insightItem)}</ul>
              {!neg.length && <p className="panel-note">None flagged.</p>}
            </div>
          </div>
          {neu.length > 0 && (
            <>
              <h4>Neutral / context</h4>
              <ul className="fin-insights">{neu.map(insightItem)}</ul>
            </>
          )}
          {watch.length > 0 && (
            <>
              <h4>What to watch</h4>
              <ol className="fin-watch">
                {watch.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ol>
            </>
          )}
          <div className="fin-disclaimer">
            <b>Not investment advice.</b> This dashboard is an educational prototype. Figures come from SEC XBRL filings as tagged by the company (and may be
            restated, derived from year-to-date values, or missing); narratives are curated summaries. Verify against the original filings and consult a licensed
            financial adviser before making investment decisions.
          </div>
        </Section>
      </div>
    </div>
  );
}

function MarginExplainer({
  fin,
  mode,
  end,
  ye,
  note,
}: {
  fin: CompanyFin | null;
  mode: PeriodMode;
  end?: string;
  ye?: string;
  note: string;
}) {
  let auto = '';
  if (fin && end && ye) {
    const g = (k: MetricKey, e: string) => pointAt(fin, k, mode, e)?.val;
    const r0 = g('revenue', ye);
    const r1 = g('revenue', end);
    const o0 = g('opex', ye);
    const o1 = g('opex', end);
    const c0 = g('costOfRevenue', ye);
    const c1 = g('costOfRevenue', end);
    const oi0 = g('operatingIncome', ye);
    const oi1 = g('operatingIncome', end);
    if (r0 && r1 && oi0 != null && oi1 != null) {
      const rg = ((r1 - r0) / Math.abs(r0)) * 100;
      const m0 = (oi0 / r0) * 100;
      const m1 = (oi1 / r1) * 100;
      const dir = m1 - m0 >= 0.05 ? 'expanded' : m1 - m0 <= -0.05 ? 'compressed' : 'held flat';
      const parts = [`Operating margin ${dir} ${fmtPp(m1 - m0)} YoY as revenue moved ${fmtDeltaPct(rg)}`];
      if (c0 && c1) parts.push(`cost of revenue ${fmtDeltaPct(((c1 - c0) / Math.abs(c0)) * 100)}`);
      if (o0 && o1) parts.push(`operating expenses ${fmtDeltaPct(((o1 - o0) / Math.abs(o0)) * 100)}`);
      auto = parts.join(', ') + '.';
      if (m1 > m0 && o0 && o1 && (o1 - o0) / Math.abs(o0) < (r1 - r0) / Math.abs(r0)) auto += ' Costs grew slower than revenue (operating leverage).';
      if (m1 < m0 && o0 && o1 && (o1 - o0) / Math.abs(o0) > (r1 - r0) / Math.abs(r0)) auto += ' Costs outpaced revenue (negative operating leverage).';
    }
  }
  if (!auto && !note) return null;
  return (
    <div className="fin-explainer">
      <h4>
        Margin expansion / compression <GlossInfo id="margin-change" />
      </h4>
      {auto && <p className="fin-explainer-auto">{auto}</p>}
      {note && (
        <p className="panel-note">
          <SourceBadge source="illustrative" small /> {note}
        </p>
      )}
    </div>
  );
}

function FlowHistory({
  fin,
  mode,
  ends,
  lbl,
}: {
  fin: CompanyFin;
  mode: PeriodMode;
  ends: string[];
  lbl: (e: string) => string;
}) {
  const keys: MetricKey[] = ['ocf', 'capex', 'fcf', 'acquisitions', 'buybacks', 'dividends', 'debtIssued', 'debtRepaid'];
  const cols = ends.slice(-6);
  if (!cols.length) return null;
  return (
    <details className="fin-history">
      <summary>{mode === 'quarterly' ? 'Quarterly' : 'Annual'} history table</summary>
      <div className="table-scroll">
        <table className="data-table compact fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              {cols.map((e) => (
                <th key={e} className="num">
                  {lbl(e)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td>{METRIC_LABELS[k]}</td>
                {cols.map((e) => {
                  const p = pointAt(fin, k, mode, e);
                  return (
                    <td key={e} className={`num mono ${k === 'fcf' && p ? (p.val >= 0 ? 'up' : 'down') : ''}`} title={p ? `${p.form} · ${p.tag}` : 'N/A'}>
                      {p ? fmtMoney(p.val, fin.currency) : 'N/A'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Year-to-date cash flows (first 10-Q: cash flows are 6M/9M totals)   */
/* ------------------------------------------------------------------ */

function YtdFlows({ fin, w }: { fin: CompanyFin; w: YtdWindow }) {
  const keys: { k: MetricKey; neutral?: boolean }[] = [
    { k: 'revenue' },
    { k: 'ocf' },
    { k: 'capex', neutral: true },
    { k: 'fcf' },
    { k: 'acquisitions', neutral: true },
    { k: 'investPurchases', neutral: true },
    { k: 'investProceeds', neutral: true },
    { k: 'buybacks', neutral: true },
    { k: 'dividends', neutral: true },
    { k: 'debtIssued', neutral: true },
    { k: 'debtRepaid', neutral: true },
  ];
  const cur = fin.currency;
  const label = (end?: string) => (end ? `${w.months}M to ${shortDate(end)}` : '—');
  return (
    <div className="fin-ytd">
      <h4>
        Year-to-date cash flows — as filed <span className="fin-mini-tag">10-Q · YTD</span>
      </h4>
      <p className="panel-note">
        This filer’s cash-flow statement is only reported on a {w.months}-month year-to-date basis so far (no prior 10-Q to subtract), so single-quarter cash
        flows are N/A. The table compares the filed YTD totals with the same period a year earlier.
      </p>
      <div className="table-scroll">
        <table className="data-table compact fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">{label(w.end)}</th>
              <th className="num">{label(w.priorEnd)}</th>
              <th className="num">YoY</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(({ k, neutral }) => {
              const a = ytdVal(fin, k, w.start, w.end);
              const b = ytdVal(fin, k, w.priorStart, w.priorEnd);
              const d = delta(a, b);
              const cls = neutral || d?.pct == null ? '' : d.abs >= 0 ? 'up' : 'down';
              return (
                <tr key={k}>
                  <td>{METRIC_LABELS[k]}</td>
                  <td className={`num mono ${k === 'fcf' && a != null ? (a >= 0 ? 'up' : 'down') : ''}`}>{a != null ? fmtMoney(a, cur) : 'N/A'}</td>
                  <td className="num mono">{b != null ? fmtMoney(b, cur) : 'N/A'}</td>
                  <td className={`num mono ${cls}`}>{d?.pct != null ? fmtDeltaPct(d.pct) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SEC filing history (snapshot submissions feed + curated milestones) */
/* ------------------------------------------------------------------ */

interface SnapFiling {
  form: string;
  filed: string;
  accn: string;
  desc?: string;
  url: string;
}

function FilingHistory({
  companyId,
  companyName,
  snapFilings,
  isMobile,
}: {
  companyId: string;
  companyName: string;
  snapFilings?: { formCounts?: Record<string, number>; recent?: SnapFiling[]; fetchedAt?: string } | null;
  isMobile: boolean;
}) {
  const profile = FILING_PROFILES[companyId];
  if (!profile && !snapFilings?.recent?.length) return null;
  const counts = snapFilings?.formCounts && Object.keys(snapFilings.formCounts).length ? snapFilings.formCounts : profile?.formCounts || {};
  const order = ['10-K', '10-Q', '8-K', '20-F', '6-K', 'S-1', 'S-1/A', 'DRS', '424B4', 'FWP', 'S-8', 'D', 'D/A', 'REGDEX'];
  const countList = Object.entries(counts).sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b[1] - a[1];
  });
  const kindCls: Record<string, string> = { private: 'is-private', ipo: 'is-ipo', periodic: 'is-periodic', event: 'is-event' };
  return (
    <details className="panel fin-filings" open={Boolean(profile) && !isMobile}>
      <summary>
        <b>SEC filing history — {companyName}</b>{' '}
        <span className="tiny muted">
          {profile ? `verified ${profile.asOf}` : snapFilings?.fetchedAt ? `as of ${snapFilings.fetchedAt.slice(0, 10)}` : ''}
        </span>
      </summary>
      {profile && <p className="panel-note">{profile.status}</p>}
      <div className="fin-form-counts">
        {countList.slice(0, isMobile ? 12 : 20).map(([f, n]) => (
          <span key={f} className="chip fin-form-chip">
            <b>{f}</b> ×{n}
          </span>
        ))}
      </div>
      {profile && (
        <ol className="fin-timeline">
          {[...profile.milestones].reverse().map((m) => (
            <li key={m.url} className={kindCls[m.kind]}>
              <span className="mono fin-tl-date">{m.filedAt}</span>
              <a href={m.url} target="_blank" rel="noreferrer" className="fin-tl-form">
                {m.form}
              </a>
              <span className="fin-tl-desc">{m.description}</span>
            </li>
          ))}
        </ol>
      )}
      {!profile && snapFilings?.recent?.length ? (
        <ul className="fin-timeline">
          {snapFilings.recent.slice(0, 8).map((f) => (
            <li key={f.accn} className="is-periodic">
              <span className="mono fin-tl-date">{f.filed}</span>
              <a href={f.url} target="_blank" rel="noreferrer" className="fin-tl-form">
                {f.form}
              </a>
              <span className="fin-tl-desc">{f.desc || ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {profile && (
        <p className="tiny muted">
          Links open the EDGAR filing index.{' '}
          <a href={profile.edgarUrl} target="_blank" rel="noreferrer">
            Full EDGAR filing list ↗
          </a>
        </p>
      )}
    </details>
  );
}
