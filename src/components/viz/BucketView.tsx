import { useRef } from 'react';
import type { BucketState } from '@/lib/viz/types';
import { bucketId } from '@/lib/viz/views/buckets';
import { ArrowLayer, useArrows } from './useArrows';

interface Props {
  state: BucketState;
  changed: string[];
  idPrefix: string;
}

/** Buckets array pointing into the entries array, chains via `next`, optional lookup probe. */
export default function BucketView({ state, changed, idPrefix }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const arrows = useArrows(rootRef, [state]);
  const isChanged = (id: string) => changed.includes(id);
  const probe = state.probe;
  const probeStep = (i: number) => (probe ? probe.path.indexOf(i) : -1);

  return (
    <div className="bk" ref={rootRef}>
      {probe && (
        <div className="bk-probe" role="note">
          Suche <code>{probe.key}</code>: Hash {probe.hash} → Bucket {probe.bucket}
          {probe.found !== undefined && (
            <strong>{probe.found ? ', gefunden' : ', nicht gefunden'}</strong>
          )}
        </div>
      )}
      <div className="bk-grid">
        <section aria-label="Buckets">
          <h3>buckets</h3>
          {state.buckets.length === 0 && <div className="heap-empty">noch nicht angelegt</div>}
          <ol className="bk-buckets" start={0}>
            {state.buckets.map((head, i) => {
              const target = head === null ? undefined : state.entries[head]?.id;
              return (
                <li
                  key={i}
                  className="bk-bucket"
                  data-changed={isChanged(bucketId(i))}
                  data-probe={probe?.bucket === i}
                  data-arrow-to={target}
                >
                  <span className="bk-index">[{i}]</span>
                  <span className="bk-head">{head === null ? 'leer' : `→ ${head}`}</span>
                  <span className="sr-only">
                    {head === null ? ' leer' : ` zeigt auf Eintrag ${head}`}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
        <section aria-label="Einträge">
          <h3>entries</h3>
          {state.entries.length === 0 ? (
            <div className="heap-empty">noch nicht angelegt</div>
          ) : (
            <table className="bk-entries">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">hash</th>
                  <th scope="col">key</th>
                  <th scope="col">value</th>
                  <th scope="col">next</th>
                </tr>
              </thead>
              <tbody>
                {state.entries.map((e, i) => {
                  const step = probeStep(i);
                  return (
                    <tr
                      key={e.id}
                      data-arrow-id={e.id}
                      data-changed={isChanged(e.id)}
                      data-probe={step >= 0}
                    >
                      <td className="num">{i}</td>
                      <td className="mono">{e.hash}</td>
                      <td className="mono">{e.key}</td>
                      <td className="mono">{e.value}</td>
                      <td className="mono">
                        {e.next === null ? 'keiner' : e.next}
                        {step >= 0 && <span className="sr-only"> (Suchschritt {step + 1})</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
