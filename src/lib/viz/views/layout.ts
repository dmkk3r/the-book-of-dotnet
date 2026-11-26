import { collectIds, newCheck, type StateCheck } from './common.ts';

/** Byte-exact object or struct layout including padding (chapter 3). */
export interface LayoutState {
  /** e.g. "struct S (LayoutKind.Sequential)" */
  title: string;
  /** Total size in bytes. Every byte must be covered by exactly one part. */
  totalSize: number;
  /** Bytes per visual row (default 8). */
  bytesPerRow?: 8 | 16;
  /** Parts in offset order; padding must be listed explicitly. */
  parts: {
    id: string;
    name: string;
    type?: string;
    offset: number;
    size: number;
    /** field: data; padding: unused bytes; header and methodtable: the object header and the
     * MethodTable pointer of a heap object; meta: other administrative data without a fixed
     * label (e.g. fields of a file header), shaded like a header. */
    kind: 'field' | 'padding' | 'header' | 'methodtable' | 'meta';
  }[];
  note?: string;
}

export function checkLayout(state: LayoutState, at: string): StateCheck {
  const check = newCheck();
  collectIds(state.parts, 'part', at, check);
  if (!(Number.isInteger(state.totalSize) && state.totalSize > 0)) {
    check.problems.push(`${at}: totalSize must be a positive integer`);
    return check;
  }
  let expected = 0;
  for (const part of state.parts) {
    if (!(Number.isInteger(part.size) && part.size > 0)) {
      check.problems.push(`${at}: part "${part.id}" has invalid size ${part.size}`);
    }
    if (part.offset !== expected) {
      check.problems.push(
        part.offset > expected
          ? `${at}: bytes ${expected} to ${part.offset - 1} not covered (add padding)`
          : `${at}: part "${part.id}" at ${part.offset} overlaps previous part (ends at ${expected})`,
      );
    }
    expected = Math.max(expected, part.offset + part.size);
  }
  if (expected !== state.totalSize) {
    check.problems.push(`${at}: parts cover ${expected} bytes, totalSize is ${state.totalSize}`);
  }
  return check;
}
