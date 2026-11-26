import { collectIds, newCheck, type StateCheck } from './common.ts';

/**
 * Hash table with separate chaining, modeled after Dictionary<TKey, TValue>:
 * `buckets[i]` holds the index of the first entry in bucket i, entries chain via `next`.
 */
export interface BucketState {
  /** Entry index of each bucket's first entry, or null if empty. Empty array: not allocated yet. */
  buckets: (number | null)[];
  entries: {
    id: string;
    key: string;
    value: string;
    /** Hash code as shown (fictional but consistent). */
    hash: string;
    /** Bucket index this entry belongs to. */
    bucket: number;
    /** Index of the next entry in the chain, or null. */
    next: number | null;
  }[];
  /** A lookup in progress: the entries visited in order. */
  probe?: { key: string; hash: string; bucket: number; path: number[]; found?: boolean };
  output?: string;
}

/** Element id of a bucket, usable in `changed`. */
export const bucketId = (index: number) => `bucket-${index}`;

export function checkBuckets(state: BucketState, at: string): StateCheck {
  const check = newCheck();
  state.buckets.forEach((_, i) => check.ids.add(bucketId(i)));
  collectIds(state.entries, 'entry', at, check);
  const n = state.entries.length;
  const validEntry = (i: number | null) => i === null || (Number.isInteger(i) && i >= 0 && i < n);

  state.buckets.forEach((head, i) => {
    if (!validEntry(head)) {
      check.problems.push(`${at}: bucket ${i} points to missing entry ${head}`);
      return;
    }
    // Follow the chain: every entry must belong to this bucket, no cycles.
    const seen = new Set<number>();
    for (let e = head; e !== null; e = state.entries[e]?.next ?? null) {
      if (seen.has(e)) {
        check.problems.push(`${at}: cycle in chain of bucket ${i}`);
        break;
      }
      seen.add(e);
      const entry = state.entries[e];
      if (!entry) break;
      if (entry.bucket !== i)
        check.problems.push(
          `${at}: entry ${e} is chained from bucket ${i} but belongs to ${entry.bucket}`,
        );
    }
  });
  state.entries.forEach((entry, i) => {
    if (entry.bucket < 0 || entry.bucket >= state.buckets.length) {
      check.problems.push(
        `${at}: entry ${i} has bucket ${entry.bucket} outside 0 to ${state.buckets.length - 1}`,
      );
    }
    if (!validEntry(entry.next))
      check.problems.push(`${at}: entry ${i} has next ${entry.next} outside entries`);
  });
  if (state.probe) {
    const { bucket, path } = state.probe;
    if (bucket < 0 || bucket >= state.buckets.length)
      check.problems.push(`${at}: probe bucket ${bucket} invalid`);
    for (const e of path)
      if (!validEntry(e) || e === null)
        check.problems.push(`${at}: probe visits missing entry ${e}`);
  }
  return check;
}
