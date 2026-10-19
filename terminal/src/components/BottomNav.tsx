interface Props {
  active: string;
  onTab: (tab: string) => void;
}

const TABS = [
  { id: 'network', label: 'Network', icon: '◈' },
  { id: 'markets', label: 'Markets', icon: '▣' },
  { id: 'relationships', label: 'Links', icon: '⟷' },
  { id: 'sentiment', label: 'Sentiment', icon: '◉' },
  { id: 'financials', label: 'Fin', icon: '$' },
  { id: 'mock', label: 'Index', icon: '▦' },
  { id: 'trader', label: 'Trader', icon: '⚡' },
  { id: 'glossary', label: 'Terms', icon: 'Aa' },
];

export function BottomNav({ active, onTab }: Props) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`bottom-nav-btn ${active === t.id ? 'active' : ''}`}
          onClick={() => onTab(t.id)}
          aria-label={t.id === 'glossary' ? 'Glossary' : t.id === 'financials' ? 'Financials' : t.label}
          aria-current={active === t.id ? 'page' : undefined}
        >
          <span className="bottom-nav-icon" aria-hidden>
            {t.icon}
          </span>
          <span className="bottom-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
