import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. MethodTables live in the loader heap (not GC heap).
// TODO(verify): Slot numbers (System.Object has four virtual methods, so new virtuals start at 4).

type Obj = MemoryState['heap'][number];
const mtAnimal: Obj = {
  id: 'mt-animal',
  type: 'MethodTable Animal (Loader Heap)',
  address: '0x7FFA1000',
  fields: [
    { name: 'Slot 0 bis 3', value: 'Object-Methoden' },
    { name: 'Slot 4', value: '→ Animal.Speak' },
  ],
};
const mtDog: Obj = {
  id: 'mt-dog',
  type: 'MethodTable Dog (Loader Heap)',
  address: '0x7FFA1200',
  fields: [
    { name: 'Slot 0 bis 3', value: 'Object-Methoden' },
    { name: 'Slot 4', value: '→ Dog.Speak (override)' },
    { name: 'Slot 5', value: '→ Dog.Fetch' },
  ],
};
const mtCat: Obj = {
  id: 'mt-cat',
  type: 'MethodTable Cat (Loader Heap)',
  address: '0x7FFA1300',
  fields: [
    { name: 'Slot 0 bis 3', value: 'Object-Methoden' },
    { name: 'Slot 4', value: '→ Animal.Speak (geerbt)' },
    { name: 'Slot 5', value: '→ Cat.Speak (new)' },
  ],
};
const cat: Obj = {
  id: 'cat',
  type: 'Cat',
  address: '0x7F3A0D00',
  generation: 0,
  fields: [{ name: 'MethodTable', value: '→ Cat', ref: 'mt-cat' }],
};
type Slot = MemoryState['frames'][number]['slots'][number];
const frames = (withRefs: boolean): MemoryState['frames'] => [
  {
    id: 'main',
    method: 'Main()',
    slots: [
      ...(withRefs
        ? ([
            {
              id: 'asAnimal',
              name: 'asAnimal',
              type: 'Animal (Verweis)',
              value: '0x7F3A0D00',
              ref: 'cat',
            },
            { id: 'asCat', name: 'asCat', type: 'Cat (Verweis)', value: '0x7F3A0D00', ref: 'cat' },
          ] satisfies Slot[])
        : []),
    ],
  },
];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'override und new Schritt für Schritt',
  code: {
    cs: `class Animal { public virtual string Speak() => "..."; }
class Dog : Animal
{
    public override string Speak() => "Wuff";
    public virtual  string Fetch() => "Stöckchen";
}
class Cat : Animal
{
    public new virtual string Speak() => "Miau";
}

Animal asAnimal = new Cat();
Cat    asCat    = (Cat)asAnimal;
Console.WriteLine(asAnimal.Speak());
Console.WriteLine(asCat.Speak());`,
  },
  steps: [
    {
      codeLine: 1,
      state: { frames: frames(false), heap: [mtAnimal] },
      changed: ['mt-animal.Slot 4'],
      explanation:
        'Die ersten Slots jeder MethodTable gehören den virtuellen Methoden von `Object` wie `ToString` und `Equals`. `Animal` fügt `Speak` als nächsten Slot hinzu.',
    },
    {
      codeLine: 4,
      state: { frames: frames(false), heap: [mtAnimal, mtDog] },
      changed: ['mt-dog.Slot 4', 'mt-dog.Slot 5'],
      explanation:
        '`Dog` erbt alle Slots von `Animal` an **denselben Positionen**. `override` ersetzt nur den Inhalt von Slot 4. Die neue virtuelle Methode `Fetch` bekommt einen neuen Slot dahinter.',
    },
    {
      codeLine: 9,
      state: { frames: frames(false), heap: [mtAnimal, mtDog, mtCat] },
      changed: ['mt-cat.Slot 4', 'mt-cat.Slot 5'],
      explanation:
        '`new` überschreibt nicht, sondern **verdeckt**. Slot 4 behält die geerbte `Animal.Speak`, und `Cat.Speak` bekommt einen eigenen, neuen Slot 5. Es gibt jetzt zwei verschiedene Methoden mit demselben Namen.',
    },
    {
      codeLine: 14,
      state: { frames: frames(true), heap: [mtAnimal, mtCat, cat], output: '...' },
      changed: ['asAnimal', 'mt-cat.Slot 4'],
      explanation:
        'Über eine Variable vom Typ `Animal` kennt der Compiler nur Slot 4. Der enthält bei `Cat` die geerbte `Animal.Speak`. Ausgabe „...“.',
    },
    {
      codeLine: 15,
      state: { frames: frames(true), heap: [mtAnimal, mtCat, cat], output: '...\nMiau' },
      changed: ['asCat', 'mt-cat.Slot 5'],
      explanation:
        'Über eine Variable vom Typ `Cat` wählt der Compiler die neue Methode in Slot 5: „Miau“. Häufige Fehlannahme: `new` und `override` seien austauschbar. Mit `new` hängt das Ergebnis vom **statischen** Typ der Variable ab, mit `override` vom Laufzeittyp des Objekts.',
    },
  ],
});
