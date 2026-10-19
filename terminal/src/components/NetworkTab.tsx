import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { forceX, forceY } from 'd3';
import type { AiLink, Company, Relationship, RelationType, Segment } from '../types';
import {
  ENERGY_SEGMENTS,
  isEnergySegment,
  RELATION_COLORS,
  RELATION_DASH,
  RELATION_LABELS,
  SEGMENT_COLORS,
  SEGMENT_LABELS,
} from '../data/constants';
import { displayCode, fmtPct, pctClass } from '../utils/format';

interface Props {
  companies: Company[];
  relationships: Relationship[];
}

interface GNode {
  id: string;
  name: string;
  segment: Segment;
  marketCapB: number;
  summary: string;
  isPrivate?: boolean;
  ticker?: string;
  code: string;
  change1D?: number;
  val: number;
  color: string;
  energy: boolean;
  aiLink?: AiLink;
  x?: number;
  y?: number;
}

interface GLink {
  source: string;
  target: string;
  type: RelationType;
  label: string;
  detail: string;
  color: string;
  dash: string;
}

export function NetworkTab({ companies, relationships }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<GNode | null>(null);
  const focusId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('focus') : null;
  const [selected, setSelected] = useState<GNode | null>(null);
  const [typeFilter, setTypeFilter] = useState<RelationType | 'all'>('all');
  const [legendOpen, setLegendOpen] = useState(false);
  /** Energy layer toggle: everything, AI infra only, or energy companies + the AI names they're linked to */
  const [layer, setLayer] = useState<'all' | 'core' | 'energy'>('all');
  /** Re-fit the camera once the simulation settles after a layer / filter change (not on first load). */
  const fitPending = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const onOrient = () => {
      // Defer so layout settles after rotation
      requestAnimationFrame(() => requestAnimationFrame(measure));
    };
    window.addEventListener('orientationchange', onOrient);
    window.addEventListener('resize', onOrient);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', onOrient);
      window.removeEventListener('resize', onOrient);
    };
  }, []);

  const maxCap = useMemo(
    () => Math.max(...companies.map((c) => c.marketCapB), 1),
    [companies]
  );

  const graphData = useMemo(() => {
    const nodes: GNode[] = companies.map((c) => ({
      id: c.id,
      name: c.name,
      segment: c.segment,
      marketCapB: c.marketCapB,
      summary: c.summary,
      isPrivate: c.isPrivate,
      ticker: c.ticker,
      code: displayCode(c),
      change1D: c.change1D,
      // Larger nodes + higher minimum radius for readable in-circle tickers
      val: Math.sqrt(c.marketCapB / maxCap) * 30 + 14,
      color: SEGMENT_COLORS[c.segment],
      energy: isEnergySegment(c.segment),
      aiLink: c.aiLink,
    }));
    const energyIds = new Set(nodes.filter((n) => n.energy).map((n) => n.id));
    let layerNodes = nodes;
    let layerRels = relationships;
    if (layer === 'core') {
      layerNodes = nodes.filter((n) => !n.energy);
    } else if (layer === 'energy') {
      layerRels = relationships.filter((r) => energyIds.has(r.source) || energyIds.has(r.target));
      const keep = new Set<string>(energyIds);
      layerRels.forEach((r) => {
        keep.add(r.source);
        keep.add(r.target);
      });
      layerNodes = nodes.filter((n) => keep.has(n.id));
    }
    const idSet = new Set(layerNodes.map((n) => n.id));
    const links: GLink[] = layerRels
      .filter((r) => idSet.has(r.source) && idSet.has(r.target))
      .filter((r) => typeFilter === 'all' || r.type === typeFilter)
      .map((r) => ({
        source: r.source,
        target: r.target,
        type: r.type,
        label: r.label,
        detail: r.detail,
        color: RELATION_COLORS[r.type],
        dash: RELATION_DASH[r.type],
      }));
    if (typeFilter !== 'all') {
      const linked = new Set<string>();
      links.forEach((l) => {
        linked.add(typeof l.source === 'string' ? l.source : (l.source as GNode).id);
        linked.add(typeof l.target === 'string' ? l.target : (l.target as GNode).id);
      });
      return { nodes: layerNodes.filter((n) => linked.has(n.id)), links };
    }
    return { nodes: layerNodes, links };
  }, [companies, relationships, maxCap, typeFilter, layer]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge = (fg as any).d3Force?.('charge');
    if (charge?.strength) charge.strength(-280);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const link = (fg as any).d3Force?.('link');
    if (link?.distance) link.distance(90);
    // Gentle clustering: energy layer drifts left, AI infrastructure right, so the two layers stay legible.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fg as any).d3Force?.(
      'layerX',
      layer === 'all' ? forceX<GNode>((n) => (n.energy ? -260 : 120)).strength(0.06) : forceX<GNode>(0).strength(0.05)
    );
    // Weak vertical centering keeps unlinked nodes (e.g. EQT, Vestas, Neste) from drifting off-screen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fg as any).d3Force?.('centerY', forceY<GNode>(0).strength(0.05));
    fg.d3ReheatSimulation?.();
  }, [graphData, layer]);

  const firstData = useRef(true);
  useEffect(() => {
    if (firstData.current) {
      firstData.current = false;
      return;
    }
    fitPending.current = true;
    const t = setTimeout(() => fgRef.current?.zoomToFit(500, 50), 2600);
    return () => clearTimeout(t);
  }, [layer, typeFilter]);

  useEffect(() => {
    if (!focusId) return;
    const node = graphData.nodes.find((n) => n.id === focusId);
    if (node) setSelected(node);
  }, [focusId, graphData]);

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = node.val;
      const active = hover?.id === node.id || selected?.id === node.id;
      const dimmed = !!(selected && selected.id !== node.id);

      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r + 3, 0, 2 * Math.PI);
      ctx.fillStyle = active ? 'rgba(255,213,79,0.3)' : 'rgba(0,0,0,0.4)';
      ctx.fill();

      if (node.energy) {
        // Dashed outer ring marks the energy layer
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, r + 6, 0, 2 * Math.PI);
        ctx.strokeStyle = dimmed ? 'rgba(255,171,64,0.25)' : 'rgba(255,171,64,0.9)';
        ctx.lineWidth = 1.6 / Math.max(globalScale, 0.55);
        ctx.setLineDash([4 / globalScale, 3 / globalScale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = dimmed ? 0.3 : 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = active ? '#FFD54F' : 'rgba(232,238,248,0.65)';
      ctx.lineWidth = (active ? 3 : 2.2) / Math.max(globalScale, 0.55);
      ctx.stroke();

      const inner = Math.max(r * 0.58, 10);
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, inner, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(5, 10, 20, 0.78)';
      ctx.fill();

      const fontSize = Math.min(Math.max(r * 0.42, 8 / globalScale), r * 0.55);
      ctx.font = `700 ${fontSize}px IBM Plex Mono, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#F4F7FF';
      ctx.fillText(node.code, node.x!, node.y!);

      if (globalScale > 0.9) {
        const nameSize = Math.max(9 / globalScale, 2.5);
        ctx.font = `500 ${nameSize}px IBM Plex Sans, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#A8B8D4';
        const label = node.name.length > 18 ? node.name.slice(0, 16) + '…' : node.name;
        ctx.fillText(label, node.x!, node.y! + r + 3);
      }
    },
    [hover, selected]
  );

  const paintLink = useCallback((link: GLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const s = link.source as unknown as GNode;
    const t = link.target as unknown as GNode;
    if (s?.x == null || t?.x == null) return;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y!);
    ctx.lineTo(t.x, t.y!);
    ctx.strokeStyle = link.color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.3 / globalScale;
    if (link.dash) ctx.setLineDash(link.dash.split(',').map(Number).map((n) => n / globalScale));
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, []);

  const detail = selected || hover;

  return (
    <div className="network-layout">
      <aside className={`network-sidebar ${legendOpen ? 'is-open' : 'is-collapsed'}`}>
        <button
          type="button"
          className="legend-toggle"
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
        >
          <span>Legend & Filters</span>
          <span className="legend-toggle-chevron" aria-hidden>{legendOpen ? '▾' : '▸'}</span>
        </button>
        <div className="legend-body">
        <h3>Layer</h3>
        <div className="filter-row" role="group" aria-label="Energy layer">
          {(
            [
              ['all', 'All'],
              ['core', 'Hide energy'],
              ['energy', '⚡ Energy + linked'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`chip ${layer === k ? 'on' : ''}`} onClick={() => setLayer(k)}>
              {label}
            </button>
          ))}
        </div>
        <h3>Legend — AI infrastructure</h3>
        <ul className="legend-list">
          {(Object.keys(SEGMENT_COLORS) as Segment[])
            .filter((s) => !isEnergySegment(s))
            .map((s) => (
              <li key={s}>
                <span className="swatch" style={{ background: SEGMENT_COLORS[s] }} />
                {SEGMENT_LABELS[s]}
              </li>
            ))}
        </ul>
        {layer !== 'core' && (
          <>
            <h3>Legend — Energy (dashed amber ring)</h3>
            <ul className="legend-list">
              {ENERGY_SEGMENTS.map((s) => (
                <li key={s}>
                  <span className="swatch energy-swatch" style={{ background: SEGMENT_COLORS[s] }} />
                  {SEGMENT_LABELS[s]}
                </li>
              ))}
            </ul>
          </>
        )}
        <h3>Edge Types</h3>
        <div className="filter-row">
          <button
            className={`chip ${typeFilter === 'all' ? 'on' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            All
          </button>
          {(Object.keys(RELATION_COLORS) as RelationType[]).map((t) => (
            <button
              key={t}
              className={`chip ${typeFilter === t ? 'on' : ''}`}
              style={{ borderColor: RELATION_COLORS[t] }}
              onClick={() => setTypeFilter(t)}
            >
              {RELATION_LABELS[t]}
            </button>
          ))}
        </div>
        <ul className="legend-list tight">
          {(Object.keys(RELATION_COLORS) as RelationType[]).map((t) => (
            <li key={t}>
              <span className="swatch line" style={{ background: RELATION_COLORS[t] }} />
              {RELATION_LABELS[t]}
            </li>
          ))}
        </ul>
        <p className="hint">
          Node size ∝ √ market cap (min radius raised). Energy companies carry a dashed amber ring
          and cluster on the left; amber dotted edges = power / fuel supply. <strong>Ticker / short code</strong> is
          centered inside each circle; full name on hover. Scroll to zoom · drag to pan · click for
          detail.
        </p>
        </div>
      </aside>
      <div className="network-canvas" ref={wrapRef}>
        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          nodeId="id"
          nodeVal="val"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, (node as GNode).val + 3, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkCanvasObject={paintLink}
          linkDirectionalParticles={1}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={(l) => (l as GLink).color}
          onNodeHover={(n) => setHover(n as GNode | null)}
          onNodeClick={(n) => setSelected(n as GNode)}
          onBackgroundClick={() => setSelected(null)}
          backgroundColor="#060b16"
          cooldownTicks={90}
          onEngineStop={() => {
            if (fitPending.current) {
              fitPending.current = false;
              fgRef.current?.zoomToFit(500, 50);
            }
          }}
          enableNodeDrag
        />
        {detail && (
          <div className="node-tooltip">
            <div className="tt-title">
              <span className="swatch" style={{ background: detail.color }} />
              <span className="tt-ticker">{detail.code}</span>
              {detail.name}
            </div>
            <div className="tt-meta">
              {SEGMENT_LABELS[detail.segment]} · {detail.isPrivate ? 'Est. ' : ''}
              ${detail.marketCapB.toLocaleString()}B
              {detail.isPrivate ? ' (private est.)' : ''}
              {detail.change1D != null && (
                <>
                  {' · '}
                  <span className={pctClass(detail.change1D)}>1D {fmtPct(detail.change1D)}</span>
                </>
              )}
            </div>
            <p>{detail.summary}</p>
            {detail.aiLink && (
              <p className="tt-ailink">
                <span className={`strength-pill ${detail.aiLink.strength}`}>⚡ AI link: {detail.aiLink.strength}</span>{' '}
                {detail.aiLink.summary}{' '}
                <a href={detail.aiLink.url} target="_blank" rel="noreferrer">
                  {detail.aiLink.source}, {detail.aiLink.date}
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
