import { defineStepScript, type PipelineState } from '@/components/viz';

// From project file to a runtime setting: how ServerGarbageCollection travels to the GC.
// Sources: Microsoft Learn "Runtime configuration options" (runtime-config/index),
// "Runtime configuration options for garbage collection", dotnet/runtime
// docs/design/features/host-runtime-information.md.
// TODO(verify): Exact generated App.runtimeconfig.json for net8.0 with these properties
// (property order, whether booleans are written as JSON booleans).
// TODO(verify): That InvariantGlobalization maps to System.Globalization.Invariant and
// ServerGarbageCollection to System.GC.Server in the generated file.
// TODO(verify): That the GC reads System.GC.Server from the runtime properties during
// coreclr_initialize (GCConfig public config name) and that AppContext.GetData returns "true".

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  {
    id: 'proj',
    label: 'App.csproj',
    detail: 'MSBuild-Eigenschaften',
    status: status[0] ?? 'pending',
  },
  {
    id: 'build',
    label: 'dotnet build',
    detail: 'SDK erzeugt Dateien',
    status: status[1] ?? 'pending',
  },
  {
    id: 'file',
    label: 'App.runtimeconfig.json',
    detail: 'im Ausgabeordner',
    status: status[2] ?? 'pending',
  },
  {
    id: 'host',
    label: 'hostfxr, hostpolicy',
    detail: 'lesen und übergeben',
    status: status[3] ?? 'pending',
  },
  {
    id: 'clr',
    label: 'coreclr_initialize',
    detail: 'Eigenschaften',
    status: status[4] ?? 'pending',
  },
  { id: 'app', label: 'Runtime und App', detail: 'GC, AppContext', status: status[5] ?? 'pending' },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Wie eine Einstellung aus der Projektdatei zur Runtime kommt',
  code: {
    cs: `// App.csproj
// <PropertyGroup>
//   <TargetFramework>net8.0</TargetFramework>
//   <ServerGarbageCollection>true</ServerGarbageCollection>
//   <InvariantGlobalization>true</InvariantGlobalization>
// </PropertyGroup>
// <ItemGroup>
//   <RuntimeHostConfigurationOption Include="MyApp.UseNewParser" Value="true" />
// </ItemGroup>

// Program.cs
using System.Runtime;
Console.WriteLine(GCSettings.IsServerGC);
Console.WriteLine(AppContext.GetData("System.GC.Server"));
AppContext.TryGetSwitch("MyApp.UseNewParser", out bool neu);
Console.WriteLine(neu);`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        stages: stages('active'),
        facts: [
          { id: 'f-gc', label: 'ServerGarbageCollection', value: 'true' },
          { id: 'f-inv', label: 'InvariantGlobalization', value: 'true' },
          {
            id: 'f-own',
            label: 'RuntimeHostConfigurationOption',
            value: 'MyApp.UseNewParser = true',
          },
        ],
      },
      changed: ['proj', 'f-gc', 'f-inv', 'f-own'],
      explanation:
        'In der Projektdatei stehen zwei bekannte MSBuild-Eigenschaften und ein eigener Schalter. Für Einstellungen ohne eigene Eigenschaft gibt es das Element `RuntimeHostConfigurationOption`, dessen `Include` der spätere Name in der Datei ist.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-map1', label: 'ServerGarbageCollection', value: 'wird zu System.GC.Server' },
          {
            id: 'f-map2',
            label: 'InvariantGlobalization',
            value: 'wird zu System.Globalization.Invariant',
          },
          {
            id: 'f-map3',
            label: 'runtimeconfig.template.json',
            value: 'wird eingemischt, falls vorhanden',
          },
        ],
      },
      changed: ['build', 'f-map1', 'f-map2', 'f-map3'],
      explanation:
        'Beim Build übersetzt das SDK die Eigenschaften in Schlüssel von `configProperties`. Liegt neben der Projektdatei eine `runtimeconfig.template.json`, kommt ihr Inhalt dazu. Bei gleichen Schlüsseln gewinnt die MSBuild-Eigenschaft.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-tfm', label: 'tfm', value: 'net8.0' },
          { id: 'f-fw', label: 'framework', value: 'Microsoft.NETCore.App 8.0.0' },
          {
            id: 'f-cp',
            label: 'configProperties',
            value: 'System.GC.Server, System.Globalization.Invariant, MyApp.UseNewParser',
          },
        ],
      },
      changed: ['file', 'f-tfm', 'f-fw', 'f-cp'],
      explanation:
        'Ergebnis ist `App.runtimeconfig.json` im Ausgabeordner. Ab hier spielt die Projektdatei keine Rolle mehr: Auf dem Server gibt es keine `.csproj`, nur diese Datei.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-fxr', label: 'hostfxr nutzt', value: 'framework, rollForward' },
          {
            id: 'f-pol',
            label: 'hostpolicy übergibt',
            value: 'alle configProperties als Name und Wert',
          },
          {
            id: 'f-plus',
            label: 'dazu',
            value: 'TRUSTED_PLATFORM_ASSEMBLIES, APP_CONTEXT_BASE_DIRECTORY, ...',
          },
        ],
      },
      changed: ['host', 'f-fxr', 'f-pol', 'f-plus'],
      explanation:
        '`hostfxr` braucht aus der Datei nur den Framework-Teil. `configProperties` interpretiert der Host nicht: `hostpolicy` reicht jeden Eintrag als Zeichenkettenpaar an die Runtime weiter, zusammen mit den eigenen Eigenschaften wie der TPA-Liste.',
    },
    {
      codeLine: 13,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-gcread', label: 'GC liest', value: 'System.GC.Server = true' },
          { id: 'f-heaps', label: 'Folge', value: 'Server-GC statt Workstation-GC' },
        ],
        output: 'True',
      },
      changed: ['clr', 'f-gcread', 'f-heaps'],
      explanation:
        'Die Runtime wertet manche Schlüssel selbst aus, und zwar früh: Der GC entscheidet beim Start, ob er als Server-GC läuft. Deshalb lässt sich das nach dem Start nicht mehr umschalten.',
    },
    {
      codeLine: 16,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-data', label: 'AppContext.GetData', value: '"true" (als Zeichenkette)' },
          { id: 'f-switch', label: 'TryGetSwitch', value: 'MyApp.UseNewParser: true' },
        ],
        output: 'True\ntrue\nTrue',
      },
      changed: ['app', 'f-data', 'f-switch'],
      explanation:
        'Alle Eigenschaften landen außerdem im `AppContext`. Dort kommt jeder Code an sie heran, auch deine Bibliothek mit ihrem eigenen Schalter. `TryGetSwitch` deutet den Text `true` als Wahrheitswert.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done'),
        facts: [
          { id: 'f-edit', label: 'csproj ändern ohne Build', value: 'keine Wirkung' },
          { id: 'f-edit2', label: 'runtimeconfig.json ändern', value: 'wirkt beim nächsten Start' },
        ],
      },
      changed: ['f-edit', 'f-edit2'],
      explanation:
        'Häufige Fehlannahme: „Die Runtime liest die Projektdatei.“ Sie sieht nur `App.runtimeconfig.json`. Wer dort einen Wert ändert, ändert das Verhalten beim nächsten Start ohne Neubau. Der nächste Build überschreibt die Änderung allerdings wieder.',
    },
  ],
});
