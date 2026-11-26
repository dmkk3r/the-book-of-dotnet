import { defineStepScript, type TableState } from '@/components/viz';

// Calls from ReadyToRun code into another version bubble go through indirection cells that the
// runtime fills lazily on first use (BOTR readytorun-overview.md, "Inter-module call";
// readytorun-format.md, "ImportSections", "DelayLoadMethodCallThunks").
// Geometry.dll stands for any library from a NuGet package, compiled separately.
// The table is a simplification: real images group cells in import sections, and calls within the
// same module can also be direct calls. Cell numbers are invented.
// TODO(verify): That crossgen2 inlines Clamp (same assembly, small) and never inlines
// Geometry.Distance (other assembly, not marked [NonVersionable]) without a larger version bubble.

type Table = TableState['tables'][number];
type Status = NonNullable<Table['rows'][number]['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

interface Look {
  status?: Partial<Record<string, Status>>;
  /** Where each cell points: 'helper' or the id of a resolved method row. */
  cell1?: string;
  cell2?: string;
  distance?: string;
  write?: string;
  /** Composite variant: Distance is inlined, no cell. */
  composite?: boolean;
}

function tables({
  status = {},
  cell1 = 'helper',
  cell2 = 'helper',
  distance = 'noch nicht geladen',
  write = 'noch nicht geladen',
  composite = false,
}: Look): Table[] {
  const st = (id: string) => (status[id] ? { status: status[id] } : {});
  const callRows = composite
    ? [
        { id: 'c-clamp', cells: ['Clamp(v)', 'eingebettet'], ...st('c-clamp') },
        { id: 'c-dist', cells: ['Distance(a, b)', 'eingebettet'], ...st('c-dist') },
        {
          id: 'c-write',
          cells: ['Console.WriteLine', 'call [Zelle 2]'],
          ...st('c-write'),
          refs: [{ col: 1, to: 'cell2' }],
        },
      ]
    : [
        { id: 'c-clamp', cells: ['Clamp(v)', 'eingebettet'], ...st('c-clamp') },
        {
          id: 'c-dist',
          cells: ['Distance(a, b)', 'call [Zelle 1]'],
          ...st('c-dist'),
          refs: [{ col: 1, to: 'cell1' }],
        },
        {
          id: 'c-write',
          cells: ['Console.WriteLine', 'call [Zelle 2]'],
          ...st('c-write'),
          refs: [{ col: 1, to: 'cell2' }],
        },
      ];
  const cellRow = (id: string, nr: string, target: string, points: string) => ({
    id,
    cells: [nr, target, points === 'helper' ? 'Delay-Load-Helfer' : 'Adresse'],
    ...st(id),
    refs: [{ col: 2, to: points }],
  });
  const cells = composite
    ? [cellRow('cell2', '2', 'Console.WriteLine', cell2)]
    : [
        cellRow('cell1', '1', 'Geometry.Distance', cell1),
        cellRow('cell2', '2', 'Console.WriteLine', cell2),
      ];
  return [
    {
      id: 't-code',
      title: composite ? 'App.Report (Composite)' : 'App.Report (R2R-Code)',
      columns: ['Aufruf', 'Maschinencode'],
      row: 1,
      col: 1,
      rows: callRows,
    },
    {
      id: 't-cells',
      title: 'Importzellen in App.dll',
      columns: ['Zelle', 'Signatur', 'Inhalt'],
      row: 1,
      col: 2,
      rows: cells,
    },
    {
      id: 't-rt',
      title: 'Runtime',
      columns: ['Eintrag', 'Aufgabe'],
      row: 2,
      col: 1,
      rows: [{ id: 'helper', cells: ['Delay-Load-Helfer', 'Signatur auflösen'], ...st('helper') }],
    },
    {
      id: 't-targets',
      title: 'Code anderer Assemblies',
      columns: ['Methode', 'Zustand'],
      row: 2,
      col: 2,
      rows: [
        ...(composite
          ? []
          : [{ id: 'm-dist', cells: ['Geometry.Distance', distance], ...st('m-dist') }]),
        { id: 'm-write', cells: ['Console.WriteLine', write], ...st('m-write') },
      ],
    },
  ];
}

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Importzellen und Version Bubble',
  code: {
    cs: `// App.dll (R2R) und Geometry.dll (NuGet-Paket, eigene Assembly)
static void Report(Point a, Point b, int v)
{
    int c = Clamp(v);                         // gleiche Assembly
    double d = Geometry.Distance(a, b);       // andere Assembly
    if (d > c) Console.WriteLine(d);          // Framework
}

static int Clamp(int v) => v < 0 ? 0 : v;

// Report(p, q, 5);  Report(p, q, 7);`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        tables: tables({ status: { 'c-clamp': 'active' } }),
        facts: [
          fact('f-bubble', 'Version Bubble', 'App.dll'),
          fact('f-clamp', 'Clamp', 'eingebettet'),
        ],
      },
      changed: ['c-clamp', 'f-bubble', 'f-clamp'],
      explanation:
        '`Clamp` liegt in derselben Assembly wie `Report`. Beide werden immer zusammen ausgeliefert, sie gehören zur selben **Version Bubble**. crossgen2 darf `Clamp` deshalb einbetten, genau wie der JIT es täte.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({ status: { 'c-dist': 'active', cell1: 'active', helper: 'active' } }),
        facts: [
          fact('f-bubble', 'Version Bubble', 'App.dll'),
          fact('f-dist', 'Distance', 'nicht eingebettet'),
        ],
      },
      changed: ['c-dist', 'cell1', 'helper', 'f-dist'],
      explanation:
        '`Geometry.Distance` gehört zu einer anderen Assembly, die unabhängig aktualisiert werden kann. Ein eingebetteter Rumpf wäre nach einem Update veraltet. Also erzeugt crossgen2 einen indirekten Aufruf über eine Zelle, die anfangs auf einen Helfer der Runtime zeigt.',
    },
    {
      codeLine: 11,
      state: {
        tables: tables({
          status: { cell1: 'active', helper: 'active', 'm-dist': 'match' },
          cell1: 'm-dist',
          distance: 'geladen, Code bereit',
        }),
        facts: [fact('f-call', 'Aufruf', '1'), fact('f-cell1', 'Zelle 1', 'aufgelöst')],
      },
      changed: ['cell1', 'm-dist', 'f-call', 'f-cell1'],
      explanation:
        'Beim ersten Aufruf landet der Sprung im Helfer. Er liest die Signatur der Zelle, lässt die Runtime `Geometry.dll` laden und den Einstiegspunkt von `Distance` bestimmen, vorkompiliert oder gejittet. Die Adresse schreibt er in die Zelle und springt weiter.',
    },
    {
      codeLine: 11,
      state: {
        tables: tables({
          status: { 'c-dist': 'active', cell1: 'match', 'm-dist': 'match', helper: 'dim' },
          cell1: 'm-dist',
          distance: 'geladen, Code bereit',
        }),
        facts: [fact('f-call', 'Aufruf', '2'), fact('f-cost', 'Kosten', 'ein indirekter Sprung')],
      },
      changed: ['c-dist', 'cell1', 'f-call', 'f-cost'],
      explanation:
        'Ab dem zweiten Aufruf springt der Code über die Zelle direkt ans Ziel, der Helfer ist aus dem Spiel. Übrig bleibt ein indirekter Aufruf statt eingebettetem Code. Das ist der Preis dafür, dass `Geometry.dll` unabhängig aktualisiert werden darf.',
    },
    {
      codeLine: 6,
      state: {
        tables: tables({
          status: { cell2: 'active', 'c-write': 'dim' },
          cell1: 'm-dist',
          distance: 'geladen, Code bereit',
        }),
        facts: [
          fact('f-cell2', 'Zelle 2', 'noch nie benutzt'),
          fact('f-lazy', 'Prinzip', 'nur Benutztes wird aufgelöst'),
        ],
      },
      changed: ['cell2', 'f-cell2', 'f-lazy'],
      explanation:
        '`Console.WriteLine` ist bisher nie gelaufen, weil `d` in beiden Aufrufen nicht größer als `c` war (so die Annahme). Zelle 2 zeigt deshalb weiter auf den Helfer. Die Runtime löst nur auf, was wirklich ausgeführt wird, so bleibt der Start schlank.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({
          composite: true,
          status: { 'c-dist': 'match' },
        }),
        facts: [
          fact('f-bubble', 'Version Bubble', 'App.dll und Geometry.dll'),
          fact('f-dist', 'Distance', 'eingebettet'),
          fact('f-price', 'Preis', 'nur gemeinsam austauschbar'),
        ],
      },
      changed: ['c-dist', 'f-bubble', 'f-dist', 'f-price'],
      explanation:
        'Kompilierst du App und Bibliothek als **Composite** in eine gemeinsame Version Bubble, fällt die Grenze weg: `Distance` darf eingebettet werden, Zelle 1 entfällt. Dafür lassen sich beide nur noch zusammen austauschen.',
    },
  ],
});
