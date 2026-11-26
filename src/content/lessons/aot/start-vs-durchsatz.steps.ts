import { defineStepScript, type TimelineState } from '@/components/viz';

// One web API, published four ways. Time units are abstract: the bars only show the order of the
// phases and which configuration reaches each phase earlier. They are NOT measured ratios.
// Bar width is time spent in a phase, not speed of the code.
// TODO(verify): With TieredCompilation disabled, R2R code is still used and never replaced, all
// other methods are jitted with full optimization (tiered-compilation.md, runtime-config docs).
// TODO(verify): Whether Native AOT steady-state throughput is below JIT with Dynamic PGO for a
// typical ASP.NET Core workload (ASP.NET Core Native AOT docs and .NET blog benchmarks).

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'l-jit', label: 'JIT (Standard)', kind: 'main' },
  { id: 'l-r2r', label: 'ReadyToRun', kind: 'main' },
  { id: 'l-tc0', label: 'Tiering aus', kind: 'main' },
  { id: 'l-aot', label: 'Native AOT', kind: 'main' },
];
const D = 40;

const run = (id: string, lane: string, start: number, end: number, label: string): Item => ({
  id,
  lane,
  start,
  end,
  label,
  kind: 'run',
});

const jitStart = run('jit-start', 'l-jit', 0, 4, 'Start');
const jitFirst = run('jit-first', 'l-jit', 4, 9, '1. Anfrage: viel JIT');
const jitWarm = run('jit-warm', 'l-jit', 9, 20, 'Tier 0, instrumentiert');
const jitSteady = run('jit-steady', 'l-jit', 20, D, 'Tier 1 mit PGO');

const r2rStart = run('r2r-start', 'l-r2r', 0, 4, 'Start');
const r2rFirst = run('r2r-first', 'l-r2r', 4, 6, '1. Anfrage');
const r2rWarm = run('r2r-warm', 'l-r2r', 6, 18, 'R2R-Code, heiße Methoden neu');
const r2rSteady = run('r2r-steady', 'l-r2r', 18, D, 'Tier 1 mit PGO');

const tc0Start = run('tc0-start', 'l-tc0', 0, 4, 'Start');
const tc0First = run('tc0-first', 'l-tc0', 4, 12, '1. Anfrage: voll optimieren');
const tc0Steady = run('tc0-steady', 'l-tc0', 12, D, 'optimiert, ohne PGO');

const aotStart = run('aot-start', 'l-aot', 0, 2, 'Start');
const aotFirst = run('aot-first', 'l-aot', 2, 3, '1.');
const aotSteady = run('aot-steady', 'l-aot', 3, D, 'fester Maschinencode, ohne PGO');

const jitAll = [jitStart, jitFirst, jitWarm, jitSteady];
const r2rAll = [r2rStart, r2rFirst, r2rWarm, r2rSteady];
const tc0All = [tc0Start, tc0First, tc0Steady];
const aotAll = [aotStart, aotFirst, aotSteady];

export default defineStepScript({
  view: 'timeline',
  title: 'Vier Varianten derselben App über die Zeit',
  layout: 'stacked',
  code: {
    cs: `// Dieselbe Web-API, viermal veröffentlicht oder gestartet

// 1. JIT mit Tiering und Dynamic PGO (Standard)
dotnet publish -c Release

// 2. ReadyToRun: App-Code vorkompiliert, JIT bleibt
dotnet publish -c Release -r linux-x64 -p:PublishReadyToRun=true

// 3. Tiering aus: jede Methode sofort voll optimiert
DOTNET_TieredCompilation=0 dotnet App.dll

// 4. Native AOT: kein JIT zur Laufzeit
dotnet publish -c Release -r linux-x64 -p:PublishAot=true`,
  },
  steps: [
    {
      codeLine: 4,
      state: { lanes, duration: D, items: [jitStart], now: 4 },
      changed: ['jit-start'],
      explanation:
        'Der **Start** umfasst Host, Runtime-Initialisierung, das Laden der Assemblies und den Weg bis `Main`. Das Framework liegt dabei schon als ReadyToRun-Code vor. Die App selbst ist noch IL und kann noch keine Anfrage beantworten.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: D, items: [jitStart, jitFirst, jitWarm], now: 20 },
      changed: ['jit-first', 'jit-warm'],
      explanation:
        'Die erste Anfrage trifft auf viele Methoden, die noch nie gelaufen sind. Jede muss erst vom JIT übersetzt werden, mit schnellem, wenig optimiertem Tier 0. Danach sammeln heiße Methoden in einer instrumentierten Fassung Profildaten.',
    },
    {
      codeLine: 4,
      state: { lanes, duration: D, items: jitAll, now: D },
      changed: ['jit-steady'],
      explanation:
        'Heiße Methoden werden im Hintergrund mit Tier 1 neu übersetzt, gestützt auf das gesammelte Profil. Ab hier läuft der **Dauerbetrieb**. Die Breite der Balken ist Zeit, nicht Geschwindigkeit: Der letzte Balken ist lang, weil die App lange läuft.',
    },
    {
      codeLine: 7,
      state: { lanes, duration: D, items: [...jitAll, ...r2rAll], now: D },
      changed: ['r2r-start', 'r2r-first', 'r2r-warm', 'r2r-steady'],
      explanation:
        'Mit **ReadyToRun** ist auch der App-Code vorkompiliert. Die erste Anfrage braucht kaum noch JIT. Der R2R-Code ist aber nur Startcode: Heiße Methoden werden trotzdem neu übersetzt, und im Dauerbetrieb landet die App beim gleichen Tier 1 mit PGO.',
    },
    {
      codeLine: 10,
      state: { lanes, duration: D, items: [...jitAll, ...r2rAll, ...tc0All], now: D },
      changed: ['tc0-start', 'tc0-first', 'tc0-steady'],
      explanation:
        'Ohne Tiering übersetzt der JIT jede Methode beim ersten Aufruf sofort **voll optimiert**. Das macht die erste Anfrage langsamer, nicht schneller. Im Dauerbetrieb fehlt das Profil, und vorkompilierter Framework-Code wird nie ersetzt.',
    },
    {
      codeLine: 13,
      state: {
        lanes,
        duration: D,
        items: [...jitAll, ...r2rAll, ...tc0All, ...aotAll],
        now: D,
      },
      changed: ['aot-start', 'aot-first', 'aot-steady'],
      explanation:
        '**Native AOT** startet am schnellsten: kein JIT, kein Laden von IL, viele Laufzeitstrukturen liegen fertig in der Datei. Dafür steht der Maschinencode ab Sekunde null fest. Es gibt keine zweite Übersetzung und kein Dynamic PGO.',
    },
    {
      codeLine: 13,
      state: {
        lanes,
        duration: D,
        items: [...jitAll, ...r2rAll, ...tc0All, ...aotAll],
        now: 36,
      },
      changed: ['jit-steady', 'aot-steady'],
      explanation:
        'Der häufigste Irrtum: „AOT ist immer schneller.“ Im Dauerbetrieb kann der JIT mit Profil und Code für genau diese CPU **gleichziehen oder vorbeiziehen**. Wer nur den Start misst oder nur den Dauerbetrieb, sieht jeweils die halbe Wahrheit.',
    },
  ],
});
