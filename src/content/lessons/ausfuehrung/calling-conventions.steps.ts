import { defineStepScript, type MemoryState } from '@/components/viz';

// One call with five int arguments on Windows x64, unoptimized (Tier 0 style) so that every
// value lands in the frame. Frames are listed newest first; inside a frame, slots go from low to
// high addresses (the stack grows towards lower addresses).
// Addresses are fictional but consistent: the return address slot R = 0x0E7FF548, so the caller's
// rsp at the call is R + 8 = 0x0E7FF550 (16-byte aligned, as the Windows x64 ABI requires).
// Sources: Microsoft Learn "x64 calling convention" (rcx, rdx, r8, r9, 32-byte home/shadow space,
// 16-byte alignment at the call, fifth argument at [rsp+0x20] of the caller) and BOTR clr-abi.md.
// TODO(verify): The listing is a hand-written approximation of Tier 0 code (no zero init of
// locals shown, frame size 16, homing of rcx..r9 into the shadow space by the callee). Compare
// with DOTNET_JitDisasm=Sum5 and DOTNET_TieredCompilation settings on .NET 8+ x64 Windows.

type Slot = MemoryState['frames'][number]['slots'][number];
type Frame = MemoryState['frames'][number];

const slot = (id: string, name: string, type: string, value: string): Slot => ({
  id,
  name,
  type,
  value,
});

interface Main {
  home: [string, string, string, string];
  e: string;
  r: string;
}
interface Callee {
  t: string | null; // null: prolog not run yet
  rbp: boolean;
}

const FREE = 'frei';

function mainFrame(m: Main): Frame {
  return {
    id: 'f-main',
    method: 'Main() (Aufrufer)',
    slots: [
      slot('m-h1', 'Home a (für rcx)', '0x0E7FF550, Shadow Space', m.home[0]),
      slot('m-h2', 'Home b (für rdx)', '0x0E7FF558, Shadow Space', m.home[1]),
      slot('m-h3', 'Home c (für r8)', '0x0E7FF560, Shadow Space', m.home[2]),
      slot('m-h4', 'Home d (für r9)', '0x0E7FF568, Shadow Space', m.home[3]),
      slot('m-e', 'e (5. Argument)', '0x0E7FF570, [rsp+0x20] des Aufrufers', m.e),
      slot('m-r', 'r (lokal)', 'int, weiter oben im Frame', m.r),
    ],
  };
}

function calleeFrame(c: Callee): Frame {
  return {
    id: 'f-sum',
    method: 'Sum5(int, int, int, int, int)',
    slots: [
      ...(c.t !== null ? [slot('s-t', 't (lokal)', '0x0E7FF53C, [rbp-0x04]', c.t)] : []),
      ...(c.rbp ? [slot('s-rbp', 'gesichertes rbp', '0x0E7FF540, [rbp]', 'rbp von Main')] : []),
      slot('s-ret', 'Rücksprungadresse', '0x0E7FF548, [rbp+0x08]', '→ Main'),
    ],
  };
}

const state = (m: Main, c?: Callee, output?: string): MemoryState => ({
  frames: [...(c ? [calleeFrame(c)] : []), mainFrame(m)],
  heap: [],
  ...(output !== undefined ? { output } : {}),
});

const empty: Main['home'] = [FREE, FREE, FREE, FREE];
const homed: Main['home'] = ['1', '2', '3', '4'];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Ein Aufruf mit fünf Argumenten unter Windows x64',
  code: {
    cs: `int r = Sum5(1, 2, 3, 4, 5);
Console.WriteLine(r);

[MethodImpl(MethodImplOptions.NoInlining)]
static int Sum5(int a, int b, int c, int d, int e)
{
    int t = a + b + c + d;
    return t + e;
}`,
    asm: `; Main (Tier 0, Ausschnitt)
mov      dword ptr [rsp+0x20], 5
mov      ecx, 1
mov      edx, 2
mov      r8d, 3
mov      r9d, 4
call     Sum5
mov      dword ptr [rbp-0x04], eax

; Sum5 (Tier 0, vereinfacht)
push     rbp
sub      rsp, 16
lea      rbp, [rsp+0x10]
mov      dword ptr [rbp+0x10], ecx
mov      dword ptr [rbp+0x18], edx
mov      dword ptr [rbp+0x20], r8d
mov      dword ptr [rbp+0x28], r9d
mov      eax, dword ptr [rbp+0x10]
add      eax, dword ptr [rbp+0x18]
add      eax, dword ptr [rbp+0x20]
add      eax, dword ptr [rbp+0x28]
mov      dword ptr [rbp-0x04], eax
mov      eax, dword ptr [rbp-0x04]
add      eax, dword ptr [rbp+0x30]
add      rsp, 16
pop      rbp
ret`,
  },
  steps: [
    {
      codeLine: 1,
      state: state({ home: empty, e: FREE, r: '0' }),
      explanation:
        'Oben im Bild liegen niedrigere Adressen, der Stack wächst nach oben. `Main` hat in seinem Prolog schon Platz für ausgehende Argumente reserviert: 32 Byte **Shadow Space** für die vier Registerargumente und dahinter einen Slot für das fünfte. Noch steht nichts darin.',
    },
    {
      codeLine: 1,
      highlight: { asm: [2] },
      state: state({ home: empty, e: '5', r: '0' }),
      changed: ['m-e'],
      explanation:
        'Nur das **fünfte** Argument geht in den Speicher, und zwar in den Frame des Aufrufers bei `[rsp+0x20]`. Die ersten 32 Byte darüber bleiben frei, sie gehören zum Shadow Space.',
    },
    {
      codeLine: 1,
      highlight: { asm: [3, 4, 5, 6] },
      state: state({ home: empty, e: '5', r: '0' }),
      explanation:
        'Die ersten vier Argumente landen in `rcx`, `rdx`, `r8` und `r9`, also gar nicht im Speicher. Die Annahme, alle Argumente lägen auf dem Stack, stimmt für x64 nicht: Der Stack ist hier nur der Überlauf. Der Shadow Space bleibt leer, der Aufrufer schreibt nie hinein.',
    },
    {
      codeLine: 1,
      highlight: { asm: [7] },
      state: state({ home: empty, e: '5', r: '0' }, { t: null, rbp: false }),
      changed: ['f-sum', 's-ret'],
      explanation:
        '`call` legt die **Rücksprungadresse** auf den Stack und springt. `rsp` zeigt jetzt auf diese Adresse und ist deshalb um 8 Byte von der 16-Byte-Grenze verschoben. Das ist bei jedem Methodeneintritt so, und der Prolog gleicht es aus.',
    },
    {
      codeLine: 6,
      highlight: { asm: [11, 12, 13] },
      state: state({ home: empty, e: '5', r: '0' }, { t: '0', rbp: true }),
      changed: ['s-rbp', 's-t'],
      explanation:
        'Der **Prolog**: `push rbp` sichert den Framepointer des Aufrufers, `sub rsp, 16` schafft Platz für Locals, `lea` setzt `rbp` auf den neuen Frame. Ab jetzt adressiert der Code alles relativ zu `rbp`: Locals bei negativen, Argumente bei positiven Offsets.',
    },
    {
      codeLine: 6,
      highlight: { asm: [14, 15, 16, 17] },
      state: state({ home: homed, e: '5', r: '0' }, { t: '0', rbp: true }),
      changed: ['m-h1', 'm-h2', 'm-h3', 'm-h4'],
      explanation:
        'Unoptimierter Code legt die Registerargumente in den Shadow Space ab, der dafür reserviert war (**Homing**). So hat jedes Argument eine feste Adresse, was Debugger und einfacher Code mögen. Beachte: Der Aufgerufene schreibt in den Frame des Aufrufers, genau dafür gibt es den Platz.',
    },
    {
      codeLine: 7,
      highlight: { asm: [18, 19, 20, 21, 22] },
      state: state({ home: homed, e: '5', r: '0' }, { t: '10', rbp: true }),
      changed: ['s-t'],
      explanation:
        'Die Summe der ersten vier Argumente landet im Local `t` bei `[rbp-0x04]`. Optimierter Code würde `t` nie in den Speicher schreiben, sondern in einem Register halten.',
    },
    {
      codeLine: 8,
      highlight: { asm: [23, 24] },
      state: state({ home: homed, e: '5', r: '0' }, { t: '10', rbp: true }),
      changed: ['m-e'],
      explanation:
        'Für `e` greift `Sum5` bei `[rbp+0x30]` in den Frame von `Main`: Rücksprungadresse (8 Byte) und Shadow Space (32 Byte) liegen dazwischen. Das Ergebnis 15 steht in `eax`, dem Rückgaberegister.',
    },
    {
      codeLine: 8,
      highlight: { asm: [25, 26, 27] },
      state: state({ home: homed, e: '5', r: '0' }),
      changed: ['f-main'],
      explanation:
        'Der **Epilog** macht den Prolog rückwärts: `add rsp, 16`, `pop rbp`, dann nimmt `ret` die Rücksprungadresse vom Stack. Der Frame von `Sum5` ist weg, ohne dass etwas gelöscht wurde. Die Werte im Shadow Space bleiben als Reste liegen.',
    },
    {
      codeLine: 1,
      highlight: { asm: [8] },
      state: state({ home: homed, e: '5', r: '15' }),
      changed: ['m-r'],
      explanation:
        'Zurück in `Main` liest der Code das Ergebnis aus `eax` und speichert es in `r`. Der reservierte Bereich für ausgehende Argumente bleibt bestehen und wird beim nächsten Aufruf wiederverwendet.',
    },
    {
      codeLine: 2,
      state: state({ home: homed, e: '5', r: '15' }, undefined, '15'),
      explanation:
        'Ohne das Homing von Tier 0 hätte nur eines der fünf Argumente je den Speicher berührt. Wie dieselbe Methode voll optimiert aussieht, zeigt die Visualisierung weiter unten.',
    },
  ],
});
