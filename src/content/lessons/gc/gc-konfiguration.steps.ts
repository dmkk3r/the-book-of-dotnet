import { defineStepScript, type GraphState } from '@/components/viz';

// Precedence source: Microsoft Learn, "Runtime configuration options" and the .NET 9 breaking change
// "Environment variables take precedence in app runtime configuration settings".
// TODO(verify): That GC settings (read by the GC through GCConfig) followed the documented
// "runtimeconfig.json wins" rule before .NET 9 for every GC knob, not only System.GC.Server.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Status = Node['status'];
type EdgeStatus = NonNullable<Edge['status']>;

// Sources feed the GC initialization from the left (build output) and from below (environment).
// Which input wins depends on the runtime version. Afterwards the mode is fixed; changing the
// variable at run time does not reach it.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'csproj', label: 'Projektdatei', detail: 'MSBuild-Eigenschaft', row: 1, col: 1 },
  { id: 'rc', label: 'runtimeconfig.json', detail: 'vom Build erzeugt', row: 1, col: 2 },
  {
    id: 'init',
    label: 'Welche Quelle gewinnt?',
    detail: 'GC-Initialisierung, liest einmal',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'run',
    label: 'Wert steht fest',
    detail: 'für die ganze Laufzeit',
    row: 1,
    col: 4,
    shape: 'end',
  },
  { id: 'env', label: 'Umgebungsvariable', detail: 'DOTNET_ beim Start', row: 2, col: 3 },
  {
    id: 'setenv',
    label: 'Variable zur Laufzeit',
    detail: 'SetEnvironmentVariable',
    row: 2,
    col: 4,
  },
];
const EDGES: Edge[] = [
  { from: 'csproj', to: 'rc', label: 'Build' },
  { from: 'rc', to: 'init', label: 'bis .NET 8' },
  { from: 'env', to: 'init', label: 'ab .NET 9' },
  { from: 'init', to: 'run' },
  { from: 'setenv', to: 'run', label: 'wirkungslos' },
];

/** Graph for one step: nodes and edges not listed are pending or idle. */
function graph(
  nodes: Partial<Record<string, Status>>,
  edges: Partial<Record<string, EdgeStatus>> = {},
): Pick<GraphState, 'nodes' | 'edges'> {
  return {
    nodes: NODES.map((n) => ({ ...n, status: nodes[n.id] ?? 'pending' })),
    edges: EDGES.map((e) => ({ ...e, status: edges[`${e.from}->${e.to}`] ?? 'idle' })),
  };
}

const fCsproj = { id: 'f-csproj', label: 'ServerGarbageCollection', value: 'true' };
const fRc = { id: 'f-rc', label: 'System.GC.Server', value: 'true' };
const fEnv = { id: 'f-env', label: 'DOTNET_gcServer', value: '0' };

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Woher eine GC-Einstellung kommt',
  code: {
    cs: `// 1. MyApp.csproj
//    <ServerGarbageCollection>true</ServerGarbageCollection>
// 2. bin/MyApp.runtimeconfig.json (erzeugt der Build)
//    "configProperties": { "System.GC.Server": true }
// 3. Shell oder Container beim Start
//    export DOTNET_gcServer=0
// 4. Program.cs
using System.Runtime;

Console.WriteLine(GCSettings.IsServerGC);
Environment.SetEnvironmentVariable("DOTNET_gcServer", "1");
Console.WriteLine(GCSettings.IsServerGC);`,
  },
  steps: [
    {
      codeLine: 2,
      state: { ...graph({ csproj: 'active' }), facts: [fCsproj] },
      changed: ['csproj', 'f-csproj'],
      explanation:
        'Du schreibst die Einstellung als **MSBuild-Eigenschaft** in die Projektdatei. Die Runtime liest die Projektdatei nie, sie ist nur Eingabe für den Build.',
    },
    {
      codeLine: 4,
      state: {
        ...graph({ csproj: 'done', rc: 'active' }, { 'csproj->rc': 'taken' }),
        facts: [fCsproj, fRc],
      },
      changed: ['rc', 'f-rc'],
      explanation:
        'Der Build übersetzt die Eigenschaft in einen Eintrag unter `configProperties` in `MyApp.runtimeconfig.json`. Einträge aus einer `runtimeconfig.template.json` neben der Projektdatei landen ebenfalls hier. Diese Datei liest der Host beim Start.',
    },
    {
      codeLine: 6,
      state: {
        ...graph({ csproj: 'done', rc: 'done', env: 'active' }, { 'csproj->rc': 'taken' }),
        facts: [fCsproj, fRc, fEnv],
      },
      changed: ['env', 'f-env'],
      explanation:
        'Im Container setzt jemand zusätzlich `DOTNET_gcServer=0`. Jetzt gibt es zwei widersprüchliche Angaben für dieselbe Einstellung.',
    },
    {
      codeLine: 10,
      state: {
        ...graph(
          { csproj: 'done', rc: 'done', env: 'done', init: 'active' },
          { 'csproj->rc': 'taken', 'rc->init': 'rejected', 'env->init': 'taken' },
        ),
        facts: [
          fCsproj,
          fRc,
          fEnv,
          { id: 'f-old', label: 'Gewinner bis .NET 8', value: 'runtimeconfig.json (Server)' },
          { id: 'f-new', label: 'Gewinner ab .NET 9', value: 'Umgebungsvariable (Workstation)' },
        ],
        output: 'False   (ab .NET 9)',
      },
      changed: ['init', 'f-old', 'f-new'],
      explanation:
        'Beim Initialisieren entscheidet der GC einmal. Seit **.NET 9** gewinnt laut Microsoft Learn die Umgebungsvariable, vorher gewann `runtimeconfig.json`. Dieselbe Konfiguration ergibt je nach Runtime-Version also einen anderen GC-Modus.',
    },
    {
      codeLine: 11,
      state: {
        ...graph(
          { csproj: 'done', rc: 'done', env: 'done', init: 'done', run: 'done', setenv: 'active' },
          {
            'csproj->rc': 'taken',
            'rc->init': 'rejected',
            'env->init': 'taken',
            'init->run': 'taken',
            'setenv->run': 'rejected',
          },
        ),
        facts: [
          { id: 'f-proc', label: 'DOTNET_gcServer (Prozessumgebung)', value: '1' },
          { id: 'f-mode', label: 'GC-Modus', value: 'Workstation (unverändert)' },
        ],
        output: 'False',
      },
      changed: ['setenv', 'f-proc'],
      explanation:
        'Häufige Fehlannahme: Eine Umgebungsvariable zur Laufzeit zu ändern, schalte den GC um. Die GC-Einstellungen werden nur beim Start gelesen, die Änderung wirkt höchstens auf Kindprozesse.',
    },
    {
      codeLine: 12,
      state: {
        ...graph(
          {
            csproj: 'done',
            rc: 'done',
            env: 'done',
            init: 'done',
            run: 'active',
            setenv: 'rejected',
          },
          {
            'csproj->rc': 'taken',
            'rc->init': 'rejected',
            'env->init': 'taken',
            'init->run': 'taken',
            'setenv->run': 'rejected',
          },
        ),
        facts: [{ id: 'f-mode', label: 'GC-Modus', value: 'Workstation' }],
        output: 'False\nFalse',
      },
      changed: ['f-mode'],
      explanation:
        'Der Modus bleibt für die ganze Lebensdauer des Prozesses gleich. Eine Ausnahme sind nur die Speicherlimits: `GC.RefreshMemoryLimit` liest sie seit .NET 8 neu, aber aus `AppContext`, nicht aus Umgebungsvariablen.',
    },
  ],
});
