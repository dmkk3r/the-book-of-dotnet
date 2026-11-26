import { defineStepScript, type GraphState } from '@/components/viz';

// The Tier 1 code of AreaOf after guarded devirtualization (GDV), drawn as a decision graph.
// Shape of the transformation per docs/design/coreclr/jit/GuardedDevirtualization.md:
// compare the object's method table with the guessed class, inline the guessed method on the
// fast path, keep the original virtual or interface call on the fallback path.
// TODO(verify): Exact block layout chosen by the JIT here (null check first, cold return at the
// end of the method) depends on the JIT version and the profile.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'entry', label: 'AreaOf(s)', detail: 'Tier 1 mit Profil', row: 1, col: 1 },
  {
    id: 'null',
    label: 's is null?',
    detail: 'laut Profil fast nie',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'guard',
    label: 'Typ ist Circle?',
    detail: 'MethodTable vergleichen',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'fast', label: 'Circle.Area inline', detail: 'kein Aufruf, kein Dispatch', row: 1, col: 4 },
  { id: 'result', label: 'Ergebnis', row: 2, col: 4, shape: 'end' },
  { id: 'zero', label: 'return 0', detail: 'kalter Block am Ende', row: 2, col: 2, shape: 'end' },
  {
    id: 'slow',
    label: 's.Area() virtuell',
    detail: 'normaler Interface-Aufruf',
    row: 2,
    col: 3,
  },
];
const EDGES: Edge[] = [
  { from: 'entry', to: 'null' },
  { from: 'null', to: 'guard', label: 'nein' },
  { from: 'null', to: 'zero', label: 'ja' },
  { from: 'guard', to: 'fast', label: 'ja' },
  { from: 'guard', to: 'slow', label: 'nein' },
  { from: 'fast', to: 'result' },
  { from: 'slow', to: 'result' },
];

/** Graph for one call: `path` lists the visited nodes in order, the last one is active. */
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

const circlePath = ['entry', 'null', 'guard', 'fast', 'result'];
const squarePath = ['entry', 'null', 'guard', 'slow', 'result'];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Guarded Devirtualization im Tier-1-Code',
  code: {
    cs: `static double AreaOf(IShape? s)
{
    if (s is null) return 0;
    return s.Area();
}

// Was Tier 1 daraus macht, als C# gedacht:
if (s is null) goto Cold;
if (s.GetType() == typeof(Circle))              // in Wahrheit: MethodTable-Vergleich
    return Math.PI * s.r * s.r;                 // Rumpf von Circle.Area, inline
return s.Area();                                // Rückfall: Interface-Aufruf
Cold: return 0;`,
  },
  steps: [
    {
      codeLine: 4,
      state: run(
        ['entry'],
        [{ id: 'f-profile', label: 'Profil', value: 'Circle etwa 90 %, Square etwa 10 %' }],
      ),
      changed: ['entry', 'f-profile'],
      explanation:
        'So sieht `AreaOf` nach der Tier-1-Übersetzung aus. Aus einer einzigen Interface-Aufrufstelle sind zwei Wege geworden: ein schneller für den häufigsten Typ und ein Rückfallweg für alle anderen.',
    },
    {
      codeLine: 10,
      state: run(circlePath.slice(0, 4), [
        { id: 'f-obj', label: 'Objekt', value: 'Circle' },
        { id: 'f-cost', label: 'Kosten', value: 'ein Vergleich statt Dispatch' },
      ]),
      changed: ['null', 'guard', 'fast', 'f-obj', 'f-cost'],
      explanation:
        'Ein `Circle` kommt an. Die Typprüfung ist ein einziger Vergleich des MethodTable-Zeigers mit einer Konstante. Danach steht der Code von `Circle.Area` direkt da, ohne Aufruf, und der JIT kann ihn mit dem umgebenden Code weiter optimieren.',
    },
    {
      codeLine: 11,
      state: run(squarePath, [
        { id: 'f-obj', label: 'Objekt', value: 'Square' },
        { id: 'f-cost', label: 'Kosten', value: 'Vergleich plus normaler Aufruf' },
      ]),
      changed: ['slow', 'result', 'f-obj', 'f-cost'],
      explanation:
        'Jetzt ein `Square`. Die Prüfung schlägt fehl, und der Code nimmt den **Rückfallweg**: den ganz normalen Interface-Aufruf. Das Ergebnis ist korrekt, die Vermutung war eben nur eine Vermutung und keine Annahme.',
    },
    {
      codeLine: 12,
      state: run(
        ['entry', 'null', 'zero'],
        [
          { id: 'f-obj', label: 'Objekt', value: 'null' },
          { id: 'f-layout', label: 'Lage im Code', value: 'hinter dem heißen Pfad' },
        ],
      ),
      changed: ['zero', 'f-obj', 'f-layout'],
      explanation:
        'Der seltene `null`-Fall funktioniert ebenfalls, liegt aber im Maschinencode hinter dem heißen Pfad. So fällt der häufige Ablauf ohne Sprung durch, und der kalte Code belegt keinen Platz im Instruktions-Cache, solange er nicht gebraucht wird.',
    },
    {
      codeLine: 11,
      state: run(squarePath, [
        { id: 'f-obj', label: 'Objekt', value: 'Square (jetzt 95 %)' },
        { id: 'f-profile', label: 'Profil', value: 'unverändert: Circle etwa 90 %' },
      ]),
      changed: ['guard', 'slow', 'f-obj', 'f-profile'],
      explanation:
        'Stell dir vor, die Last ändert sich und fast nur noch `Square` kommt an. Der Code bleibt korrekt, aber fast jeder Aufruf zahlt jetzt Prüfung **und** Interface-Aufruf. Tier 1 wird dafür nicht erneut instrumentiert, das Profil ist eingefroren.',
    },
  ],
});
