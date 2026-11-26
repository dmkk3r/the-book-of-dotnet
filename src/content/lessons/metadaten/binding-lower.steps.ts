import { defineStepScript, type GraphState } from '@/components/viz';

// A lower version on the TPA list, and a higher version with a removed method.
// Sources: NuGet "Direct dependency wins" can downgrade a package and raises NU1605 (Microsoft Learn,
// NuGet dependency resolution). Binder: IsCompatibleAssemblyVersion and FUSION_E_REF_DEF_MISMATCH in
// src/coreclr/binder/assemblybindercommon.cpp (release/9.0).
// Contoso.Json and Contoso.Http are fictional.
// TODO(verify): That FUSION_E_REF_DEF_MISMATCH (0x80131040) surfaces as System.IO.FileLoadException with
// the message "Could not load file or assembly 'Contoso.Json, Version=3.0.0.0, ...'. The located assembly's
// manifest definition does not match the assembly reference. (0x80131040)".
// TODO(verify): That NU1605 is treated as an error by default in SDK-style projects.
// TODO(verify): That a method removed in the higher version surfaces as MissingMethodException when the
// caller is JIT compiled.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

// Row 1: from restore to binding. Too low branches down to the exception and its two "fixes",
// high enough continues and may still fail later when a call is resolved.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'nuget', label: 'NuGet-Restore', detail: 'Paketgraph', row: 1, col: 1 },
  { id: 'tpa', label: 'TPA-Liste', detail: 'aus App.deps.json', row: 1, col: 2 },
  {
    id: 'ver',
    label: 'Version reicht?',
    detail: 'gefunden ≥ verlangt',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'bound', label: 'Gebunden', detail: 'neu genug', row: 1, col: 4 },
  { id: 'fix', label: 'Referenz anheben', detail: 'im Projekt', row: 2, col: 2 },
  { id: 'fle', label: 'FileLoadException', detail: 'Datei zu alt', row: 2, col: 3, shape: 'end' },
  { id: 'call', label: 'Aufruf auflösen', detail: 'beim JIT', row: 2, col: 4 },
  { id: 'redirect', label: 'bindingRedirect', detail: 'app.config', row: 3, col: 3 },
  {
    id: 'mme',
    label: 'MissingMethodException',
    detail: 'nicht kompatibel',
    row: 3,
    col: 4,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'nuget', to: 'tpa' },
  { from: 'tpa', to: 'ver' },
  { from: 'ver', to: 'bound', label: 'ja' },
  { from: 'ver', to: 'fle', label: 'nein' },
  { from: 'fle', to: 'redirect', label: 'Ausweg?' },
  { from: 'fle', to: 'fix', label: 'Ausweg' },
  { from: 'fix', to: 'nuget', label: 'neu bauen' },
  { from: 'bound', to: 'call' },
  { from: 'call', to: 'mme', label: 'Methode fehlt' },
];

interface Extra {
  rejected?: string[]; // nodes ruled out in this step
  rejectedEdges?: string[];
}

/** Graph for one run: `path` lists the visited nodes in order, the last one is active. */
function run(
  path: string[],
  facts: Fact[],
  { rejected = [], rejectedEdges = [] }: Extra = {},
): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status: rejected.includes(n.id)
        ? 'rejected'
        : n.id === path[path.length - 1]
          ? 'active'
          : visited.has(n.id)
            ? 'done'
            : 'pending',
    })),
    edges: EDGES.map((e) => {
      const id = `${e.from}->${e.to}`;
      return {
        ...e,
        status: rejectedEdges.includes(id) ? 'rejected' : pairs.has(id) ? 'taken' : 'idle',
      };
    }),
    facts,
  };
}

const FLE = 'FileLoadException: Contoso.Json, Version=3.0.0.0 (Manifest passt nicht zum Verweis)';

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wenn die gefundene Version zu niedrig ist',
  code: {
    cs: `<!-- App.csproj -->
<PackageReference Include="Contoso.Json" Version="2.3.0" />
<PackageReference Include="Contoso.Http" Version="5.0.0" />
<!-- Contoso.Http 5.0.0 hängt ab von Contoso.Json >= 3.0.0 -->

// Contoso.Http.dll enthält die AssemblyRef
//   Contoso.Json, Version=3.0.0.0

// <!-- app.config, wie aus .NET Framework gewohnt -->
// <bindingRedirect oldVersion="0.0.0.0-3.0.0.0" newVersion="2.3.0.0" />

// Korrektur: direkte Referenz anheben
<PackageReference Include="Contoso.Json" Version="3.0.0" />`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(
        ['nuget'],
        [
          { id: 'f-direct', label: 'Direkt verlangt', value: 'Contoso.Json 2.3.0' },
          { id: 'f-trans', label: 'Über Contoso.Http verlangt', value: 'Contoso.Json ≥ 3.0.0' },
          { id: 'f-rule', label: 'NuGet-Regel', value: 'direkte Abhängigkeit gewinnt' },
          { id: 'f-warn', label: 'Meldung', value: 'NU1605: Paket herabgestuft' },
        ],
      ),
      changed: ['f-direct', 'f-trans', 'f-rule', 'f-warn'],
      explanation:
        'Beim Restore gewinnt die **direkte** Abhängigkeit des Projekts, auch wenn sie niedriger ist als das, was ein anderes Paket verlangt. NuGet meldet das als Herabstufung mit NU1605. Wer die Meldung unterdrückt, baut ein Problem für die Laufzeit.',
    },
    {
      codeLine: 6,
      state: run(
        ['nuget', 'tpa'],
        [
          { id: 'f-tpa', label: 'Auf der TPA-Liste', value: 'Contoso.Json.dll, Version 2.3.0.0' },
          { id: 'f-ref', label: 'Contoso.Http verlangt', value: 'Version=3.0.0.0' },
        ],
      ),
      changed: ['f-tpa', 'f-ref'],
      explanation:
        'Die `deps.json` enthält Contoso.Json 2.3.0, also steht genau diese Datei auf der TPA-Liste. `Contoso.Http.dll` wurde aber gegen 3.0 kompiliert, und das steht unveränderlich in ihrer AssemblyRef.',
    },
    {
      codeLine: 7,
      state: {
        ...run(
          ['nuget', 'tpa', 'ver', 'fle'],
          [
            { id: 'f-req', label: 'Verlangt', value: '3.0.0.0' },
            { id: 'f-found', label: 'Gefunden', value: '2.3.0.0' },
            { id: 'f-ok', label: 'gefunden ≥ verlangt', value: 'nein' },
          ],
        ),
        output: FLE,
      },
      changed: ['f-req', 'f-found', 'f-ok'],
      explanation:
        'Name und Kultur passen, die Version nicht: 2 ist kleiner als 3. Der Binder lehnt ab, und es gibt eine **FileLoadException**, keine FileNotFoundException. Die Datei wurde gefunden, sie ist nur zu alt.',
    },
    {
      codeLine: 10,
      state: {
        ...run(
          ['nuget', 'tpa', 'ver', 'fle'],
          [
            { id: 'f-redirect', label: 'bindingRedirect in app.config', value: 'wird ignoriert' },
            { id: 'f-why', label: 'Warum', value: '.NET (Core) liest keine Binding Redirects' },
          ],
          { rejected: ['redirect'], rejectedEdges: ['fle->redirect'] },
        ),
        output: FLE,
      },
      changed: ['redirect', 'f-redirect', 'f-why'],
      explanation:
        'Häufige Fehlannahme: „Ein Binding Redirect löst das.“ In .NET Framework hätte ein Redirect die Anfrage auf 2.3 umgebogen. .NET (Core) kennt diesen Mechanismus nicht, und eine niedrigere Version lässt sich auch nicht erzwingen. Die Lösung liegt im Build, nicht in der Konfiguration.',
    },
    {
      codeLine: 13,
      state: {
        ...run(
          ['fix', 'nuget', 'tpa', 'ver', 'bound'],
          [
            { id: 'f-tpa', label: 'Auf der TPA-Liste', value: 'Contoso.Json.dll, Version 3.0.0.0' },
            { id: 'f-app', label: 'App verlangt', value: '3.0.0.0 (neu gebaut)' },
            { id: 'f-http', label: 'Contoso.Http verlangt', value: '3.0.0.0' },
          ],
        ),
        output: 'Beide Verweise binden an Contoso.Json 3.0.0.0',
      },
      changed: ['f-tpa', 'f-app', 'f-http'],
      explanation:
        'Mit der angehobenen direkten Referenz wählt NuGet 3.0.0, die `deps.json` nennt 3.0, und jeder Verweis bekommt eine Version, die mindestens so hoch ist wie verlangt.',
    },
    {
      codeLine: 13,
      state: {
        ...run(
          ['tpa', 'ver', 'bound', 'call', 'mme'],
          [
            { id: 'f-old', label: 'Alte Bibliothek gebaut gegen', value: 'Contoso.Json 2.0.0.0' },
            { id: 'f-bind', label: 'Binding an 3.0.0.0', value: 'erfolgreich' },
            { id: 'f-member', label: 'Methode Parser.ParseLegacy', value: 'in 3.0 entfernt' },
          ],
        ),
        output: 'MissingMethodException: Contoso.Json.Parser.ParseLegacy',
      },
      changed: ['f-old', 'f-bind', 'f-member'],
      explanation:
        'Die Kehrseite der lockeren Regel: Eine Bibliothek, die gegen 2.0 gebaut wurde, bindet klaglos an 3.0. Fehlt dort eine Methode, die sie aufruft, kommt der Fehler erst, wenn der JIT den Aufruf auflöst. Die Versionsprüfung sagt nur „neu genug“, nicht „kompatibel“.',
    },
  ],
});
