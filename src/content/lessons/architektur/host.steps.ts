import { defineStepScript, type PipelineState } from '@/components/viz';

// Start of a framework-dependent app via the muxer.
// Sources: dotnet/runtime docs/design/features/host-components.md, host-probing.md,
// framework-version-resolution.md, native-hosting.md.
// TODO(verify): Generated App.runtimeconfig.json and App.deps.json content for net8.0 (configProperties omitted here).
// TODO(verify): Installed versions (8.0.4, 8.0.11, 9.0.0) and the hostfxr version are examples only.
// TODO(verify): Runtime property names TRUSTED_PLATFORM_ASSEMBLIES, NATIVE_DLL_SEARCH_DIRECTORIES,
// APP_CONTEXT_BASE_DIRECTORY passed by hostpolicy to coreclr_initialize.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  { id: 'muxer', label: 'dotnet', detail: 'Muxer', status: status[0] ?? 'pending' },
  { id: 'fxr', label: 'hostfxr', detail: 'host/fxr/<Version>/', status: status[1] ?? 'pending' },
  {
    id: 'fw',
    label: 'Framework wählen',
    detail: 'runtimeconfig.json',
    status: status[2] ?? 'pending',
  },
  { id: 'policy', label: 'hostpolicy', detail: 'deps.json, TPA', status: status[3] ?? 'pending' },
  {
    id: 'init',
    label: 'coreclr_initialize',
    detail: 'Runtime starten',
    status: status[4] ?? 'pending',
  },
  {
    id: 'exec',
    label: 'coreclr_execute_assembly',
    detail: 'Main aufrufen',
    status: status[5] ?? 'pending',
  },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Von dotnet App.dll bis Main',
  code: {
    cs: `// $ dotnet bin/Release/net8.0/App.dll

// App.runtimeconfig.json (vom Build erzeugt)
// {
//   "runtimeOptions": {
//     "tfm": "net8.0",
//     "framework": {
//       "name": "Microsoft.NETCore.App",
//       "version": "8.0.0"
//     }
//   }
// }

// App.deps.json (vom Build erzeugt, gekürzt)
// "targets": { ".NETCoreApp,Version=v8.0": {
//   "App/1.0.0": { "runtime": { "App.dll": {} } } } }

// Program.cs
Console.WriteLine("Hallo aus Main");`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        stages: stages('active'),
        facts: [
          { id: 'f-proc', label: 'Prozess', value: 'dotnet' },
          {
            id: 'f-mode',
            label: 'Erstes Argument',
            value: 'Pfad zu einer .dll, also: App ausführen',
          },
        ],
      },
      changed: ['muxer', 'f-proc', 'f-mode'],
      explanation:
        'Das Betriebssystem startet das native Programm `dotnet`, den **Muxer**. Er kann SDK-Befehle wie `build` und Apps ausführen. Selbst entscheidet er wenig: Er sucht zuerst `hostfxr` im Ordner `host/fxr/` neben sich.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-proc', label: 'Prozess', value: 'dotnet' },
          { id: 'f-fxr', label: 'Geladen', value: 'hostfxr 9.0.0 (höchste installierte Version)' },
        ],
      },
      changed: ['fxr', 'f-fxr'],
      explanation:
        'Liegen dort mehrere Versionen, nimmt der Muxer die **höchste** und lädt sie als Bibliothek in den eigenen Prozess. `hostfxr` ist abwärtskompatibel, deshalb darf eine .NET-8-App von `hostfxr` aus .NET 9 bedient werden.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-req', label: 'Gefordert', value: 'Microsoft.NETCore.App 8.0.0' },
          { id: 'f-inst', label: 'Installiert', value: '8.0.4, 8.0.11, 9.0.0' },
          { id: 'f-rule', label: 'Regel', value: 'rollForward: Minor (Standard)' },
          { id: 'f-pick', label: 'Gewählt', value: '8.0.11' },
        ],
      },
      changed: ['fw', 'f-req', 'f-inst', 'f-rule', 'f-pick'],
      explanation:
        '`hostfxr` liest `App.runtimeconfig.json` und durchsucht `shared/Microsoft.NETCore.App/`. Die geforderte 8.0.0 ist eine **Mindestversion**: Nach der Standardregel nimmt er den neuesten installierten Patch derselben Hauptversion, also 8.0.11.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          {
            id: 'f-policy',
            label: 'hostpolicy aus',
            value: 'shared/Microsoft.NETCore.App/8.0.11/',
          },
        ],
      },
      changed: ['policy', 'f-policy'],
      explanation:
        'Jetzt lädt `hostfxr` die Bibliothek `hostpolicy`, und zwar aus dem **gewählten Framework-Ordner**. Damit passt `hostpolicy` immer genau zur Runtime-Version, die gleich startet, während `hostfxr` aus einer anderen Version stammen kann.',
    },
    {
      codeLine: 16,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          {
            id: 'f-deps',
            label: 'Gelesen',
            value: 'App.deps.json, Microsoft.NETCore.App.deps.json',
          },
          {
            id: 'f-tpa',
            label: 'TPA-Liste',
            value:
              'App.dll, System.Private.CoreLib.dll, System.Runtime.dll, System.Console.dll, ...',
          },
          { id: 'f-native', label: 'Native Suchpfade', value: 'App-Ordner, Framework-Ordner' },
        ],
      },
      changed: ['f-deps', 'f-tpa', 'f-native'],
      explanation:
        '`hostpolicy` liest die `.deps.json` der App und des Frameworks und baut daraus die **TPA-Liste** (Trusted Platform Assemblies): vollständige Pfade aller Assemblies, die die Runtime ohne weitere Suche laden darf. Dazu kommen Suchpfade für native Bibliotheken.',
    },
    {
      codeLine: 19,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        facts: [
          {
            id: 'f-clr',
            label: 'Geladen',
            value: 'coreclr aus shared/Microsoft.NETCore.App/8.0.11/',
          },
          {
            id: 'f-props',
            label: 'Übergeben',
            value: 'TRUSTED_PLATFORM_ASSEMBLIES, APP_CONTEXT_BASE_DIRECTORY, configProperties',
          },
        ],
      },
      changed: ['init', 'f-clr', 'f-props'],
      explanation:
        '`hostpolicy` lädt die Runtime-Bibliothek `coreclr` aus demselben Ordner und ruft `coreclr_initialize` auf. Die TPA-Liste und alle Einstellungen gehen als Liste von Schlüssel-Wert-Paaren mit. Was die Runtime damit anfängt, zeigt „Vom Prozessstart bis Main“.',
    },
    {
      codeLine: 19,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'active'),
        facts: [{ id: 'f-entry', label: 'Einstiegspunkt', value: 'Program.Main aus App.dll' }],
        output: 'Hallo aus Main',
      },
      changed: ['exec', 'f-entry'],
      explanation:
        '`coreclr_execute_assembly` lädt `App.dll`, sucht den Einstiegspunkt aus den Metadaten und ruft ihn auf. Erst jetzt läuft zum ersten Mal Code, den du geschrieben hast.',
    },
    {
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done'),
        facts: [
          { id: 'f-proc', label: 'Prozess', value: 'immer noch dotnet, nur einer' },
          {
            id: 'f-exit',
            label: 'Rückgabe',
            value: 'Exitcode von Main durch alle Schichten zurück',
          },
        ],
        output: 'Hallo aus Main',
      },
      changed: ['f-proc', 'f-exit'],
      explanation:
        'Häufige Fehlannahme: „`dotnet` startet die Runtime als eigenen Prozess.“ Alle Schichten sind Bibliotheken **im selben Prozess**. Kehrt `Main` zurück, wandert der Exitcode zurück durch `hostpolicy`, `hostfxr` und den Muxer zum Betriebssystem.',
    },
  ],
});
