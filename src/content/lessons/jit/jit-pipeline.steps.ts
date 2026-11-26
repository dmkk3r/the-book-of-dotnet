import { defineStepScript, type PipelineState } from '@/components/viz';

// One tiny method through the phases of RyuJIT (order and names from
// docs/design/coreclr/jit/ryujit-overview.md, table "Phases of RyuJIT").
// The walkthrough shows an optimizing compilation (Tier 1 or FullOpts) on Windows x64.
// TODO(verify): Exact IL from Roslyn (Release) in SharpLab: offsets and the two call instructions.
// TODO(verify): That the importer pushes a RET_EXPR placeholder for each inline candidate and appends
// the call as its own statement (impImportCall / inline candidate handling in importercalls.cpp).
// TODO(verify): That the inliner substitutes the caller's locals V00/V01 directly for the
// parameter x without introducing temps (fgInline, argument handling for simple local args).
// TODO(verify): Final x64 assembly (imul/imul/lea) and code size 10 bytes, e.g. with
// DOTNET_JitDisasm=SumSquares and DOTNET_TieredCompilation=0 on .NET 8 or later.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
type Fact = NonNullable<PipelineState['facts']>[number];

const STAGES: [string, string, string][] = [
  ['s-prep', 'Vorbereitung', 'IL scannen, Basisblöcke'],
  ['s-import', 'Importer', 'IL → Bäume (HIR)'],
  ['s-inline', 'Inlining', 'Aufrufe einsetzen'],
  ['s-morph', 'Morph', 'normalisieren, vereinfachen'],
  ['s-loops', 'Flussgraph', 'Schleifen finden, umformen'],
  ['s-ssa', 'SSA und VN', 'Wertnummern vergeben'],
  ['s-opt', 'Optimierungen', 'CSE, Assertions, Bereiche'],
  ['s-rat', 'Rationalisierung', 'Bäume → Liste (LIR)'],
  ['s-lower', 'Lowering', 'zielspezifisch umbauen'],
  ['s-lsra', 'Registerzuteilung', 'Linear Scan (LSRA)'],
  ['s-codegen', 'Codegen und Emitter', 'Bytes, GC-Info, Unwind'],
];

/** All stages before `active` are done, `active` runs, the rest is pending. */
function stages(active: string | null): Stage[] {
  const index = active === null ? STAGES.length : STAGES.findIndex(([id]) => id === active);
  return STAGES.map(([id, label, detail], i) => {
    const status: Status = i < index ? 'done' : i === index ? 'active' : 'pending';
    return { id, label, detail, status };
  });
}

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

const ASM_LINES = [
  '; Assembly listing for method C:SumSquares(int,int):int (FullOpts)',
  '; Emitting BLENDED_CODE for X64 with AVX2 - Windows',
  '; FullOpts code',
  '; optimized code',
  '; rsp based frame',
  '; partially interruptible',
  '',
  'G_M000_IG01:',
  '',
  'G_M000_IG02:',
  '       imul     ecx, ecx',
  '       imul     edx, edx',
  '       lea      eax, [rcx+rdx]',
  '',
  'G_M000_IG03:',
  '       ret',
  '',
  '; Total bytes of code 10',
];
const asmLine = (needle: string) => ASM_LINES.findIndex((l) => l.includes(needle)) + 1;

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'SumSquares durch die Phasen von RyuJIT',
  code: {
    cs: `static int SumSquares(int a, int b)
    => Square(a) + Square(b);

static int Square(int x) => x * x;`,
    il: `// SumSquares
IL_0000: ldarg.0
IL_0001: call int32 C::Square(int32)
IL_0006: ldarg.1
IL_0007: call int32 C::Square(int32)
IL_000c: add
IL_000d: ret`,
    asm: ASM_LINES.join('\n'),
  },
  steps: [
    {
      codeLine: 1,
      highlight: { il: [2, 3, 4, 5, 6, 7] },
      state: {
        stages: stages('s-prep'),
        facts: [
          fact('f-rep', 'Darstellung', 'IL, 14 Byte'),
          fact('f-blocks', 'Basisblöcke', '1 (kein Sprung im IL)'),
        ],
      },
      changed: ['s-prep', 'f-blocks'],
      explanation:
        'Der erste Aufruf von `SumSquares` landet über den Precode bei der Runtime, und die beauftragt den JIT. Bevor er Code baut, liest der JIT das IL einmal durch, sucht Sprungziele und teilt die Methode in **Basisblöcke**. Ohne Verzweigung bleibt es hier bei einem einzigen Block.',
    },
    {
      codeLine: 2,
      highlight: { il: [2, 3, 4, 5, 6, 7] },
      state: {
        stages: stages('s-import'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR: Statements mit Bäumen'),
          fact(
            'f-tree',
            'Bäume',
            'CALL Square(V00); CALL Square(V01); RETURN(ADD(RET_EXPR, RET_EXPR))',
          ),
          fact('f-stack', 'Evaluation Stack', 'aufgelöst, existiert nicht mehr'),
        ],
      },
      changed: ['s-import', 'f-rep', 'f-tree', 'f-stack'],
      explanation:
        'Der **Importer** macht aus den sechs IL-Instruktionen Bäume. Häufige Fehlannahme: Er übersetze jede IL-Instruktion direkt in Maschinenbefehle. Tatsächlich entsteht hier noch kein einziges Byte Maschinencode, sondern eine Darstellung, auf der der JIT später optimieren kann.',
    },
    {
      codeLine: 2,
      highlight: { il: [3, 5] },
      state: {
        stages: stages('s-import'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR: Statements mit Bäumen'),
          fact(
            'f-tree',
            'Bäume',
            'CALL Square(V00); CALL Square(V01); RETURN(ADD(RET_EXPR, RET_EXPR))',
          ),
          fact('f-ee', 'Fragen an die Runtime', 'resolveToken, getCallInfo'),
        ],
      },
      changed: ['f-ee'],
      explanation:
        'Im IL steht bei `call` nur ein Metadaten-Token. Was dahintersteckt, weiß der JIT nicht selbst: Er fragt die Runtime über die **JIT/EE-Schnittstelle**, welche Methode gemeint ist und wie sie aufgerufen wird. Weil `Square` klein und statisch ist, merkt sich der Importer beide Aufrufe als Kandidaten fürs Inlining.',
    },
    {
      codeLine: 4,
      state: {
        stages: stages('s-inline'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR'),
          fact('f-tree', 'Bäume', 'RETURN(ADD(MUL(V00, V00), MUL(V01, V01)))'),
          fact('f-calls', 'Aufrufe', 'keine mehr'),
        ],
      },
      changed: ['s-inline', 'f-tree', 'f-calls'],
      explanation:
        'Der Inliner importiert `Square` mit einem eigenen Compiler-Objekt und setzt dessen Baum an die Stelle der Aufrufe. Aus `x` wird `a` beziehungsweise `b`, die Platzhalter `RET_EXPR` werden durch die Multiplikationen ersetzt. Ab jetzt gibt es in `SumSquares` keinen Aufruf mehr.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages('s-morph'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR'),
          fact('f-tree', 'Bäume', 'RETURN(ADD(MUL(V00, V00), MUL(V01, V01)))'),
          fact('f-morph', 'Morph', 'kaum Arbeit: keine Felder, keine Arrays'),
        ],
      },
      changed: ['s-morph', 'f-morph'],
      explanation:
        '**Morph** bringt die Bäume in eine Normalform: Feld- und Arrayzugriffe werden zu Zeigerarithmetik, einfache Ausdrücke werden gefaltet. Bei unserer Methode gibt es dafür kaum etwas zu tun. Bei `p.X` oder `arr[i]` wäre der Baum danach deutlich größer.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages('s-loops'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR'),
          fact('f-tree', 'Bäume', 'RETURN(ADD(MUL(V00, V00), MUL(V01, V01)))'),
          fact('f-loops', 'Schleifen', 'keine gefunden'),
        ],
      },
      changed: ['s-loops', 'f-loops'],
      explanation:
        'Jetzt sucht der JIT im Flussgraphen nach **Schleifen** und bringt sie in eine feste Form, damit spätere Phasen Code vor die Schleife ziehen, Schleifen klonen oder ganz ausrollen können. `SumSquares` hat keine Schleife, die Phase läuft durch, ohne etwas zu ändern.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages('s-ssa'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR mit SSA und Wertnummern'),
          fact('f-tree', 'Bäume', 'RETURN(ADD(MUL(V00, V00) $1, MUL(V01, V01) $2) $3)'),
          fact('f-vn', 'Wertnummern', '$1 und $2 verschieden, also nichts doppelt'),
        ],
      },
      changed: ['s-ssa', 'f-rep', 'f-tree', 'f-vn'],
      explanation:
        'Der JIT baut **SSA** für die Locals und vergibt jedem Ausdruck eine **Wertnummer**. Zwei Ausdrücke mit gleicher Wertnummer berechnen garantiert dasselbe. Hätte der Aufrufer `Square(a) + Square(a)` geschrieben, bekämen beide Multiplikationen dieselbe Nummer.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages('s-opt'),
        facts: [
          fact('f-rep', 'Darstellung', 'HIR mit SSA und Wertnummern'),
          fact('f-tree', 'Bäume', 'RETURN(ADD(MUL(V00, V00), MUL(V01, V01)))'),
          fact('f-opt', 'Ergebnis', 'kein CSE-Kandidat, keine Bounds-Checks'),
        ],
      },
      changed: ['s-opt', 'f-opt'],
      explanation:
        'Auf den Wertnummern arbeiten die großen Optimierungen: **CSE** fasst gleiche Ausdrücke zusammen, **Assertion Propagation** nutzt Wissen wie „ist nicht null“, die **Range Analysis** entfernt überflüssige Bounds-Checks. Hier finden sie nichts. Das ist normal: Die meisten Phasen ändern an einer gegebenen Methode wenig.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages('s-rat'),
        facts: [
          fact('f-rep', 'Darstellung', 'LIR: Knoten in Ausführungsreihenfolge'),
          fact(
            'f-tree',
            'Knoten',
            't1 = V00; t2 = V00; t3 = MUL t1, t2; t4 = V01; t5 = V01; t6 = MUL t4, t5; t7 = ADD t3, t6; RETURN t7',
          ),
        ],
      },
      changed: ['s-rat', 'f-rep', 'f-tree'],
      explanation:
        'Mit der **Rationalisierung** beginnt das Backend. Statements und Bäume verschwinden, übrig bleibt pro Block eine Liste von Knoten in genau der Reihenfolge, in der sie ausgeführt werden. Diese Form heißt **LIR**.',
    },
    {
      codeLine: 2,
      state: {
        stages: stages('s-lower'),
        facts: [
          fact('f-rep', 'Darstellung', 'LIR für x64'),
          fact(
            'f-tree',
            'Knoten',
            't1 = V00; t2 = V00; t3 = MUL t1, t2; t4 = V01; t5 = V01; t6 = MUL t4, t5; t7 = ADD t3, t6; RETURN t7',
          ),
          fact('f-lower', 'Lowering', 'Registerbedarf jedes Knotens festgelegt'),
        ],
      },
      changed: ['s-lower', 'f-lower'],
      explanation:
        '**Lowering** passt die Liste an den Zielprozessor an: Adressierungsarten wie `[rcx+4*rax+16]` entstehen hier, Konstanten und Speicheroperanden werden in ihre Nutzer „eingebettet“. Danach weiß jeder Knoten, wie viele Register er braucht. Unsere Methode bleibt fast unverändert.',
    },
    {
      codeLine: 1,
      state: {
        stages: stages('s-lsra'),
        facts: [
          fact('f-rep', 'Darstellung', 'LIR mit Registern'),
          fact('f-a', 'a (V00)', 'rcx, so übergeben vom Aufrufer'),
          fact('f-b', 'b (V01)', 'rdx, so übergeben vom Aufrufer'),
          fact('f-ret', 'Ergebnis', 'rax, so verlangt es die Aufrufkonvention'),
          fact('f-frame', 'Stack-Frame', 'nicht nötig'),
        ],
      },
      changed: ['s-lsra', 'f-a', 'f-b', 'f-ret', 'f-frame'],
      explanation:
        'Die **Registerzuteilung** (Linear Scan) gibt jedem Wert ein Register. Die Aufrufkonvention von Windows x64 liefert `a` in `rcx` und `b` in `rdx` und erwartet das Ergebnis in `rax`. Weil alles in Register passt, braucht die Methode keinen einzigen Stack-Slot.',
    },
    {
      codeLine: 2,
      highlight: { asm: [asmLine('imul     ecx'), asmLine('imul     edx'), asmLine('lea')] },
      state: {
        stages: stages('s-codegen'),
        facts: [
          fact('f-rep', 'Darstellung', 'Maschinencode x64'),
          fact('f-size', 'Größe', '10 Byte'),
          fact('f-gc', 'GC-Info', 'keine Verweise zu melden'),
          fact('f-unwind', 'Unwind-Info', 'ohne Prolog fast leer'),
        ],
      },
      changed: ['s-codegen', 'f-rep', 'f-size', 'f-gc', 'f-unwind'],
      explanation:
        'Der Codegenerator legt den Frame fest, erzeugt für jeden Knoten Instruktionen und baut Prolog und Epilog. Der **Emitter** kodiert daraus Bytes. Nebenbei entstehen die Tabellen, die die Runtime später braucht: GC-Info, Unwind-Info und die Zuordnung von IL-Offsets zu Maschinencode.',
    },
    {
      codeLine: 1,
      highlight: {
        asm: [asmLine('imul     ecx'), asmLine('imul     edx'), asmLine('lea'), asmLine('ret')],
      },
      state: {
        stages: stages(null),
        facts: [
          fact('f-rep', 'Darstellung', 'Maschinencode x64'),
          fact('f-size', 'Größe', '10 Byte'),
          fact('f-ee', 'Abgabe an die Runtime', 'allocMem, allocUnwindInfo, GC-Info'),
          fact('f-entry', 'Einstiegspunkt', 'zeigt jetzt auf den neuen Code'),
        ],
      },
      changed: ['f-ee', 'f-entry'],
      explanation:
        'Den Speicher für Code und Tabellen bekommt der JIT von der Runtime, er schreibt nur hinein. Danach gibt er die Kontrolle zurück, und die Runtime stellt den Einstiegspunkt von `SumSquares` auf den fertigen Code um. Aus sechs IL-Instruktionen und zwei Aufrufen sind drei Rechenbefehle und ein `ret` geworden.',
    },
  ],
});
