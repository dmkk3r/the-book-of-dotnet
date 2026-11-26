import { collectIds, newCheck, type StateCheck } from './common.ts';

export type TableRowStatus = 'active' | 'match' | 'miss' | 'dim';

/**
 * Tables whose rows point to rows of other tables (e.g. metadata tables: a token selects a
 * MemberRef row, which points to a TypeRef row, which points to an AssemblyRef row).
 */
export interface TableState {
  tables: {
    id: string;
    /** e.g. "MemberRef (0x0A)" */
    title: string;
    columns: string[];
    rows: {
      id: string;
      /** One entry per column. */
      cells: string[];
      /** active: being read now; match: the row that was looked for; miss: checked, does not
       * match; dim: irrelevant in this step. */
      status?: TableRowStatus;
      /** References from a cell (0-based column index) to a row of another table (arrows). */
      refs?: { col: number; to: string }[];
    }[];
    /** 1-based grid position. Default: next column in row 1. */
    row?: number;
    col?: number;
    note?: string;
  }[];
  facts?: { id: string; label: string; value: string }[];
  output?: string;
}

export function checkTable(state: TableState, at: string): StateCheck {
  const check = newCheck();
  if (state.tables.length === 0) check.problems.push(`${at}: no tables`);
  collectIds(state.tables, 'table', at, check);
  const rows = state.tables.flatMap((t) => t.rows.map((r) => ({ ...r, table: t })));
  collectIds(rows, 'row', at, check);
  collectIds(state.facts ?? [], 'fact', at, check);

  const rowIds = new Set(rows.map((r) => r.id));
  const cells = new Map<string, string>();
  state.tables.forEach((t, i) => {
    const row = t.row ?? 1;
    const col = t.col ?? i + 1;
    if (!(Number.isInteger(row) && row >= 1 && Number.isInteger(col) && col >= 1)) {
      check.problems.push(`${at}: table "${t.id}" has invalid position ${row}/${col}`);
    } else {
      const other = cells.get(`${row}/${col}`);
      if (other)
        check.problems.push(`${at}: tables "${other}" and "${t.id}" share cell ${row}/${col}`);
      cells.set(`${row}/${col}`, t.id);
    }
    if (t.columns.length === 0) check.problems.push(`${at}: table "${t.id}" has no columns`);
  });
  for (const r of rows) {
    if (r.cells.length !== r.table.columns.length) {
      check.problems.push(
        `${at}: row "${r.id}" has ${r.cells.length} cells, table "${r.table.id}" has ${r.table.columns.length} columns`,
      );
    }
    for (const ref of r.refs ?? []) {
      if (!rowIds.has(ref.to))
        check.problems.push(`${at}: row "${r.id}" refers to missing row "${ref.to}"`);
      if (r.table.rows.some((x) => x.id === ref.to)) {
        check.problems.push(`${at}: row "${r.id}" refers to "${ref.to}" in the same table`);
      }
      if (!(Number.isInteger(ref.col) && ref.col >= 0 && ref.col < r.table.columns.length)) {
        check.problems.push(`${at}: row "${r.id}" has a reference in invalid column ${ref.col}`);
      }
    }
  }
  return check;
}
