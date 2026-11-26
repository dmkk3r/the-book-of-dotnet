import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.
// TODO(verify): Box type name AsyncStateMachineBox<TStateMachine> and that it derives from Task<TResult>
// (AsyncTaskMethodBuilderT.cs in dotnet/runtime, since .NET Core 3.0 per Stephen Toub's blog post).
// TODO(verify): In Release, only locals that live across an await (here: a) become fields; b stays a local.
// TODO(verify): One allocation for the box only (no separate Task, no ExecutionContext allocation with the default context).
// TODO(verify): Lowered code against SharpLab ("C#" output, Release); field names are simplified.

const FAST = '0x7F3A0100';
const SLOW = '0x7F3A0140';
const BOX = '0x7F3A0200';

type Phase = 'kickoff' | 'fast' | 'suspend' | 'boxed' | 'returned' | 'resumed' | 'completed';

const order: Phase[] = ['kickoff', 'fast', 'suspend', 'boxed', 'returned', 'resumed', 'completed'];
const atLeast = (p: Phase, q: Phase) => order.indexOf(p) >= order.indexOf(q);

function state(p: Phase, output?: string): MemoryState {
  const onStack = !atLeast(p, 'returned');
  const boxed = atLeast(p, 'boxed');
  const slowDone = atLeast(p, 'resumed');
  const done = p === 'completed';

  const frames: MemoryState['frames'] = [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        {
          id: 't',
          name: 't',
          type: 'Task<int> (Verweis)',
          value: atLeast(p, 'returned') ? BOX : 'noch nicht zugewiesen',
          ...(atLeast(p, 'returned') ? { ref: 'box' } : {}),
        },
      ],
    },
  ];
  if (onStack) {
    frames.push({
      id: 'kick',
      method: 'SumAsync() (Kickoff)',
      slots: [
        {
          id: 'sm.state',
          name: 'sm.state',
          type: 'int (Struct-Feld)',
          value: atLeast(p, 'suspend') ? '0' : '-1',
        },
        {
          id: 'sm.a',
          name: 'sm.a',
          type: 'int (Struct-Feld)',
          value: atLeast(p, 'fast') ? '1' : '0',
        },
        {
          id: 'sm.awaiter',
          name: 'sm.awaiter',
          type: 'TaskAwaiter<int> (Struct-Feld)',
          value: atLeast(p, 'suspend') ? `→ ${SLOW}` : 'leer',
          ...(atLeast(p, 'suspend') ? { ref: 'slow' } : {}),
        },
        {
          id: 'sm.builder',
          name: 'sm.builder',
          type: 'AsyncTaskMethodBuilder<int>',
          value: boxed ? `Task → ${BOX}` : 'noch kein Task',
          ...(boxed ? { ref: 'box' } : {}),
        },
      ],
    });
  }
  if (p === 'resumed') {
    frames.push({
      id: 'resume',
      method: 'MoveNext() (Thread von SetResult)',
      slots: [
        { id: 'this', name: 'this', type: 'Verweis in die Box', value: BOX, ref: 'box' },
        { id: 'b', name: 'b', type: 'int (lokal)', value: '2' },
      ],
    });
  }

  const heap: MemoryState['heap'] = [
    {
      id: 'fast',
      type: 'Task<int>',
      address: FAST,
      generation: 0,
      fields: [
        { name: 'Status', value: 'RanToCompletion' },
        { name: 'Result', value: '1' },
      ],
    },
    {
      id: 'slow',
      type: 'Task<int>',
      address: SLOW,
      generation: 0,
      fields: [
        { name: 'Status', value: slowDone ? 'RanToCompletion' : 'läuft noch' },
        { name: 'Result', value: slowDone ? '2' : 'leer' },
        {
          name: 'Fortsetzung',
          value: boxed && !slowDone ? `→ ${BOX}` : 'keine',
          ...(boxed && !slowDone ? { ref: 'box' } : {}),
        },
      ],
    },
  ];
  if (boxed) {
    heap.push({
      id: 'box',
      type: 'AsyncStateMachineBox (zugleich der Task)',
      address: BOX,
      generation: 0,
      fields: [
        { name: 'Status', value: done ? 'RanToCompletion' : 'läuft noch' },
        { name: 'Result', value: done ? '3' : 'leer' },
        { name: 'sm.state', value: done ? '-2' : slowDone ? '-1' : '0' },
        { name: 'sm.a', value: '1' },
        {
          name: 'sm.awaiter',
          value: slowDone ? 'leer' : `→ ${SLOW}`,
          ...(slowDone ? {} : { ref: 'slow' }),
        },
      ],
    });
  }

  return { frames, heap, ...(output !== undefined ? { output } : {}) };
}

export default defineStepScript({
  view: 'memory',
  title: 'State Machine als Struct und ihr Umzug auf den Heap',
  code: {
    cs: `static async Task<int> SumAsync(Task<int> fast, Task<int> slow)
{
    int a = await fast;   // bereits abgeschlossen
    int b = await slow;   // noch nicht abgeschlossen
    return a + b;
}

var tcs = new TaskCompletionSource<int>();
Task<int> t = SumAsync(Task.FromResult(1), tcs.Task);
// später, auf irgendeinem Thread:
tcs.SetResult(2);`,
    lowered: `// stark vereinfacht (Release-Build)
struct SumAsyncStateMachine : IAsyncStateMachine
{
    public int state;
    public AsyncTaskMethodBuilder<int> builder;
    public Task<int> fast, slow;   // Parameter als Felder
    int a;                         // lebt über ein await hinweg
    TaskAwaiter<int> awaiter;
    public void MoveNext() { /* wie im ersten Beispiel */ }
}

static Task<int> SumAsync(Task<int> fast, Task<int> slow)
{
    var sm = new SumAsyncStateMachine();
    sm.builder = AsyncTaskMethodBuilder<int>.Create();
    sm.fast = fast; sm.slow = slow;
    sm.state = -1;
    sm.builder.Start(ref sm);      // ruft sm.MoveNext() synchron
    return sm.builder.Task;
}`,
  },
  steps: [
    {
      codeLine: 9,
      highlight: { lowered: [14, 15, 16, 17] },
      state: state('kickoff'),
      changed: ['sm.state', 'sm.a', 'sm.awaiter', 'sm.builder'],
      explanation:
        'Der Kickoff legt die State Machine als **lokale Struct-Variable** `sm` in seinem eigenen Stack-Frame an. Auf dem Heap liegen bisher nur die beiden Tasks, die als Argumente übergeben wurden.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [18] },
      state: state('fast'),
      changed: ['sm.a'],
      explanation:
        '`Start` ruft `MoveNext` synchron auf. `fast` ist schon abgeschlossen, also liefert `IsCompleted` `true`: `MoveNext` holt das Ergebnis mit `GetResult` und macht einfach weiter. Das ist der **synchrone Fast Path**: keine Fortsetzung, kein Threadwechsel, keine Allokation.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [18] },
      state: state('suspend'),
      changed: ['sm.state', 'sm.awaiter'],
      explanation:
        '`slow` ist noch nicht fertig. `MoveNext` setzt `state = 0` und legt den Awaiter in sein Feld. Noch liegt die gesamte State Machine auf dem Stack.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [18] },
      state: state('boxed'),
      changed: ['box', 'slow.Fortsetzung', 'sm.builder'],
      explanation:
        'Jetzt muss der Zustand den Stack-Frame überleben. `AwaitUnsafeOnCompleted` **kopiert** das Struct deshalb in ein Box-Objekt auf dem Heap und hängt diese Box als Fortsetzung an `slow`. Diese Box ist zugleich der Task, den `SumAsync` zurückgibt.',
    },
    {
      codeLine: 9,
      highlight: { lowered: [19] },
      state: state('returned'),
      changed: ['t'],
      explanation:
        '`MoveNext` kehrt zurück, danach der Kickoff mit `builder.Task`. Sein Frame samt Struct verschwindet, `t` zeigt auf die Box. Häufige Fehlannahme: Mit dem Stack-Frame gehe der Zustand verloren. Er lebt in der Box weiter, `a = 1` inklusive.',
    },
    {
      codeLine: 11,
      state: state('resumed'),
      changed: ['slow.Status', 'slow.Result', 'box.sm.state', 'box.sm.awaiter', 'resume', 'b'],
      explanation:
        '`SetResult(2)` schließt `slow` ab und ruft die Fortsetzung auf, typischerweise gleich auf dem Thread, der `SetResult` aufruft. `MoveNext` läuft jetzt **auf der Box**, holt das Ergebnis und hat `b = 2`. `b` musste nie ein Feld werden, weil es kein `await` überlebt.',
    },
    {
      codeLine: 5,
      state: state('completed'),
      changed: ['box.Status', 'box.Result', 'box.sm.state'],
      explanation:
        '`return a + b` wird zu `builder.SetResult(3)`. Die Box ist der Task, also steht das Ergebnis direkt in ihr, und `t` ist abgeschlossen. Die State Machine selbst hat damit genau ein Objekt gekostet, und zwar erst, als sie wirklich warten musste.',
    },
  ],
});
