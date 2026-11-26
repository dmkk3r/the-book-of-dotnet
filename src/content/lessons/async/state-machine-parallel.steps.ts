import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract (one unit is roughly 25 ms here). Measured times vary slightly
// because timer resolution and thread scheduling add a few milliseconds.

const lanes: TimelineState['lanes'] = [
  { id: 'main', label: 'Main-Thread', kind: 'main' },
  { id: 'pool', label: 'ThreadPool-Thread', kind: 'pool' },
  { id: 'timer1', label: 'Timer 1 (kein Thread)', kind: 'io' },
  { id: 'timer2', label: 'Timer 2 (kein Thread)', kind: 'io' },
];
type Item = TimelineState['items'][number];
const s1: Item = { id: 's1', lane: 'main', start: 0, end: 1, label: 'Start', kind: 'run' };
const blocked = (end: number): Item => ({
  id: 'blocked',
  lane: 'main',
  start: 1,
  end,
  label: 'wartet auf den Task von Main',
  kind: 'blocked',
});
const d1: Item = { id: 'd1', lane: 'timer1', start: 1, end: 5, label: 'Delay 1', kind: 'wait' };
const c1: Item = {
  id: 'c1',
  lane: 'pool',
  start: 5,
  end: 6,
  label: 'Fortsetzung 1',
  kind: 'continuation',
};
const d2: Item = { id: 'd2', lane: 'timer1', start: 6, end: 10, label: 'Delay 2', kind: 'wait' };
const c2: Item = {
  id: 'c2',
  lane: 'pool',
  start: 10,
  end: 11,
  label: 'Fortsetzung 2',
  kind: 'continuation',
};
const d3: Item = { id: 'd3', lane: 'timer1', start: 11, end: 15, label: 't1', kind: 'wait' };
const d4: Item = { id: 'd4', lane: 'timer2', start: 11, end: 15, label: 't2', kind: 'wait' };
const c3: Item = {
  id: 'c3',
  lane: 'pool',
  start: 15,
  end: 16,
  label: 'nach WhenAll',
  kind: 'continuation',
};

const base = { lanes, duration: 17 };

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'Nacheinander warten oder gleichzeitig warten',
  code: {
    cs: `var sw = Stopwatch.StartNew();
await Task.Delay(100);
await Task.Delay(100);
Console.WriteLine(sw.ElapsedMilliseconds);   // etwa 200

sw.Restart();
Task t1 = Task.Delay(100);
Task t2 = Task.Delay(100);
await Task.WhenAll(t1, t2);
Console.WriteLine(sw.ElapsedMilliseconds);   // etwa 100`,
  },
  steps: [
    {
      codeLine: 2,
      state: { ...base, items: [s1, blocked(2), d1], now: 2 },
      changed: ['d1'],
      explanation:
        'Das erste `await` startet den Timer und gibt den Thread zurück. Die zweite Zeile ist noch nicht einmal erreicht: Der zweite Timer existiert noch gar nicht.',
    },
    {
      codeLine: 3,
      state: {
        ...base,
        items: [s1, blocked(7), d1, c1, d2],
        links: [{ from: 'd1', to: 'c1' }],
        now: 7,
      },
      changed: ['c1', 'd2'],
      explanation:
        'Erst die Fortsetzung nach dem ersten `await` startet das zweite `Task.Delay`. Jedes `await` wartet, bis seine Operation fertig ist, bevor der Code danach überhaupt läuft.',
    },
    {
      codeLine: 4,
      state: {
        ...base,
        items: [s1, blocked(11), d1, c1, d2, c2],
        links: [
          { from: 'd1', to: 'c1' },
          { from: 'd2', to: 'c2' },
        ],
        now: 11,
        output: '~200',
      },
      changed: ['c2'],
      explanation:
        'Häufige Fehlannahme: `async` mache Code parallel. Die beiden Wartezeiten addieren sich zu etwa 200 ms. `await` macht Warten **nicht blockierend**, aber nicht gleichzeitig.',
    },
    {
      codeLine: 8,
      state: {
        ...base,
        items: [s1, blocked(13), d1, c1, d2, c2, d3, d4],
        links: [
          { from: 'd1', to: 'c1' },
          { from: 'd2', to: 'c2' },
        ],
        now: 13,
        output: '~200',
      },
      changed: ['d3', 'd4'],
      explanation:
        'Jetzt werden beide Operationen **gestartet, bevor** gewartet wird. Beide Timer laufen gleichzeitig, und trotzdem ist kein zusätzlicher Thread im Spiel.',
    },
    {
      codeLine: 10,
      state: {
        ...base,
        items: [s1, blocked(16), d1, c1, d2, c2, d3, d4, c3],
        links: [
          { from: 'd1', to: 'c1' },
          { from: 'd2', to: 'c2' },
          { from: 'd3', to: 'c3' },
          { from: 'd4', to: 'c3' },
        ],
        now: 16,
        output: '~200\n~100',
      },
      changed: ['c3'],
      explanation:
        '`Task.WhenAll` ist fertig, sobald beide Tasks fertig sind: nach etwa 100 ms. Gleichzeitigkeit entsteht also dadurch, wann du Operationen startest und wann du wartest, nicht durch das Schlüsselwort `async`.',
    },
  ],
});
