import { defineStepScript, type PipelineState } from '@/components/viz';

// Same method, Tier 0 (MinOpts) versus Tier 1. Tier 0 sets CLFLG_MINOPT (compiler.cpp,
// compInitOptions: JIT_FLAG_TIER0, JIT_FLAG_DEBUG_CODE and JIT_FLAG_MIN_OPT all lead to MinOpts).
// TODO(verify): Exact set of phases that MinOpts skips or reduces (inlining, struct promotion, loop
// phases, SSA/VN based optimizations) in the current compCompile phase list (compiler.cpp).
// TODO(verify): That Tier 0 keeps locals and arguments in the stack frame (no enregistration of
// locals in MinOpts) and the Tier 0 assembly shown below (Windows x64, .NET 8 or later).
// TODO(verify): Whether the importer spills the first call result to a temp at Tier 0 before the
// second call (impSpillSideEffects), as shown by [rbp-0x04].

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
type Method = NonNullable<PipelineState['methods']>[number];
type Fact = NonNullable<PipelineState['facts']>[number];

const IDS = [
  ['s-import', 'Importer', 'IL → Bäume'],
  ['s-inline', 'Inlining', 'Aufrufe einsetzen'],
  ['s-morph', 'Morph', 'nur das Nötigste'],
  ['s-loops', 'Schleifen', 'finden, umformen'],
  ['s-ssa', 'SSA und VN', 'Wertnummern'],
  ['s-opt', 'Optimierungen', 'CSE, Assertions, Bereiche'],
  ['s-back', 'Lowering', 'LIR für x64'],
  ['s-lsra', 'Registerzuteilung', 'LSRA'],
  ['s-codegen', 'Codegen', 'Bytes, GC-Info, Unwind'],
] as const;
type StageId = (typeof IDS)[number][0];

function stages(status: Partial<Record<StageId, Status>>): Stage[] {
  return IDS.map(([id, label, detail]) => ({ id, label, detail, status: status[id] ?? 'pending' }));
}

const MINOPT_SKIPS: Partial<Record<StageId, Status>> = {
  's-inline': 'skipped',
  's-loops': 'skipped',
  's-ssa': 'skipped',
  's-opt': 'skipped',
};

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });
const method = (id: string, name: string, tier: Method['tier'], note: string): Method => ({
  id,
  name,
  tier,
  note,
});

const ASM_LINES = [
  '; Assembly listing for method C:SumSquares(int,int):int (Tier0)',
  '; Tier0 code',
  '; rbp based frame',
  'G_M000_IG01:',
  '       push     rbp',
  '       sub      rsp, 48',
  '       lea      rbp, [rsp+0x30]',
  '       mov      dword ptr [rbp+0x10], ecx',
  '       mov      dword ptr [rbp+0x18], edx',
  'G_M000_IG02:',
  '       mov      ecx, dword ptr [rbp+0x10]',
  '       call     [C:Square(int):int]',
  '       mov      dword ptr [rbp-0x04], eax',
  '       mov      ecx, dword ptr [rbp+0x18]',
  '       call     [C:Square(int):int]',
  '       mov      ecx, dword ptr [rbp-0x04]',
  '       add      eax, ecx',
  'G_M000_IG03:',
  '       add      rsp, 48',
  '       pop      rbp',
  '       ret',
  '',
  '; Assembly listing for method C:SumSquares(int,int):int (Tier1)',
  '; Tier1 code',
  '; optimized code',
  'G_M000_IG02:',
  '       imul     ecx, ecx',
  '       imul     edx, edx',
  '       lea      eax, [rcx+rdx]',
  'G_M000_IG03:',
  '       ret',
];
const lines = (from: string, to: string) => {
  const a = ASM_LINES.indexOf(from) + 1;
  const b = ASM_LINES.indexOf(to, a - 1) + 1;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
};

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Tier 0 gegen Tier 1: dieselbe Pipeline, andere Phasen',
  code: {
    cs: `static int SumSquares(int a, int b)
    => Square(a) + Square(b);

static int Square(int x) => x * x;`,
    asm: ASM_LINES.join('\n'),
  },
  steps: [
    {
      codeLine: 1,
      state: {
        stages: stages({ 's-import': 'done', 's-inline': 'skipped', 's-morph': 'active' }),
        methods: [method('m-sum', 'SumSquares(int, int)', 'tier0', 'wird gerade übersetzt')],
        facts: [
          fact('f-mode', 'Modus', 'MinOpts'),
          fact('f-inline', 'Inlining', 'aus: Square bleibt ein Aufruf'),
        ],
      },
      changed: ['s-inline', 'f-mode', 'f-inline'],
      explanation:
        'Beim ersten Aufruf verlangt die Runtime **Tier 0**, und der JIT schaltet in den Modus **MinOpts**. Es ist derselbe Compiler mit Importer, Morph und Codegen, aber das Inlining fällt weg. Die beiden Aufrufe von `Square` bleiben echte Aufrufe.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages({
          's-import': 'done',
          's-morph': 'done',
          ...MINOPT_SKIPS,
          's-back': 'done',
          's-lsra': 'active',
        }),
        methods: [method('m-sum', 'SumSquares(int, int)', 'tier0', 'wird gerade übersetzt')],
        facts: [
          fact('f-mode', 'Modus', 'MinOpts'),
          fact('f-inline', 'Inlining', 'aus: Square bleibt ein Aufruf'),
          fact('f-locals', 'Argumente und Locals', 'im Stack-Frame'),
        ],
      },
      changed: ['s-loops', 's-ssa', 's-opt', 's-lsra', 'f-locals'],
      explanation:
        'Schleifenphasen, SSA, Wertnummern und die Optimierungen darauf werden übersprungen. Die Registerzuteilung läuft zwar, legt aber Argumente und Locals in den Stack-Frame und hält nur Zwischenwerte kurz in Registern. Das spart Analysezeit, kostet aber Speicherzugriffe.',
    },
    {
      codeLine: 2,
      highlight: { asm: lines(ASM_LINES[0]!, '       ret') },
      state: {
        stages: stages({
          's-import': 'done',
          's-morph': 'done',
          ...MINOPT_SKIPS,
          's-back': 'done',
          's-lsra': 'done',
          's-codegen': 'done',
        }),
        methods: [
          method('m-sum', 'SumSquares(int, int)', 'tier0', 'rechnet mit [rbp+…]'),
          method('m-sq', 'Square(int)', 'tier0', 'eigene Übersetzung beim ersten Aufruf'),
        ],
        facts: [
          fact('f-mode', 'Modus', 'MinOpts'),
          fact('f-calls', 'Aufrufe pro Ausführung', '2'),
          fact('f-locals', 'Argumente und Locals', 'im Stack-Frame'),
        ],
      },
      changed: ['s-codegen', 'm-sq', 'f-calls'],
      explanation:
        'Das Ergebnis ist korrekt, aber umständlich: Argumente werden in den Frame geschrieben und wieder gelesen, `Square` wird zweimal aufgerufen und bekommt beim ersten Aufruf seine eigene Tier-0-Übersetzung. Genau diese Art Code siehst du, wenn du eine Methode direkt nach dem Start disassemblierst.',
    },
    {
      codeLine: 2,
      highlight: {
        asm: lines('; Assembly listing for method C:SumSquares(int,int):int (Tier1)', '       ret'),
      },
      state: {
        stages: stages({
          's-import': 'done',
          's-inline': 'done',
          's-morph': 'done',
          's-loops': 'done',
          's-ssa': 'done',
          's-opt': 'done',
          's-back': 'done',
          's-lsra': 'done',
          's-codegen': 'done',
        }),
        methods: [
          method('m-sum', 'SumSquares(int, int)', 'tier1', 'alles in Registern'),
          method('m-sq', 'Square(int)', 'tier0', 'wird von SumSquares nicht mehr aufgerufen'),
        ],
        facts: [
          fact('f-mode', 'Modus', 'volle Optimierung'),
          fact('f-calls', 'Aufrufe pro Ausführung', '0'),
          fact('f-locals', 'Argumente und Locals', 'in Registern'),
        ],
      },
      changed: [
        's-inline',
        's-loops',
        's-ssa',
        's-opt',
        'm-sum',
        'm-sq',
        'f-mode',
        'f-calls',
        'f-locals',
      ],
      explanation:
        'Wird `SumSquares` heiß, übersetzt der JIT sie im Hintergrund neu, diesmal mit allen Phasen. Inlining macht die Aufrufe überflüssig, die Registerzuteilung hält alles in Registern. Wie es zu diesem zweiten Lauf kommt, erklärt die Lektion „Tiered Compilation und OSR“.',
    },
  ],
});
