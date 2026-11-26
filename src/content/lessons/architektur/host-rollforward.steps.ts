import { defineStepScript, type GraphState } from '@/components/viz';

// Framework version resolution with roll forward, four runs of the same app.
// Sources: dotnet/runtime docs/design/features/framework-version-resolution.md,
// Microsoft Learn "Select the .NET version to use" and runtimeconfig "rollForward".
// TODO(verify): That Major rolls forward to the lowest higher major and then applies latest patch
// (9.0.0 here, only one 9.x installed, so the result does not depend on that detail).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

// The decision as the host makes it (simplified: pre-release versions are left out).
const NODES: Omit<Node, 'status'>[] = [
  { id: 'req', label: 'Anforderung', detail: 'runtimeconfig.json', row: 1, col: 1 },
  { id: 'rule', label: 'Welche Regel?', detail: 'rollForward', row: 1, col: 2, shape: 'decision' },
  {
    id: 'same',
    label: '8.0.x installiert?',
    detail: 'gleiche Haupt- und Nebenversion',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'patch', label: 'Neuester 8.0-Patch', row: 1, col: 4, shape: 'end' },
  { id: 'exact', label: 'Genau 8.0.0 installiert?', row: 2, col: 2, shape: 'decision' },
  {
    id: 'minor',
    label: 'Höhere 8.x installiert?',
    detail: 'etwa 8.1',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  { id: 'pminor', label: 'Niedrigste höhere 8.x', row: 2, col: 4, shape: 'end' },
  { id: 'pexact', label: 'Genau 8.0.0', row: 3, col: 2, shape: 'end' },
  { id: 'major', label: 'Regel Major?', row: 3, col: 3, shape: 'decision' },
  { id: 'pmajor', label: 'Nächste Hauptversion', row: 3, col: 4, shape: 'end' },
  {
    id: 'fail',
    label: 'Abbruch',
    detail: 'Framework nicht gefunden',
    row: 4,
    col: 3,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'req', to: 'rule' },
  { from: 'rule', to: 'same', label: 'Minor, Major' },
  { from: 'rule', to: 'exact', label: 'Disable' },
  { from: 'same', to: 'patch', label: 'ja' },
  { from: 'same', to: 'minor', label: 'nein' },
  { from: 'minor', to: 'pminor', label: 'ja' },
  { from: 'minor', to: 'major', label: 'nein' },
  { from: 'major', to: 'pmajor', label: 'ja' },
  { from: 'major', to: 'fail', label: 'nein' },
  { from: 'exact', to: 'pexact', label: 'ja' },
  { from: 'exact', to: 'fail', label: 'nein' },
];

/** Graph for one run: `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], details: Record<string, string> = {}, facts: Fact[] = []): GraphState {
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
  title: 'Welche Framework-Version eine App bekommt',
  code: {
    cs: `// App.runtimeconfig.json
// "framework": { "name": "Microsoft.NETCore.App", "version": "8.0.0" }

// Lauf 1: Maschine mit 8.0.4, 8.0.11 und 9.0.0
// $ dotnet App.dll

// Lauf 2: Maschine nur mit 9.0.0
// $ dotnet App.dll

// Lauf 3: dieselbe Maschine, Regel geändert
// "rollForward": "Major"

// Lauf 4: Maschine mit 8.0.4, Regel Disable
// $ DOTNET_ROLL_FORWARD=Disable dotnet App.dll`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(['req'], { req: 'fordert 8.0.0' }, [
        { id: 'f-req', label: 'Gefordert', value: '8.0.0' },
        { id: 'f-inst', label: 'Installiert', value: '8.0.4, 8.0.11, 9.0.0' },
      ]),
      changed: ['req', 'f-req', 'f-inst'],
      explanation:
        'Die App wurde gegen .NET 8 gebaut, ihre `runtimeconfig.json` fordert `8.0.0`. Die exakte Version 8.0.0 ist gar nicht installiert, dafür zwei neuere Patches von 8.0 und eine 9.0.',
    },
    {
      codeLine: 5,
      state: run(['req', 'rule'], { req: 'fordert 8.0.0', rule: 'Minor (Standard)' }, [
        { id: 'f-req', label: 'Gefordert', value: '8.0.0' },
        { id: 'f-inst', label: 'Installiert', value: '8.0.4, 8.0.11, 9.0.0' },
        { id: 'f-rule', label: 'Regel', value: 'Minor (Standard)' },
      ]),
      changed: ['rule', 'f-rule'],
      explanation:
        'Ohne eigene Angabe gilt **Minor**: Gibt es Versionen mit derselben Haupt- und Nebenversion (hier 8.0), wird davon der **neueste Patch** genommen. Nur wenn 8.0 ganz fehlt, darf auf eine höhere Nebenversion wie 8.1 ausgewichen werden, nie auf 9.',
    },
    {
      codeLine: 5,
      state: {
        ...run(
          ['req', 'rule', 'same', 'patch'],
          { req: 'fordert 8.0.0', rule: 'Minor (Standard)', patch: '8.0.11' },
          [
            { id: 'f-req', label: 'Gefordert', value: '8.0.0' },
            { id: 'f-pick', label: 'Gewählt', value: '8.0.11' },
          ],
        ),
        output: 'App läuft auf 8.0.11',
      },
      changed: ['patch', 'f-pick'],
      explanation:
        'Häufige Fehlannahme: „Die App läuft mit der Version, gegen die sie gebaut wurde.“ Die Zahl in `runtimeconfig.json` ist eine **Untergrenze**. Gewählt wird 8.0.11, damit Sicherheitsupdates ohne Neubau der App wirken.',
    },
    {
      codeLine: 8,
      state: {
        ...run(
          ['req', 'rule', 'same', 'minor', 'major', 'fail'],
          { req: 'fordert 8.0.0', rule: 'Minor (Standard)' },
          [
            { id: 'f-req', label: 'Gefordert', value: '8.0.0' },
            { id: 'f-inst', label: 'Installiert', value: '9.0.0' },
            { id: 'f-rule', label: 'Regel', value: 'Minor (Standard)' },
            { id: 'f-pick', label: 'Gewählt', value: 'keine' },
          ],
        ),
        output: 'Fehler: Framework Microsoft.NETCore.App 8.0.0 nicht gefunden',
      },
      changed: ['fail', 'f-inst', 'f-pick'],
      explanation:
        'Auf einer Maschine nur mit .NET 9 bricht der Start ab, bevor die Runtime überhaupt geladen wird. `hostfxr` wechselt nach der Standardregel **nie die Hauptversion**, weil sich zwischen Hauptversionen Verhalten ändern darf.',
    },
    {
      codeLine: 11,
      state: {
        ...run(
          ['req', 'rule', 'same', 'minor', 'major', 'pmajor'],
          { req: 'fordert 8.0.0', rule: 'Major', pmajor: '9.0.0' },
          [
            { id: 'f-req', label: 'Gefordert', value: '8.0.0' },
            { id: 'f-inst', label: 'Installiert', value: '9.0.0' },
            { id: 'f-rule', label: 'Regel', value: 'Major' },
            { id: 'f-pick', label: 'Gewählt', value: '9.0.0' },
          ],
        ),
        output: 'App läuft auf 9.0.0',
      },
      changed: ['pmajor', 'f-rule', 'f-pick'],
      explanation:
        'Mit **Major** darf `hostfxr` auf die nächsthöhere Hauptversion ausweichen, aber nur, wenn die geforderte fehlt. Die App läuft dann auf einer Runtime, gegen die sie nie getestet wurde. Das ist eine bewusste Entscheidung, kein Standard.',
    },
    {
      codeLine: 14,
      state: {
        ...run(['req', 'rule', 'exact', 'fail'], { req: 'fordert 8.0.0', rule: 'Disable' }, [
          { id: 'f-req', label: 'Gefordert', value: '8.0.0' },
          { id: 'f-inst', label: 'Installiert', value: '8.0.4' },
          { id: 'f-rule', label: 'Regel', value: 'Disable' },
          { id: 'f-pick', label: 'Gewählt', value: 'keine' },
        ]),
        output: 'Fehler: Framework Microsoft.NETCore.App 8.0.0 nicht gefunden',
      },
      changed: ['exact', 'fail', 'f-inst', 'f-rule', 'f-pick'],
      explanation:
        '**Disable** verlangt genau die geforderte Version, nicht einmal ein neuerer Patch zählt. Mit `DOTNET_ROLL_FORWARD` lässt sich die Regel ohne Neubau für einen einzelnen Start ändern, etwa zum Testen.',
    },
  ],
});
