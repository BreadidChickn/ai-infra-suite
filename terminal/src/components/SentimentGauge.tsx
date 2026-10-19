interface Props {
  score: number; // -100 to 100
  label?: string;
  size?: number;
}

export function SentimentGauge({ score, label = 'Market Sentiment', size = 160 }: Props) {
  const clamped = Math.max(-100, Math.min(100, score));
  const angle = ((clamped + 100) / 200) * 180; // 0..180
  const color = clamped > 20 ? '#00E676' : clamped < -20 ? '#EF5350' : '#FFD54F';
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2 + 10;

  const polar = (deg: number, radius: number) => {
    const rad = ((180 - deg) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
  };

  const start = polar(0, r);
  const end = polar(180, r);
  const needle = polar(angle, r - 18);

  return (
    <div className="gauge-wrap" style={{ width: size }}>
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.72}`}>
        <path
          d={`M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`}
          fill="none"
          stroke="#1a2744"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d={`M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth={10}
          strokeLinecap="round"
          opacity={0.85}
        />
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#EF5350" />
            <stop offset="50%" stopColor="#FFD54F" />
            <stop offset="100%" stopColor="#00E676" />
          </linearGradient>
        </defs>
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth={2.5} />
        <circle cx={cx} cy={cy} r={5} fill={color} />
        <text x={cx} y={cy - 28} textAnchor="middle" fill={color} fontSize={22} fontFamily="IBM Plex Mono, monospace" fontWeight={600}>
          {clamped > 0 ? '+' : ''}
          {Math.round(clamped)}
        </text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
