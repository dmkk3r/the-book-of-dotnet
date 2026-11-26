import { defineStepScript, type GraphState } from '@/components/viz';

// Simplified decision of the JIT for one call site. In the real JIT the questions "sealed?" and
// "exact type known?" are answered together in impDevirtualizeCall (src/coreclr/jit/importercalls.cpp)
// via the runtime's resolveVirtualMethod; guarded devirtualization is only considered when the
// call could not be devirtualized and optimized code with a class profile is being produced.
// TODO(verify): That Tier 0 / MinOpts never devirtualize, and that a constrained call on a value
// type instantiation is resolved to a direct call during import.
// TODO(verify): That a static readonly field of an already initialized class gives the JIT the
// exact type of its object in Tier 1 (.NET 8+).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'site', label: 'Aufrufstelle', row: 1, col: 1 },
  {
    id: 'virt',
    label: 'Virtuell oder Interface?',
    detail: 'Ziel hängt vom Objekt ab',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'sealed',
    label: 'Typ oder Methode sealed?',
    detail: 'Werttypen sind immer sealed',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'direct', label: 'Direkter Aufruf', detail: 'Ziel steht fest', row: 1, col: 4 },
  {
    id: 'plain',
    label: 'Schon direkt',
    detail: 'statisch oder nicht virtuell',
    row: 2,
    col: 2,
    shape: 'end',
  },
  {
    id: 'exact',
    label: 'Exakter Typ bekannt?',
    detail: 'new, Inlining, static readonly',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'inline',
    label: 'Inlining prüfen',
    detail: 'eigene Entscheidung des Inliners',
    row: 2,
    col: 4,
    shape: 'end',
  },
  {
    id: 'pgo',
    label: 'Profil: ein Typ dominiert?',
    detail: 'nur Tier 1 mit Dynamic PGO',
    row: 3,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'gdv',
    label: 'Typprüfung plus direkter Aufruf',
    detail: 'Guarded Devirtualization',
    row: 3,
    col: 4,
  },
  {
    id: 'virtual',
    label: 'Virtueller Aufruf bleibt',
    detail: 'Slot oder Stub',
    row: 4,
    col: 3,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'site', to: 'virt' },
  { from: 'virt', to: 'plain', label: 'nein' },
  { from: 'virt', to: 'sealed', label: 'ja' },
  { from: 'sealed', to: 'direct', label: 'ja' },
  { from: 'sealed', to: 'exact', label: 'nein' },
  { from: 'exact', to: 'direct', label: 'ja' },
  { from: 'exact', to: 'pgo', label: 'nein' },
  { from: 'pgo', to: 'gdv', label: 'ja' },
  { from: 'pgo', to: 'virtual', label: 'nein' },
  { from: 'direct', to: 'inline' },
  { from: 'gdv', to: 'inline' },
];

/** Graph for one call site: `path` lists the visited nodes in order, the last one is active. */
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

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Kann der JIT diesen Aufruf devirtualisieren?',
  code: {
    cs: `int a = Helper.Count(items);      // A: statische Methode
int b = bird.Legs();              // B: Bird ist sealed
int c = new Cat().Legs();         // C: Cat ist nicht sealed
int d = Hash(point);              // D: Hash<T>(T x) where T : IHashable, T = Point (struct)
int e = animal.Legs();            // E: Animal-Parameter, Tier 1, Profil: 95 % Dog
int f = animal.Legs();            // F: wie E, aber fünf Tierarten gleich häufig`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(
        ['site', 'virt', 'plain'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'Helper.Count(items)' },
          { id: 'f-il', label: 'IL', value: 'call' },
        ],
      ),
      changed: ['virt', 'plain', 'f-call', 'f-il'],
      explanation:
        'Eine statische Methode hat genau ein mögliches Ziel. Hier gibt es nichts zu devirtualisieren, der Aufruf ist von Anfang an direkt und damit ein Kandidat für das Inlining.',
    },
    {
      codeLine: 2,
      state: run(
        ['site', 'virt', 'sealed', 'direct', 'inline'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'bird.Legs()' },
          { id: 'f-why', label: 'Begründung', value: 'Bird hat keine Ableitungen' },
        ],
      ),
      changed: ['sealed', 'direct', 'inline', 'f-call', 'f-why'],
      explanation:
        '`Legs` ist virtuell, aber `bird` hat den statischen Typ `Bird`, und `Bird` ist `sealed`. Ein anderes Ziel als `Bird.Legs` kann es nicht geben. Der JIT ruft direkt auf und gibt den Aufruf an den Inliner weiter.',
    },
    {
      codeLine: 3,
      state: run(
        ['site', 'virt', 'sealed', 'exact', 'direct', 'inline'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'new Cat().Legs()' },
          { id: 'f-why', label: 'Begründung', value: 'Objekt wurde gerade als Cat erzeugt' },
        ],
      ),
      changed: ['exact', 'direct', 'inline', 'f-call', 'f-why'],
      explanation:
        '`Cat` ist nicht `sealed`, trotzdem wird direkt aufgerufen. Der JIT sieht, dass das Objekt eben mit `new Cat()` entstanden ist, also kennt er den **exakten** Typ. `sealed` ist nur eine von mehreren Quellen für dieses Wissen.',
    },
    {
      codeLine: 4,
      state: run(
        ['site', 'virt', 'sealed', 'direct', 'inline'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'x.Hash() in Hash<Point>' },
          { id: 'f-il', label: 'IL', value: 'constrained. !!T callvirt IHashable::Hash' },
          { id: 'f-why', label: 'Begründung', value: 'eigener Code für T = Point' },
        ],
      ),
      changed: ['sealed', 'direct', 'inline', 'f-call', 'f-il', 'f-why'],
      explanation:
        'Für Werttypen erzeugt der JIT eigenen Code pro Instanziierung. In `Hash<Point>` ist `T` exakt `Point`, ein Struct, und Structs lassen sich nicht ableiten. Der Interface-Aufruf wird zum direkten Aufruf von `Point.Hash`, ganz ohne Box.',
    },
    {
      codeLine: 5,
      state: run(
        ['site', 'virt', 'sealed', 'exact', 'pgo', 'gdv', 'inline'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'animal.Legs()' },
          { id: 'f-profile', label: 'Profil', value: 'Dog etwa 95 %' },
          { id: 'f-why', label: 'Begründung', value: 'Vermutung, bei jedem Aufruf geprüft' },
        ],
      ),
      changed: ['exact', 'pgo', 'gdv', 'inline', 'f-call', 'f-profile', 'f-why'],
      explanation:
        'Über `animal` weiß der JIT statisch nichts. In Tier 1 liegt aber ein Profil vor: Fast immer kommt ein `Dog`. Der JIT setzt eine Typprüfung vor einen direkten, einbettbaren Aufruf von `Dog.Legs` und behält den virtuellen Aufruf als Rückfallweg.',
    },
    {
      codeLine: 6,
      state: run(
        ['site', 'virt', 'sealed', 'exact', 'pgo', 'virtual'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'animal.Legs()' },
          { id: 'f-profile', label: 'Profil', value: 'fünf Typen, je etwa 20 %' },
          { id: 'f-why', label: 'Begründung', value: 'keine Vermutung lohnt sich' },
        ],
      ),
      changed: ['pgo', 'virtual', 'f-profile', 'f-why'],
      explanation:
        'Kommen viele Typen gleich häufig an, lohnt keine Vermutung. Der Aufruf bleibt virtuell. Das ist kein Unglück: Ein virtueller Aufruf kostet nur wenige Takte, verloren ist vor allem das Inlining dahinter.',
    },
  ],
});
