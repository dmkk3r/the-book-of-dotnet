import { defineStepScript, type TimelineState } from '@/components/viz';

// TODO(verify): Monitor implementation details (spin before blocking, inflation to a sync block
// on contention) against syncblk.cpp / objectnative.cpp for the documented .NET version.

const lanes: TimelineState['lanes'] = [
  { id: 't1', label: 'Thread 1', kind: 'pool' },
  { id: 't2', label: 'Thread 2', kind: 'pool' },
];
type Item = TimelineState['items'][number];
const t1Hold = (end: number): Item => ({
  id: 't1-hold',
  lane: 't1',
  start: 0,
  end,
  label: 'lock (o) gehalten',
  kind: 'run',
});
const t2Spin: Item = {
  id: 't2-spin',
  lane: 't2',
  start: 2,
  end: 4,
  label: 'versucht, dreht kurz',
  kind: 'run',
};
const t2Wait = (end: number): Item => ({
  id: 't2-wait',
  lane: 't2',
  start: 4,
  end,
  label: 'wartet (Sync Block)',
  kind: 'blocked',
});
const t1After: Item = {
  id: 't1-after',
  lane: 't1',
  start: 9,
  end: 12,
  label: 'weiter ohne Sperre',
  kind: 'run',
};
const t2Hold: Item = {
  id: 't2-hold',
  lane: 't2',
  start: 9,
  end: 12,
  label: 'lock (o) gehalten',
  kind: 'continuation',
};

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'Umkämpfte Sperre Schritt für Schritt',
  code: {
    cs: `object gate = new object();

// Thread 1 und Thread 2 führen gleichzeitig aus:
lock (gate)
{
    Arbeit();
}`,
  },
  steps: [
    {
      codeLine: 4,
      state: { lanes, duration: 12, items: [t1Hold(2)], now: 2 },
      changed: ['t1-hold'],
      explanation:
        'Thread 1 betritt den `lock` als Erster. Die Sperre ist frei, also trägt er sich mit einer atomaren Operation als Besitzer in den Object Header ein. Das ist ein **Thin Lock**, eine weitere Struktur braucht es nicht.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: 12, items: [t1Hold(4), t2Spin], now: 4 },
      changed: ['t2-spin'],
      explanation:
        'Thread 2 will dieselbe Sperre. Der Header zeigt einen anderen Besitzer. Weil Sperren oft nur sehr kurz gehalten werden, versucht Thread 2 es zunächst einige Male in kurzer Folge, statt sofort einzuschlafen.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: 12, items: [t1Hold(9), t2Spin, t2Wait(9)], now: 7 },
      changed: ['t2-wait'],
      explanation:
        'Die Sperre bleibt belegt. Thread 2 muss richtig warten, und dafür braucht es eine Warteschlange und ein Ereignis, auf das er schlafen kann. Das passt nicht in 8 Byte Header. Die Sperre wird deshalb zu einem **Sync Block** aufgebläht, der Header enthält nur noch dessen Index.',
    },
    {
      codeLine: 7,
      state: {
        lanes,
        duration: 12,
        items: [t1Hold(9), t1After, t2Spin, t2Wait(9), t2Hold],
        links: [{ from: 't1-hold', to: 't2-hold' }],
        now: 10,
      },
      changed: ['t2-hold'],
      explanation:
        'Thread 1 verlässt den `lock` und gibt die Sperre frei. Über den Sync Block wird Thread 2 geweckt und übernimmt die Sperre. Häufige Fehlannahme: Ein `lock` koste immer einen Wechsel in den Betriebssystemkern. Unumkämpft bleibt er ein einziger atomarer Befehl auf dem Header.',
    },
  ],
});
