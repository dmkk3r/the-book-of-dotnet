import { defineStepScript, type GraphState } from '@/components/viz';

// The decision for one allocation site, simplified to five questions. Order and reasons follow
// ObjectAllocator in src/coreclr/jit/objectalloc.cpp (.NET 10): the phase only runs with
// optimizations enabled (compiler.cpp: compObjectStackAllocation() && OptimizationEnabled()),
// MorphAllocObjNodeHelper rejects "[alloc in loop]" (BBF_BACKWARD_JUMP), CanAllocateLclVarOnStack
// rejects "[runtime disallows]" (CEEInfo::canAllocateOnStack: finalizer, COM object),
// "[non-constant array size]", "[too large]" (JitObjectStackAllocationSize, default 528 bytes in
// release/10.0) and "[escapes]". The escape analysis itself runs before these checks.
// TODO(verify): 1 KB byte array (1040 B with MethodTable and length) is rejected as too large and
// the Point/Tracker examples behave as shown on .NET 10 x64.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'site', label: 'Allokation', detail: 'newobj, newarr, box', row: 1, col: 1 },
  {
    id: 'opt',
    label: 'Optimiert?',
    detail: 'Tier 1, OSR, Full Opts',
    row: 2,
    col: 1,
    shape: 'decision',
  },
  { id: 'loop', label: 'In einer Schleife?', row: 3, col: 1, shape: 'decision' },
  {
    id: 'type',
    label: 'Typ erlaubt?',
    detail: 'kein Finalizer',
    row: 4,
    col: 1,
    shape: 'decision',
  },
  {
    id: 'size',
    label: 'Größe fest und klein?',
    detail: 'Arrays: konstante Länge',
    row: 5,
    col: 1,
    shape: 'decision',
  },
  {
    id: 'esc',
    label: 'Entkommt?',
    detail: 'Ergebnis der Analyse',
    row: 6,
    col: 1,
    shape: 'decision',
  },
  { id: 'stack', label: 'Stack', detail: 'Bereich im Frame', row: 7, col: 1, shape: 'end' },
  { id: 'h-opt', label: 'Heap', detail: 'keine Analyse', row: 2, col: 2, shape: 'end' },
  { id: 'h-loop', label: 'Heap', detail: 'Schleife', row: 3, col: 2, shape: 'end' },
  { id: 'h-type', label: 'Heap', detail: 'Runtime lehnt ab', row: 4, col: 2, shape: 'end' },
  { id: 'h-size', label: 'Heap', detail: 'zu groß oder unbekannt', row: 5, col: 2, shape: 'end' },
  { id: 'h-esc', label: 'Heap', detail: 'entkommt', row: 6, col: 2, shape: 'end' },
];

const EDGES: Edge[] = [
  { from: 'site', to: 'opt' },
  { from: 'opt', to: 'loop', label: 'ja' },
  { from: 'opt', to: 'h-opt', label: 'nein' },
  { from: 'loop', to: 'type', label: 'nein' },
  { from: 'loop', to: 'h-loop', label: 'ja' },
  { from: 'type', to: 'size', label: 'ja' },
  { from: 'type', to: 'h-type', label: 'nein' },
  { from: 'size', to: 'esc', label: 'ja' },
  { from: 'size', to: 'h-size', label: 'nein' },
  { from: 'esc', to: 'stack', label: 'nein' },
  { from: 'esc', to: 'h-esc', label: 'ja' },
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

const FULL = ['site', 'opt', 'loop', 'type', 'size', 'esc'];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wie der JIT über eine Allokation entscheidet',
  code: {
    cs: `int A(int x) { var p = new Point(x, x); return p.X + p.Y; }
void B(int x) { _last = new Point(x, x); }
int C(int x) { var p = new Point(x, x); Log(p); return p.X; }   // Log: NoInlining
int D(int n) { int s = 0; for (int i = 0; i < n; i++) s += new Point(i, i).X; return s; }
int E(int x) { var buf = new byte[1024]; buf[0] = (byte)x; return buf[0]; }
int F(int x) { var t = new Tracker(x); return t.Value; }        // Tracker hat einen Finalizer`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(
        ['site', 'opt', 'h-opt'],
        [
          { id: 'f-m', label: 'Methode', value: 'A' },
          { id: 'f-tier', label: 'Stufe', value: 'Tier 0' },
          { id: 'f-res', label: 'Ergebnis', value: 'Heap' },
        ],
      ),
      changed: ['opt', 'h-opt', 'f-m', 'f-tier', 'f-res'],
      explanation:
        'Die ersten Aufrufe von `A` laufen in Tier 0. Dort läuft die Phase für Stack-Allokation gar nicht, jedes `new` geht an den Heap. Erst wenn `A` heiß wird und neu übersetzt wird, beginnt die Analyse.',
    },
    {
      codeLine: 1,
      state: run(
        [...FULL, 'stack'],
        [
          { id: 'f-m', label: 'Methode', value: 'A' },
          { id: 'f-tier', label: 'Stufe', value: 'Tier 1' },
          { id: 'f-size', label: 'Größe', value: '16 Byte (ohne Header)' },
          { id: 'f-res', label: 'Ergebnis', value: 'Stack' },
        ],
      ),
      changed: ['loop', 'type', 'size', 'esc', 'stack', 'f-tier', 'f-size', 'f-res'],
      explanation:
        'In Tier 1 kommt `A` durch alle Fragen. `p` wird nur gelesen, der Konstruktor ist eingebettet, also entkommt nichts. Die Allokation wird zu einem Bereich im Frame.',
    },
    {
      codeLine: 2,
      state: run(
        [...FULL, 'h-esc'],
        [
          { id: 'f-m', label: 'Methode', value: 'B' },
          { id: 'f-why', label: 'Grund', value: 'in statisches Feld gespeichert' },
          { id: 'f-res', label: 'Ergebnis', value: 'Heap' },
        ],
      ),
      changed: ['esc', 'h-esc', 'f-m', 'f-why', 'f-res'],
      explanation:
        '`B` speichert das Objekt in einem Feld. Damit ist es von außen erreichbar und lebt länger als der Frame. Das ist der klarste Fall von Entkommen.',
    },
    {
      codeLine: 3,
      state: run(
        [...FULL, 'h-esc'],
        [
          { id: 'f-m', label: 'Methode', value: 'C' },
          { id: 'f-why', label: 'Grund', value: 'Argument eines nicht eingebetteten Aufrufs' },
          { id: 'f-res', label: 'Ergebnis', value: 'Heap' },
        ],
      ),
      changed: ['esc', 'h-esc', 'f-m', 'f-why', 'f-res'],
      explanation:
        'Häufige Fehlannahme: `C` sieht harmlos aus, das Objekt stirbt direkt nach dem Aufruf. Doch `Log` ist nicht eingebettet, und der JIT analysiert nur die eigene Methode. Was `Log` mit dem Verweis tut, weiß er nicht, also gilt `p` als entkommen.',
    },
    {
      codeLine: 4,
      state: run(
        ['site', 'opt', 'loop', 'h-loop'],
        [
          { id: 'f-m', label: 'Methode', value: 'D' },
          { id: 'f-why', label: 'Grund', value: 'Allokation im Schleifenrumpf' },
          { id: 'f-res', label: 'Ergebnis', value: 'Heap' },
        ],
      ),
      changed: ['loop', 'h-loop', 'f-m', 'f-why', 'f-res'],
      explanation:
        '`D` alloziert in jedem Durchlauf. Ein fester Bereich im Frame kann nicht für mehrere gleichzeitig lebende Objekte stehen, und der JIT weist hier nicht nach, dass das alte Objekt beim nächsten Durchlauf schon tot ist. Allokationen in Schleifen bleiben deshalb auf dem Heap.',
    },
    {
      codeLine: 5,
      state: run(
        ['site', 'opt', 'loop', 'type', 'size', 'h-size'],
        [
          { id: 'f-m', label: 'Methode', value: 'E' },
          { id: 'f-size', label: 'Größe', value: 'etwa 1 KB' },
          { id: 'f-limit', label: 'Grenze (.NET 10)', value: '528 Byte' },
          { id: 'f-res', label: 'Ergebnis', value: 'Heap' },
        ],
      ),
      changed: ['size', 'h-size', 'f-m', 'f-size', 'f-limit', 'f-res'],
      explanation:
        'Das Array in `E` entkommt nicht, ist aber zu groß. Der Stack eines Threads ist begrenzt, deshalb gibt es eine Obergrenze pro Objekt. Bei Arrays muss außerdem die Länge eine Konstante sein, sonst ist die Größe unbekannt.',
    },
    {
      codeLine: 6,
      state: run(
        ['site', 'opt', 'loop', 'type', 'h-type'],
        [
          { id: 'f-m', label: 'Methode', value: 'F' },
          { id: 'f-why', label: 'Grund', value: 'Typ mit Finalizer' },
          { id: 'f-res', label: 'Ergebnis', value: 'Heap' },
        ],
      ),
      changed: ['type', 'h-type', 'f-m', 'f-why', 'f-res'],
      explanation:
        'Ein Objekt mit Finalizer muss sich bei der Finalisierung anmelden und wird später vom Finalizer-Thread besucht. Es entkommt also immer, egal was die Methode tut. Die Runtime verbietet für solche Typen die Stack-Allokation.',
    },
  ],
});
