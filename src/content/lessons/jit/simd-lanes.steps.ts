import { defineStepScript, type LayoutState } from '@/components/viz';

// Lanes of vector registers. Byte order is little endian, lane 0 at the lowest address.
// Vector<T> sizes: 32 bytes on x64 with AVX2 (also on AVX-512 hardware unless
// DOTNET_MaxVectorTBitWidth=512 is set), 16 bytes on Arm64 with AdvSimd (also with SVE in .NET 9).
// Sources: "Use SIMD and hardware intrinsics in .NET" (Microsoft Learn, MaxVectorTBitWidth) and
// "What's new in .NET 9 runtime" (Arm64 SVE: Vector<T> is 128 bits).
// TODO(verify): Vector<T> width on x64 without AVX2 (16 bytes) and on x64 with AVX but without AVX2.

type Part = LayoutState['parts'][number];

const intLanes = (values: string[], prefix: string, offset = 0): Part[] =>
  values.map((value, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix}${i}: ${value}`,
    type: 'int',
    offset: offset + i * 4,
    size: 4,
    kind: 'field',
  }));

const BYTES = [
  '01',
  '00',
  '00',
  '00',
  '02',
  '00',
  '00',
  '00',
  '03',
  '00',
  '00',
  '00',
  '04',
  '00',
  '00',
  '00',
];

export default defineStepScript({
  view: 'layout',
  title: 'Lanes in Vektorregistern',
  code: {
    cs: `Vector128<int>  a = Vector128.Create(1, 2, 3, 4);
Vector128<byte> b = a.AsByte();                  // dieselben 16 Byte
Vector128<int>  c = a + Vector128.Create(10);
Vector256<int>  d = Vector256.Create(1, 2, 3, 4, 5, 6, 7, 8);
Vector<int>     e = new Vector<int>(1);          // Breite hängt von der CPU ab
Console.WriteLine(Vector<int>.Count);`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        title: 'Vector128<int> a: 16 Byte, 4 Lanes',
        totalSize: 16,
        bytesPerRow: 16,
        parts: intLanes(['1', '2', '3', '4'], 'a'),
      },
      changed: ['a0', 'a1', 'a2', 'a3'],
      explanation:
        'Ein `Vector128<int>` sind 16 Byte, aufgeteilt in vier Lanes zu je 4 Byte. Lane 0 liegt an der niedrigsten Adresse. Im Register ist das ein einziger Wert, den ein Befehl als Ganzes verarbeitet.',
    },
    {
      codeLine: 2,
      state: {
        title: 'Vector128<byte> b: dieselben 16 Byte, 16 Lanes',
        totalSize: 16,
        bytesPerRow: 16,
        parts: BYTES.map((value, i) => ({
          id: `b${i}`,
          name: value,
          type: 'byte',
          offset: i,
          size: 1,
          kind: 'field',
        })),
        note: 'Little Endian: die 1 aus Lane 0 steht im ersten Byte',
      },
      changed: BYTES.map((_, i) => `b${i}`),
      explanation:
        '`AsByte` ändert kein einziges Bit, nur die Sicht: Dieselben 16 Byte gelten jetzt als 16 Lanes zu 1 Byte. Der Elementtyp `T` legt fest, wie breit eine Lane ist und welche Befehle der JIT wählt.',
    },
    {
      codeLine: 3,
      state: {
        title: 'Vector128<int> c = a + <10, 10, 10, 10>',
        totalSize: 16,
        bytesPerRow: 16,
        parts: intLanes(['11', '12', '13', '14'], 'c'),
      },
      changed: ['c0', 'c1', 'c2', 'c3'],
      explanation:
        'Der Operator `+` addiert Lane für Lane. Auf x64 wird daraus ein `paddd` oder `vpaddd`, auf Arm64 ein `add` auf einem Vektorregister. Das Ergebnis ist wieder ein vollständiger Vektor.',
    },
    {
      codeLine: 4,
      state: {
        title: 'Vector256<int> d: 32 Byte, 8 Lanes',
        totalSize: 32,
        bytesPerRow: 16,
        parts: intLanes(['1', '2', '3', '4', '5', '6', '7', '8'], 'd'),
      },
      changed: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'],
      explanation:
        'Ein `Vector256<int>` ist doppelt so breit: 32 Byte, acht Lanes, auf x64 ein `ymm`-Register. Beschleunigt ist er nur, wenn die CPU AVX2 hat. Auf Arm64 gibt es keine 256-Bit-Register, dort meldet `Vector256.IsHardwareAccelerated` den Wert `false`.',
    },
    {
      codeLine: 5,
      state: {
        title: 'Vector<int> e auf x64 mit AVX2: 32 Byte',
        totalSize: 32,
        bytesPerRow: 16,
        parts: intLanes(['1', '1', '1', '1', '1', '1', '1', '1'], 'e'),
        note: 'Vector<int>.Count = 8',
      },
      changed: ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'],
      explanation:
        '`Vector<T>` hat keine feste Breite. Die Runtime legt sie beim Start fest, passend zur CPU, und für den Rest des Prozesses bleibt sie gleich. Auf einem typischen x64-Rechner mit AVX2 sind es 32 Byte.',
    },
    {
      codeLine: 6,
      state: {
        title: 'Vector<int> e auf Arm64: 16 Byte',
        totalSize: 16,
        bytesPerRow: 16,
        parts: intLanes(['1', '1', '1', '1'], 'e'),
        note: 'Vector<int>.Count = 4',
      },
      changed: ['e0', 'e1', 'e2', 'e3'],
      explanation:
        'Häufige Fehlannahme: `Vector<T>` sei immer 256 Bit breit. Derselbe Code auf einem Arm64-Server bekommt 16 Byte und vier Lanes. Selbst auf x64 mit AVX-512 bleibt `Vector<T>` standardmäßig bei 256 Bit.',
    },
  ],
});
