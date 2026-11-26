import { defineStepScript, type PipelineState } from '@/components/viz';

// The way from source code to running machine code, one building block per stage.
// Sources: Book of the Runtime "Introduction to the Common Language Runtime" and
// docs/design/features/host-components.md in dotnet/runtime.
// TODO(verify): IL listing for a Release build in SharpLab (exact member references, no .maxstack shown).
// TODO(verify): Version numbers in the facts (8.0.0 requested, 8.0.11 resolved) are examples only.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  { id: 'src', label: 'C#-Quelltext', detail: 'Program.cs', status: status[0] ?? 'pending' },
  { id: 'roslyn', label: 'Roslyn', detail: 'C# zu IL', status: status[1] ?? 'pending' },
  {
    id: 'asm',
    label: 'Assembly',
    detail: 'App.dll: IL und Metadaten',
    status: status[2] ?? 'pending',
  },
  {
    id: 'host',
    label: 'Host',
    detail: 'dotnet, hostfxr, hostpolicy',
    status: status[3] ?? 'pending',
  },
  {
    id: 'vm',
    label: 'CoreCLR',
    detail: 'VM, Typlader, GC',
    status: status[4] ?? 'pending',
  },
  {
    id: 'jit',
    label: 'JIT (RyuJIT)',
    detail: 'IL zu Maschinencode',
    status: status[5] ?? 'pending',
  },
  { id: 'run', label: 'Ausführung', detail: 'nativer Code', status: status[6] ?? 'pending' },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Vom Quelltext zum laufenden Maschinencode',
  code: {
    cs: `using System;

class Program
{
    static void Main()
    {
        Console.WriteLine("Hallo, .NET");
        Console.WriteLine(typeof(object).Assembly.GetName().Name);
    }
}`,
    il: `.method private hidebysig static void Main() cil managed
{
  .entrypoint
  ldstr      "Hallo, .NET"
  call       void [System.Console]System.Console::WriteLine(string)
  ldtoken    [System.Runtime]System.Object
  call       class [System.Runtime]System.Type [System.Runtime]System.Type::GetTypeFromHandle(valuetype [System.Runtime]System.RuntimeTypeHandle)
  callvirt   instance class [System.Runtime]System.Reflection.Assembly [System.Runtime]System.Type::get_Assembly()
  callvirt   instance class [System.Runtime]System.Reflection.AssemblyName [System.Runtime]System.Reflection.Assembly::GetName()
  callvirt   instance string [System.Runtime]System.Reflection.AssemblyName::get_Name()
  call       void [System.Console]System.Console::WriteLine(string)
  ret
}`,
  },
  steps: [
    {
      codeLine: 5,
      state: {
        stages: stages('active'),
        facts: [{ id: 'f-src', label: 'Wer liest den Quelltext?', value: 'nur der Compiler' }],
      },
      changed: ['src', 'f-src'],
      explanation:
        'Ein kleines Programm mit zwei Ausgaben. Der C#-Quelltext ist nur Eingabe für den Compiler: Zur Laufzeit existiert er nicht mehr, die Runtime bekommt ihn nie zu sehen.',
    },
    {
      codeLine: 7,
      highlight: { il: [4, 5] },
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-out', label: 'Ergebnis', value: 'IL und Metadaten, kein Maschinencode' },
          {
            id: 'f-refs',
            label: 'Kompiliert gegen',
            value: 'Referenzassemblies System.Runtime, System.Console',
          },
        ],
      },
      changed: ['roslyn', 'f-out', 'f-refs'],
      explanation:
        'Roslyn, der C#-Compiler, übersetzt `Main` in **IL**, eine prozessorunabhängige Befehlsfolge für eine gedachte Stackmaschine. Aufrufe wie `Console.WriteLine` stehen dort nur als Verweis auf eine Methode in einer anderen Assembly, hier `[System.Console]`.',
    },
    {
      codeLine: 8,
      highlight: { il: [6, 7, 8, 9, 10, 11] },
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'App.dll (PE-Datei)' },
          {
            id: 'f-meta',
            label: 'Metadaten',
            value: 'Typen, Methoden, Verweise auf System.Runtime',
          },
          { id: 'f-native', label: 'Maschinencode für Main', value: 'keiner' },
        ],
      },
      changed: ['asm', 'f-file', 'f-meta', 'f-native'],
      explanation:
        'Die **Assembly** `App.dll` enthält IL und **Metadaten**: Tabellen, die jeden Typ, jede Methode und jeden Verweis beschreiben. Beachte `[System.Runtime]System.Object`: Der Compiler kennt `object` nur als Typ aus der Assembly `System.Runtime`.',
    },
    {
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-cmd', label: 'Start', value: 'dotnet App.dll' },
          { id: 'f-fw', label: 'Framework', value: 'Microsoft.NETCore.App 8.0.11' },
          {
            id: 'f-dir',
            label: 'Ort',
            value: '<dotnet-Wurzel>/shared/Microsoft.NETCore.App/8.0.11/',
          },
        ],
      },
      changed: ['host', 'f-cmd', 'f-fw', 'f-dir'],
      explanation:
        'Eine `.dll` lässt sich nicht direkt starten. Der **Host** liest die Konfiguration der App, wählt eine installierte Version des Shared Frameworks und stellt die Liste aller Assemblies zusammen. Dann lädt er die Runtime-Bibliothek `coreclr` in den Prozess.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-corelib', label: 'Zuerst geladen', value: 'System.Private.CoreLib.dll' },
          { id: 'f-types', label: 'Typlader', value: 'baut MethodTables bei Bedarf' },
          { id: 'f-gc', label: 'GC', value: 'verwaltet den Heap' },
        ],
      },
      changed: ['vm', 'f-corelib', 'f-types', 'f-gc'],
      explanation:
        'Jetzt arbeitet **CoreCLR**, die virtuelle Maschine. Sie lädt als Erstes `System.Private.CoreLib`, wo `object`, `string` und `int` wirklich definiert sind, startet den GC und lädt Typen erst, wenn sie gebraucht werden.',
    },
    {
      codeLine: 5,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-main', label: 'Main', value: 'vor dem ersten Aufruf kompiliert' },
          {
            id: 'f-wl',
            label: 'Console.WriteLine',
            value: 'meist vorkompiliert (ReadyToRun)',
          },
        ],
      },
      changed: ['jit', 'f-main', 'f-wl'],
      explanation:
        'Häufige Fehlannahme: „Die CLR interpretiert IL.“ CoreCLR übersetzt eine Methode **vor ihrem ersten Aufruf** mit dem JIT in Maschinencode und führt dann nur diesen aus. Der Code des Frameworks liegt zum großen Teil schon vorkompiliert vor.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done', 'active'),
        facts: [{ id: 'f-where', label: 'object definiert in', value: 'System.Private.CoreLib' }],
        output: 'Hallo, .NET\nSystem.Private.CoreLib',
      },
      changed: ['run', 'f-where'],
      explanation:
        'Die CPU führt nativen Code aus, die Runtime bleibt im Hintergrund für GC, Typladen und Exceptions zuständig. Die zweite Zeile verrät, dass `object` zur Laufzeit nicht aus `System.Runtime` stammt, sondern aus `System.Private.CoreLib`.',
    },
  ],
});
