import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual scenario with rounded sizes (KB), no exact object sizes on purpose. Free gaps are drawn
// as entries labeled "frei"; the real LOH allocator keeps them in a free list.
// TODO(verify): That the LOH allocator can place a new object into a free gap of sufficient size
// (free list fit) and otherwise extends at the end or gets a new region; exact fit policy in gc.cpp.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [{ id: 'loh', kind: 'loh' }];

const buf = (id: string, kb: number, status?: Status): Obj => ({
  id,
  region: 'loh',
  label: `Puffer ${id.toUpperCase()} (${kb} KB)`,
  status,
});
const gap = (id: string, kb: number): Obj => ({ id, region: 'loh', label: `frei (${kb} KB)` });

const rootsAll = [
  { id: 'r-a', label: 'a', refs: ['a'] },
  { id: 'r-b', label: 'b', refs: ['b'] },
  { id: 'r-c', label: 'c', refs: ['c'] },
  { id: 'r-d', label: 'd', refs: ['d'] },
];
const rootsLive = [rootsAll[0], rootsAll[2]];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Fragmentierung im LOH',
  code: {
    cs: `var a = new byte[200_000];
var b = new byte[100_000];
var c = new byte[200_000];
var d = new byte[100_000];
b = null; d = null;
GC.Collect();                       // Gen2, LOH wird nur freigegeben
var e = new byte[150_000];          // passt in keine Lücke
GCSettings.LargeObjectHeapCompactionMode =
    GCLargeObjectHeapCompactionMode.CompactOnce;
GC.Collect();                       // diesmal mit LOH-Kompaktierung`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        regions,
        objects: [buf('a', 200), buf('b', 100), buf('c', 200), buf('d', 100)],
        roots: rootsAll,
        phase: 'alloc',
      },
      changed: ['a', 'b', 'c', 'd'],
      explanation:
        'Vier große Puffer mit gemischten Größen liegen hintereinander im LOH. Solange nichts frei ist, wird einfach am Ende angehängt.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [buf('a', 200), buf('b', 100), buf('c', 200), buf('d', 100)],
        roots: rootsLive,
        phase: 'alloc',
      },
      explanation:
        '`b` und `d` werden nicht mehr gebraucht. Sie sind Müll, aber noch nicht freigegeben.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [
          buf('a', 200, 'live'),
          buf('b', 100, 'dead'),
          buf('c', 200, 'live'),
          buf('d', 100, 'dead'),
        ],
        roots: rootsLive,
        phase: 'sweep',
      },
      changed: ['b', 'd'],
      explanation:
        'Eine volle Collection erkennt `b` und `d` als tot. Weil der LOH standardmäßig nicht kompaktiert wird, rücken `a` und `c` nicht zusammen.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [buf('a', 200, 'live'), gap('f1', 100), buf('c', 200, 'live'), gap('f2', 100)],
        roots: rootsLive,
        phase: 'done',
      },
      changed: ['f1', 'f2'],
      explanation:
        'Zurück bleiben zwei Lücken von je 100 KB, die in der **Freiliste** landen. Insgesamt sind 200 KB frei, aber nicht am Stück.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [buf('a', 200), gap('f1', 100), buf('c', 200), gap('f2', 100), buf('e', 150)],
        roots: [...rootsLive, { id: 'r-e', label: 'e', refs: ['e'] }],
        phase: 'alloc',
      },
      changed: ['e'],
      explanation:
        'Ein neues Array mit 150 KB passt in keine der beiden Lücken. Es muss hinten angehängt werden, der LOH wächst, obwohl rechnerisch genug Platz frei wäre. Das ist **Fragmentierung**.',
    },
    {
      codeLine: 10,
      state: {
        regions,
        objects: [buf('a', 200, 'live'), buf('c', 200, 'live'), buf('e', 150, 'live')],
        roots: [...rootsLive, { id: 'r-e', label: 'e', refs: ['e'] }],
        phase: 'compact',
      },
      changed: ['c', 'e'],
      explanation:
        'Mit `CompactOnce` kompaktiert die nächste blockierende volle Collection auch den LOH: `c` und `e` werden nach vorn kopiert, die Lücken verschwinden. Das kostet das Kopieren von 350 KB, deshalb passiert es nicht standardmäßig.',
    },
    {
      codeLine: 10,
      state: {
        regions,
        objects: [buf('a', 200, 'live'), buf('c', 200, 'live'), buf('e', 150, 'live')],
        roots: [...rootsLive, { id: 'r-e', label: 'e', refs: ['e'] }],
        phase: 'done',
      },
      explanation:
        'Danach setzt die Runtime die Einstellung von selbst auf `Default` zurück. Weitere Collections geben den LOH wieder nur frei, bis du `CompactOnce` erneut setzt.',
    },
  ],
});
