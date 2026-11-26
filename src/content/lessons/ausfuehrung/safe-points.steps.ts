import { defineStepScript, type TableState } from '@/components/viz';

// GC info of a small partially interruptible method, shown as a table: which call sites are
// safe points and which registers hold live object references there.
// Model after the GC info encoding layout in src/coreclr/inc/gcinfoencoder.h (call site offsets,
// slot table, GC state at call sites; fully interruptible ranges with transitions) and
// docs/design/coreclr/botr/clr-abi.md.
// TODO(verify): The assembly listing, offsets, register assignment (order in rbx, sb in rsi) and
// the direct `call rel32` form are illustrative for Windows x64, not taken from a real JitDisasm.
// Real code calls through indirection cells and may differ in every detail.
// TODO(verify): That the encoder records call sites at the offset of the return address
// (instruction after the call) on x64.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[];
  fully?: boolean;
}

function tables({ status = {}, follow = [], fully = false }: Look): Table[] {
  const row = (id: string, cells: string[], refs?: { col: number; to: string }[]): Row => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(refs && follow.includes(id) ? { refs } : {}),
  });
  const code: Table = {
    id: 't-code',
    title: 'Maschinencode von Describe',
    columns: ['Offset', 'Befehl', 'Safe Point'],
    row: 1,
    col: 1,
    rows: [
      row('c-06', ['0x06', 'mov rbx, rcx', fully ? 'ja' : 'nein']),
      row('c-13', ['0x13', 'call NEWSFAST', fully ? 'ja' : '0x18'], [{ col: 2, to: 'g-18' }]),
      row('c-1e', ['0x1E', 'call .ctor', fully ? 'ja' : '0x23'], [{ col: 2, to: 'g-23' }]),
      row('c-27', ['0x27', 'mov rcx, rsi', fully ? 'ja' : 'nein']),
      row('c-2a', ['0x2A', 'call Append', fully ? 'ja' : '0x2F'], [{ col: 2, to: 'g-2f' }]),
      row('c-2f', ['0x2F', 'mov edx, [rbx+10h]', fully ? 'ja' : 'nein']),
      row('c-35', ['0x35', 'call Append', fully ? 'ja' : '0x3A'], [{ col: 2, to: 'g-3a' }]),
      row('c-3d', ['0x3D', 'call ToString', fully ? 'ja' : '0x42'], [{ col: 2, to: 'g-42' }]),
    ],
  };
  const gcinfo: Table = fully
    ? {
        id: 't-ranges',
        title: 'GC-Info: Lebensbereiche',
        columns: ['Ort', 'Verweis', 'von bis'],
        row: 1,
        col: 2,
        rows: [
          row('r-rcx', ['rcx', 'order', '0x00 bis 0x09']),
          row('r-rbx', ['rbx', 'order', '0x09 bis 0x32']),
          row('r-rax', ['rax', 'sb', '0x18 bis 0x1B']),
          row('r-rsi', ['rsi', 'sb', '0x1B bis 0x3D']),
          row('r-text', ['rax', 'text', '0x42 bis 0x45']),
        ],
        note: 'Bereiche halb offen: Ende gehört nicht dazu',
      }
    : {
        id: 't-gc',
        title: 'GC-Info: Safe Points',
        columns: ['Offset', 'Lebende Verweise'],
        row: 1,
        col: 2,
        rows: [
          row('g-18', ['0x18', 'rbx (order)']),
          row('g-23', ['0x23', 'rbx (order), rsi (sb)']),
          row('g-2f', ['0x2F', 'rbx (order), rsi (sb)']),
          row('g-3a', ['0x3A', 'rsi (sb)']),
          row('g-42', ['0x42', 'keine']),
        ],
        note: 'Offset = Rücksprungadresse des Aufrufs',
      };
  return [code, gcinfo];
}

const kind = (value: string) => fact('f-kind', 'Art', value);

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Die GC-Info einer Methode als Tabelle',
  code: {
    cs: `static int Describe(Order order)
{
    var sb = new StringBuilder();
    sb.Append(order.Customer);
    sb.Append(order.Total);
    string text = sb.ToString();
    return text.Length;
}`,
    asm: `; Describe(Order):int  (Tier 1, partially interruptible)
00  push rsi
01  push rbx
02  sub  rsp, 40
06  mov  rbx, rcx                      ; order: rcx -> rbx
09  mov  rcx, 0x7FF8A1C2B5E0           ; MethodTable StringBuilder
13  call CORINFO_HELP_NEWSFAST
18  mov  rsi, rax                      ; sb -> rsi
1B  mov  rcx, rsi
1E  call StringBuilder:.ctor():this
23  mov  rdx, gword ptr [rbx+08h]      ; order.Customer
27  mov  rcx, rsi
2A  call StringBuilder:Append(string):this
2F  mov  edx, dword ptr [rbx+10h]      ; order.Total
32  mov  rcx, rsi
35  call StringBuilder:Append(int):this
3A  mov  rcx, rsi
3D  call StringBuilder:ToString():this
42  mov  eax, dword ptr [rax+08h]      ; text.Length
45  add  rsp, 40
49  pop  rbx
4A  pop  rsi
4B  ret`,
  },
  steps: [
    {
      state: {
        tables: tables({}),
        facts: [kind('partially interruptible'), fact('f-sp', 'Safe Points', '5 Aufrufstellen')],
      },
      explanation:
        'Links ein Ausschnitt aus dem Maschinencode, rechts die GC-Info, die der JIT dazu ablegt. Die Methode hat keine Schleife, also ist sie **partially interruptible**: Nur an den fünf Aufrufstellen darf der GC sie anhalten. Für genau diese Stellen steht in der GC-Info, wo Verweise leben.',
    },
    {
      codeLine: 1,
      highlight: { asm: [5] },
      state: {
        tables: tables({ status: { 'c-06': 'active' } }),
        facts: [
          kind('partially interruptible'),
          fact('f-here', 'Hier anhaltbar', 'nein'),
          fact('f-live', 'Verweise gerade', 'rcx, rbx (order)'),
        ],
      },
      changed: ['c-06', 'f-here', 'f-live'],
      explanation:
        '`order` kommt im Argumentregister `rcx` an und wird nach `rbx` kopiert. Über diese Stelle sagt die GC-Info nichts. Ein Thread, der gerade hier steht, ist für den GC nicht auswertbar und muss erst bis zum nächsten Safe Point weiterlaufen.',
    },
    {
      codeLine: 3,
      highlight: { asm: [7, 8] },
      state: {
        tables: tables({ status: { 'c-13': 'active', 'g-18': 'match' }, follow: ['c-13'] }),
        facts: [kind('partially interruptible'), fact('f-live', 'Lebend über den Aufruf', 'order')],
      },
      changed: ['c-13', 'g-18', 'f-live'],
      explanation:
        'Der Allokations-Helfer kann selbst eine GC auslösen. Der Safe Point liegt an der Rücksprungadresse 0x18: Dort ist nur `order` in `rbx` lebendig. Über einen Aufruf hinweg können Verweise nur in Registern überleben, die der Aufgerufene erhalten muss (hier `rbx` und `rsi`), oder in Stack-Slots.',
    },
    {
      codeLine: 3,
      highlight: { asm: [9, 10, 11] },
      state: {
        tables: tables({ status: { 'c-1e': 'active', 'g-23': 'match' }, follow: ['c-1e'] }),
        facts: [
          kind('partially interruptible'),
          fact('f-live', 'Lebend über den Aufruf', 'order, sb'),
        ],
      },
      changed: ['c-1e', 'g-23', 'f-live'],
      explanation:
        'Das neue Objekt liegt jetzt in `rsi`. Am Safe Point nach dem Konstruktor meldet die GC-Info zwei Verweise. Verschiebt der GC dort den `StringBuilder`, schreibt er die neue Adresse direkt in den gespeicherten Wert von `rsi`.',
    },
    {
      codeLine: 4,
      highlight: { asm: [12, 13, 14] },
      state: {
        tables: tables({ status: { 'c-2a': 'active', 'g-2f': 'match' }, follow: ['c-2a'] }),
        facts: [
          kind('partially interruptible'),
          fact('f-live', 'Lebend über den Aufruf', 'order, sb'),
        ],
      },
      changed: ['c-2a', 'g-2f', 'f-live'],
      explanation:
        'Nach `Append(string)` wird `order` noch einmal gebraucht, für `order.Total`. Also bleibt es an diesem Safe Point gemeldet.',
    },
    {
      codeLine: 5,
      highlight: { asm: [15, 16, 17] },
      state: {
        tables: tables({ status: { 'c-35': 'active', 'g-3a': 'match' }, follow: ['c-35'] }),
        facts: [kind('partially interruptible'), fact('f-live', 'Lebend über den Aufruf', 'sb')],
      },
      changed: ['c-35', 'g-3a', 'f-live'],
      explanation:
        'Hier liegt die häufigste Fehlannahme: `order` ist noch „im Gültigkeitsbereich“, aber seine letzte Verwendung war bei 0x2F. Am Safe Point 0x3A meldet die GC-Info nur noch `sb`. Hält sonst niemand das `Order`-Objekt, darf der GC es einsammeln, während `Describe` noch läuft.',
    },
    {
      codeLine: 6,
      highlight: { asm: [18, 19, 20] },
      state: {
        tables: tables({ status: { 'c-3d': 'active', 'g-42': 'match' }, follow: ['c-3d'] }),
        facts: [kind('partially interruptible'), fact('f-live', 'Lebend über den Aufruf', 'keine')],
      },
      changed: ['c-3d', 'g-42', 'f-live'],
      explanation:
        'Nach `ToString` braucht `Describe` weder `sb` noch `order`. Solange `ToString` läuft, hält es `sb` über seine eigene GC-Info als `this` fest. Das Ergebnis in `rax` entsteht erst beim Rücksprung und braucht an dieser Stelle keinen Eintrag.',
    },
    {
      codeLine: 4,
      highlight: { asm: [13] },
      state: {
        tables: tables({ status: { 'c-27': 'miss' } }),
        facts: [
          kind('partially interruptible'),
          fact('f-here', 'Thread steht bei', '0x27'),
          fact('f-ok', 'Auswertbar', 'nein'),
        ],
      },
      changed: ['c-27', 'f-here', 'f-ok'],
      explanation:
        'Angenommen, der GC will den Thread anhalten, während er bei 0x27 steht. Für diesen Offset gibt es keinen Eintrag, die Runtime weiß nicht sicher, welche Register gerade Verweise enthalten. Sie muss den Thread zu einem Safe Point bringen: Wie das geht, zeigt die Lektion „Wie Threads für den GC angehalten werden“.',
    },
    {
      codeLine: 4,
      highlight: { asm: [13] },
      state: {
        tables: tables({
          fully: true,
          status: { 'c-27': 'active', 'r-rbx': 'match', 'r-rsi': 'match' },
        }),
        facts: [kind('fully interruptible'), fact('f-here', 'Thread steht bei', '0x27')],
      },
      changed: ['t-ranges', 'f-kind', 'c-27'],
      explanation:
        'Wäre die Methode **fully interruptible**, sähe die GC-Info anders aus: Für jeden Verweis steht ein Bereich von Offsets, in dem er lebt, auch in flüchtigen Registern wie `rcx` und `rax`. Dann ist jede Stelle auswertbar: Bei 0x27 leben `order` in `rbx` und `sb` in `rsi`. Der Preis ist deutlich mehr GC-Info.',
    },
  ],
});
