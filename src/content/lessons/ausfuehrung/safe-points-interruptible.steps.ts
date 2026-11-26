import { defineStepScript, type GraphState } from '@/components/viz';

// How the JIT decides between fully and partially interruptible code (x64, non-Wasm), after
// dotnet/runtime main: Compiler::fgSetOptions in src/coreclr/jit/morph.cpp (debuggable code;
// EH via setFramePointerRequiredEH in codegencommon.cpp) and Compiler::fgSetBlockOrder with
// fgHasCycleWithoutGCSafePoint in src/coreclr/jit/flowgraph.cpp (cycle without GC safe point).
// Simplified: the JitFullyInt switch and stress modes of checked JITs are left out, and the
// order of the checks in the graph is didactic (in the JIT they are separate phases, any one of
// them makes the method fully interruptible).
// TODO(verify): That the calls in Poll (Handle) are not inlined, so the loop keeps a call and
// therefore a GC safe point; that try/finally in Save survives optimization (it does unless the
// JIT removes empty EH).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'jit', label: 'JIT übersetzt Methode', row: 1, col: 1 },
  {
    id: 'dbg',
    label: 'Debug-Code?',
    detail: 'nicht optimiert, debuggbar',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'eh',
    label: 'EH-Klauseln?',
    detail: 'try, catch, finally',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'loop',
    label: 'Zyklus ohne Safe Point?',
    detail: 'Schleife ohne Aufruf',
    row: 3,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'full',
    label: 'Fully interruptible',
    detail: 'jede Stelle ist Safe Point',
    row: 2,
    col: 3,
    shape: 'end',
  },
  {
    id: 'part',
    label: 'Partially interruptible',
    detail: 'nur Aufrufstellen',
    row: 4,
    col: 2,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'jit', to: 'dbg' },
  { from: 'dbg', to: 'full', label: 'ja' },
  { from: 'dbg', to: 'eh', label: 'nein' },
  { from: 'eh', to: 'full', label: 'ja' },
  { from: 'eh', to: 'loop', label: 'nein' },
  { from: 'loop', to: 'full', label: 'ja' },
  { from: 'loop', to: 'part', label: 'nein' },
];

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

const facts = (method: string, result: string, why: string): Fact[] => [
  { id: 'f-method', label: 'Methode', value: method },
  { id: 'f-result', label: 'Ergebnis', value: result },
  { id: 'f-why', label: 'Grund', value: why },
];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Fully oder partially interruptible?',
  code: {
    cs: `static int Describe(Order o) { /* nur Aufrufe, wie oben */ }

static int Sum(int[] a)
{
    int s = 0;
    foreach (int x in a) s += x;     // kein Aufruf in der Schleife
    return s;
}

static void Save(Stream s, byte[] d)
{
    try { s.Write(d); }
    finally { s.Dispose(); }
}

static void Poll(Queue<int> q)
{
    while (q.Count > 0) Handle(q.Dequeue());   // Aufruf in der Schleife
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(
        ['jit', 'dbg', 'eh', 'loop', 'part'],
        facts('Describe', 'partially', 'keine Schleife, kein try'),
      ),
      explanation:
        '`Describe` im Release-Build: kein Debug-Code, keine EH-Klausel, keine Schleife. Der JIT nimmt den Normalfall, **partially interruptible**. Die GC-Info beschreibt nur die Aufrufstellen.',
    },
    {
      codeLine: 6,
      state: run(
        ['jit', 'dbg', 'eh', 'loop', 'full'],
        facts('Sum', 'fully', 'Schleife ohne Safe Point'),
      ),
      explanation:
        'Die Schleife in `Sum` enthält keinen Aufruf. Wäre die Methode partially interruptible, könnte ein Thread bei einem großen Array beliebig lange laufen, ohne je einen Safe Point zu erreichen. Der JIT erkennt diesen Zyklus und macht die ganze Methode **fully interruptible**.',
    },
    {
      codeLine: 12,
      state: run(['jit', 'dbg', 'eh', 'full'], facts('Save', 'fully', 'Methode hat EH-Klauseln')),
      explanation:
        '`Save` hat ein `try`/`finally`. Methoden mit Exception-Handling erzeugt der JIT auf x64 fully interruptible, damit die Runtime auch beim Abwickeln eines Frames mitten in einem Handler alle Verweise melden kann. Einzelheiten stehen in „Exception Handling in zwei Durchläufen“.',
    },
    {
      codeLine: 18,
      state: run(
        ['jit', 'dbg', 'eh', 'loop', 'part'],
        facts('Poll', 'partially', 'jede Runde enthält einen Aufruf'),
      ),
      explanation:
        'Auch `Poll` hat eine Schleife, aber jeder Durchlauf ruft `Handle` auf. Damit liegt in jeder Runde ein Safe Point, und partially interruptible genügt. Würde der JIT `Handle` inlinen und verschwände damit der letzte Aufruf, fiele die Entscheidung anders aus.',
    },
    {
      codeLine: 1,
      state: run(['jit', 'dbg', 'full'], facts('Describe (Debug)', 'fully', 'debuggbarer Code')),
      explanation:
        'Dieselbe Methode `Describe` im Debug-Build: Für debuggbaren Code entscheidet der JIT immer fully interruptible, weil der Debugger überall anhalten können will. Zusätzlich verfolgt er dort keine Lebensdauern, dazu mehr im Text.',
    },
  ],
});
