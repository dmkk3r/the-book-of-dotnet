import { defineStepScript, type PipelineState } from '@/components/viz';

// What CoreCLR does between coreclr_initialize and the return of Main.
// Sources: dotnet/runtime src/coreclr/vm/ceemain.cpp (EEStartupHelper),
// src/coreclr/vm/corhost.cpp (CorHost2::CreateAppDomainWithManager, CorHost2::ExecuteAssembly),
// src/coreclr/vm/assembly.cpp (Assembly::ExecuteMainMethod, RunMain, RunMainPost),
// docs/design/features/host-startup-hook.md, host-runtime-information.md.
// The order follows the source on the main branch (read 2026-11); details move between versions.
// TODO(verify): Order against the release/8.0 and release/9.0 branches.
// TODO(verify): That Program's static constructor runs after the startup hooks and right
// before Main (class init triggered when Main is prepared in RunMainInternal).
// TODO(verify): That System.Console methods used here come from ReadyToRun code of the framework.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
type Method = NonNullable<PipelineState['methods']>[number];

const stages = (...status: Status[]): Stage[] => [
  { id: 'ee', label: 'EE-Start', detail: 'Threads, GC, Finalizer', status: status[0] ?? 'pending' },
  {
    id: 'corelib',
    label: 'CoreLib',
    detail: 'System.Private.CoreLib',
    status: status[1] ?? 'pending',
  },
  {
    id: 'domain',
    label: 'AppDomain',
    detail: 'AppContext, Binder',
    status: status[2] ?? 'pending',
  },
  {
    id: 'load',
    label: 'App.dll laden',
    detail: 'Standard-Ladekontext',
    status: status[3] ?? 'pending',
  },
  {
    id: 'entry',
    label: 'Einstiegspunkt',
    detail: 'aus dem CLI-Header',
    status: status[4] ?? 'pending',
  },
  {
    id: 'hooks',
    label: 'Startup Hooks',
    detail: 'DOTNET_STARTUP_HOOKS',
    status: status[5] ?? 'pending',
  },
  { id: 'main', label: 'Main', detail: 'JIT, dann Ausführung', status: status[6] ?? 'pending' },
  { id: 'end', label: 'Ende', detail: 'warten, Exitcode', status: status[7] ?? 'pending' },
];

const m = (id: string, name: string, tier: Method['tier'], note?: string): Method => ({
  id,
  name,
  tier,
  ...(note ? { note } : {}),
});

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Von coreclr_initialize bis zum Ende von Main',
  code: {
    cs: `// $ DOTNET_STARTUP_HOOKS=/opt/hooks/Hook.dll dotnet App.dll

// Hook.dll
internal class StartupHook
{
    public static void Initialize() => Console.WriteLine("Hook");
}

// App.dll
static class Program
{
    static Program() => Console.WriteLine("Program..cctor");

    static int Main(string[] args)
    {
        Console.WriteLine("Main");
        return 3;
    }
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        stages: stages('active'),
        facts: [
          { id: 'f-thread', label: 'Thread', value: 'Hauptthread des Prozesses' },
          { id: 'f-gc', label: 'GC', value: 'Heap angelegt, Modus aus den Eigenschaften' },
          { id: 'f-fin', label: 'Finalizer-Thread', value: 'gestartet, wartet' },
        ],
      },
      changed: ['ee', 'f-thread', 'f-gc', 'f-fin'],
      explanation:
        '`hostpolicy` ruft `coreclr_initialize` auf dem Hauptthread auf. Die Runtime startet ihre Ausführungsumgebung: Thread-Verwaltung, Codeverwaltung, den GC samt Heap und den **Finalizer-Thread**. Verwalteter Code läuft noch keiner.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-cl', label: 'Geladen', value: 'System.Private.CoreLib.dll' },
          { id: 'f-from', label: 'Aus', value: 'Framework-Ordner (SYSTEM_CORELIB_DIRECTORY)' },
        ],
      },
      changed: ['corelib', 'f-cl', 'f-from'],
      explanation:
        'Als Erstes kommt `System.Private.CoreLib`. Sie enthält `Object`, `String` und alles, worauf die Runtime selbst angewiesen ist, und wird auf einem Sonderweg geladen, bevor der allgemeine Binder die TPA-Liste kennt.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-ad', label: 'AppDomain', value: 'die eine Standard-Domain' },
          { id: 'f-ctx', label: 'AppContext', value: 'alle Eigenschaften vom Host' },
          { id: 'f-bind', label: 'Binder', value: 'TPA-Liste, Ressourcen- und native Pfade' },
        ],
      },
      changed: ['domain', 'f-ad', 'f-ctx', 'f-bind'],
      explanation:
        'Die Runtime richtet die einzige AppDomain ein, übergibt alle Eigenschaften an den verwalteten `AppContext` und gibt dem Standard-Binder die TPA-Liste. Damit endet `coreclr_initialize`.',
    },
    {
      codeLine: 10,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-call', label: 'Aufruf', value: 'coreclr_execute_assembly' },
          { id: 'f-asm', label: 'Geladen', value: 'App.dll (Metadaten, noch kein Code übersetzt)' },
        ],
      },
      changed: ['load', 'f-call', 'f-asm'],
      explanation:
        '`hostpolicy` ruft `coreclr_execute_assembly` mit dem Pfad zu `App.dll`. Die Runtime lädt die Assembly in den Standard-Ladekontext und übergibt die Kommandozeilenargumente an `Environment`.',
    },
    {
      codeLine: 14,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-tok', label: 'Entry-Point-Token', value: 'MethodDef von Program.Main' },
          {
            id: 'f-sig',
            label: 'Signatur geprüft',
            value: 'statisch, nicht generisch, void, int oder uint',
          },
        ],
      },
      changed: ['entry', 'f-tok', 'f-sig'],
      explanation:
        'Der Einstiegspunkt steht nicht als Name, sondern als Token im CLI-Header der Assembly. Die Runtime lädt den Typ `Program`, findet die Methode und prüft ihre Signatur.',
    },
    {
      codeLine: 6,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'active'),
        methods: [m('m-hook', 'StartupHook.Initialize', 'tier0', 'aus Hook.dll')],
        facts: [{ id: 'f-same', label: 'Thread', value: 'derselbe, der gleich Main ausführt' }],
        output: 'Hook',
      },
      changed: ['hooks', 'm-hook', 'f-same'],
      explanation:
        'Vor `Main` laufen die **Startup Hooks**: Für jeden Eintrag in `DOTNET_STARTUP_HOOKS` wird die Assembly geladen und `StartupHook.Initialize` aufgerufen, nacheinander und synchron auf dem Hauptthread.',
    },
    {
      codeLine: 16,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done', 'active'),
        methods: [
          m('m-hook', 'StartupHook.Initialize', 'tier0', 'fertig'),
          m('m-cctor', 'Program..cctor', 'tier0', 'läuft vor Main'),
          m('m-main', 'Program.Main', 'tier0', 'gerade übersetzt'),
          m('m-wl', 'Console.WriteLine', 'r2r', 'vorkompiliert im Framework'),
        ],
        output: 'Hook\nProgram..cctor\nMain',
      },
      changed: ['main', 'm-cctor', 'm-main', 'm-wl'],
      explanation:
        'Jetzt übersetzt der JIT `Main` schnell und ohne große Optimierung (Tier0). Vorher läuft der statische Konstruktor von `Program`. `Console.WriteLine` dagegen muss nicht übersetzt werden: Der Code liegt als ReadyToRun bereits im Framework.',
    },
    {
      codeLine: 17,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done', 'done', 'active'),
        methods: [m('m-main', 'Program.Main', 'tier0', 'zurückgekehrt mit 3')],
        facts: [
          { id: 'f-wait', label: 'Danach', value: 'warten auf Vordergrund-Threads' },
          { id: 'f-exit', label: 'Exitcode', value: '3' },
        ],
        output: 'Hook\nProgram..cctor\nMain\n(Exitcode 3)',
      },
      changed: ['end', 'f-wait', 'f-exit'],
      explanation:
        'Der Rückgabewert von `Main` wird zum Exitcode. Bevor der Prozess endet, wartet die Runtime noch, bis alle Vordergrund-Threads fertig sind. Dann fährt `hostpolicy` die Runtime herunter.',
    },
    {
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done', 'done', 'done'),
        facts: [
          { id: 'f-mis', label: 'Fehlannahme', value: 'Main ist das Erste, was läuft' },
          {
            id: 'f-real',
            label: 'Tatsächlich vorher',
            value: 'Host, EE-Start, CoreLib, AppContext, Hooks, cctor',
          },
        ],
        output: 'Hook\nProgram..cctor\nMain\n(Exitcode 3)',
      },
      changed: ['f-mis', 'f-real'],
      explanation:
        'Häufige Fehlannahme: „`Main` ist der Anfang meines Programms.“ Bis dahin haben Host, Runtime, CoreLib, fremder Code aus Startup Hooks und dein eigener statischer Konstruktor schon gearbeitet. Wer Startzeit misst, muss diese Phase mitzählen.',
    },
  ],
});
