/** Shared helpers for view validators. */
export interface StateCheck {
  problems: string[];
  /** All element ids that `changed` may refer to. */
  ids: Set<string>;
}

/** Collects ids and reports duplicates. */
export function collectIds(
  items: { id: string }[],
  kind: string,
  at: string,
  check: StateCheck,
): void {
  for (const item of items) {
    if (check.ids.has(item.id)) check.problems.push(`${at}: duplicate ${kind} id "${item.id}"`);
    check.ids.add(item.id);
  }
}

export const newCheck = (): StateCheck => ({ problems: [], ids: new Set() });
