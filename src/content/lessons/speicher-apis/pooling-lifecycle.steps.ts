import { defineStepScript, type GraphState } from '@/components/viz';

// The life of one array from ArrayPool<T>.Shared as a state machine, including misuse paths.
// Behaviour from dotnet/runtime SharedArrayPool.cs: Return does not detect double returns,
// arrays are dropped when all partitions of a bucket are full, and Trim (registered as a gen2 GC
// callback) releases arrays that were not used for a while. ArrayPool<T>.Rent docs: not
// returning a buffer is not a fatal error.
// TODO(verify): Trim timings from source (60 s under low or medium pressure for partitions,
// 10 s under high pressure, everything under high pressure for thread-local slots).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'new', label: 'Neu alloziert', detail: 'Pool hatte keins passend', row: 1, col: 1 },
  {
    id: 'rented',
    label: 'Ausgeliehen',
    detail: 'genau ein Besitzer',
    row: 1,
    col: 2,
    shape: 'state',
  },
  {
    id: 'pooled',
    label: 'Im Pool',
    detail: 'Thread-Slot oder Partition',
    row: 1,
    col: 3,
    shape: 'state',
  },
  {
    id: 'gc',
    label: 'Vom GC eingesammelt',
    detail: 'kein Leck, nur keine Wiederverwendung',
    row: 2,
    col: 1,
    shape: 'end',
  },
  {
    id: 'dropped',
    label: 'Verworfen',
    detail: 'Pool voll oder getrimmt',
    row: 2,
    col: 3,
    shape: 'end',
  },
  {
    id: 'shared',
    label: 'Zwei Besitzer',
    detail: 'Daten überschreiben sich gegenseitig',
    row: 2,
    col: 2,
    shape: 'end',
  },
];

const EDGES: Edge[] = [
  { from: 'new', to: 'rented', label: 'Rent' },
  { from: 'rented', to: 'pooled', label: 'Return' },
  { from: 'pooled', to: 'rented', id: 'reuse', label: 'Rent' },
  { from: 'rented', to: 'gc', label: 'Return vergessen' },
  { from: 'pooled', to: 'dropped', label: 'Trim, voll' },
  { from: 'rented', to: 'shared', label: 'Return doppelt' },
  { from: 'pooled', to: 'shared', label: 'alter Verweis benutzt' },
];

/** `path` lists edge ids in order; nodes on the path are done, `active` is the current node. */
function run(active: string, edges: string[], facts: Fact[], rejected: string[] = []): GraphState {
  const visited = new Set<string>([active]);
  for (const id of edges) {
    const e = EDGES.find((x) => (x.id ?? `${x.from}->${x.to}`) === id);
    if (e) {
      visited.add(e.from);
      visited.add(e.to);
    }
  }
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status:
        n.id === active
          ? 'active'
          : rejected.includes(n.id)
            ? 'rejected'
            : visited.has(n.id)
              ? 'done'
              : 'pending',
    })),
    edges: EDGES.map((e) => {
      const id = e.id ?? `${e.from}->${e.to}`;
      return { ...e, status: edges.includes(id) ? 'taken' : 'idle' };
    }),
    facts,
  };
}

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Das Leben eines gepoolten Arrays',
  code: {
    cs: `var pool = ArrayPool<byte>.Shared;

byte[] a = pool.Rent(4096);    // Pool leer: neu alloziert
pool.Return(a);                // a liegt im Pool
byte[] b = pool.Rent(4000);    // dasselbe Array wie a

pool.Return(b);
pool.Return(b);                // Fehler: doppelt zurückgegeben
byte[] c = pool.Rent(4096);
byte[] d = pool.Rent(4096);    // c und d: dasselbe Array

a[0] = 42;                     // Fehler: a gehört längst dem Pool

byte[] e = pool.Rent(4096);    // nie zurückgegeben`,
  },
  steps: [
    {
      codeLine: 3,
      state: run(
        'rented',
        ['new->rented'],
        [
          { id: 'f-arr', label: 'Array', value: 'byte[4096] #1' },
          { id: 'f-owner', label: 'Besitzer', value: 'a' },
        ],
      ),
      changed: ['new', 'rented', 'f-arr', 'f-owner'],
      explanation:
        'Der Pool hat für die Größenklasse 4096 noch nichts, also alloziert er ein neues Array und gibt es aus. Ab jetzt gehört es `a`, und **nur** `a`.',
    },
    {
      codeLine: 4,
      state: run(
        'pooled',
        ['new->rented', 'rented->pooled'],
        [
          { id: 'f-arr', label: 'Array', value: 'byte[4096] #1' },
          { id: 'f-owner', label: 'Besitzer', value: 'Pool (a zeigt noch darauf)' },
        ],
      ),
      changed: ['pooled', 'f-owner'],
      explanation:
        '`Return` übergibt das Eigentum an den Pool. Die Variable `a` zeigt weiter auf das Array, darf es aber nicht mehr benutzen. Der Pool kann das nicht erzwingen, es ist ein reiner Vertrag.',
    },
    {
      codeLine: 5,
      state: run(
        'rented',
        ['new->rented', 'rented->pooled', 'reuse'],
        [
          { id: 'f-arr', label: 'Array', value: 'byte[4096] #1' },
          { id: 'f-owner', label: 'Besitzer', value: 'b' },
        ],
      ),
      changed: ['rented', 'reuse', 'f-owner'],
      explanation:
        'Das ist der Sinn des Pools: `Rent(4000)` fällt in dieselbe Größenklasse und bekommt **dasselbe** Array zurück, ohne Allokation. Der Kreislauf zwischen „Ausgeliehen“ und „Im Pool“ kann sich beliebig oft wiederholen.',
    },
    {
      codeLine: 8,
      state: run(
        'shared',
        ['rented->pooled', 'rented->shared'],
        [
          { id: 'f-arr', label: 'Array', value: 'byte[4096] #1' },
          { id: 'f-owner', label: 'Besitzer', value: 'c und d gleichzeitig' },
        ],
      ),
      changed: ['shared', 'rented->shared', 'f-owner'],
      explanation:
        'Ein doppeltes `Return` meldet der gemeinsame Pool nicht. Das Array liegt danach zweimal im Pool, und zwei spätere `Rent`-Aufrufe bekommen dasselbe Objekt. Zwei Codestellen schreiben nun in denselben Puffer, ein Fehler, der sich oft erst unter Last zeigt.',
    },
    {
      codeLine: 12,
      state: run(
        'shared',
        ['rented->pooled', 'pooled->shared'],
        [
          { id: 'f-arr', label: 'Array', value: 'byte[4096] #1' },
          { id: 'f-owner', label: 'Besitzer', value: 'Pool oder ein neuer Mieter, und a' },
        ],
      ),
      changed: ['pooled->shared', 'f-owner'],
      explanation:
        'Dasselbe passiert, wenn alter Code über `a` weiterschreibt, nachdem das Array zurückgegeben wurde. Der Schreibzugriff landet im Puffer des nächsten Mieters. Gegen beides hilft nur Disziplin: nach `Return` den Verweis nicht mehr anfassen.',
    },
    {
      codeLine: 14,
      state: run(
        'gc',
        ['new->rented', 'rented->gc'],
        [
          { id: 'f-arr', label: 'Array', value: 'byte[4096] #2' },
          { id: 'f-owner', label: 'Besitzer', value: 'niemand mehr' },
        ],
      ),
      changed: ['gc', 'rented->gc', 'f-arr', 'f-owner'],
      explanation:
        'Ein vergessenes `Return` ist dagegen harmlos für die Korrektheit. Wird `e` unerreichbar, sammelt der GC das Array ganz normal ein. Verloren ist nur der Vorteil des Pools, er muss beim nächsten Mal neu allozieren.',
    },
    {
      state: run(
        'dropped',
        ['rented->pooled', 'pooled->dropped'],
        [
          { id: 'f-arr', label: 'Array', value: 'ein lange ungenutztes Array' },
          { id: 'f-owner', label: 'Besitzer', value: 'niemand, GC räumt auf' },
        ],
      ),
      changed: ['dropped', 'pooled->dropped', 'f-arr', 'f-owner'],
      explanation:
        'Auch der Pool selbst gibt Arrays ab. Ist eine Größenklasse voll, verwirft `Return` das Array einfach. Und nach Gen2-Collections trimmt sich der Pool: Arrays, die lange niemand geliehen hat, lässt er fallen, unter hohem Speicherdruck schneller und mehr.',
    },
  ],
});
