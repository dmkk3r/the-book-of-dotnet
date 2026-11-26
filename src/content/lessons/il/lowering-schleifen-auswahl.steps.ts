import { defineStepScript, type GraphState } from '@/components/viz';

// How the C# compiler picks the foreach expansion (C# language reference "Iteration statements",
// C# spec "The foreach statement"; Roslyn rewrites arrays, strings and spans as index loops).
// Simplified: extension GetEnumerator (C# 9), dynamic and multidimensional arrays are left out.
// TODO(verify): That Span<T>/ReadOnlySpan<T> are lowered to an index loop and not to their
// pattern-based Enumerator; compiler error number CS1579 for a type without GetEnumerator.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'start', label: 'foreach (x in e)', detail: 'statischer Typ von e', row: 1, col: 1 },
  {
    id: 'array',
    label: 'Array, string oder Span?',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'index',
    label: 'Index-Schleife',
    detail: 'for mit Length und Indexer',
    row: 1,
    col: 3,
    shape: 'end',
  },
  {
    id: 'pattern',
    label: 'Öffentliches GetEnumerator()?',
    detail: 'Muster, kein Interface nötig',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  { id: 'struct', label: 'Enumerator ist ein Struct?', row: 2, col: 3, shape: 'decision' },
  {
    id: 'stack',
    label: 'Struct im Frame',
    detail: 'direkte Aufrufe, keine Allokation',
    row: 2,
    col: 4,
    shape: 'end',
  },
  {
    id: 'object',
    label: 'Enumerator-Objekt',
    detail: 'eine Allokation, normale Aufrufe',
    row: 3,
    col: 4,
    shape: 'end',
  },
  {
    id: 'iface',
    label: 'IEnumerable<T> oder IEnumerable?',
    row: 3,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'virtual',
    label: 'Interface-Enumerator',
    detail: 'Interface-Aufrufe, Objekt auf dem Heap',
    row: 3,
    col: 3,
    shape: 'end',
  },
  {
    id: 'error',
    label: 'Compilerfehler',
    detail: 'nicht aufzählbar',
    row: 4,
    col: 2,
    shape: 'end',
  },
];

const EDGES: Edge[] = [
  { from: 'start', to: 'array' },
  { from: 'array', to: 'index', label: 'ja' },
  { from: 'array', to: 'pattern', label: 'nein' },
  { from: 'pattern', to: 'struct', label: 'ja' },
  { from: 'pattern', to: 'iface', label: 'nein' },
  { from: 'struct', to: 'stack', label: 'ja' },
  { from: 'struct', to: 'object', label: 'nein' },
  { from: 'iface', to: 'virtual', label: 'ja' },
  { from: 'iface', to: 'error', label: 'nein' },
];

function run(path: string[], facts: Fact[], start: string): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(n.id === 'start' ? { detail: start } : {}),
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Welche foreach-Variante der Compiler wählt',
  code: {
    cs: `int[] numbers = { 1, 2, 3 };
foreach (int n in numbers) { }        // 1

ReadOnlySpan<char> text = "abc";
foreach (char c in text) { }          // 2

var list = new List<int> { 1, 2 };
foreach (int n in list) { }           // 3

var queue = new MyQueue();            // GetEnumerator liefert eine Klasse
foreach (int n in queue) { }          // 4

IEnumerable<int> seq = list;
foreach (int n in seq) { }            // 5

object o = list;
foreach (var n in o) { }              // 6: Fehler`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(
        ['start', 'array', 'index'],
        [
          { id: 'f-type', label: 'Statischer Typ', value: 'int[]' },
          { id: 'f-res', label: 'Ergebnis', value: 'for (i = 0; i < a.Length; i++)' },
        ],
        'e: int[]',
      ),
      changed: ['index', 'f-type', 'f-res'],
      explanation:
        'Bei einem Array erzeugt der Compiler gar keinen Enumerator, sondern eine `for`-Schleife über `Length` und den Index. Das ist exakt der Code, den du von Hand schreiben würdest. `foreach` über ein Array ist deshalb nicht langsamer als `for`.',
    },
    {
      codeLine: 5,
      state: run(
        ['start', 'array', 'index'],
        [
          { id: 'f-type', label: 'Statischer Typ', value: 'ReadOnlySpan<char>' },
          { id: 'f-res', label: 'Ergebnis', value: 'for über span.Length und span[i]' },
        ],
        'e: ReadOnlySpan<char>',
      ),
      changed: ['f-type', 'f-res'],
      explanation:
        'Für `string`, `Span<T>` und `ReadOnlySpan<T>` macht der Compiler dasselbe. Ein `string` wird über `Length` und den Indexer `s[i]` durchlaufen, eine Span über ihre Länge und ihren Indexer.',
    },
    {
      codeLine: 8,
      state: run(
        ['start', 'array', 'pattern', 'struct', 'stack'],
        [
          { id: 'f-type', label: 'Statischer Typ', value: 'List<int>' },
          { id: 'f-enum', label: 'GetEnumerator liefert', value: 'List<int>.Enumerator (struct)' },
          { id: 'f-res', label: 'Ergebnis', value: 'while (e.MoveNext()) mit direkten Aufrufen' },
        ],
        'e: List<int>',
      ),
      changed: ['pattern', 'struct', 'stack', 'f-type', 'f-enum', 'f-res'],
      explanation:
        'Der Compiler sucht zuerst nach einer öffentlichen Methode `GetEnumerator()`. Ein Interface ist dafür nicht nötig, der Name und die Form reichen (Methode `MoveNext()` mit `bool`, Eigenschaft `Current`). `List<T>` liefert hier ein Struct, das ohne Allokation im Frame liegt.',
    },
    {
      codeLine: 11,
      state: run(
        ['start', 'array', 'pattern', 'struct', 'object'],
        [
          { id: 'f-type', label: 'Statischer Typ', value: 'MyQueue' },
          { id: 'f-enum', label: 'GetEnumerator liefert', value: 'MyQueue.Enumerator (class)' },
          { id: 'f-res', label: 'Ergebnis', value: 'eine Allokation pro Schleife' },
        ],
        'e: MyQueue',
      ),
      changed: ['object', 'f-type', 'f-enum', 'f-res'],
      explanation:
        'Liefert das Muster eine Klasse, wird sie normal mit `new` angelegt: ein Heap-Objekt pro Schleife. Die Aufrufe von `MoveNext` und `Current` gehen aber direkt an den bekannten Typ, nicht über ein Interface.',
    },
    {
      codeLine: 14,
      state: run(
        ['start', 'array', 'pattern', 'iface', 'virtual'],
        [
          { id: 'f-type', label: 'Statischer Typ', value: 'IEnumerable<int>' },
          { id: 'f-enum', label: 'GetEnumerator liefert', value: 'IEnumerator<int>' },
          { id: 'f-res', label: 'Ergebnis', value: 'Interface-Aufrufe, geboxtes Struct' },
        ],
        'e: IEnumerable<int>',
      ),
      changed: ['iface', 'virtual', 'f-type', 'f-enum', 'f-res'],
      explanation:
        'Entscheidend ist der **statische** Typ des Ausdrucks, nicht das Objekt zur Laufzeit. Es ist dieselbe Liste wie in Fall 3, aber über `IEnumerable<int>` bleibt nur der Interface-Weg. Häufige Fehlannahme: „Es ist doch eine List, also gleich schnell.“',
    },
    {
      codeLine: 17,
      state: run(
        ['start', 'array', 'pattern', 'iface', 'error'],
        [
          { id: 'f-type', label: 'Statischer Typ', value: 'object' },
          { id: 'f-res', label: 'Ergebnis', value: 'Fehler beim Kompilieren' },
        ],
        'e: object',
      ),
      changed: ['error', 'f-type', 'f-res'],
      explanation:
        'Ein `object` hat weder ein passendes `GetEnumerator` noch implementiert der Typ `object` ein Enumerable-Interface. Der Compiler lehnt die Schleife ab, obwohl zur Laufzeit eine Liste darin steckt.',
    },
  ],
});
