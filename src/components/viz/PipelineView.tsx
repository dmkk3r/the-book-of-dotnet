import Icon from '@/components/Icon';
import type { PipelineState } from '@/lib/viz/types';
import type { Tier } from '@/lib/viz/views/pipeline';

interface Props {
  state: PipelineState;
  changed: string[];
}

export const TIER_LABEL: Record<Tier, string> = {
  interpreter: 'Interpreter',
  tier0: 'Tier 0',
  'tier0-instr': 'Tier 0 (instrumentiert)',
  tier1: 'Tier 1',
  osr: 'OSR',
  r2r: 'ReadyToRun',
  aot: 'Native AOT',
};
const STATUS_LABEL = {
  pending: 'ausstehend',
  active: 'läuft',
  done: 'erledigt',
  skipped: 'übersprungen',
};

/** JIT pipeline stages, methods with their current tier, and key facts. */
export default function PipelineView({ state, changed }: Props) {
  const isChanged = (id: string) => changed.includes(id);
  return (
    <div className="pl">
      <ol className="pl-stages" aria-label="Phasen">
        {state.stages.map((stage) => (
          <li
            key={stage.id}
            className="pl-stage"
            data-status={stage.status}
            data-changed={isChanged(stage.id)}
            aria-current={stage.status === 'active' ? 'step' : undefined}
          >
            <span className="pl-stage-label">
              {stage.status === 'done' && <Icon name="check" className="pl-check" />}
              {stage.label}
            </span>
            {stage.detail && <span className="pl-stage-detail">{stage.detail}</span>}
            <span className="sr-only">, {STATUS_LABEL[stage.status]}</span>
          </li>
        ))}
      </ol>

      {(state.methods?.length ?? 0) > 0 && (
        <table className="pl-methods">
          <caption className="sr-only">Methoden und ihre aktuelle Code-Version</caption>
          <thead>
            <tr>
              <th scope="col">Methode</th>
              <th scope="col">Code-Version</th>
              <th scope="col">Aufrufe</th>
            </tr>
          </thead>
          <tbody>
            {state.methods!.map((m) => (
              <tr key={m.id} data-changed={isChanged(m.id)}>
                <td className="mono">
                  {m.name}
                  {m.note && <div className="pl-note">{m.note}</div>}
                </td>
                <td>
                  <span className="pl-tier" data-tier={m.tier}>
                    {TIER_LABEL[m.tier]}
                  </span>
                </td>
                <td className="num">{m.calls ?? 'nicht gezählt'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
