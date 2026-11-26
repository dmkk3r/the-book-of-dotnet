import { collectIds, newCheck, type StateCheck } from './common.ts';

export type GraphNodeStatus = 'pending' | 'active' | 'done' | 'rejected' | 'skipped';
export type GraphEdgeStatus = 'idle' | 'taken' | 'rejected';

/**
 * Decisions, flows and state machines (e.g. framework resolution, binding, type load,
 * the lifecycle of a region). Nodes sit on a fixed grid, edges are routed orthogonally
 * through the gaps between rows and columns.
 */
export interface GraphState {
  /** Optional caption above the graph. */
  title?: string;
  nodes: {
    id: string;
    label: string;
    detail?: string;
    /** 1-based grid row and column. Two nodes must not share a cell. */
    row: number;
    col: number;
    /** step (default): action; decision: a question with several outcomes; state: a state of a
     * state machine; end: a final result. */
    shape?: 'step' | 'decision' | 'state' | 'end';
    /** pending: not reached yet; active: current (max. one); done: passed; rejected: checked
     * and ruled out; skipped: not taken in this run. */
    status: GraphNodeStatus;
  }[];
  edges: {
    /** Defaults to "<from>-><to>". */
    id?: string;
    from: string;
    to: string;
    /** Short condition, e.g. "ja", "nicht gefunden". */
    label?: string;
    /** taken: part of the path in this run; rejected: ruled out. */
    status?: GraphEdgeStatus;
  }[];
  /** Key facts for the current step, e.g. "Angefordert: 8.0.0". */
  facts?: { id: string; label: string; value: string }[];
  output?: string;
}

export const edgeId = (e: GraphState['edges'][number]) => e.id ?? `${e.from}->${e.to}`;

export function checkGraph(state: GraphState, at: string): StateCheck {
  const check = newCheck();
  if (state.nodes.length === 0) check.problems.push(`${at}: graph has no nodes`);
  collectIds(state.nodes, 'node', at, check);
  collectIds(
    state.edges.map((e) => ({ id: edgeId(e) })),
    'edge',
    at,
    check,
  );
  collectIds(state.facts ?? [], 'fact', at, check);

  const cells = new Map<string, string>();
  for (const n of state.nodes) {
    if (!(Number.isInteger(n.row) && n.row >= 1 && Number.isInteger(n.col) && n.col >= 1)) {
      check.problems.push(`${at}: node "${n.id}" has invalid position ${n.row}/${n.col}`);
      continue;
    }
    const cell = `${n.row}/${n.col}`;
    const other = cells.get(cell);
    if (other) check.problems.push(`${at}: nodes "${other}" and "${n.id}" share cell ${cell}`);
    cells.set(cell, n.id);
  }
  const active = state.nodes.filter((n) => n.status === 'active').length;
  if (active > 1) check.problems.push(`${at}: ${active} nodes are active (max. 1)`);

  const nodeIds = new Set(state.nodes.map((n) => n.id));
  for (const e of state.edges) {
    for (const end of [e.from, e.to]) {
      if (!nodeIds.has(end))
        check.problems.push(`${at}: edge "${edgeId(e)}" to missing node "${end}"`);
    }
    if (e.from === e.to) check.problems.push(`${at}: edge "${edgeId(e)}" is a self loop`);
  }
  return check;
}
