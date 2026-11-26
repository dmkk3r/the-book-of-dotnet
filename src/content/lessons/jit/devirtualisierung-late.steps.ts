import { defineStepScript, type PipelineState } from '@/components/viz';

// Late devirtualization: the exact type only becomes visible after the factory method has been
// inlined. In RyuJIT this happens during the inlining phase (fgInline / late devirtualization in
// src/coreclr/jit/fginline.cpp): after an inlinee returns a value of known exact type, calls on
// that value are devirtualized again and may become new inline candidates.
// TODO(verify): That the newly devirtualized call is inlined in the same inlining pass (current
// .NET), and that the Circle object can be stack allocated afterwards (object stack allocation,
// .NET 9/10, see docs/design/coreclr/jit/object-stack-allocation.md).

type Stage = PipelineState['stages'][number];
type Fact = NonNullable<PipelineState['facts']>[number];

const STAGES: Omit<Stage, 'status'>[] = [
  { id: 'import', label: 'Import', detail: 'IL lesen, Aufrufe markieren' },
  { id: 'inl-create', label: 'Create einbetten', detail: 'Rumpf von Create an die Aufrufstelle' },
  { id: 'late', label: 'Späte Devirtualisierung', detail: 's ist jetzt exakt Circle' },
  { id: 'inl-area', label: 'Circle.Area einbetten', detail: 'neuer Kandidat' },
  { id: 'opt', label: 'Weitere Optimierungen', detail: 'Konstanten, Register, Objekt' },
];

function stages(active: string): Stage[] {
  const index = STAGES.findIndex((s) => s.id === active);
  return STAGES.map((s, i) => ({
    ...s,
    status: i < index ? 'done' : i === index ? 'active' : 'pending',
  }));
}

const state = (active: string, facts: Fact[]): PipelineState => ({
  stages: stages(active),
  methods: [{ id: 'm-area', name: 'AreaOf(double)', tier: 'tier1', note: 'wird gerade übersetzt' }],
  facts,
});

export default defineStepScript({
  view: 'pipeline',
  title: 'Späte Devirtualisierung nach dem Inlining',
  code: {
    cs: `interface IShape { double Area(); }
sealed class Circle(double r) : IShape
{
    public double Area() => Math.PI * r * r;
}

static IShape Create(double r) => new Circle(r);

static double AreaOf(double r)
{
    IShape s = Create(r);       // Rückgabetyp ist nur IShape
    return s.Area();            // Interface-Aufruf
}`,
  },
  steps: [
    {
      codeLine: 12,
      state: state('import', [
        { id: 'f-type', label: 'Typ von s', value: 'IShape (aus der Signatur von Create)' },
        { id: 'f-call', label: 's.Area()', value: 'Interface-Aufruf, Ziel unbekannt' },
      ]),
      changed: ['import', 'f-type', 'f-call'],
      explanation:
        'Beim Einlesen des IL kennt der JIT von `Create` nur die Signatur: Sie liefert ein `IShape`. Mehr weiß er über `s` nicht, also bleibt `s.Area()` vorerst ein Interface-Aufruf.',
    },
    {
      codeLine: 11,
      state: state('inl-create', [
        { id: 'f-type', label: 'Typ von s', value: 'Ergebnis von new Circle(r)' },
        { id: 'f-call', label: 's.Area()', value: 'noch Interface-Aufruf' },
      ]),
      changed: ['inl-create', 'f-type'],
      explanation:
        '`Create` ist winzig und wird eingebettet. Jetzt steht an der Stelle des Aufrufs `new Circle(r)`. Damit hat der JIT eine neue Information: `s` zeigt auf ein Objekt, das hier gerade als `Circle` erzeugt wurde.',
    },
    {
      codeLine: 12,
      state: state('late', [
        { id: 'f-type', label: 'Typ von s', value: 'exakt Circle' },
        { id: 'f-call', label: 's.Area()', value: 'direkter Aufruf von Circle.Area' },
      ]),
      changed: ['late', 'f-type', 'f-call'],
      explanation:
        'Der JIT schaut sich den Interface-Aufruf ein zweites Mal an, diesmal mit dem exakten Typ. Das heißt **späte Devirtualisierung**: Aus dem Interface-Aufruf wird ein direkter Aufruf von `Circle.Area`.',
    },
    {
      codeLine: 4,
      state: state('inl-area', [
        { id: 'f-type', label: 'Typ von s', value: 'exakt Circle' },
        { id: 'f-call', label: 's.Area()', value: 'eingebettet: Math.PI * r * r' },
      ]),
      changed: ['inl-area', 'f-call'],
      explanation:
        'Ein direkter Aufruf ist ein neuer Kandidat für den Inliner. `Circle.Area` ist klein und wird eingebettet. Von zwei Aufrufen, einer davon über ein Interface, ist keiner übrig.',
    },
    {
      codeLine: 10,
      state: state('opt', [
        { id: 'f-type', label: 'Typ von s', value: 'exakt Circle' },
        { id: 'f-call', label: 's.Area()', value: 'eingebettet: Math.PI * r * r' },
        { id: 'f-obj', label: 'Circle-Objekt', value: 'verlässt die Methode nicht' },
      ]),
      changed: ['opt', 'f-obj'],
      explanation:
        'Jetzt sieht der JIT, dass das `Circle`-Objekt nur gebaut wird, um `r` wieder auszulesen. Neuere Versionen können es deshalb auf dem Stack anlegen oder ganz auflösen. Jede Optimierung macht hier die nächste erst möglich.',
    },
  ],
});
