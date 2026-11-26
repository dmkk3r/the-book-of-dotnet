import { defineStepScript, type TableState } from '@/components/viz';

// What the instrumented version of AreaOf records and how Tier 1 reads it.
// All counts are illustrative, not measured.
// TODO(verify): Class probes keep a small fixed-size table of MethodTable pointers filled by
// reservoir sampling (table size 8?), so the numbers are samples, not exact counts
// (Performance Improvements in .NET 7/8, src/coreclr/vm/jithelpers.cpp class profile helpers).
// TODO(verify): Since .NET 7 block counts come from edge counters placed on a spanning tree and
// are reconstructed by the JIT; not every block has its own counter.
// TODO(verify): Minimum likelihood for a GDV guess (JitGuardedDevirtualizationChainLikelihood or
// similar config) and how many types the JIT may check by default.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];

interface Counts {
  entry: string;
  isNull: string;
  call: string;
  types: { id: string; name: string; samples: string; share: string; status?: Row['status'] }[];
}

/** Probe table; `active` marks the probe written in this step, `coldRef` links the null branch. */
const probes = (c: Counts, active?: string, coldRef = false): Table => {
  const row = (id: string, cells: string[], extra: Partial<Row> = {}): Row => ({
    id,
    cells,
    ...(id === active ? { status: 'active' as const } : {}),
    ...extra,
  });
  return {
    id: 't-probes',
    title: 'Probes in AreaOf (instrumentiert)',
    columns: ['Probe', 'Art', 'Wert'],
    rows: [
      row('p-entry', ['Eintritt', 'Zähler', c.entry]),
      row(
        'p-null',
        ['Zweig s is null', 'Zähler', c.isNull],
        coldRef ? { refs: [{ col: 0, to: 'd-cold' }] } : {},
      ),
      row('p-call', ['s.Area()', 'Klassenprobe', c.call], {
        refs: c.types.map((t) => ({ col: 2, to: t.id })),
      }),
    ],
  };
};

const histogram = (c: Counts, refToDecision = false): Table => ({
  id: 't-hist',
  title: 'Klassenprofil von s.Area()',
  columns: ['Typ', 'Stichproben', 'Anteil'],
  rows: c.types.map((t) => ({
    id: t.id,
    cells: [t.name, t.samples, t.share],
    ...(t.status ? { status: t.status } : {}),
    ...(refToDecision && t.status === 'match' ? { refs: [{ col: 0, to: 'd-gdv' }] } : {}),
  })),
  col: 2,
  note: 'Typen, die an der Aufrufstelle angekommen sind',
});

const decisions = (rows: Row[]): Table => ({
  id: 't-dec',
  title: 'Entscheidungen in Tier 1',
  columns: ['Beobachtung', 'Folge im Code'],
  rows,
  row: 2,
  col: 1,
});

const start: Counts = { entry: '0', isNull: '0', call: '0 Aufrufe', types: [] };
const early: Counts = {
  entry: '8',
  isNull: '0',
  call: '8 Aufrufe',
  types: [{ id: 'h-circle', name: 'Circle', samples: '8', share: '100 %' }],
};
const mixed: Counts = {
  entry: '20',
  isNull: '0',
  call: '20 Aufrufe',
  types: [
    { id: 'h-circle', name: 'Circle', samples: '18', share: '90 %' },
    { id: 'h-square', name: 'Square', samples: '2', share: '10 %' },
  ],
};
const done: Counts = {
  entry: '30',
  isNull: '1',
  call: '29 Aufrufe',
  types: [
    { id: 'h-circle', name: 'Circle', samples: '26', share: 'etwa 90 %', status: 'match' },
    { id: 'h-square', name: 'Square', samples: '3', share: 'etwa 10 %', status: 'dim' },
  ],
};
const mega: Counts = {
  entry: '30',
  isNull: '0',
  call: '30 Aufrufe',
  types: [
    { id: 'h-circle', name: 'Circle', samples: '8', share: 'etwa 25 %', status: 'miss' },
    { id: 'h-square', name: 'Square', samples: '7', share: 'etwa 25 %', status: 'miss' },
    { id: 'h-tri', name: 'Triangle', samples: '8', share: 'etwa 25 %', status: 'miss' },
    { id: 'h-hex', name: 'Hexagon', samples: '7', share: 'etwa 25 %', status: 'miss' },
  ],
};

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Was die Probes sammeln und was der JIT daraus macht',
  code: {
    cs: `static double AreaOf(IShape? s)
{
    if (s is null) return 0;   // Zähler für diesen Zweig
    return s.Area();           // Klassenprobe: welcher Typ?
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        tables: [probes(start), histogram(start)],
        facts: [{ id: 'f-tier', label: 'Code', value: 'Tier 0 instrumentiert' }],
      },
      changed: ['t-probes', 't-hist'],
      explanation:
        'Die instrumentierte Fassung von `AreaOf` ist gerade installiert. Zu jeder Probe gehört ein Speicherplatz, in den der Code beim Durchlaufen schreibt. Noch ist alles leer.',
    },
    {
      codeLine: 4,
      state: {
        tables: [probes(early, 'p-call'), histogram(early)],
        facts: [{ id: 'f-tier', label: 'Code', value: 'Tier 0 instrumentiert' }],
      },
      changed: ['p-entry', 'p-call', 'h-circle'],
      explanation:
        'Die ersten Aufrufe bringen nur `Circle`-Objekte. Die Klassenprobe vor `s.Area()` liest bei jedem Aufruf den **MethodTable-Zeiger** des Objekts und legt ihn in einer kleinen Tabelle ab. Der Zweig `s is null` wurde noch nie genommen.',
    },
    {
      codeLine: 4,
      state: {
        tables: [probes(mixed, 'p-call'), histogram(mixed)],
        facts: [{ id: 'f-tier', label: 'Code', value: 'Tier 0 instrumentiert' }],
      },
      changed: ['p-entry', 'p-call', 'h-circle', 'h-square'],
      explanation:
        'Jetzt kommen auch `Square`-Objekte an. Die Tabelle ist klein und wird per Stichprobenverfahren gefüllt, die Zahlen sind deshalb Anteile, keine exakten Zählungen. Für die Entscheidung des JIT reicht das.',
    },
    {
      codeLine: 3,
      state: {
        tables: [probes(done, 'p-null'), histogram(done)],
        facts: [
          { id: 'f-tier', label: 'Code', value: 'Tier 0 instrumentiert' },
          { id: 'f-next', label: 'Als Nächstes', value: 'Tier 1 übersetzen' },
        ],
      },
      changed: ['p-null', 'f-next'],
      explanation:
        'Am Ende der instrumentierten Phase ist der `null`-Zweig einmal genommen worden, alle anderen Aufrufe liefen bis `s.Area()`. Die Methode erreicht die Schwelle und kommt in die Warteschlange für Tier 1.',
    },
    {
      codeLine: 4,
      state: {
        tables: [
          probes(done, undefined, true),
          histogram(done, true),
          decisions([
            {
              id: 'd-gdv',
              cells: ['Circle dominiert', 'Typprüfung auf Circle, Circle.Area inline'],
              status: 'match',
            },
            {
              id: 'd-cold',
              cells: ['s is null fast nie', 'Block kalt, ans Methodenende'],
              status: 'match',
            },
          ]),
        ],
        facts: [{ id: 'f-tier', label: 'Code', value: 'Tier 1 mit Profil' }],
      },
      changed: ['t-dec', 'd-gdv', 'd-cold', 'h-circle'],
      explanation:
        'Der Tier-1-JIT liest das Profil. Weil `Circle` deutlich dominiert, setzt er vor den Aufruf eine **Typprüfung** und inlint `Circle.Area` dahinter. Den seltenen `null`-Zweig verschiebt er hinter den heißen Pfad.',
    },
    {
      codeLine: 4,
      state: {
        tables: [
          probes(mega),
          histogram(mega),
          decisions([
            {
              id: 'd-none',
              cells: ['kein Typ dominiert', 'normaler Interface-Aufruf'],
              status: 'miss',
            },
          ]),
        ],
        facts: [
          { id: 'f-tier', label: 'Code', value: 'Tier 1 mit Profil' },
          { id: 'f-case', label: 'Fall', value: 'Gedankenexperiment: megamorph' },
        ],
      },
      changed: ['h-circle', 'h-square', 'h-tri', 'h-hex', 'd-none', 'f-case'],
      explanation:
        'Zum Vergleich eine **megamorphe** Aufrufstelle: Vier Typen kommen etwa gleich oft vor. Eine Prüfung auf einen einzelnen Typ träfe nur jeden vierten Aufruf, also lässt der JIT es bleiben und erzeugt den normalen Interface-Aufruf.',
    },
  ],
});
