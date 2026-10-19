import { useEffect, useMemo, useState } from 'react';
import type { Company, InvestorPurpose, SecFilingMeta } from '../types';
import { SEGMENT_COLORS, SEGMENT_LABELS } from '../data/constants';
import { COMPANY_CIKS, CURATED_FILINGS } from '../data/secMeta';
import { outsideInvestors } from '../data/outsideInvestors';
import {
  displayCode,
  edgarBrowseUrl,
  edgarSubmissionsUrl,
  fmtPct,
  fmtUsdM,
  padCik,
  pctClass,
} from '../utils/format';

interface Props {
  company: Company;
  onClose: () => void;
}

const PURPOSE_LABELS: Record<InvestorPurpose, string> = {
  product: 'Product',
  saas: 'SaaS',
  capacity: 'Capacity',
  strategic: 'Strategic',
  foundry: 'Foundry',
  cloud_spend: 'Cloud spend',
};

export function CompanyDrilldown({ company, onClose }: Props) {
  const cik = company.cik || COMPANY_CIKS[company.id] || '';
  const [filings, setFilings] = useState<SecFilingMeta[]>([]);
  const [filingsSource, setFilingsSource] = useState<'live' | 'curated' | 'na'>('na');
  const [purposeFilter, setPurposeFilter] = useState<InvestorPurpose | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cik || company.isPrivate) {
        setFilings([]);
        setFilingsSource('na');
        return;
      }
      try {
        const res = await fetch(`/api/sec/submissions/CIK${padCik(cik)}.json`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error('sec_fail');
        const json = await res.json();
        const recent = json?.filings?.recent;
        if (!recent?.form) throw new Error('no_recent');
        const out: SecFilingMeta[] = [];
        for (let i = 0; i < Math.min(80, recent.form.length); i++) {
          const form = String(recent.form[i]);
          if (!/10-[KQ]|20-F|8-K|6-K|S-1|424B4|FWP|^D$|D\/A|8-A12B/i.test(form)) continue;
          const accessionRaw = String(recent.accessionNumber[i]);
          const accession = accessionRaw.replace(/-/g, '');
          const primary = String(recent.primaryDocument[i] || '');
          out.push({
            form,
            filedAt: String(recent.filingDate[i]),
            description: String(
              recent.primaryDocDescription?.[i] || recent.items?.[i] || form
            ),
            accession: accessionRaw,
            url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${primary}`,
          });
          if (out.length >= 6) break;
        }
        if (!cancelled) {
          if (out.length) {
            setFilings(out);
            setFilingsSource('live');
          } else {
            throw new Error('empty');
          }
        }
      } catch {
        const curated = CURATED_FILINGS[company.id] || [];
        if (!cancelled) {
          setFilings(
            curated.map((f) => ({
              form: f.form,
              filedAt: f.filedAt,
              description: f.description,
              url: f.url,
            }))
          );
          setFilingsSource(curated.length ? 'curated' : 'na');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cik, company.id, company.isPrivate]);

  const investors = useMemo(() => {
    let list = outsideInvestors.filter((o) => o.targetCompanyId === company.id);
    if (list.length < 2) {
      const token = company.name.split(' ')[0]!.toLowerCase();
      list = outsideInvestors.filter(
        (o) =>
          o.targetCompanyId === company.id ||
          o.targetInfra.toLowerCase().includes(token) ||
          /chip|cloud|gpu|foundry|AI|capacity|TSMC|NVIDIA/i.test(o.targetInfra)
      );
    }
    if (purposeFilter !== 'all') list = list.filter((o) => o.purpose === purposeFilter);
    return [...list].sort((a, b) => b.amountUsdM - a.amountUsdM).slice(0, 15);
  }, [company, purposeFilter]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="company-drawer" onClick={(e) => e.stopPropagation()} role="dialog">
        <header className="drawer-header">
          <div>
            <div className="drawer-code">{displayCode(company)}</div>
            <h2>{company.name}</h2>
            <div className="drawer-meta">
              <span className="seg-pill" style={{ borderColor: SEGMENT_COLORS[company.segment] }}>
                {SEGMENT_LABELS[company.segment]}
              </span>
              <span>{company.country}</span>
              {company.isPrivate && <span className="tag-priv">PRIVATE</span>}
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="drawer-summary">{company.summary}</p>
        {company.aiLink && (
          <section className="drawer-section ailink-box">
            <h3>
              ⚡ AI / data-center link <span className={`strength-pill ${company.aiLink.strength}`}>{company.aiLink.strength}</span>
            </h3>
            <p>{company.aiLink.summary}</p>
            <p className="tiny muted">
              Source:{' '}
              <a href={company.aiLink.url} target="_blank" rel="noreferrer">
                {company.aiLink.source}
              </a>{' '}
              · {company.aiLink.date}
              {company.capSource && <> · Market cap: {company.capSource}</>}
            </p>
          </section>
        )}

        <section className="drawer-section">
          <h3>Key Performance</h3>
          <div className="perf-grid">
            {(
              [
                ['1D', company.change1D],
                ['1M', company.change1M],
                ['1Q', company.change1Q],
                ['6M', company.change6M],
                ['YTD', company.changeYTD],
              ] as const
            ).map(([label, val]) => (
              <div key={label} className="perf-cell">
                <div className="perf-label">{label}</div>
                <div className={`perf-val mono ${pctClass(val)}`}>{fmtPct(val)}</div>
              </div>
            ))}
            <div className="perf-cell">
              <div className="perf-label">Mkt Cap</div>
              <div className="perf-val mono">
                {company.isPrivate ? 'Est. ' : ''}${company.marketCapB.toLocaleString()}B
              </div>
            </div>
          </div>
        </section>

        <section className="drawer-section">
          <h3>Public SEC Grounding</h3>
          {company.isPrivate || !cik ? (
            <p className="muted">
              N/A — {company.isPrivate ? 'private company' : 'no US EDGAR CIK in dataset'}. SEC
              EDGAR filings are not applicable.
            </p>
          ) : (
            <>
              <div className="sec-links">
                <a href={edgarBrowseUrl(cik, '10-K')} target="_blank" rel="noreferrer">
                  EDGAR 10-K search
                </a>
                <a href={edgarBrowseUrl(cik, '10-Q')} target="_blank" rel="noreferrer">
                  EDGAR 10-Q search
                </a>
                <a href={edgarSubmissionsUrl(cik)} target="_blank" rel="noreferrer">
                  data.sec.gov submissions
                </a>
                <span className="mono muted">CIK {padCik(cik)}</span>
              </div>
              <div className="filings-badge">
                Source:{' '}
                {filingsSource === 'live'
                  ? 'LIVE SEC'
                  : filingsSource === 'curated'
                    ? 'CURATED FALLBACK'
                    : 'N/A'}
              </div>
              {filings.length > 0 ? (
                <ul className="filing-list">
                  {filings.map((f, i) => (
                    <li key={i}>
                      <span className="filing-form">{f.form}</span>
                      <span className="muted">{f.filedAt}</span>
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer">
                          {f.description}
                        </a>
                      ) : (
                        <span>{f.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No recent filing titles available.</p>
              )}
            </>
          )}
        </section>

        <section className="drawer-section">
          <h3>Outside-infra investors into AI infra</h3>
          <p className="muted">
            Entities outside core infra with disclosed investments / capex / cloud spend /
            partnerships > $1M into chips, cloud capacity, foundry, or AI labs.
          </p>
          <div className="filter-row">
            <button
              type="button"
              className={`chip ${purposeFilter === 'all' ? 'on' : ''}`}
              onClick={() => setPurposeFilter('all')}
            >
              All
            </button>
            {(Object.keys(PURPOSE_LABELS) as InvestorPurpose[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`chip ${purposeFilter === p ? 'on' : ''}`}
                onClick={() => setPurposeFilter(p)}
              >
                {PURPOSE_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Investor</th>
                  <th>Target</th>
                  <th>Amount</th>
                  <th>Purpose</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {investors.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.investor}</strong>
                      {o.investorTicker && <span className="ticker"> {o.investorTicker}</span>}
                    </td>
                    <td>{o.targetInfra}</td>
                    <td className="mono">
                      {fmtUsdM(o.amountUsdM)}
                      {o.amountNote && <div className="muted tiny">{o.amountNote}</div>}
                    </td>
                    <td>{PURPOSE_LABELS[o.purpose]}</td>
                    <td>
                      {o.sourceUrl ? (
                        <a href={o.sourceUrl} target="_blank" rel="noreferrer">
                          {o.sourceNote}
                        </a>
                      ) : (
                        o.sourceNote
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </aside>
    </div>
  );
}
