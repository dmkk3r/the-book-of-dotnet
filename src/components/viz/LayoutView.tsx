import type { LayoutState } from '@/lib/viz/types';

interface Props {
  state: LayoutState;
  changed: string[];
}

const KIND_LABEL = {
  field: 'Feld',
  padding: 'Padding',
  header: 'Object Header',
  methodtable: 'MethodTable-Zeiger',
  meta: '',
};

/** Byte grid with fields and padding, plus a table with offsets and sizes. */
export default function LayoutView({ state, changed }: Props) {
  const perRow = state.bytesPerRow ?? 8;
  const rows = Math.ceil(state.totalSize / perRow);

  // Split parts into per-row segments so each row is its own grid.
  const segments = Array.from({ length: rows }, (_, r) => {
    const rowStart = r * perRow;
    const rowEnd = rowStart + perRow;
    return state.parts
      .filter((p) => p.offset < rowEnd && p.offset + p.size > rowStart)
      .map((p) => {
        const start = Math.max(p.offset, rowStart);
        const end = Math.min(p.offset + p.size, rowEnd);
        return { part: p, col: start - rowStart + 1, span: end - start, first: start === p.offset };
      });
  });

  return (
    <div className="ly">
      <p className="ly-title mono">{state.title}</p>
      <div className="ly-bytes" aria-hidden="true">
        <div
          className="ly-row ly-ruler"
          style={{ gridTemplateColumns: `4ch repeat(${perRow}, minmax(0, 1fr))` }}
        >
          <span />
          {Array.from({ length: perRow }, (_, i) => (
            <span key={i}>{i}</span>
          ))}
        </div>
        {segments.map((segs, r) => (
          <div
            key={r}
            className="ly-row"
            style={{ gridTemplateColumns: `4ch repeat(${perRow}, minmax(0, 1fr))` }}
          >
            <span className="ly-offset">+{r * perRow}</span>
            {segs.map(({ part, col, span, first }) => (
              <span
                key={part.id + col}
                className="ly-seg"
                data-kind={part.kind}
                data-changed={changed.includes(part.id)}
                style={{ gridColumn: `${col + 1} / span ${span}` }}
                title={`${part.name}: Offset ${part.offset}, ${part.size} Byte`}
              >
                {first || span === perRow ? part.name : ''}
              </span>
            ))}
          </div>
        ))}
      </div>
      <table className="ly-table">
        <caption className="sr-only">Layout: {state.title}</caption>
        <thead>
          <tr>
            <th scope="col">Offset</th>
            <th scope="col">Größe</th>
            <th scope="col">Teil</th>
            <th scope="col">Typ</th>
          </tr>
        </thead>
        <tbody>
          {state.parts.map((p) => (
            <tr key={p.id} data-kind={p.kind} data-changed={changed.includes(p.id)}>
              <td className="num">{p.offset}</td>
              <td className="num">{p.size} B</td>
              <td>
                {p.name}
                {KIND_LABEL[p.kind] && p.kind !== 'field' && p.name !== KIND_LABEL[p.kind] && (
                  <span className="ly-kind"> ({KIND_LABEL[p.kind]})</span>
                )}
              </td>
              <td className="mono">{p.type ?? ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>
              Gesamt: <strong>{state.totalSize} Byte</strong> (64-Bit)
            </td>
          </tr>
        </tfoot>
      </table>
      {state.note && <p className="ly-note">{state.note}</p>}
    </div>
  );
}
