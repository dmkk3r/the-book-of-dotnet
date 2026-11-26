import { collectIds, newCheck, type StateCheck } from './common.ts';

/** Threads, tasks and continuations over time (chapters 10 and 11). */
export interface TimelineState {
  /** Rows: one per thread (or logical executor). */
  lanes: { id: string; label: string; kind?: 'main' | 'pool' | 'ui' | 'io' }[];
  /** Length of the time axis in abstract units. */
  duration: number;
  /** Work on a lane between start and end (start < end, within 0..duration). */
  items: {
    id: string;
    lane: string;
    start: number;
    end: number;
    label: string;
    /** run: executes code; wait: waits without a thread; blocked: blocks its thread; continuation: code after an await */
    kind: 'run' | 'wait' | 'blocked' | 'continuation';
  }[];
  /** "Continues as" edges between items, e.g. await -> continuation. */
  links?: { from: string; to: string }[];
  /** Current time marker. */
  now?: number;
  output?: string;
}

export function checkTimeline(state: TimelineState, at: string): StateCheck {
  const check = newCheck();
  if (!(state.duration > 0)) check.problems.push(`${at}: duration must be positive`);
  collectIds(state.lanes, 'lane', at, check);
  const lanes = new Set(state.lanes.map((l) => l.id));
  collectIds(state.items, 'item', at, check);
  const items = new Set(state.items.map((i) => i.id));
  for (const item of state.items) {
    if (!lanes.has(item.lane))
      check.problems.push(`${at}: item "${item.id}" on missing lane "${item.lane}"`);
    if (!(item.start >= 0 && item.start < item.end && item.end <= state.duration)) {
      check.problems.push(
        `${at}: item "${item.id}" has invalid range ${item.start} to ${item.end}`,
      );
    }
  }
  for (const link of state.links ?? []) {
    for (const end of [link.from, link.to]) {
      if (!items.has(end)) check.problems.push(`${at}: link refers to missing item "${end}"`);
    }
  }
  if (state.now !== undefined && (state.now < 0 || state.now > state.duration)) {
    check.problems.push(`${at}: now ${state.now} outside 0 to ${state.duration}`);
  }
  return check;
}
