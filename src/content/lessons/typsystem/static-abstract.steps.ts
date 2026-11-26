import { defineStepScript, type PipelineState } from '@/components/viz';

// TODO(verify): JIT asm for Sum<int> (no interface call, no boxing, add instruction after
// inlining in Tier 1) and for a shared reference-type instantiation (dictionary lookup).

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
const stages = (...s: Status[]): Stage[] => [
  { id: 's-call', label: 'Aufruf', detail: 'Sum<int>(…)', status: s[0]! },
  { id: 's-spec', label: 'Code erzeugen', detail: 'für T = int', status: s[1]! },
  { id: 's-zero', label: 'T.Zero', detail: 'auflösen', status: s[2]! },
  { id: 's-add', label: 'T + T', detail: 'auflösen', status: s[3]! },
];
type Method = NonNullable<PipelineState['methods']>[number];
const sumInt: Method = {
  id: 'm-int',
  name: 'Sum<int>',
  tier: 'tier0',
  note: 'eigener Code für int',
};
const sumDouble: Method = {
  id: 'm-double',
  name: 'Sum<double>',
  tier: 'tier0',
  note: 'eigener Code für double',
};

export default defineStepScript({
  view: 'pipeline',
  title: 'Statische abstrakte Member Schritt für Schritt',
  code: {
    cs: `static T Sum<T>(T[] values) where T : INumber<T>
{
    T total = T.Zero;
    foreach (var v in values) total += v;
    return total;
}

Console.WriteLine(Sum(new[] { 1, 2, 3 }));
Console.WriteLine(Sum(new[] { 1.5, 2.5 }));`,
  },
  steps: [
    {
      codeLine: 8,
      state: {
        stages: stages('active', 'pending', 'pending', 'pending'),
        methods: [sumInt],
        facts: [{ id: 'f-t', label: 'T', value: 'int' }],
      },
      changed: ['s-call', 'm-int'],
      explanation:
        '`Sum` wird mit `int` aufgerufen. `INumber<T>` verlangt statische Member wie `T.Zero` und den Operator `+`. Sie gehören zum Typ, nicht zu einem Objekt.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('done', 'active', 'pending', 'pending'),
        methods: [sumInt],
        facts: [
          { id: 'f-t', label: 'T', value: 'int' },
          { id: 'f-code', label: 'Code', value: 'nur für int' },
        ],
      },
      changed: ['s-spec', 'f-code'],
      explanation:
        '`int` ist ein Werttyp, also erzeugt der JIT **eigenen Code** für `Sum<int>`. In diesem Code steht fest, welches `T` gemeint ist.',
    },
    {
      codeLine: 3,
      state: {
        stages: stages('done', 'done', 'active', 'pending'),
        methods: [sumInt],
        facts: [
          { id: 'f-t', label: 'T', value: 'int' },
          { id: 'f-zero', label: 'T.Zero', value: 'int.Zero, beim Übersetzen bekannt' },
        ],
      },
      changed: ['s-zero', 'f-zero'],
      explanation:
        'Weil `T` feststeht, wird `T.Zero` schon beim Übersetzen zu `int.Zero` aufgelöst. Es gibt keinen virtuellen Aufruf und kein Objekt, auf dem etwas nachgeschlagen werden müsste.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        methods: [sumInt],
        facts: [
          { id: 'f-t', label: 'T', value: 'int' },
          { id: 'f-add', label: 'T + T', value: 'direkter Aufruf, in Tier 1 eine add-Instruktion' },
          { id: 'f-box', label: 'Boxing', value: 'keins' },
        ],
      },
      changed: ['s-add', 'f-add', 'f-box'],
      explanation:
        'Auch `+` wird direkt zu `int`s Operator aufgelöst. Nach dem Inlining bleibt eine einfache Addition. Häufige Fehlannahme: Generischer Mathe-Code sei langsamer als handgeschriebener, weil er über Interfaces läuft.',
    },
    {
      codeLine: 9,
      state: {
        stages: stages('done', 'done', 'done', 'done'),
        methods: [sumInt, sumDouble],
        facts: [
          {
            id: 'f-note',
            label: 'Bei Klassen als T',
            value: 'geteilter Code, Auflösung über das Wörterbuch',
          },
        ],
        output: '6\n4',
      },
      changed: ['m-double', 'f-note'],
      explanation:
        'Für `double` entsteht wieder eigener Code. Wäre `T` eine Klasse, würde der Code geteilt und die statischen Member müssten zur Laufzeit über das generische Wörterbuch gefunden werden.',
    },
  ],
});
