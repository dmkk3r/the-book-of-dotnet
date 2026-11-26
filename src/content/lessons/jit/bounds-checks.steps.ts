import { defineStepScript, type TableState } from '@/components/viz';

// The loop body of Sum(int[]) before and after range check elimination.
// The first listing is conceptual: it shows the loop as it would look with the bounds check that
// morph inserts for a[i] (GT_BOUNDS_CHECK, see ryujit-overview.md), before the range check phase
// (rangecheck.cpp / optimizer assertion propagation) removes it. Register choice is illustrative.
// Array layout on 64-bit: MethodTable pointer at +0, Length at +8, first int element at +16 (0x10),
// consistent with asm-lesen.steps.ts.
// TODO(verify): The optimized x64 listing of Sum on .NET 8+ (FullOpts / Tier 1): loop shape,
// register allocation, whether the JIT loads a.Length once before the loop, and whether
// .NET 9/10 strength reduction turns the index into a pointer increment.
// TODO(verify): That "i <= a.Length" keeps the bounds check in the loop body and throws
// IndexOutOfRangeException on the last iteration (no loop cloning for this shape).

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];

/** loop body rows: id, instruction, meaning */
const BODY: [string, string, string][] = [
  ['b-cond', 'cmp eax, edx / jge Ende', 'Schleifenbedingung: i < Länge?'],
  ['b-cmp', 'cmp eax, dword ptr [rcx+0x08]', 'Bounds-Check: i mit a.Length vergleichen'],
  ['b-jae', 'jae Wurf', 'vorzeichenlos i ≥ Length: Ausnahme'],
  ['b-load', 'add r8d, dword ptr [rcx+4*rax+0x10]', 'sum += a[i]'],
  ['b-inc', 'inc eax', 'i++'],
  ['b-jmp', 'jmp Schleifenkopf', 'nächster Durchlauf'],
];
const CHECK_ROWS = ['b-cmp', 'b-jae'];

/** what the JIT knows: id, statement, source */
const KNOW: [string, string, string][] = [
  ['k-start', 'i beginnt bei 0', 'int i = 0'],
  ['k-step', 'i wächst nur um 1', 'i++, keine andere Zuweisung'],
  ['k-cond', 'im Rumpf gilt i < a.Length', 'Schleifenbedingung'],
  ['k-len', 'a.Length ändert sich nie', 'a ist lokal, Arraylänge fest'],
];

interface Look {
  active?: string;
  /** body rows that ran in this iteration */
  done?: string[];
  /** bounds check rows removed */
  removed?: boolean;
  /** knowledge rows: established (match), missing (miss), unknown (not shown as status) */
  know?: Partial<Record<string, Status>>;
  /** override the text of a knowledge row */
  knowText?: Partial<Record<string, string>>;
  /** draw arrows from the bounds check rows to these knowledge rows */
  proof?: string[];
}

function tables(look: Look): Table[] {
  const { active, done = [], removed = false, know = {}, knowText = {}, proof = [] } = look;
  const bodyRows: Row[] = BODY.map(([id, instr, meaning]) => {
    const isCheck = CHECK_ROWS.includes(id);
    const status: Status | undefined =
      isCheck && removed
        ? 'dim'
        : id === active
          ? 'active'
          : done.includes(id)
            ? 'match'
            : undefined;
    const refs = isCheck && id === 'b-cmp' ? proof.map((to) => ({ col: 0, to })) : [];
    return {
      id,
      cells: [isCheck && removed ? `entfernt: ${instr}` : instr, meaning],
      ...(status ? { status } : {}),
      ...(refs.length > 0 ? { refs } : {}),
    };
  });
  const knowRows: Row[] = KNOW.map(([id, text, source]) => {
    const status = know[id];
    return {
      id,
      cells: [knowText[id] ?? text, source],
      ...(status ? { status } : { status: 'dim' as const }),
    };
  });
  return [
    {
      id: 't-body',
      title: 'Schleifenrumpf von Sum (x64, vereinfacht)',
      columns: ['Instruktion', 'Bedeutung'],
      rows: bodyRows,
      row: 1,
      col: 1,
      note: 'rcx = a, eax = i, edx = Länge für die Bedingung, r8d = sum',
    },
    {
      id: 't-know',
      title: 'Was der JIT über i beweisen kann',
      columns: ['Aussage', 'Quelle'],
      rows: knowRows,
      row: 2,
      col: 1,
    },
  ];
}

const state = (look: Look, facts: Fact[], output?: string): TableState => ({
  tables: tables(look),
  facts,
  ...(output ? { output } : {}),
});

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Wie der JIT den Bounds-Check in einer Schleife entfernt',
  code: {
    cs: `static int Sum(int[] a)
{
    int sum = 0;
    for (int i = 0; i < a.Length; i++)
        sum += a[i];
    return sum;
}

// Variante mit Fehler:
// for (int i = 0; i <= a.Length; i++)`,
    asm: `; gedacht: Rumpf mit Bounds-Check (vor der Optimierung)
LOOP:
  cmp      eax, edx                       ; i < Länge?
  jge      END
  cmp      eax, dword ptr [rcx+0x08]      ; Bounds-Check
  jae      THROW
  add      r8d, dword ptr [rcx+4*rax+0x10]
  inc      eax
  jmp      LOOP
THROW:
  call     CORINFO_HELP_RNGCHKFAIL

; Tier 1 (x64): Bounds-Check entfernt
  xor      eax, eax                       ; sum = 0
  mov      edx, dword ptr [rcx+0x08]      ; a.Length einmal laden
  test     edx, edx
  jle      SHORT END
  xor      r8d, r8d                       ; i = 0
LOOP:
  add      eax, dword ptr [rcx+4*r8+0x10] ; sum += a[i]
  inc      r8d
  cmp      edx, r8d
  jg       SHORT LOOP
END:
  ret`,
  },
  steps: [
    {
      codeLine: 5,
      highlight: { asm: [5, 6] },
      state: state({ active: 'b-cmp', done: ['b-cond'] }, [
        { id: 'f-phase', label: 'Stand', value: 'nach Morph, vor der Range-Check-Analyse' },
        { id: 'f-cost', label: 'Pro Durchlauf', value: 'zwei Instruktionen für die Prüfung' },
      ]),
      changed: ['b-cmp', 'f-phase', 'f-cost'],
      explanation:
        'Aus `a[i]` macht der JIT zuerst zwei Dinge: einen **Bounds-Check** und den eigentlichen Lesezugriff. Die Prüfung vergleicht `i` mit dem Längenfeld des Arrays bei Offset 8.',
    },
    {
      codeLine: 5,
      highlight: { asm: [6, 10, 11] },
      state: state({ active: 'b-jae', done: ['b-cond', 'b-cmp'] }, [
        { id: 'f-phase', label: 'Stand', value: 'nach Morph, vor der Range-Check-Analyse' },
        { id: 'f-cost', label: 'Pro Durchlauf', value: 'zwei Instruktionen für die Prüfung' },
        { id: 'f-uint', label: 'i = -1', value: 'vorzeichenlos 4294967295, also ≥ Length' },
      ]),
      changed: ['b-jae', 'f-uint'],
      explanation:
        '`jae` springt, wenn `i` **vorzeichenlos** nicht kleiner als die Länge ist. Ein negatives `i` wird dabei zu einer riesigen Zahl, eine einzige Prüfung deckt also beide Grenzen ab. Der Sprung führt zu einem Helfer, der die `IndexOutOfRangeException` wirft.',
    },
    {
      codeLine: 4,
      state: state({ know: { 'k-start': 'match', 'k-step': 'match' } }, [
        { id: 'f-phase', label: 'Stand', value: 'Range-Check-Analyse' },
        { id: 'f-range', label: 'Wertebereich von i', value: 'mindestens 0' },
      ]),
      changed: ['k-start', 'k-step', 'f-range'],
      explanation:
        'Jetzt sucht der JIT nach einem Beweis. Die Zählvariable beginnt bei `0` und wird nur hochgezählt. Also ist `i` im Rumpf nie negativ, die untere Grenze ist erledigt.',
    },
    {
      codeLine: 4,
      state: state(
        { know: { 'k-start': 'match', 'k-step': 'match', 'k-cond': 'match', 'k-len': 'match' } },
        [
          { id: 'f-phase', label: 'Stand', value: 'Range-Check-Analyse' },
          { id: 'f-range', label: 'Wertebereich von i', value: '0 bis a.Length - 1' },
        ],
      ),
      changed: ['k-cond', 'k-len', 'f-range'],
      explanation:
        'Die obere Grenze liefert die Schleifenbedingung: Der Rumpf läuft nur, wenn `i < a.Length` gilt. Wichtig ist der zweite Teil: `a` ist ein Parameter, der in der Schleife nicht neu zugewiesen wird, und die Länge eines Arrays ändert sich nie.',
    },
    {
      codeLine: 5,
      highlight: { asm: [20, 21, 22, 23] },
      state: state(
        {
          removed: true,
          proof: ['k-start', 'k-cond'],
          know: { 'k-start': 'match', 'k-step': 'match', 'k-cond': 'match', 'k-len': 'match' },
        },
        [
          { id: 'f-phase', label: 'Stand', value: 'Tier 1' },
          { id: 'f-range', label: 'Wertebereich von i', value: '0 bis a.Length - 1' },
          { id: 'f-cost', label: 'Pro Durchlauf', value: 'keine Prüfung mehr' },
        ],
      ),
      changed: ['b-cmp', 'b-jae', 'f-phase', 'f-cost'],
      explanation:
        'Der Bounds-Check kann nie fehlschlagen, also entfernt der JIT ihn. Häufige Fehlannahme: Ohne `unsafe` werde man Bounds-Checks nicht los. Dabei ist diese einfache Schleife genau das Muster, auf das der JIT ausgelegt ist.',
    },
    {
      codeLine: 10,
      highlight: { asm: [5, 6] },
      state: state(
        {
          active: 'b-jae',
          done: ['b-cond', 'b-cmp'],
          know: { 'k-start': 'match', 'k-step': 'match', 'k-cond': 'miss', 'k-len': 'match' },
          knowText: { 'k-cond': 'im Rumpf gilt nur i ≤ a.Length' },
        },
        [
          { id: 'f-phase', label: 'Stand', value: 'Tier 1, Variante mit <=' },
          { id: 'f-range', label: 'Wertebereich von i', value: '0 bis a.Length' },
          { id: 'f-cost', label: 'Pro Durchlauf', value: 'Prüfung bleibt' },
        ],
        'IndexOutOfRangeException im letzten Durchlauf',
      ),
      changed: ['b-cmp', 'b-jae', 'k-cond', 'f-range', 'f-cost'],
      explanation:
        'Mit `i <= a.Length` ist der Beweis falsch, denn im letzten Durchlauf ist `i == a.Length`. Die Prüfung bleibt und schlägt dort tatsächlich zu. Der JIT entfernt nur, was garantiert nie fehlschlagen kann.',
    },
  ],
});
