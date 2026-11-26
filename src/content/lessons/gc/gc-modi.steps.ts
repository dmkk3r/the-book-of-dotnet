import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract. Machine with two logical cores, so Server GC has two heaps and two
// GC threads (Microsoft Learn, workstation-server-gc: "A heap and a dedicated thread to perform
// garbage collection are provided for each logical CPU, and the heaps are collected at the same
// time"). Workstation GC runs on the user thread that triggered it (same page).
// Bar lengths only illustrate "parallel collection finishes sooner on the same heap size", which
// Microsoft Learn states; the ratio is not measured.
// TODO(verify): Relative pause length of a gen0 GC with workstation vs. server GC for the same
// survived bytes on two cores.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'w1', label: 'Workstation: Thread 1', kind: 'pool' },
  { id: 'w2', label: 'Workstation: Thread 2', kind: 'pool' },
  { id: 's1', label: 'Server: Thread 1', kind: 'pool' },
  { id: 's2', label: 'Server: Thread 2', kind: 'pool' },
  { id: 'sg0', label: 'Server: GC-Thread Heap 0' },
  { id: 'sg1', label: 'Server: GC-Thread Heap 1' },
];

const item = (
  id: string,
  lane: string,
  start: number,
  end: number,
  label: string,
  kind: Item['kind'] = 'run',
): Item => ({ id, lane, start, end, label, kind });

const before: Item[] = [
  item('w1-a', 'w1', 0, 6, 'allozieren'),
  item('w2-a', 'w2', 0, 6, 'allozieren'),
  item('s1-a', 's1', 0, 6, 'allozieren'),
  item('s2-a', 's2', 0, 6, 'allozieren'),
];

const wks: Item[] = [
  item('w1-gc', 'w1', 6, 12, 'Gen0-GC (ganzer Heap)'),
  item('w2-stop', 'w2', 6, 12, 'angehalten', 'blocked'),
];

const svr: Item[] = [
  item('s1-stop', 's1', 6, 9, 'angehalten', 'blocked'),
  item('s2-stop', 's2', 6, 9, 'angehalten', 'blocked'),
  item('sg0-gc', 'sg0', 6, 9, 'Gen0-GC Heap 0'),
  item('sg1-gc', 'sg1', 6, 9, 'Gen0-GC Heap 1'),
];

const after: Item[] = [
  item('w1-b', 'w1', 12, 18, 'allozieren'),
  item('w2-b', 'w2', 12, 18, 'allozieren'),
  item('s1-b', 's1', 9, 18, 'allozieren'),
  item('s2-b', 's2', 9, 18, 'allozieren'),
];

export default defineStepScript({
  view: 'timeline',
  title: 'Eine Gen0-Collection mit Workstation und mit Server GC',
  layout: 'stacked',
  code: {
    cs: `// Zwei Threads bearbeiten Anfragen, Rechner mit zwei logischen Kernen
void HandleRequest()
{
    var buffer = new byte[4096];   // kurzlebig
    Process(buffer);
}`,
  },
  steps: [
    {
      codeLine: 4,
      state: { lanes, duration: 18, items: before, now: 6 },
      changed: ['w1-a', 'w2-a', 's1-a', 's2-a'],
      explanation:
        'Derselbe Dienst zweimal, oben mit Workstation GC, unten mit Server GC. Bei Workstation teilen sich beide Threads **einen** Heap, bei Server GC gibt es auf zwei Kernen **zwei** Heaps mit je einem eigenen GC-Thread.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: 18, items: [...before, ...wks], now: 12 },
      changed: ['w1-gc', 'w2-stop'],
      explanation:
        'Workstation GC: Thread 1 erschöpft das Gen0-Budget und führt die Collection **selbst** aus, auf seinem eigenen Thread und mit normaler Priorität. Thread 2 ist so lange angehalten.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: 18, items: [...before, ...wks, ...svr], now: 9 },
      changed: ['sg0-gc', 'sg1-gc', 's1-stop', 's2-stop'],
      explanation:
        'Server GC: Die dedizierten GC-Threads wachen auf, halten die Anwendungs-Threads an und sammeln die beiden Heaps **gleichzeitig** ein. Bei gleicher Heapgröße ist die Pause dadurch kürzer.',
    },
    {
      codeLine: 5,
      state: { lanes, duration: 18, items: [...before, ...wks, ...svr, ...after], now: 18 },
      changed: ['s1-b', 's2-b', 'w1-b', 'w2-b'],
      explanation:
        'Beide Varianten laufen danach weiter. Das Bild zeigt nur eine einzelne Collection. Wie oft sie kommt, hängt am Budget, und das ist bei Server GC deutlich größer: seltener, dafür mehr Speicher.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 18,
        items: [...before, ...wks, ...svr, ...after],
        now: 18,
        output:
          'Workstation: 1 Heap, GC auf dem auslösenden Thread. Server: 1 Heap und 1 GC-Thread pro logischem Kern, parallele Collection, größere Budgets.',
      },
      changed: ['sg0-gc', 'sg1-gc'],
      explanation:
        'Häufige Fehlannahme: „Server GC ist einfach der schnellere GC.“ Er kauft Durchsatz mit **Speicher** und mit **Threads**: ein Heap und ein GC-Thread pro Kern, große Budgets. Wo Speicher knapp ist oder viele Prozesse sich die Kerne teilen, kann genau das schaden.',
    },
  ],
});
