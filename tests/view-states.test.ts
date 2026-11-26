import { describe, expect, it } from 'vitest';
import { checkBuckets, type BucketState } from '../src/lib/viz/views/buckets';
import { checkGcHeap, type GcHeapState } from '../src/lib/viz/views/gcheap';
import { checkGraph, type GraphState } from '../src/lib/viz/views/graph';
import { checkLayout, type LayoutState } from '../src/lib/viz/views/layout';
import { checkPipeline, type PipelineState } from '../src/lib/viz/views/pipeline';
import { checkTable, type TableState } from '../src/lib/viz/views/table';
import { checkTimeline, type TimelineState } from '../src/lib/viz/views/timeline';

const problems = (check: { problems: string[] }) => check.problems;

describe('TimelineState', () => {
  const ok: TimelineState = {
    lanes: [{ id: 'main', label: 'Main' }],
    duration: 10,
    items: [
      { id: 'a', lane: 'main', start: 0, end: 4, label: 'A', kind: 'run' },
      { id: 'b', lane: 'main', start: 5, end: 9, label: 'B', kind: 'continuation' },
    ],
    links: [{ from: 'a', to: 'b' }],
    now: 5,
  };
  it('accepts a valid state and collects ids', () => {
    const check = checkTimeline(ok, 's');
    expect(check.problems).toEqual([]);
    expect([...check.ids]).toEqual(['main', 'a', 'b']);
  });
  it('rejects missing lanes, bad ranges, broken links and now outside', () => {
    const bad: TimelineState = {
      ...ok,
      items: [{ id: 'a', lane: 'gone', start: 5, end: 3, label: 'A', kind: 'run' }],
      links: [{ from: 'a', to: 'x' }],
      now: 11,
    };
    const p = problems(checkTimeline(bad, 's'));
    expect(p.some((x) => x.includes('missing lane "gone"'))).toBe(true);
    expect(p.some((x) => x.includes('invalid range 5 to 3'))).toBe(true);
    expect(p.some((x) => x.includes('missing item "x"'))).toBe(true);
    expect(p.some((x) => x.includes('now 11'))).toBe(true);
  });
});

describe('GcHeapState', () => {
  const ok: GcHeapState = {
    regions: [{ id: 'g0', kind: 'gen0' }],
    objects: [
      { id: 'a', region: 'g0', label: 'A', refs: ['b'] },
      { id: 'b', region: 'g0', label: 'B' },
    ],
    roots: [{ id: 'r', label: 'local', refs: ['a'] }],
  };
  it('accepts a valid state', () => expect(problems(checkGcHeap(ok, 's'))).toEqual([]));
  it('rejects objects in missing regions and dangling references', () => {
    const bad: GcHeapState = {
      ...ok,
      objects: [{ id: 'a', region: 'g9', label: 'A', refs: ['zz'] }],
      roots: [{ id: 'r', label: 'local', refs: ['gone'] }],
    };
    const p = problems(checkGcHeap(bad, 's'));
    expect(p).toHaveLength(3);
    expect(p.join()).toMatch(/missing region "g9".*missing object "zz".*missing object "gone"/);
  });
  it('rejects duplicate ids across regions, objects and roots', () => {
    const bad: GcHeapState = { ...ok, roots: [{ id: 'a', label: 'dup', refs: [] }] };
    expect(problems(checkGcHeap(bad, 's'))[0]).toMatch(/duplicate root id "a"/);
  });
});

describe('PipelineState', () => {
  const stage = (id: string, status: PipelineState['stages'][number]['status']) => ({
    id,
    label: id,
    status,
  });
  it('accepts one active stage', () => {
    expect(
      problems(checkPipeline({ stages: [stage('a', 'done'), stage('b', 'active')] }, 's')),
    ).toEqual([]);
  });
  it('rejects several active stages, no stages and invalid call counts', () => {
    expect(
      problems(checkPipeline({ stages: [stage('a', 'active'), stage('b', 'active')] }, 's'))[0],
    ).toMatch(/2 stages are active/);
    expect(problems(checkPipeline({ stages: [] }, 's'))[0]).toMatch(/no stages/);
    const m = {
      stages: [stage('a', 'done')],
      methods: [{ id: 'm', name: 'M', tier: 'tier0' as const, calls: -1 }],
    };
    expect(problems(checkPipeline(m, 's'))[0]).toMatch(/invalid call count/);
  });
});

describe('BucketState', () => {
  const entry = (id: string, bucket: number, next: number | null) => ({
    id,
    key: id,
    value: '1',
    hash: '0',
    bucket,
    next,
  });
  const ok: BucketState = {
    buckets: [1, null, null],
    entries: [entry('a', 0, null), entry('b', 0, 0)],
  };
  it('accepts consistent chains and allows unallocated buckets', () => {
    expect(problems(checkBuckets(ok, 's'))).toEqual([]);
    expect(problems(checkBuckets({ buckets: [], entries: [] }, 's'))).toEqual([]);
    expect(checkBuckets(ok, 's').ids.has('bucket-2')).toBe(true);
  });
  it('rejects heads and next pointers outside entries', () => {
    const p = problems(checkBuckets({ buckets: [5], entries: [entry('a', 0, 7)] }, 's'));
    expect(p.join()).toMatch(/bucket 0 points to missing entry 5.*next 7 outside/);
  });
  it('rejects entries chained from the wrong bucket and cycles', () => {
    expect(
      problems(checkBuckets({ buckets: [0, null], entries: [entry('a', 1, null)] }, 's'))[0],
    ).toMatch(/belongs to 1/);
    expect(problems(checkBuckets({ buckets: [0], entries: [entry('a', 0, 0)] }, 's'))[0]).toMatch(
      /cycle/,
    );
  });
  it('rejects probes that visit missing entries', () => {
    const bad: BucketState = { ...ok, probe: { key: 'x', hash: '0', bucket: 0, path: [9] } };
    expect(problems(checkBuckets(bad, 's'))[0]).toMatch(/probe visits missing entry 9/);
  });
});

describe('LayoutState', () => {
  const part = (
    id: string,
    offset: number,
    size: number,
    kind: LayoutState['parts'][number]['kind'] = 'field',
  ) => ({
    id,
    name: id,
    offset,
    size,
    kind,
  });
  it('accepts a byte-exact layout', () => {
    expect(
      problems(
        checkLayout(
          {
            title: 'S',
            totalSize: 16,
            parts: [part('a', 0, 1), part('p', 1, 7, 'padding'), part('b', 8, 8)],
          },
          's',
        ),
      ),
    ).toEqual([]);
  });
  it('rejects gaps (missing padding), overlaps and wrong totals', () => {
    expect(
      problems(
        checkLayout({ title: 'S', totalSize: 16, parts: [part('a', 0, 1), part('b', 8, 8)] }, 's'),
      )[0],
    ).toMatch(/bytes 1 to 7 not covered/);
    expect(
      problems(
        checkLayout({ title: 'S', totalSize: 8, parts: [part('a', 0, 4), part('b', 2, 6)] }, 's'),
      )[0],
    ).toMatch(/overlaps/);
    expect(
      problems(checkLayout({ title: 'S', totalSize: 24, parts: [part('a', 0, 8)] }, 's'))[0],
    ).toMatch(/cover 8 bytes, totalSize is 24/);
  });
});

describe('every view has an example lesson', () => {
  it('uses every view in lesson step scripts', async () => {
    const scripts = import.meta.glob<{ default: { view: string } }>(
      '../src/content/lessons/**/*.steps.ts',
      { eager: true },
    );
    const used = new Set(Object.values(scripts).map((m) => m.default.view));
    expect([...used].sort()).toEqual([
      'buckets',
      'gcheap',
      'graph',
      'layout',
      'memory',
      'pipeline',
      'table',
      'timeline',
    ]);
  });
});

describe('GraphState', () => {
  const ok: GraphState = {
    nodes: [
      { id: 'a', label: 'A', row: 1, col: 1, status: 'done' },
      { id: 'b', label: 'B', row: 1, col: 2, status: 'active', shape: 'decision' },
    ],
    edges: [{ from: 'a', to: 'b', status: 'taken' }],
  };
  it('accepts a valid state and collects node and edge ids', () => {
    const check = checkGraph(ok, 's');
    expect(check.problems).toEqual([]);
    expect([...check.ids]).toEqual(['a', 'b', 'a->b']);
  });
  it('rejects shared cells, several active nodes, missing ends and self loops', () => {
    const bad: GraphState = {
      nodes: [
        { id: 'a', label: 'A', row: 1, col: 1, status: 'active' },
        { id: 'b', label: 'B', row: 1, col: 1, status: 'active' },
      ],
      edges: [
        { from: 'a', to: 'x' },
        { from: 'b', to: 'b' },
      ],
    };
    const p = problems(checkGraph(bad, 's')).join('\n');
    expect(p).toMatch(/share cell 1\/1/);
    expect(p).toMatch(/2 nodes are active/);
    expect(p).toMatch(/missing node "x"/);
    expect(p).toMatch(/self loop/);
  });
});

describe('TableState', () => {
  const ok: TableState = {
    tables: [
      {
        id: 't1',
        title: 'A',
        columns: ['x', 'y'],
        rows: [{ id: 'r1', cells: ['1', '2'], refs: [{ col: 1, to: 'r2' }] }],
      },
      { id: 't2', title: 'B', columns: ['z'], rows: [{ id: 'r2', cells: ['3'], status: 'match' }] },
    ],
  };
  it('accepts a valid state', () => expect(problems(checkTable(ok, 's'))).toEqual([]));
  it('rejects wrong cell counts, dangling or same-table references and shared positions', () => {
    const bad: TableState = {
      tables: [
        {
          id: 't1',
          title: 'A',
          columns: ['x', 'y'],
          rows: [
            { id: 'r1', cells: ['1'], refs: [{ col: 5, to: 'gone' }] },
            { id: 'r3', cells: ['1', '2'], refs: [{ col: 0, to: 'r1' }] },
          ],
        },
        { id: 't2', title: 'B', columns: ['z'], rows: [], col: 1 },
      ],
    };
    const p = problems(checkTable(bad, 's')).join('\n');
    expect(p).toMatch(/row "r1" has 1 cells/);
    expect(p).toMatch(/missing row "gone"/);
    expect(p).toMatch(/invalid column 5/);
    expect(p).toMatch(/"r1" in the same table/);
    expect(p).toMatch(/share cell 1\/1/);
  });
});
