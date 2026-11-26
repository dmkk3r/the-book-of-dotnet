import { defineStepScript, type GraphState } from '@/components/viz';

// The first-pass decision for every frame, for the scenario of exception-handling.steps.ts
// (B throws InvalidOperationException; B has a finally, A has catch ArgumentException and a
// finally, Main has a filter for InvalidOperationException).
// Sources: ECMA-335 Partition I, 12.4.2 (first pass looks for a protected block that covers the
// instruction pointer and is a catch handler or a filter that wishes to handle the exception;
// finally and fault handlers are only run during the second pass; no match means the exception
// is unhandled); BOTR exceptions.md.
// Simplification: "Klausel deckt IP ab?" walks the clauses of the method in table order (inner
// clauses first). The real implementation also handles exceptions thrown inside handlers and
// filters (nested dispatch), which is left out here.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'frame', label: 'Frame prüfen', detail: 'Durchlauf 1', row: 1, col: 1, shape: 'state' },
  { id: 'covers', label: 'Nächste Klausel deckt IP ab?', row: 1, col: 2, shape: 'decision' },
  { id: 'kind', label: 'Art der Klausel?', row: 1, col: 3, shape: 'decision' },
  { id: 'type', label: 'Typ passt?', detail: 'catch mit Typ', row: 1, col: 4, shape: 'decision' },
  { id: 'up', label: 'Zum Aufrufer', detail: 'virtueller Unwind', row: 2, col: 1 },
  { id: 'skip', label: 'Klausel übergehen', detail: 'nichts ausführen', row: 2, col: 2 },
  { id: 'filter', label: 'Filter ausführen', detail: 'Funclet, Stack unverändert', row: 2, col: 3 },
  { id: 'found', label: 'Handler gefunden', detail: 'Ziel merken', row: 2, col: 4 },
  { id: 'none', label: 'Unbehandelt', detail: 'kein Aufrufer mehr', row: 3, col: 1, shape: 'end' },
  { id: 'ftrue', label: 'Filter liefert true?', row: 3, col: 3, shape: 'decision' },
  {
    id: 'pass2',
    label: 'Durchlauf 2',
    detail: 'abwickeln, catch betreten',
    row: 3,
    col: 4,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'frame', to: 'covers' },
  { from: 'covers', to: 'kind', label: 'ja' },
  { from: 'covers', to: 'up', label: 'keine mehr' },
  { from: 'up', to: 'frame', label: 'Aufrufer' },
  { from: 'up', to: 'none', label: 'Stack zu Ende' },
  { from: 'kind', to: 'skip', label: 'finally, fault' },
  { from: 'kind', to: 'type', label: 'catch' },
  { from: 'kind', to: 'filter', label: 'filter' },
  { from: 'type', to: 'skip', label: 'nein' },
  { from: 'type', to: 'found', label: 'ja' },
  { from: 'skip', to: 'covers', label: 'weiter' },
  { from: 'filter', to: 'ftrue' },
  { from: 'ftrue', to: 'found', label: 'true' },
  { from: 'ftrue', to: 'skip', label: 'false' },
  { from: 'found', to: 'pass2' },
];

function run(path: string[], facts: Fact[], rejected: string[] = []): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status: rejected.includes(n.id)
        ? 'rejected'
        : n.id === path[path.length - 1]
          ? 'active'
          : visited.has(n.id)
            ? 'done'
            : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Die Entscheidung in jedem Frame',
  code: {
    cs: `// Stack beim Wurf, jüngster Frame oben:
// B()     try { throw new InvalidOperationException(); }
//         finally { ... }
// A()     try { B(); }
//         catch (ArgumentException) { ... }
//         finally { ... }
// Main()  try { A(); }
//         catch (InvalidOperationException) when (Log(...)) { ... }`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(
        ['frame', 'covers', 'kind', 'skip'],
        [fact('f-frame', 'Frame', 'B'), fact('f-clause', 'Klausel', 'finally')],
      ),
      changed: ['skip', 'f-frame', 'f-clause'],
      explanation:
        'Frame `B`: Die einzige Klausel ist ein `finally`, und sie deckt den Wurfpunkt ab. In Durchlauf 1 wird sie übergangen, denn ein `finally` beendet eine Exception nie. Es läuft auch nicht, es wird nur später gebraucht.',
    },
    {
      codeLine: 4,
      state: run(
        ['skip', 'covers', 'up', 'frame'],
        [fact('f-frame', 'Frame', 'A'), fact('f-how', 'Weg', 'Unwind-Info von B')],
      ),
      changed: ['up', 'frame', 'f-frame', 'f-how'],
      explanation:
        'Keine weitere Klausel in `B`. Die Suche rechnet mit der Unwind-Info den Aufrufer aus, genau wie ein Stack Walk. Am echten Stack ändert sich dabei nichts.',
    },
    {
      codeLine: 5,
      state: run(
        ['frame', 'covers', 'kind', 'type', 'skip'],
        [
          fact('f-frame', 'Frame', 'A'),
          fact('f-clause', 'Klausel', 'catch ArgumentException'),
          fact('f-type', 'Exception', 'InvalidOperationException'),
        ],
        ['type'],
      ),
      changed: ['type', 'skip', 'f-clause', 'f-type'],
      explanation:
        'Die erste Klausel in `A` ist ein `catch (ArgumentException)`. Die Typprüfung schlägt fehl, denn `InvalidOperationException` leitet nicht von `ArgumentException` ab. Die Klausel wird übergangen.',
    },
    {
      codeLine: 6,
      state: run(
        ['skip', 'covers', 'kind', 'skip', 'covers', 'up', 'frame'],
        [fact('f-frame', 'Frame', 'Main'), fact('f-clause', 'Klausel', 'finally in A übergangen')],
      ),
      changed: ['up', 'frame', 'f-frame', 'f-clause'],
      explanation:
        'Auch das `finally` von `A` wird nur übergangen. Danach geht es weiter zum Aufrufer `Main`.',
    },
    {
      codeLine: 8,
      state: run(
        ['frame', 'covers', 'kind', 'filter', 'ftrue'],
        [
          fact('f-frame', 'Frame', 'Main'),
          fact('f-clause', 'Klausel', 'filter'),
          fact('f-out', 'Ausgabe', 'Filter in Main'),
        ],
      ),
      changed: ['filter', 'ftrue', 'f-clause', 'f-out'],
      explanation:
        'In `Main` steht eine **filter**-Klausel. Die Runtime ruft den Filter als Funclet auf, während `B` und `A` noch auf dem Stack liegen. Hier fragt der Filter zuerst den Typ ab und ruft dann `Log` auf.',
    },
    {
      codeLine: 8,
      state: run(
        ['filter', 'ftrue', 'found', 'pass2'],
        [
          fact('f-frame', 'Ziel', 'catch in Main'),
          fact('f-next', 'Durchlauf 2', 'finally B, finally A, catch Main'),
        ],
      ),
      changed: ['found', 'pass2', 'f-frame', 'f-next'],
      explanation:
        'Der Filter liefert `true`, das Ziel steht fest. Jetzt beginnt Durchlauf 2 und führt die übergangenen `finally`-Blöcke von innen nach außen aus, bevor er den `catch` betritt.',
    },
    {
      codeLine: 8,
      state: run(
        ['filter', 'ftrue', 'skip', 'covers', 'up', 'none'],
        [
          fact('f-frame', 'Variante', 'Log liefert false'),
          fact('f-next', 'Folge', 'UnhandledException, Prozessende'),
        ],
        ['ftrue'],
      ),
      changed: ['none', 'f-frame', 'f-next'],
      explanation:
        'Gedankenexperiment: Liefert der Filter `false`, sucht die Runtime weiter und findet oberhalb von `Main` keinen Handler mehr. Die Exception ist **unbehandelt**. Durchlauf 2 findet dann nicht wie gewohnt statt, und ob die `finally`-Blöcke noch laufen, ist nicht garantiert.',
    },
  ],
});
