import { defineStepScript, type PipelineState } from '@/components/viz';

// Walkthrough without Dynamic PGO (DOTNET_TieredPGO=0), so only Tier 0 and Tier 1 appear.
// TODO(verify): Call count threshold 30 and call counting delay 100 ms (tiered-compilation.md and
// the .NET 8 performance blog name these values; check clrconfignames.h for the current defaults).
// TODO(verify): That the 100 ms timer is reset by every new Tier 0 compilation (tiered-compilation.md
// says so; check whether the current implementation still behaves like this).

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
const stages = (...status: Status[]): Stage[] => [
  { id: 's-il', label: 'IL', detail: 'aus der Assembly', status: status[0]! },
  { id: 's-t0', label: 'Tier 0', detail: 'schnell kompilieren', status: status[1]! },
  { id: 's-delay', label: 'Startverzögerung', detail: 'warten auf Ruhe', status: status[2]! },
  { id: 's-count', label: 'Aufrufe zählen', detail: 'bis zur Schwelle', status: status[3]! },
  { id: 's-t1', label: 'Tier 1', detail: 'optimieren, im Hintergrund', status: status[4]! },
  {
    id: 's-patch',
    label: 'Einstieg umstellen',
    detail: 'neue Aufrufe nach Tier 1',
    status: status[5]!,
  },
];

type Method = NonNullable<PipelineState['methods']>[number];
const load = (note: string): Method => ({
  id: 'm-load',
  name: 'LoadConfig()',
  tier: 'tier0',
  calls: 1,
  note,
});
const square = (tier: Method['tier'], calls?: number, note?: string): Method => ({
  id: 'm-square',
  name: 'Square(int)',
  tier,
  ...(calls !== undefined ? { calls } : {}),
  ...(note !== undefined ? { note } : {}),
});

export default defineStepScript({
  view: 'pipeline',
  title: 'Tiered Compilation Schritt für Schritt',
  code: {
    cs: `var app = WebApplication.Create(args);
var config = LoadConfig();          // läuft genau einmal

app.MapGet("/square/{x}", (int x) => Square(x));
app.Run();                          // läuft Stunden oder Tage

static string LoadConfig() => File.ReadAllText("config.json");
static int Square(int x) => x * x;`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        stages: stages('done', 'active', 'pending', 'pending', 'pending', 'pending'),
        methods: [load('einmal aufgerufen')],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'kaum' },
          { id: 'f-phase', label: 'Phase', value: 'Start' },
        ],
      },
      changed: ['s-t0', 'm-load'],
      explanation:
        'Beim Start übersetzt der JIT jede Methode beim ersten Aufruf, hier `LoadConfig`. Er wählt **Tier 0**: wenig Optimierung, dafür schnell fertig. Beim Start laufen Hunderte solcher Methoden genau einmal, gründliche Optimierung wäre dort verschwendete Zeit.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'active', 'pending', 'pending', 'pending'),
        methods: [load('einmal aufgerufen'), square('tier0', undefined, 'wird noch nicht gezählt')],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'kaum' },
          { id: 'f-phase', label: 'Phase', value: 'Start' },
          { id: 'f-delay', label: 'Zeitgeber', value: 'neu gestartet' },
        ],
      },
      changed: ['s-delay', 'm-square', 'f-delay'],
      explanation:
        'Die ersten Anfragen kommen, `Square` wird ebenfalls in Tier 0 übersetzt. Noch zählt niemand Aufrufe: Solange neue Tier-0-Übersetzungen passieren, gilt die Anwendung als „im Start“, und jede neue Übersetzung startet einen kurzen Zeitgeber neu.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'done', 'active', 'pending', 'pending'),
        methods: [load('nie wieder aufgerufen'), square('tier0', 12, 'wird gezählt')],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'kaum' },
          { id: 'f-phase', label: 'Phase', value: 'Dauerbetrieb' },
          { id: 'f-count', label: 'Schwelle', value: '30 Aufrufe' },
        ],
      },
      changed: ['s-count', 'm-square', 'f-phase', 'f-count'],
      explanation:
        'Ist der Zeitgeber einmal ohne neue Tier-0-Übersetzung abgelaufen, beginnt die Zählung. `LoadConfig` wird nie wieder aufgerufen und bleibt für immer in Tier 0. Das ist gewollt: Für Code, der einmal läuft, lohnt sich keine zweite Übersetzung.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'done', 'active', 'pending', 'pending'),
        methods: [load('nie wieder aufgerufen'), square('tier0', 30, 'Schwelle erreicht')],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'kaum' },
          { id: 'f-phase', label: 'Phase', value: 'Dauerbetrieb' },
          { id: 'f-count', label: 'Schwelle', value: '30 Aufrufe' },
        ],
      },
      changed: ['m-square'],
      explanation:
        '`Square` erreicht die Schwelle und gilt damit als „heiß“. Die Runtime stellt die Methode in eine Warteschlange für die Neuübersetzung. Der Aufruf, der die Schwelle überschreitet, läuft trotzdem sofort weiter.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active', 'pending'),
        methods: [
          load('nie wieder aufgerufen'),
          square('tier0', undefined, 'Anfragen laufen weiter in Tier 0'),
        ],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'voll (entsteht gerade)' },
          { id: 'f-thread', label: 'JIT-Thread', value: 'Hintergrund' },
        ],
      },
      changed: ['s-t1', 'f-thread', 'm-square'],
      explanation:
        'Ein **Hintergrund-Thread** übersetzt `Square` neu, diesmal mit allen Optimierungen. Häufige Fehlannahme: Die Anfragen warteten darauf. Sie rufen in der Zwischenzeit einfach weiter den Tier-0-Code auf.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'active'),
        methods: [
          load('nie wieder aufgerufen'),
          square('tier1', undefined, 'neue Aufrufe nutzen Tier 1'),
        ],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'voll' },
          { id: 'f-old', label: 'Tier-0-Code', value: 'bleibt für laufende Aufrufe' },
        ],
      },
      changed: ['s-patch', 'm-square', 'f-old'],
      explanation:
        'Sobald der Tier-1-Code fertig ist, stellt die Runtime den Einstiegspunkt von `Square` um. Jeder neue Aufruf landet im optimierten Code. Ein Aufruf, der gerade mitten im Tier-0-Code steckt, läuft dort zu Ende.',
    },
    {
      codeLine: 5,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done', 'done'),
        methods: [load('bleibt Tier 0'), square('tier1', undefined, 'wird nicht mehr gezählt')],
        facts: [
          { id: 'f-opt', label: 'Optimierung', value: 'voll' },
          { id: 'f-inline', label: 'Inlining', value: 'in neu übersetzten Aufrufern möglich' },
        ],
      },
      changed: ['f-inline'],
      explanation:
        'Dauerbetrieb: Der Start war schnell, die heißen Methoden laufen optimiert. Wird ein Aufrufer wie das Lambda selbst in Tier 1 übersetzt, kann der JIT `Square` dort sogar inlinen. Ein Programm, das nach wenigen Millisekunden endet, käme nie bis hierher.',
    },
  ],
});
