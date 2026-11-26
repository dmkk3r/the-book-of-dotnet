import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.

type Obj = MemoryState['heap'][number];
const arr = (first: string | null): Obj => ({
  id: 'arr',
  type: 'string[2]',
  address: '0x7F3A0B00',
  generation: 0,
  fields: [
    { name: 'MethodTable', value: '→ string[]' },
    { name: 'Length', value: '2' },
    first ? { name: '[0]', value: '0x7F3A0B28', ref: 'str' } : { name: '[0]', value: 'null' },
    { name: '[1]', value: 'null' },
  ],
});
const str: Obj = {
  id: 'str',
  type: 'string',
  address: '0x7F3A0B28',
  generation: 0,
  fields: [{ name: 'Inhalt', value: '"a"' }],
};
const boxed: Obj = {
  id: 'box',
  type: 'Int32 (geboxt)',
  address: '0x7F3A0B48',
  generation: 0,
  fields: [{ name: 'Wert', value: '42' }],
};
const frames: MemoryState['frames'] = [
  {
    id: 'main',
    method: 'Main()',
    slots: [
      { id: 'objs', name: 'objs', type: 'object[] (Verweis)', value: '0x7F3A0B00', ref: 'arr' },
    ],
  },
];

export default defineStepScript({
  view: 'memory',
  title: 'Array-Kovarianz Schritt für Schritt',
  code: {
    cs: `object[] objs = new string[2];
objs[0] = "a";
objs[1] = 42;          // ArrayTypeMismatchException`,
  },
  steps: [
    {
      codeLine: 1,
      state: { frames, heap: [arr(null)] },
      changed: ['objs', 'arr'],
      explanation:
        'C# erlaubt, ein `string[]` einer Variable vom Typ `object[]` zuzuweisen. Das nennt man **Array-Kovarianz**. Das Array selbst bleibt aber ein `string[]`, seine MethodTable sagt das deutlich.',
    },
    {
      codeLine: 2,
      state: { frames, heap: [arr('a'), str] },
      changed: ['arr.[0]', 'str'],
      explanation:
        'Ein `string` passt in ein `string[]`. Die Runtime hat das trotzdem geprüft: Bei jedem Schreibzugriff auf ein Array von Referenztypen vergleicht sie den Typ des Werts mit dem Elementtyp des Arrays.',
    },
    {
      codeLine: 3,
      state: { frames, heap: [arr('a'), str, boxed], output: 'ArrayTypeMismatchException' },
      changed: ['box'],
      explanation:
        'Laut Compiler ist `objs` ein `object[]`, die 42 wird also geboxt. Zur Laufzeit stellt die Prüfung fest: Eine Box mit `Int32` ist kein `string`. Es folgt eine `ArrayTypeMismatchException`. Ohne diese Prüfung stünde ein `int` in einem `string[]`, und das Typsystem wäre gebrochen.',
    },
  ],
});
