/**
 * Orthogonal edge routing for nodes on a grid (GraphView).
 *
 * Edges never cross a node: they either connect direct neighbours with a straight line or run
 * through the gaps between rows and columns, each in its own track. Several edges on one side
 * of a node get separate ports, ordered by where they are heading, to avoid needless crossings.
 */
import { roundedPath, type Box, type Point } from './route-arrows.ts';

export interface GridNode {
  id: string;
  row: number;
  col: number;
  box: Box;
}

export interface GridEdge {
  from: string;
  to: string;
}

export interface RoutedEdge {
  d: string;
  /** Where to put the label: middle of the longest segment. */
  label: Point;
  /** True if the label sits on a horizontal segment (place it above the line). */
  labelHorizontal: boolean;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

const OUTER = 28; // usable space outside the outermost rows and columns
const BIDI = 5; // offset of the two lines of a bidirectional straight connection

interface Band {
  lo: number;
  hi: number;
}

interface Port {
  key: string; // node:side
  sortBy: () => number;
  set: (v: number) => void;
}

interface Track {
  key: string; // gutter id
  span: () => [number, number];
  set: (v: number) => void;
}

export function routeGraph(nodes: GridNode[], edges: GridEdge[]): RoutedEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rows = [...new Set(nodes.map((n) => n.row))].sort((a, b) => a - b);
  const cols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
  const rowBand = rows.map((r) => {
    const ns = nodes.filter((n) => n.row === r);
    return {
      lo: Math.min(...ns.map((n) => n.box.top)),
      hi: Math.max(...ns.map((n) => n.box.bottom)),
    };
  });
  const colBand = cols.map((c) => {
    const ns = nodes.filter((n) => n.col === c);
    return {
      lo: Math.min(...ns.map((n) => n.box.left)),
      hi: Math.max(...ns.map((n) => n.box.right)),
    };
  });
  /** Gutter after band i (i = -1: before the first band). */
  const gutter = (bands: Band[], i: number): Band => {
    if (i < 0) return { lo: bands[0]!.lo - OUTER, hi: bands[0]!.lo };
    if (i >= bands.length - 1)
      return { lo: bands[bands.length - 1]!.hi, hi: bands[bands.length - 1]!.hi + OUTER };
    return { lo: bands[i]!.hi, hi: bands[i + 1]!.lo };
  };
  const ri = (n: GridNode) => rows.indexOf(n.row);
  const ci = (n: GridNode) => cols.indexOf(n.col);
  const cx = (b: Box) => (b.left + b.right) / 2;
  const cy = (b: Box) => (b.top + b.bottom) / 2;

  const pairs = new Set(edges.map((e) => `${e.from}|${e.to}`));
  const ports: Port[] = [];
  const tracks: Track[] = [];
  const builders: (() => Point[])[] = [];

  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) {
      builders.push(() => []);
      continue;
    }
    const dr = ri(b) - ri(a);
    const dc = ci(b) - ci(a);
    const bidi = pairs.has(`${e.to}|${e.from}`) ? (e.from < e.to ? -BIDI : BIDI) : 0;

    if (dr === 0 && Math.abs(dc) === 1) {
      // Straight horizontal line between neighbours.
      const y = (Math.max(a.box.top, b.box.top) + Math.min(a.box.bottom, b.box.bottom)) / 2 + bidi;
      const right = dc > 0;
      builders.push(() => [
        { x: right ? a.box.right : a.box.left, y },
        { x: right ? b.box.left : b.box.right, y },
      ]);
      continue;
    }
    if (dc === 0 && Math.abs(dr) === 1) {
      const x = (Math.max(a.box.left, b.box.left) + Math.min(a.box.right, b.box.right)) / 2 + bidi;
      const down = dr > 0;
      builders.push(() => [
        { x, y: down ? a.box.bottom : a.box.top },
        { x, y: down ? b.box.top : b.box.bottom },
      ]);
      continue;
    }

    // Everything else runs through gutters. Ports and tracks are filled in later.
    const p = { ax: 0, ay: 0, bx: 0, by: 0, t1: 0, t2: 0 };
    const port = (n: GridNode, side: Side, other: () => number, set: (v: number) => void) =>
      ports.push({ key: `${n.id}:${side}`, sortBy: other, set });

    if (dr === 0) {
      // Same row, not adjacent: underneath the row.
      const g = `h:${ri(a)}`;
      port(
        a,
        'bottom',
        () => cx(b.box),
        (v) => (p.ax = v),
      );
      port(
        b,
        'bottom',
        () => cx(a.box),
        (v) => (p.bx = v),
      );
      tracks.push({
        key: g,
        span: () => [Math.min(p.ax, p.bx), Math.max(p.ax, p.bx)],
        set: (v) => (p.t1 = v),
      });
      builders.push(() => [
        { x: p.ax, y: a.box.bottom },
        { x: p.ax, y: p.t1 },
        { x: p.bx, y: p.t1 },
        { x: p.bx, y: b.box.bottom },
      ]);
    } else if (dc === 0) {
      // Same column, not adjacent: along the right side of the column.
      const g = `v:${ci(a)}`;
      port(
        a,
        'right',
        () => cy(b.box),
        (v) => (p.ay = v),
      );
      port(
        b,
        'right',
        () => cy(a.box),
        (v) => (p.by = v),
      );
      tracks.push({
        key: g,
        span: () => [Math.min(p.ay, p.by), Math.max(p.ay, p.by)],
        set: (v) => (p.t1 = v),
      });
      builders.push(() => [
        { x: a.box.right, y: p.ay },
        { x: p.t1, y: p.ay },
        { x: p.t1, y: p.by },
        { x: b.box.right, y: p.by },
      ]);
    } else if (Math.abs(dr) === 1) {
      // Neighbouring rows: through the gap between them.
      const down = dr > 0;
      const g = `h:${down ? ri(a) : ri(b)}`;
      port(
        a,
        down ? 'bottom' : 'top',
        () => cx(b.box),
        (v) => (p.ax = v),
      );
      port(
        b,
        down ? 'top' : 'bottom',
        () => cx(a.box),
        (v) => (p.bx = v),
      );
      tracks.push({
        key: g,
        span: () => [Math.min(p.ax, p.bx), Math.max(p.ax, p.bx)],
        set: (v) => (p.t1 = v),
      });
      builders.push(() => [
        { x: p.ax, y: down ? a.box.bottom : a.box.top },
        { x: p.ax, y: p.t1 },
        { x: p.bx, y: p.t1 },
        { x: p.bx, y: down ? b.box.top : b.box.bottom },
      ]);
    } else {
      // Rows further apart: into the gap next to the source row, across to the column gap next
      // to the target (on the side facing the source), then into the target from the side.
      const down = dr > 0;
      const right = dc > 0;
      const hg = `h:${down ? ri(a) : ri(a) - 1}`;
      const vg = `v:${right ? ci(b) - 1 : ci(b)}`;
      const vgBand = gutter(colBand, right ? ci(b) - 1 : ci(b));
      const vMid = (vgBand.lo + vgBand.hi) / 2;
      port(
        a,
        down ? 'bottom' : 'top',
        () => vMid,
        (v) => (p.ax = v),
      );
      port(
        b,
        right ? 'left' : 'right',
        () => (down ? -Infinity : Infinity),
        (v) => (p.by = v),
      );
      tracks.push({
        key: hg,
        span: () => [Math.min(p.ax, p.t2), Math.max(p.ax, p.t2)],
        set: (v) => (p.t1 = v),
      });
      tracks.push({
        key: vg,
        span: () => [Math.min(p.t1, p.by), Math.max(p.t1, p.by)],
        set: (v) => (p.t2 = v),
      });
      builders.push(() => [
        { x: p.ax, y: down ? a.box.bottom : a.box.top },
        { x: p.ax, y: p.t1 },
        { x: p.t2, y: p.t1 },
        { x: p.t2, y: p.by },
        { x: right ? b.box.left : b.box.right, y: p.by },
      ]);
    }
  }

  // Ports: spread evenly along each side, ordered by where the edge is heading.
  const sides = new Map<string, Port[]>();
  for (const port of ports) sides.set(port.key, [...(sides.get(port.key) ?? []), port]);
  for (const [key, list] of sides) {
    const [id, side] = key.split(':') as [string, Side];
    const box = byId.get(id)!.box;
    const horizontal = side === 'top' || side === 'bottom';
    const lo = horizontal ? box.left : box.top;
    const hi = horizontal ? box.right : box.bottom;
    // Leave the middle free if a straight connection uses this side.
    const straight = edges.some((e) => {
      const other = e.from === id ? byId.get(e.to) : e.to === id ? byId.get(e.from) : undefined;
      const me = byId.get(id)!;
      if (!other) return false;
      const dr = ri(other) - ri(me);
      const dc = ci(other) - ci(me);
      if (horizontal) return dc === 0 && Math.abs(dr) === 1 && (side === 'bottom') === dr > 0;
      return dr === 0 && Math.abs(dc) === 1 && (side === 'right') === dc > 0;
    });
    const sorted = [...list].sort((p, q) => p.sortBy() - q.sortBy());
    const spread = (group: Port[], from: number, to: number) =>
      group.forEach((port, i) => port.set(from + ((to - from) * (i + 1)) / (group.length + 1)));
    if (straight) {
      // The middle belongs to the straight line: ports heading below it go to one half,
      // the others to the other half.
      const mid = (lo + hi) / 2;
      spread(
        sorted.filter((p) => p.sortBy() < mid),
        lo,
        mid,
      );
      spread(
        sorted.filter((p) => p.sortBy() >= mid),
        mid,
        hi,
      );
    } else {
      spread(sorted, lo, hi);
    }
  }

  // Tracks: two passes, because Z-shaped edges depend on both of their tracks.
  for (let pass = 0; pass < 2; pass++) {
    const gutters = new Map<string, Track[]>();
    for (const t of tracks) gutters.set(t.key, [...(gutters.get(t.key) ?? []), t]);
    for (const [key, list] of gutters) {
      const [kind, idx] = key.split(':') as ['h' | 'v', string];
      const band = gutter(kind === 'h' ? rowBand : colBand, Number(idx));
      const sorted = [...list].sort((p, q) => {
        const [p0, p1] = p.span();
        const [q0, q1] = q.span();
        return p1 - p0 - (q1 - q0) || p0 - q0;
      });
      sorted.forEach((t, i) =>
        t.set(band.lo + ((band.hi - band.lo) * (i + 1)) / (sorted.length + 1)),
      );
    }
  }

  return builders.map((build) => {
    const pts = build();
    if (pts.length < 2) return { d: '', label: { x: 0, y: 0 }, labelHorizontal: true };
    let best = 0;
    let bestLen = -1;
    for (let i = 1; i < pts.length; i++) {
      const len = Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    const p = pts[best - 1]!;
    const q = pts[best]!;
    return {
      d: roundedPath(pts),
      label: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
      labelHorizontal: Math.abs(p.y - q.y) < 0.5,
    };
  });
}
