import { defineStepScript, type TimelineState } from '@/components/viz';

// Schematic timeline, not a measurement. Time units and memory numbers are illustrative.
// TODO(verify): How the GC behaves when approaching the heap hard limit (more frequent full
// compacting GCs before OutOfMemoryException) in gc.cpp, and the exact OOM kill signal and exit
// code (SIGKILL, exit code 137) reported by Docker and Kubernetes ("OOMKilled").

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'app', label: 'Anfrage-Threads', kind: 'pool' },
  { id: 'gc', label: 'GC', kind: 'main' },
  { id: 'kernel', label: 'Kernel (cgroup)', kind: 'io' },
];

const work = (id: string, start: number, end: number, label = 'Anfragen'): Item => ({
  id,
  lane: 'app',
  start,
  end,
  label,
  kind: 'run',
});
const gc = (id: string, start: number, end: number, label: string): Item => ({
  id,
  lane: 'gc',
  start,
  end,
  label,
  kind: 'blocked',
});

const phase1: Item[] = [
  work('w1', 0, 3),
  gc('g1', 3, 4, 'Gen0'),
  work('w2', 4, 7),
  gc('g2', 7, 8, 'Gen1'),
  work('w3', 8, 11),
];

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'Zwei Arten, an eine Speichergrenze zu stoßen',
  code: {
    cs: `// Container-Limit 512 MiB, Heap Hard Limit 384 MiB (Standard)
var cache = new List<byte[]>();
while (true)
{
    cache.Add(new byte[64 * 1024]);   // verwaltet: zählt zum GC-Heap
    NativeMemory.Alloc(1024 * 1024);  // nativ: zählt nur zum Container
}`,
  },
  steps: [
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 24,
        items: phase1,
        now: 11,
        output: 'GC-Heap: 120 MiB von 384 MiB\nProzess gesamt: 180 MiB von 512 MiB',
      },
      changed: ['w1', 'g1', 'w2', 'g2', 'w3'],
      explanation:
        'Normalbetrieb: Die Threads allozieren, ab und zu läuft eine ephemere Collection. Der GC-Heap liegt weit unter seinem Hard Limit, der Prozess weit unter dem Container-Limit.',
    },
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 24,
        items: [
          ...phase1,
          gc('g3', 11, 13, 'Gen2 kompaktierend'),
          work('w4', 13, 14),
          gc('g4', 14, 16, 'Gen2 kompaktierend'),
        ],
        now: 16,
        output: 'GC-Heap: 380 MiB von 384 MiB\nProzess gesamt: 450 MiB von 512 MiB',
      },
      changed: ['g3', 'w4', 'g4'],
      explanation:
        'Szenario A: Der Cache hält alles fest, der GC-Heap nähert sich seinen 384 MiB. Der GC kennt diese Grenze und arbeitet härter: volle, kompaktierende Collections in immer kürzeren Abständen, die Threads kommen kaum noch zum Arbeiten.',
    },
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 24,
        items: [
          ...phase1,
          gc('g3', 11, 13, 'Gen2 kompaktierend'),
          work('w4', 13, 14),
          gc('g4', 14, 16, 'Gen2 kompaktierend'),
          {
            id: 'oom',
            lane: 'app',
            start: 16,
            end: 17,
            label: 'OutOfMemoryException',
            kind: 'blocked',
          },
          work('w5', 17, 20, 'Fehlerbehandlung, Log'),
        ],
        now: 20,
        output:
          'System.OutOfMemoryException auf dem allozierenden Thread\nProzess läuft weiter, kann loggen und sich beenden',
      },
      changed: ['oom', 'w5'],
      explanation:
        'Reicht auch die volle Collection nicht, wirft die Allokation eine **OutOfMemoryException**. Das ist eine .NET-Ausnahme: Der Prozess lebt noch, kann sie protokollieren und geordnet herunterfahren.',
    },
    {
      codeLine: 6,
      state: {
        lanes,
        duration: 24,
        items: [
          ...phase1,
          work('w4b', 11, 15, 'Anfragen (nativ wächst)'),
          { id: 'kill', lane: 'kernel', start: 15, end: 16, label: 'OOM-Kill', kind: 'blocked' },
        ],
        now: 16,
        output:
          'GC-Heap: 150 MiB von 384 MiB\nProzess gesamt: 512 MiB von 512 MiB\nKernel beendet den Prozess (OOMKilled)',
      },
      changed: ['w4b', 'kill'],
      explanation:
        'Szenario B: Der GC-Heap ist klein, aber **nativer Speicher** wächst. Den sieht das Heap Hard Limit nicht. Erreicht der ganze Prozess das Container-Limit, beendet ihn der Kernel sofort, ohne Ausnahme, ohne `finally`, ohne Log aus .NET.',
    },
    {
      codeLine: 1,
      state: {
        lanes,
        duration: 24,
        items: [
          ...phase1,
          work('w4b', 11, 15, 'Anfragen (nativ wächst)'),
          { id: 'kill', lane: 'kernel', start: 15, end: 16, label: 'OOM-Kill', kind: 'blocked' },
        ],
        now: 16,
        output:
          'Hard Limit: Grenze, die der GC kennt und einhält\nContainer-Limit: Grenze, die der Kernel durchsetzt',
      },
      changed: [],
      explanation:
        'Häufige Fehlannahme: Ein Heap Hard Limit schütze vor dem OOM-Kill. Es schützt nur vor einem zu großen GC-Heap. Der Abstand zwischen beiden Grenzen muss für allen anderen Speicher des Prozesses reichen.',
    },
  ],
});
