import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Company } from '../types';
import { SEGMENT_COLORS, SEGMENT_LABELS } from '../data/constants';
import { COMPANY_CIKS } from '../data/secMeta';
import { displayCode } from '../utils/format';
import {
  checkFormalFilings,
  loadSecTickers,
  searchIndexed,
  searchSecRows,
  type FilingCheck,
  type SecTickerRow,
} from '../services/secSearch';
import type { UserCompaniesApi } from '../hooks/useUserCompanies';
import type { GrokRequest } from '../services/userCompanies';

interface Props {
  companies: Company[];
  user: UserCompaniesApi;
  isMobile: boolean;
  onOpenFinancials: (id: string) => void;
  onOpenNetwork: (id: string) => void;
}

const pad = (c: string) => c.replace(/\D/g, '').padStart(10, '0');
const cikOf = (c: Company) => (c.cik || COMPANY_CIKS[c.id] || '').replace(/\D/g, '');
const AUTO_CHECK = 5;

/** "Sent to Grok Bot" / "Queued — webhook not set up" / "Failed — retry" chip for one add request. */
export function RequestStatusChip({ req, onRetry, compact }: { req?: GrokRequest; onRetry?: () => void; compact?: boolean }) {
  if (!req) return <span className="req-chip is-none">Not requested</span>;
  const label =
    req.status === 'sent'
      ? 'Sent to Grok Bot'
      : req.status === 'queued'
        ? req.local
          ? 'Queued — server offline'
          : 'Queued — webhook not set up'
        : `Failed${req.httpStatus ? ` (HTTP ${req.httpStatus})` : req.error === 'timeout' ? ' (timeout)' : ''}`;
  const when = req.lastAttemptAt || req.requestedAt;
  const title = when
    ? `${label} · ${new Date(when).toLocaleString('en-US', { timeZoneName: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : label;
  return (
    <span className="req-chip-wrap">
      <span className={`req-chip is-${req.status}`} title={title}>
        <span className="req-dot" aria-hidden />
        {label}
      </span>
      {req.status !== 'sent' && onRetry && (
        <button type="button" className={`chip req-retry ${compact ? 'is-compact' : ''}`} onClick={onRetry}>
          {req.status === 'failed' ? 'Retry' : 'Retry send'}
        </button>
      )}
    </span>
  );
}

export function GrokLinkIndicator({ configured, storage }: { configured: boolean | null; storage?: 'server' | 'local' }) {
  const state = configured == null ? 'unknown' : configured ? 'on' : 'off';
  const text =
    configured == null
      ? 'Grok Bot link: server unavailable — requests saved in this browser'
      : configured
        ? 'Grok Bot link: configured'
        : 'Grok Bot link: not set up — requests queue locally';
  return (
    <span className={`grok-link is-${state}`} title="Set up via GROKBOT_WEBHOOK_URL in .env or grokbot-webhook.json next to the server (see README)">
      <span className="req-dot" aria-hidden />
      {text}
      {storage === 'local' && configured != null && <span className="muted"> · saved in this browser</span>}
    </span>
  );
}

export function GlobalSearch({ companies, user, isMobile, onOpenFinancials, onOpenNetwork }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SecTickerRow[] | null>(null);
  const [rowsState, setRowsState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [checks, setChecks] = useState<Record<string, FilingCheck | 'loading'>>({});
  const [cikProbe, setCikProbe] = useState<FilingCheck | null>(null);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...companies, ...user.pendingCompanies], [companies, user.pendingCompanies]);
  const indexedCiks = useMemo(() => new Set(all.map(cikOf).filter(Boolean).map(pad)), [all]);

  // Lazy-load the SEC ticker list the first time search opens.
  const ensureRows = useCallback(() => {
    if (rows || rowsState === 'loading') return;
    setRowsState('loading');
    loadSecTickers()
      .then((r) => {
        setRows(r);
        setRowsState('idle');
      })
      .catch(() => setRowsState('error'));
  }, [rows, rowsState]);

  useEffect(() => {
    if (open) ensureRows();
  }, [open, ensureRows]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Desktop: "/" focuses search; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Desktop popover: close on outside click.
  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, isMobile]);

  // Mobile sheet: lock background scroll.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  const indexed = useMemo(() => searchIndexed(all, query, isMobile ? 6 : 6), [all, query, isMobile]);
  const secHits = useMemo(
    () => (rows ? searchSecRows(rows, debounced, indexedCiks, isMobile ? 6 : 7) : []),
    [rows, debounced, indexedCiks, isMobile]
  );

  // A bare CIK that isn't in the ticker files (e.g. no listed ticker): probe EDGAR submissions directly.
  useEffect(() => {
    setCikProbe(null);
    const d = debounced.trim().replace(/^cik\s*/i, '');
    if (!/^\d{4,10}$/.test(d)) return;
    const cik = pad(d);
    if (indexedCiks.has(cik) || secHits.some((h) => h.row.cik === cik)) return;
    let cancelled = false;
    checkFormalFilings(cik).then((c) => {
      if (cancelled) return;
      if (c.status !== 'notfound' && c.status !== 'error') {
        setCikProbe(c);
        setChecks((s) => ({ ...s, [cik]: c }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, indexedCiks, secHits]);

  const runCheck = useCallback((cik: string) => {
    setChecks((s) => (s[cik] && s[cik] !== 'loading' && (s[cik] as FilingCheck).status !== 'error' ? s : { ...s, [cik]: 'loading' }));
    checkFormalFilings(cik).then((c) => setChecks((s) => ({ ...s, [cik]: c })));
  }, []);

  // Auto-verify the top hits (polite: a handful of submissions lookups per settled query, cached per CIK).
  useEffect(() => {
    for (const h of secHits.slice(0, AUTO_CHECK)) if (!checks[h.row.cik]) runCheck(h.row.cik);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secHits]);

  const secList: SecTickerRow[] = useMemo(() => {
    const list = secHits.map((h) => h.row);
    if (cikProbe) list.unshift({ cik: cikProbe.cik, name: cikProbe.name || `CIK ${cikProbe.cik}`, tickers: cikProbe.tickers || [], exchange: cikProbe.exchanges?.[0] });
    return list;
  }, [secHits, cikProbe]);

  useEffect(() => setActive(0), [query]);

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };

  const openCompany = (c: Company, where: 'financials' | 'network') => {
    close();
    setQuery('');
    if (where === 'financials') onOpenFinancials(c.id);
    else onOpenNetwork(c.id);
  };
  const primary = (c: Company) => (c.userAdded || (cikOf(c) && !c.isPrivate) ? 'financials' : 'network');

  const onAdd = async (row: SecTickerRow) => {
    const check = checks[row.cik];
    if (!check || check === 'loading' || check.status !== 'ok') return;
    const id = await user.add({ cik: row.cik, ticker: row.tickers[0] || '', name: check.name || row.name, check });
    if (id) {
      close();
      setQuery('');
      onOpenFinancials(id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, indexed.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      const hit = indexed[active];
      if (hit) openCompany(hit.company, primary(hit.company));
    }
  };

  const q = query.trim();
  const userList = user.companies;

  const panel = (
    <div className="gsearch-panel" role="region" aria-label="Search results">
      <div className="gsearch-status">
        <GrokLinkIndicator configured={user.configured} storage={user.storage} />
      </div>

      {!q && (
        <div className="gsearch-empty">
          <p className="gsearch-hint">
            Type a <b>company name</b>, <b>ticker</b> or <b>CIK</b>. Companies already in the terminal open in Financials or the
            Network graph. Any other SEC filer with a 10-K, 10-Q, 20-F, 40-F, S-1 or F-1 can be added — its real SEC figures load
            right away and Grok Bot gets a request to build it in fully.
          </p>
          {userList.length > 0 && (
            <div className="gsearch-group">
              <div className="gsearch-group-h">
                Added by you <span className="muted">· {userList.length}</span>
              </div>
              {userList.map((u) => {
                const integrated = user.integratedCiks.has(pad(u.cik));
                const id = `user-${pad(u.cik)}`;
                const builtIn = integrated ? companies.find((c) => c.cik && pad(c.cik) === pad(u.cik)) : undefined;
                return (
                  <div className="gsearch-card" key={u.cik}>
                    <div className="gsearch-card-main">
                      <span className="gsearch-code is-user">{(u.ticker || u.name).slice(0, 6).toUpperCase()}</span>
                      <div className="gsearch-card-text">
                        <div className="gsearch-name">{u.name}</div>
                        <div className="gsearch-meta">
                          {u.ticker && <span>{u.ticker}</span>}
                          <span>CIK {u.cik}</span>
                          <span className={integrated ? 'up' : 'pending-tag'}>
                            {integrated ? 'Now built in' : 'Added by you — pending full integration'}
                          </span>
                        </div>
                        <RequestStatusChip req={user.requestFor(u.cik)} onRetry={() => void user.retry(u.cik)} compact />
                      </div>
                    </div>
                    <div className="gsearch-actions">
                      <button
                        type="button"
                        className="gsearch-btn"
                        onClick={() => {
                          close();
                          onOpenFinancials(builtIn ? builtIn.id : id);
                        }}
                      >
                        Financials
                      </button>
                      <button type="button" className="gsearch-btn is-ghost is-danger" onClick={() => void user.remove(u.cik)}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {q && (
        <>
          <div className="gsearch-group">
            <div className="gsearch-group-h">
              In the terminal <span className="muted">· {indexed.length}</span>
            </div>
            {indexed.length === 0 && <div className="gsearch-none">No indexed company matches “{q}”.</div>}
            {indexed.map((h, i) => {
              const c = h.company;
              const hasFin = Boolean(cikOf(c)) && !c.isPrivate;
              return (
                <div
                  key={c.id}
                  className={`gsearch-card is-indexed ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                >
                  <button type="button" className="gsearch-card-main as-button" onClick={() => openCompany(c, primary(c))}>
                    <span
                      className={`gsearch-code ${c.userAdded ? 'is-user' : ''}`}
                      style={c.userAdded ? undefined : { borderColor: SEGMENT_COLORS[c.segment], color: SEGMENT_COLORS[c.segment] }}
                    >
                      {displayCode(c)}
                    </span>
                    <span className="gsearch-card-text">
                      <span className="gsearch-name">{c.name}</span>
                      <span className="gsearch-meta">
                        {c.ticker && <span>{c.ticker}</span>}
                        {c.userAdded ? (
                          <span className="pending-tag">Added by you — pending full integration</span>
                        ) : (
                          <span>{SEGMENT_LABELS[c.segment]}</span>
                        )}
                        {c.isPrivate && <span>Private</span>}
                        {h.why.startsWith('alias') && <span className="muted">matched {h.why}</span>}
                      </span>
                    </span>
                  </button>
                  <div className="gsearch-actions">
                    {hasFin && (
                      <button type="button" className="gsearch-btn" onClick={() => openCompany(c, 'financials')}>
                        Financials
                      </button>
                    )}
                    {!c.userAdded && (
                      <button type="button" className={`gsearch-btn ${hasFin ? 'is-ghost' : ''}`} onClick={() => openCompany(c, 'network')}>
                        Network
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="gsearch-group">
            <div className="gsearch-group-h">
              SEC EDGAR — not in the terminal yet {rows && <span className="muted">· {secList.length}</span>}
            </div>
            {rowsState === 'loading' && <div className="gsearch-none">Loading the SEC company list…</div>}
            {rowsState === 'error' && (
              <div className="gsearch-none">
                Couldn’t reach SEC EDGAR through the local server.{' '}
                <button type="button" className="chip" onClick={() => { setRowsState('idle'); ensureRows(); }}>
                  Retry
                </button>
              </div>
            )}
            {rows && secList.length === 0 && debounced === query && (
              <div className="gsearch-none">No other SEC filer matches “{q}”.</div>
            )}
            {secList.map((row) => {
              const ck = checks[row.cik];
              const prog = user.progress[row.cik];
              const busy = prog && ['pulling', 'saving', 'requesting'].includes(prog.phase);
              const already = user.companies.some((u) => u.cik === row.cik);
              const eligible = ck && ck !== 'loading' && ck.status === 'ok';
              return (
                <div className="gsearch-card is-sec" key={row.cik}>
                  <div className="gsearch-card-main">
                    <span className="gsearch-code is-sec">{(row.tickers[0] || 'CIK').slice(0, 6)}</span>
                    <div className="gsearch-card-text">
                      <div className="gsearch-name">{row.name}</div>
                      <div className="gsearch-meta">
                        {row.tickers.length > 0 && <span>{row.tickers.slice(0, 3).join(' · ')}</span>}
                        {row.exchange && <span>{row.exchange}</span>}
                        <span>CIK {row.cik}</span>
                      </div>
                      <div className="gsearch-filings">
                        {!ck && (
                          <button type="button" className="chip" onClick={() => runCheck(row.cik)}>
                            Check SEC filings
                          </button>
                        )}
                        {ck === 'loading' && <span className="muted">Checking EDGAR filings…</span>}
                        {ck && ck !== 'loading' && ck.status === 'ok' && (
                          <>
                            {ck.forms.map((f) => (
                              <span key={f} className="form-chip">
                                {f} ×{ck.formCounts[f] ?? 0}
                              </span>
                            ))}
                          </>
                        )}
                        {ck && ck !== 'loading' && ck.status === 'none' && (
                          <span className="down">No formal financial filings - can’t add</span>
                        )}
                        {ck && ck !== 'loading' && ck.status === 'error' && (
                          <span className="down">
                            Filing check failed.{' '}
                            <button type="button" className="chip" onClick={() => runCheck(row.cik)}>
                              Retry
                            </button>
                          </span>
                        )}
                      </div>
                      {prog?.message && (
                        <div className={`gsearch-progress ${prog.phase === 'error' ? 'down' : ''}`}>{prog.message}</div>
                      )}
                    </div>
                  </div>
                  <div className="gsearch-actions is-add">
                    {already ? (
                      <button
                        type="button"
                        className="gsearch-btn"
                        onClick={() => {
                          close();
                          onOpenFinancials(`user-${row.cik}`);
                        }}
                      >
                        Added — open
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="gsearch-btn is-add"
                        disabled={!eligible || Boolean(busy)}
                        onClick={() => void onAdd(row)}
                        title={eligible ? 'Pull SEC financials into the terminal and send Grok Bot an add request' : 'Only filers with 10-K / 10-Q / 20-F / 40-F / S-1 / F-1 filings can be added'}
                      >
                        {busy ? 'Adding…' : ck && ck !== 'loading' && ck.status === 'none' ? 'Can’t add' : '+ Add to terminal'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="gsearch-foot muted">
            Source: SEC EDGAR company tickers (cached 24h) + submissions. Adding pulls XBRL company facts — no numbers are estimated.
          </p>
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <>
        <button type="button" className="gsearch-icon" aria-label="Search companies" onClick={() => setOpen(true)}>
          <SearchGlyph />
        </button>
        {open &&
          createPortal(
          <div className="gsearch-sheet" role="dialog" aria-modal="true" aria-label="Search companies">
            <div className="gsearch-sheet-top">
              <div className="gsearch-box is-sheet">
                <SearchGlyph />
                <input
                  ref={inputRef}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Name, ticker or CIK"
                  aria-label="Search companies"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {query && (
                  <button type="button" className="gsearch-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                    ×
                  </button>
                )}
              </div>
              <button type="button" className="gsearch-close" onClick={close}>
                Close
              </button>
            </div>
            <div className="gsearch-sheet-body">{panel}</div>
          </div>,
            document.body
          )}
      </>
    );
  }

  return (
    <div className={`gsearch ${open ? 'is-open' : ''}`} ref={boxRef}>
      <div className="gsearch-box">
        <SearchGlyph />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search name, ticker, CIK"
          aria-label="Search companies"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="gsearch-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            ×
          </button>
        ) : (
          <kbd className="gsearch-kbd">/</kbd>
        )}
      </div>
      {open && <div className="gsearch-pop">{panel}</div>}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg className="gsearch-glyph" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
