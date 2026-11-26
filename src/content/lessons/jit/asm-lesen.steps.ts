import { defineStepScript, type TableState } from '@/components/viz';

// Line by line through optimized x64 code for an array access (Windows x64 calling convention:
// first argument in rcx, second in rdx, result in rax, 32 byte shadow space reserved by the caller).
// Array layout on 64-bit: MethodTable pointer at +0, Length (int32) at +8, padding, first int
// element at +16 (ryujit-overview.md, Lowering example: LEA(b+(i*4)+16) with Fseq[#FirstElem]).
// Header comment format from codegencommon.cpp (genCodeForBBlist / dumping of the method header).
// TODO(verify): Complete listing for Get(int[], int) with DOTNET_TieredCompilation=0 on .NET 8+
// (sub rsp, 40 because of the helper call, cmp edx, dword ptr [rcx+0x08], jae to a throw block
// with CORINFO_HELP_RNGCHKFAIL, mov eax, edx for zero extension, total size 26 bytes).
// TODO(verify): "AVX2" in the "; Emitting BLENDED_CODE for X64 with ..." line depends on the CPU.
// Addresses are fictitious.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

const ASM_LINES = [
  '; Assembly listing for method C:Get(int[],int):int (FullOpts)',
  '; Emitting BLENDED_CODE for X64 with AVX2 - Windows',
  '; FullOpts code',
  '; optimized code',
  '; rsp based frame',
  '; partially interruptible',
  '',
  'G_M000_IG01:                ;; offset=0x0000',
  '       sub      rsp, 40',
  '',
  'G_M000_IG02:                ;; offset=0x0004',
  '       cmp      edx, dword ptr [rcx+0x08]',
  '       jae      SHORT G_M000_IG04',
  '       mov      eax, edx',
  '       mov      eax, dword ptr [rcx+4*rax+0x10]',
  '',
  'G_M000_IG03:                ;; offset=0x000F',
  '       add      rsp, 40',
  '       ret',
  '',
  'G_M000_IG04:                ;; offset=0x0014',
  '       call     CORINFO_HELP_RNGCHKFAIL',
  '       int3',
  '',
  '; Total bytes of code 26',
];
const L = (needle: string) => ASM_LINES.findIndex((l) => l.includes(needle)) + 1;

/** asm rows: id, block, instruction, meaning. */
const ASM: [string, string, string, string][] = [
  ['a-sub', 'IG01', 'sub rsp, 40', 'Prolog: Platz im Stack reservieren'],
  ['a-cmp', 'IG02', 'cmp edx, dword ptr [rcx+0x08]', 'i mit a.Length vergleichen'],
  ['a-jae', 'IG02', 'jae SHORT G_M000_IG04', 'bei i ≥ Length (vorzeichenlos) zum Fehler'],
  ['a-mov1', 'IG02', 'mov eax, edx', 'i auf 64 Bit erweitern'],
  ['a-mov2', 'IG02', 'mov eax, dword ptr [rcx+4*rax+0x10]', 'a[i] laden'],
  ['a-add', 'IG03', 'add rsp, 40', 'Epilog: Platz freigeben'],
  ['a-ret', 'IG03', 'ret', 'zurück, Ergebnis in eax'],
  ['a-call', 'IG04', 'call CORINFO_HELP_RNGCHKFAIL', 'IndexOutOfRangeException werfen'],
  ['a-int3', 'IG04', 'int3', 'wird nie erreicht'],
];

interface Regs {
  rcx: string;
  rdx: string;
  rax: string;
  rsp: string;
}

interface Look {
  active?: string;
  done?: string[];
  skipped?: string[];
  regs: Regs;
  /** asm row → register or memory row (arrow from the instruction). */
  refs?: { from: string; to: string }[];
  /** memory row read in this step */
  read?: string;
  array?: 'normal' | 'null';
}

function tables(look: Look): Table[] {
  const { active, done = [], skipped = [], regs, refs = [], read, array = 'normal' } = look;
  const status = (id: string): Status | undefined =>
    id === active
      ? 'active'
      : done.includes(id)
        ? 'match'
        : skipped.includes(id)
          ? 'dim'
          : undefined;
  const asmRows: Row[] = ASM.map(([id, block, instr, meaning]) => {
    const s = status(id);
    const r = refs.filter((x) => x.from === id).map((x) => ({ col: 1, to: x.to }));
    return {
      id,
      cells: [block, instr, meaning],
      ...(s ? { status: s } : {}),
      ...(r.length > 0 ? { refs: r } : {}),
    };
  });
  const regRows: Row[] = [
    { id: 'r-rcx', cells: ['rcx', regs.rcx, 'Argument 1: a'] },
    { id: 'r-rdx', cells: ['rdx', regs.rdx, 'Argument 2: i'] },
    { id: 'r-rax', cells: ['rax', regs.rax, 'Rückgabewert'] },
    { id: 'r-rsp', cells: ['rsp', regs.rsp, 'Stackzeiger'] },
  ];
  const memRows: Row[] =
    array === 'null'
      ? [
          {
            id: 'm-null',
            cells: ['0x0000_0000_0008', 'nicht lesbar', 'Seite 0 ist gesperrt'],
            status: 'miss',
          },
        ]
      : [
          ['m-mt', '0x0000_7F10_2000', '0x7FF8_0001_1A20', 'MethodTable von int[]'],
          ['m-len', '0x0000_7F10_2008', '4', 'Length'],
          ['m-pad', '0x0000_7F10_200C', '(Padding)', ''],
          ['m-0', '0x0000_7F10_2010', '10', 'a[0]'],
          ['m-1', '0x0000_7F10_2014', '20', 'a[1]'],
          ['m-2', '0x0000_7F10_2018', '30', 'a[2]'],
          ['m-3', '0x0000_7F10_201C', '40', 'a[3]'],
        ].map(([id, addr, value, meaning]) => ({
          id: id!,
          cells: [addr!, value!, meaning!],
          ...(id === read
            ? { status: 'active' as Status }
            : id === 'm-pad'
              ? { status: 'dim' as Status }
              : {}),
        }));
  return [
    {
      id: 't-asm',
      title: 'Maschinencode von Get',
      columns: ['Block', 'Instruktion', 'Bedeutung'],
      row: 1,
      col: 1,
      rows: asmRows,
    },
    {
      id: 't-reg',
      title: 'Register',
      columns: ['Register', 'Inhalt', 'Rolle'],
      row: 2,
      col: 1,
      rows: regRows,
    },
    {
      id: 't-mem',
      title: array === 'null' ? 'Speicher bei a = null' : 'Array-Objekt a im Heap',
      columns: ['Adresse', 'Inhalt', 'Bedeutung'],
      row: 3,
      col: 1,
      rows: memRows,
      ...(array === 'null' ? {} : { note: 'Der Objektheader liegt 8 Byte vor der Adresse in rcx' }),
    },
  ];
}

const ARRAY = '0x0000_7F10_2000';
const ENTRY_RSP = '0x0000_00A1_FF48';
const FRAME_RSP = '0x0000_00A1_FF20';
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });
const state = (look: Look, facts: Fact[] = []): TableState => ({ tables: tables(look), facts });

const all = (until: string) =>
  ASM.map((r) => r[0]).slice(
    0,
    ASM.findIndex((r) => r[0] === until),
  );

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Get(a, 2) Zeile für Zeile in x64',
  code: {
    cs: `[MethodImpl(MethodImplOptions.NoInlining)]
static int Get(int[] a, int i) => a[i];

int[] data = { 10, 20, 30, 40 };
int x = Get(data, 2);   // 30`,
    asm: ASM_LINES.join('\n'),
  },
  steps: [
    {
      codeLine: 2,
      highlight: { asm: [1, 2, 3, 4, 5, 6] },
      state: state(
        { regs: { rcx: 'beliebig', rdx: 'beliebig', rax: 'beliebig', rsp: 'beliebig' } },
        [
          fact('f-tier', 'Stufe', 'FullOpts (Tiering aus)'),
          fact('f-frame', 'Frame', 'über rsp, ohne rbp'),
        ],
      ),
      changed: ['f-tier', 'f-frame'],
      explanation:
        'Bevor du eine einzige Instruktion liest, lies den Kopf. Er nennt die Methode, die **Stufe** (hier `FullOpts`, also voll optimiert ohne Tiering), den Befehlssatz und die Art des Frames. Ein Listing ohne diese Angaben ist wertlos, weil du nicht weißt, welchen Code du vor dir hast.',
    },
    {
      codeLine: 5,
      state: state(
        { regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: 'beliebig', rsp: ENTRY_RSP } },
        [fact('f-conv', 'Aufrufkonvention', 'Windows x64: rcx, rdx, r8, r9')],
      ),
      changed: ['r-rcx', 'r-rdx', 'r-rsp', 'f-conv'],
      explanation:
        'Beim Einsprung liegen die Argumente dort, wo die Aufrufkonvention sie hinlegt: Unter Windows x64 kommt `a` in `rcx`, `i` in `rdx`. Der Verweis auf das Array ist nur eine Adresse. Unter Linux und macOS wären es `rdi` und `rsi`.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('sub      rsp')] },
      state: state(
        {
          active: 'a-sub',
          regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: 'beliebig', rsp: FRAME_RSP },
          refs: [{ from: 'a-sub', to: 'r-rsp' }],
        },
        [fact('f-conv', 'Aufrufkonvention', 'Windows x64: rcx, rdx, r8, r9')],
      ),
      changed: ['a-sub', 'r-rsp'],
      explanation:
        'Der Prolog verschiebt den Stackzeiger um 40 Byte. Die Methode enthält einen Aufruf (zum Fehler-Helfer), und Windows x64 verlangt vor jedem Aufruf 32 Byte Schattenbereich und einen auf 16 Byte ausgerichteten Stack. Ein `push rbp` gibt es nicht, der Frame wird nur über `rsp` adressiert.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('cmp')] },
      state: state(
        {
          active: 'a-cmp',
          done: all('a-cmp'),
          regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: 'beliebig', rsp: FRAME_RSP },
          refs: [
            { from: 'a-cmp', to: 'm-len' },
            { from: 'a-cmp', to: 'r-rdx' },
          ],
          read: 'm-len',
        },
        [fact('f-check', 'Bounds-Check', '2 gegen Length 4')],
      ),
      changed: ['a-cmp', 'm-len', 'f-check'],
      explanation:
        '`[rcx+0x08]` ist die Länge des Arrays: 8 Byte nach dem Beginn des Objekts, direkt hinter dem MethodTable-Zeiger. `cmp` vergleicht `i` damit und setzt nur Flags. Dieser eine Lesezugriff ist gleichzeitig die **Null-Prüfung**: Wäre `a` null, würde er fehlschlagen.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('jae')] },
      state: state(
        {
          active: 'a-jae',
          done: all('a-jae'),
          regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: 'beliebig', rsp: FRAME_RSP },
          refs: [{ from: 'a-jae', to: 'm-len' }],
        },
        [fact('f-check', 'Bounds-Check', '2 < 4: kein Sprung')],
      ),
      changed: ['a-jae', 'f-check'],
      explanation:
        '`jae` heißt „springe, wenn größer oder gleich“, und zwar **vorzeichenlos**. Ein negativer Index wie -1 ist vorzeichenlos betrachtet riesig, also deckt dieser eine Sprung beide Fehlerfälle ab: zu groß und negativ. Häufige Fehlannahme: Ein Bounds-Check brauche zwei Vergleiche.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('mov      eax, edx')] },
      state: state(
        {
          active: 'a-mov1',
          done: all('a-mov1'),
          regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: '2', rsp: FRAME_RSP },
          refs: [{ from: 'a-mov1', to: 'r-rax' }],
        },
        [fact('f-ext', 'Obere 32 Bit von rax', 'auf 0 gesetzt')],
      ),
      changed: ['a-mov1', 'r-rax', 'f-ext'],
      explanation:
        '`eax` ist die untere Hälfte von `rax`. Ein Schreibzugriff auf ein 32-Bit-Register setzt auf x64 die oberen 32 Bit auf null. So wird aus dem `int` ein sauberer 64-Bit-Index, den die Adressberechnung im nächsten Befehl braucht.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('[rcx+4*rax+0x10]')] },
      state: state(
        {
          active: 'a-mov2',
          done: all('a-mov2'),
          regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: '30', rsp: FRAME_RSP },
          refs: [
            { from: 'a-mov2', to: 'm-2' },
            { from: 'a-mov2', to: 'r-rax' },
          ],
          read: 'm-2',
        },
        [fact('f-addr', 'Adresse', `${ARRAY} + 4 × 2 + 0x10 = 0x0000_7F10_2018`)],
      ),
      changed: ['a-mov2', 'r-rax', 'm-2', 'f-addr'],
      explanation:
        'Die ganze Adressrechnung steckt in einem Operanden: Basis `rcx`, plus Index mal Elementgröße 4, plus 16 Byte bis zum ersten Element. Das Ergebnis 30 landet in `eax`. Diese Form hat das Lowering des JIT als Adressierungsart gebaut.',
    },
    {
      codeLine: 5,
      highlight: { asm: [L('add      rsp'), L('       ret')] },
      state: state(
        {
          active: 'a-ret',
          done: [...all('a-ret')],
          regs: { rcx: `${ARRAY} (a)`, rdx: '2 (i)', rax: '30 (Ergebnis)', rsp: ENTRY_RSP },
          refs: [{ from: 'a-ret', to: 'r-rax' }],
        },
        [fact('f-result', 'Get(data, 2)', '30')],
      ),
      changed: ['a-add', 'a-ret', 'r-rsp', 'r-rax', 'f-result'],
      explanation:
        'Der Epilog gibt die 40 Byte frei, `ret` springt zum Aufrufer zurück. Das Ergebnis steht in `eax`, wo der Aufrufer es nach der Konvention erwartet. Der Block `IG04` wurde nicht berührt.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('call'), L('int3')] },
      state: state(
        {
          active: 'a-call',
          done: ['a-sub', 'a-cmp', 'a-jae'],
          skipped: ['a-mov1', 'a-mov2', 'a-add', 'a-ret'],
          regs: { rcx: `${ARRAY} (a)`, rdx: '7 (i)', rax: 'beliebig', rsp: FRAME_RSP },
          refs: [{ from: 'a-jae', to: 'm-len' }],
        },
        [
          fact('f-check', 'Bounds-Check', '7 ≥ 4: Sprung nach IG04'),
          fact('f-exc', 'Ergebnis', 'IndexOutOfRangeException'),
        ],
      ),
      changed: ['a-call', 'r-rdx', 'f-check', 'f-exc'],
      explanation:
        'Mit `i = 7` springt `jae` in den Block `IG04`. Der Helfer `CORINFO_HELP_RNGCHKFAIL` der Runtime wirft die `IndexOutOfRangeException` und kehrt nie zurück. Das `int3` dahinter markiert nur, dass hier kein Weg weiterführt.',
    },
    {
      codeLine: 2,
      highlight: { asm: [L('cmp')] },
      state: state(
        {
          active: 'a-cmp',
          done: ['a-sub'],
          regs: { rcx: '0 (null)', rdx: '2 (i)', rax: 'beliebig', rsp: FRAME_RSP },
          refs: [{ from: 'a-cmp', to: 'm-null' }],
          array: 'null',
        },
        [fact('f-exc', 'Ergebnis', 'Zugriffsverletzung → NullReferenceException')],
      ),
      changed: ['a-cmp', 'r-rcx', 'm-null', 'f-exc'],
      explanation:
        'Mit `a = null` liest `cmp` von Adresse 8. Diese Seite ist nie gültig, der Prozessor meldet eine Zugriffsverletzung, und die Runtime übersetzt sie in eine `NullReferenceException`. Deshalb steht im Code keine eigene Prüfung auf null.',
    },
  ],
});
