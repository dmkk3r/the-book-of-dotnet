import { defineStepScript, type TableState } from '@/components/viz';

// An integer switch expression with dense cases becomes the IL instruction `switch`
// (ECMA-335 Partition III: switch takes N targets, the value is used as an unsigned index,
// values >= N fall through to the next instruction).
// TODO(verify): Release IL from Roslyn in SharpLab: ldarg.0, ldc.i4.1, sub, switch with five
// targets, then br to the default. Roslyn stores the result in a local before returning; the IL
// tab keeps it on the stack for brevity.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
const LABELS = ['L_MO', 'L_DI', 'L_MI', 'L_DO', 'L_FR'];

interface Look {
  /** Index looked up in the jump table, or "out" when the value is out of range. */
  index?: number | 'out';
  /** Whether the jump has already happened. */
  jumped?: boolean;
  facts: Fact[];
}

function state({ index, jumped = false, facts }: Look): TableState {
  const entryStatus = (i: number): Status | undefined => {
    if (index === undefined) return undefined;
    if (index === 'out') return 'dim';
    return i === index ? (jumped ? 'match' : 'active') : 'dim';
  };
  const targetStatus = (label: string): Status | undefined => {
    if (!jumped || index === undefined) return undefined;
    const hit = index === 'out' ? 'L_DEFAULT' : LABELS[index];
    return label === hit ? 'match' : 'dim';
  };
  const entries: Row[] = LABELS.map((label, i) => {
    const s = entryStatus(i);
    return {
      id: `idx-${i}`,
      cells: [String(i), label],
      refs: [{ col: 1, to: `t-${label}` }],
      ...(s ? { status: s } : {}),
    };
  });
  const targets: Row[] = [
    ...LABELS.map((label, i) => ({ label, code: `ldstr "${DAYS[i]}"` })),
    { label: 'L_DEFAULT', code: 'ldstr "kein Werktag"' },
  ].map(({ label, code }) => {
    const s = targetStatus(label);
    return { id: `t-${label}`, cells: [label, code], ...(s ? { status: s } : {}) };
  });
  return {
    tables: [
      {
        id: 'jump',
        title: 'switch (5 Ziele)',
        columns: ['Index', 'Ziel'],
        row: 1,
        col: 1,
        rows: entries,
        note: 'Index ab 5: weiter mit der nächsten Instruktion',
      },
      {
        id: 'targets',
        title: 'Sprungziele',
        columns: ['Label', 'Code'],
        row: 1,
        col: 2,
        rows: targets,
      },
    ],
    facts,
  };
}

const f = (day: string, minus: string, unsigned: string, res: string): Fact[] => [
  { id: 'f-day', label: 'day', value: day },
  { id: 'f-minus', label: 'day - 1', value: minus },
  { id: 'f-uint', label: 'als Index (unsigned)', value: unsigned },
  { id: 'f-res', label: 'Ergebnis', value: res },
];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Ein Integer-switch als Sprungtabelle',
  code: {
    cs: `static string DayName(int day) => day switch
{
    1 => "Mo",
    2 => "Di",
    3 => "Mi",
    4 => "Do",
    5 => "Fr",
    _ => "kein Werktag",
};`,
    lowered: `// vereinfacht, Release
static string DayName(int day)
{
    string result;
    switch (day)
    {
        case 1: result = "Mo"; break;
        case 2: result = "Di"; break;
        case 3: result = "Mi"; break;
        case 4: result = "Do"; break;
        case 5: result = "Fr"; break;
        default: result = "kein Werktag"; break;
    }
    return result;
}`,
    il: `// vereinfacht, Release
ldarg.0
ldc.i4.1
sub
switch     (L_MO, L_DI, L_MI, L_DO, L_FR)
br.s       L_DEFAULT
L_MO:      ldstr "Mo"
br.s       END
L_DI:      ldstr "Di"
br.s       END
L_MI:      ldstr "Mi"
br.s       END
L_DO:      ldstr "Do"
br.s       END
L_FR:      ldstr "Fr"
br.s       END
L_DEFAULT: ldstr "kein Werktag"
END:       ret`,
  },
  steps: [
    {
      codeLine: 1,
      highlight: { lowered: [5], il: [5] },
      state: state({ facts: [{ id: 'f-cases', label: 'Fälle', value: '1 bis 5, lückenlos' }] }),
      changed: ['jump', 'f-cases'],
      explanation:
        'Die Werte 1 bis 5 liegen dicht beieinander. Der Compiler erzeugt deshalb keine Kette von Vergleichen, sondern die IL-Instruktion `switch` mit einer Liste von fünf Sprungzielen. Die Tabelle steht fertig im IL, zur Laufzeit wird sie nur noch benutzt.',
    },
    {
      codeLine: 1,
      highlight: { il: [2, 3, 4] },
      state: state({ facts: f('3', '2', '2', 'offen') }),
      changed: ['f-day', 'f-minus', 'f-uint', 'f-res'],
      explanation:
        'Erste Eingabe: `day = 3`. `switch` zählt seine Ziele ab 0, der kleinste Fall ist aber 1. Deshalb zieht der Code vorher 1 ab, aus 3 wird Index 2.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [9], il: [5, 11] },
      state: state({ index: 2, jumped: true, facts: f('3', '2', '2', '"Mi"') }),
      changed: ['idx-2', 't-L_MI', 'f-res'],
      explanation:
        'Mit dem Index 2 springt `switch` direkt zum dritten Ziel, `L_MI`. Es gibt keinen einzigen Vergleich mit 1, 2 oder 3: Die Kosten sind gleich, ob der Fall oben oder unten steht. Häufige Fehlannahme: „Ein switch probiert die Fälle von oben nach unten durch.“',
    },
    {
      codeLine: 8,
      highlight: { lowered: [12], il: [5, 6, 17] },
      state: state({
        index: 'out',
        jumped: true,
        facts: f('0', '-1', '4294967295', '"kein Werktag"'),
      }),
      changed: ['t-L_DEFAULT', 'f-day', 'f-minus', 'f-uint', 'f-res'],
      explanation:
        'Zweite Eingabe: `day = 0`, also Index -1. `switch` liest den Wert ohne Vorzeichen, -1 wird zu 4294967295 und liegt weit hinter dem fünften Ziel. Die Ausführung fällt durch zu `br.s L_DEFAULT`: Ein einziger Vergleich deckt beide Enden des Bereichs ab.',
    },
    {
      codeLine: 8,
      highlight: { lowered: [12], il: [5, 6, 17] },
      state: state({ index: 'out', jumped: true, facts: f('9', '8', '8', '"kein Werktag"') }),
      changed: ['f-day', 'f-minus', 'f-uint'],
      explanation:
        'Dritte Eingabe: `day = 9`, Index 8. Auch das ist mindestens 5, also wieder der Default. Wie der JIT die Tabelle in Maschinencode übersetzt, etwa als Tabelle von Sprungadressen, entscheidet er selbst.',
    },
  ],
});
