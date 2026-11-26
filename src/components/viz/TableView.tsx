import { useRef } from 'react';
import type { TableState } from '@/lib/viz/types';
import { ArrowLayer, useArrows } from './useArrows';
import { useOverflow } from './useOverflow';

interface Props {
  state: TableState;
  changed: string[];
  idPrefix: string;
}

const STATUS_LABEL = {
  active: ', wird gelesen',
  match: ', Treffer',
  miss: ', passt nicht',
  dim: '',
};

/** Tables side by side; references from a cell to a row of another table are drawn as arrows. */
export default function TableView({ state, changed, idPrefix }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflow(scrollRef, [state]);
  const arrows = useArrows(boardRef, [state]);
  const isChanged = (id: string) => changed.includes(id);
  const rowTitle = new Map(
    state.tables.flatMap((t) => t.rows.map((r) => [r.id, `${t.title}, ${r.cells[0] ?? r.id}`])),
  );

  return (
    <div className="tb">
      <div className="tb-scroll" ref={scrollRef}>
        <div className="tb-board" ref={boardRef}>
          {state.tables.map((t, i) => (
            <section
              key={t.id}
              className="tb-table"
              data-changed={isChanged(t.id)}
              style={{ gridRow: t.row ?? 1, gridColumn: t.col ?? i + 1 }}
              aria-label={t.title}
            >
              <table>
                <caption className="tb-title">{t.title}</caption>
                <thead>
                  <tr>
                    {t.columns.map((c, k) => (
                      <th key={k} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r) => (
                    <tr
                      key={r.id}
                      data-status={r.status}
                      data-changed={isChanged(r.id)}
                      data-arrow-id={r.id}
                      data-arrow-to={r.refs?.map((x) => x.to).join(' ') || undefined}
                    >
                      {r.cells.map((cell, k) => {
                        const ref = r.refs?.find((x) => x.col === k);
                        return (
                          <td key={k} data-ref={ref ? true : undefined}>
                            {cell}
                            {ref && (
                              <span className="sr-only">, verweist auf {rowTitle.get(ref.to)}</span>
                            )}
                            {k === 0 && r.status && (
                              <span className="sr-only">{STATUS_LABEL[r.status]}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {t.note && <p className="tb-note">{t.note}</p>}
            </section>
          ))}
          <ArrowLayer arrows={arrows} idPrefix={idPrefix} />
        </div>
      </div>

      {overflow && <p className="scroll-hint">Seitlich wischen, um alle Tabellen zu sehen.</p>}
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
