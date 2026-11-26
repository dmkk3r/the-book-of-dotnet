import { useRef } from 'react';
import { fieldId, type HeapObject, type MemoryState } from '@/lib/viz/types';
import { ArrowLayer, useArrows } from './useArrows';

interface Props {
  state: MemoryState;
  changed: string[];
  idPrefix: string;
}

const GEN_LABEL: Record<NonNullable<HeapObject['generation']>, string> = {
  0: 'Gen0',
  1: 'Gen1',
  2: 'Gen2',
  loh: 'LOH',
  poh: 'POH',
};

/** Stack frames with slots, heap objects with fields, and reference arrows between them. */
export default function MemoryView({ state, changed, idPrefix }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const arrows = useArrows(rootRef, [state]);
  const isChanged = (id: string) => changed.includes(id);
  const objectById = new Map(state.heap.map((o) => [o.id, o]));

  const describeRef = (ref: string) => {
    const target = objectById.get(ref);
    return target ? `, verweist auf ${target.type} bei ${target.address}` : '';
  };

  return (
    <div className="mem" ref={rootRef}>
      <section className="col-stack" aria-label="Stack">
        <h3>Stack</h3>
        {state.frames.map((frame) => (
          <div key={frame.id} className="frame">
            <div className="frame-title">Frame: {frame.method}</div>
            <ul>
              {frame.slots.map((slot) => (
                <li
                  key={slot.id}
                  className="slot"
                  data-changed={isChanged(slot.id)}
                  data-arrow-to={slot.ref}
                >
                  <span className="name">{slot.name}</span>
                  <span className="val">{slot.value}</span>
                  <span className="type">{slot.type}</span>
                  <span className="sr-only">
                    {slot.ref ? describeRef(slot.ref) : ''}
                    {isChanged(slot.id) ? ' (geändert)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="col-heap" aria-label="Heap" data-arrow-column>
        <h3>Heap</h3>
        {state.heap.length === 0 ? (
          <div className="heap-empty">Noch keine Objekte</div>
        ) : (
          state.heap.map((obj) => (
            <div
              key={obj.id}
              className="obj"
              data-arrow-id={obj.id}
              data-changed={isChanged(obj.id)}
            >
              <div className="obj-title">
                <span>{obj.type}</span>
                <span className="mono">{obj.address}</span>
              </div>
              {obj.generation !== undefined && (
                <div className="obj-gen">{GEN_LABEL[obj.generation]}</div>
              )}
              <ul>
                {obj.fields.map((field) => (
                  <li
                    key={field.name}
                    className="row"
                    data-changed={isChanged(fieldId(obj.id, field.name))}
                    data-arrow-to={field.ref}
                  >
                    <span>{field.name}</span>
                    <span>{field.value}</span>
                    {field.ref && <span className="sr-only">{describeRef(field.ref)}</span>}
                  </li>
                ))}
              </ul>
              {obj.sizeBytes !== undefined && (
                <div className="size">{obj.sizeBytes} Byte (64-Bit, inkl. Padding)</div>
              )}
            </div>
          ))
        )}
      </section>

      <div className="console" aria-label="Konsolenausgabe">
        <span className="console-prompt">Konsole ›</span> {state.output ?? ''}
      </div>

      <ArrowLayer arrows={arrows} idPrefix={idPrefix} />
    </div>
  );
}
