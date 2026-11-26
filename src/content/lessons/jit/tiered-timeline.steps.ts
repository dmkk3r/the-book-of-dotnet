import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract. Bar lengths only show "Tier 1 is faster", not a measured ratio.
// TODO(verify): Tier 1 background compilation runs on a thread pool thread
// (tiered-compilation.md: "a single thread taken from the threadpool").

type Item = TimelineState['items'][number];
const lanes: TimelineState['lanes'] = [
  { id: 'l-a', label: 'Anfrage-Thread A', kind: 'pool' },
  { id: 'l-b', label: 'Anfrage-Thread B', kind: 'pool' },
  { id: 'l-jit', label: 'Hintergrund-JIT', kind: 'pool' },
];
const t0 = (id: string, lane: string, start: number, end: number): Item => ({
  id,
  lane,
  start,
  end,
  label: 'Square (Tier 0)',
  kind: 'run',
});
const t1 = (id: string, lane: string, start: number): Item => ({
  id,
  lane,
  start,
  end: start + 1,
  label: 'Tier 1',
  kind: 'run',
});

const before: Item[] = [
  t0('a1', 'l-a', 0, 2),
  t0('b1', 'l-b', 1, 3),
  t0('a2', 'l-a', 3, 5),
  t0('b2', 'l-b', 4, 6),
];
const during: Item[] = [
  t0('a3', 'l-a', 6, 8),
  t0('b3', 'l-b', 7, 9),
  t0('a4', 'l-a', 9, 11),
  t0('b4', 'l-b', 10, 12),
];
const jit: Item = {
  id: 'jit',
  lane: 'l-jit',
  start: 6,
  end: 12,
  label: 'Square in Tier 1 übersetzen',
  kind: 'run',
};
const straddling = t0('a5', 'l-a', 11, 13);
const after: Item[] = [
  t1('b5', 'l-b', 13),
  t1('a6', 'l-a', 14),
  t1('b6', 'l-b', 15),
  t1('a7', 'l-a', 16),
];

export default defineStepScript({
  view: 'timeline',
  title: 'Tier 1 entsteht im Hintergrund',
  layout: 'stacked',
  code: {
    cs: `app.MapGet("/square/{x}", (int x) => Square(x));

static int Square(int x) => x * x;`,
  },
  steps: [
    {
      codeLine: 1,
      state: { lanes, duration: 18, items: before, now: 6 },
      changed: ['a1', 'b1', 'a2', 'b2'],
      explanation:
        'Zwei Threads des ThreadPools bedienen Anfragen und rufen dabei `Square` auf. Beide nutzen denselben Tier-0-Code. Gerade hat `Square` die Zählschwelle erreicht.',
    },
    {
      codeLine: 3,
      state: { lanes, duration: 18, items: [...before, ...during, jit], now: 12 },
      changed: ['jit', 'a3', 'b3', 'a4', 'b4'],
      explanation:
        'Ein eigener Thread übersetzt `Square` in Tier 1. Die Anfrage-Threads werden dabei **nicht blockiert**: Sie führen weiter den Tier-0-Code aus. Die Optimierung kostet also CPU-Zeit, aber keine Wartezeit für die Anfragen.',
    },
    {
      codeLine: 3,
      state: { lanes, duration: 18, items: [...before, ...during, jit, straddling], now: 13 },
      changed: ['a5'],
      explanation:
        'Kurz vor dem Umschalten hat Thread A noch einmal Tier 0 betreten. Dieser Aufruf läuft im alten Code zu Ende. Die Runtime ersetzt keinen Code, der gerade ausgeführt wird, sie leitet nur **künftige** Aufrufe um.',
    },
    {
      codeLine: 1,
      state: {
        lanes,
        duration: 18,
        items: [...before, ...during, jit, straddling, ...after],
        now: 17,
      },
      changed: ['b5', 'a6', 'b6', 'a7'],
      explanation:
        'Nach dem Umstellen des Einstiegspunkts landen alle neuen Aufrufe im Tier-1-Code. Die kürzeren Balken stehen für schnelleren Code. Das Verhältnis ist hier nur angedeutet, wie viel schneller Tier 1 ist, hängt ganz von der Methode ab.',
    },
  ],
});
