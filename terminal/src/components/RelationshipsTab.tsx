import { useMemo, useState } from 'react';
import type { Company, Relationship, RelationType } from '../types';
import { RELATION_COLORS, RELATION_LABELS, SEGMENT_COLORS, SEGMENT_LABELS, isEnergySegment } from '../data/constants';

interface Props {
  companies: Company[];
  relationships: Relationship[];
}

export function RelationshipsTab({ companies, relationships }: Props) {
  const [typeFilter, setTypeFilter] = useState<RelationType | 'all'>('all');
  const [companyId, setCompanyId] = useState<string>('all');
  const [selectedRel, setSelectedRel] = useState<Relationship | null>(null);
  /** 'energy' = links touching at least one energy company; 'core' = AI-infra-only links */
  const [layer, setLayer] = useState<'all' | 'core' | 'energy'>('all');

  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const isEnergyRel = (r: Relationship) => {
    const a = byId.get(r.source);
    const b = byId.get(r.target);
    return !!((a && isEnergySegment(a.segment)) || (b && isEnergySegment(b.segment)));
  };

  const filtered = useMemo(() => {
    return relationships.filter((r) => {
      if (layer === 'energy' && !isEnergyRel(r)) return false;
      if (layer === 'core' && isEnergyRel(r)) return false;
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (companyId !== 'all' && r.source !== companyId && r.target !== companyId) return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationships, typeFilter, companyId, layer, byId]);

  const grouped = useMemo(() => {
    const map = new Map<RelationType, Relationship[]>();
    for (const r of filtered) {
      if (!map.has(r.type)) map.set(r.type, []);
      map.get(r.type)!.push(r);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const matrixCompanies = useMemo(() => {
    const ids = new Set<string>();
    filtered.forEach((r) => {
      ids.add(r.source);
      ids.add(r.target);
    });
    return [...ids]
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.marketCapB - a.marketCapB)
      .slice(0, layer === 'energy' ? 18 : 14);
  }, [filtered, byId, layer]);

  const hasEdge = (a: string, b: string) =>
    filtered.find((r) => (r.source === a && r.target === b) || (r.source === b && r.target === a));

  const companyDetail = companyId !== 'all' ? byId.get(companyId) : null;
  const companyRels = useMemo(() => {
    if (!companyDetail) return [];
    return relationships.filter(
      (r) => r.source === companyDetail.id || r.target === companyDetail.id
    );
  }, [companyDetail, relationships]);

  return (
    <div className="rel-layout">
      <div className="rel-filters panel">
        <h3>Filters</h3>
        <div className="filter-row" role="group" aria-label="Layer">
          {(
            [
              ['all', 'All layers'],
              ['core', 'AI infra'],
              ['energy', '⚡ Energy ↔ AI'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`chip ${layer === k ? 'on' : ''}`} onClick={() => setLayer(k)}>
              {label}
            </button>
          ))}
        </div>
        <label>
          Relationship type
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as RelationType | 'all')}
          >
            <option value="all">All types ({relationships.length})</option>
            {(Object.keys(RELATION_LABELS) as RelationType[]).map((t) => (
              <option key={t} value={t}>
                {RELATION_LABELS[t]} (
                {relationships.filter((r) => r.type === t).length})
              </option>
            ))}
          </select>
        </label>
        <label>
          Focus company
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="all">All companies</option>
            {(['AI infrastructure', 'Energy'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {[...companies]
                  .filter((c) => isEnergySegment(c.segment) === (g === 'Energy'))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="rel-count">
          Showing <strong>{filtered.length}</strong> relationships
        </div>
      </div>

      <div className="rel-main">
        {companyDetail && (
          <div className="panel company-detail">
            <h3>
              <span className="swatch" style={{ background: SEGMENT_COLORS[companyDetail.segment] }} />
              {companyDetail.name}
            </h3>
            <p className="muted">
              {SEGMENT_LABELS[companyDetail.segment]} · {companyDetail.country} · $
              {companyDetail.marketCapB.toLocaleString()}B
              {companyDetail.isPrivate ? ' est.' : ''}
            </p>
            <p>{companyDetail.summary}</p>
            {companyDetail.aiLink && (
              <p className="tt-ailink">
                <span className={`strength-pill ${companyDetail.aiLink.strength}`}>⚡ AI link: {companyDetail.aiLink.strength}</span>{' '}
                {companyDetail.aiLink.summary}{' '}
                <a href={companyDetail.aiLink.url} target="_blank" rel="noreferrer">
                  {companyDetail.aiLink.source}, {companyDetail.aiLink.date}
                </a>
              </p>
            )}
            <h4>Connected relationships ({companyRels.length})</h4>
            <ul className="rel-list compact">
              {companyRels.map((r) => {
                const otherId = r.source === companyDetail.id ? r.target : r.source;
                const other = byId.get(otherId);
                return (
                  <li key={r.id} onClick={() => setSelectedRel(r)}>
                    <span className="rel-type" style={{ color: RELATION_COLORS[r.type] }}>
                      {RELATION_LABELS[r.type]}
                    </span>
                    <span>
                      {r.source === companyDetail.id ? '→' : '←'} {other?.name ?? otherId}
                    </span>
                    <span className="muted">{r.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="panel">
          <h3>Grouped by Type</h3>
          <div className="grouped-rels">
            {grouped.map(([type, rels]) => (
              <div key={type} className="group-block">
                <h4 style={{ color: RELATION_COLORS[type] }}>
                  {RELATION_LABELS[type]} <span className="muted">({rels.length})</span>
                </h4>
                <ul className="rel-list">
                  {rels.map((r) => (
                    <li
                      key={r.id}
                      className={selectedRel?.id === r.id ? 'selected' : ''}
                      onClick={() => setSelectedRel(r)}
                    >
                      <strong>{byId.get(r.source)?.name}</strong>
                      <span className="arrow">↔</span>
                      <strong>{byId.get(r.target)?.name}</strong>
                      <span className="muted">— {r.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!grouped.length && <p className="muted">No relationships match filters.</p>}
          </div>
        </div>

        <div className="panel">
          <h3>Relationship Matrix (top names in filter)</h3>
          <div className="matrix-scroll">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th></th>
                  {matrixCompanies.map((c) => (
                    <th key={c.id} title={c.name}>
                      {(c.shortCode || c.ticker || c.name).slice(0, 5).toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixCompanies.map((row) => (
                  <tr key={row.id}>
                    <th title={row.name}>{row.name.slice(0, 10)}</th>
                    {matrixCompanies.map((col) => {
                      if (row.id === col.id)
                        return <td key={col.id} className="diag" />;
                      const edge = hasEdge(row.id, col.id);
                      return (
                        <td
                          key={col.id}
                          className={edge ? 'hit' : ''}
                          style={edge ? { background: RELATION_COLORS[edge.type] + '55' } : undefined}
                          title={edge ? `${edge.label}: ${edge.detail}` : ''}
                          onClick={() => edge && setSelectedRel(edge)}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside className="panel rel-detail">
        <h3>Detail</h3>
        {selectedRel ? (
          <>
            <div className="rel-type-lg" style={{ color: RELATION_COLORS[selectedRel.type] }}>
              {RELATION_LABELS[selectedRel.type]}
            </div>
            <p>
              <strong>{byId.get(selectedRel.source)?.name}</strong> ↔{' '}
              <strong>{byId.get(selectedRel.target)?.name}</strong>
            </p>
            <p className="rel-label">{selectedRel.label}</p>
            <p>{selectedRel.detail}</p>
            <p className="muted">Strength: {selectedRel.strength ?? '—'}/10</p>
          </>
        ) : (
          <p className="muted">Select a relationship from the lists or matrix.</p>
        )}
      </aside>
    </div>
  );
}
