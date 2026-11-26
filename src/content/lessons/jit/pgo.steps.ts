import { defineStepScript, type PipelineState } from '@/components/viz';

// Life of one method with Dynamic PGO (default since .NET 8). AreaOf has no loop, so it starts
// in plain Tier 0 (methods with loops start instrumented, see tiered.mdx).
// Counts in the facts are illustrative, not measured.
// TODO(verify): Tier sequence Tier0 -> Tier0 instrumented -> Tier1 for methods without loops and
// whether the second call counting phase uses the same threshold (30) as the first one
// (DynamicPgo-InstrumentedTiers.md, Performance Improvements in .NET 8).
// TODO(verify): That the instrumented version is also compiled on the tiering background thread.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
const stages = (...status: Status[]): Stage[] => [
  { id: 's-t0', label: 'Tier 0', detail: 'schnell, ohne Zähler', status: status[0]! },
  { id: 's-count', label: 'Aufrufe zählen', detail: 'bis zur Schwelle', status: status[1]! },
  {
    id: 's-instr',
    label: 'Tier 0 instrumentiert',
    detail: 'sammelt das Profil',
    status: status[2]!,
  },
  { id: 's-count2', label: 'Weiter zählen', detail: 'Profil wächst', status: status[3]! },
  { id: 's-t1', label: 'Tier 1 mit Profil', detail: 'optimiert, Profil fest', status: status[4]! },
];

type Method = NonNullable<PipelineState['methods']>[number];
const areaOf = (tier: Method['tier'], note: string, calls?: number): Method => ({
  id: 'm-area',
  name: 'AreaOf(IShape)',
  tier,
  note,
  ...(calls !== undefined ? { calls } : {}),
});

export default defineStepScript({
  view: 'pipeline',
  title: 'Eine Methode auf dem Weg zum Profil',
  code: {
    cs: `interface IShape { double Area(); }
sealed class Circle(double r) : IShape { public double Area() => Math.PI * r * r; }
sealed class Square(double a) : IShape { public double Area() => a * a; }

// wird bei jeder Anfrage aufgerufen
static double AreaOf(IShape? s)
{
    if (s is null) return 0;   // Zweig: fast nie genommen
    return s.Area();           // Aufrufstelle: welcher Typ kommt an?
}`,
  },
  steps: [
    {
      codeLine: 6,
      state: {
        stages: stages('active', 'pending', 'pending', 'pending', 'pending'),
        methods: [areaOf('tier0', 'erster Aufruf', 1)],
        facts: [
          { id: 'f-profile', label: 'Profil', value: 'keins' },
          { id: 'f-call', label: 's.Area()', value: 'virtueller Interface-Aufruf' },
        ],
      },
      changed: ['s-t0', 'm-area'],
      explanation:
        'Beim ersten Aufruf übersetzt der JIT `AreaOf` wie gewohnt in **Tier 0**. Dieser Code enthält noch keine Zähler. Die meisten Methoden eines Programms laufen nur ein paarmal, für sie wäre jedes Messen verschwendet.',
    },
    {
      codeLine: 6,
      state: {
        stages: stages('done', 'active', 'pending', 'pending', 'pending'),
        methods: [areaOf('tier0', 'Schwelle erreicht', 30)],
        facts: [
          { id: 'f-profile', label: 'Profil', value: 'keins' },
          { id: 'f-hot', label: 'Einstufung', value: 'heiß' },
        ],
      },
      changed: ['s-count', 'm-area', 'f-hot'],
      explanation:
        'Nach der Startphase zählt die Runtime Aufrufe, genau wie in der Lektion „Tiered Compilation und OSR“. Erreicht `AreaOf` die Schwelle, gilt die Methode als heiß. Ohne PGO käme jetzt direkt Tier 1.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'active', 'pending', 'pending'),
        methods: [areaOf('tier0-instr', 'misst bei jedem Aufruf mit')],
        facts: [
          { id: 'f-profile', label: 'Profil', value: 'wird gesammelt' },
          { id: 'f-probes', label: 'Probes', value: 'Blockzähler, Klassenprobe an s.Area()' },
        ],
      },
      changed: ['s-instr', 'm-area', 'f-profile', 'f-probes'],
      explanation:
        'Mit Dynamic PGO entsteht stattdessen eine **instrumentierte** Fassung. Sie ist weiterhin unoptimiert, enthält aber Zähler für Zweige und eine **Klassenprobe** an `s.Area()`, die sich merkt, welcher konkrete Typ dort ankommt.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'active', 'pending'),
        methods: [areaOf('tier0-instr', 'Schwelle erneut erreicht', 30)],
        facts: [
          { id: 'f-profile', label: 'Profil', value: 'aus genau diesem Prozess' },
          { id: 'f-null', label: 's is null', value: 'fast nie' },
          {
            id: 'f-types',
            label: 'Typen an s.Area()',
            value: 'Circle etwa 90 %, Square etwa 10 %',
          },
        ],
      },
      changed: ['s-count2', 'f-null', 'f-types', 'f-profile'],
      explanation:
        'Die Daten stammen aus dem laufenden Prozess, mit echter Last und echten Eingaben. Häufige Fehlannahme: PGO brauche einen Trainingslauf vor dem Deployment. Das gilt für **statisches** PGO, Dynamic PGO misst im Betrieb selbst.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        methods: [areaOf('tier1', 'optimiert mit Profil')],
        facts: [
          { id: 'f-gdv', label: 's.Area()', value: 'Typprüfung auf Circle, Circle.Area inline' },
          { id: 'f-cold', label: 's is null', value: 'kalter Block, ans Ende der Methode' },
          { id: 'f-thread', label: 'JIT-Thread', value: 'Hintergrund' },
        ],
      },
      changed: ['s-t1', 'm-area', 'f-gdv', 'f-cold'],
      explanation:
        'Erreicht auch die instrumentierte Fassung die Schwelle, übersetzt der JIT `AreaOf` in **Tier 1** und liest dabei das Profil. Er setzt eine Typprüfung auf `Circle` vor den Aufruf und legt den seltenen `null`-Zweig aus dem heißen Pfad heraus.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done'),
        methods: [
          areaOf('tier1', 'keine Probes mehr'),
          {
            id: 'm-r2r',
            name: 'Framework-Methode',
            tier: 'r2r',
            note: 'eigener Weg: R2R, Tier 1 instrumentiert, Tier 1',
          },
        ],
        facts: [
          { id: 'f-profile', label: 'Profil', value: 'eingefroren' },
          { id: 'f-change', label: 'Lastwechsel später', value: 'kein neues Profil' },
        ],
      },
      changed: ['m-area', 'm-r2r', 'f-profile', 'f-change'],
      explanation:
        'Der Tier-1-Code enthält keine Zähler mehr, das Profil ist damit eingefroren. Ändert sich das Verhalten später, bleibt der Code korrekt, aber er passt dann schlechter. Vorkompilierte R2R-Methoden nehmen einen eigenen Weg über eine optimierte, instrumentierte Zwischenfassung.',
    },
  ],
});
