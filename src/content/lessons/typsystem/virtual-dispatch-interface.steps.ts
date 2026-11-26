import { defineStepScript, type GraphState } from '@/components/viz';

// TODO(verify): Virtual stub dispatch stages and the miss threshold for switching from the
// dispatch stub to the resolve stub (BOTR virtual-stub-dispatch.md, virtualcallstub.cpp).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Status = Node['status'];
type Fact = NonNullable<GraphState['facts']>[number];

// Row 1: the call site and the stubs it can point to (its states, left to right as they are
// replaced). Row 2 and 3: the path a single call takes from the current stub to the target.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'site', label: 'Aufrufstelle', detail: 's.Area()', row: 1, col: 1 },
  { id: 'lookup', label: 'Lookup-Stub', detail: 'erster Aufruf', row: 1, col: 2, shape: 'state' },
  {
    id: 'dispatch',
    label: 'Dispatch-Stub',
    detail: 'ein Typ erwartet',
    row: 1,
    col: 3,
    shape: 'state',
  },
  {
    id: 'resolve',
    label: 'Resolve-Stub',
    detail: 'viele Typen, Cache',
    row: 1,
    col: 4,
    shape: 'state',
  },
  { id: 'runtime', label: 'Runtime löst auf', detail: 'langsam, einmalig', row: 2, col: 2 },
  {
    id: 'check',
    label: 'Erwarteter Typ?',
    detail: 'MethodTable vergleichen',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  { id: 'cache', label: 'Cache-Suche', detail: '(Typ, Methode)', row: 2, col: 4 },
  { id: 'target', label: 'Zielmethode', row: 3, col: 3, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'site', to: 'lookup', label: 'anfangs' },
  { from: 'lookup', to: 'dispatch', label: 'umbiegen' },
  { from: 'dispatch', to: 'resolve', label: 'viele Fehlschläge' },
  { from: 'lookup', to: 'runtime' },
  { from: 'runtime', to: 'target' },
  { from: 'dispatch', to: 'check' },
  { from: 'check', to: 'target', label: 'Treffer' },
  { from: 'check', to: 'cache', label: 'Fehlschlag' },
  { from: 'resolve', to: 'cache' },
  { from: 'cache', to: 'target' },
];

/**
 * Graph for one call: `path` lists the visited nodes in order (first the states the call site
 * went through, then the path of this call), the last one is active.
 */
function run(
  path: string[],
  details: Record<string, string>,
  facts: Fact[],
  status: Partial<Record<string, Status>> = {},
): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status:
        status[n.id] ??
        (n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending'),
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
  title: 'Interface-Aufruf Schritt für Schritt',
  code: {
    cs: `interface IShape { double Area(); }
sealed class Circle : IShape { public double Area() => 3.14; }
sealed class Square : IShape { public double Area() => 1.0; }

static double Total(IShape[] shapes)
{
    double sum = 0;
    foreach (var s in shapes)
        sum += s.Area();       // eine Aufrufstelle
    return sum;
}`,
  },
  steps: [
    {
      codeLine: 9,
      state: {
        ...run(['site', 'lookup', 'runtime'], { site: 'zeigt auf Lookup-Stub' }, [
          { id: 'f-seen', label: 'Gesehene Typen', value: 'noch keiner' },
          { id: 'f-cost', label: 'Kosten', value: 'Auflösung über die Runtime' },
        ]),
      },
      changed: ['f-seen', 'f-cost'],
      explanation:
        'Beim ersten Aufruf zeigt die Aufrufstelle auf einen **Lookup-Stub**. Er fragt die Runtime, welche Methode `IShape.Area` für den Typ des Objekts ist. Das ist langsam, passiert aber nur einmal.',
    },
    {
      codeLine: 9,
      state: {
        ...run(
          ['site', 'lookup', 'dispatch', 'check', 'target'],
          {
            site: 'zeigt auf Dispatch-Stub',
            check: 'MethodTable == Circle?',
            target: 'Circle.Area',
          },
          [
            { id: 'f-seen', label: 'Gesehene Typen', value: 'Circle' },
            { id: 'f-check', label: 'Prüfung', value: 'MethodTable == Circle?' },
            { id: 'f-cost', label: 'Kosten', value: 'ein Vergleich, ein Sprung' },
          ],
        ),
      },
      changed: ['f-seen', 'f-check', 'f-cost'],
      explanation:
        'Danach biegt die Runtime die Aufrufstelle auf einen **Dispatch-Stub** um. Er vergleicht den MethodTable-Zeiger mit dem erwarteten Typ `Circle` und springt bei Gleichheit direkt zu `Circle.Area`. Solange immer Kreise kommen, ist das fast so schnell wie ein virtueller Aufruf.',
    },
    {
      codeLine: 9,
      state: {
        ...run(
          ['site', 'lookup', 'dispatch', 'check', 'cache'],
          {
            site: 'zeigt auf Dispatch-Stub',
            check: 'MethodTable == Circle?',
            cache: 'Ziel für Square',
          },
          [
            { id: 'f-seen', label: 'Gesehene Typen', value: 'Circle, Square' },
            { id: 'f-check', label: 'Prüfung', value: 'Square: Fehlschlag' },
            { id: 'f-cost', label: 'Kosten', value: 'Ausweichen über den Resolve-Pfad' },
          ],
        ),
      },
      changed: ['f-seen', 'f-check'],
      explanation:
        'Kommt ein `Square`, schlägt der Vergleich fehl. Der Aufruf weicht auf einen allgemeineren Pfad aus, der das Ziel in einem Cache sucht. Die Runtime zählt diese Fehlschläge.',
    },
    {
      codeLine: 9,
      state: {
        ...run(
          ['site', 'lookup', 'dispatch', 'resolve', 'cache', 'target'],
          { site: 'zeigt auf Resolve-Stub', target: 'Area des jeweiligen Typs' },
          [
            { id: 'f-seen', label: 'Gesehene Typen', value: 'mehrere, abwechselnd' },
            { id: 'f-check', label: 'Prüfung', value: 'Suche im Cache nach (Typ, Methode)' },
            { id: 'f-cost', label: 'Kosten', value: 'Hash-Suche pro Aufruf' },
          ],
          { check: 'skipped' },
        ),
      },
      changed: ['f-seen', 'f-check', 'f-cost'],
      explanation:
        'Häufen sich die Fehlschläge, wird die Aufrufstelle dauerhaft auf einen **Resolve-Stub** umgestellt. Er sucht das Ziel in einer Hash-Tabelle. Das ist langsamer als der Dispatch-Stub, aber stabil, egal wie viele Typen vorbeikommen. Häufige Fehlannahme: Interface-Aufrufe kosten immer gleich viel. Ihre Kosten hängen davon ab, wie viele verschiedene Typen an einer Stelle ankommen.',
    },
  ],
});
