import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. MethodTables live in the loader heap (not GC heap).
// TODO(verify): Slot index of Speak (after the four virtual methods of System.Object) and the
// three-instruction call sequence in JIT asm (SharpLab, x64, Release).

type Obj = MemoryState['heap'][number];
const animal = (id: 'dog' | 'cat', addr: string): Obj => ({
  id,
  type: id === 'dog' ? 'Dog' : 'Cat',
  address: addr,
  generation: 0,
  fields: [{ name: 'MethodTable', value: id === 'dog' ? '→ Dog' : '→ Cat', ref: `mt-${id}` }],
});
const mt = (id: 'dog' | 'cat'): Obj => ({
  id: `mt-${id}`,
  type: `MethodTable ${id === 'dog' ? 'Dog' : 'Cat'} (Loader Heap)`,
  address: id === 'dog' ? '0x7FFA1200' : '0x7FFA1300',
  fields: [
    { name: 'Slot 0 bis 3', value: 'Object-Methoden' },
    { name: 'Slot 4: Speak', value: id === 'dog' ? '→ Dog.Speak' : '→ Cat.Speak' },
  ],
});
const frame = (target: 'dog' | 'cat' | null): MemoryState['frames'] => [
  {
    id: 'main',
    method: 'Main()',
    slots: [
      {
        id: 'a',
        name: 'a',
        type: 'Animal (Verweis)',
        value: target === null ? 'null' : target === 'dog' ? '0x7F3A0600' : '0x7F3A0618',
        ...(target ? { ref: target } : {}),
      },
    ],
  },
];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Virtueller Aufruf Schritt für Schritt',
  code: {
    cs: `abstract class Animal { public abstract string Speak(); }
class Dog : Animal { public override string Speak() => "Wuff"; }
class Cat : Animal { public override string Speak() => "Miau"; }

Animal a = new Dog();
Console.WriteLine(a.Speak());
a = new Cat();
Console.WriteLine(a.Speak());`,
  },
  steps: [
    {
      codeLine: 5,
      state: { frames: frame('dog'), heap: [animal('dog', '0x7F3A0600'), mt('dog')] },
      changed: ['a', 'dog'],
      explanation:
        '`a` hat den statischen Typ `Animal`, zeigt aber auf ein `Dog`. Welche `Speak`-Methode gemeint ist, weiß der Compiler deshalb nicht. Das entscheidet sich erst zur Laufzeit.',
    },
    {
      codeLine: 6,
      state: { frames: frame('dog'), heap: [animal('dog', '0x7F3A0600'), mt('dog')] },
      changed: ['dog.MethodTable'],
      explanation:
        'Erster Schritt des Aufrufs: Die CPU lädt aus dem Objekt den **MethodTable-Zeiger**.',
    },
    {
      codeLine: 6,
      state: {
        frames: frame('dog'),
        heap: [animal('dog', '0x7F3A0600'), mt('dog')],
        output: 'Wuff',
      },
      changed: ['mt-dog.Slot 4: Speak'],
      explanation:
        'Zweiter und dritter Schritt: Aus der MethodTable wird der Eintrag an einer **festen Position** gelesen, dem Slot von `Speak`, und dorthin gesprungen. Es wird nichts per Name gesucht.',
    },
    {
      codeLine: 7,
      state: {
        frames: frame('cat'),
        heap: [animal('dog', '0x7F3A0600'), mt('dog'), animal('cat', '0x7F3A0618'), mt('cat')],
      },
      changed: ['a', 'cat'],
      explanation:
        'Jetzt zeigt `a` auf ein `Cat`. Dessen MethodTable hat `Speak` im **selben Slot**, nur mit anderem Ziel. Das garantiert die Runtime beim Laden der Typen.',
    },
    {
      codeLine: 8,
      state: {
        frames: frame('cat'),
        heap: [animal('dog', '0x7F3A0600'), mt('dog'), animal('cat', '0x7F3A0618'), mt('cat')],
        output: 'Wuff\nMiau',
      },
      changed: ['mt-cat.Slot 4: Speak'],
      explanation:
        'Derselbe Maschinencode an der Aufrufstelle landet diesmal in `Cat.Speak`. Häufige Fehlannahme: Virtuelle Aufrufe seien teuer, weil gesucht wird. Die Kosten sind zwei Speicherzugriffe und ein indirekter Sprung, vor allem aber verhindern sie ohne weitere Optimierung das Inlining.',
    },
  ],
});
