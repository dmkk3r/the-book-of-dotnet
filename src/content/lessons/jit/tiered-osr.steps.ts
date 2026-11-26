import { defineStepScript, type PipelineState } from '@/components/viz';

// Shows OSR conceptually, based on docs/design/features/OnStackReplacement.md.
// TODO(verify): Default patchpoint counter value and OSR hit limit (OSR_HitLimit,
// TC_OnStackReplacement_InitialCounter in clrconfignames.h / jitconfigvalues.h).
// TODO(verify): Since .NET 7, methods with loops start in Tier 0 on x64 and Arm64 (QuickJitForLoops
// and OSR on by default); with Dynamic PGO they start in instrumented Tier 0.
// TODO(verify): A later call of the method starts in Tier 0 again and follows normal call counting.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
const stages = (...status: Status[]): Stage[] => [
  { id: 's-t0', label: 'Tier 0', detail: 'mit Patchpoint', status: status[0]! },
  { id: 's-count', label: 'Aufrufe zählen', detail: 'hilft hier nicht', status: status[1]! },
  { id: 's-pp', label: 'Patchpoint', detail: 'zählt Schleifendurchläufe', status: status[2]! },
  { id: 's-osr', label: 'OSR-Version', detail: 'optimiert übersetzen', status: status[3]! },
  { id: 's-switch', label: 'Übergang', detail: 'mitten in der Schleife', status: status[4]! },
];

type Method = NonNullable<PipelineState['methods']>[number];
const sum = (tier: Method['tier'], note: string): Method => ({
  id: 'm-sum',
  name: 'Sum(int[])',
  tier,
  calls: 1,
  note,
});

export default defineStepScript({
  view: 'pipeline',
  title: 'On-Stack Replacement Schritt für Schritt',
  code: {
    cs: `static long Sum(int[] data)       // genau einmal aufgerufen
{
    long sum = 0;
    for (int i = 0; i < data.Length; i++)
        sum += data[i];           // 100 Millionen Durchläufe
    return sum;
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        stages: stages('active', 'pending', 'pending', 'pending', 'pending'),
        methods: [sum('tier0', 'Schleife beginnt')],
        facts: [
          { id: 'f-calls', label: 'Aufrufe', value: '1' },
          { id: 'f-pp', label: 'Patchpoint', value: 'am Rücksprung der Schleife' },
        ],
      },
      changed: ['s-t0', 'm-sum', 'f-pp'],
      explanation:
        '`Sum` wird einmal aufgerufen und in Tier 0 übersetzt. Weil die Methode eine Schleife enthält, fügt der JIT an der Stelle, an der die Schleife zurückspringt, einen **Patchpoint** ein: eine Stelle, an der später ein Wechsel möglich ist.',
    },
    {
      codeLine: 5,
      state: {
        stages: stages('done', 'active', 'pending', 'pending', 'pending'),
        methods: [sum('tier0', 'steckt in der Schleife')],
        facts: [
          { id: 'f-calls', label: 'Aufrufe', value: '1' },
          { id: 'f-threshold', label: 'Schwelle für Tier 1', value: 'unerreichbar' },
        ],
      },
      changed: ['s-count', 'f-threshold'],
      explanation:
        'Fehlannahme: „Die Aufrufzählung findet jede heiße Methode.“ `Sum` wird nur einmal aufgerufen, die Zählschwelle wird nie erreicht. Und selbst ein fertiger Tier-1-Code würde nur künftigen Aufrufen helfen, nicht dem laufenden.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'active', 'pending', 'pending'),
        methods: [sum('tier0', 'Zähler läuft ab')],
        facts: [
          { id: 'f-calls', label: 'Aufrufe', value: '1' },
          { id: 'f-counter', label: 'Patchpoint-Zähler', value: 'pro Durchlauf eins weniger' },
        ],
      },
      changed: ['s-pp', 'f-counter'],
      explanation:
        'Jeder Durchlauf passiert den Patchpoint und verringert einen Zähler im Stack-Frame. Erreicht er null, ruft der Tier-0-Code einen Helfer der Runtime auf und fragt: „Lohnt sich ein Wechsel?“',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'done', 'active', 'pending'),
        methods: [sum('tier0', 'wartet auf die OSR-Version')],
        facts: [
          { id: 'f-calls', label: 'Aufrufe', value: '1' },
          { id: 'f-osr', label: 'OSR-Version', value: 'optimiert, Einstieg am Patchpoint' },
          { id: 'f-sync', label: 'Übersetzung', value: 'synchron' },
        ],
      },
      changed: ['s-osr', 'f-osr', 'f-sync'],
      explanation:
        'Die Runtime lässt den JIT eine **OSR-Version** von `Sum` übersetzen: optimierter Code, der nicht am Methodenanfang beginnt, sondern genau an diesem Patchpoint. Anders als bei Tier 1 geschieht das synchron, denn genau dieser Thread soll ja davon profitieren.',
    },
    {
      codeLine: 5,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        methods: [sum('osr', 'rechnet mit i und sum weiter')],
        facts: [
          { id: 'f-calls', label: 'Aufrufe', value: '1' },
          { id: 'f-frame', label: 'Tier-0-Frame', value: 'bleibt auf dem Stack' },
        ],
      },
      changed: ['s-switch', 'm-sum', 'f-frame'],
      explanation:
        'Der Thread springt in die OSR-Version und rechnet dort mit den bisherigen Werten von `i` und `sum` weiter. Der alte Tier-0-Frame bleibt dabei auf dem Stack liegen, die OSR-Version übernimmt ihn als Teil ihres eigenen Frames.',
    },
    {
      codeLine: 6,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done'),
        methods: [sum('osr', 'Schleife beendet')],
        facts: [
          { id: 'f-calls', label: 'Aufrufe', value: '1' },
          { id: 'f-rest', label: 'Restliche Durchläufe', value: 'optimiert' },
        ],
      },
      changed: ['f-rest'],
      explanation:
        'Die restlichen Durchläufe laufen optimiert, `Sum` kehrt aus der OSR-Version zurück. OSR ist damit ein Notausgang für genau diesen einen Aufruf, kein Ersatz für Tier 1.',
    },
  ],
});
