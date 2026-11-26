import { CODE_TABS, type StepScript, type ViewName, type ViewStates } from './types.ts';
import { checkBuckets } from './views/buckets.ts';
import type { StateCheck } from './views/common.ts';
import { checkGcHeap } from './views/gcheap.ts';
import { checkGraph } from './views/graph.ts';
import { checkLayout } from './views/layout.ts';
import { checkMemory } from './views/memory.ts';
import { checkPipeline } from './views/pipeline.ts';
import { checkTable } from './views/table.ts';
import { checkTimeline } from './views/timeline.ts';

const CHECKS: { [V in ViewName]: (state: ViewStates[V], at: string) => StateCheck } = {
  memory: checkMemory,
  timeline: checkTimeline,
  gcheap: checkGcHeap,
  pipeline: checkPipeline,
  buckets: checkBuckets,
  layout: checkLayout,
  graph: checkGraph,
  table: checkTable,
};

const lineCount = (code: string | undefined) => (code === undefined ? 0 : code.split('\n').length);

/** Checks a step script for consistency. Returns human-readable problems. */
export function validateStepScript(script: StepScript): string[] {
  const problems: string[] = [];
  const check = CHECKS[script.view] as (state: unknown, at: string) => StateCheck;
  if (!check) return [`unknown view "${script.view}"`];
  if (script.steps.length === 0) problems.push('script has no steps');

  script.steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    const csLines = lineCount(script.code.cs);
    if (step.codeLine !== undefined && (step.codeLine < 1 || step.codeLine > csLines)) {
      problems.push(`${at}: codeLine ${step.codeLine} outside C# code (1 to ${csLines})`);
    }
    for (const tab of CODE_TABS) {
      if (tab === 'cs') continue;
      const lines = step.highlight?.[tab];
      if (!lines) continue;
      const max = lineCount(script.code[tab]);
      if (max === 0) problems.push(`${at}: highlights tab "${tab}" which has no code`);
      for (const line of lines) {
        if (line < 1 || line > max)
          problems.push(`${at}: ${tab} line ${line} outside code (1 to ${max})`);
      }
    }
    if (step.explanation.trim() === '') problems.push(`${at}: empty explanation`);

    const state = check(step.state, at);
    problems.push(...state.problems);
    for (const id of step.changed ?? []) {
      if (!state.ids.has(id)) problems.push(`${at}: changed id "${id}" does not exist`);
    }
  });
  return problems;
}
