import { defineStepScript, type GraphState } from '@/components/viz';

// How a framework-dependent apphost locates hostfxr, and why the muxer does not need DOTNET_ROOT.
// Sources: dotnet/runtime docs/design/features/host-probing.md and host-components.md,
// Microsoft Learn ".NET environment variables" (DOTNET_ROOT).
// TODO(verify): Search order app-local, DOTNET_ROOT_<ARCH>, DOTNET_ROOT, registered install location,
// default install location, and that .NET 9 added configurable search options for the apphost.
// TODO(verify): Registered location: /etc/dotnet/install_location on Linux and macOS,
// HKLM\SOFTWARE\dotnet\Setup\InstalledVersions\<arch>\InstallLocation on Windows.
// TODO(verify): Wording of the apphost error message ("You must install .NET to run this application.").

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

// Row 1: the muxer needs no search. Row 2: the search order of the apphost, left to right.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'start', label: 'Wer startet?', row: 1, col: 1, shape: 'decision' },
  { id: 'muxer', label: 'Neben sich suchen', detail: 'Muxer kennt seinen Ort', row: 1, col: 2 },
  {
    id: 'fxr',
    label: 'hostfxr laden',
    detail: 'weiter wie beim Muxer',
    row: 1,
    col: 3,
    shape: 'end',
  },
  {
    id: 'local',
    label: 'Im App-Ordner?',
    detail: 'self-contained?',
    row: 2,
    col: 1,
    shape: 'decision',
  },
  {
    id: 'env',
    label: 'DOTNET_ROOT gesetzt?',
    detail: 'Umgebungsvariable',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'reg',
    label: 'Ort registriert?',
    detail: 'vom Installer eingetragen',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'def',
    label: 'Im Standardpfad?',
    detail: 'je nach Betriebssystem',
    row: 2,
    col: 4,
    shape: 'decision',
  },
  { id: 'fail', label: 'Abbruch', detail: 'hostfxr nicht gefunden', row: 3, col: 4, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'start', to: 'muxer', label: 'dotnet' },
  { from: 'start', to: 'local', label: './App' },
  { from: 'muxer', to: 'fxr' },
  { from: 'local', to: 'fxr', label: 'ja' },
  { from: 'local', to: 'env', label: 'nein' },
  { from: 'env', to: 'fxr', label: 'ja' },
  { from: 'env', to: 'reg', label: 'nein' },
  { from: 'reg', to: 'fxr', label: 'ja' },
  { from: 'reg', to: 'def', label: 'nein' },
  { from: 'def', to: 'fxr', label: 'ja' },
  { from: 'def', to: 'fail', label: 'nein' },
];

/** Graph for one run: `path` lists the visited nodes in order, the last one is active.
 * `skipped` marks nodes that are not part of this kind of start at all. */
function run(path: string[], facts: Fact[], skipped: string[] = []): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status:
        n.id === path[path.length - 1]
          ? 'active'
          : visited.has(n.id)
            ? 'done'
            : skipped.includes(n.id)
              ? 'skipped'
              : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const APPHOST = ['muxer'];
const MUXER = ['local', 'env', 'reg', 'def', 'fail'];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wie der App-Starter die Runtime findet',
  code: {
    cs: `// .NET per Skript ins Home-Verzeichnis installiert
// $ ./dotnet-install.sh --channel 8.0 --runtime dotnet
// $ export PATH="$HOME/.dotnet:$PATH"

// $ dotnet App.dll
// Hallo aus Main

// $ ./App
// You must install .NET to run this application.

// $ export DOTNET_ROOT="$HOME/.dotnet"
// $ ./App
// Hallo aus Main`,
  },
  steps: [
    {
      codeLine: 5,
      state: {
        ...run(
          ['start', 'muxer', 'fxr'],
          [
            { id: 'f-starter', label: 'Starter', value: '~/.dotnet/dotnet (über PATH gefunden)' },
            {
              id: 'f-how',
              label: 'hostfxr gesucht in',
              value: '~/.dotnet/host/fxr/ (neben sich selbst)',
            },
          ],
          MUXER,
        ),
        output: 'Hallo aus Main',
      },
      changed: ['f-starter', 'f-how'],
      explanation:
        'Über den Muxer klappt alles: `dotnet` sucht `hostfxr` immer relativ zu seinem eigenen Ort. Wo es liegt, ist egal, solange die Shell es über `PATH` findet. Eine Suche ist nicht nötig.',
    },
    {
      codeLine: 8,
      state: run(
        ['start', 'local'],
        [
          { id: 'f-starter', label: 'Starter', value: './App (App-Starter)' },
          {
            id: 'f-local',
            label: 'hostfxr im App-Ordner',
            value: 'nein, App ist framework-abhängig',
          },
        ],
        APPHOST,
      ),
      changed: ['f-starter', 'f-local'],
      explanation:
        'Der App-Starter ist eine Kopie einer Vorlage, in die der Build den Namen `App.dll` eingetragen hat. Er schaut zuerst in den eigenen Ordner: Läge dort `hostfxr`, wäre die App self-contained. Hier liegt keins.',
    },
    {
      codeLine: 8,
      state: run(
        ['start', 'local', 'env', 'reg', 'def'],
        [
          { id: 'f-env', label: 'DOTNET_ROOT', value: 'nicht gesetzt' },
          { id: 'f-reg', label: 'Registrierter Ort', value: 'keiner (Skript-Installation)' },
          { id: 'f-def', label: 'Standardpfad', value: 'dort ist kein .NET installiert' },
        ],
        APPHOST,
      ),
      changed: ['f-env', 'f-reg', 'f-def'],
      explanation:
        'Dann prüft er die Umgebungsvariable `DOTNET_ROOT`, danach den Ort, den ein Installer systemweit eingetragen hat, zuletzt den Standardpfad des Betriebssystems. Das Installationsskript hat nichts davon angelegt.',
    },
    {
      codeLine: 9,
      state: {
        ...run(
          ['start', 'local', 'env', 'reg', 'def', 'fail'],
          [{ id: 'f-pick', label: 'hostfxr', value: 'nicht gefunden' }],
          APPHOST,
        ),
        output: 'You must install .NET to run this application.',
      },
      changed: ['f-pick'],
      explanation:
        'Häufige Fehlannahme: „`dotnet --info` funktioniert, also findet jede App die Runtime.“ Der App-Starter kennt `PATH` nicht als Suchort für .NET. Er gibt auf, obwohl `~/.dotnet` eine vollständige Runtime enthält.',
    },
    {
      codeLine: 12,
      state: {
        ...run(
          ['start', 'local', 'env', 'fxr'],
          [
            { id: 'f-env', label: 'DOTNET_ROOT', value: '~/.dotnet' },
            { id: 'f-pick', label: 'hostfxr', value: '~/.dotnet/host/fxr/<Version>/' },
          ],
          APPHOST,
        ),
        output: 'Hallo aus Main',
      },
      changed: ['f-env', 'f-pick'],
      explanation:
        'Mit gesetztem `DOTNET_ROOT` findet der App-Starter `hostfxr`, und ab hier läuft alles wie beim Muxer: Framework wählen, `hostpolicy` laden, Runtime starten.',
    },
  ],
});
