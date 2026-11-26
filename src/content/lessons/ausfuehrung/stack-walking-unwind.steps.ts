import { defineStepScript, type GraphState } from '@/components/viz';

// The decision the stack walker makes for every step, for the scenario of stack-walking.steps.ts
// (Runtime → StackTrace → Compare → qsort → Sort → Main).
// Sources: BOTR stackwalking.md (managed frames decoded with JIT-generated per-method data found
// by instruction pointer lookup, virtual unwind, Frame chain for runtime transitions, comparison
// of stack addresses to decide whether the next item is a managed frame or a Frame).
// Simplification: the real StackFrameIterator also compares the address of the next Frame with
// the current stack pointer so that a Frame inside a managed frame is processed in order; here
// that check is folded into "Noch ein Frame-Objekt?".
// TODO(verify): Whether further Frame objects below Main (pushed by the runtime when it calls
// Main) are visited before the walk ends; they produce no entry in a StackTrace either way.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'ctx', label: 'Kontext', detail: 'IP, SP, FP', row: 1, col: 1, shape: 'state' },
  { id: 'jit', label: 'IP in JIT-Code?', row: 1, col: 2, shape: 'decision' },
  { id: 'cm', label: 'Code Manager', detail: 'Methode zur IP finden', row: 1, col: 3 },
  { id: 'cb', label: 'Melden', detail: 'Methode, IL-Offset, GC-Roots', row: 1, col: 4 },
  { id: 'frm', label: 'Noch ein Frame-Objekt?', row: 2, col: 2, shape: 'decision' },
  { id: 'end', label: 'Ende des Walks', row: 2, col: 3, shape: 'end' },
  { id: 'unw', label: 'Virtueller Unwind', detail: 'Unwind-Info → Aufrufer', row: 2, col: 4 },
  { id: 'use', label: 'Frame-Objekt lesen', detail: 'gesicherte Register', row: 3, col: 2 },
];
const EDGES: Edge[] = [
  { from: 'ctx', to: 'jit' },
  { from: 'jit', to: 'cm', label: 'ja' },
  { from: 'cm', to: 'cb' },
  { from: 'cb', to: 'unw' },
  { from: 'unw', to: 'ctx', label: 'Aufrufer' },
  { from: 'jit', to: 'frm', label: 'nein' },
  { from: 'frm', to: 'use', label: 'ja' },
  { from: 'frm', to: 'end', label: 'nein' },
  { from: 'use', to: 'ctx', label: 'Register' },
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

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wie der Walker vom Frame zum Aufrufer kommt',
  code: {
    cs: `// Stack, jüngster Frame oben:
// Runtime-Code (nativ)       + Übergangsframe
// StackTrace-Helfer          (verwaltet)
// Compare                    (verwaltet)
// qsort                      (nativ)
// Sort                       (verwaltet) + InlinedCallFrame
// Main                       (verwaltet)`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(['ctx'], [fact('f-pos', 'Kontext', 'Runtime-Code, nativ')]),
      changed: ['ctx', 'f-pos'],
      explanation:
        'Jeder Schritt des Walkers beginnt mit einem **Kontext**: Instruktionszeiger, Stackzeiger, Framepointer und gesicherte Register. Am Anfang ist das der Zustand des Runtime-Codes, der den Walk gestartet hat.',
    },
    {
      codeLine: 2,
      state: run(
        ['ctx', 'jit', 'frm', 'use'],
        [
          fact('f-pos', 'Kontext', 'Runtime-Code, nativ'),
          fact('f-frame', 'Frame-Objekt', 'Übergangsframe'),
        ],
      ),
      changed: ['use', 'f-frame'],
      explanation:
        'Die IP gehört zu keiner JIT-Methode. Die Runtime versucht nicht, nativen Code zu entwirren, sondern nimmt das nächste `Frame`-Objekt der Kette. Der Übergangsframe enthält die Register, mit denen der verwaltete Code die Runtime betreten hat.',
    },
    {
      codeLine: 4,
      state: run(
        ['use', 'ctx', 'jit', 'cm'],
        [
          fact('f-pos', 'Kontext', 'IP in Compare'),
          fact('f-how', 'Suche', 'Adressbereich → Methode'),
        ],
      ),
      changed: ['cm', 'f-pos', 'f-how'],
      explanation:
        'Mit dem neuen Kontext liegt die IP in JIT-Code (die Frames der `StackTrace`-Klasse selbst überspringen wir hier). Der **Code Manager** sucht über die Adresse die Methode, ihre GC-Info, Unwind-Info und Debug-Info.',
    },
    {
      codeLine: 4,
      state: run(
        ['ctx', 'jit', 'cm', 'cb', 'unw'],
        [fact('f-pos', 'Kontext', 'Compare'), fact('f-next', 'Aufrufer-IP', 'in qsort')],
      ),
      changed: ['cb', 'unw', 'f-next'],
      explanation:
        'Der Walker meldet den Frame an seinen Auftraggeber und rechnet dann mit der Unwind-Info die Register des Aufrufers aus, ohne den echten Stack anzufassen. Das neue IP zeigt nach `qsort`.',
    },
    {
      codeLine: 5,
      state: run(
        ['unw', 'ctx', 'jit', 'frm', 'use'],
        [
          fact('f-pos', 'Kontext', 'IP in qsort'),
          fact('f-frame', 'Frame-Objekt', 'InlinedCallFrame in Sort'),
        ],
      ),
      changed: ['frm', 'use', 'f-pos', 'f-frame'],
      explanation:
        'Wieder kein JIT-Code. Das nächste `Frame`-Objekt ist das **InlinedCallFrame**, das `Sort` vor dem P/Invoke angelegt hat. Seine gesicherten Register führen direkt nach `Sort`, egal wie viele native Frames dazwischen liegen.',
    },
    {
      codeLine: 6,
      state: run(
        ['use', 'ctx', 'jit', 'cm', 'cb', 'unw'],
        [fact('f-pos', 'Kontext', 'Sort, danach Main'), fact('f-next', 'Aufrufer-IP', 'in Main')],
      ),
      changed: ['cm', 'cb', 'unw', 'f-pos', 'f-next'],
      explanation:
        'Ab hier ist es Routine: `Sort` ist JIT-Code, also Code Manager, Melden, Unwind. Mit `Main` passiert dasselbe noch einmal. Bei einem GC würde der Walker in diesen Schritten die lebenden Verweise melden.',
    },
    {
      codeLine: 7,
      state: run(
        ['unw', 'ctx', 'jit', 'frm', 'end'],
        [fact('f-pos', 'Kontext', 'Runtime, Aufruf von Main')],
      ),
      changed: ['end', 'f-pos'],
      explanation:
        'Der Aufrufer von `Main` ist wieder Runtime-Code, und dahinter gibt es keine verwalteten Frames mehr. Der Walk endet. Drei Wege zum Aufrufer kamen vor: Unwind-Info für JIT-Code, `Frame`-Objekte für Übergänge, nie das Raten über fremde native Frames.',
    },
  ],
});
