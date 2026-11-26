import { describe, expect, it } from 'vitest';
import { roundedPath, routeArrows, type Box } from '../src/lib/viz/route-arrows';

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
/** All corner and end points of a path (M, L and the control points of Q). */
const points = (d: string) =>
  [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
/** Vertical segments as x positions. */
const verticalXs = (d: string) => {
  const p = points(d);
  const xs = new Set<number>();
  for (let i = 1; i < p.length; i++)
    if (Math.abs(p[i]!.x - p[i - 1]!.x) < 0.01 && Math.abs(p[i]!.y - p[i - 1]!.y) > 10)
      xs.add(p[i]!.x);
  return [...xs];
};

describe('roundedPath', () => {
  it('draws straight lines without corners', () => {
    expect(
      roundedPath([
        { x: 0, y: 10 },
        { x: 50, y: 10 },
      ]),
    ).toBe('M0 10 L50 10');
  });

  it('rounds corners and drops collinear points', () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ]);
    expect(d).toBe('M0 0 L35 0 Q40 0 40 5 L40 30');
  });
});

describe('routeArrows', () => {
  const stack = [box(0, 0, 200, 30), box(0, 40, 200, 30), box(0, 80, 200, 30)];
  const heap = [box(300, 0, 200, 60), box(300, 200, 200, 60), box(300, 500, 200, 60)];

  it('gives every arrow between two columns its own vertical channel inside the gap', () => {
    const arrows = routeArrows(stack.map((from, i) => ({ from, to: heap[i]!, siblings: false })));
    const channels = arrows.map((a) => verticalXs(a.d)).flat();
    expect(new Set(channels).size).toBe(channels.length);
    for (const x of channels) {
      expect(x).toBeGreaterThan(200);
      expect(x).toBeLessThan(300);
    }
  });

  it('nests channels: the arrow reaching furthest down uses the channel closest to the source', () => {
    const [a, b, c] = routeArrows(
      stack.map((from, i) => ({ from, to: heap[i]!, siblings: false })),
    );
    const x = (d: string) => verticalXs(d)[0] ?? Infinity;
    expect(x(c!.d)).toBeLessThan(x(b!.d));
    expect(x(b!.d)).toBeLessThan(x(a!.d));
  });

  it('starts at the source edge and ends at the target edge', () => {
    const [a] = routeArrows([{ from: stack[0]!, to: heap[1]!, siblings: false }]);
    expect(a!.start).toEqual({ x: 200, y: 15 });
    expect(a!.long).toBe(true);
    const p = points(a!.d);
    expect(p[p.length - 1]).toEqual({ x: 300, y: 214 });
  });

  it('routes arrows within one column around its right edge, short spans inside', () => {
    const col = [box(0, 0, 200, 40), box(0, 60, 200, 40), box(0, 300, 200, 40)];
    const [short, long] = routeArrows([
      { from: col[0]!, to: col[1]!, siblings: false },
      { from: col[0]!, to: col[2]!, siblings: false },
    ]);
    expect(verticalXs(short!.d)[0]).toBe(212);
    expect(verticalXs(long!.d)[0]).toBe(220);
  });

  it('routes non-adjacent neighbours in a row underneath the row', () => {
    const row = [box(0, 0, 100, 50), box(110, 0, 100, 50), box(220, 0, 100, 50)];
    const [a] = routeArrows([{ from: row[0]!, to: row[2]!, siblings: true }]);
    const ys = points(a!.d).map((p) => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(50);
  });

  it('connects adjacent neighbours with a short straight line', () => {
    const [a] = routeArrows([
      { from: box(0, 0, 100, 50), to: box(110, 0, 100, 50), siblings: true },
    ]);
    expect(a!.d).toBe('M100 25 L110 25');
  });
});

describe('routeArrows with columns and rows', () => {
  it('routes around the whole target column, not just around the two boxes', () => {
    const column = box(0, 0, 600, 400);
    const [a] = routeArrows([
      { from: box(0, 300, 150, 30), to: box(0, 20, 150, 40), siblings: false, column },
    ]);
    expect(verticalXs(a!.d)[0]).toBe(612);
  });

  it('routes between rows of the same container through the row gap', () => {
    const [a] = routeArrows([
      { from: box(0, 0, 100, 50), to: box(220, 90, 100, 50), siblings: true },
    ]);
    const ys = points(a!.d).map((p) => p.y);
    expect(Math.max(...ys.slice(0, -1))).toBeLessThanOrEqual(90);
    expect(ys).toContain(62);
  });
});

describe('routeArrows with top entry (boxes side by side)', () => {
  const column = box(300, 0, 400, 300);
  const near = box(320, 200, 100, 40);
  const far = box(440, 200, 100, 40);

  it('enters from the top and never runs through the neighbour', () => {
    const [a] = routeArrows([
      { from: box(0, 0, 150, 30), to: far, siblings: false, column, enterTop: true },
    ]);
    const pts = points(a!.d);
    const last = pts[pts.length - 1]!;
    expect(last).toEqual({ x: 490, y: 200 });
    // Everything before the final drop stays above the row.
    expect(Math.max(...pts.slice(0, -1).map((p) => p.y))).toBeLessThan(200);
  });

  it('gives the nearer target the lane closest to the row', () => {
    const [toNear, toFar] = routeArrows([
      { from: box(0, 0, 150, 30), to: near, siblings: false, column, enterTop: true },
      { from: box(0, 40, 150, 30), to: far, siblings: false, column, enterTop: true },
    ]);
    const lane = (d: string) => {
      const pts = points(d);
      return pts[pts.length - 2]!.y;
    };
    expect(lane(toNear!.d)).toBeGreaterThan(lane(toFar!.d));
  });

  it('loops around the column when source and target share it', () => {
    const [a] = routeArrows([
      { from: box(320, 260, 100, 30), to: near, siblings: false, column, enterTop: true },
    ]);
    expect(Math.max(...verticalXs(a!.d))).toBeGreaterThan(700);
    expect(points(a!.d)[0]).toEqual({ x: 370, y: 290 });
  });
});
