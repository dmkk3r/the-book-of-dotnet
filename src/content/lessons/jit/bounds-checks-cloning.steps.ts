import { defineStepScript, type GraphState } from '@/components/viz';

// Loop cloning for a loop whose limit is not the array length (src/coreclr/jit/loopcloning.cpp):
// the JIT duplicates the loop, guards the fast copy with cloning conditions evaluated once before
// the loop and removes the bounds checks only in the fast copy. The slow copy keeps all checks and
// preserves the exact exception semantics.
// TODO(verify): Exact cloning conditions the JIT emits for this loop (a != null, n <= a.Length,
// possibly n >= 0 or a check on the start value) and that cloning only happens in optimized code
// for loops it considers worth cloning (.NET 8+, loopcloning.cpp, JitCloneLoops).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'entry', label: 'Scale(a, n, f)', detail: 'Tier 1', row: 1, col: 1 },
  {
    id: 'cond',
    label: 'a != null und n ≤ a.Length?',
    detail: 'einmal vor der Schleife',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  { id: 'fast', label: 'Schnelle Schleife', detail: 'ohne Bounds-Checks', row: 1, col: 3 },
  { id: 'done', label: 'Fertig', row: 1, col: 4, shape: 'end' },
  { id: 'slow', label: 'Langsame Schleife', detail: 'jeder Zugriff geprüft', row: 2, col: 3 },
  {
    id: 'throw',
    label: 'IndexOutOfRangeException',
    detail: 'genau beim ersten ungültigen i',
    row: 3,
    col: 3,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'entry', to: 'cond' },
  { from: 'cond', to: 'fast', label: 'ja' },
  { from: 'cond', to: 'slow', label: 'nein' },
  { from: 'fast', to: 'done' },
  { from: 'slow', to: 'done', label: 'alles gültig' },
  { from: 'slow', to: 'throw', label: 'i ≥ Length' },
];

/** Graph for one run: `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], facts: Fact[], output?: string): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status:
        path.length === 0
          ? 'pending'
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
    ...(output ? { output } : {}),
  };
}

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Loop Cloning: zwei Fassungen derselben Schleife',
  code: {
    cs: `static void Scale(int[] a, int n, int f)
{
    for (int i = 0; i < n; i++)
        a[i] *= f;
}

// Was Tier 1 daraus macht, als C# gedacht:
if (a != null && n <= a.Length)
    for (int i = 0; i < n; i++) a[i] *= f;        // ohne Prüfung
else
    for (int i = 0; i < n; i++) a[i] *= f;        // mit Prüfung`,
  },
  steps: [
    {
      codeLine: 4,
      state: run(
        ['entry'],
        [
          {
            id: 'f-proof',
            label: 'Beweis für a[i]',
            value: 'fehlt: n hat mit a.Length nichts zu tun',
          },
        ],
      ),
      changed: ['entry', 'f-proof'],
      explanation:
        'Die Schleife läuft bis `n`, nicht bis `a.Length`. Für den JIT ist `n` eine beliebige Zahl, also kann er nicht beweisen, dass `a[i]` gültig ist. Die Range-Check-Analyse allein muss den Bounds-Check stehen lassen.',
    },
    {
      codeLine: 8,
      state: run(
        ['entry', 'cond'],
        [
          { id: 'f-proof', label: 'Beweis für a[i]', value: 'aus der Klonbedingung' },
          { id: 'f-copies', label: 'Schleifen im Code', value: 'zwei' },
        ],
      ),
      changed: ['cond', 'f-proof', 'f-copies'],
      explanation:
        'Der JIT **klont** die Schleife. Vor beiden Kopien steht eine Bedingung, die einmal geprüft wird: Ist `a` nicht `null` und `n` höchstens `a.Length`, kann in der Schleife kein Zugriff fehlschlagen.',
    },
    {
      codeLine: 9,
      state: run(
        ['entry', 'cond', 'fast', 'done'],
        [
          { id: 'f-args', label: 'Aufruf', value: 'n = 3, a.Length = 4' },
          { id: 'f-copies', label: 'Schleifen im Code', value: 'zwei' },
          { id: 'f-checks', label: 'Bounds-Checks ausgeführt', value: 'keine' },
        ],
      ),
      changed: ['fast', 'done', 'f-args', 'f-checks'],
      explanation:
        'Mit `n = 3` und einem Array der Länge 4 ist die Bedingung erfüllt. Die schnelle Kopie läuft, ihr Rumpf enthält keinen einzigen Bounds-Check. Das ist der Fall, für den der JIT optimiert.',
    },
    {
      codeLine: 11,
      state: run(
        ['entry', 'cond', 'slow', 'throw'],
        [
          { id: 'f-args', label: 'Aufruf', value: 'n = 6, a.Length = 4' },
          { id: 'f-copies', label: 'Schleifen im Code', value: 'zwei' },
          { id: 'f-written', label: 'Schon verändert', value: 'a[0] bis a[3]' },
        ],
        'IndexOutOfRangeException bei i = 4',
      ),
      changed: ['slow', 'throw', 'f-args', 'f-written'],
      explanation:
        'Mit `n = 6` nimmt der Code die langsame Kopie. Sie multipliziert `a[0]` bis `a[3]` und wirft erst bei `i = 4`, genau wie das Original. Eine einzige Prüfung vor der Schleife, die sofort wirft, wäre falsch: Die vier Elemente wären dann unverändert.',
    },
    {
      codeLine: 3,
      state: run(
        ['entry', 'cond', 'fast', 'done'],
        [
          { id: 'f-copies', label: 'Schleifen im Code', value: 'zwei' },
          { id: 'f-size', label: 'Preis', value: 'mehr Maschinencode' },
          { id: 'f-when', label: 'Nur bei', value: 'optimiertem Code und geeigneten Schleifen' },
        ],
      ),
      changed: ['f-size', 'f-when'],
      explanation:
        'Loop Cloning kostet Platz, denn die Schleife steht zweimal im Code. Der JIT klont deshalb nur Schleifen, deren Form er kennt und bei denen sich der Aufwand lohnt. Verlassen solltest du dich darauf nicht, besser ist eine Schleife, die direkt beweisbar ist.',
    },
  ],
});
