import { defineStepScript, type TableState } from '@/components/viz';

// The same method compiled by Roslyn in Debug and in Release configuration.
// TODO(verify): Both listings in SharpLab (Debug and Release switch): nop at the opening brace,
// cgt/stloc.1/ldloc.1/brfalse.s for the condition in Debug, ble.s in Release, the return local
// V_2 with br.s in Debug, offsets and the .locals lines.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

/** [id, offset, instruction, equivalent Release row] */
const DEBUG: [string, string, string, string?][] = [
  ['d-0', 'IL_0000', 'nop'],
  ['d-1', 'IL_0001', 'ldarg.0', 'r-0'],
  ['d-2', 'IL_0002', 'ldarg.1', 'r-1'],
  ['d-3', 'IL_0003', 'mul', 'r-2'],
  ['d-4', 'IL_0004', 'stloc.0', 'r-3'],
  ['d-5', 'IL_0005', 'ldloc.0', 'r-4'],
  ['d-6', 'IL_0006', 'ldc.i4.s 100', 'r-5'],
  ['d-8', 'IL_0008', 'cgt'],
  ['d-a', 'IL_000a', 'stloc.1'],
  ['d-b', 'IL_000b', 'ldloc.1'],
  ['d-c', 'IL_000c', 'brfalse.s IL_0011', 'r-7'],
  ['d-e', 'IL_000e', 'ldc.i4.s 100', 'r-9'],
  ['d-10', 'IL_0010', 'stloc.0', 'r-b'],
  ['d-11', 'IL_0011', 'ldloc.0', 'r-c'],
  ['d-12', 'IL_0012', 'stloc.2'],
  ['d-13', 'IL_0013', 'br.s IL_0015'],
  ['d-15', 'IL_0015', 'ldloc.2'],
  ['d-16', 'IL_0016', 'ret', 'r-d'],
];

const RELEASE: [string, string, string][] = [
  ['r-0', 'IL_0000', 'ldarg.0'],
  ['r-1', 'IL_0001', 'ldarg.1'],
  ['r-2', 'IL_0002', 'mul'],
  ['r-3', 'IL_0003', 'stloc.0'],
  ['r-4', 'IL_0004', 'ldloc.0'],
  ['r-5', 'IL_0005', 'ldc.i4.s 100'],
  ['r-7', 'IL_0007', 'ble.s IL_000c'],
  ['r-9', 'IL_0009', 'ldc.i4.s 100'],
  ['r-b', 'IL_000b', 'stloc.0'],
  ['r-c', 'IL_000c', 'ldloc.0'],
  ['r-d', 'IL_000d', 'ret'],
];

interface Look {
  status?: Partial<Record<string, Status>>;
  /** Debug rows whose reference to the Release equivalent is drawn. */
  follow?: string[];
}

function tables({ status = {}, follow = [] }: Look): Table[] {
  const row = (id: string, cells: string[], to?: string): Row => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(to && follow.includes(id) ? { refs: [{ col: 1, to }] } : {}),
  });
  return [
    {
      id: 't-debug',
      title: 'Debug',
      columns: ['Offset', 'Instruktion'],
      row: 1,
      col: 1,
      rows: DEBUG.map(([id, off, instr, to]) => row(id, [off, instr], to)),
    },
    {
      id: 't-release',
      title: 'Release',
      columns: ['Offset', 'Instruktion'],
      row: 1,
      col: 2,
      rows: RELEASE.map(([id, off, instr]) => row(id, [off, instr])),
    },
  ];
}

const mark = (ids: string[], s: Status) => Object.fromEntries(ids.map((id) => [id, s]));

const countFacts: Fact[] = [
  { id: 'f-dbg', label: 'Debug', value: '18 Instruktionen, 23 Byte IL' },
  { id: 'f-rel', label: 'Release', value: '11 Instruktionen, 14 Byte IL' },
];

const localsFacts: Fact[] = [
  { id: 'f-dbg-loc', label: 'Debug', value: '.locals init (int32 V_0, bool V_1, int32 V_2)' },
  { id: 'f-rel-loc', label: 'Release', value: '.locals init (int32 V_0)' },
  { id: 'f-jit', label: 'JIT', value: 'Debug-Assembly: Optimierungen aus' },
];

const core = ['d-1', 'd-2', 'd-3', 'd-4'];
const cond = ['d-5', 'd-6', 'd-8', 'd-a', 'd-b', 'd-c'];
const tail = ['d-11', 'd-12', 'd-13', 'd-15', 'd-16'];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Dieselbe Methode in Debug und Release',
  code: {
    cs: `static int Scale(int amount, int factor)
{
    int result = amount * factor;
    if (result > 100)
        result = 100;
    return result;
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: { tables: tables({}), facts: countFacts },
      explanation:
        'Links das IL eines Debug-Builds, rechts das eines Release-Builds, beides vom selben C#-Compiler für dieselbe Methode. Die Debug-Fassung ist deutlich länger. Wo der Unterschied herkommt, zeigen die nächsten Schritte.',
    },
    {
      codeLine: 3,
      state: {
        tables: tables({
          status: { ...mark(core, 'match'), ...mark(['r-0', 'r-1', 'r-2', 'r-3'], 'match') },
          follow: core,
        }),
        facts: countFacts,
      },
      changed: [...core, 'r-0', 'r-1', 'r-2', 'r-3'],
      explanation:
        'Die eigentliche Rechnung ist in beiden Fassungen identisch: zwei Argumente laden, multiplizieren, in Local 0 speichern. Der C#-Compiler optimiert wenig, die großen Optimierungen macht später der JIT.',
    },
    {
      codeLine: 2,
      state: {
        tables: tables({ status: { 'd-0': 'active' } }),
        facts: countFacts,
      },
      changed: ['d-0'],
      explanation:
        '`nop` tut nichts. Im Debug-Build setzt der Compiler es an Stellen wie die öffnende Klammer, damit der Debugger dort einen Haltepunkt setzen kann, der zu einer eigenen IL-Position gehört.',
    },
    {
      codeLine: 4,
      state: {
        tables: tables({
          status: { ...mark(cond, 'active'), ...mark(['r-4', 'r-5', 'r-7'], 'active') },
          follow: ['d-5', 'd-6', 'd-c'],
        }),
        facts: countFacts,
      },
      changed: [...cond, 'r-4', 'r-5', 'r-7'],
      explanation:
        'Debug berechnet die Bedingung mit `cgt` als eigenen Wert (0 oder 1), speichert ihn in einem zusätzlichen `bool`-Local `V_1` und verzweigt dann mit `brfalse.s`. Release verschmilzt Vergleich und Sprung zu einem einzigen `ble.s`.',
    },
    {
      codeLine: 6,
      state: {
        tables: tables({
          status: { ...mark(tail, 'active'), ...mark(['r-c', 'r-d'], 'active') },
          follow: ['d-11', 'd-16'],
        }),
        facts: countFacts,
      },
      changed: [...tail, 'r-c', 'r-d'],
      explanation:
        'Debug legt den Rückgabewert in einem weiteren Local `V_2` ab und springt mit `br.s` zu einem gemeinsamen `ret`. Der Sprung führt zur direkt folgenden Instruktion, er existiert nur, damit die schließende Klammer eine eigene Position für einen Haltepunkt bekommt.',
    },
    {
      codeLine: 7,
      state: { tables: tables({}), facts: localsFacts },
      changed: ['f-dbg-loc', 'f-rel-loc', 'f-jit'],
      explanation:
        'Unterm Strich hat Debug zwei Locals mehr. Wichtiger ist eine Eigenschaft der Assembly: Ein Debug-Build markiert sie über `DebuggableAttribute` so, dass der JIT nicht optimiert. Debug-IL ist also nicht nur länger, es wird auch schlechter übersetzt.',
    },
  ],
});
