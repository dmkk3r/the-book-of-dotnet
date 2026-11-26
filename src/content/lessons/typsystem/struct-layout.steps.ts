import { defineStepScript, type LayoutState } from '@/components/viz';

// TODO(verify): Sizes 24 B and 16 B with Unsafe.SizeOf<T>() on x64 (.NET 8+).

const ungünstig = (): LayoutState => ({
  title: 'struct Ungünstig (LayoutKind.Sequential)',
  totalSize: 24,
  parts: [
    { id: 'u-a', name: 'A', type: 'byte', offset: 0, size: 1, kind: 'field' },
    { id: 'u-pad1', name: 'Padding', offset: 1, size: 7, kind: 'padding' },
    { id: 'u-b', name: 'B', type: 'long', offset: 8, size: 8, kind: 'field' },
    { id: 'u-c', name: 'C', type: 'byte', offset: 16, size: 1, kind: 'field' },
    { id: 'u-pad2', name: 'Padding', offset: 17, size: 7, kind: 'padding' },
  ],
});

const günstig: LayoutState = {
  title: 'struct Günstig (LayoutKind.Sequential)',
  totalSize: 16,
  parts: [
    { id: 'g-b', name: 'B', type: 'long', offset: 0, size: 8, kind: 'field' },
    { id: 'g-a', name: 'A', type: 'byte', offset: 8, size: 1, kind: 'field' },
    { id: 'g-c', name: 'C', type: 'byte', offset: 9, size: 1, kind: 'field' },
    { id: 'g-pad', name: 'Padding', offset: 10, size: 6, kind: 'padding' },
  ],
};

export default defineStepScript({
  view: 'layout',
  title: 'Struct-Layout Schritt für Schritt',
  code: {
    cs: `struct Ungünstig { byte A; long B; byte C; }
struct Günstig   { long B; byte A; byte C; }

Console.WriteLine(Unsafe.SizeOf<Ungünstig>());
Console.WriteLine(Unsafe.SizeOf<Günstig>());`,
  },
  steps: [
    {
      codeLine: 1,
      state: ungünstig(),
      changed: ['u-a'],
      explanation:
        'Structs sind standardmäßig `Sequential`: Die Felder liegen in der Reihenfolge der Deklaration. `A` belegt ein Byte bei Offset 0.',
    },
    {
      codeLine: 1,
      state: ungünstig(),
      changed: ['u-pad1', 'u-b'],
      explanation:
        'Ein `long` braucht eine durch 8 teilbare Adresse. Damit `B` bei Offset 8 beginnt, fügt die Runtime **7 Byte Padding** ein, die nie benutzt werden.',
    },
    {
      codeLine: 1,
      state: ungünstig(),
      changed: ['u-c', 'u-pad2'],
      explanation:
        'Auch am Ende wird aufgefüllt: Die Größe muss ein Vielfaches der größten Ausrichtung (8) sein, damit in einem Array jedes Element korrekt ausgerichtet ist. Ergebnis: **24 Byte** für 10 Byte Nutzdaten.',
    },
    {
      codeLine: 2,
      state: günstig,
      changed: ['g-b', 'g-a', 'g-c'],
      explanation:
        'Dieselben Felder, nur umsortiert: Das große Feld zuerst, die kleinen dicht dahinter. Es bleibt nur das Padding am Ende, die Größe sinkt auf **16 Byte**.',
    },
    {
      codeLine: 5,
      state: günstig,
      changed: ['g-pad'],
      explanation:
        'Häufige Fehlannahme: „Der Compiler sortiert das schon.“ Bei Structs mit `Sequential` tut er das nicht. Bei Klassen (`LayoutKind.Auto`) darf die Runtime Felder dagegen selbst anordnen.',
    },
  ],
});
