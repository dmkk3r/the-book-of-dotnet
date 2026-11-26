import { defineStepScript, type TimelineState } from '@/components/viz';

// TODO(verify): Lowered code against SharpLab ("C#" output, Release). It is heavily simplified here:
// real field names are compiler generated (e.g. <>1__state, <>t__builder, <>u__1) and the kickoff
// method is not shown.
// Time units are abstract; Task.Delay(100) spans 8 units only for readability.

const lanes: TimelineState['lanes'] = [
  { id: 'main', label: 'Main-Thread', kind: 'main' },
  { id: 'pool', label: 'ThreadPool-Thread', kind: 'pool' },
  { id: 'timer', label: 'Timer (kein Thread)', kind: 'io' },
];
type Item = TimelineState['items'][number];
const kick: Item = {
  id: 'kick',
  lane: 'main',
  start: 0,
  end: 1,
  label: 'Kickoff: Start',
  kind: 'run',
};
const a: Item = { id: 'a', lane: 'main', start: 1, end: 2, label: 'MoveNext: "A"', kind: 'run' };
const delay: Item = {
  id: 'delay',
  lane: 'timer',
  start: 2,
  end: 10,
  label: 'Task.Delay(100)',
  kind: 'wait',
};
const suspend: Item = {
  id: 'suspend',
  lane: 'main',
  start: 2,
  end: 3,
  label: 'state = 0, return',
  kind: 'run',
};
const blocked = (end: number): Item => ({
  id: 'blocked',
  lane: 'main',
  start: 3,
  end,
  label: 'GetAwaiter().GetResult()',
  kind: 'blocked',
});
const b: Item = {
  id: 'b',
  lane: 'pool',
  start: 10,
  end: 12,
  label: 'MoveNext: "B"',
  kind: 'continuation',
};
const done: Item = { id: 'done', lane: 'main', start: 12, end: 13, label: 'Ende', kind: 'run' };

const base = { lanes, duration: 14 };

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'async/await Schritt für Schritt',
  code: {
    cs: `static async Task Main()
{
    Console.WriteLine("A");
    await Task.Delay(100);
    Console.WriteLine("B");
}`,
    lowered: `// stark vereinfacht (Release-Build)
void MoveNext()
{
    TaskAwaiter awaiter;
    try
    {
        if (state != 0)                // erster Aufruf: state == -1
        {
            Console.WriteLine("A");
            awaiter = Task.Delay(100).GetAwaiter();
            if (!awaiter.IsCompleted)
            {
                state = 0;
                this.awaiter = awaiter;
                builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);
                return;                // Thread wird frei
            }
        }
        else                           // Fortsetzung: state == 0
        {
            awaiter = this.awaiter;
            this.awaiter = default;
            state = -1;
        }
        awaiter.GetResult();
        Console.WriteLine("B");
    }
    catch (Exception e)
    {
        state = -2;
        builder.SetException(e);
        return;
    }
    state = -2;
    builder.SetResult();
}`,
  },
  steps: [
    {
      codeLine: 1,
      highlight: { lowered: [2] },
      state: { ...base, items: [kick], now: 1 },
      changed: ['kick'],
      explanation:
        'Vom ursprünglichen Methodenrumpf ist nur ein kurzer **Kickoff** übrig: Er legt die State Machine an, setzt `state = -1` und ruft über den Builder `MoveNext` auf. Dieser erste Aufruf läuft **synchron** auf dem aufrufenden Thread.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [7, 9] },
      state: { ...base, items: [kick, a], now: 2, output: 'A' },
      changed: ['a'],
      explanation:
        'Weil `state` nicht 0 ist, nimmt `MoveNext` den Zweig für den ersten Aufruf und gibt „A“ aus. Bis zum ersten `await` ist eine async-Methode also ganz gewöhnlicher, synchroner Code.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [10] },
      state: { ...base, items: [kick, a, delay], now: 2.5, output: 'A' },
      changed: ['delay'],
      explanation:
        '`Task.Delay(100)` startet einen Timer und liefert sofort einen noch nicht abgeschlossenen Task. **Während der 100 ms läuft kein Thread** für diesen Task, nur ein Timer-Eintrag wartet.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [11, 13, 14, 15, 16] },
      state: { ...base, items: [kick, a, delay, suspend], now: 3, output: 'A' },
      changed: ['suspend'],
      explanation:
        '`IsCompleted` ist `false`. Die State Machine merkt sich in `state`, an welchem `await` sie steht, legt den Awaiter in einem Feld ab, registriert sich über `AwaitUnsafeOnCompleted` als Fortsetzung und **kehrt zurück**.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [16] },
      state: { ...base, items: [kick, a, delay, suspend, blocked(5)], now: 5, output: 'A' },
      changed: ['blocked'],
      explanation:
        'Häufige Fehlannahme: Der Main-Thread blockiert hier wegen `await`. Er blockiert nur, weil der vom Compiler erzeugte Einstiegspunkt `Main().GetAwaiter().GetResult()` aufruft. In einer Web-App oder einer UI wäre der Thread jetzt frei für andere Arbeit.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [19, 21, 22, 23, 25, 26] },
      state: {
        ...base,
        items: [kick, a, delay, suspend, blocked(12), b],
        links: [{ from: 'delay', to: 'b' }],
        now: 12,
        output: 'A\nB',
      },
      changed: ['b'],
      explanation:
        'Der Timer feuert, der Task wird abgeschlossen und ruft die Fortsetzung auf: **dasselbe `MoveNext`**, diesmal mit `state == 0`. Es holt den Awaiter zurück, ruft `GetResult` und gibt „B“ aus, ohne SynchronizationContext auf einem ThreadPool-Thread.',
    },
    {
      codeLine: 6,
      highlight: { lowered: [34, 35] },
      state: {
        ...base,
        items: [kick, a, delay, suspend, blocked(12), b, done],
        links: [{ from: 'delay', to: 'b' }],
        now: 13,
        output: 'A\nB',
      },
      changed: ['done'],
      explanation:
        '`state = -2` markiert die State Machine als fertig, `SetResult` schließt den Task von `Main` ab. Damit endet das Warten im Einstiegspunkt, und der Prozess endet.',
    },
  ],
});
