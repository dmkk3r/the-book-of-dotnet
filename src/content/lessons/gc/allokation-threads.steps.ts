import { defineStepScript, type TimelineState } from '@/components/viz';

// Two threads allocating with their own allocation contexts (Workstation GC, one heap).
// Time units are abstract. In Workstation GC the GC work runs on the thread that triggered it;
// in Server GC dedicated GC threads do the work.
// TODO(verify): That the SOH slow path is serialized by more_space_lock_soh per heap and that
// Server GC spreads threads across heaps (balance_heaps), see allocation.cpp.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'ta', label: 'Thread A', kind: 'pool' },
  { id: 'tb', label: 'Thread B', kind: 'pool' },
];

const a1: Item = { id: 'a1', lane: 'ta', start: 0, end: 3, label: 'new, schnell', kind: 'run' };
const b1: Item = { id: 'b1', lane: 'tb', start: 0, end: 3, label: 'new, schnell', kind: 'run' };
const a2: Item = { id: 'a2', lane: 'ta', start: 3, end: 5, label: 'langsamer Pfad', kind: 'run' };
const b2: Item = { id: 'b2', lane: 'tb', start: 3, end: 4, label: 'new, schnell', kind: 'run' };
const b3: Item = {
  id: 'b3',
  lane: 'tb',
  start: 4,
  end: 5,
  label: 'wartet auf Lock',
  kind: 'blocked',
};
const b4: Item = { id: 'b4', lane: 'tb', start: 5, end: 6, label: 'langsamer Pfad', kind: 'run' };
const a3: Item = { id: 'a3', lane: 'ta', start: 5, end: 8, label: 'new, schnell', kind: 'run' };
const b5: Item = { id: 'b5', lane: 'tb', start: 6, end: 8, label: 'new, schnell', kind: 'run' };
const a4: Item = {
  id: 'a4',
  lane: 'ta',
  start: 8,
  end: 11,
  label: 'führt Gen0-GC aus',
  kind: 'run',
};
const b6: Item = { id: 'b6', lane: 'tb', start: 8, end: 11, label: 'angehalten', kind: 'blocked' };
const a5: Item = { id: 'a5', lane: 'ta', start: 11, end: 13, label: 'new, schnell', kind: 'run' };
const b7: Item = { id: 'b7', lane: 'tb', start: 11, end: 13, label: 'new, schnell', kind: 'run' };

export default defineStepScript({
  view: 'timeline',
  title: 'Zwei Threads mit eigenen Allocation Contexts',
  code: {
    cs: `Parallel.For(0, 2, _ =>
{
    for (int i = 0; i < 1_000_000; i++)
    {
        var item = new Node();   // jeder Thread in seinem Context
        Process(item);
    }
});`,
  },
  steps: [
    {
      codeLine: 5,
      state: { lanes, duration: 13, items: [a1, b1], now: 3 },
      changed: ['a1', 'b1'],
      explanation:
        'Beide Threads allozieren gleichzeitig, jeder in seinem eigenen Allocation Context. Weil kein anderer Thread dieselben Zeiger verändert, braucht der schnelle Pfad **keinen Lock und keine atomare Operation**.',
    },
    {
      codeLine: 5,
      state: { lanes, duration: 13, items: [a1, b1, a2, b2], now: 4 },
      changed: ['a2', 'b2'],
      explanation:
        'Der Context von Thread A ist voll, A geht in den langsamen Pfad und nimmt den Lock des Heaps. Thread B merkt davon nichts: Er hat noch Platz und alloziert weiter ohne Lock.',
    },
    {
      codeLine: 5,
      state: { lanes, duration: 13, items: [a1, b1, a2, b2, b3, b4], now: 6 },
      changed: ['b3', 'b4'],
      explanation:
        'Erst wenn auch B einen neuen Block braucht, solange A den Lock hält, muss B kurz warten. Konkurrenz entsteht also nur im seltenen langsamen Pfad, einmal pro Block statt einmal pro Objekt.',
    },
    {
      codeLine: 5,
      state: { lanes, duration: 13, items: [a1, b1, a2, b2, b3, b4, a3, b5], now: 8 },
      changed: ['a3', 'b5'],
      explanation:
        'Mit ihren neuen Blöcken sind beide Threads wieder im schnellen Pfad. Jeder neue Block hat das gemeinsame Gen0-Budget weiter verringert.',
    },
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 13,
        items: [a1, b1, a2, b2, b3, b4, a3, b5, a4, b6],
        now: 11,
      },
      changed: ['a4', 'b6'],
      explanation:
        'Thread A findet beim nächsten Block das Budget aufgebraucht und löst eine Collection aus. Bei Workstation GC erledigt A die Arbeit selbst, B wird **angehalten**, obwohl B noch Platz in seinem Context hatte.',
    },
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 13,
        items: [a1, b1, a2, b2, b3, b4, a3, b5, a4, b6, a5, b7],
        now: 13,
      },
      changed: ['a5', 'b7'],
      explanation:
        'Nach der Collection bekommen beide Threads neue Contexts und laufen weiter. Die Pause trifft also jeden Thread, gesteuert wird ihre Häufigkeit aber von der Allokationsrate des ganzen Prozesses.',
    },
  ],
});
