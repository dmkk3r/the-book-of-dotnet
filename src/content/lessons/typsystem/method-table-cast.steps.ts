import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. MethodTables live in the loader heap (not GC heap).
// TODO(verify): Cast helper behaviour (exact MT compare fast path, then parent chain walk) in
// casthelpers.cs / JIT cast helpers for the current runtime.

type Obj = MemoryState['heap'][number];
const mt = (id: string, type: string, addr: string, parent: string | null): Obj => ({
  id,
  type: `MethodTable ${type} (Loader Heap)`,
  address: addr,
  fields: [
    parent === null
      ? { name: 'Basistyp', value: 'keiner' }
      : { name: 'Basistyp', value: `→ ${parent}`, ref: `mt-${parent.toLowerCase()}` },
  ],
});
const heap: Obj[] = [
  {
    id: 'puppy',
    type: 'Puppy',
    address: '0x7F3A0A00',
    generation: 0,
    fields: [{ name: 'MethodTable', value: '→ Puppy', ref: 'mt-puppy' }],
  },
  mt('mt-puppy', 'Puppy', '0x7FFA1400', 'Dog'),
  mt('mt-dog', 'Dog', '0x7FFA1200', 'Animal'),
  mt('mt-animal', 'Animal', '0x7FFA1000', 'Object'),
  mt('mt-object', 'Object', '0x7FFA0100', null),
];
const frames: MemoryState['frames'] = [
  {
    id: 'main',
    method: 'Main()',
    slots: [{ id: 'o', name: 'o', type: 'object (Verweis)', value: '0x7F3A0A00', ref: 'puppy' }],
  },
];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Typprüfung Schritt für Schritt',
  code: {
    cs: `class Animal { }
class Dog : Animal { }
class Puppy : Dog { }

object o = new Puppy();
Console.WriteLine(o is Puppy);
Console.WriteLine(o is Animal);
Console.WriteLine(o is string);`,
  },
  steps: [
    {
      codeLine: 5,
      state: { frames, heap },
      changed: ['puppy', 'mt-puppy'],
      explanation:
        'Jede MethodTable verweist auf die MethodTable ihres Basistyps. So entsteht eine Kette von `Puppy` über `Dog` und `Animal` bis `Object`.',
    },
    {
      codeLine: 6,
      state: { frames, heap, output: 'True' },
      changed: ['puppy.MethodTable'],
      explanation:
        '`o is Puppy`: Die Runtime liest den MethodTable-Zeiger des Objekts und vergleicht ihn mit der MethodTable von `Puppy`. Gleich, also `True`. Das ist der schnellste Fall: ein einziger Zeigervergleich.',
    },
    {
      codeLine: 7,
      state: { frames, heap, output: 'True' },
      changed: ['mt-puppy.Basistyp', 'mt-dog.Basistyp'],
      explanation:
        '`o is Animal`: Die MethodTable von `Puppy` ist nicht `Animal`. Die Runtime folgt deshalb der Kette der Basistypen: `Puppy`, dann `Dog`, dann `Animal`.',
    },
    {
      codeLine: 7,
      state: { frames, heap, output: 'True\nTrue' },
      changed: ['mt-animal'],
      explanation:
        'Bei `Animal` ist der Treffer da: `True`. Je tiefer die Hierarchie, desto länger der Weg. In der Praxis sind die Ketten kurz, und die Runtime hat für häufige Fälle zusätzliche Abkürzungen.',
    },
    {
      codeLine: 8,
      state: { frames, heap, output: 'True\nTrue\nFalse' },
      changed: ['mt-object'],
      explanation:
        '`o is string`: Die Kette endet bei `Object`, ohne `String` zu treffen, also `False`. Häufige Fehlannahme: Ein Cast koste immer gleich viel. Ein Vergleich mit dem exakten Typ ist billiger als einer, der die Hierarchie durchsucht, und Interfaces werden noch einmal anders geprüft.',
    },
  ],
});
