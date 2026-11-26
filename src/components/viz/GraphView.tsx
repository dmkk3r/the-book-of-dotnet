import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { routeGraph, type RoutedEdge } from '@/lib/viz/route-graph';
import type { GraphState } from '@/lib/viz/types';
import { edgeId } from '@/lib/viz/views/graph';
import { useOverflow } from './useOverflow';
import Icon from '@/components/Icon';

interface Props {
  state: GraphState;
  changed: string[];
  idPrefix: string;
}

const STATUS_LABEL = {
  pending: 'noch nicht erreicht',
  active: 'aktuell',
  done: 'durchlaufen',
  rejected: 'verworfen',
  skipped: 'nicht genommen',
};
const EDGE_LABEL = { idle: '', taken: ', genommen', rejected: ', verworfen' };
const SHAPE_LABEL = { step: '', decision: 'Entscheidung: ', state: 'Zustand: ', end: 'Ergebnis: ' };

/**
 * Long identifiers (e.g. FileNotFoundException) get break opportunities at word boundaries
 * inside the name, so that narrow nodes wrap them sensibly instead of at an arbitrary letter.
 */
function softBreaks(text: string): ReactNode {
  return text.split(/(\s+)/).map((word, i) => {
    if (word.length <= 14) return word;
    const parts = word.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[._/])/);
    return parts.flatMap((part, k) => (k === 0 ? [part] : [<wbr key={`${i}-${k}`} />, part]));
  });
}

/** Flow, decision or state graph on a fixed grid with orthogonally routed edges. */
export default function GraphView({ state, changed, idPrefix }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflow(scrollRef, [state]);
  const [routes, setRoutes] = useState<RoutedEdge[]>([]);
  const isChanged = (id: string) => changed.includes(id);
  const maxCol = Math.max(...state.nodes.map((n) => n.col));
  const label = (id: string) => state.nodes.find((n) => n.id === id)?.label ?? id;

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const origin = board.getBoundingClientRect();
    const nodes = state.nodes.flatMap((n) => {
      const el = board.querySelector<HTMLElement>(`[data-node="${CSS.escape(n.id)}"]`);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [
        {
          id: n.id,
          row: n.row,
          col: n.col,
          box: {
            left: r.left - origin.left,
            top: r.top - origin.top,
            right: r.right - origin.left,
            bottom: r.bottom - origin.top,
          },
        },
      ];
    });
    const next = routeGraph(nodes, state.edges);
    setRoutes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [state]);

  useLayoutEffect(() => measure(), [measure]);
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const marker = (status: string) => `${idPrefix}-gr-${status}`;

  return (
    <div className="gr">
      {state.title && <p className="viz-label">{state.title}</p>}
      <div className="gr-scroll" ref={scrollRef}>
        <div
          className="gr-board"
          ref={boardRef}
          style={{
            gridTemplateColumns: `repeat(${maxCol}, minmax(0, 1fr))`,
            minWidth: `${maxCol * 120 + (maxCol - 1) * 72}px`,
          }}
        >
          {state.nodes.map((n) => (
            <div
              key={n.id}
              className="gr-node"
              data-node={n.id}
              data-shape={n.shape ?? 'step'}
              data-status={n.status}
              data-changed={isChanged(n.id)}
              aria-current={n.status === 'active' ? 'step' : undefined}
              style={{ gridRow: n.row, gridColumn: n.col }}
            >
              <span className="gr-node-label">
                <span className="sr-only">{SHAPE_LABEL[n.shape ?? 'step']}</span>
                {n.shape === 'decision' && <Icon name="decision" className="gr-decision" />}
                {n.status === 'done' || n.status === 'rejected' ? (
                  <>
                    {softBreaks(n.label.replace(/\S+$/, ''))}
                    {/* keep the mark together with the last word */}
                    <span className="gr-nowrap">
                      {n.label.match(/\S+$/)?.[0]}
                      <Icon name={n.status === 'done' ? 'check' : 'dismiss'} className="gr-mark" />
                    </span>
                  </>
                ) : (
                  softBreaks(n.label)
                )}
              </span>
              {n.detail && <span className="gr-node-detail">{softBreaks(n.detail)}</span>}
              <span className="sr-only">, {STATUS_LABEL[n.status]}</span>
            </div>
          ))}
          <svg className="gr-edges" aria-hidden="true">
            <defs>
              {(['idle', 'taken', 'rejected'] as const).map((s) => (
                <marker
                  key={s}
                  id={marker(s)}
                  className={`gr-marker-${s}`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="8"
                  markerHeight="8"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0 0.5L7.5 4L0 7.5z" />
                </marker>
              ))}
            </defs>
            {state.edges.map((e, i) => {
              const r = routes[i];
              if (!r?.d) return null;
              const status = e.status ?? 'idle';
              return (
                <path
                  key={edgeId(e)}
                  d={r.d}
                  className="gr-edge"
                  data-status={status}
                  data-changed={isChanged(edgeId(e))}
                  markerEnd={`url(#${marker(status)})`}
                />
              );
            })}
          </svg>
          {state.edges.map((e, i) => {
            const r = routes[i];
            if (!e.label || !r?.d) return null;
            return (
              <span
                key={edgeId(e)}
                className="gr-edge-label"
                data-status={e.status ?? 'idle'}
                data-horizontal={r.labelHorizontal}
                aria-hidden="true"
                style={{ left: r.label.x, top: r.label.y }}
              >
                {e.label}
              </span>
            );
          })}
        </div>
      </div>
      {overflow && <p className="scroll-hint">Seitlich wischen, um die ganze Grafik zu sehen.</p>}
      <ul className="sr-only" aria-label="Übergänge">
        {state.edges.map((e) => (
          <li key={edgeId(e)}>
            {label(e.from)} nach {label(e.to)}
            {e.label ? ` (${e.label})` : ''}
            {EDGE_LABEL[e.status ?? 'idle']}
          </li>
        ))}
      </ul>

      {(state.facts?.length ?? 0) > 0 && (
        <dl className="pl-facts">
          {state.facts!.map((f) => (
            <div key={f.id} data-changed={isChanged(f.id)}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {state.output !== undefined && (
        <div className="console" aria-label="Konsolenausgabe">
          <span className="console-prompt">Konsole ›</span> {state.output}
        </div>
      )}
    </div>
  );
}
