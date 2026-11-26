import { defineStepScript, type GraphState } from '@/components/viz';

// The states of a compiler generated iterator object (method returning IEnumerable<T>).
// TODO(verify): State values as emitted by Roslyn: -2 enumerable not yet enumerated, 0 before the
// first MoveNext, -1 running or finished, 1..n suspended after the n-th yield return, -3 and below
// running inside a try with finally. Whether Dispose sets the state to -2 in newer Roslyn versions.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

// Edge labels are short; the explanations name the triggers (GetEnumerator, yield break,
// exceptions, Dispose before the first MoveNext).
const NODES: Omit<Node, 'status'>[] = [
  {
    id: 'created',
    label: 'Erzeugt',
    detail: '-2: nur als IEnumerable',
    row: 1,
    col: 1,
    shape: 'state',
  },
  { id: 'before', label: 'Vor dem Start', detail: '0', row: 1, col: 2, shape: 'state' },
  {
    id: 'running',
    label: 'Läuft',
    detail: '-1 (im try mit finally: -3)',
    row: 1,
    col: 3,
    shape: 'state',
  },
  {
    id: 'suspended',
    label: 'Angehalten',
    detail: '1 bis n: hinter dem n-ten yield',
    row: 1,
    col: 4,
    shape: 'state',
  },
  {
    id: 'copy',
    label: 'Neue Instanz',
    detail: '0: zweite Aufzählung oder anderer Thread',
    row: 2,
    col: 1,
    shape: 'state',
  },
  { id: 'after', label: 'Beendet', detail: 'MoveNext liefert false', row: 2, col: 3, shape: 'end' },
];

const EDGES: Edge[] = [
  { from: 'created', to: 'before', label: 'erstes Mal' },
  { from: 'created', to: 'copy', label: 'sonst' },
  { from: 'copy', to: 'running', label: 'MoveNext' },
  { from: 'before', to: 'running', label: 'MoveNext' },
  { from: 'running', to: 'suspended', label: 'yield return' },
  { from: 'suspended', to: 'running', label: 'MoveNext' },
  { from: 'running', to: 'after', label: 'Ende' },
  { from: 'suspended', to: 'after', label: 'Dispose' },
];

/** `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], facts: Fact[]): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
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
  title: 'Die Zustände eines Iterators',
  code: {
    cs: `IEnumerable<int> seq = Range(10, 1);       // ein Element

IEnumerator<int> a = seq.GetEnumerator();   // dasselbe Objekt
IEnumerator<int> b = seq.GetEnumerator();   // ein neues Objekt

a.MoveNext();   // true, a.Current == 10
a.MoveNext();   // false

foreach (int v in Range(10, 5))
    break;      // Dispose mitten in der Aufzählung`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(['created'], [fact('f-state', 'seq: Zustand', '-2')]),
      changed: ['created', 'f-state'],
      explanation:
        'Der Aufruf erzeugt das Objekt im Zustand -2. Es ist in diesem Moment nur ein `IEnumerable<int>`: eine Beschreibung der Sequenz, die noch niemand aufzählt.',
    },
    {
      codeLine: 3,
      state: run(
        ['created', 'before'],
        [fact('f-state', 'a: Zustand', '0'), fact('f-same', 'a == seq', 'ja')],
      ),
      changed: ['before', 'f-state', 'f-same'],
      explanation:
        'Das erste `GetEnumerator` auf demselben Thread, der das Objekt erzeugt hat, verwandelt das Objekt selbst in den Enumerator. Das spart für den häufigsten Fall, einmal erzeugen und sofort aufzählen, eine zweite Allokation.',
    },
    {
      codeLine: 4,
      state: run(
        ['created', 'copy'],
        [fact('f-state', 'b: Zustand', '0'), fact('f-same', 'b == seq', 'nein')],
      ),
      changed: ['copy', 'f-state', 'f-same'],
      explanation:
        'Ein zweites `GetEnumerator` findet den Zustand nicht mehr bei -2 und legt eine **neue** Instanz im Zustand 0 an, mit frischen Kopien der Argumente. Deshalb kannst du eine Iterator-Sequenz mehrfach aufzählen, und jede Aufzählung führt den Code von vorn aus.',
    },
    {
      codeLine: 6,
      state: run(['created', 'before', 'running'], [fact('f-state', 'a: Zustand', '-1')]),
      changed: ['running', 'f-state'],
      explanation:
        'Der erste `MoveNext` setzt den Zustand auf -1 und führt deinen Code aus. Ruft der Code währenddessen rekursiv `MoveNext` auf demselben Objekt auf, sieht er -1 und liefert `false`, statt mitten in sich selbst weiterzulaufen.',
    },
    {
      codeLine: 6,
      state: run(
        ['created', 'before', 'running', 'suspended'],
        [
          fact('f-state', 'a: Zustand', '1'),
          fact('f-cur', 'a.Current', '10'),
          fact('f-ret', 'MoveNext liefert', 'true'),
        ],
      ),
      changed: ['suspended', 'f-state', 'f-cur', 'f-ret'],
      explanation:
        'Beim `yield return` hält der Iterator an: Wert ablegen, Zustand 1, `return true`. Häufige Fehlannahme: „Der Rest der Methode läuft jetzt im Hintergrund weiter.“ Nichts läuft. Das Objekt liegt reglos auf dem Heap, bis jemand wieder `MoveNext` aufruft.',
    },
    {
      codeLine: 7,
      state: run(
        ['created', 'before', 'running', 'suspended', 'running'],
        [fact('f-state', 'a: Zustand', '-1')],
      ),
      changed: ['running', 'f-state'],
      explanation:
        'Der nächste `MoveNext` springt anhand des Zustands 1 hinter das `yield` und setzt den Zustand wieder auf -1.',
    },
    {
      codeLine: 7,
      state: run(
        ['created', 'before', 'running', 'suspended', 'running', 'after'],
        [fact('f-state', 'a: Zustand', '-1'), fact('f-ret', 'MoveNext liefert', 'false')],
      ),
      changed: ['after', 'f-ret'],
      explanation:
        'Das Ende der Methode, ein `yield break` oder eine Exception beenden den Iterator. Der Zustand bleibt -1, und `MoveNext` liefert ab jetzt immer `false`. Zurücksetzen lässt er sich nicht, `Reset()` wirft eine `NotSupportedException`.',
    },
    {
      codeLine: 10,
      state: run(
        ['created', 'before', 'running', 'suspended', 'after'],
        [
          fact('f-state', 'Zustand vor Dispose', '1'),
          fact('f-fin', 'finally-Blöcke', 'laufen jetzt'),
        ],
      ),
      changed: ['after', 'f-state', 'f-fin'],
      explanation:
        '`break` verlässt die Schleife, während der Iterator nach dem ersten `yield` angehalten ist. Das `finally` von `foreach` ruft `Dispose()`, und der Iterator führt alle `finally`-Blöcke aus, die den angehaltenen Punkt umschließen. Der Rest des Rumpfs läuft nie.',
    },
  ],
});
