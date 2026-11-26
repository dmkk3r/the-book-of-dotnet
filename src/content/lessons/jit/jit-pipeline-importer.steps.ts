import { defineStepScript, type TableState } from '@/components/viz';

// How the importer turns IL into trees by simulating the evaluation stack with tree nodes
// (ryujit-overview.md, sections "Importation" and "Example of Post-Import IR").
// TODO(verify): That each inline candidate call is appended as its own statement and a GT_RET_EXPR
// placeholder is pushed on the importer stack (importercalls.cpp, impImportCall and the inline
// candidate path). Node names simplified (LCL_VAR, CALL, RET_EXPR, ADD, RETURN as in JitDump).
// TODO(verify): Exact Release IL of SumSquares in SharpLab (offsets).

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

const IL: [string, string, string][] = [
  ['il-0', 'IL_0000', 'ldarg.0'],
  ['il-1', 'IL_0001', 'call Square'],
  ['il-6', 'IL_0006', 'ldarg.1'],
  ['il-7', 'IL_0007', 'call Square'],
  ['il-c', 'IL_000c', 'add'],
  ['il-d', 'IL_000d', 'ret'],
];

/** Stack entry: id, tree text, optional statement ids the entry refers to. */
type Entry = [string, string, string[]?];
/** Statement: id, number, tree text, optional status. */
type Stmt = [string, string, string, Status?];

interface Look {
  active?: string;
  done?: string[];
  /** Stack entries, top first. */
  stack: Entry[];
  stmts: Stmt[];
  /** IL row whose result is the top stack entry (arrow). */
  pushes?: boolean;
}

function tables({ active, done = [], stack, stmts, pushes = false }: Look): Table[] {
  const status = (id: string): Status | undefined =>
    id === active ? 'active' : done.includes(id) ? 'match' : undefined;
  const ilRows: Row[] = IL.map(([id, offset, instr]) => {
    const s = status(id);
    const top = stack[0];
    return {
      id,
      cells: [offset, instr],
      ...(s ? { status: s } : {}),
      ...(pushes && id === active && top ? { refs: [{ col: 1, to: top[0] }] } : {}),
    };
  });
  const stackRows: Row[] =
    stack.length === 0
      ? [{ id: 'st-empty', cells: ['', 'leer'], status: 'dim' }]
      : stack.map(([id, tree, targets], i) => ({
          id,
          cells: [i === 0 ? 'oben' : 'darunter', tree],
          ...(targets && targets.length > 0 ? { refs: targets.map((to) => ({ col: 1, to })) } : {}),
        }));
  const stmtRows: Row[] =
    stmts.length === 0
      ? [{ id: 'stmt-empty', cells: ['', 'noch keine'], status: 'dim' }]
      : stmts.map(([id, nr, tree, s]) => ({ id, cells: [nr, tree], ...(s ? { status: s } : {}) }));
  return [
    {
      id: 't-il',
      title: 'IL von SumSquares',
      columns: ['Offset', 'Instruktion'],
      row: 1,
      col: 1,
      rows: ilRows,
    },
    {
      id: 't-stack',
      title: 'Stack des Importers',
      columns: ['Position', 'Baum'],
      row: 1,
      col: 2,
      rows: stackRows,
      note: 'Einträge sind Baumknoten, keine Werte',
    },
    {
      id: 't-stmts',
      title: 'Statements im Basisblock',
      columns: ['Nr.', 'Baum'],
      row: 2,
      col: 1,
      rows: stmtRows,
    },
  ];
}

const depth = (look: Look, extra: Fact[] = []): TableState => ({
  tables: tables(look),
  facts: [
    { id: 'f-depth', label: 'Einträge auf dem Stack', value: String(look.stack.length) },
    ...extra,
  ],
});

const V00: Entry = ['st-a', 'LCL_VAR int V00 (a)'];
const RET1: Entry = ['st-r1', 'RET_EXPR (Ergebnis von STMT1)', ['stmt-1']];
const V01: Entry = ['st-b', 'LCL_VAR int V01 (b)'];
const RET2: Entry = ['st-r2', 'RET_EXPR (Ergebnis von STMT2)', ['stmt-2']];
const S1: Stmt = ['stmt-1', 'STMT1', 'CALL int Square(LCL_VAR V00), Inline-Kandidat'];
const S2: Stmt = ['stmt-2', 'STMT2', 'CALL int Square(LCL_VAR V01), Inline-Kandidat'];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Der Importer baut Bäume aus IL',
  code: {
    cs: `static int SumSquares(int a, int b)
    => Square(a) + Square(b);

static int Square(int x) => x * x;`,
    il: `IL_0000: ldarg.0
IL_0001: call int32 C::Square(int32)
IL_0006: ldarg.1
IL_0007: call int32 C::Square(int32)
IL_000c: add
IL_000d: ret`,
  },
  steps: [
    {
      codeLine: 1,
      state: depth({ stack: [], stmts: [] }),
      explanation:
        'Der Importer liest das IL genau einmal von vorn nach hinten. Er führt dabei einen eigenen Stack, so wie ihn das IL beschreibt. Der Unterschied: Auf diesem Stack liegen keine Zahlen, sondern **Baumknoten**, die beschreiben, wie ein Wert entsteht.',
    },
    {
      codeLine: 2,
      highlight: { il: [1] },
      state: depth({ active: 'il-0', stack: [V00], stmts: [], pushes: true }),
      changed: ['il-0', 'st-a'],
      explanation:
        '`ldarg.0` lädt nichts. Der Importer legt einen Knoten `LCL_VAR V00` auf seinen Stack, also „der Wert von Argument 0“. Ob dieser Wert später in einem Register oder im Speicher liegt, ist hier noch völlig offen.',
    },
    {
      codeLine: 2,
      highlight: { il: [2] },
      state: depth({
        active: 'il-1',
        done: ['il-0'],
        stack: [RET1],
        stmts: [S1],
      }),
      changed: ['il-1', 'st-r1', 'stmt-1'],
      explanation:
        '`call` nimmt das Argument vom Stack und baut einen `CALL`-Knoten. Weil `Square` ein Inline-Kandidat ist, hängt der Importer den Aufruf als eigenes Statement an und legt nur einen Platzhalter `RET_EXPR` auf den Stack. Der Platzhalter verweist auf das Ergebnis dieses Aufrufs.',
    },
    {
      codeLine: 2,
      highlight: { il: [3] },
      state: depth({
        active: 'il-6',
        done: ['il-0', 'il-1'],
        stack: [V01, RET1],
        stmts: [S1],
        pushes: true,
      }),
      changed: ['il-6', 'st-b'],
      explanation:
        '`ldarg.1` legt den Knoten für `b` oben auf. Darunter wartet noch der Platzhalter des ersten Aufrufs. Genau wie im IL-Modell gilt: Die Reihenfolge auf dem Stack bestimmt, welcher Operand links und welcher rechts landet.',
    },
    {
      codeLine: 2,
      highlight: { il: [4] },
      state: depth({
        active: 'il-7',
        done: ['il-0', 'il-1', 'il-6'],
        stack: [RET2, RET1],
        stmts: [S1, S2],
      }),
      changed: ['il-7', 'st-r2', 'stmt-2'],
      explanation:
        'Der zweite Aufruf läuft genauso: Statement `STMT2` mit dem `CALL`, ein zweiter Platzhalter auf dem Stack. Die Statements halten die Reihenfolge der Seiteneffekte fest: Erst `Square(a)`, dann `Square(b)`, so wie es C# verlangt.',
    },
    {
      codeLine: 2,
      highlight: { il: [5] },
      state: depth({
        active: 'il-c',
        done: ['il-0', 'il-1', 'il-6', 'il-7'],
        stack: [['st-add', 'ADD(RET_EXPR STMT1, RET_EXPR STMT2)', ['stmt-1', 'stmt-2']]],
        stmts: [S1, S2],
        pushes: true,
      }),
      changed: ['il-c', 'st-add'],
      explanation:
        '`add` nimmt die beiden obersten Knoten und hängt sie unter einen neuen `ADD`-Knoten. Aus zwei Stack-Einträgen wird ein Baum. So wächst der Ausdruck, ohne dass irgendetwas berechnet wird.',
    },
    {
      codeLine: 2,
      highlight: { il: [6] },
      state: depth(
        {
          active: 'il-d',
          done: ['il-0', 'il-1', 'il-6', 'il-7', 'il-c'],
          stack: [],
          stmts: [S1, S2, ['stmt-3', 'STMT3', 'RETURN(ADD(RET_EXPR STMT1, RET_EXPR STMT2))']],
        },
        [{ id: 'f-left', label: 'Evaluation Stack im Maschinencode', value: 'gibt es nicht' }],
      ),
      changed: ['il-d', 'st-empty', 'stmt-3', 'f-left'],
      explanation:
        '`ret` macht aus dem letzten Baum das Statement `RETURN`, der Stack ist leer. Häufige Fehlannahme: Der Evaluation Stack lebe im Maschinencode weiter. Nach dem Import gibt es ihn nicht mehr, nur noch drei Statements mit Bäumen.',
    },
    {
      codeLine: 4,
      state: depth(
        {
          done: ['il-0', 'il-1', 'il-6', 'il-7', 'il-c', 'il-d'],
          stack: [],
          stmts: [
            ['stmt-1', 'STMT1', 'entfernt, Aufruf eingesetzt', 'dim'],
            ['stmt-2', 'STMT2', 'entfernt, Aufruf eingesetzt', 'dim'],
            ['stmt-3', 'STMT3', 'RETURN(ADD(MUL(V00, V00), MUL(V01, V01)))', 'match'],
          ],
        },
        [{ id: 'f-inline', label: 'Inlining', value: '2 Aufrufe eingesetzt' }],
      ),
      changed: ['stmt-1', 'stmt-2', 'stmt-3', 'f-inline'],
      explanation:
        'Nach dem Import kommt der Inliner. Er übersetzt `Square` mit einem eigenen Importer und ersetzt jeden Platzhalter durch den Baum `MUL(x, x)` mit dem passenden Argument. Die Aufruf-Statements fallen weg, übrig bleibt ein einziger Baum.',
    },
  ],
});
