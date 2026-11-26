import { defineStepScript, type TableState } from '@/components/viz';

// The same method as Tier 0 and as Tier 1 code (Windows x64). Header lines follow
// codegencommon.cpp ("; Assembly listing for method ... (Tier0)", "; Tier0 code", "; rbp based frame").
// TODO(verify): Both listings with DOTNET_JitDisasm=Square on .NET 8+ x64 Windows, in particular
// that Tier 0 homes the argument to [rbp+0x10] and reads it twice, and that Tier 1 is
// mov eax, ecx / imul eax, eax / ret. Code sizes 16 and 6 bytes are computed from the encodings,
// not measured.
// TODO(verify): With TieredPGO on, an "Instrumented Tier0" version may appear in between; for a
// method without calls or branches the instrumentation may be empty.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

const ASM_LINES = [
  '; Assembly listing for method C:Square(int):int (Tier0)',
  '; Emitting BLENDED_CODE for X64 with AVX2 - Windows',
  '; Tier0 code',
  '; rbp based frame',
  '; partially interruptible',
  '',
  'G_M000_IG01:',
  '       push     rbp',
  '       mov      rbp, rsp',
  '       mov      dword ptr [rbp+0x10], ecx',
  '',
  'G_M000_IG02:',
  '       mov      eax, dword ptr [rbp+0x10]',
  '       imul     eax, dword ptr [rbp+0x10]',
  '',
  'G_M000_IG03:',
  '       pop      rbp',
  '       ret',
  '',
  '; Total bytes of code 16',
  '',
  '; Assembly listing for method C:Square(int):int (Tier1)',
  '; Emitting BLENDED_CODE for X64 with AVX2 - Windows',
  '; Tier1 code',
  '; optimized code',
  '; rsp based frame',
  '; partially interruptible',
  '',
  'G_M000_IG01:',
  '',
  'G_M000_IG02:',
  '       mov      eax, ecx',
  '       imul     eax, eax',
  '',
  'G_M000_IG03:',
  '       ret',
  '',
  '; Total bytes of code 6',
];
/** 1-based line of the n-th (0-based) occurrence of `needle`. */
const L = (needle: string, nth = 0) => {
  let seen = -1;
  for (let i = 0; i < ASM_LINES.length; i++) {
    if (ASM_LINES[i]!.includes(needle) && ++seen === nth) return i + 1;
  }
  return 0;
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const T0: [string, string, string][] = [
  ['t0-push', 'push rbp', 'Prolog: alten Framepointer sichern'],
  ['t0-frame', 'mov rbp, rsp', 'Prolog: neuer Framepointer'],
  ['t0-home', 'mov dword ptr [rbp+0x10], ecx', 'Argument x in den Speicher schreiben'],
  ['t0-load', 'mov eax, dword ptr [rbp+0x10]', 'x aus dem Speicher laden'],
  ['t0-mul', 'imul eax, dword ptr [rbp+0x10]', 'x noch einmal laden und multiplizieren'],
  ['t0-pop', 'pop rbp', 'Epilog: Framepointer zurück'],
  ['t0-ret', 'ret', 'zurück, Ergebnis in eax'],
];
/** Tier 1 rows: id, instruction, purpose, Tier 0 rows it replaces. */
const T1: [string, string, string, string[]][] = [
  ['t1-mov', 'mov eax, ecx', 'x direkt aus dem Register kopieren', ['t0-load']],
  ['t1-mul', 'imul eax, eax', 'quadrieren, ohne Speicherzugriff', ['t0-mul']],
  ['t1-ret', 'ret', 'zurück, Ergebnis in eax', ['t0-ret']],
];

interface Look {
  t0Active?: string[];
  t0Dim?: string[];
  t1?: 'missing' | 'shown';
  t1Active?: string[];
  showRefs?: boolean;
}

function tables({
  t0Active = [],
  t0Dim = [],
  t1 = 'missing',
  t1Active = [],
  showRefs = false,
}: Look): Table[] {
  const t0Status = (id: string): Status | undefined =>
    t0Active.includes(id) ? 'active' : t0Dim.includes(id) ? 'dim' : undefined;
  const t0Rows: Row[] = T0.map(([id, instr, purpose]) => {
    const s = t0Status(id);
    return { id, cells: [instr, purpose], ...(s ? { status: s } : {}) };
  });
  const t1Rows: Row[] =
    t1 === 'missing'
      ? [{ id: 't1-none', cells: ['', 'noch nicht übersetzt'], status: 'dim' }]
      : T1.map(([id, instr, purpose, to]) => ({
          id,
          cells: [instr, purpose],
          ...(t1Active.includes(id) ? { status: 'active' as Status } : {}),
          ...(showRefs ? { refs: to.map((x) => ({ col: 0, to: x })) } : {}),
        }));
  return [
    {
      id: 't-t0',
      title: 'Tier 0 (16 Byte)',
      columns: ['Instruktion', 'Zweck'],
      row: 1,
      col: 1,
      rows: t0Rows,
    },
    {
      id: 't-t1',
      title: t1 === 'missing' ? 'Tier 1' : 'Tier 1 (6 Byte)',
      columns: ['Instruktion', 'Zweck'],
      row: 2,
      col: 1,
      rows: t1Rows,
      ...(showRefs ? { note: 'Pfeile: welche Tier-0-Zeile ersetzt wird' } : {}),
    },
  ];
}

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });
const state = (look: Look, facts: Fact[]): TableState => ({ tables: tables(look), facts });

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Square in Tier 0 und Tier 1',
  code: {
    cs: `static int Square(int x) => x * x;

// Aufrufer, läuft im Dauerbetrieb sehr oft:
for (int i = 0; i < 1_000_000; i++)
    sum += Square(i);`,
    asm: ASM_LINES.join('\n'),
  },
  steps: [
    {
      codeLine: 1,
      highlight: { asm: range(1, 5) },
      state: state({}, [
        fact('f-stage', 'Kopf', 'Tier0 code, rbp based frame'),
        fact('f-when', 'Entstanden', 'beim ersten Aufruf'),
      ]),
      changed: ['f-stage', 'f-when'],
      explanation:
        'Mit `DOTNET_JitDisasm=Square` erscheint die Methode zuerst so. Der Kopf sagt es deutlich: `Tier0 code`, also ohne Optimierungen übersetzt, und ein Frame über `rbp`. Tier-1-Code gibt es zu diesem Zeitpunkt noch nicht.',
    },
    {
      codeLine: 1,
      highlight: { asm: [L('push     rbp'), L('mov      rbp, rsp')] },
      state: state({ t0Active: ['t0-push', 't0-frame'] }, [
        fact('f-stage', 'Kopf', 'Tier0 code, rbp based frame'),
        fact('f-frame', 'Frame', 'rbp zeigt auf den gesicherten alten rbp'),
      ]),
      changed: ['t0-push', 't0-frame', 'f-frame'],
      explanation:
        'Der Prolog legt einen klassischen Frame an: alten `rbp` sichern, neuen `rbp` auf den Stackzeiger setzen. Tier 0 macht das praktisch immer, weil Locals und Argumente dann einfach über feste Offsets von `rbp` erreichbar sind.',
    },
    {
      codeLine: 1,
      highlight: { asm: [L('mov      dword ptr [rbp+0x10], ecx')] },
      state: state({ t0Active: ['t0-home'] }, [
        fact('f-stage', 'Kopf', 'Tier0 code, rbp based frame'),
        fact('f-home', '[rbp+0x10]', 'Heimatplatz von x im Schattenbereich'),
      ]),
      changed: ['t0-home', 'f-home'],
      explanation:
        'Das Argument kam in `ecx` an, wird aber sofort in den Speicher geschrieben. `[rbp+0x10]` liegt im 32-Byte-Schattenbereich, den der Aufrufer unter Windows x64 für genau solche Zwecke reserviert. In Tier 0 lebt jedes Argument und jeder Local an einem festen Platz im Speicher.',
    },
    {
      codeLine: 1,
      highlight: {
        asm: [L('mov      eax, dword ptr [rbp+0x10]'), L('imul     eax, dword ptr [rbp+0x10]')],
      },
      state: state({ t0Active: ['t0-load', 't0-mul'] }, [
        fact('f-stage', 'Kopf', 'Tier0 code, rbp based frame'),
        fact('f-loads', 'Speicherzugriffe für x', '1 schreibend, 2 lesend'),
      ]),
      changed: ['t0-load', 't0-mul', 'f-loads'],
      explanation:
        'Für `x * x` liest der Code `x` zweimal aus dem Speicher, obwohl der Wert eben noch in `ecx` stand. Das ist typisch für Tier 0: Jeder Zugriff auf einen Local wird zu einem Speicherzugriff, weil die Registerzuteilung Locals nicht über Befehle hinweg in Registern hält.',
    },
    {
      codeLine: 1,
      highlight: { asm: [L('pop      rbp'), L('       ret')] },
      state: state({ t0Active: ['t0-pop', 't0-ret'] }, [
        fact('f-stage', 'Kopf', 'Tier0 code, rbp based frame'),
        fact('f-size', 'Größe', '16 Byte, 7 Befehle'),
      ]),
      changed: ['t0-pop', 't0-ret', 'f-size'],
      explanation:
        'Der Epilog stellt `rbp` wieder her, `ret` kehrt zurück, das Ergebnis steht in `eax`. Häufige Fehlannahme: Dieser Code sei langsam, weil der JIT `x * x` nicht besser könne. Er kann es, er hat es in Tier 0 nur absichtlich nicht versucht.',
    },
    {
      codeLine: 5,
      highlight: { asm: range(L('(Tier1)'), L('Total bytes of code 6')) },
      state: state({ t0Dim: T0.map((r) => r[0]), t1: 'shown' }, [
        fact('f-stage', 'Kopf', 'Tier1 code, optimized code, rsp based frame'),
        fact('f-when', 'Entstanden', 'im Hintergrund, nach vielen Aufrufen'),
        fact('f-size', 'Größe', '6 Byte, 3 Befehle'),
      ]),
      changed: ['t1-mov', 't1-mul', 't1-ret', 'f-stage', 'f-when', 'f-size'],
      explanation:
        'Später gibt `DOTNET_JitDisasm` eine zweite Fassung derselben Methode aus, mit `Tier1 code` im Kopf. Kein Frame, kein Speicherzugriff, drei Befehle. Beide Listings stehen in derselben Ausgabe untereinander, achte also immer auf den Kopf.',
    },
    {
      codeLine: 1,
      highlight: { asm: [L('mov      eax, ecx'), L('imul     eax, eax')] },
      state: state(
        {
          t0Dim: ['t0-push', 't0-frame', 't0-home', 't0-pop'],
          t1: 'shown',
          t1Active: ['t1-mov', 't1-mul'],
          showRefs: true,
        },
        [
          fact('f-stage', 'Kopf', 'Tier1 code, optimized code, rsp based frame'),
          fact('f-gone', 'Entfallen', 'Frame, Heimatplatz, zwei Ladebefehle'),
        ],
      ),
      changed: ['t1-mov', 't1-mul', 'f-gone'],
      explanation:
        'Die Pfeile zeigen, welche Tier-0-Zeile jeweils ersetzt wurde. Prolog, Epilog und das Schreiben in den Heimatplatz haben gar keine Entsprechung mehr. Und im Dauerbetrieb läuft oft nicht einmal diese Fassung: Im Tier-1-Code des Aufrufers ist `Square` meist eingesetzt.',
    },
  ],
});
