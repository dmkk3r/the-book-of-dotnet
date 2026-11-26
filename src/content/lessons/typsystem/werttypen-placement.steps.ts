import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.
// TODO(verify): Object sizes on x64 (Line 32 B, PointS[2] 40 B, PointC[2] 40 B, PointC 24 B).

type Obj = MemoryState['heap'][number];
const line: Obj = {
  id: 'line',
  type: 'Line',
  address: '0x7F3A0800',
  generation: 0,
  fields: [
    { name: 'Start.X', value: '1' },
    { name: 'Start.Y', value: '2' },
    { name: 'End.X', value: '3' },
    { name: 'End.Y', value: '4' },
  ],
  sizeBytes: 32,
};
const structArray: Obj = {
  id: 'sarr',
  type: 'PointS[2]',
  address: '0x7F3A0830',
  generation: 0,
  fields: [
    { name: 'Length', value: '2' },
    { name: '[0]', value: '{ X = 1, Y = 2 }' },
    { name: '[1]', value: '{ X = 3, Y = 4 }' },
  ],
  sizeBytes: 40,
};
const classArray: Obj = {
  id: 'carr',
  type: 'PointC[2]',
  address: '0x7F3A0860',
  generation: 0,
  fields: [
    { name: 'Length', value: '2' },
    { name: '[0]', value: '0x7F3A0890', ref: 'pc0' },
    { name: '[1]', value: '0x7F3A08A8', ref: 'pc1' },
  ],
  sizeBytes: 40,
};
const pc = (id: string, addr: string, x: string, y: string): Obj => ({
  id,
  type: 'PointC',
  address: addr,
  generation: 0,
  fields: [
    { name: 'X', value: x },
    { name: 'Y', value: y },
  ],
  sizeBytes: 24,
});

type Slot = MemoryState['frames'][number]['slots'][number];
const slots = (n: number): Slot[] => [
  { id: 'p', name: 'p', type: 'PointS (8 Byte)', value: '{ X = 1, Y = 2 }' },
  ...(n >= 2
    ? [{ id: 'l', name: 'l', type: 'Line (Verweis)', value: '0x7F3A0800', ref: 'line' }]
    : []),
  ...(n >= 3
    ? [{ id: 's', name: 's', type: 'PointS[] (Verweis)', value: '0x7F3A0830', ref: 'sarr' }]
    : []),
  ...(n >= 4
    ? [{ id: 'c', name: 'c', type: 'PointC[] (Verweis)', value: '0x7F3A0860', ref: 'carr' }]
    : []),
];
const state = (n: number): MemoryState => ({
  frames: [{ id: 'main', method: 'Main()', slots: slots(n) }],
  heap: [
    ...(n >= 2 ? [line] : []),
    ...(n >= 3 ? [structArray] : []),
    ...(n >= 4
      ? [classArray, pc('pc0', '0x7F3A0890', '1', '2'), pc('pc1', '0x7F3A08A8', '3', '4')]
      : []),
  ],
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Wo Werttypen liegen Schritt für Schritt',
  code: {
    cs: `struct PointS { public int X, Y; }
class  PointC { public int X, Y; }
class  Line   { public PointS Start, End; }

var p = new PointS { X = 1, Y = 2 };
var l = new Line { Start = p, End = new PointS { X = 3, Y = 4 } };
var s = new PointS[] { p, new PointS { X = 3, Y = 4 } };
var c = new PointC[] { new PointC { X = 1, Y = 2 }, new PointC { X = 3, Y = 4 } };`,
  },
  steps: [
    {
      codeLine: 5,
      state: state(1),
      changed: ['p'],
      explanation:
        'Eine lokale Variable vom Typ `PointS` enthält das Struct selbst, beide Felder direkt im Stack-Frame. Auf dem Heap passiert nichts.',
    },
    {
      codeLine: 6,
      state: state(2),
      changed: ['l', 'line'],
      explanation:
        '`Line` ist eine Klasse und liegt auf dem Heap. Ihre Felder `Start` und `End` sind Structs und liegen **mitten im Line-Objekt**, Feld für Feld. Das Struct `p` wurde dabei hineinkopiert. Hier liegt also ein Werttyp auf dem Heap.',
    },
    {
      codeLine: 7,
      state: state(3),
      changed: ['s', 'sarr'],
      explanation:
        'Ein Array von Structs ist ein einziges Objekt. Die Elemente stehen direkt hintereinander im Array, ohne weitere Objekte und ohne Verweise. Das ist kompakt und für die CPU besonders schnell zu durchlaufen.',
    },
    {
      codeLine: 8,
      state: state(4),
      changed: ['c', 'carr', 'pc0', 'pc1'],
      explanation:
        'Ein Array von Klassen enthält nur **Verweise**. Jeder Punkt ist ein eigenes Objekt mit eigenem Header und MethodTable-Zeiger. Dieselben Daten belegen hier drei Objekte statt einem.',
    },
  ],
});
