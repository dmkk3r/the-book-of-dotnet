import { collectIds, newCheck, type StateCheck } from './common.ts';

export type GcRegionKind = 'gen0' | 'gen1' | 'gen2' | 'loh' | 'poh';
export type GcPhase = 'alloc' | 'mark' | 'plan' | 'relocate' | 'compact' | 'sweep' | 'done';

/** Managed heap with generations, roots, marking and compaction (chapter 4). */
export interface GcHeapState {
  regions: { id: string; kind: GcRegionKind; label?: string }[];
  /** Objects in address order within their region. */
  objects: {
    id: string;
    region: string;
    label: string;
    sizeBytes?: number;
    /** live: reachable and kept; dead: unreachable; marked: found during mark; unknown: not yet visited */
    status?: 'live' | 'dead' | 'marked' | 'unknown';
    pinned?: boolean;
    /** Object ids this object references. */
    refs?: string[];
  }[];
  /** GC roots (locals, statics, handles) and the objects they reference. */
  roots?: { id: string; label: string; refs: string[] }[];
  phase?: GcPhase;
  output?: string;
}

export function checkGcHeap(state: GcHeapState, at: string): StateCheck {
  const check = newCheck();
  collectIds(state.regions, 'region', at, check);
  const regions = new Set(state.regions.map((r) => r.id));
  collectIds(state.objects, 'object', at, check);
  const objects = new Set(state.objects.map((o) => o.id));
  collectIds(state.roots ?? [], 'root', at, check);
  for (const obj of state.objects) {
    if (!regions.has(obj.region))
      check.problems.push(`${at}: object "${obj.id}" in missing region "${obj.region}"`);
  }
  const refs = [
    ...state.objects.flatMap((o) => (o.refs ?? []).map((r) => [o.id, r] as const)),
    ...(state.roots ?? []).flatMap((root) => root.refs.map((r) => [root.id, r] as const)),
  ];
  for (const [from, to] of refs) {
    if (!objects.has(to)) check.problems.push(`${at}: "${from}" refers to missing object "${to}"`);
  }
  return check;
}
