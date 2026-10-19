import type { ReactNode } from 'react';
import type { DataMode } from '../types';

interface Props {
  active: string;
  onTab: (tab: string) => void;
  mode: DataMode;
  asOf?: string;
  compact?: boolean;
  /** Global search (desktop: inline box; mobile: icon that opens a full-screen sheet). */
  search?: ReactNode;
}

const TABS = [
  { id: 'network', label: 'Network' },
  { id: 'markets', label: 'Markets' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'financials', label: 'Financials' },
  { id: 'mock', label: 'Mock Index' },
  { id: 'trader', label: 'AI Trader' },
  { id: 'glossary', label: 'Glossary' },
];

export function Header({ active, onTab, mode, asOf, compact, search }: Props) {
  const modeLabel =
    mode === 'live' ? 'LIVE' : mode === 'mixed' ? 'MIXED' : 'ILLUSTRATIVE';
  const modeClass =
    mode === 'live' ? 'badge-live' : mode === 'mixed' ? 'badge-mixed' : 'badge-illustrative';

  const timeStr = asOf
    ? new Date(asOf).toLocaleString('en-US', {
        timeZoneName: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <header className={`terminal-header ${compact ? 'is-compact' : ''}`}>
      <div className="header-left">
        <div className="logo-mark">◈</div>
        <div>
          <h1 className="terminal-title">AI INFRA TERMINAL</h1>
          <div className="terminal-sub">Chips · Foundries · Cloud · Equipment · IP · Politics</div>
        </div>
      </div>
      <nav className="tab-nav" aria-label="Desktop tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${active === t.id ? 'active' : ''}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="header-right">
        {search}
        <span className={`data-badge ${modeClass}`}>{modeLabel}</span>
        {timeStr && (
          <span className="asof" title={`As of ${timeStr}`}>
            As of {timeStr}
          </span>
        )}
      </div>
    </header>
  );
}
