import { defineStepScript, type LayoutState } from '@/components/viz';

// Vectorized sum of 1..11 with Vector128<int>: two full vectors, then a scalar tail of three
// elements. The layout shows two 16-byte registers, one per row: xmm1 holds the freshly loaded
// vector v, xmm0 the accumulator acc. Lane 0 sits at the lowest address (little endian).
// TODO(verify): The asm tab is a simplified sketch for x64 with AVX (Windows), assuming rcx points
// to the first element and edx holds the length; the real JIT output passes the span differently,
// may unroll, uses other registers and labels, and may implement Vector128.Sum with other
// instructions (for example vphaddd or shuffles plus vpaddd).
// TODO(verify): RyuJIT (up to .NET 10/11) has no general loop auto-vectorizer for a plain scalar
// summation loop.

type Lanes = [string, string, string, string];
const EMPTY: Lanes = ['leer', 'leer', 'leer', 'leer'];

function regs(v: Lanes, acc: Lanes, note?: string): LayoutState {
  return {
    title: 'oben xmm1 (v), unten xmm0 (acc), je 4 Lanes zu 4 Byte',
    totalSize: 32,
    bytesPerRow: 16,
    parts: [
      ...v.map((value, i) => ({
        id: `v${i}`,
        name: `v${i}: ${value}`,
        type: 'int',
        offset: i * 4,
        size: 4,
        kind: 'field' as const,
      })),
      ...acc.map((value, i) => ({
        id: `acc${i}`,
        name: `acc${i}: ${value}`,
        type: 'int',
        offset: 16 + i * 4,
        size: 4,
        kind: 'field' as const,
      })),
    ],
    ...(note ? { note } : {}),
  };
}

const ACC_IDS = ['acc0', 'acc1', 'acc2', 'acc3'];
const V_IDS = ['v0', 'v1', 'v2', 'v3'];

export default defineStepScript({
  view: 'layout',
  title: 'Eine vektorisierte Summe Schritt für Schritt',
  code: {
    cs: `static int Sum(ReadOnlySpan<int> data)        // data = 1, 2, ..., 11
{
    var acc = Vector128<int>.Zero;
    int i = 0;
    for (; i <= data.Length - Vector128<int>.Count; i += Vector128<int>.Count)
    {
        var v = Vector128.Create(data.Slice(i));  // liest 4 Elemente
        acc += v;
    }
    int sum = Vector128.Sum(acc);
    for (; i < data.Length; i++)
        sum += data[i];
    return sum;
}`,
    asm: `; vereinfacht: x64 mit AVX, rcx = Daten, edx = Länge
vxorps   xmm0, xmm0, xmm0              ; acc = 0
xor      eax, eax                      ; i = 0
lea      r8d, [rdx-4]                  ; Length - Count
test     r8d, r8d
jl       SHORT TAIL
LOOP:
vmovdqu  xmm1, xmmword ptr [rcx+4*rax] ; v laden (16 Byte)
vpaddd   xmm0, xmm0, xmm1              ; 4 Additionen in einem Befehl
add      eax, 4
cmp      eax, r8d
jle      SHORT LOOP
TAIL:
vphaddd  xmm0, xmm0, xmm0              ; Nachbar-Lanes addieren
vphaddd  xmm0, xmm0, xmm0
vmovd    r9d, xmm0                     ; sum = Lane 0
cmp      eax, edx
jge      SHORT DONE
REST:
add      r9d, dword ptr [rcx+4*rax]    ; skalarer Rest
inc      eax
cmp      eax, edx
jl       SHORT REST
DONE:
mov      eax, r9d
ret`,
  },
  steps: [
    {
      codeLine: 3,
      highlight: { asm: [2, 3] },
      state: regs(EMPTY, ['0', '0', '0', '0']),
      changed: ACC_IDS,
      explanation:
        'Der Akkumulator ist ein ganzes Register mit vier `int`-Lanes, alle null. Jede Lane wird eine eigene Teilsumme führen: Lane 0 summiert die Elemente 0, 4, 8 und so weiter.',
    },
    {
      codeLine: 7,
      highlight: { asm: [8] },
      state: regs(['1', '2', '3', '4'], ['0', '0', '0', '0']),
      changed: V_IDS,
      explanation:
        'Ein einziger Ladebefehl holt 16 Byte, also vier Elemente, in `xmm1`. `Vector128.Create(span)` prüft dabei, dass genug Elemente da sind. Die Schleifenbedingung garantiert das, deshalb kann der JIT die Prüfung meist entfernen.',
    },
    {
      codeLine: 8,
      highlight: { asm: [9] },
      state: regs(['1', '2', '3', '4'], ['1', '2', '3', '4']),
      changed: ACC_IDS,
      explanation:
        '`acc += v` wird zu **einem** Befehl, der vier unabhängige Additionen ausführt, Lane für Lane. Zwischen den Lanes fließt nichts: Lane 2 von `acc` sieht nur Lane 2 von `v`.',
    },
    {
      codeLine: 7,
      highlight: { asm: [10, 11, 12, 8] },
      state: regs(['5', '6', '7', '8'], ['1', '2', '3', '4']),
      changed: V_IDS,
      explanation:
        '`i` springt um `Vector128<int>.Count`, also um 4. Der JIT kennt diesen Wert beim Übersetzen und setzt ihn als Konstante ein. Der nächste Ladebefehl holt die Elemente 4 bis 7.',
    },
    {
      codeLine: 8,
      highlight: { asm: [9] },
      state: regs(['5', '6', '7', '8'], ['6', '8', '10', '12']),
      changed: ACC_IDS,
      explanation:
        'Wieder vier Additionen in einem Befehl. Nach zwei Durchläufen hat die Schleife acht Elemente verarbeitet, aber nur zwei Additionsbefehle gebraucht statt acht.',
    },
    {
      codeLine: 5,
      highlight: { asm: [10, 11, 12] },
      state: regs(
        ['5', '6', '7', '8'],
        ['6', '8', '10', '12'],
        'i = 8, Length - Count = 7: Schleife endet',
      ),
      explanation:
        'Jetzt ist `i` gleich 8, es bleiben nur noch drei Elemente. Ein weiterer Ladebefehl würde über das Ende der Daten hinaus lesen, deshalb endet die Vektorschleife hier. Genau diese Grenze ist die häufigste Fehlerquelle in vektorisiertem Code.',
    },
    {
      codeLine: 10,
      highlight: { asm: [14, 15, 16] },
      state: regs(
        ['5', '6', '7', '8'],
        ['6', '8', '10', '12'],
        'Vector128.Sum(acc) = 6 + 8 + 10 + 12 = 36',
      ),
      explanation:
        '`Vector128.Sum` addiert die Lanes untereinander, eine **horizontale** Operation. Sie ist teurer als eine Addition Lane für Lane, deshalb kommt sie nur einmal am Ende und nicht in jedem Durchlauf.',
    },
    {
      codeLine: 12,
      highlight: { asm: [20, 21, 22, 23] },
      state: regs(
        ['5', '6', '7', '8'],
        ['6', '8', '10', '12'],
        'skalarer Rest: 36 + 9 + 10 + 11 = 66',
      ),
      explanation:
        'Die skalare Schleife erledigt die letzten drei Elemente einzeln. Häufige Fehlannahme: Der JIT würde eine schlichte Summen-Schleife von selbst so umbauen. RyuJIT vektorisiert solche Schleifen nicht automatisch, die Vektorschleife musst du selbst schreiben oder einer Bibliothek überlassen.',
    },
  ],
});
