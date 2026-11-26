import { defineStepScript, type MemoryState } from '@/components/viz';

// Before and after inlining: one call with NoInlining, one where the JIT inlines Square.
// Frames are shown conceptually: in optimized code x travels in a register (ecx on Windows x64,
// edi on Linux x64), not in a stack slot. The slot "Rücksprung" stands for the return address
// that the call instruction pushes.
// TODO(verify): The whole asm listing (x64, Windows calling convention, Tier 1 / FullOpts) from
// SharpLab or DOTNET_JitDisasm: stack frame setup (sub rsp, 40), "inc eax" vs "add eax, 1",
// and that Compute folds to "mov eax, 50".

type Frame = MemoryState['frames'][number];
type Slot = Frame['slots'][number];

const slot = (id: string, name: string, type: string, value: string): Slot => ({
  id,
  name,
  type,
  value,
});

const main = (a: string, b: string): Frame => ({
  id: 'fr-main',
  method: 'Main()',
  slots: [slot('s-a', 'a', 'int', a), slot('s-b', 'b', 'int', b)],
});
const computeNoInline: Frame = {
  id: 'fr-cni',
  method: 'ComputeNoInline()',
  slots: [slot('s-ret1', 'Rücksprung', 'Adresse', 'in Main')],
};
const squareNoInline: Frame = {
  id: 'fr-sni',
  method: 'SquareNoInline(int)',
  slots: [
    slot('s-ret2', 'Rücksprung', 'Adresse', 'in ComputeNoInline'),
    slot('s-x', 'x', 'int (im Register)', '7'),
  ],
};
const compute = (value: string): Frame => ({
  id: 'fr-c',
  method: 'Compute() mit Square inline',
  slots: [
    slot('s-ret3', 'Rücksprung', 'Adresse', 'in Main'),
    slot('s-res', 'Ergebnis', 'int (im Register)', value),
  ],
});

export default defineStepScript({
  view: 'memory',
  title: 'Ein Aufruf mit und ohne Inlining',
  code: {
    cs: `int a = ComputeNoInline();
int b = Compute();

[MethodImpl(MethodImplOptions.NoInlining)] // nur damit Main nichts einbettet
static int ComputeNoInline() => SquareNoInline(7) + 1;
[MethodImpl(MethodImplOptions.NoInlining)]
static int Compute() => Square(7) + 1;

[MethodImpl(MethodImplOptions.NoInlining)]
static int SquareNoInline(int x) => x * x;
static int Square(int x) => x * x;`,
    asm: `; ComputeNoInline (x64, optimiert)
sub      rsp, 40
mov      ecx, 7
call     SquareNoInline
inc      eax
add      rsp, 40
ret

; SquareNoInline
mov      eax, ecx
imul     eax, ecx
ret

; Compute (Square eingebettet)
mov      eax, 50
ret`,
  },
  steps: [
    {
      codeLine: 5,
      highlight: { asm: [2, 3] },
      state: { frames: [main('?', '?'), computeNoInline], heap: [] },
      changed: ['fr-cni'],
      explanation:
        '`Main` ruft `ComputeNoInline` auf. Die Methode legt einen kleinen Stack-Frame an und lädt das Argument `7` in das Register, in dem die Aufrufkonvention das erste Argument erwartet.',
    },
    {
      codeLine: 10,
      highlight: { asm: [4, 10, 11, 12] },
      state: { frames: [main('?', '?'), computeNoInline, squareNoInline], heap: [] },
      changed: ['fr-sni', 's-ret2', 's-x'],
      explanation:
        '`call` legt die Rücksprungadresse auf den Stack und springt in `SquareNoInline`. Die eigentliche Arbeit sind zwei Instruktionen. Drumherum stehen Aufruf, Rücksprung und das Verwalten des Frames.',
    },
    {
      codeLine: 5,
      highlight: { asm: [5, 6, 7] },
      state: {
        frames: [main('50', '?')],
        heap: [],
        output: 'Stacktrace in SquareNoInline: SquareNoInline, ComputeNoInline, Main',
      },
      changed: ['s-a'],
      explanation:
        'Das Ergebnis `49` kommt im Register zurück, `ComputeNoInline` addiert `1`, räumt seinen Frame ab und kehrt zurück. Jede Methode war ein eigener Frame und taucht deshalb auch einzeln in einem Stacktrace auf.',
    },
    {
      codeLine: 7,
      state: { frames: [main('50', '?'), compute('Square(7) + 1')], heap: [] },
      changed: ['fr-c', 's-res'],
      explanation:
        'Bei `Compute` setzt der JIT den Rumpf von `Square` an die Stelle des Aufrufs. Für ihn steht da jetzt `7 * 7 + 1`. Es gibt keinen Frame für `Square`, keinen `call` und keine Übergabe in Registern.',
    },
    {
      codeLine: 7,
      highlight: { asm: [15, 16] },
      state: { frames: [main('50', '?'), compute('50 (Konstante)')], heap: [] },
      changed: ['s-res'],
      explanation:
        'Jetzt greift die Optimierung, um die es eigentlich geht: Weil alle Werte bekannt sind, rechnet der JIT `7 * 7 + 1` schon beim Übersetzen aus. Übrig bleiben zwei Instruktionen. Häufige Fehlannahme: Inlining spare nur den Aufruf, dabei verschwindet hier die ganze Rechnung.',
    },
    {
      codeLine: 2,
      state: {
        frames: [main('50', '50')],
        heap: [],
        output: 'Stacktrace in Square (eingebettet): Compute, Main',
      },
      changed: ['s-b'],
      explanation:
        'Beide Wege liefern `50`. Der Preis des Inlinings zeigt sich beim Debuggen: Würde im eingebetteten Code eine Exception entstehen, fehlte `Square` im Stacktrace, denn zur Laufzeit gab es diesen Frame nie.',
    },
  ],
});
