import { useEffect, useMemo, useState } from 'react';
import type { Company, DataMode, Headline, SentimentTheme } from '../types';
import { SEGMENT_COLORS, SEGMENT_LABELS } from '../data/constants';
import type { NewsItem } from '../services/newsFeed';
import { basketWeights, computeMockScores, makeWeightedAvg } from '../services/mockScores';
import { MockIndexExperimental } from './MockIndexExperimental';
import { displayCode, fmtPct, pctClass, pnlColor } from '../utils/format';

interface Props {
  companies: Company[];
  headlines: Headline[];
  themes: SentimentTheme[];
  mode: DataMode;
  /** Live news sentiment per market id (−100…100, null when no headlines) from the news refresher */
  marketScores?: Record<string, number | null>;
  newsItems?: NewsItem[];
  newsLive?: boolean;
}

const STORAGE_KEY = 'ai-infra-mock-baskets-v1';

interface SavedBasket {
  name: string;
  ids: string[];
  weightMode: 'equal' | 'mcap';
}

type Horizon = '1D' | '1M' | '1Q' | '6M' | 'YTD';


export function MockIndexTab({ companies, headlines, themes, mode, marketScores, newsItems = [], newsLive = false }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [weightMode, setWeightMode] = useState<'equal' | 'mcap'>('equal');
  const [basketName, setBasketName] = useState('');
  const [saved, setSaved] = useState<SavedBasket[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as SavedBasket[]);
    } catch {
      setSaved([]);
    }
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const members = useMemo(
    () => companies.filter((c) => selected.has(c.id)),
    [companies, selected]
  );

  const pickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        displayCode(c).toLowerCase().includes(q) ||
        (c.ticker && c.ticker.toLowerCase().includes(q)) ||
        SEGMENT_LABELS[c.segment].toLowerCase().includes(q)
    );
  }, [companies, pickerQuery]);

  const weights = useMemo(() => basketWeights(members, weightMode), [members, weightMode]);
  const weightedAvg = makeWeightedAvg(members, weights);

  const recentIpos = members.filter((c) => c.ipoDate);
  const performance: { horizon: Horizon; value?: number }[] = [
    { horizon: '1D', value: weightedAvg((c) => c.change1D, 1) },
    { horizon: '1M', value: weightedAvg((c) => c.change1M, 30) },
    { horizon: '1Q', value: weightedAvg((c) => c.change1Q, 90) },
    { horizon: '6M', value: weightedAvg((c) => c.change6M, 180) },
    { horizon: 'YTD', value: weightedAvg((c) => c.changeYTD, 200) },
  ];

  const scores = useMemo(
    () => computeMockScores(members, weights, { themes, headlines, marketScores }),
    [members, themes, headlines, weights, marketScores]
  );

  const liveBadge =
    mode === 'live' ? 'LIVE' : mode === 'mixed' ? 'MIXED' : 'ILLUSTRATIVE';

  const saveBasket = () => {
    if (!selected.size) return;
    const name = basketName.trim() || `Basket ${saved.length + 1}`;
    const next = [
      ...saved.filter((b) => b.name !== name),
      { name, ids: [...selected], weightMode },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSaved(next);
    setBasketName(name);
  };

  const loadBasket = (b: SavedBasket) => {
    setSelected(new Set(b.ids));
    setWeightMode(b.weightMode);
    setBasketName(b.name);
  };

  return (
    <div className="mock-layout">
      <div className="panel mock-controls">
        <div className="mock-toolbar">
          <h3>Mock Index Builder</h3>
          <button type="button" className="chip" onClick={() => setShowHelp((h) => !h)}>
            {showHelp ? 'Hide formula' : 'How scores work'}
          </button>
          <span className={`data-badge badge-${mode}`}>{liveBadge}</span>
        </div>

        {showHelp && (
          <div className="help-box">
            <p>
              <strong>Sentiment (0–100):</strong> 50 + 0.25×avg theme score + 20×basket-weighted
              live news sentiment of each member's market (news refresher, −1…1; falls back to the
              headline average) + 1.5×basket 1D%.
            </p>
            <p>
              <strong>Risk (0–100, higher = riskier):</strong> private-share×35 + CN/TW share×40 +
              avg(|1D|+0.3×|1M|)×2.5 + 15.
            </p>
            <p>
              <strong>Profitability (0–100):</strong> illustrative proxy from YTD breadth &
              magnitude (no GAAP margins in seed data).
            </p>
            <p>
              <strong>Growth (0–100):</strong> 50 + 0.9×(0.3×1M + 0.35×1Q + 0.2×YTD).
            </p>
            <p className="muted">
              Not investment advice. Horizons aggregate member returns (Yahoo when available, else
              curated).
            </p>
          </div>
        )}

        <div className="weight-row">
          <label>
            <input
              type="radio"
              checked={weightMode === 'equal'}
              onChange={() => setWeightMode('equal')}
            />{' '}
            Equal weight
          </label>
          <label>
            <input
              type="radio"
              checked={weightMode === 'mcap'}
              onChange={() => setWeightMode('mcap')}
            />{' '}
            Market-cap weight
          </label>
          <input
            className="basket-name-input"
            placeholder="Basket name"
            value={basketName}
            onChange={(e) => setBasketName(e.target.value)}
          />
          <button type="button" className="chip on" onClick={saveBasket} disabled={!selected.size}>
            Save
          </button>
          <button type="button" className="chip" onClick={() => { setSelected(new Set()); setBasketName(''); }}>
            Clear
          </button>
        </div>

        {saved.length > 0 && (
          <div className="saved-row">
            <span className="muted">Saved:</span>
            {saved.map((b) => (
              <button key={b.name} type="button" className="chip" onClick={() => loadBasket(b)}>
                {b.name} ({b.ids.length})
              </button>
            ))}
          </div>
        )}

        <div className="mock-picker">
          <div className="mock-selected-bar">
            <strong>{selected.size}</strong> selected
            {selected.size > 0 && (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setSelected(new Set());
                  setBasketName('');
                }}
              >
                Clear
              </button>
            )}
          </div>
          <input
            className="basket-name-input mock-search"
            type="search"
            placeholder="Search companies…"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            aria-label="Search companies"
          />
          <div className="company-check-grid">
            {pickerList.map((c) => (
              <label key={c.id} className={`check-item ${selected.has(c.id) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="swatch" style={{ background: SEGMENT_COLORS[c.segment] }} />
                <span className="mono">{displayCode(c)}</span>
                <span className="check-name">{c.name}</span>
              </label>
            ))}
            {!pickerList.length && <p className="muted">No companies match “{pickerQuery}”.</p>}
          </div>
        </div>
      </div>

      {!members.length ? (
        <div className="panel empty-state">
          <h3>Build a mock AI-infra index</h3>
          <p>
            Select companies above, choose equal or market-cap weighting, then review composite
            scores and horizon returns. Named baskets persist in localStorage.
          </p>
          <p className="muted">Tip: try NVDA + TSM + ASML + MSFT for a classic infra stack.</p>
        </div>
      ) : (
        <div className="mock-results">
          <div className="panel">
            <h3>
              Basket · {members.length} names · {weightMode === 'equal' ? 'Equal' : 'MCap'} weight
            </h3>
            <div className="score-grid">
              {(
                [
                  ['Sentiment', scores.sentiment, false],
                  ['Risk', scores.risk, true],
                  ['Profitability', scores.profitability, false],
                  ['Growth', scores.growth, false],
                ] as const
              ).map(([label, val, invert]) => (
                <div key={label} className="score-card">
                  <div className="score-label">{label}</div>
                  <div
                    className="score-val"
                    style={{
                      color: invert
                        ? val > 60
                          ? '#ef5350'
                          : val < 35
                            ? '#00e676'
                            : '#ffb300'
                        : val >= 60
                          ? '#00e676'
                          : val <= 40
                            ? '#ef5350'
                            : '#ffb300',
                    }}
                  >
                    {val}
                  </div>
                  <div className="score-bar">
                    <div
                      className="score-fill"
                      style={{ width: `${val}%`, background: pnlColor(invert ? 50 - val : val - 50) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>
              Horizon Performance <span className={`data-badge badge-${mode}`}>{liveBadge}</span>
            </h3>
            <div className="horizon-grid">
              {performance.map((p) => (
                <div key={p.horizon} className="horizon-cell">
                  <div className="perf-label">{p.horizon}</div>
                  <div className={`perf-val mono ${pctClass(p.value)}`}>{fmtPct(p.value)}</div>
                </div>
              ))}
            </div>
            <p className="muted tiny">
              Aggregated member returns. Not investment advice. LIVE uses Yahoo where available;
              otherwise curated illustrative figures.
              {recentIpos.length > 0 && (
                <> Horizons that start before a member’s IPO ({recentIpos.map((c) => displayCode(c)).join(', ')}) are excluded from that average — shown as — when no eligible members remain.</>
              )}
            </p>
          </div>

          <MockIndexExperimental
            members={members}
            weights={weights}
            estimate1D={performance.find((p) => p.horizon === '1D')?.value}
            newsItems={newsItems}
            newsLive={newsLive}
          />

          <div className="panel">
            <h3>Members</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Company</th>
                    <th>Segment</th>
                    <th>Weight</th>
                    <th>1D</th>
                    <th>1M</th>
                    <th>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{displayCode(c)}</td>
                      <td>
                        {c.name}
                        {c.ipoDate && (
                          <span className="tag-priv" title={`IPO ${c.ipoDate}${c.ipoPrice != null ? ` @ $${c.ipoPrice}` : ''}`}>
                            IPO {c.ipoDate.slice(0, 7)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="seg-pill" style={{ borderColor: SEGMENT_COLORS[c.segment] }}>
                          {SEGMENT_LABELS[c.segment]}
                        </span>
                      </td>
                      <td className="mono">{((weights.get(c.id) || 0) * 100).toFixed(1)}%</td>
                      <td className={`mono ${pctClass(c.change1D)}`}>{fmtPct(c.change1D)}</td>
                      <td className={`mono ${pctClass(c.change1M)}`}>{fmtPct(c.change1M)}</td>
                      <td className={`mono ${pctClass(c.changeYTD)}`}>{fmtPct(c.changeYTD)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
