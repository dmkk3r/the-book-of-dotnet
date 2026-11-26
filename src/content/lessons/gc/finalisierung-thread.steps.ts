import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract and only show order, not duration.
// TODO(verify): CoreCLR runs all finalizers on a single dedicated finalizer thread
// (finalizerthread.cpp); the documentation only says the thread is unspecified.
// The GC is drawn on the application thread that triggered it (Workstation GC, blocking
// collection); with Server GC dedicated GC threads do the work.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'l-app', label: 'Anwendungs-Thread', kind: 'main' },
  { id: 'l-fin', label: 'Finalizer-Thread' },
];

const work = (id: string, start: number, end: number): Item => ({
  id,
  lane: 'l-app',
  start,
  end,
  label: 'Anfragen bearbeiten',
  kind: 'run',
});
const gc = (id: string, start: number, label = 'GC (Threads angehalten)'): Item => ({
  id,
  lane: 'l-app',
  start,
  end: start + 1,
  label,
  kind: 'blocked',
});
const fin = (id: string, start: number, end: number, label: string): Item => ({
  id,
  lane: 'l-fin',
  start,
  end,
  label,
  kind: 'run',
});

const phase1: Item[] = [work('w1', 0, 3), gc('gc1', 3)];
const phase2: Item[] = [
  work('w2', 4, 8),
  fin('f1', 4, 5, '~LogFile()'),
  fin('f2', 5, 6, '~Connection()'),
];
const phase3: Item[] = [gc('gc2', 8, 'GC gibt beide frei')];
const blocked: Item = {
  id: 'f3',
  lane: 'l-fin',
  start: 10,
  end: 20,
  label: '~Bad() wartet auf einen Lock',
  kind: 'blocked',
};

export default defineStepScript({
  view: 'timeline',
  title: 'Der Finalizer-Thread arbeitet nach der Collection',
  code: {
    cs: `class Bad
{
    ~Bad()
    {
        lock (s_sync) { }   // blockiert, wenn jemand s_sync hält
    }
}`,
  },
  steps: [
    {
      state: { lanes, duration: 20, items: [work('w1', 0, 3)], now: 3 },
      explanation:
        'Der Anwendungs-Thread arbeitet und alloziert. Der Finalizer-Thread schläft: Er wartet darauf, dass ein GC ihm Arbeit gibt.',
    },
    {
      state: { lanes, duration: 20, items: phase1, now: 4 },
      changed: ['gc1'],
      explanation:
        'Eine Collection findet `LogFile` und `Connection` unerreichbar und verschiebt beide in die F-Reachable Queue. Finalizer laufen dabei **nicht**, der GC weckt nur den Finalizer-Thread.',
    },
    {
      state: { lanes, duration: 20, items: [...phase1, ...phase2], now: 8 },
      changed: ['f1', 'f2'],
      explanation:
        'Die Finalizer laufen auf einem eigenen Thread, parallel zur Anwendung. In welcher Reihenfolge, ist nicht festgelegt, auch dann nicht, wenn ein Objekt das andere referenziert.',
    },
    {
      state: { lanes, duration: 20, items: [...phase1, ...phase2, ...phase3], now: 9 },
      changed: ['gc2'],
      explanation:
        'Erst eine spätere Collection der passenden Generation gibt den Speicher frei. Zwischen „unerreichbar“ und „frei“ liegen also mindestens zwei Collections und ein Durchlauf des Finalizer-Threads.',
    },
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 20,
        items: [...phase1, ...phase2, ...phase3, work('w3', 9, 14), blocked],
        now: 14,
        output: 'F-Reachable Queue: 1 Objekt',
      },
      changed: ['f3'],
      explanation:
        'Jetzt blockiert ein Finalizer, hier `~Bad()` auf einem Lock. Es gibt nur diesen einen Finalizer-Thread. Solange er hängt, läuft kein anderer Finalizer.',
    },
    {
      state: {
        lanes,
        duration: 20,
        items: [
          ...phase1,
          ...phase2,
          ...phase3,
          work('w3', 9, 14),
          gc('gc3', 14, 'GC'),
          work('w4', 15, 17),
          gc('gc4', 17, 'GC'),
          work('w5', 18, 20),
          blocked,
        ],
        now: 20,
        output: 'F-Reachable Queue: 1, dann 40, dann 90 Objekte (Beispielwerte)',
      },
      changed: ['gc3', 'gc4'],
      explanation:
        'Jede weitere Collection schiebt neue Objekte mit Finalizer in die F-Reachable Queue, aber niemand arbeitet sie ab. Sie bleiben samt allem, worauf sie zeigen, im Speicher. Ein hängender Finalizer wird so zu einem Speicherleck, das wie ein GC-Problem aussieht.',
    },
  ],
});
