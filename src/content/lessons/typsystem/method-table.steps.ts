import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. MethodTable and EEClass live in the loader heap,
// which the GC does not manage; the view labels them accordingly.
// TODO(verify): Which data lives in MethodTable vs. EEClass (BOTR type-system.md, methodtable.h).

type Obj = MemoryState['heap'][number];
const dog = (id: string, addr: string, name: string): Obj => ({
  id,
  type: 'Dog',
  address: addr,
  generation: 0,
  fields: [
    { name: 'MethodTable', value: '→ Dog', ref: 'mt-dog' },
    { name: 'Name', value: name },
  ],
});
const mtDog = (withEEClass: boolean): Obj => ({
  id: 'mt-dog',
  type: 'MethodTable Dog (Loader Heap)',
  address: '0x7FFA1200',
  fields: [
    { name: 'Basisgröße', value: '24 B' },
    { name: 'Basistyp', value: 'Animal' },
    { name: 'Slot Speak', value: '→ Dog.Speak' },
    ...(withEEClass ? [{ name: 'EEClass', value: '→ Dog', ref: 'ee-dog' }] : []),
  ],
});
const eeDog: Obj = {
  id: 'ee-dog',
  type: 'EEClass Dog (Loader Heap)',
  address: '0x7FFA3400',
  fields: [
    { name: 'Felder', value: 'Name: string' },
    { name: 'Metadaten', value: 'Token 0x02000003' },
  ],
};
const frame = (a: boolean, b: boolean): MemoryState['frames'] => [
  {
    id: 'main',
    method: 'Main()',
    slots: [
      {
        id: 'a',
        name: 'a',
        type: 'Dog (Verweis)',
        value: a ? '0x7F3A0500' : 'null',
        ...(a ? { ref: 'd1' } : {}),
      },
      {
        id: 'b',
        name: 'b',
        type: 'Dog (Verweis)',
        value: b ? '0x7F3A0518' : 'null',
        ...(b ? { ref: 'd2' } : {}),
      },
    ],
  },
];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'MethodTable Schritt für Schritt',
  code: {
    cs: `class Animal { public virtual string Speak() => "..."; }
class Dog : Animal
{
    public string Name = "";
    public override string Speak() => "Wuff";
}

var a = new Dog { Name = "Rex" };
var b = new Dog { Name = "Bello" };
Console.WriteLine(a.GetType() == b.GetType());`,
  },
  steps: [
    {
      codeLine: 8,
      state: { frames: frame(true, false), heap: [dog('d1', '0x7F3A0500', '"Rex"'), mtDog(false)] },
      changed: ['d1', 'mt-dog'],
      explanation:
        'Das neue Objekt enthält seine Felder und einen Zeiger auf die **MethodTable** von `Dog`. Sie beschreibt den Typ zur Laufzeit und liegt nicht auf dem GC-Heap, sondern im Loader Heap der Runtime.',
    },
    {
      codeLine: 9,
      state: {
        frames: frame(true, true),
        heap: [dog('d1', '0x7F3A0500', '"Rex"'), dog('d2', '0x7F3A0518', '"Bello"'), mtDog(false)],
      },
      changed: ['d2'],
      explanation:
        'Das zweite `Dog`-Objekt zeigt auf **dieselbe** MethodTable. Pro Typ gibt es eine MethodTable, egal wie viele Objekte existieren.',
    },
    {
      codeLine: 9,
      state: {
        frames: frame(true, true),
        heap: [dog('d1', '0x7F3A0500', '"Rex"'), dog('d2', '0x7F3A0518', '"Bello"'), mtDog(false)],
      },
      changed: ['mt-dog.Basisgröße', 'mt-dog.Slot Speak'],
      explanation:
        'Die MethodTable enthält, was die Runtime ständig braucht: die Größe für Allokation und GC, den Basistyp für Casts und die Einsprungpunkte der virtuellen Methoden.',
    },
    {
      codeLine: 9,
      state: {
        frames: frame(true, true),
        heap: [
          dog('d1', '0x7F3A0500', '"Rex"'),
          dog('d2', '0x7F3A0518', '"Bello"'),
          mtDog(true),
          eeDog,
        ],
      },
      changed: ['mt-dog.EEClass', 'ee-dog'],
      explanation:
        'Seltener benötigte Informationen, etwa Felddeskriptoren und der Bezug zu den Metadaten, stehen in der **EEClass**. Die Aufteilung hält die MethodTable klein, damit die häufigen Zugriffe schnell bleiben.',
    },
    {
      codeLine: 10,
      state: {
        frames: frame(true, true),
        heap: [
          dog('d1', '0x7F3A0500', '"Rex"'),
          dog('d2', '0x7F3A0518', '"Bello"'),
          mtDog(true),
          eeDog,
        ],
        output: 'True',
      },
      explanation:
        '`GetType()` liest den MethodTable-Zeiger des Objekts. Beide Objekte haben denselben, also denselben Typ. Häufige Fehlannahme: Jedes Objekt trage eine eigene Typbeschreibung mit sich.',
    },
  ],
});
