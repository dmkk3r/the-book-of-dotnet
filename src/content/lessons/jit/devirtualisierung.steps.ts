import { defineStepScript, type TableState } from '@/components/viz';

// The same "+ 1 after a call" in three variants: virtual call through the MethodTable slot,
// devirtualized direct call (sealed class, callee marked NoInlining), devirtualized and inlined.
// Slot layout consistent with typsystem/virtual-dispatch.steps.ts: slots 0 to 3 belong to
// System.Object, the first new virtual method of Animal gets slot 4.
// Windows x64 calling convention: first argument in rcx, result in eax.
// TODO(verify): All three listings (x64, FullOpts/Tier 1) in SharpLab or with DOTNET_JitDisasm on
// .NET 8+: the two-load slot lookup (mov rax, [rcx]; mov rax, [rax+0x40]; call [rax+0x20]), the
// offsets 0x40 and 0x20, the null check "cmp byte ptr [rcx], cl" before the direct call and in the
// inlined variant, and that ViaDog folds to "mov eax, 5".
// Addresses are fictitious.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Fact = NonNullable<TableState['facts']>[number];

type Variant = 'virtual' | 'direct' | 'inline';

/** asm rows per variant: id, instruction, meaning */
const ASM: Record<Variant, [string, string, string][]> = {
  virtual: [
    ['v-sub', 'sub rsp, 40', 'Prolog'],
    ['v-mt', 'mov rax, qword ptr [rcx]', 'MethodTable-Zeiger aus dem Objekt laden'],
    ['v-chunk', 'mov rax, qword ptr [rax+0x40]', 'Block mit den Slots laden'],
    ['v-call', 'call [rax+0x20]', 'indirekt über Slot 4 springen'],
    ['v-inc', 'inc eax', '+ 1'],
    ['v-ret', 'add rsp, 40 / ret', 'Epilog und Rücksprung'],
  ],
  direct: [
    ['d-sub', 'sub rsp, 40', 'Prolog'],
    ['d-null', 'cmp byte ptr [rcx], cl', 'Nullprüfung (liest das Objekt an)'],
    ['d-call', 'call Bird:Legs():int', 'direkter Aufruf, Ziel steht fest'],
    ['d-inc', 'inc eax', '+ 1'],
    ['d-ret', 'add rsp, 40 / ret', 'Epilog und Rücksprung'],
  ],
  inline: [
    ['i-null', 'cmp byte ptr [rcx], cl', 'Nullprüfung bleibt'],
    ['i-mov', 'mov eax, 5', 'Ergebnis als Konstante: 4 + 1'],
    ['i-ret', 'ret', 'Rücksprung'],
  ],
};

const TITLES: Record<Variant, string> = {
  virtual: 'ViaBase(Animal a): virtueller Aufruf',
  direct: 'ViaBird(Bird b): devirtualisiert',
  inline: 'ViaDog(Dog d): devirtualisiert und eingebettet',
};

interface Look {
  variant: Variant;
  active?: string;
  done?: string[];
  /** asm row → row in the object or MethodTable table */
  refs?: { from: string; to: string }[];
  /** rows of the object and MethodTable tables that are read in this step */
  read?: string[];
  /** grey out the object and MethodTable tables (not used by this variant) */
  dimData?: boolean;
  /** MethodTable of which class is shown */
  cls: 'Dog' | 'Bird';
}

function tables(look: Look): Table[] {
  const { variant, active, done = [], refs = [], read = [], dimData = false, cls } = look;
  const asmRows: Row[] = ASM[variant].map(([id, instr, meaning]) => {
    const r = refs.filter((x) => x.from === id).map((x) => ({ col: 0, to: x.to }));
    const status = id === active ? 'active' : done.includes(id) ? 'match' : undefined;
    return {
      id,
      cells: [instr, meaning],
      ...(status ? { status } : {}),
      ...(r.length > 0 ? { refs: r } : {}),
    };
  });
  const dataStatus = (id: string) =>
    read.includes(id)
      ? ({ status: 'match' } as const)
      : dimData
        ? ({ status: 'dim' } as const)
        : {};
  const objRows: Row[] = [
    {
      id: 'o-mt',
      cells: ['+0', `MethodTable-Zeiger → ${cls}`],
      ...dataStatus('o-mt'),
      refs: [{ col: 1, to: 'mt-legs' }],
    },
    { id: 'o-fields', cells: ['+8', 'keine Felder'], ...dataStatus('o-fields') },
  ];
  const mtRows: Row[] = [
    {
      id: 'mt-obj',
      cells: ['0 bis 3', 'ToString, Equals, GetHashCode, Finalize'],
      ...dataStatus('mt-obj'),
    },
    { id: 'mt-legs', cells: ['4', `${cls}.Legs`], ...dataStatus('mt-legs') },
  ];
  return [
    {
      id: 't-asm',
      title: `${TITLES[variant]} (x64)`,
      columns: ['Instruktion', 'Bedeutung'],
      rows: asmRows,
      row: 1,
      col: 1,
    },
    {
      id: 't-obj',
      title: `Objekt ${cls} bei 0x0000_7F10_3000`,
      columns: ['Offset', 'Inhalt'],
      rows: objRows,
      row: 2,
      col: 1,
    },
    {
      id: 't-mt',
      title: `MethodTable von ${cls} (Loader Heap)`,
      columns: ['Slot', 'Ziel'],
      rows: mtRows,
      row: 3,
      col: 1,
      note: 'Slots 0 bis 3 erbt jede Klasse von System.Object.',
    },
  ];
}

const state = (look: Look, facts: Fact[]): TableState => ({ tables: tables(look), facts });

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Virtueller Aufruf, direkter Aufruf und eingebetteter Aufruf',
  code: {
    cs: `abstract class Animal { public abstract int Legs(); }
sealed class Dog : Animal { public override int Legs() => 4; }
sealed class Bird : Animal
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public override int Legs() => 2;
}

static int ViaBase(Animal a) => a.Legs() + 1;   // Typ unbekannt
static int ViaBird(Bird b)   => b.Legs() + 1;   // sealed, nicht einbettbar
static int ViaDog(Dog d)     => d.Legs() + 1;   // sealed, einbettbar`,
    asm: `; ViaBase (x64, optimiert)
sub      rsp, 40
mov      rax, qword ptr [rcx]          ; MethodTable
mov      rax, qword ptr [rax+0x40]     ; Slot-Block
call     [rax+0x20]                    ; Slot 4: Legs
inc      eax
add      rsp, 40
ret

; ViaBird
sub      rsp, 40
cmp      byte ptr [rcx], cl            ; Nullprüfung
call     [Bird:Legs():int:this]
inc      eax
add      rsp, 40
ret

; ViaDog
cmp      byte ptr [rcx], cl            ; Nullprüfung
mov      eax, 5
ret`,
  },
  steps: [
    {
      codeLine: 9,
      highlight: { asm: [3] },
      state: state(
        {
          variant: 'virtual',
          cls: 'Dog',
          active: 'v-mt',
          done: ['v-sub'],
          refs: [{ from: 'v-mt', to: 'o-mt' }],
          read: ['o-mt'],
        },
        [
          { id: 'f-static', label: 'Statischer Typ', value: 'Animal' },
          {
            id: 'f-runtime',
            label: 'Objekt zur Laufzeit',
            value: 'Dog (könnte jede Ableitung sein)',
          },
        ],
      ),
      changed: ['v-mt', 'o-mt', 'f-static', 'f-runtime'],
      explanation:
        '`ViaBase` kennt nur den statischen Typ `Animal`. Welches `Legs` läuft, entscheidet das Objekt. Die erste Instruktion lädt deshalb den **MethodTable-Zeiger** aus dem Objekt.',
    },
    {
      codeLine: 9,
      highlight: { asm: [4, 5] },
      state: state(
        {
          variant: 'virtual',
          cls: 'Dog',
          active: 'v-call',
          done: ['v-sub', 'v-mt', 'v-chunk'],
          refs: [{ from: 'v-call', to: 'mt-legs' }],
          read: ['o-mt', 'mt-legs'],
        },
        [
          { id: 'f-static', label: 'Statischer Typ', value: 'Animal' },
          { id: 'f-target', label: 'Ziel', value: 'erst zur Laufzeit: Dog.Legs' },
        ],
      ),
      changed: ['v-chunk', 'v-call', 'mt-legs', 'f-target'],
      explanation:
        'Zwei weitere Ladebefehle führen zu Slot 4, dann folgt ein **indirekter** Sprung. Das sind ein paar Takte, die der Prozessor gut vorhersagen kann, wenn hier immer derselbe Typ ankommt.',
    },
    {
      codeLine: 9,
      highlight: { asm: [6] },
      state: state(
        {
          variant: 'virtual',
          cls: 'Dog',
          active: 'v-inc',
          done: ['v-sub', 'v-mt', 'v-chunk', 'v-call'],
        },
        [
          { id: 'f-static', label: 'Statischer Typ', value: 'Animal' },
          { id: 'f-target', label: 'Ziel', value: 'Blackbox für den JIT' },
          { id: 'f-cost', label: 'Eigentliche Kosten', value: 'kein Inlining möglich' },
        ],
      ),
      changed: ['v-inc', 'f-target', 'f-cost'],
      explanation:
        'Häufige Fehlannahme: Der indirekte Sprung sei das Teure. Schwerer wiegt, dass der JIT beim Übersetzen nicht weiß, was `Legs` tut. Er kann nichts einbetten und nichts über das Ergebnis wissen, also bleibt `+ 1` eine Rechnung zur Laufzeit.',
    },
    {
      codeLine: 10,
      highlight: { asm: [11, 12] },
      state: state(
        {
          variant: 'direct',
          cls: 'Bird',
          active: 'd-call',
          done: ['d-sub', 'd-null'],
          dimData: true,
        },
        [
          { id: 'f-static', label: 'Statischer Typ', value: 'Bird (sealed)' },
          { id: 'f-target', label: 'Ziel', value: 'beim Übersetzen: Bird.Legs' },
        ],
      ),
      changed: ['d-null', 'd-call', 'f-static', 'f-target'],
      explanation:
        '`Bird` ist `sealed`, also kann ein `Bird`-Verweis nur auf ein `Bird` zeigen. Der JIT ersetzt den virtuellen Aufruf durch einen **direkten** Aufruf. MethodTable und Slot werden nicht mehr gelesen, nur die Nullprüfung bleibt.',
    },
    {
      codeLine: 11,
      highlight: { asm: [18, 19, 20] },
      state: state(
        {
          variant: 'inline',
          cls: 'Dog',
          active: 'i-mov',
          done: ['i-null'],
          dimData: true,
        },
        [
          { id: 'f-static', label: 'Statischer Typ', value: 'Dog (sealed)' },
          { id: 'f-target', label: 'Ziel', value: 'Dog.Legs, eingebettet' },
          { id: 'f-cost', label: 'Ergebnis', value: 'Konstante 5' },
        ],
      ),
      changed: ['i-null', 'i-mov', 'f-target', 'f-cost'],
      explanation:
        'Bei `Dog` verbietet kein Attribut das Einbetten. Sobald das Ziel feststeht, setzt der JIT den Rumpf von `Legs` ein und rechnet `4 + 1` beim Übersetzen aus. Erst dieser Schritt zeigt, was Devirtualisierung eigentlich wert ist.',
    },
  ],
});
