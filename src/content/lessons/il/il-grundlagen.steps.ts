import { defineStepScript, type TableState } from '@/components/viz';

// Walkthrough of a small method on the evaluation stack (ECMA-335 Partition III: ldarg, ldloc,
// stloc, ldc.i4.s, mul, ble.s, ret and their stack transitions).
// TODO(verify): Exact Release IL from Roslyn in SharpLab (in particular that the local V_0 stays
// and is not replaced by dup, that the condition becomes ble.s, offsets and .maxstack 2).

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

/** IL rows: id, offset, instruction, depth before → after, optional target row (arg/local). */
const IL: [string, string, string, string, string?][] = [
  ['il-0', 'IL_0000', 'ldarg.0', '0 → 1', 'arg-0'],
  ['il-1', 'IL_0001', 'ldarg.1', '1 → 2', 'arg-1'],
  ['il-2', 'IL_0002', 'mul', '2 → 1'],
  ['il-3', 'IL_0003', 'stloc.0', '1 → 0', 'loc-0'],
  ['il-4', 'IL_0004', 'ldloc.0', '0 → 1', 'loc-0'],
  ['il-5', 'IL_0005', 'ldc.i4.s 100', '1 → 2'],
  ['il-7', 'IL_0007', 'ble.s IL_000c', '2 → 0'],
  ['il-9', 'IL_0009', 'ldc.i4.s 100', '0 → 1'],
  ['il-b', 'IL_000b', 'stloc.0', '1 → 0', 'loc-0'],
  ['il-c', 'IL_000c', 'ldloc.0', '0 → 1', 'loc-0'],
  ['il-d', 'IL_000d', 'ret', '1 → 0'],
];

/** Stack entries, top first: [id, value]. All values here are int32. */
type Entry = [string, string];

interface Look {
  active?: string; // IL row executed in this step
  done?: string[]; // IL rows already executed
  stack: Entry[];
  result: string;
}

function tables({ active, done = [], stack, result }: Look): Table[] {
  const status = (id: string): Status | undefined =>
    id === active ? 'active' : done.includes(id) ? 'match' : undefined;
  const ilRows: Row[] = IL.map(([id, offset, instr, depth, target]) => {
    const s = status(id);
    return {
      id,
      cells: [offset, instr, depth],
      ...(s ? { status: s } : {}),
      ...(target && id === active ? { refs: [{ col: 1, to: target }] } : {}),
    };
  });
  const stackRows: Row[] =
    stack.length === 0
      ? [{ id: 'st-empty', cells: ['', 'leer', ''], status: 'dim' }]
      : stack.map(([id, value], i) => ({
          id,
          cells: [i === 0 ? 'oben' : 'darunter', value, 'int32'],
        }));
  return [
    {
      id: 't-args',
      title: 'Argumente',
      columns: ['Index', 'Name', 'Typ', 'Wert'],
      row: 1,
      col: 1,
      rows: [
        { id: 'arg-0', cells: ['0', 'amount', 'int32', '30'] },
        { id: 'arg-1', cells: ['1', 'factor', 'int32', '5'] },
      ],
    },
    {
      id: 't-locals',
      title: 'Locals',
      columns: ['Index', 'Name', 'Typ', 'Wert'],
      row: 1,
      col: 2,
      rows: [{ id: 'loc-0', cells: ['0', 'result (V_0)', 'int32', result] }],
    },
    {
      id: 't-il',
      title: 'IL von Scale',
      columns: ['Offset', 'Instruktion', 'Tiefe'],
      row: 2,
      col: 1,
      rows: ilRows,
      note: 'Tiefe: Einträge auf dem Evaluation Stack vor → nach der Instruktion',
    },
    {
      id: 't-stack',
      title: 'Evaluation Stack',
      columns: ['Position', 'Wert', 'Typ'],
      row: 2,
      col: 2,
      rows: stackRows,
    },
  ];
}

const depth = (stack: Entry[]): Fact => ({
  id: 'f-depth',
  label: 'Tiefe',
  value: `${stack.length} (maxstack 2)`,
});

const step = (look: Look, extra: Fact[] = []): TableState => ({
  tables: tables(look),
  facts: [depth(look.stack), ...extra],
});

const all = (until: string) => {
  const ids = IL.map((r) => r[0]);
  return ids.slice(0, ids.indexOf(until));
};

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Scale(30, 5) auf dem Evaluation Stack',
  code: {
    cs: `static int Scale(int amount, int factor)
{
    int result = amount * factor;
    if (result > 100)
        result = 100;
    return result;
}`,
    il: `.method private hidebysig static int32 Scale (int32 amount, int32 factor) cil managed
{
    .maxstack 2
    .locals init (int32 V_0)
    IL_0000: ldarg.0
    IL_0001: ldarg.1
    IL_0002: mul
    IL_0003: stloc.0
    IL_0004: ldloc.0
    IL_0005: ldc.i4.s 100
    IL_0007: ble.s IL_000c
    IL_0009: ldc.i4.s 100
    IL_000b: stloc.0
    IL_000c: ldloc.0
    IL_000d: ret
}`,
  },
  steps: [
    {
      codeLine: 1,
      highlight: { il: [1, 3, 4] },
      state: step({ stack: [], result: '0' }),
      explanation:
        'Aufruf `Scale(30, 5)`. Die Methode hat drei getrennte Speicherorte: zwei **Argumente**, einen **Local** (`.locals init` setzt ihn auf 0) und den **Evaluation Stack**, der zu Beginn leer ist. Der Name `result` steht übrigens nicht im IL, nur der Index 0.',
    },
    {
      codeLine: 3,
      highlight: { il: [5] },
      state: step({ active: 'il-0', stack: [['s-a', '30']], result: '0' }),
      changed: ['s-a', 'f-depth'],
      explanation:
        '`ldarg.0` kopiert Argument 0 auf den Evaluation Stack. Das Argument selbst bleibt unverändert, auf dem Stack liegt eine Kopie.',
    },
    {
      codeLine: 3,
      highlight: { il: [6] },
      state: step({
        active: 'il-1',
        done: all('il-1'),
        stack: [
          ['s-b', '5'],
          ['s-a', '30'],
        ],
        result: '0',
      }),
      changed: ['s-b', 'f-depth'],
      explanation:
        '`ldarg.1` legt den zweiten Wert oben drauf. Häufige Fehlannahme: Das sei der Stack im Stack-Frame. Der Evaluation Stack ist aber ein **Rechenmodell** des IL, Argumente und Locals haben eigene Plätze, und was der JIT daraus macht (meist Register), steht nirgends fest.',
    },
    {
      codeLine: 3,
      highlight: { il: [7] },
      state: step({ active: 'il-2', done: all('il-2'), stack: [['s-c', '150']], result: '0' }),
      changed: ['s-c', 'f-depth'],
      explanation:
        '`mul` hat keinen Operanden. Es nimmt die beiden obersten Einträge vom Stack, multipliziert sie und legt das Ergebnis zurück. So arbeiten alle Rechen- und Vergleichsinstruktionen.',
    },
    {
      codeLine: 3,
      highlight: { il: [8] },
      state: step({ active: 'il-3', done: all('il-3'), stack: [], result: '150' }),
      changed: ['loc-0', 'f-depth'],
      explanation:
        '`stloc.0` nimmt den obersten Wert vom Stack und speichert ihn in Local 0. Erst jetzt hat `result` einen Wert, der Stack ist wieder leer.',
    },
    {
      codeLine: 4,
      highlight: { il: [9] },
      state: step({ active: 'il-4', done: all('il-4'), stack: [['s-d', '150']], result: '150' }),
      changed: ['s-d', 'f-depth'],
      explanation:
        'Für den Vergleich muss der Wert wieder auf den Stack. `ldloc.0` kopiert ihn aus Local 0 zurück. Im IL wird ständig zwischen Locals und Stack hin und her kopiert.',
    },
    {
      codeLine: 4,
      highlight: { il: [10] },
      state: step({
        active: 'il-5',
        done: all('il-5'),
        stack: [
          ['s-e', '100'],
          ['s-d', '150'],
        ],
        result: '150',
      }),
      changed: ['s-e', 'f-depth'],
      explanation:
        '`ldc.i4.s 100` lädt eine Konstante. Das `.s` steht für die Kurzform mit einem Operanden von nur einem Byte (-128 bis 127). Für 100 genügt das, für 1000 bräuchte der Compiler `ldc.i4` mit vier Byte.',
    },
    {
      codeLine: 4,
      highlight: { il: [11] },
      state: step({ active: 'il-7', done: all('il-7'), stack: [], result: '150' }),
      changed: ['f-depth'],
      explanation:
        '`ble.s` nimmt beide Werte vom Stack und springt, wenn der untere kleiner oder gleich dem oberen ist. Der Compiler hat die Bedingung umgedreht: Er springt **über** die Zuweisung hinweg, wenn sie nicht nötig ist. 150 ist nicht kleiner oder gleich 100, also kein Sprung.',
    },
    {
      codeLine: 5,
      highlight: { il: [12] },
      state: step({ active: 'il-9', done: all('il-9'), stack: [['s-f', '100']], result: '150' }),
      changed: ['s-f', 'f-depth'],
      explanation:
        'Weil nicht gesprungen wurde, läuft die Ausführung bei `IL_0009` weiter. Die Konstante 100 kommt auf den Stack.',
    },
    {
      codeLine: 5,
      highlight: { il: [13] },
      state: step({ active: 'il-b', done: all('il-b'), stack: [], result: '100' }),
      changed: ['loc-0', 'f-depth'],
      explanation:
        '`stloc.0` überschreibt Local 0 mit 100. An dieser Stelle (`IL_000c`) treffen sich die beiden Wege: der mit Sprung und der ohne. Auf beiden ist der Stack hier leer, und genau das verlangt ECMA-335.',
    },
    {
      codeLine: 6,
      highlight: { il: [14] },
      state: step({ active: 'il-c', done: all('il-c'), stack: [['s-g', '100']], result: '100' }),
      changed: ['s-g', 'f-depth'],
      explanation: '`ldloc.0` legt den Rückgabewert auf den Stack.',
    },
    {
      codeLine: 6,
      highlight: { il: [15] },
      state: step({ active: 'il-d', done: all('il-d'), stack: [], result: '100' }, [
        { id: 'f-ret', label: 'Rückgabewert', value: '100' },
      ]),
      changed: ['f-ret', 'f-depth'],
      explanation:
        '`ret` nimmt den einzigen verbleibenden Eintrag als Rückgabewert. Bei einer Methode mit Rückgabewert muss genau dieser eine Wert auf dem Stack liegen, bei `void` muss er leer sein. Die größte Tiefe war 2, das ist der Wert in `.maxstack`.',
    },
  ],
});
