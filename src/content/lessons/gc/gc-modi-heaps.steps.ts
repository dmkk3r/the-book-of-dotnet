import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual picture of Server GC with two heaps. Verified (Microsoft Learn, workstation-server-gc):
// one heap per logical CPU, all heaps accessible by user code, objects on different heaps can
// refer to each other, heaps collected at the same time. Verified (Maoni Stephens, mem-doc): the
// gen0 budget is equalized across heaps and any heap exhausting its gen0 budget triggers the
// next GC.
// TODO(verify): A thread's allocation context is normally served from the heap associated with the
// core it runs on, and the allocator can move a thread to a less used heap (heap balancing,
// balance_heaps in gc.cpp). Not verified in detail.

type Obj = GcHeapState['objects'][number];

const regions: GcHeapState['regions'] = [
  { id: 'h0g0', kind: 'gen0', label: 'Heap 0: Gen0' },
  { id: 'h1g0', kind: 'gen0', label: 'Heap 1: Gen0' },
  { id: 'h0g1', kind: 'gen1', label: 'Heap 0: Gen1' },
  { id: 'h1g1', kind: 'gen1', label: 'Heap 1: Gen1' },
];

const o = (
  id: string,
  region: string,
  label: string,
  status?: Obj['status'],
  refs?: string[],
): Obj => ({ id, region, label, status, refs });

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Mehrere Heaps bei Server GC',
  code: {
    cs: `// Thread A läuft auf Kern 0, Thread B auf Kern 1
var order = new Order();            // Thread A
var line = new OrderLine(order);    // Thread B, verweist auf order
var tmp = new byte[4096];           // Thread A, kurzlebig
// ... Gen0-Budget eines Heaps erschöpft: GC`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        regions,
        objects: [o('order', 'h0g0', 'Order')],
        roots: [{ id: 'ra', label: 'Thread A: order', refs: ['order'] }],
        phase: 'alloc',
      },
      changed: ['order'],
      explanation:
        'Server GC hat hier zwei Heaps, jeder mit eigenen Generationen. Thread A alloziert über seinen **Allocation Context**, und der liegt in einem bestimmten Heap, hier Heap 0. Die Allokation selbst braucht keine Sperre.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [
          o('order', 'h0g0', 'Order'),
          o('line', 'h1g0', 'OrderLine', undefined, ['order']),
        ],
        roots: [
          { id: 'ra', label: 'Thread A: order', refs: ['order'] },
          { id: 'rb', label: 'Thread B: line', refs: ['line'] },
        ],
        phase: 'alloc',
      },
      changed: ['line'],
      explanation:
        'Thread B alloziert in Heap 1. Die `OrderLine` verweist auf die `Order` in Heap 0. Das ist erlaubt: Alle Heaps bilden **einen** verwalteten Heap, Objekte dürfen sich über Heapgrenzen hinweg referenzieren.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [
          o('order', 'h0g0', 'Order'),
          o('tmp1', 'h0g0', 'byte[4096]'),
          o('tmp2', 'h0g0', 'byte[4096]'),
          o('tmp3', 'h0g0', 'byte[4096]'),
          o('line', 'h1g0', 'OrderLine', undefined, ['order']),
        ],
        roots: [
          { id: 'ra', label: 'Thread A: order', refs: ['order'] },
          { id: 'rb', label: 'Thread B: line', refs: ['line'] },
        ],
        phase: 'alloc',
      },
      changed: ['tmp1', 'tmp2', 'tmp3'],
      explanation:
        'Thread A alloziert viel mehr als Thread B. Jeder Heap hat dasselbe Gen0-Budget, und sobald **ein** Heap seines erschöpft, gibt es eine GC über alle Heaps. Damit ein einzelner fleißiger Thread nicht ständig GCs auslöst, kann der Allokator ihn auf einen weniger genutzten Heap umlenken (Heap Balancing).',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [
          o('order', 'h0g0', 'Order', 'marked'),
          o('tmp1', 'h0g0', 'byte[4096]', 'unknown'),
          o('tmp2', 'h0g0', 'byte[4096]', 'unknown'),
          o('tmp3', 'h0g0', 'byte[4096]', 'unknown'),
          o('line', 'h1g0', 'OrderLine', 'marked', ['order']),
        ],
        roots: [
          { id: 'ra', label: 'Thread A: order', refs: ['order'] },
          { id: 'rb', label: 'Thread B: line', refs: ['line'] },
        ],
        phase: 'mark',
      },
      changed: ['order', 'line'],
      explanation:
        'Die Collection: Jeder GC-Thread markiert parallel, ausgehend von den Roots. Verweise über Heapgrenzen werden dabei genauso verfolgt wie innerhalb eines Heaps. Für dein Programm ist es egal, in welchem Heap ein Objekt liegt.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [
          o('order', 'h0g1', 'Order', 'live'),
          o('line', 'h1g1', 'OrderLine', 'live', ['order']),
        ],
        roots: [
          { id: 'ra', label: 'Thread A: order', refs: ['order'] },
          { id: 'rb', label: 'Thread B: line', refs: ['line'] },
        ],
        phase: 'done',
      },
      changed: ['order', 'line'],
      explanation:
        'Die Überlebenden werden nach Gen1 promotet, die Puffer sind weg. Jeder Heap wurde von seinem eigenen GC-Thread bearbeitet. Mehr Heaps heißt mehr parallele Arbeit, aber auch: mehr Gen0-Budgets, die gleichzeitig mit Müll gefüllt sein dürfen.',
    },
  ],
});
