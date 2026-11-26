import { defineStepScript, type TableState } from '@/components/viz';

// Object instructions on the evaluation stack: newobj, callvirt, ldfld, stfld, box.
// Addresses are fictional but consistent across steps.
// TODO(verify): Exact Roslyn IL in SharpLab. A Release build may keep the reference on the stack
// with dup instead of using the local V_0; offsets assume the variant with the local.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];

const OBJ = '0x7F3A1000';
const BOX = '0x7F3A1018';

const IL: [string, string, string, string][] = [
  ['il-0', 'IL_0000', 'newobj Counter::.ctor()', '0 → 1'],
  ['il-5', 'IL_0005', 'stloc.0', '1 → 0'],
  ['il-6', 'IL_0006', 'ldloc.0', '0 → 1'],
  ['il-7', 'IL_0007', 'ldc.i4.5', '1 → 2'],
  ['il-8', 'IL_0008', 'callvirt Counter::Add(int32)', '2 → 0'],
  ['il-d', 'IL_000d', 'ldloc.0', '0 → 1'],
  ['il-e', 'IL_000e', 'ldfld Counter::Value', '1 → 1'],
  ['il-13', 'IL_0013', 'box System.Int32', '1 → 1'],
  ['il-18', 'IL_0018', 'ret', '1 → 0'],
];

/** Stack entry: [id, value, stack type, referenced heap row]. Top first. */
type Entry = [string, string, string, string?];

interface Look {
  active?: string;
  local: boolean; // c holds the reference
  value: string; // Counter.Value
  box: boolean;
  stack: Entry[];
}

function tables({ active, local, value, box, stack }: Look): Table[] {
  const ids = IL.map((r) => r[0]);
  const done = active ? ids.slice(0, ids.indexOf(active)) : [];
  const heap: Row[] = [];
  if (active !== undefined) {
    heap.push({ id: 'h-counter', cells: [OBJ, 'Counter', `Value = ${value}`] });
  }
  if (box) heap.push({ id: 'h-box', cells: [BOX, 'Int32 (geboxt)', '5'] });
  return [
    {
      id: 't-locals',
      title: 'Locals',
      columns: ['Index', 'Name', 'Typ', 'Wert'],
      row: 1,
      col: 1,
      rows: [
        {
          id: 'loc-0',
          cells: ['0', 'c (V_0)', 'Counter', local ? OBJ : 'null'],
          ...(local ? { refs: [{ col: 3, to: 'h-counter' }] } : {}),
        },
      ],
    },
    {
      id: 't-heap',
      title: 'Heap',
      columns: ['Adresse', 'Typ', 'Inhalt'],
      row: 1,
      col: 2,
      rows: heap.length > 0 ? heap : [{ id: 'h-empty', cells: ['', 'leer', ''], status: 'dim' }],
    },
    {
      id: 't-il',
      title: 'IL von Run',
      columns: ['Offset', 'Instruktion', 'Tiefe'],
      row: 2,
      col: 1,
      rows: IL.map(([id, off, instr, depth]) => ({
        id,
        cells: [off, instr, depth],
        ...(id === active
          ? { status: 'active' as const }
          : done.includes(id)
            ? { status: 'match' as const }
            : {}),
      })),
    },
    {
      id: 't-stack',
      title: 'Evaluation Stack',
      columns: ['Position', 'Wert', 'Typ'],
      row: 2,
      col: 2,
      rows:
        stack.length === 0
          ? [{ id: 'st-empty', cells: ['', 'leer', ''], status: 'dim' }]
          : stack.map(([id, v, type, to], i) => ({
              id,
              cells: [i === 0 ? 'oben' : 'darunter', v, type],
              ...(to ? { refs: [{ col: 1, to }] } : {}),
            })),
    },
  ];
}

const CS = `class Counter
{
    public int Value;
    public void Add(int n) => Value += n;
}

static object Run()
{
    var c = new Counter();
    c.Add(5);
    return c.Value;
}`;

const ILCODE = `// Run
.locals init (class Counter V_0)
IL_0000: newobj instance void Counter::.ctor()
IL_0005: stloc.0
IL_0006: ldloc.0
IL_0007: ldc.i4.5
IL_0008: callvirt instance void Counter::Add(int32)
IL_000d: ldloc.0
IL_000e: ldfld int32 Counter::Value
IL_0013: box [System.Runtime]System.Int32
IL_0018: ret

// Counter.Add
IL_0000: ldarg.0
IL_0001: ldarg.0
IL_0002: ldfld int32 Counter::Value
IL_0007: ldarg.1
IL_0008: add
IL_0009: stfld int32 Counter::Value
IL_000e: ret`;

const ref = (id: string): Entry => [id, OBJ, 'O (Verweis)', 'h-counter'];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Objekt anlegen, Methode aufrufen, Feld lesen',
  code: { cs: CS, il: ILCODE },
  steps: [
    {
      codeLine: 7,
      highlight: { il: [2] },
      state: { tables: tables({ local: false, value: '0', box: false, stack: [] }) },
      explanation:
        'Ausgangslage: Local 0 ist ein Verweis vom Typ `Counter` und steht auf `null`. Der Heap enthält noch nichts, was zu dieser Methode gehört.',
    },
    {
      codeLine: 9,
      highlight: { il: [3] },
      state: {
        tables: tables({
          active: 'il-0',
          local: false,
          value: '0',
          box: false,
          stack: [ref('s-a')],
        }),
      },
      changed: ['h-counter', 's-a'],
      explanation:
        '`newobj` erledigt drei Dinge auf einmal: Speicher für ein `Counter` reservieren, den Konstruktor mit dem neuen Objekt als `this` aufrufen und den Verweis auf den Stack legen. Auf dem Evaluation Stack liegt also nie ein Objekt, nur ein Verweis (Stacktyp `O`).',
    },
    {
      codeLine: 9,
      highlight: { il: [4] },
      state: { tables: tables({ active: 'il-5', local: true, value: '0', box: false, stack: [] }) },
      changed: ['loc-0'],
      explanation: '`stloc.0` speichert den Verweis in `c`. Der Stack ist wieder leer.',
    },
    {
      codeLine: 10,
      highlight: { il: [5] },
      state: {
        tables: tables({
          active: 'il-6',
          local: true,
          value: '0',
          box: false,
          stack: [ref('s-b')],
        }),
      },
      changed: ['s-b'],
      explanation:
        'Für den Aufruf `c.Add(5)` kommen die Argumente in Reihenfolge auf den Stack, zuerst das Objekt selbst. Es wird zum Argument 0, also zu `this` in `Add`.',
    },
    {
      codeLine: 10,
      highlight: { il: [6] },
      state: {
        tables: tables({
          active: 'il-7',
          local: true,
          value: '0',
          box: false,
          stack: [['s-c', '5', 'int32'], ref('s-b')],
        }),
      },
      changed: ['s-c'],
      explanation:
        '`ldc.i4.5` legt die 5 ab. Für die Zahlen -1 bis 8 gibt es eigene Ein-Byte-Instruktionen ohne Operanden, deshalb hier nicht einmal `ldc.i4.s`.',
    },
    {
      codeLine: 10,
      highlight: { il: [7, 14, 15, 16, 17, 18, 19, 20] },
      state: { tables: tables({ active: 'il-8', local: true, value: '5', box: false, stack: [] }) },
      changed: ['h-counter'],
      explanation:
        '`callvirt` nimmt beide Argumente vom Stack und ruft `Add` auf, das mit eigenem, leerem Evaluation Stack beginnt und `Value` auf 5 setzt. `Add` ist gar nicht virtuell: C# nimmt `callvirt` trotzdem, weil die Instruktion vorher prüft, ob `this` null ist, und dann eine `NullReferenceException` wirft.',
    },
    {
      codeLine: 11,
      highlight: { il: [8] },
      state: {
        tables: tables({
          active: 'il-d',
          local: true,
          value: '5',
          box: false,
          stack: [ref('s-d')],
        }),
      },
      changed: ['s-d'],
      explanation: 'Für `c.Value` muss der Verweis wieder auf den Stack.',
    },
    {
      codeLine: 11,
      highlight: { il: [9] },
      state: {
        tables: tables({
          active: 'il-e',
          local: true,
          value: '5',
          box: false,
          stack: [['s-e', '5', 'int32']],
        }),
      },
      changed: ['s-e'],
      explanation:
        '`ldfld` nimmt den Verweis vom Stack und legt den Inhalt des Felds ab. Welches Feld, steht als Metadaten-Token direkt hinter dem Opcode, nicht auf dem Stack.',
    },
    {
      codeLine: 11,
      highlight: { il: [10] },
      state: {
        tables: tables({
          active: 'il-13',
          local: true,
          value: '5',
          box: true,
          stack: [['s-f', BOX, 'O (Verweis)', 'h-box']],
        }),
      },
      changed: ['h-box', 's-f'],
      explanation:
        'Die Methode gibt `object` zurück, aber auf dem Stack liegt ein `int32`. `box` legt deshalb ein neues Objekt auf dem Heap an, kopiert die 5 hinein und ersetzt den Wert auf dem Stack durch den Verweis.',
    },
    {
      codeLine: 12,
      highlight: { il: [11] },
      state: {
        tables: tables({ active: 'il-18', local: true, value: '5', box: true, stack: [] }),
        facts: [{ id: 'f-ret', label: 'Rückgabewert', value: `${BOX} (Box mit 5)` }],
      },
      changed: ['f-ret'],
      explanation:
        '`ret` gibt den Verweis auf die Box zurück. Das `Counter`-Objekt ist danach von nirgends mehr erreichbar, der nächste GC darf es einsammeln. Die Box lebt beim Aufrufer weiter.',
    },
  ],
});
