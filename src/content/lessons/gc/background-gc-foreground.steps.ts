import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract. Workstation GC: the foreground GC runs on the user thread that
// triggered it, all managed threads are suspended, and the BGC thread pauses itself at a safe
// point (Microsoft Learn, background-gc: "The dedicated background garbage collection thread
// checks at frequent safe points to determine whether there is a request for foreground garbage
// collection. If there is, the background collection suspends itself").
// TODO(verify): Whether a foreground GC during a BGC may be gen1 as well as gen0 in the same
// sequence shown here, and how gen1 survivors are placed into gen2 free list space built by BGC.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 't1', label: 'Anfrage-Thread 1', kind: 'pool' },
  { id: 't2', label: 'Anfrage-Thread 2', kind: 'pool' },
  { id: 'bgc', label: 'BGC-Thread' },
];

const item = (
  id: string,
  lane: string,
  start: number,
  end: number,
  label: string,
  kind: Item['kind'] = 'run',
): Item => ({ id, lane, start, end, label, kind });

const start: Item[] = [
  item('t1-a', 't1', 0, 2, 'Anfragen'),
  item('t2-a', 't2', 0, 2, 'Anfragen'),
  item('t1-p1', 't1', 2, 3, 'Pause', 'blocked'),
  item('t2-p1', 't2', 2, 3, 'Pause', 'blocked'),
  item('bgc-init', 'bgc', 2, 3, 'Start'),
];

const markA: Item[] = [
  item('t1-b', 't1', 3, 8, 'allozieren'),
  item('t2-b', 't2', 3, 8, 'allozieren'),
  item('bgc-mark1', 'bgc', 3, 8, 'Gen2 markieren'),
];

const foreground: Item[] = [
  item('t1-fg', 't1', 8, 10, 'Gen0-GC'),
  item('t2-fg', 't2', 8, 10, 'angehalten', 'blocked'),
  item('bgc-wait', 'bgc', 8, 10, 'pausiert', 'blocked'),
];

const markB: Item[] = [
  item('t1-c', 't1', 10, 15, 'allozieren'),
  item('t2-c', 't2', 10, 15, 'allozieren'),
  item('bgc-mark2', 'bgc', 10, 15, 'Gen2 markieren'),
];

const finish: Item[] = [
  item('t1-p2', 't1', 15, 16, 'Pause', 'blocked'),
  item('t2-p2', 't2', 15, 16, 'Pause', 'blocked'),
  item('bgc-final', 'bgc', 15, 16, 'Abschluss'),
  item('t1-d', 't1', 16, 22, 'Anfragen'),
  item('t2-d', 't2', 16, 22, 'Anfragen'),
  item('bgc-sweep', 'bgc', 16, 21, 'Sweep'),
];

export default defineStepScript({
  view: 'timeline',
  title: 'Eine Gen0-GC unterbricht die Background GC',
  layout: 'stacked',
  code: {
    cs: `void HandleRequest(int id)
{
    var buffer = new byte[4096];    // Gen0-Budget wird verbraucht
    var customer = s_cache[id];     // s_cache liegt in Gen2
    Render(customer, buffer);
}`,
  },
  steps: [
    {
      codeLine: 3,
      state: { lanes, duration: 22, items: start, now: 3 },
      changed: ['t1-p1', 't2-p1', 'bgc-init'],
      explanation:
        'Eine Background GC beginnt mit ihrer kurzen Anfangspause. Ab jetzt markiert der BGC-Thread Gen2, während die Anfrage-Threads weiterlaufen.',
    },
    {
      codeLine: 3,
      state: { lanes, duration: 22, items: [...start, ...markA], now: 8 },
      changed: ['t1-b', 't2-b', 'bgc-mark1'],
      explanation:
        'Die Threads allozieren fleißig weiter, jede Anfrage einen neuen Puffer in Gen0. Das **Gen0-Budget** schrumpft dabei genauso wie ohne laufende Background GC.',
    },
    {
      codeLine: 3,
      state: { lanes, duration: 22, items: [...start, ...markA, ...foreground], now: 10 },
      changed: ['t1-fg', 't2-fg', 'bgc-wait'],
      explanation:
        'Das Budget ist erschöpft, Thread 1 löst eine **Foreground GC** aus, eine ganz normale Gen0-Collection. Sie ist **blockierend**: Alle verwalteten Threads stehen, und auch der BGC-Thread pausiert an einem sicheren Punkt.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 22,
        items: [...start, ...markA, ...foreground, ...markB],
        now: 15,
      },
      changed: ['t1-c', 't2-c', 'bgc-mark2'],
      explanation:
        'Nach der kurzen Gen0-Collection geht alles weiter, wo es stand: Die Anfrage-Threads allozieren in einem frisch geleerten Gen0, der BGC-Thread setzt seine Markierung fort. Ohne diese Möglichkeit müsste das Programm warten, bis die volle Collection fertig ist.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 22,
        items: [...start, ...markA, ...foreground, ...markB, ...finish],
        now: 22,
      },
      changed: ['t1-p2', 't2-p2', 'bgc-final', 'bgc-sweep'],
      explanation:
        'Abschlusspause, dann der nebenläufige Sweep. Häufige Fehlannahme: „Während einer Background GC gibt es keine Pausen.“ Es gibt die beiden kurzen BGC-Pausen und zusätzlich jede Foreground GC, die in die Zeit fällt.',
    },
  ],
});
