import { collectIds, newCheck, type StateCheck } from './common.ts';

export type Tier = 'interpreter' | 'tier0' | 'tier0-instr' | 'tier1' | 'osr' | 'r2r' | 'aot';

/** JIT phases and tiered compilation (chapter 7). */
export interface PipelineState {
  /** Pipeline stages in order. At most one is active. */
  stages: {
    id: string;
    label: string;
    detail?: string;
    status: 'pending' | 'active' | 'done' | 'skipped';
  }[];
  /** Methods and the code version they currently run. */
  methods?: { id: string; name: string; tier: Tier; calls?: number; note?: string }[];
  /** Key facts for the current step, e.g. "Inlining: ja". */
  facts?: { id: string; label: string; value: string }[];
  output?: string;
}

export function checkPipeline(state: PipelineState, at: string): StateCheck {
  const check = newCheck();
  if (state.stages.length === 0) check.problems.push(`${at}: pipeline has no stages`);
  collectIds(state.stages, 'stage', at, check);
  collectIds(state.methods ?? [], 'method', at, check);
  collectIds(state.facts ?? [], 'fact', at, check);
  const active = state.stages.filter((s) => s.status === 'active').length;
  if (active > 1) check.problems.push(`${at}: ${active} stages are active (max. 1)`);
  for (const m of state.methods ?? []) {
    if (m.calls !== undefined && (!Number.isInteger(m.calls) || m.calls < 0)) {
      check.problems.push(`${at}: method "${m.id}" has invalid call count ${m.calls}`);
    }
  }
  return check;
}
