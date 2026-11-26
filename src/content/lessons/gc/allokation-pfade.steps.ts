import { defineStepScript, type GraphState } from '@/components/viz';

// Fast path vs. slow path of a small-object allocation. The three allocations stand for three
// situations; in a real program they would be far apart.
// Slow path structure follows allocation.cpp (more_space_lock_soh, dd_new_allocation for the
// gen0 budget, clearing in adjust_limit_clr).
// TODO(verify): Name of the JIT helper for small objects (CORINFO_HELP_NEWSFAST) and whether the
// fast path runs in an assembly helper or managed code in current .NET versions.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Status = Node['status'];
type Fact = NonNullable<GraphState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

// Fast path in row 1, slow path in row 2, the collection branches off below the budget check.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'new', label: 'new Node()', detail: 'JIT ruft den Allokations-Helfer', row: 1, col: 1 },
  {
    id: 'fast',
    label: 'Platz im Context?',
    detail: 'alloc_ptr + Größe <= alloc_limit',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'init',
    label: 'Objekt fertig',
    detail: 'MethodTable-Zeiger, Konstruktor',
    row: 1,
    col: 4,
    shape: 'end',
  },
  {
    id: 'slow',
    label: 'Langsamer Pfad',
    detail: 'Lock nehmen, neuen Block suchen',
    row: 2,
    col: 2,
  },
  {
    id: 'budget',
    label: 'Gen0-Budget übrig?',
    detail: 'neuer Block zählt dagegen',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'clear',
    label: 'Block nullen',
    detail: 'Context auf neuen Block setzen',
    row: 2,
    col: 4,
  },
  {
    id: 'gc',
    label: 'Garbage Collection',
    detail: 'Gen0 (oder mehr) einsammeln',
    row: 3,
    col: 3,
  },
];
const EDGES: Edge[] = [
  { from: 'new', to: 'fast' },
  { from: 'fast', to: 'init', label: 'ja' },
  { from: 'fast', to: 'slow', label: 'nein' },
  { from: 'slow', to: 'budget' },
  { from: 'budget', to: 'clear', label: 'ja' },
  { from: 'budget', to: 'gc', label: 'nein' },
  { from: 'gc', to: 'clear' },
  { from: 'clear', to: 'init' },
];

/**
 * Graph for one step: `path` lists the visited nodes in order, the last one is active.
 * `skipped` marks nodes that are not taken in this run.
 */
function run(path: string[], facts: Fact[], skipped: string[] = []): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  const status = (id: string): Status =>
    id === path[path.length - 1]
      ? 'active'
      : visited.has(id)
        ? 'done'
        : skipped.includes(id)
          ? 'skipped'
          : 'pending';
  return {
    nodes: NODES.map((n) => ({ ...n, status: status(n.id) })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const SLOW = ['slow', 'budget', 'gc', 'clear'];
const CTX_YES = fact('f-ctx', 'Platz im Context', 'ja');
const CTX_NO = fact('f-ctx', 'Platz im Context', 'nein');
const LOCK_NO = fact('f-lock', 'Lock nötig', 'nein');
const LOCK_YES = fact('f-lock', 'Lock nötig', 'ja');

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Schneller und langsamer Pfad einer Allokation',
  code: {
    cs: `var a = new Node();   // Context hat noch Platz
var b = new Node();   // Context erschöpft, Budget reicht
var c = new Node();   // Context erschöpft, Gen0-Budget aufgebraucht`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(['new'], [CTX_YES, LOCK_NO]),
      changed: ['new', 'f-ctx', 'f-lock'],
      explanation:
        'Für `new Node()` erzeugt der JIT einen Aufruf eines kleinen **Allokations-Helfers**. Ihm wird die MethodTable des Typs übergeben, daraus kennt er die Größe.',
    },
    {
      codeLine: 1,
      state: run(['new', 'fast'], [CTX_YES, LOCK_NO], SLOW),
      changed: ['fast'],
      explanation:
        'Der **schnelle Pfad**: Zeiger lesen, Größe addieren, mit dem Limit vergleichen, Zeiger zurückschreiben. Kein Lock, keine Suche, kein Aufruf in den GC. Das ist der Fall für die allermeisten Allokationen.',
    },
    {
      codeLine: 1,
      state: run(['new', 'fast', 'init'], [CTX_YES, LOCK_NO], SLOW),
      changed: ['init', 'fast->init'],
      explanation:
        'Der Helfer schreibt den MethodTable-Zeiger und gibt die Adresse zurück. Die Felder sind schon 0, weil der Block beim Zuteilen genullt wurde. Danach läuft der Konstruktor.',
    },
    {
      codeLine: 2,
      state: run(['new', 'fast'], [CTX_NO, LOCK_YES]),
      changed: ['fast', 'f-ctx'],
      explanation:
        'Bei `b` ist der Context erschöpft. Die Limit-Prüfung schlägt fehl, und der Helfer ruft den GC-Allokator auf.',
    },
    {
      codeLine: 2,
      state: run(['new', 'fast', 'slow'], [CTX_NO, LOCK_YES]),
      changed: ['slow', 'f-lock'],
      explanation:
        'Im **langsamen Pfad** nimmt der Allokator einen Lock des Heaps, denn jetzt wird gemeinsamer Zustand verändert. Er sucht Platz für einen neuen Block, entweder am Ende der aktuellen Gen0-Region oder in einer Lücke aus der Freiliste.',
    },
    {
      codeLine: 2,
      state: run(
        ['new', 'fast', 'slow', 'budget'],
        [CTX_NO, LOCK_YES, fact('f-budget', 'Gen0-Budget', 'reicht noch')],
        ['gc'],
      ),
      changed: ['budget', 'f-budget'],
      explanation:
        'Jeder neue Block wird vom **Gen0-Budget** abgezogen. Hier ist noch genug übrig, also ist keine Collection nötig.',
    },
    {
      codeLine: 2,
      state: run(
        ['new', 'fast', 'slow', 'budget', 'clear'],
        [
          fact('f-ctx', 'Platz im Context', 'neuer Block'),
          LOCK_YES,
          fact('f-budget', 'Gen0-Budget', 'reicht noch'),
        ],
        ['gc'],
      ),
      changed: ['clear', 'f-ctx'],
      explanation:
        'Der Allokator nullt den neuen Block (soweit nötig) und setzt `alloc_ptr` und `alloc_limit` des Threads neu. Das Nullen passiert also hier, einmal pro Block, und nicht bei jedem einzelnen Objekt.',
    },
    {
      codeLine: 2,
      state: run(
        ['new', 'fast', 'slow', 'budget', 'clear', 'init'],
        [CTX_YES, LOCK_NO, fact('f-budget', 'Gen0-Budget', 'reicht noch')],
        ['gc'],
      ),
      changed: ['init', 'f-ctx', 'f-lock'],
      explanation:
        '`b` wird am Anfang des neuen Blocks angelegt. Die folgenden Allokationen laufen wieder im schnellen Pfad, bis auch dieser Block voll ist.',
    },
    {
      codeLine: 3,
      state: run(
        ['new', 'fast', 'slow', 'budget'],
        [CTX_NO, LOCK_YES, fact('f-budget', 'Gen0-Budget', 'aufgebraucht')],
      ),
      changed: ['budget', 'f-budget'],
      explanation:
        'Bei `c` ist wieder ein neuer Block nötig, aber das **Gen0-Budget ist aufgebraucht**. Genau hier entstehen die meisten Collections: im langsamen Pfad einer ganz gewöhnlichen Allokation.',
    },
    {
      codeLine: 3,
      state: run(
        ['new', 'fast', 'slow', 'budget', 'gc'],
        [CTX_NO, LOCK_YES, fact('f-budget', 'Gen0-Budget', 'wird neu berechnet')],
      ),
      changed: ['gc', 'f-budget'],
      explanation:
        'Der allozierende Thread löst eine **Garbage Collection** aus. Alle verwalteten Threads werden angehalten, der GC räumt mindestens Gen0 auf und legt danach ein neues Budget fest.',
    },
    {
      codeLine: 3,
      state: run(
        ['new', 'fast', 'slow', 'budget', 'gc', 'clear', 'init'],
        [CTX_YES, LOCK_NO, fact('f-budget', 'Gen0-Budget', 'neu')],
      ),
      changed: ['clear', 'init', 'f-ctx', 'f-lock', 'f-budget'],
      explanation:
        'Nach der Collection bekommt der Thread einen frischen Block, und `c` wird angelegt. Aus Sicht deines Codes hat `new` diesmal einfach länger gedauert.',
    },
  ],
});
