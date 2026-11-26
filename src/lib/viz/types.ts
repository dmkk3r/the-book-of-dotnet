/**
 * Step data for visualizations. The StepPlayer is generic; each view defines its own
 * state format (src/lib/viz/views/).
 */

import type { BucketState } from './views/buckets.ts';
import type { GcHeapState } from './views/gcheap.ts';
import type { GraphState } from './views/graph.ts';
import type { LayoutState } from './views/layout.ts';
import type { PipelineState } from './views/pipeline.ts';
import type { TableState } from './views/table.ts';
import type { TimelineState } from './views/timeline.ts';

export type {
  BucketState,
  GcHeapState,
  GraphState,
  LayoutState,
  PipelineState,
  TableState,
  TimelineState,
};

export type CodeTab = 'cs' | 'il' | 'lowered' | 'asm';
export const CODE_TABS: readonly CodeTab[] = ['cs', 'il', 'lowered', 'asm'];
export const CODE_TAB_LABELS: Record<CodeTab, string> = {
  cs: 'C#',
  il: 'IL',
  lowered: 'Gelowert',
  asm: 'Assembler',
};

export interface Step<TState> {
  /** 1-based line in the C# tab. */
  codeLine?: number;
  /** 1-based lines in the other tabs. */
  highlight?: Partial<Record<Exclude<CodeTab, 'cs'>, number[]>>;
  state: TState;
  /** Ids of elements that changed in this step (highlighted). */
  changed?: string[];
  /** Short inline Markdown: **bold**, *italic*, `code`. Max. three sentences. */
  explanation: string;
}

// ---- MemoryView ----------------------------------------------------------

export interface MemorySlot {
  id: string;
  name: string;
  type: string;
  value: string;
  /** Id of the heap object this slot points to. */
  ref?: string;
}

export interface MemoryFrame {
  id: string;
  method: string;
  slots: MemorySlot[];
}

export interface HeapField {
  name: string;
  value: string;
  ref?: string;
}

export interface HeapObject {
  id: string;
  type: string;
  address: string;
  generation?: 0 | 1 | 2 | 'loh' | 'poh';
  fields: HeapField[];
  /** Total size on 64-bit, including header and padding. */
  sizeBytes?: number;
}

export interface MemoryState {
  frames: MemoryFrame[];
  heap: HeapObject[];
  output?: string;
}

/** Element id of a heap field, usable in `changed`. */
export const fieldId = (objectId: string, fieldName: string) => `${objectId}.${fieldName}`;

// ---- Scripts ---------------------------------------------------------------

/** Maps view names to their state type. Each view lives in src/lib/viz/views/. */
export interface ViewStates {
  memory: MemoryState;
  timeline: TimelineState;
  gcheap: GcHeapState;
  pipeline: PipelineState;
  buckets: BucketState;
  layout: LayoutState;
  graph: GraphState;
  table: TableState;
}
export type ViewName = keyof ViewStates;

export interface StepScript<V extends ViewName = ViewName> {
  view: V;
  /** Short accessible name, e.g. "Boxing Schritt für Schritt". */
  title: string;
  /** side (default): code next to the view; stacked: view below the code in full width. */
  layout?: 'side' | 'stacked';
  code: Partial<Record<CodeTab, string>> & { cs: string };
  steps: Step<ViewStates[V]>[];
}

/** Identity helper that gives full type checking for step files. */
export function defineStepScript<V extends ViewName>(script: StepScript<V>): StepScript<V> {
  return script;
}
