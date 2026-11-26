import { defineStepScript, type PipelineState } from '@/components/viz';

// Life of ReadyToRun methods under tiered compilation with Dynamic PGO (default since .NET 8).
// Sources: tiered-compilation.md (R2R code is the initial tier), DynamicPgo-InstrumentedTiers.md,
// Microsoft Learn "ReadyToRun deployment overview" (section "Interaction with tiered compilation").
// TODO(verify): Hot R2R methods go R2R -> Tier 1 instrumented -> Tier 1 in .NET 8+ (same claim as
// in jit/pgo.mdx), and the call count threshold 30 applies to R2R code like to Tier 0 code.
// TODO(verify): With TieredCompilation disabled, R2R code is kept for the lifetime of the process and
// methods without R2R code are jitted fully optimized right away.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
const stages = (...status: Status[]): Stage[] => [
  { id: 's-r2r', label: 'R2R-Code', detail: 'aus dem Image', status: status[0]! },
  { id: 's-count', label: 'Aufrufe zählen', detail: 'nach der Startphase', status: status[1]! },
  {
    id: 's-instr',
    label: 'Tier 1 instrumentiert',
    detail: 'optimiert und messend',
    status: status[2]!,
  },
  { id: 's-t1', label: 'Tier 1', detail: 'mit Profil', status: status[3]! },
];

type Method = NonNullable<PipelineState['methods']>[number];
const m = (
  id: string,
  name: string,
  tier: Method['tier'],
  note: string,
  calls?: number,
): Method => ({
  id,
  name,
  tier,
  note,
  ...(calls !== undefined ? { calls } : {}),
});
const main = m('m-main', 'Main', 'r2r', 'läuft einmal');
const config = m('m-config', 'LoadConfig', 'r2r', 'läuft einmal');

export default defineStepScript({
  view: 'pipeline',
  title: 'ReadyToRun-Methoden im Lebenslauf eines Prozesses',
  code: {
    cs: `// App.dll mit PublishReadyToRun=true veröffentlicht
var config = LoadConfig();                    // einmal beim Start
var prices = new List<Price>();               // List<Price>.Add: kein R2R-Code
for (int i = 0; i < 1_000_000; i++)
{
    prices.Add(new Price(i));
    if (i % 1000 == 0) Report(Billing.Sum(prices));  // wird heiß
}

// DOTNET_TieredCompilation=0: R2R-Code bleibt für immer`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        stages: stages('active', 'pending', 'pending', 'pending'),
        methods: [main, config],
        facts: [
          { id: 'f-phase', label: 'Phase', value: 'Start' },
          { id: 'f-jit', label: 'JIT-Übersetzungen', value: '0' },
        ],
      },
      changed: ['s-r2r', 'm-main', 'm-config'],
      explanation:
        'Beim Start laufen `Main` und `LoadConfig` direkt aus dem Image. Für Tiered Compilation ist R2R-Code die **Startstufe**, er spielt dieselbe Rolle wie Tier 0. Der JIT hat bisher nichts übersetzt.',
    },
    {
      codeLine: 6,
      state: {
        stages: stages('active', 'pending', 'pending', 'pending'),
        methods: [
          main,
          config,
          m('m-add', 'List<Price>.Add', 'tier0', 'kein R2R-Code, gejittet'),
          m('m-sum', 'Billing.Sum', 'r2r', 'aus dem Image'),
        ],
        facts: [
          { id: 'f-phase', label: 'Phase', value: 'Start' },
          { id: 'f-jit', label: 'JIT-Übersetzungen', value: '1' },
        ],
      },
      changed: ['m-add', 'm-sum', 'f-jit'],
      explanation:
        'Im Prozess mischen sich zwei Herkünfte: `Billing.Sum` kommt vorkompiliert, `List<Price>.Add` musste der JIT in Tier 0 übersetzen. Beide Methoden behandelt die Runtime ab jetzt gleich: Sie sind Kandidaten für eine bessere Fassung.',
    },
    {
      codeLine: 7,
      state: {
        stages: stages('done', 'active', 'pending', 'pending'),
        methods: [
          m('m-main', 'Main', 'r2r', 'nie wieder aufgerufen'),
          m('m-config', 'LoadConfig', 'r2r', 'nie wieder aufgerufen'),
          m('m-add', 'List<Price>.Add', 'tier0', 'wird gezählt', 30),
          m('m-sum', 'Billing.Sum', 'r2r', 'wird gezählt', 30),
        ],
        facts: [
          { id: 'f-phase', label: 'Phase', value: 'Dauerbetrieb' },
          { id: 'f-count', label: 'Schwelle', value: '30 Aufrufe' },
        ],
      },
      changed: ['s-count', 'm-add', 'm-sum', 'f-phase', 'f-count'],
      explanation:
        'Nach der Startphase zählt die Runtime Aufrufe, auch die von R2R-Methoden. `Sum` und `Add` erreichen die Schwelle. `Main` und `LoadConfig` bleiben für immer R2R-Code, und das ist richtig so: Für einmal laufenden Code lohnt keine zweite Übersetzung.',
    },
    {
      codeLine: 7,
      state: {
        stages: stages('done', 'done', 'active', 'pending'),
        methods: [
          m('m-main', 'Main', 'r2r', 'nie wieder aufgerufen'),
          m('m-config', 'LoadConfig', 'r2r', 'nie wieder aufgerufen'),
          m('m-add', 'List<Price>.Add', 'tier0-instr', 'misst in Tier 0'),
          m('m-sum', 'Billing.Sum', 'tier1', 'optimiert und instrumentiert'),
        ],
        facts: [
          { id: 'f-phase', label: 'Phase', value: 'Dauerbetrieb' },
          { id: 'f-why', label: 'Warum nicht Tier 0?', value: 'wäre langsamer als R2R' },
        ],
      },
      changed: ['s-instr', 'm-add', 'm-sum', 'f-why'],
      explanation:
        'R2R-Code enthält keine Messpunkte für Dynamic PGO. Eine instrumentierte Tier-0-Fassung wäre aber langsamer als der optimierte R2R-Code. Deshalb übersetzt der JIT eine heiße R2R-Methode zuerst **optimiert und instrumentiert**, die gejittete `Add` misst dagegen in Tier 0.',
    },
    {
      codeLine: 7,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        methods: [
          m('m-main', 'Main', 'r2r', 'nie wieder aufgerufen'),
          m('m-config', 'LoadConfig', 'r2r', 'nie wieder aufgerufen'),
          m('m-add', 'List<Price>.Add', 'tier1', 'mit Profil'),
          m('m-sum', 'Billing.Sum', 'tier1', 'mit Profil, ohne Bubble-Grenzen'),
        ],
        facts: [
          { id: 'f-phase', label: 'Phase', value: 'Dauerbetrieb' },
          { id: 'f-inline', label: 'Inlining über Assemblies', value: 'jetzt erlaubt' },
        ],
      },
      changed: ['s-t1', 'm-add', 'm-sum', 'f-inline'],
      explanation:
        'Die endgültige Tier-1-Fassung entsteht im laufenden Prozess. Der JIT kennt hier die exakten Versionen aller geladenen Assemblies und die CPU, er darf über Assembly-Grenzen einbetten und Profildaten nutzen. Ab jetzt ist `Sum` so schnell, als hätte es ReadyToRun nie gegeben.',
    },
    {
      codeLine: 10,
      state: {
        stages: stages('active', 'skipped', 'skipped', 'skipped'),
        methods: [
          main,
          config,
          m('m-add', 'List<Price>.Add', 'tier1', 'sofort voll optimiert gejittet'),
          m('m-sum', 'Billing.Sum', 'r2r', 'bleibt R2R-Code'),
        ],
        facts: [
          { id: 'f-tc', label: 'Tiered Compilation', value: 'aus' },
          { id: 'f-risk', label: 'Folge', value: 'heißer Code bleibt R2R' },
        ],
      },
      changed: ['s-r2r', 'm-add', 'm-sum', 'f-tc', 'f-risk'],
      explanation:
        'Häufige Fehlannahme: „ReadyToRun-Code ist genauso schnell wie Tier 1.“ Ohne Tiered Compilation sieht man, dass das nicht stimmt: `Sum` bleibt dann für immer bei der vorsichtigeren R2R-Fassung. Wer Tiering abschaltet, tauscht beim Durchsatz oft mehr ein, als er beim Start gewinnt.',
    },
  ],
});
