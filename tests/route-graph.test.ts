import { describe, expect, it } from 'vitest';
import { routeGraph, type GridNode } from '../src/lib/viz/route-graph';

// Grid: columns 120 wide with 60 gap, rows 40 high with 40 gap.
const node = (id: string, row: number, col: number): GridNode => {
  const left = (col - 1) * 180;
  const top = (row - 1) * 80;
  return { id, row, col, box: { left, top, right: left + 120, bottom: top + 40 } };
};
const points = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
const inside = (p: { x: number; y: number }, n: GridNode) =>
  p.x > n.box.left + 0.5 &&
  p.x < n.box.right - 0.5 &&
  p.y > n.box.top + 0.5 &&
  p.y < n.box.bottom - 0.5;

describe('routeGraph', () => {
  it('connects horizontal and vertical neighbours with straight lines', () => {
    const [h, v] = routeGraph(
      [node('a', 1, 1), node('b', 1, 2), node('c', 2, 1)],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    );
    expect(h!.d).toBe('M120 20 L180 20');
    expect(v!.d).toBe('M60 40 L60 80');
  });

  it('offsets the two lines of a bidirectional connection', () => {
    const [ab, ba] = routeGraph(
      [node('a', 1, 1), node('b', 1, 2)],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    expect(points(ab!.d)[0]!.y).not.toBe(points(ba!.d)[0]!.y);
  });

  it('routes diagonal and long edges through gaps, never through a node', () => {
    const nodes = [
      node('a', 1, 1),
      node('b', 1, 2),
      node('c', 3, 3),
      node('d', 2, 2),
      node('e', 1, 3),
    ];
    const routes = routeGraph(nodes, [
      { from: 'a', to: 'c' },
      { from: 'a', to: 'd' },
      { from: 'a', to: 'e' },
    ]);
    for (const r of routes) {
      const pts = points(r.d);
      // sample every segment and check no sample lies inside any node
      for (let i = 1; i < pts.length; i++) {
        for (let t = 0.1; t < 1; t += 0.1) {
          const p = {
            x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t,
            y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t,
          };
          for (const n of nodes) expect(inside(p, n)).toBe(false);
        }
      }
    }
  });

  it('keeps the middle of a side free for a straight line and spreads the other ports', () => {
    const [straight, side] = routeGraph(
      [node('a', 1, 1), node('b', 2, 1), node('c', 2, 2)],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    );
    expect(points(straight!.d)[0]!.x).toBe(60);
    expect(points(side!.d)[0]!.x).toBeGreaterThan(60); // heads right, so it leaves right of centre
  });
});
