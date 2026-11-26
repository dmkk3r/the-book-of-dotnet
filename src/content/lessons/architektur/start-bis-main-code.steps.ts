import { defineStepScript, type PipelineState } from '@/components/viz';

// Which code version runs during startup, depending on configuration.
// Sources: Microsoft Learn "Runtime configuration options for compilation" (TieredCompilation,
// ReadyToRun, QuickJit), "ReadyToRun compilation", "Native AOT deployment",
// Book of the Runtime "ReadyToRun Overview".
// TODO(verify): That with DOTNET_TieredCompilation=0 R2R code is still used and never replaced,
// and methods without R2R code are compiled fully optimized right away.
// TODO(verify): That hot R2R methods are re-jitted at Tier1 by tiered compilation.
// TODO(verify): That DOTNET_ReadyToRun=0 makes the runtime ignore R2R code in all assemblies,
// including System.Private.CoreLib.
// TODO(verify): Call counting threshold (30 calls by default) before a method is promoted.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
type Method = NonNullable<PipelineState['methods']>[number];

const stages = (...status: Status[]): Stage[] => [
  { id: 'std', label: 'Standard', detail: 'R2R und Tiering', status: status[0] ?? 'pending' },
  { id: 'nor2r', label: 'ohne R2R', detail: 'DOTNET_ReadyToRun=0', status: status[1] ?? 'pending' },
  {
    id: 'notc',
    label: 'ohne Tiering',
    detail: 'DOTNET_TieredCompilation=0',
    status: status[2] ?? 'pending',
  },
  {
    id: 'apprtr',
    label: 'App als R2R',
    detail: 'PublishReadyToRun',
    status: status[3] ?? 'pending',
  },
  { id: 'aot', label: 'Native AOT', detail: 'PublishAot', status: status[4] ?? 'pending' },
];

const methods = (
  main: Method['tier'],
  calc: Method['tier'],
  wl: Method['tier'],
  calcCalls?: number,
): Method[] => [
  { id: 'm-main', name: 'Program.Main', tier: main },
  {
    id: 'm-calc',
    name: 'Program.Berechne',
    tier: calc,
    ...(calcCalls !== undefined ? { calls: calcCalls } : {}),
  },
  { id: 'm-wl', name: 'Console.WriteLine', tier: wl, note: 'Framework' },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Welcher Code beim Start läuft',
  code: {
    cs: `static void Main()
{
    long summe = 0;
    for (int i = 0; i < 1_000; i++)
        summe += Berechne(i);
    Console.WriteLine(summe);
}

static long Berechne(int i) => (long)i * i;`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        stages: stages('active'),
        methods: methods('tier0', 'tier0', 'r2r', 1),
        facts: [
          {
            id: 'f-jit',
            label: 'Vom JIT übersetzt',
            value: 'nur Methoden der App, schnell (Tier0)',
          },
        ],
      },
      changed: ['std', 'm-main', 'm-calc', 'm-wl'],
      explanation:
        'Im Standardfall liegt das Framework als **ReadyToRun** vor, also mit vorkompiliertem Maschinencode. Der JIT übersetzt nur die Methoden deiner App, und zwar beim ersten Aufruf mit Tier0: schnell übersetzt, wenig optimiert.',
    },
    {
      codeLine: 5,
      state: {
        stages: stages('active'),
        methods: methods('tier0', 'tier1', 'r2r', 1000),
        facts: [{ id: 'f-bg', label: 'Im Hintergrund', value: 'Berechne neu übersetzt (Tier1)' }],
      },
      changed: ['m-calc', 'f-bg'],
      explanation:
        'Wird eine Methode oft aufgerufen, übersetzt die Runtime sie im Hintergrund neu mit voller Optimierung (Tier1). Das gilt auch für heiße R2R-Methoden. Der Start bleibt schnell, die Spitzenleistung kommt später.',
    },
    {
      codeLine: 6,
      state: {
        stages: stages('done', 'active'),
        methods: methods('tier0', 'tier0', 'tier0', 1),
        facts: [
          {
            id: 'f-jit',
            label: 'Vom JIT übersetzt',
            value: 'auch jede benutzte Framework-Methode',
          },
        ],
      },
      changed: ['nor2r', 'm-wl', 'f-jit'],
      explanation:
        'Mit `DOTNET_ReadyToRun=0` ignoriert die Runtime den vorkompilierten Code. Jetzt muss der JIT auch `Console.WriteLine` und alles darunter übersetzen. Der Start dauert spürbar länger, ein gutes Experiment, um den Wert von R2R zu sehen.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'done', 'active'),
        methods: methods('tier1', 'tier1', 'r2r', 1),
        facts: [
          { id: 'f-jit', label: 'Vom JIT übersetzt', value: 'App-Methoden sofort voll optimiert' },
        ],
      },
      changed: ['notc', 'm-main', 'm-calc', 'm-wl', 'f-jit'],
      explanation:
        'Ohne Tiered Compilation wird jede Methode beim ersten Aufruf voll optimiert. Das kostet beim Start mehr JIT-Zeit, dafür gibt es kein späteres Neuübersetzen.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        methods: methods('r2r', 'r2r', 'r2r', 1),
        facts: [{ id: 'f-jit', label: 'Vom JIT übersetzt', value: 'fast nichts beim Start' }],
      },
      changed: ['apprtr', 'm-main', 'm-calc', 'm-wl', 'f-jit'],
      explanation:
        'Mit `PublishReadyToRun` bekommt auch deine App vorkompilierten Code. Der JIT bleibt trotzdem an Bord, für heiße Methoden, Generics über fremde Typen und alles, was R2R nicht abdeckt.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        methods: methods('aot', 'aot', 'aot'),
        facts: [
          { id: 'f-jit', label: 'Vom JIT übersetzt', value: 'nichts, es gibt keinen JIT' },
          {
            id: 'f-mis',
            label: 'Fehlannahme',
            value: 'der JIT übersetzt beim Start die ganze App',
          },
        ],
      },
      changed: ['aot', 'm-main', 'm-calc', 'm-wl', 'f-jit', 'f-mis'],
      explanation:
        'Native AOT übersetzt alles beim Veröffentlichen, es gibt weder Host-Kette noch JIT. Häufige Fehlannahme: „Beim Start übersetzt der JIT die ganze App.“ In keiner Variante passiert das, übersetzt wird immer nur, was tatsächlich aufgerufen wird.',
    },
  ],
});
