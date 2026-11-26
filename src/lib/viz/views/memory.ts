import { fieldId, type MemoryState } from '../types.ts';
import { collectIds, newCheck, type StateCheck } from './common.ts';

export function checkMemory(state: MemoryState, at: string): StateCheck {
  const check = newCheck();
  collectIds(state.heap, 'heap object', at, check);
  const heapIds = new Set(state.heap.map((o) => o.id));
  for (const obj of state.heap) for (const f of obj.fields) check.ids.add(fieldId(obj.id, f.name));
  collectIds(state.frames, 'frame', at, check);
  for (const frame of state.frames) collectIds(frame.slots, 'element', at, check);

  const refs = [
    ...state.frames.flatMap((f) => f.slots.map((s) => [s.id, s.ref] as const)),
    ...state.heap.flatMap((o) => o.fields.map((f) => [fieldId(o.id, f.name), f.ref] as const)),
  ];
  for (const [from, ref] of refs) {
    if (ref !== undefined && !heapIds.has(ref)) {
      check.problems.push(`${at}: "${from}" refers to missing heap object "${ref}"`);
    }
  }
  return check;
}
