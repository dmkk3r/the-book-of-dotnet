import { defineStepScript, type MemoryState } from '@/components/viz';

// The same call as in calling-conventions.steps.ts, now fully optimized (Windows x64).
// Frames newest first, slots from low to high addresses. Addresses fictional, consistent with the
// first script: at the call, the caller's rsp is 0x0E7FF550.
// Sources: Microsoft Learn "x64 calling convention" and "x64 prolog and epilog" (sub rsp in the
// prolog, 16-byte alignment, leaf functions without frame), BOTR clr-abi.md.
// TODO(verify): Hand-written approximation of FullOpts code (e.g. DOTNET_TieredCompilation=0):
// Main's frame of 40 bytes (32 shadow + 8 for the fifth argument, which also restores alignment),
// Sum5 without prolog using lea/add and [rsp+0x28], Add5 inlined and folded to the constant 15.

type Slot = MemoryState['frames'][number]['slots'][number];
type Frame = MemoryState['frames'][number];
const slot = (id: string, name: string, type: string, value: string): Slot => ({
  id,
  name,
  type,
  value,
});

function mainFrame(e: string): Frame {
  return {
    id: 'g-main',
    method: 'Main() (voll optimiert)',
    slots: [
      slot('g-shadow', 'Shadow Space', '0x0E7FF550, 32 B für den Aufgerufenen', 'reserviert'),
      slot('g-e', 'e (5. Argument)', '0x0E7FF570, [rsp+0x20]', e),
      slot('g-ret', 'Rücksprungadresse', '0x0E7FF578, in den Aufrufer von Main', '→ Host'),
    ],
  };
}
const sumFrame: Frame = {
  id: 'g-sum',
  method: 'Sum5 (ohne Prolog)',
  slots: [slot('g-sret', 'Rücksprungadresse', '0x0E7FF548, [rsp]', '→ Main')],
};

const state = (e: string, inSum: boolean, output?: string): MemoryState => ({
  frames: [...(inSum ? [sumFrame] : []), mainFrame(e)],
  heap: [],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Derselbe Aufruf voll optimiert',
  code: {
    cs: `int r = Sum5(1, 2, 3, 4, 5);
int s = Add5(1, 2, 3, 4, 5);
Console.WriteLine(r + s);

[MethodImpl(MethodImplOptions.NoInlining)]
static int Sum5(int a, int b, int c, int d, int e) => a + b + c + d + e;

static int Add5(int a, int b, int c, int d, int e) => a + b + c + d + e;`,
    asm: `; Main (FullOpts, Ausschnitt)
sub      rsp, 40
mov      dword ptr [rsp+0x20], 5
mov      ecx, 1
mov      edx, 2
mov      r8d, 3
mov      r9d, 4
call     Sum5
add      eax, 15
mov      ecx, eax
call     System.Console:WriteLine(int)
nop
add      rsp, 40
ret

; Sum5 (FullOpts)
lea      eax, [rcx+rdx]
add      eax, r8d
add      eax, r9d
add      eax, dword ptr [rsp+0x28]
ret`,
  },
  steps: [
    {
      codeLine: 1,
      highlight: { asm: [2] },
      state: state('frei', false),
      changed: ['g-shadow', 'g-e'],
      explanation:
        'Der ganze Prolog von `Main` ist ein einziges `sub rsp, 40`: 32 Byte Shadow Space plus 8 Byte für das fünfte Argument. Die 40 stellen nebenbei die 16-Byte-Ausrichtung wieder her. Es gibt **keinen Framepointer**, der Code adressiert alles über `rsp`.',
    },
    {
      codeLine: 1,
      highlight: { asm: [3, 4, 5, 6, 7, 8] },
      state: state('5', true),
      changed: ['g-e', 'g-sum', 'g-sret'],
      explanation:
        'Argumente wie gehabt: vier in Registern, eines bei `[rsp+0x20]`. Nach dem `call` besteht der „Frame“ von `Sum5` nur aus der Rücksprungadresse, die `call` selbst abgelegt hat.',
    },
    {
      codeLine: 6,
      highlight: { asm: [17, 18, 19, 20] },
      state: state('5', true),
      changed: ['g-e'],
      explanation:
        '`Sum5` ist eine **Blattmethode**: Sie ruft nichts auf, sichert kein Register und braucht keine Locals im Speicher. Also hat sie keinen Prolog. Das fünfte Argument liest sie über `[rsp+0x28]`, an der Rücksprungadresse und dem Shadow Space vorbei.',
    },
    {
      codeLine: 6,
      highlight: { asm: [21] },
      state: state('5', false),
      changed: ['g-main'],
      explanation:
        '`ret` nimmt die Rücksprungadresse vom Stack, fertig. Ein Stack Walker, der in `Sum5` anhält, findet keinen gesicherten Framepointer. Er braucht die **Unwind-Info**, die sagt: In dieser Methode wurde am Stack nichts verändert.',
    },
    {
      codeLine: 2,
      highlight: { asm: [9] },
      state: state('5', false),
      explanation:
        '`Add5` wurde eingebettet und zur Konstanten 15 gefaltet. Es gibt keinen Aufruf, keine Argumente, keine Rücksprungadresse und **keinen Frame**. Die Vorstellung, jede Methode im Quelltext habe zur Laufzeit einen eigenen Frame, ist damit widerlegt.',
    },
    {
      codeLine: 3,
      highlight: { asm: [10, 11, 12, 13, 14] },
      state: state('5', false, '30'),
      explanation:
        '`WriteLine` bekommt sein Argument in `ecx` und nutzt denselben Shadow Space, den `Main` schon reserviert hat. Ein Frame reserviert den Platz für ausgehende Argumente einmal für alle Aufrufe, die er macht.',
    },
  ],
});
