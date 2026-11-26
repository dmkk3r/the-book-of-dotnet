/**
 * Orthogonal arrow routing for the visualizations.
 *
 * Every arrow runs in right angles with small rounded corners and gets its own channel, so arrows
 * never share a segment and never run across the boxes they connect:
 * - forward/backward: through the gap between two columns, one vertical channel per arrow
 * - around: source and target in the same column, routed along the right edge outside the column
 * - below: neighbours in the same row (e.g. objects in a heap region), routed underneath the row
 * - direct: adjacent neighbours in the same row, a short straight line
 * - drop: targets laid out side by side (e.g. objects in a GC region) are entered from the top,
 *   through a lane above the row, so the arrow never crosses a neighbouring box
 * - loop: like drop, but source and target share a column; the arrow leaves the source at the
 *   bottom and runs along the right edge outside the column
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Link {
  from: Box;
  to: Box;
  /** Source and target share a parent (e.g. two objects in one region). */
  siblings: boolean;
  /** Bounds of the column the target sits in; arrows routed "around" stay outside it. */
  column?: Box;
  /** Enter the target from the top instead of the side (targets that sit side by side). */
  enterTop?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Arrow {
  d: string;
  start: Point;
  /** False for very short arrows, which are drawn without a start dot. */
  long: boolean;
}

type Kind = 'direct' | 'forward' | 'backward' | 'around' | 'below' | 'rows' | 'drop' | 'loop';

interface Planned {
  kind: Kind;
  group: string;
  link: Link;
  sy: number;
  ty: number;
  /** Lane above the target for drop and loop arrows (0 = closest to the target). */
  lane?: number;
}

const GAP = 12; // minimum distance between a box and the first channel
const STEP = 8; // distance between parallel channels outside columns
const RADIUS = 5;
const ADJACENT = 28;
const LANE = 7; // distance between lanes above a row of targets

const midY = (b: Box) => (b.top + b.bottom) / 2;
const midX = (b: Box) => (b.left + b.right) / 2;
/** Where an arrow enters a target: the header line, not the vertical middle of a tall box. */
const entryY = (b: Box) => b.top + Math.min(14, (b.bottom - b.top) / 2);
const r1 = (n: number) => Math.round(n * 10) / 10;
const bucket = (n: number) => Math.round(n / 8);

function plan(link: Link): Planned {
  const { from: a, to: b } = link;
  const sameRow = Math.abs(a.top - b.top) < 8 && Math.abs(a.bottom - b.bottom) < 24;
  if (link.siblings && sameRow) {
    const gap = b.left - a.right;
    if (gap >= 0 && gap < ADJACENT) {
      return { kind: 'direct', group: 'direct', link, sy: midY(a), ty: midY(a) };
    }
    const rowBottom = Math.max(a.bottom, b.bottom);
    return { kind: 'below', group: `below:${bucket(rowBottom)}`, link, sy: a.bottom, ty: b.bottom };
  }
  if (link.siblings) {
    // Same container, different rows: travel through the gap between the rows.
    const down = b.top >= a.bottom;
    const gapY = down ? a.bottom : a.top;
    return {
      kind: 'rows',
      group: `rows:${down ? 'd' : 'u'}:${bucket(gapY)}`,
      link,
      sy: gapY,
      ty: down ? b.top : b.bottom,
    };
  }
  if (link.enterTop) {
    if (b.left >= a.right + 2 * GAP) {
      const columnLeft = link.column?.left ?? b.left;
      return {
        kind: 'drop',
        group: `drop:${bucket(a.right)}:${bucket(columnLeft)}`,
        link,
        sy: midY(a),
        ty: b.top,
      };
    }
    const column = link.column?.right ?? Math.max(a.right, b.right);
    return { kind: 'loop', group: `loop:${bucket(column)}`, link, sy: a.bottom, ty: b.top };
  }
  if (b.left >= a.right + 2 * GAP) {
    return {
      kind: 'forward',
      group: `fwd:${bucket(a.right)}:${bucket(b.left)}`,
      link,
      sy: midY(a),
      ty: entryY(b),
    };
  }
  if (b.right <= a.left - 2 * GAP) {
    return {
      kind: 'backward',
      group: `bwd:${bucket(b.right)}:${bucket(a.left)}`,
      link,
      sy: midY(a),
      ty: entryY(b),
    };
  }
  const column = link.column?.right ?? Math.max(a.right, b.right);
  return { kind: 'around', group: `around:${bucket(column)}`, link, sy: midY(a), ty: entryY(b) };
}

/**
 * Lanes above a row of targets: arrows from the left (drop) take the lanes closest to the row,
 * nearest target first; arrows from the right (loop) take the lanes above them, rightmost first.
 */
function assignLanes(planned: Planned[]) {
  const rows = new Map<number, Planned[]>();
  for (const p of planned) {
    if (p.kind !== 'drop' && p.kind !== 'loop') continue;
    const key = bucket(p.link.to.top);
    rows.set(key, [...(rows.get(key) ?? []), p]);
  }
  for (const members of rows.values()) {
    const drops = members
      .filter((m) => m.kind === 'drop')
      .sort((p, q) => midX(p.link.to) - midX(q.link.to));
    const loops = members
      .filter((m) => m.kind === 'loop')
      .sort((p, q) => midX(q.link.to) - midX(p.link.to));
    [...drops, ...loops].forEach((m, i) => (m.lane = i));
  }
}

/**
 * A box that receives an arrow on one side and sends one from the same side (e.g. a table row
 * that is referenced and refers on): enter in the upper part, leave in the lower part, so that
 * the arrowhead and the start dot do not sit on top of each other.
 */
function separateEnds(planned: Planned[]) {
  const key = (b: Box) => `${r1(b.left)}:${r1(b.top)}:${r1(b.right)}:${r1(b.bottom)}`;
  const outSide = (p: Planned) =>
    p.kind === 'forward' || p.kind === 'around' ? 'right' : p.kind === 'backward' ? 'left' : null;
  const inSide = (p: Planned) =>
    p.kind === 'backward' || p.kind === 'around' ? 'right' : p.kind === 'forward' ? 'left' : null;
  const incoming = new Map<string, Planned[]>();
  for (const p of planned) {
    const side = inSide(p);
    if (side)
      incoming.set(`${key(p.link.to)}:${side}`, [
        ...(incoming.get(`${key(p.link.to)}:${side}`) ?? []),
        p,
      ]);
  }
  for (const p of planned) {
    const side = outSide(p);
    if (!side) continue;
    const ins = incoming.get(`${key(p.link.from)}:${side}`);
    if (!ins?.length) continue;
    const a = p.link.from;
    const h = a.bottom - a.top;
    p.sy = a.top + h * 0.7;
    for (const q of ins) q.ty = a.top + h * 0.3;
  }
}

/** Rounded orthogonal path through the given points. */
export function roundedPath(points: Point[], radius = RADIUS): string {
  // Drop repeated and collinear points.
  const pts: Point[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    pts.push(p);
  }
  for (let i = pts.length - 2; i > 0; i--) {
    const [p, q, s] = [pts[i - 1]!, pts[i]!, pts[i + 1]!];
    if (
      (Math.abs(p.x - q.x) < 0.5 && Math.abs(q.x - s.x) < 0.5) ||
      (Math.abs(p.y - q.y) < 0.5 && Math.abs(q.y - s.y) < 0.5)
    ) {
      pts.splice(i, 1);
    }
  }
  if (pts.length === 0) return '';
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const next = pts[i + 1];
    if (!next) {
      d += ` L${r1(p.x)} ${r1(p.y)}`;
      break;
    }
    const prev = pts[i - 1]!;
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = p.x - ((p.x - prev.x) / inLen) * r;
    const ay = p.y - ((p.y - prev.y) / inLen) * r;
    const bx = p.x + ((next.x - p.x) / outLen) * r;
    const by = p.y + ((next.y - p.y) / outLen) * r;
    d += ` L${r1(ax)} ${r1(ay)} Q${r1(p.x)} ${r1(p.y)} ${r1(bx)} ${r1(by)}`;
  }
  return d;
}

/** Routes all links at once so that arrows in the same corridor get separate channels. */
export function routeArrows(links: Link[]): Arrow[] {
  const planned = links.map(plan);
  assignLanes(planned);
  separateEnds(planned);
  const groups = new Map<string, Planned[]>();
  for (const p of planned) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);

  const result = new Map<Planned, Omit<Arrow, 'long'>>();
  for (const members of groups.values()) {
    const kind = members[0]!.kind;
    if (kind === 'direct') {
      for (const m of members) {
        const { from: a, to: b } = m.link;
        const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
        result.set(m, {
          d: roundedPath([
            { x: a.right, y },
            { x: b.left, y },
          ]),
          start: { x: a.right, y },
        });
      }
      continue;
    }

    if (kind === 'forward' || kind === 'backward') {
      // Arrows that travel further vertically take the outer channels (closer to the source),
      // which keeps nested arrows from crossing.
      const sorted = [...members].sort((p, q) => q.ty - p.ty);
      const first = sorted[0]!.link;
      const left = kind === 'forward' ? first.from.right : first.to.right;
      const right = kind === 'forward' ? first.to.left : first.from.left;
      const n = sorted.length;
      sorted.forEach((m, i) => {
        const { from: a, to: b } = m.link;
        const slot = kind === 'forward' ? i : n - 1 - i;
        const cx = left + ((right - left) * (slot + 1)) / (n + 1);
        const sx = kind === 'forward' ? a.right : a.left;
        const tx = kind === 'forward' ? b.left : b.right;
        result.set(m, {
          d: roundedPath([
            { x: sx, y: m.sy },
            { x: cx, y: m.sy },
            { x: cx, y: m.ty },
            { x: tx, y: m.ty },
          ]),
          start: { x: sx, y: m.sy },
        });
      });
      continue;
    }

    if (kind === 'drop') {
      // Deeper rows and nearer targets take the outer channels, which keeps the lanes above a row
      // from crossing the drops into it.
      const sorted = [...members].sort((p, q) => q.ty - p.ty || midX(p.link.to) - midX(q.link.to));
      const first = sorted[0]!.link;
      const left = first.from.right;
      const right = first.column?.left ?? first.to.left;
      const n = sorted.length;
      sorted.forEach((m, i) => {
        const { from: a, to: b } = m.link;
        const cx = left + ((right - left) * (i + 1)) / (n + 1);
        const ly = b.top - GAP + 4 - (m.lane ?? 0) * LANE;
        const tx = midX(b);
        result.set(m, {
          d: roundedPath([
            { x: a.right, y: m.sy },
            { x: cx, y: m.sy },
            { x: cx, y: ly },
            { x: tx, y: ly },
            { x: tx, y: b.top },
          ]),
          start: { x: a.right, y: m.sy },
        });
      });
      continue;
    }

    if (kind === 'loop') {
      const sorted = [...members].sort((p, q) => Math.abs(p.ty - p.sy) - Math.abs(q.ty - q.sy));
      const column = Math.max(
        ...members.map((m) => m.link.column?.right ?? Math.max(m.link.from.right, m.link.to.right)),
      );
      const outgoing = new Map<Box, number>();
      sorted.forEach((m, i) => {
        const { from: a, to: b } = m.link;
        const k = outgoing.get(a) ?? 0;
        outgoing.set(a, k + 1);
        const sx = midX(a) + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 10;
        const ey = a.bottom + GAP + 10 + i * LANE; // below the "below" lanes of the source row
        const cx = column + GAP + i * STEP;
        const ly = b.top - GAP + 4 - (m.lane ?? 0) * LANE;
        const tx = midX(b);
        result.set(m, {
          d: roundedPath([
            { x: sx, y: a.bottom },
            { x: sx, y: ey },
            { x: cx, y: ey },
            { x: cx, y: ly },
            { x: tx, y: ly },
            { x: tx, y: b.top },
          ]),
          start: { x: sx, y: a.bottom },
        });
      });
      continue;
    }

    if (kind === 'around') {
      // Short spans hug the column, long spans run further out.
      const sorted = [...members].sort((p, q) => Math.abs(p.ty - p.sy) - Math.abs(q.ty - q.sy));
      const column = Math.max(
        ...members.map((m) => m.link.column?.right ?? Math.max(m.link.from.right, m.link.to.right)),
      );
      sorted.forEach((m, i) => {
        const { from: a, to: b } = m.link;
        const cx = column + GAP + i * STEP;
        result.set(m, {
          d: roundedPath([
            { x: a.right, y: m.sy },
            { x: cx, y: m.sy },
            { x: cx, y: m.ty },
            { x: b.right, y: m.ty },
          ]),
          start: { x: a.right, y: m.sy },
        });
      });
      continue;
    }

    if (kind === 'rows') {
      const sorted = [...members].sort(
        (p, q) =>
          Math.abs(midX(p.link.to) - midX(p.link.from)) -
          Math.abs(midX(q.link.to) - midX(q.link.from)),
      );
      sorted.forEach((m, i) => {
        const { from: a, to: b } = m.link;
        const down = b.top >= a.bottom;
        const gy = down ? a.bottom + GAP + i * STEP : a.top - GAP - i * STEP;
        const sx = midX(a);
        const tx = midX(b);
        result.set(m, {
          d: roundedPath([
            { x: sx, y: m.sy },
            { x: sx, y: gy },
            { x: tx, y: gy },
            { x: tx, y: m.ty },
          ]),
          start: { x: sx, y: m.sy },
        });
      });
      continue;
    }

    // below: neighbours in one row, routed underneath; short hops stay closest to the row.
    const sorted = [...members].sort(
      (p, q) =>
        Math.abs(midX(p.link.to) - midX(p.link.from)) -
        Math.abs(midX(q.link.to) - midX(q.link.from)),
    );
    const rowBottom = Math.max(
      ...members.map((m) => Math.max(m.link.from.bottom, m.link.to.bottom)),
    );
    // Spread start and end points a little so that several arrows from one box do not overlap.
    const outgoing = new Map<Box, number>();
    sorted.forEach((m, i) => {
      const { from: a, to: b } = m.link;
      const k = outgoing.get(a) ?? 0;
      outgoing.set(a, k + 1);
      const sx = midX(a) + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 10;
      const tx = midX(b);
      const cy = rowBottom + GAP + i * STEP;
      result.set(m, {
        d: roundedPath([
          { x: sx, y: a.bottom },
          { x: sx, y: cy },
          { x: tx, y: cy },
          { x: tx, y: b.bottom },
        ]),
        start: { x: sx, y: a.bottom },
      });
    });
  }
  return planned.map((p) => {
    const arrow = result.get(p)!;
    const pts = [...arrow.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
      x: +m[1]!,
      y: +m[2]!,
    }));
    let length = 0;
    for (let i = 1; i < pts.length; i++)
      length += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    return { ...arrow, long: length >= 24 };
  });
}
