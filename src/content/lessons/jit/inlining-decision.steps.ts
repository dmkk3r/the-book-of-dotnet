import { defineStepScript, type GraphState } from '@/components/viz';

// The inliner's decision for one call site, simplified into four questions.
// Order in the real JIT: candidate marking during import (target known, callee flags), then the
// IL of the callee is scanned and the policy decides (src/coreclr/jit/importer*.cpp,
// fginline.cpp, inlinepolicy.cpp). The budget check happens per inline (InlineStrategy).
// TODO(verify): ALWAYS_INLINE_SIZE 16 and DEFAULT_MAX_INLINE_SIZE 100 bytes of IL
// (src/coreclr/jit/inline.h, JitInlineSize config) in current .NET.
// TODO(verify): IL sizes of Square (4 bytes) and the example Parse methods (about 300 bytes).
// TODO(verify): That AggressiveInlining skips the size and profitability checks but not the
// legality checks, the depth limit or the time budget.
// TODO(verify): That an AggressiveInlining callee can really be rejected as over budget (last step;
// InlineStrategy::BudgetCheck, observation CALLSITE_OVER_BUDGET) and whether newer JITs raise the
// budget for such callees.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'site', label: 'Aufrufstelle', row: 1, col: 1 },
  {
    id: 'known',
    label: 'Ziel bekannt?',
    detail: 'direkt oder devirtualisiert',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'legal',
    label: 'Verboten?',
    detail: 'NoInlining, Rekursion und mehr',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'aggr',
    label: 'AggressiveInlining?',
    row: 1,
    col: 4,
    shape: 'decision',
  },
  {
    id: 'budget',
    label: 'Budget und Tiefe ok?',
    detail: 'Grenzen pro Methode',
    row: 3,
    col: 4,
    shape: 'decision',
  },
  { id: 'inline', label: 'Einbetten', row: 4, col: 4, shape: 'end' },
  {
    id: 'no-target',
    label: 'Normaler Aufruf',
    detail: 'Ziel erst zur Laufzeit bekannt',
    row: 2,
    col: 2,
    shape: 'end',
  },
  { id: 'no-legal', label: 'Kein Inlining', detail: 'nicht erlaubt', row: 2, col: 3, shape: 'end' },
  {
    id: 'heur',
    label: 'Lohnt es sich?',
    detail: 'bis 16 B IL immer, über 100 B nie, dazwischen schätzen',
    row: 2,
    col: 4,
    shape: 'decision',
  },
  {
    id: 'no-budget',
    label: 'Kein Inlining',
    detail: 'Budget erschöpft',
    row: 4,
    col: 3,
    shape: 'end',
  },
  { id: 'no-heur', label: 'Kein Inlining', detail: 'lohnt nicht', row: 3, col: 3, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'site', to: 'known' },
  { from: 'known', to: 'legal', label: 'ja' },
  { from: 'known', to: 'no-target', label: 'nein' },
  { from: 'legal', to: 'aggr', label: 'nein' },
  { from: 'legal', to: 'no-legal', label: 'ja' },
  { from: 'aggr', to: 'budget', label: 'ja' },
  { from: 'aggr', to: 'heur', label: 'nein' },
  { from: 'heur', to: 'budget', label: 'ja' },
  { from: 'heur', to: 'no-heur', label: 'nein' },
  { from: 'budget', to: 'inline', label: 'ja' },
  { from: 'budget', to: 'no-budget', label: 'nein' },
];

/** Graph for one call site: `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], facts: Fact[], details: Record<string, string> = {}): GraphState {
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

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wie der JIT über eine Aufrufstelle entscheidet',
  code: {
    cs: `static int Square(int x) => x * x;                  // 4 Byte IL

int a = Square(7);               // Aufrufstelle A
double b = shape.Area();         // B: IShape, Circle.Area trägt AggressiveInlining
var c = Parser.Parse(text);      // C: etwa 300 Byte IL, kein Attribut
var d = Parser.ParseFast(text);  // D: derselbe Code mit AggressiveInlining`,
  },
  steps: [
    {
      codeLine: 3,
      state: run(
        ['site', 'known', 'legal', 'aggr', 'heur'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'Square(7)' },
          { id: 'f-il', label: 'IL-Größe', value: '4 Byte' },
        ],
      ),
      changed: ['known', 'legal', 'aggr', 'heur', 'f-call', 'f-il'],
      explanation:
        'Aufrufstelle A ruft eine statische Methode, das Ziel steht also fest, und nichts verbietet das Inlining. Ohne Attribut entscheidet die Heuristik. Bei so wenig IL ist die Antwort einfach: Der Aufruf allein wäre größer als der Rumpf.',
    },
    {
      codeLine: 3,
      state: run(
        ['site', 'known', 'legal', 'aggr', 'heur', 'budget', 'inline'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'Square(7)' },
          { id: 'f-il', label: 'IL-Größe', value: '4 Byte' },
          { id: 'f-result', label: 'Ergebnis', value: 'eingebettet' },
        ],
      ),
      changed: ['budget', 'inline', 'f-result'],
      explanation:
        'Zum Schluss prüft der JIT, ob die aufrufende Methode noch Spielraum hat: Jede eingebettete Methode macht die Übersetzung teurer, deshalb gibt es ein Budget und eine Höchsttiefe für verschachteltes Inlining. Hier ist reichlich Platz.',
    },
    {
      codeLine: 4,
      state: run(
        ['site', 'known', 'no-target'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'shape.Area()' },
          { id: 'f-attr', label: 'Attribut', value: 'AggressiveInlining an Circle.Area' },
          { id: 'f-result', label: 'Ergebnis', value: 'normaler Interface-Aufruf' },
        ],
      ),
      changed: ['known', 'no-target', 'f-call', 'f-attr', 'f-result'],
      explanation:
        'Aufrufstelle B scheitert an der ersten Frage. Der JIT weiß nicht, welche Klasse hinter `shape` steckt, also weiß er nicht, welchen Code er einbetten sollte. Häufige Fehlannahme: `AggressiveInlining` erzwinge Inlining, dabei kommt der JIT hier gar nicht bis zum Attribut.',
    },
    {
      codeLine: 5,
      state: run(
        ['site', 'known', 'legal', 'aggr', 'heur', 'no-heur'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'Parser.Parse(text)' },
          { id: 'f-il', label: 'IL-Größe', value: 'etwa 300 Byte' },
          { id: 'f-result', label: 'Ergebnis', value: 'normaler Aufruf' },
        ],
      ),
      changed: ['heur', 'no-heur', 'f-call', 'f-il', 'f-result'],
      explanation:
        'Aufrufstelle C hat ein festes Ziel, aber viel IL. Über der Größengrenze lehnt die Heuristik ab, ohne weiter zu schätzen. Das ist meist richtig: Der gesparte Aufruf ist im Verhältnis zur Arbeit in `Parse` unbedeutend, und der Code des Aufrufers würde stark wachsen.',
    },
    {
      codeLine: 6,
      state: run(
        ['site', 'known', 'legal', 'aggr', 'budget', 'inline'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'Parser.ParseFast(text)' },
          { id: 'f-il', label: 'IL-Größe', value: 'etwa 300 Byte' },
          { id: 'f-attr', label: 'Attribut', value: 'AggressiveInlining' },
          { id: 'f-result', label: 'Ergebnis', value: 'eingebettet' },
        ],
      ),
      changed: ['aggr', 'budget', 'inline', 'f-call', 'f-attr', 'f-result'],
      explanation:
        'Aufrufstelle D trägt `AggressiveInlining`. Das Attribut überspringt die Frage nach Größe und Nutzen, nicht aber die übrigen Prüfungen. Das Budget reicht noch, also wird eingebettet, und der Aufrufer wächst um den ganzen Rumpf.',
    },
    {
      codeLine: 6,
      state: run(
        ['site', 'known', 'legal', 'aggr', 'budget', 'no-budget'],
        [
          { id: 'f-call', label: 'Aufruf', value: 'zehnter ParseFast-Aufruf' },
          { id: 'f-attr', label: 'Attribut', value: 'AggressiveInlining' },
          { id: 'f-result', label: 'Ergebnis', value: 'normaler Aufruf' },
        ],
      ),
      changed: ['budget', 'no-budget', 'f-call', 'f-result'],
      explanation:
        'Stell dir vor, dieselbe Methode ruft `ParseFast` zehnmal auf. Jede Einbettung verbraucht Budget, und ist es erschöpft, kann auch eine Methode mit Attribut abgelehnt werden. Ob und wann das passiert, verrät dir nur das Protokoll des JIT.',
    },
  ],
});
