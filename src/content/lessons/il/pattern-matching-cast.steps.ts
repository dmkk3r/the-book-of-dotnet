import { defineStepScript, type TableState } from '@/components/viz';

// Old style "is, then cast" against the type pattern "is T t" (ECMA-335 Partition III: isinst,
// castclass, brfalse, stloc, ldloc, callvirt). Addresses are fictional but consistent.
// TODO(verify): Release IL from Roslyn in SharpLab for both methods: AreaOld uses isinst, brfalse.s,
// then ldarg.0 and castclass; AreaNew uses isinst, stloc.0, ldloc.0, brfalse.s (no castclass).

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Fact = NonNullable<TableState['facts']>[number];

const CIRCLE = '0x7F3A1000';
const TEXT = '0x7F3A1040';

/** Stack entry: [id, value, type, optional heap row]. Top first. */
type Entry = [string, string, string, string?];

interface Look {
  /** Which object o points to. */
  arg?: 'circle' | 'text';
  stack: Entry[];
  /** Value of local V_0 (only AreaNew has it). */
  local?: string;
  isinst: number;
  castclass: number;
  /** Heap row that is being checked in this step. */
  checking?: string;
}

function state({ arg = 'circle', stack, local, isinst, castclass, checking }: Look): TableState {
  const heapRow = arg === 'circle' ? 'h-circle' : 'h-text';
  const heapRows: Row[] = [
    {
      id: 'h-circle',
      cells: [CIRCLE, 'Circle', 'Radius = 2.0'],
      ...(checking === 'h-circle' ? { status: 'active' as const } : {}),
      ...(arg !== 'circle' ? { status: 'dim' as const } : {}),
    },
    {
      id: 'h-text',
      cells: [TEXT, 'String', '"Text"'],
      ...(checking === 'h-text' ? { status: 'active' as const } : {}),
      ...(arg !== 'text' ? { status: 'dim' as const } : {}),
    },
  ];
  const stackRows: Row[] =
    stack.length === 0
      ? [{ id: 'st-empty', cells: ['', 'leer', ''], status: 'dim' }]
      : stack.map(([id, value, type, ref], i) => ({
          id,
          cells: [i === 0 ? 'oben' : 'darunter', value, type],
          ...(ref ? { refs: [{ col: 1, to: ref }] } : {}),
        }));
  const varRows: Row[] = [
    {
      id: 'v-o',
      cells: ['Argument 0', 'o', 'object', arg === 'circle' ? CIRCLE : TEXT],
      refs: [{ col: 3, to: heapRow }],
    },
  ];
  if (local !== undefined) {
    varRows.push({
      id: 'v-c',
      cells: ['Local 0', 'c', 'Circle', local],
      ...(local === CIRCLE ? { refs: [{ col: 3, to: 'h-circle' }] } : {}),
    });
  }
  const facts: Fact[] = [
    { id: 'f-isinst', label: 'isinst ausgeführt', value: String(isinst) },
    { id: 'f-cast', label: 'castclass ausgeführt', value: String(castclass) },
  ];
  return {
    tables: [
      {
        id: 't-vars',
        title: 'Argumente und Locals',
        columns: ['Ort', 'Name', 'Typ', 'Wert'],
        row: 1,
        col: 1,
        rows: varRows,
      },
      {
        id: 't-stack',
        title: 'Evaluation Stack',
        columns: ['Position', 'Wert', 'Typ'],
        row: 1,
        col: 2,
        rows: stackRows,
      },
      {
        id: 't-heap',
        title: 'Heap',
        columns: ['Adresse', 'Typ', 'Inhalt'],
        row: 2,
        col: 1,
        rows: heapRows,
      },
    ],
    facts,
  };
}

const refC: Entry = ['st-ref', CIRCLE, 'O (Verweis)', 'h-circle'];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'is mit Cast gegen das Typmuster',
  code: {
    cs: `// alt: erst prüfen, dann casten
static double AreaOld(object o)
{
    if (o is Circle)
        return ((Circle)o).Radius;
    return 0;
}

// neu: Typmuster mit Variable
static double AreaNew(object o)
{
    if (o is Circle c)
        return c.Radius;
    return 0;
}`,
    lowered: `static double AreaOld(object o)
{
    if (o is Circle)
        return ((Circle)o).Radius;
    return 0.0;
}

static double AreaNew(object o)
{
    Circle c = o as Circle;
    if (c != null)
        return c.Radius;
    return 0.0;
}`,
    il: `// AreaOld, vereinfacht
ldarg.0
isinst     Circle
brfalse.s  ZERO1
ldarg.0
castclass  Circle
callvirt   instance float64 Circle::get_Radius()
ret
ZERO1:
ldc.r8     0.0
ret

// AreaNew, vereinfacht
ldarg.0
isinst     Circle
stloc.0
ldloc.0
brfalse.s  ZERO2
ldloc.0
callvirt   instance float64 Circle::get_Radius()
ret
ZERO2:
ldc.r8     0.0
ret`,
  },
  steps: [
    {
      codeLine: 4,
      highlight: { lowered: [3], il: [2, 3] },
      state: state({ stack: [refC], isinst: 1, castclass: 0, checking: 'h-circle' }),
      changed: ['st-ref', 'h-circle', 'f-isinst'],
      explanation:
        '`o is Circle` wird zu `isinst Circle`. Die Runtime liest die MethodTable des Objekts und prüft, ob der Typ passt. Das Ergebnis ist kein `bool`, sondern derselbe Verweis als `Circle` oder `null`.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [3], il: [4] },
      state: state({ stack: [], isinst: 1, castclass: 0 }),
      changed: ['st-empty'],
      explanation:
        '`brfalse.s` nimmt den Verweis vom Stack und springt, wenn er null ist. Er ist es nicht, also geht es weiter. Der geprüfte Verweis ist damit verbraucht, der Code hat ihn nirgends gespeichert.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [4], il: [5, 6] },
      state: state({ stack: [refC], isinst: 1, castclass: 1, checking: 'h-circle' }),
      changed: ['st-ref', 'h-circle', 'f-cast'],
      explanation:
        'Für den Cast lädt der Code `o` noch einmal und führt `castclass Circle` aus: dieselbe Typprüfung ein zweites Mal, diesmal mit Exception statt null bei Misserfolg. Häufige Fehlannahme: „Nach dem `is` weiß die Runtime ja, dass es ein Circle ist.“ Im IL steht nichts, was ihr das sagt.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [4], il: [7, 8] },
      state: state({ stack: [['st-val', '2.0', 'float64']], isinst: 1, castclass: 1 }),
      changed: ['st-val'],
      explanation:
        '`callvirt get_Radius` ersetzt den Verweis durch den Wert der Property, `ret` gibt ihn zurück. Bilanz der alten Form: zwei Typprüfungen für eine Frage.',
    },
    {
      codeLine: 11,
      highlight: { lowered: [10], il: [14, 15] },
      state: state({ stack: [refC], local: 'null', isinst: 1, castclass: 0, checking: 'h-circle' }),
      changed: ['st-ref', 'h-circle', 'v-c', 'f-isinst', 'f-cast'],
      explanation:
        'Jetzt `AreaNew` mit demselben Objekt, die Zähler beginnen von vorn. Der Anfang ist identisch: `ldarg.0` und `isinst Circle`. Der gelowerte Code zeigt, was das Muster bedeutet: `o as Circle`.',
    },
    {
      codeLine: 11,
      highlight: { lowered: [10], il: [16] },
      state: state({ stack: [], local: CIRCLE, isinst: 1, castclass: 0 }),
      changed: ['v-c', 'st-empty'],
      explanation:
        'Der Unterschied: `stloc.0` speichert das Ergebnis von `isinst` in der Variable `c`. Der Verweis hat seine Prüfung schon hinter sich und ist bereits vom Typ `Circle`.',
    },
    {
      codeLine: 11,
      highlight: { lowered: [11], il: [17, 18] },
      state: state({ stack: [], local: CIRCLE, isinst: 1, castclass: 0 }),
      explanation:
        '`ldloc.0` und `brfalse.s` sind die Null-Prüfung `c != null`. Mehr ist das Typmuster nicht: ein `isinst` und ein Vergleich mit null.',
    },
    {
      codeLine: 12,
      highlight: { lowered: [12], il: [19, 20, 21] },
      state: state({
        stack: [['st-val', '2.0', 'float64']],
        local: CIRCLE,
        isinst: 1,
        castclass: 0,
      }),
      changed: ['st-val'],
      explanation:
        '`c.Radius` arbeitet direkt mit dem gespeicherten Verweis. Bilanz: eine Typprüfung, kein `castclass`. Dasselbe IL entsteht übrigens für das handgeschriebene `as` mit Null-Prüfung.',
    },
    {
      codeLine: 11,
      highlight: { lowered: [10, 11, 13], il: [14, 15, 16, 17, 18, 22, 23, 24] },
      state: state({
        arg: 'text',
        stack: [],
        local: 'null',
        isinst: 1,
        castclass: 0,
        checking: 'h-text',
      }),
      changed: ['v-o', 'v-c', 'h-text'],
      explanation:
        'Zum Vergleich ein String als Eingabe: `isinst Circle` findet in der Typkette von `String` kein `Circle` und liefert null, `c` bleibt null. `brfalse.s` springt zu `ZERO2`, die Methode gibt 0 zurück. Eine Exception kann das Muster nie werfen.',
    },
  ],
});
