import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract. Which thread triggers the GC does not matter for the race: any
// allocation on any thread can start a collection between the two reads.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'l-a', label: 'Thread A (liest Cache)', kind: 'pool' },
  { id: 'l-b', label: 'Thread B (alloziert)', kind: 'pool' },
];

const check: Item = {
  id: 'check',
  lane: 'l-a',
  start: 0,
  end: 2,
  label: 'IsAlive: true',
  kind: 'run',
};
const alloc: Item = {
  id: 'alloc',
  lane: 'l-b',
  start: 0,
  end: 3,
  label: 'Allokationen',
  kind: 'run',
};
const gcB: Item = {
  id: 'gc',
  lane: 'l-b',
  start: 3,
  end: 5,
  label: 'GC leert das Weak-Handle',
  kind: 'run',
};
const paused: Item = {
  id: 'paused',
  lane: 'l-a',
  start: 3,
  end: 5,
  label: 'angehalten',
  kind: 'blocked',
};
const read: Item = {
  id: 'read',
  lane: 'l-a',
  start: 5,
  end: 7,
  label: 'Target: null',
  kind: 'run',
};
const crash: Item = {
  id: 'crash',
  lane: 'l-a',
  start: 7,
  end: 9,
  label: 'NullReferenceException',
  kind: 'blocked',
};

export default defineStepScript({
  view: 'timeline',
  title: 'IsAlive prüfen, dann Target lesen: ein Wettlauf',
  code: {
    cs: `if (cacheRef.IsAlive)                 // true
{
    var data = (Data)cacheRef.Target;  // inzwischen null
    data.Use();                        // NullReferenceException
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: { lanes, duration: 10, items: [check, alloc], now: 2 },
      changed: ['check'],
      explanation:
        'Thread A fragt `IsAlive` und bekommt `true`. Gleichzeitig alloziert Thread B fleißig. Die Antwort von `IsAlive` gilt nur für genau diesen Augenblick.',
    },
    {
      codeLine: 2,
      state: { lanes, duration: 10, items: [check, alloc, gcB, paused], now: 5 },
      changed: ['gc', 'paused'],
      explanation:
        'Das Allokationsbudget ist erschöpft, eine Collection startet und hält Thread A an. Kein starker Verweis zeigt auf das Ziel, also setzt der GC das Weak-Handle auf `null`.',
    },
    {
      codeLine: 3,
      state: { lanes, duration: 10, items: [check, alloc, gcB, paused, read], now: 7 },
      changed: ['read'],
      explanation:
        'Thread A läuft weiter und liest `Target`. Der Wert ist jetzt `null`, obwohl die Prüfung eben noch `true` ergab.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: 10, items: [check, alloc, gcB, paused, read, crash], now: 9 },
      changed: ['crash'],
      explanation:
        'Der Aufruf scheitert. Richtig ist: `Target` einmal in eine lokale Variable lesen (oder `TryGetTarget`) und dann nur diese prüfen. Die lokale Variable ist eine starke Root und hält das Objekt fest, solange du es benutzt.',
    },
  ],
});
