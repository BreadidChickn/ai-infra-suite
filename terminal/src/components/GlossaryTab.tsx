import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GLOSSARY,
  GLOSSARY_BY_ID,
  GLOSSARY_CATEGORIES,
  TAB_LABELS,
  type GlossaryCategory,
  type GlossaryTab,
  type GlossaryTerm,
} from '../data/glossary';

interface Props {
  isMobile: boolean;
  initialTermId?: string | null;
  onOpenTab?: (tab: GlossaryTab) => void;
  onTermConsumed?: () => void;
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function matchesQuery(t: GlossaryTerm, q: string) {
  if (!q) return true;
  const hay = [t.term, t.definition, t.example, t.meaning, ...(t.aka || [])]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** Scroll a term into view; on desktop only the list pane scrolls, not the page. */
function scrollToTerm(id: string) {
  const el = document.getElementById(`gloss-${id}`);
  if (!el) return;
  const list = el.closest('.glossary-list') as HTMLElement | null;
  if (list) {
    const delta = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top: list.scrollTop + delta - list.clientHeight / 3, behavior: 'smooth' });
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function catMeta(id: GlossaryCategory) {
  return GLOSSARY_CATEGORIES.find((c) => c.id === id)!;
}

export function GlossaryTab({ isMobile, initialTermId, onOpenTab, onTermConsumed }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GlossaryCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialTermId && GLOSSARY_BY_ID[initialTermId] ? initialTermId : null
  );
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialTermId && GLOSSARY_BY_ID[initialTermId] ? new Set([initialTermId]) : new Set()
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return GLOSSARY.filter(
      (t) => (category === 'all' || t.category === category) && matchesQuery(t, q)
    ).sort((a, b) => a.term.localeCompare(b.term));
  }, [category, q]);

  const byLetter = useMemo(() => {
    const map = new Map<string, GlossaryTerm[]>();
    for (const t of filtered) {
      const L = t.term.replace(/^[^A-Za-z]+/, '').charAt(0).toUpperCase() || '#';
      if (!map.has(L)) map.set(L, []);
      map.get(L)!.push(t);
    }
    return map;
  }, [filtered]);

  const lettersPresent = useMemo(
    () => ALPHA.filter((L) => byLetter.has(L)),
    [byLetter]
  );

  const selected = selectedId ? GLOSSARY_BY_ID[selectedId] || null : null;

  // Deep-link / Financials tooltip → open a specific term
  useEffect(() => {
    if (!initialTermId) return;
    const t = GLOSSARY_BY_ID[initialTermId];
    if (!t) {
      onTermConsumed?.();
      return;
    }
    setCategory('all');
    setQuery('');
    setSelectedId(t.id);
    setExpanded((prev) => new Set(prev).add(t.id));
    // scroll after paint
    requestAnimationFrame(() => scrollToTerm(t.id));
    onTermConsumed?.();
  }, [initialTermId, onTermConsumed]);

  // Default-select first filtered term on desktop when none selected
  useEffect(() => {
    if (isMobile) return;
    setSelectedId((cur) => {
      if (cur && filtered.some((t) => t.id === cur)) return cur;
      return filtered.length ? filtered[0].id : null;
    });
  }, [filtered, isMobile]);

  const jumpLetter = (L: string) => {
    const el = document.getElementById(`gloss-letter-${L}`);
    const list = el?.closest('.glossary-list') as HTMLElement | null;
    if (el && list) {
      const delta = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTo({ top: list.scrollTop + delta, behavior: 'smooth' });
    }
  };

  const pick = (id: string) => {
    setSelectedId(id);
    if (isMobile) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const goRelated = (id: string) => {
    setCategory('all');
    setQuery('');
    setSelectedId(id);
    setExpanded((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => scrollToTerm(id));
  };

  return (
    <div className={`glossary-tab ${isMobile ? 'is-mobile' : ''}`}>
      <div className="glossary-header panel">
        <div className="glossary-header-top">
          <div>
            <h3>Glossary</h3>
            <p className="panel-note">
              {GLOSSARY.length} terms · plain-English definitions with illustrative examples. Examples
              use “a company” / “Example Co.” — not claims about specific real filings.
            </p>
          </div>
          <span className="data-badge badge-illustrative">REFERENCE</span>
        </div>

        <div className="glossary-search-row">
          <label className="glossary-search">
            <span className="sr-only">Search glossary</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms, definitions, examples…"
              aria-label="Search glossary"
              autoComplete="off"
            />
            {query && (
              <button type="button" className="glossary-clear" onClick={() => setQuery('')} aria-label="Clear search">
                ✕
              </button>
            )}
          </label>
          <div className="glossary-count mono muted">
            {filtered.length}/{GLOSSARY.length}
          </div>
        </div>

        <div className="glossary-chips" role="tablist" aria-label="Category filter">
          <button
            type="button"
            className={`chip ${category === 'all' ? 'on' : ''}`}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          {GLOSSARY_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${category === c.id ? 'on' : ''}`}
              onClick={() => setCategory(c.id)}
              title={c.label}
            >
              <span aria-hidden>{c.icon}</span> {isMobile ? c.short : c.label}
            </button>
          ))}
        </div>

        {!isMobile && (
          <div className="glossary-alpha" aria-label="Jump to letter">
            {ALPHA.map((L) => (
              <button
                key={L}
                type="button"
                className={`alpha-btn ${lettersPresent.includes(L) ? '' : 'is-disabled'}`}
                disabled={!lettersPresent.includes(L)}
                onClick={() => jumpLetter(L)}
              >
                {L}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="panel glossary-empty">
          <p>No terms match “{query}”.</p>
          <button type="button" className="chip" onClick={() => { setQuery(''); setCategory('all'); }}>
            Clear filters
          </button>
        </div>
      ) : isMobile ? (
        <MobileList
          byLetter={byLetter}
          lettersPresent={lettersPresent}
          expanded={expanded}
          selectedId={selectedId}
          onPick={pick}
          onRelated={goRelated}
          onOpenTab={onOpenTab}
        />
      ) : (
        <div className="glossary-desktop">
          <div className="glossary-list panel">
            {lettersPresent.map((L) => (
              <div key={L} id={`gloss-letter-${L}`} className="glossary-letter-group">
                <div className="glossary-letter-head">{L}</div>
                {(byLetter.get(L) || []).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    id={`gloss-${t.id}`}
                    className={`glossary-list-item ${selectedId === t.id ? 'active' : ''}`}
                    onClick={() => pick(t.id)}
                  >
                    <span className="glossary-list-term">{t.term}</span>
                    <span className="glossary-list-cat muted">{catMeta(t.category).short}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="glossary-detail panel" ref={detailRef}>
            {selected ? (
              <TermDetail term={selected} onRelated={goRelated} onOpenTab={onOpenTab} />
            ) : (
              <p className="muted">Select a term to see its definition and example.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileList({
  byLetter,
  lettersPresent,
  expanded,
  selectedId,
  onPick,
  onRelated,
  onOpenTab,
}: {
  byLetter: Map<string, GlossaryTerm[]>;
  lettersPresent: string[];
  expanded: Set<string>;
  selectedId: string | null;
  onPick: (id: string) => void;
  onRelated: (id: string) => void;
  onOpenTab?: (tab: GlossaryTab) => void;
}) {
  return (
    <div className="glossary-mobile-list">
      {lettersPresent.map((L) => (
        <div key={L} className="glossary-letter-group">
          <div className="glossary-letter-head sticky-letter">{L}</div>
          {(byLetter.get(L) || []).map((t) => {
            const open = expanded.has(t.id);
            return (
              <div
                key={t.id}
                id={`gloss-${t.id}`}
                className={`glossary-card panel ${open ? 'is-open' : ''} ${selectedId === t.id ? 'is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="glossary-card-btn"
                  aria-expanded={open}
                  onClick={() => onPick(t.id)}
                >
                  <div className="glossary-card-top">
                    <span className="glossary-card-term">{t.term}</span>
                    <span className="glossary-card-cat">{catMeta(t.category).short}</span>
                  </div>
                  {!open && <p className="glossary-card-preview muted">{t.definition}</p>}
                  <span className="glossary-chevron" aria-hidden>
                    {open ? '▾' : '▸'}
                  </span>
                </button>
                {open && (
                  <div className="glossary-card-body">
                    <TermDetail term={t} onRelated={onRelated} onOpenTab={onOpenTab} compact />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TermDetail({
  term,
  onRelated,
  onOpenTab,
  compact,
}: {
  term: GlossaryTerm;
  onRelated: (id: string) => void;
  onOpenTab?: (tab: GlossaryTab) => void;
  compact?: boolean;
}) {
  return (
    <article className={`glossary-term-detail ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <>
          <div className="glossary-detail-kicker">
            <span className="chip is-static">{catMeta(term.category).label}</span>
            {term.aka && term.aka.length > 0 && (
              <span className="muted tiny">also: {term.aka.join(' · ')}</span>
            )}
          </div>
          <h2 className="glossary-term-title">{term.term}</h2>
        </>
      )}
      {compact && term.aka && term.aka.length > 0 && (
        <p className="muted tiny">also: {term.aka.join(' · ')}</p>
      )}

      <h4 className="glossary-section-label">Definition</h4>
      <p className="glossary-def">{term.definition}</p>

      <div className="glossary-example-block">
        <h4 className="glossary-section-label">
          Example <span className="tiny muted">(illustrative)</span>
        </h4>
        <blockquote className="glossary-example">{term.example}</blockquote>
        <p className="glossary-meaning">
          <strong>How to read it:</strong> {term.meaning}
        </p>
      </div>

      {term.related && term.related.length > 0 && (
        <div className="glossary-related">
          <h4 className="glossary-section-label">Related</h4>
          <div className="glossary-related-chips">
            {term.related.map((id) => {
              const r = GLOSSARY_BY_ID[id];
              if (!r) return null;
              return (
                <button key={id} type="button" className="chip" onClick={() => onRelated(id)}>
                  {r.term}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {term.tabs && term.tabs.length > 0 && onOpenTab && (
        <div className="glossary-tabs-links">
          <h4 className="glossary-section-label">See it in</h4>
          <div className="glossary-related-chips">
            {term.tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className="chip chip-tab"
                onClick={() => onOpenTab(tab)}
              >
                → {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
