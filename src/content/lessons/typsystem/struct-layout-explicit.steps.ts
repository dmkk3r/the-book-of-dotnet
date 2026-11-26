import { defineStepScript, type LayoutState } from '@/components/viz';

// Overlapping fields cannot be drawn as separate bytes, so each step shows one view of the same
// 8 bytes. TODO(verify): Union layout and the resulting size of 8 B (Unsafe.SizeOf).

const asLong: LayoutState = {
  title: 'struct Number, Sicht über AsLong',
  totalSize: 8,
  parts: [
    { id: 'long', name: 'AsLong (Offset 0)', type: 'long', offset: 0, size: 8, kind: 'field' },
  ],
};
const asDouble: LayoutState = {
  title: 'struct Number, Sicht über AsDouble',
  totalSize: 8,
  parts: [
    {
      id: 'double',
      name: 'AsDouble (Offset 0)',
      type: 'double',
      offset: 0,
      size: 8,
      kind: 'field',
    },
  ],
};
const asInts: LayoutState = {
  title: 'struct Number, Sicht über Low und High',
  totalSize: 8,
  parts: [
    { id: 'low', name: 'Low (Offset 0)', type: 'int', offset: 0, size: 4, kind: 'field' },
    { id: 'high', name: 'High (Offset 4)', type: 'int', offset: 4, size: 4, kind: 'field' },
  ],
  note: 'Alle drei Sichten beschreiben dieselben 8 Byte. Das Struct ist insgesamt nur 8 Byte groß.',
};

export default defineStepScript({
  view: 'layout',
  title: 'Explizites Layout Schritt für Schritt',
  code: {
    cs: `[StructLayout(LayoutKind.Explicit)]
struct Number
{
    [FieldOffset(0)] public long   AsLong;
    [FieldOffset(0)] public double AsDouble;
    [FieldOffset(0)] public int    Low;
    [FieldOffset(4)] public int    High;
}`,
  },
  steps: [
    {
      codeLine: 4,
      state: asLong,
      changed: ['long'],
      explanation:
        'Mit `LayoutKind.Explicit` legst du die Position jedes Felds selbst fest. `AsLong` beginnt bei Offset 0 und belegt alle 8 Byte.',
    },
    {
      codeLine: 5,
      state: asDouble,
      changed: ['double'],
      explanation:
        '`AsDouble` beginnt **ebenfalls** bei Offset 0. Beide Felder teilen sich denselben Speicher. Schreibst du `AsDouble`, liest `AsLong` danach die Bits der Gleitkommazahl als Ganzzahl.',
    },
    {
      codeLine: 7,
      state: asInts,
      changed: ['low', 'high'],
      explanation:
        '`Low` und `High` zerlegen dieselben 8 Byte in zwei Hälften. So ein Struct nennt man eine **Union**. Die Runtime erlaubt Überlappung nur unter Werttypen: Ein Verweis darf sich nicht mit anderen Feldern überlappen, sonst wäre er für den GC nicht mehr eindeutig.',
    },
  ],
});
