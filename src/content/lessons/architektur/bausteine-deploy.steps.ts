import { defineStepScript, type PipelineState } from '@/components/viz';

// Which building blocks take part in starting the app, and where they come from, per deployment model.
// Sources: Microsoft Learn ".NET application publishing overview" and "Native AOT deployment",
// docs/design/features/host-components.md in dotnet/runtime.
// TODO(verify): File names per OS (libhostfxr.so, libcoreclr.so, libclrjit.so on Linux;
// hostfxr.dll, coreclr.dll, clrjit.dll on Windows) in a current publish output.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  {
    id: 'starter',
    label: 'Starter',
    detail: 'erste ausführbare Datei',
    status: status[0] ?? 'pending',
  },
  { id: 'fxr', label: 'hostfxr', detail: 'Framework wählen', status: status[1] ?? 'pending' },
  {
    id: 'policy',
    label: 'hostpolicy',
    detail: 'Assemblies auflisten',
    status: status[2] ?? 'pending',
  },
  { id: 'clr', label: 'Runtime', detail: 'VM, GC, CoreLib', status: status[3] ?? 'pending' },
  { id: 'jit', label: 'JIT', detail: 'IL übersetzen', status: status[4] ?? 'pending' },
  { id: 'app', label: 'App-Code', detail: 'Main', status: status[5] ?? 'pending' },
];
const all = (s: Status) => stages(s, s, s, s, s, s);

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Drei Bereitstellungsmodelle im Vergleich',
  code: {
    cs: `// 1. Framework-abhängig, Start über den Muxer
//    $ dotnet publish -c Release
//    $ dotnet App.dll

// 2. Framework-abhängig, Start über den App-Starter
//    $ ./App

// 3. Self-contained
//    $ dotnet publish -c Release -r linux-x64 --self-contained
//    $ ./App

// 4. Native AOT (Projektdatei: <PublishAot>true</PublishAot>)
//    $ dotnet publish -c Release -r linux-x64
//    $ ./App`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        stages: all('done'),
        facts: [
          { id: 'f-starter', label: 'Starter', value: 'dotnet aus der Installation' },
          { id: 'f-rt', label: 'hostfxr bis JIT', value: 'aus der .NET-Installation' },
          {
            id: 'f-app',
            label: 'Im App-Ordner',
            value: 'App.dll, App.runtimeconfig.json, App.deps.json',
          },
        ],
      },
      changed: ['starter', 'f-starter', 'f-rt', 'f-app'],
      explanation:
        '**Framework-abhängig**: Dein Ordner enthält nur deinen Code und zwei Konfigurationsdateien. Host-Bibliotheken, Runtime, JIT und Klassenbibliothek kommen aus der .NET-Installation der Maschine und werden von allen Apps geteilt.',
    },
    {
      codeLine: 6,
      state: {
        stages: all('done'),
        facts: [
          { id: 'f-starter', label: 'Starter', value: 'App (App-Starter, im App-Ordner)' },
          { id: 'f-rt', label: 'hostfxr bis JIT', value: 'aus der .NET-Installation' },
          { id: 'f-app', label: 'Im App-Ordner', value: 'App, App.dll und Konfiguration' },
        ],
      },
      changed: ['f-starter', 'f-app'],
      explanation:
        'Der Build legt standardmäßig zusätzlich eine ausführbare Datei mit dem Namen deiner App an, den **App-Starter** (apphost). Er ersetzt nur den Muxer `dotnet`, alles danach kommt weiterhin aus der Installation.',
    },
    {
      codeLine: 10,
      state: {
        stages: all('done'),
        facts: [
          { id: 'f-starter', label: 'Starter', value: 'App (App-Starter)' },
          { id: 'f-rt', label: 'hostfxr bis JIT', value: 'private Kopie im App-Ordner' },
          { id: 'f-app', label: 'Im App-Ordner', value: 'App, App.dll, Runtime und gesamte BCL' },
        ],
      },
      changed: ['f-rt', 'f-app'],
      explanation:
        '**Self-contained**: Dieselben Bausteine, aber als private Kopie im App-Ordner. Die Maschine braucht keine .NET-Installation, dafür ist der Ordner deutlich größer und Sicherheitsupdates der Runtime kommen nur mit einem neuen Build deiner App.',
    },
    {
      codeLine: 10,
      state: {
        stages: all('done'),
        facts: [
          { id: 'f-jit', label: 'JIT bei Self-contained', value: 'vorhanden und aktiv' },
          { id: 'f-il', label: 'App.dll enthält', value: 'IL, wie bei Framework-abhängig' },
        ],
      },
      changed: ['jit', 'f-jit', 'f-il'],
      explanation:
        'Häufige Fehlannahme: „Self-contained heißt vorkompiliert, ohne JIT.“ Nein, eine self-contained App enthält weiterhin IL und einen JIT. Nur der Ort der Dateien ändert sich, nicht das Ausführungsmodell.',
    },
    {
      codeLine: 14,
      state: {
        stages: stages('done', 'skipped', 'skipped', 'done', 'skipped', 'done'),
        facts: [
          { id: 'f-starter', label: 'Starter', value: 'App (eine native Programmdatei)' },
          { id: 'f-rt', label: 'Runtime', value: 'eigene, schlanke Runtime im Programm' },
          { id: 'f-app', label: 'IL zur Laufzeit', value: 'keins, alles vorab übersetzt' },
        ],
      },
      changed: ['fxr', 'policy', 'jit', 'f-starter', 'f-rt', 'f-app'],
      explanation:
        '**Native AOT** ist ein anderes Modell: Der Compiler übersetzt App und benötigte Bibliotheken schon beim Publish in Maschinencode. Es gibt weder Host-Bibliotheken noch JIT, die Programmdatei bringt eine eigene Runtime mit GC mit.',
    },
  ],
});
