import { defineStepScript, type GraphState } from '@/components/viz';

// Precedence between runtimeconfig.json and DOTNET_ environment variables, .NET 8 vs .NET 9.
// Sources: Microsoft Learn "Runtime configuration options" (runtime-config/index) and the
// breaking change "Environment variables take precedence in app runtime configuration
// settings" (.NET 9), which uses exactly this System.GC.Server / DOTNET_gcServer example.
// TODO(verify): That AppContext.GetData("System.GC.Server") still returns "true" when
// DOTNET_gcServer=0 overrides it (the GC reads the environment variable itself, the
// AppContext property bag is filled from the host properties only).
// TODO(verify): That AppContext.SetSwitch("System.GC.Server", ...) in Main has no effect on
// the already initialized GC.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];
type NodeStatus = Node['status'];
type EdgeStatus = NonNullable<Edge['status']>;

// Both inputs meet in the decision at GC start. GetData reads the file value directly.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'file', label: 'runtimeconfig.json', detail: 'System.GC.Server: true', row: 1, col: 2 },
  { id: 'data', label: 'AppContext.GetData', detail: 'Wert aus der Datei', row: 1, col: 3 },
  { id: 'env', label: 'Umgebung', detail: 'DOTNET_gcServer=0', row: 2, col: 1 },
  {
    id: 'gc',
    label: 'Wer gewinnt?',
    detail: 'beim GC-Start',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  { id: 'ws', label: 'Workstation-GC', detail: 'Umgebung gewinnt', row: 2, col: 3, shape: 'end' },
  { id: 'obs', label: 'IsServerGC', detail: 'fragt den GC', row: 2, col: 4 },
  { id: 'srv', label: 'Server-GC', detail: 'Datei gewinnt', row: 3, col: 2, shape: 'end' },
  { id: 'set', label: 'SetSwitch in Main', detail: 'nach dem GC-Start', row: 3, col: 3 },
];
const EDGES: Edge[] = [
  { from: 'file', to: 'gc' },
  { from: 'env', to: 'gc' },
  { from: 'gc', to: 'srv', label: '.NET 8' },
  { from: 'gc', to: 'ws', label: '.NET 9' },
  { from: 'file', to: 'data', label: 'übergeben' },
  { from: 'ws', to: 'obs' },
  { from: 'set', to: 'ws', label: 'zu spät' },
];

interface Look {
  status: Partial<Record<string, NodeStatus>>;
  edges?: Partial<Record<string, EdgeStatus>>;
  facts: Fact[];
  output?: string;
}

function graph({ status, edges = {}, facts, output }: Look): GraphState {
  return {
    nodes: NODES.map((n) => ({ ...n, status: status[n.id] ?? 'pending' })),
    edges: EDGES.map((e) => ({ ...e, status: edges[`${e.from}->${e.to}`] ?? 'idle' })),
    facts,
    ...(output ? { output } : {}),
  };
}

const INPUTS = { 'file->gc': 'taken', 'env->gc': 'taken' } as const;

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wer gewinnt: Datei oder Umgebungsvariable?',
  code: {
    cs: `// App.runtimeconfig.json enthält
// "configProperties": { "System.GC.Server": true }

// $ DOTNET_gcServer=0 dotnet App.dll

using System.Runtime;
Console.WriteLine(GCSettings.IsServerGC);
Console.WriteLine(AppContext.GetData("System.GC.Server"));

// Zu spät: der GC ist längst initialisiert
AppContext.SetSwitch("System.GC.Server", false);
Console.WriteLine(GCSettings.IsServerGC);`,
  },
  steps: [
    {
      codeLine: 2,
      state: graph({
        status: { file: 'active' },
        facts: [{ id: 'f-file', label: 'Datei', value: 'System.GC.Server = true' }],
      }),
      changed: ['f-file'],
      explanation:
        'Die App wurde mit `ServerGarbageCollection` gebaut, die Datei fordert also Server-GC. Derselbe Schalter hat aber noch einen zweiten Eingang: die Umgebungsvariable `DOTNET_gcServer`.',
    },
    {
      codeLine: 4,
      state: graph({
        status: { file: 'done', env: 'active' },
        facts: [
          { id: 'f-file', label: 'Datei', value: 'System.GC.Server = true' },
          { id: 'f-env', label: 'Umgebung', value: 'DOTNET_gcServer = 0' },
        ],
      }),
      changed: ['f-env'],
      explanation:
        'Jemand hat im Container-Image `DOTNET_gcServer=0` gesetzt, etwa um Speicher zu sparen. Beachte: Die Variable heißt anders als der Schlüssel in der Datei. Welcher Variablenname zu welchem Schlüssel gehört, steht in der Dokumentation der jeweiligen Einstellung.',
    },
    {
      codeLine: 6,
      state: graph({
        status: { file: 'done', env: 'done', gc: 'done', srv: 'active' },
        edges: { ...INPUTS, 'gc->srv': 'taken' },
        facts: [{ id: 'f-v8', label: '.NET 8', value: 'Datei gewinnt: Server-GC' }],
        output: '.NET 8: True',
      }),
      changed: ['f-v8'],
      explanation:
        'Bis .NET 8 hatte bei solchen Konflikten `runtimeconfig.json` Vorrang, die Variable wurde stillschweigend ignoriert. Der GC startet im Server-Modus, als gäbe es `DOTNET_gcServer` gar nicht.',
    },
    {
      codeLine: 6,
      state: graph({
        status: { file: 'done', env: 'done', gc: 'done', srv: 'skipped', ws: 'active' },
        edges: { ...INPUTS, 'gc->ws': 'taken' },
        facts: [
          { id: 'f-v8', label: '.NET 8', value: 'Datei gewinnt: Server-GC' },
          { id: 'f-v9', label: '.NET 9 und neuer', value: 'Umgebung gewinnt: Workstation-GC' },
        ],
        output: '.NET 8: True\n.NET 9: False',
      }),
      changed: ['f-v9'],
      explanation:
        'Seit .NET 9 gewinnt die Umgebungsvariable. Dieselbe App verhält sich nach einem Runtime-Update also anders, ohne dass sich eine Datei geändert hat.',
    },
    {
      codeLine: 7,
      state: graph({
        status: {
          file: 'done',
          env: 'done',
          gc: 'done',
          srv: 'skipped',
          ws: 'done',
          data: 'done',
          obs: 'active',
        },
        edges: { ...INPUTS, 'gc->ws': 'taken', 'ws->obs': 'taken', 'file->data': 'taken' },
        facts: [
          { id: 'f-v9', label: '.NET 9: IsServerGC', value: 'False' },
          { id: 'f-data', label: 'AppContext.GetData', value: '"true"' },
        ],
        output: 'False\ntrue',
      }),
      changed: ['f-v9', 'f-data'],
      explanation:
        '`AppContext.GetData` zeigt nur, was der Host übergeben hat, also den Wert aus der Datei. Ob die Runtime ihn auch verwendet, verrät erst die API der Komponente selbst, hier `GCSettings.IsServerGC`.',
    },
    {
      codeLine: 12,
      state: graph({
        status: {
          file: 'done',
          env: 'done',
          gc: 'done',
          srv: 'skipped',
          ws: 'done',
          data: 'done',
          obs: 'done',
          set: 'rejected',
        },
        edges: {
          ...INPUTS,
          'gc->ws': 'taken',
          'ws->obs': 'taken',
          'file->data': 'taken',
          'set->ws': 'rejected',
        },
        facts: [
          { id: 'f-set', label: 'SetSwitch in Main', value: 'ändert nur den AppContext' },
          { id: 'f-gc', label: 'GC', value: 'bleibt, wie er gestartet wurde' },
        ],
        output: 'False\ntrue\nFalse',
      }),
      changed: ['set', 'f-set', 'f-gc'],
      explanation:
        'Häufige Fehlannahme: „Mit `AppContext.SetSwitch` kann ich jede Runtime-Einstellung im Code setzen.“ Einstellungen, die beim Start gelesen werden, wie GC-Modus oder Tiered Compilation, sind zu diesem Zeitpunkt längst entschieden. `SetSwitch` wirkt nur auf Code, der den Schalter später abfragt.',
    },
  ],
});
