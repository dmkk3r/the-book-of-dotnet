import { useRef } from 'react';
import type { GcHeapState } from '@/lib/viz/types';
import type { GcPhase, GcRegionKind } from '@/lib/viz/views/gcheap';
import { ArrowLayer, useArrows } from './useArrows';

interface Props {
  state: GcHeapState;
  changed: string[];
  idPrefix: string;
}

const REGION_LABEL: Record<GcRegionKind, string> = {
  gen0: 'Gen0',
  gen1: 'Gen1',
  gen2: 'Gen2',
  loh: 'LOH',
  poh: 'POH',
};
const PHASES: { id: GcPhase; label: string }[] = [
  { id: 'alloc', label: 'Allokieren' },
  { id: 'mark', label: 'Markieren' },
  { id: 'plan', label: 'Planen' },
  { id: 'relocate', label: 'Verweise anpassen' },
  { id: 'compact', label: 'Kompaktieren' },
  { id: 'sweep', label: 'Freigeben' },
  { id: 'done', label: 'Fertig' },
];
const STATUS_LABEL = { live: 'lebt', dead: 'tot', marked: 'markiert', unknown: '' } as const;

/** Generations/regions with objects, GC roots and references, plus the current GC phase. */
export default function GcHeapView({ state, changed, idPrefix }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const arrows = useArrows(rootRef, [state]);
  const isChanged = (id: string) => changed.includes(id);

  return (
    <div className="gc" ref={rootRef}>
      {state.phase && (
        <ol className="gc-phases" aria-label="GC-Phase">
          {PHASES.map((p) => (
            <li key={p.id} aria-current={p.id === state.phase ? 'step' : undefined}>
              {p.label}
            </li>
          ))}
        </ol>
      )}
      <div className="gc-grid">
        {(state.roots?.length ?? 0) > 0 && (
          <section className="gc-roots" aria-label="GC-Roots">
            <h3>Roots</h3>
            <ul>
              {state.roots!.map((root) => (
                <li
                  key={root.id}
                  className="gc-root"
                  data-changed={isChanged(root.id)}
                  data-arrow-to={root.refs.join(' ') || undefined}
                >
                  {root.label}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="gc-regions" aria-label="Heap" data-arrow-column>
          <h3>Heap</h3>
          {state.regions.map((region) => {
            const objects = state.objects.filter((o) => o.region === region.id);
            return (
              <div key={region.id} className="gc-region" data-changed={isChanged(region.id)}>
                <div className="gc-region-title">{region.label ?? REGION_LABEL[region.kind]}</div>
                {objects.length === 0 ? (
                  <div className="gc-empty">leer</div>
                ) : (
                  <ul>
                    {objects.map((obj) => {
                      const status = obj.status ?? 'unknown';
                      return (
                        <li
                          key={obj.id}
                          className="gc-obj"
                          data-status={status}
                          data-changed={isChanged(obj.id)}
                          data-arrow-id={obj.id}
                          data-arrow-enter="top"
                          data-arrow-to={obj.refs?.join(' ') || undefined}
                        >
                          <span className="gc-obj-label">{obj.label}</span>
                          {obj.sizeBytes !== undefined && (
                            <span className="gc-obj-size">{obj.sizeBytes} B</span>
                          )}
                          {(STATUS_LABEL[status] || obj.pinned) && (
                            <span className="gc-badges">
                              {STATUS_LABEL[status] && (
                                <span className="gc-badge">{STATUS_LABEL[status]}</span>
                              )}
                              {obj.pinned && <span className="gc-badge">fixiert</span>}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      </div>
      {state.output !== undefined && (
        <div className="console" aria-label="Konsolenausgabe">
          <span className="console-prompt">Konsole ›</span> {state.output}
        </div>
      )}
      <ArrowLayer arrows={arrows} idPrefix={idPrefix} />
    </div>
  );
}
