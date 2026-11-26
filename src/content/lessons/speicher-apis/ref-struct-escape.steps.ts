import { defineStepScript, type GraphState } from '@/components/viz';

// The compiler's escape check for `return`, simplified to two contexts. Terms follow the C# 11
// spec „Low level struct improvements“ (safe-context, ref-safe-context, function-member,
// caller-context). The intermediate context return-only is left out of the graph on purpose and
// explained in the text.
// TODO(verify): Error codes and texts per case: CS8352 for returning a span over stackalloc,
// the error code for returning a scoped parameter (not named in the graph), CS8168 for `return ref` to a local
// („Cannot return local 'x' by reference because it is not a ref local“).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'expr', label: 'return-Ausdruck', row: 1, col: 1 },
  {
    id: 'kind',
    label: 'ref oder ref struct?',
    detail: 'trägt der Wert einen Verweis?',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'free',
    label: 'Keine Prüfung nötig',
    detail: 'gewöhnliche Kopie',
    row: 1,
    col: 3,
    shape: 'end',
  },
  {
    id: 'origin',
    label: 'Woher stammt der Verweis?',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'fm',
    label: 'function-member',
    detail: 'nur in dieser Methode gültig',
    row: 3,
    col: 1,
    shape: 'state',
  },
  {
    id: 'cc',
    label: 'caller-context',
    detail: 'auch beim Aufrufer gültig',
    row: 3,
    col: 3,
    shape: 'state',
  },
  {
    id: 'target',
    label: 'Ziel lebt länger als Quelle?',
    detail: 'return braucht caller-context',
    row: 4,
    col: 2,
    shape: 'decision',
  },
  { id: 'ok', label: 'Erlaubt', row: 5, col: 1, shape: 'end' },
  { id: 'err', label: 'Compilerfehler', row: 5, col: 3, shape: 'end' },
];

const EDGES: Edge[] = [
  { from: 'expr', to: 'kind' },
  { from: 'kind', to: 'free', label: 'nein' },
  { from: 'kind', to: 'origin', label: 'ja' },
  { from: 'origin', to: 'fm', label: 'eigener Frame, scoped' },
  { from: 'origin', to: 'cc', label: 'Heap, Parameter' },
  { from: 'fm', to: 'target' },
  { from: 'cc', to: 'target' },
  { from: 'target', to: 'ok', label: 'nein' },
  { from: 'target', to: 'err', label: 'ja' },
];

function run(path: string[], details: Record<string, string>, facts: Fact[]): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const facts = (expr: string, checked: string, source: string, result: string): Fact[] => [
  { id: 'f-expr', label: 'Ausdruck', value: expr },
  { id: 'f-checked', label: 'Geprüft wird', value: checked },
  { id: 'f-source', label: 'Quelle', value: source },
  { id: 'f-result', label: 'Ergebnis', value: result },
];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Darf dieser Wert die Methode verlassen?',
  code: {
    cs: `static int First(Span<int> s) => s[0];

static Span<int> FromArray()
{
    Span<int> s = new int[3];
    return s;
}

static Span<int> FromStack()
{
    Span<int> s = stackalloc int[3];
    return s;
}

static Span<int> Pass(Span<int> s) => s;

static Span<int> PassScoped(scoped Span<int> s) => s;

static ref int Local()
{
    int x = 5;
    return ref x;
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(
        ['expr', 'kind', 'free'],
        { expr: 'return s[0]' },
        facts('s[0]', 'nichts', 'int, kein Verweis', 'erlaubt'),
      ),
      changed: ['free', 'f-expr', 'f-checked', 'f-source', 'f-result'],
      explanation:
        'Der Indexer liefert zwar einen `ref int`, aber `=> s[0]` gibt den **Wert** zurück, also eine Kopie. Ein `int` trägt keinen Verweis und kann nichts überleben, das er nicht besitzt. Hier gibt es nichts zu prüfen.',
    },
    {
      codeLine: 6,
      state: run(
        ['expr', 'kind', 'origin', 'cc', 'target', 'ok'],
        { expr: 'return s' },
        facts('s', 'safe-context von s', 'new int[3], Heap', 'erlaubt'),
      ),
      changed: ['ok', 'f-expr', 'f-checked', 'f-source', 'f-result'],
      explanation:
        'Ein `Span<int>` ist ein ref struct, also fragt der Compiler, worauf er zeigen kann. `s` wurde mit einem Array initialisiert, das auf dem Heap liegt und so lange lebt, wie jemand darauf verweist. Sein **safe-context** ist caller-context: zurückgeben erlaubt.',
    },
    {
      codeLine: 12,
      state: run(
        ['expr', 'kind', 'origin', 'fm', 'target', 'err'],
        { expr: 'return s', err: 'CS8352' },
        facts('s', 'safe-context von s', 'stackalloc, eigener Frame', 'Fehler'),
      ),
      changed: ['err', 'f-expr', 'f-source', 'f-result'],
      explanation:
        'Derselbe Typ, dieselbe Zeile, aber `s` stammt aus `stackalloc`. Der Compiler merkt sich das an der Variable: Ihr safe-context ist **function-member**. Die Rückgabe würde den Wert in den Aufrufer tragen, also weiter als seine Quelle reicht.',
    },
    {
      codeLine: 15,
      state: run(
        ['expr', 'kind', 'origin', 'cc', 'target', 'ok'],
        { expr: 'return s' },
        facts('s', 'safe-context von s', 'Parameter vom Aufrufer', 'erlaubt'),
      ),
      changed: ['ok', 'f-source', 'f-result'],
      explanation:
        'Ein Span, der als normaler Parameter hereinkommt, stammt vom Aufrufer und gilt dort auch. Die Methode darf ihn unverändert zurückgeben. Wie der Aufrufer dafür sorgt, dass das stimmt, prüft er an seiner eigenen Aufrufstelle.',
    },
    {
      codeLine: 17,
      state: run(
        ['expr', 'kind', 'origin', 'fm', 'target', 'err'],
        { expr: 'return s', err: 'scoped verletzt' },
        facts('s', 'safe-context von s', 'scoped-Parameter', 'Fehler'),
      ),
      changed: ['fm', 'err', 'f-source', 'f-result'],
      explanation:
        '`scoped` verengt den safe-context des Parameters auf **function-member**, egal was der Aufrufer übergibt. Dafür darf der Aufrufer nun auch einen Span auf `stackalloc` übergeben. `scoped` ist ein Versprechen: Dieser Wert verlässt die Methode nicht.',
    },
    {
      codeLine: 22,
      state: run(
        ['expr', 'kind', 'origin', 'fm', 'target', 'err'],
        { expr: 'return ref x', err: 'CS8168' },
        facts('ref x', 'ref-safe-context von x', 'lokale Variable', 'Fehler'),
      ),
      changed: ['err', 'f-expr', 'f-checked', 'f-source', 'f-result'],
      explanation:
        'Bei `return ref` geht es nicht um den Wert, sondern um die **Speicherstelle**. Deren Gültigkeit heißt ref-safe-context, und für eine lokale Variable ist das function-member. Ein Verweis auf `x` würde auf einen aufgegebenen Frame zeigen.',
    },
  ],
});
