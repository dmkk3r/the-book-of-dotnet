import { defineStepScript, type PipelineState } from '@/components/viz';

// Version conflicts are resolved before the runtime binds anything.
// Sources:
//   NuGet cousin dependencies rule: lowest version that satisfies all constraints (Microsoft Learn).
//   .NET SDK ResolvePackageFileConflicts (dotnet/sdk src/Tasks/Common/ConflictResolution/ConflictResolver.cs, main
//   2026-11): package overrides, then higher assembly version, then higher file version, then preferred
//   package, then platform item.
//   hostpolicy: docs/design/features/assembly-conflict-resolution.md in dotnet/runtime: for the same asset
//   name in app and framework deps.json, the higher assembly version, then file version wins; app is processed first.
// TODO(verify): Assembly and file versions of System.Text.Json in the 8.0.x package versus the shared framework
// (assumed here: both AssemblyVersion 8.0.0.0, the framework patch has the newer file version).
// TODO(verify): Whether the SDK already drops the package copy at build time for framework-dependent apps
// (PackageConflictOverrides from the targeting pack), so that hostpolicy never sees the conflict.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  {
    id: 'nuget',
    label: 'NuGet-Restore',
    detail: 'eine Version pro Paket',
    status: status[0] ?? 'pending',
  },
  { id: 'sdk', label: 'SDK-Build', detail: 'eine Datei pro Name', status: status[1] ?? 'pending' },
  {
    id: 'deps',
    label: 'App.deps.json',
    detail: 'Ergebnis des Builds',
    status: status[2] ?? 'pending',
  },
  {
    id: 'host',
    label: 'hostpolicy',
    detail: 'App gegen Framework',
    status: status[3] ?? 'pending',
  },
  { id: 'tpa', label: 'TPA-Liste', detail: 'ein Pfad pro Name', status: status[4] ?? 'pending' },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Wo Versionskonflikte aufgelöst werden',
  code: {
    cs: `<!-- App.csproj, net8.0, framework-abhängig -->
<PackageReference Include="Contoso.Pdf" Version="1.0.0" />
<PackageReference Include="Contoso.Mail" Version="4.2.0" />
<!-- Contoso.Pdf  verlangt Contoso.Json >= 2.0.0 -->
<!-- Contoso.Mail verlangt Contoso.Json >= 2.1.0 -->
<!-- auf dem Feed: Contoso.Json 2.0.0, 2.1.0, 2.3.0 -->

<PackageReference Include="System.Text.Json" Version="8.0.0" />
<!-- System.Text.Json steckt auch im Shared Framework -->`,
  },
  steps: [
    {
      codeLine: 5,
      state: {
        stages: stages('active'),
        facts: [
          { id: 'f-a', label: 'Contoso.Pdf will', value: '≥ 2.0.0' },
          { id: 'f-b', label: 'Contoso.Mail will', value: '≥ 2.1.0' },
          { id: 'f-pick', label: 'NuGet wählt', value: '2.1.0' },
        ],
      },
      changed: ['nuget', 'f-a', 'f-b', 'f-pick'],
      explanation:
        'Zwei Pakete verlangen verschiedene Mindestversionen desselben Pakets. NuGet nimmt die **niedrigste Version, die alle Bedingungen erfüllt**, hier 2.1.0, nicht die neueste auf dem Feed. In einem Projekt gibt es danach nur noch eine Version von Contoso.Json.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-pkg', label: 'Aus dem Paket', value: 'System.Text.Json.dll, 8.0.0.0' },
          {
            id: 'f-order',
            label: 'Reihenfolge',
            value: 'Assembly-Version, Dateiversion, Plattform',
          },
        ],
      },
      changed: ['sdk', 'f-pkg', 'f-order'],
      explanation:
        'Landen zwei Dateien mit gleichem Namen im Build, entscheidet die SDK-Aufgabe `ResolvePackageFileConflicts`: höhere Assembly-Version vor höherer Dateiversion, bei Gleichstand die Datei der Plattform. Pro Name bleibt eine Datei übrig.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-json', label: 'Contoso.Json', value: '2.1.0, assemblyVersion 2.1.0.0' },
          {
            id: 'f-stj',
            label: 'System.Text.Json',
            value: '8.0.0, mit Assembly- und Dateiversion',
          },
        ],
      },
      changed: ['deps', 'f-json', 'f-stj'],
      explanation:
        'In die `App.deps.json` schreibt der Build für jede Datei auch Assembly- und Dateiversion. Diese Zahlen braucht der Host beim Start, denn erst dort trifft die App auf das Framework, das auf der Zielmaschine installiert ist.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          {
            id: 'f-app',
            label: 'App bringt mit',
            value: 'System.Text.Json 8.0.0.0, ältere Dateiversion',
          },
          {
            id: 'f-fx',
            label: 'Framework 8.0.11 hat',
            value: 'System.Text.Json 8.0.0.0, neuere Dateiversion',
          },
          { id: 'f-win', label: 'Gewinner', value: 'Framework (höhere Dateiversion)' },
        ],
      },
      changed: ['host', 'f-app', 'f-fx', 'f-win'],
      explanation:
        '`hostpolicy` liest zuerst die `deps.json` der App, dann die des Frameworks. Gibt es denselben Namen zweimal, gewinnt die höhere Assembly-Version, bei Gleichstand die höhere Dateiversion. Weil das Framework seine Assembly-Versionen bei Patches nicht ändert, entscheidet hier die **Dateiversion**.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done'),
        facts: [
          { id: 'f-t1', label: 'Contoso.Json', value: 'App-Ordner, 2.1.0.0' },
          { id: 'f-t2', label: 'System.Text.Json', value: 'Framework-Ordner, 8.0.0.0' },
        ],
        output: 'TPA-Liste fertig, ein Pfad pro einfachem Namen',
      },
      changed: ['tpa', 'f-t1', 'f-t2'],
      explanation:
        'Am Ende steht pro Name genau ein Pfad auf der TPA-Liste. Der Binder zur Laufzeit wählt also nichts mehr aus, er prüft nur noch, ob die eine Datei neu genug ist. **Alle Konflikte sind vor dem ersten Laden entschieden.**',
    },
  ],
});
