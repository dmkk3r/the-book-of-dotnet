import { useRef } from 'react';
import type { TimelineState } from '@/lib/viz/types';
import { ArrowLayer, useArrows } from './useArrows';

interface Props {
  state: TimelineState;
  changed: string[];
  idPrefix: string;
}

const KIND_LABEL: Record<TimelineState['items'][number]['kind'], string> = {
  run: 'läuft',
  wait: 'wartet ohne Thread',
  blocked: 'blockiert den Thread',
  continuation: 'Fortsetzung',
};

/** Threads as lanes, work items as bars over time, continuation links as arrows. */
export default function TimelineView({ state, changed, idPrefix }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const arrows = useArrows(rootRef, [state]);
  const pct = (t: number) => `${(t / state.duration) * 100}%`;
  const linksFrom = (id: string) =>
    (state.links ?? [])
      .filter((l) => l.from === id)
      .map((l) => l.to)
      .join(' ') || undefined;

  return (
    <div className="tl" ref={rootRef}>
      <ul className="tl-lanes">
        {state.lanes.map((lane) => {
          const items = state.items.filter((i) => i.lane === lane.id);
          return (
            <li key={lane.id} className="tl-lane" data-changed={changed.includes(lane.id)}>
              <span className="tl-label">{lane.label}</span>
              <div className="tl-track" style={{ ['--dur' as string]: state.duration }}>
                {items.length === 0 && <span className="sr-only">keine Arbeit</span>}
                <ul>
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="tl-item"
                      data-kind={item.kind}
                      data-changed={changed.includes(item.id)}
                      data-arrow-id={item.id}
                      data-arrow-to={linksFrom(item.id)}
                      style={{ left: pct(item.start), width: pct(item.end - item.start) }}
                      title={`${item.label} (${KIND_LABEL[item.kind]})`}
                    >
                      <span className="tl-text">{item.label}</span>
                      <span className="sr-only">
                        , {KIND_LABEL[item.kind]}, von {item.start} bis {item.end}
                      </span>
                    </li>
                  ))}
                </ul>
                {state.now !== undefined && (
                  <span className="tl-now" style={{ left: pct(state.now) }} aria-hidden="true" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="tl-axis" aria-hidden="true">
        <span>Zeit →</span>
      </div>
      <ul className="tl-legend" aria-label="Legende">
        {(['run', 'continuation', 'wait', 'blocked'] as const).map((kind) => (
          <li key={kind}>
            <i data-kind={kind} aria-hidden="true" />
            {KIND_LABEL[kind]}
          </li>
        ))}
      </ul>
      {state.output !== undefined && (
        <div className="console" aria-label="Konsolenausgabe">
          <span className="console-prompt">Konsole ›</span> {state.output}
        </div>
      )}
      <ArrowLayer arrows={arrows} idPrefix={idPrefix} />
    </div>
  );
}
