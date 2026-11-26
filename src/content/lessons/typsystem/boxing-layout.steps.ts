import { defineStepScript, type LayoutState } from '@/components/viz';

// TODO(verify): Box sizes on x64: int 24 B, struct Pair (long + int) 32 B.

const intBox: LayoutState = {
  title: 'Box eines int',
  totalSize: 24,
  parts: [
    { id: 'i-hdr', name: 'Object Header', offset: 0, size: 8, kind: 'header' },
    { id: 'i-mt', name: 'MethodTable Int32', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'i-val', name: 'Wert = 42', type: 'int', offset: 16, size: 4, kind: 'field' },
    { id: 'i-pad', name: 'Padding', offset: 20, size: 4, kind: 'padding' },
  ],
  note: 'Für 4 Byte Nutzdaten belegt die Box 24 Byte.',
};

const pairBox: LayoutState = {
  title: 'Box eines struct Pair { long A; int B; }',
  totalSize: 32,
  parts: [
    { id: 'p-hdr', name: 'Object Header', offset: 0, size: 8, kind: 'header' },
    { id: 'p-mt', name: 'MethodTable Pair', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'p-a', name: 'A', type: 'long', offset: 16, size: 8, kind: 'field' },
    { id: 'p-b', name: 'B', type: 'int', offset: 24, size: 4, kind: 'field' },
    { id: 'p-pad', name: 'Padding', offset: 28, size: 4, kind: 'padding' },
  ],
  note: 'Der Inhalt der Box ist genau das Struct mit seinem eigenen Layout und Padding.',
};

export default defineStepScript({
  view: 'layout',
  title: 'Aufbau einer Box Schritt für Schritt',
  code: {
    cs: `object a = 42;
object b = new Pair { A = 1, B = 2 };

struct Pair { public long A; public int B; }`,
  },
  steps: [
    {
      codeLine: 1,
      state: intBox,
      changed: ['i-hdr', 'i-mt'],
      explanation:
        'Eine Box ist ein ganz normales Objekt. Sie beginnt wie jedes Objekt mit **Object Header** und **MethodTable-Zeiger**. Die MethodTable ist die des Werttyps, hier `Int32`. Daran erkennt `unbox`, was in der Box steckt.',
    },
    {
      codeLine: 1,
      state: intBox,
      changed: ['i-val', 'i-pad'],
      explanation:
        'Danach folgt die Kopie des Werts. Weil Objekte auf 8 Byte ausgerichtet werden, kommt Padding hinzu. Aus 4 Byte Nutzdaten werden 24 Byte auf dem Heap.',
    },
    {
      codeLine: 2,
      state: pairBox,
      changed: ['p-a', 'p-b', 'p-pad'],
      explanation:
        'Bei einem eigenen Struct steht dessen kompletter Inhalt in der Box, mit genau dem Layout, das das Struct auch auf dem Stack hätte. Größere Structs ergeben größere Boxen.',
    },
  ],
});
