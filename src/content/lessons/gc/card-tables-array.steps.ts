import { defineStepScript, type GcHeapState } from '@/components/viz';

// One large Order[] in the LOH (logically gen2), drawn as four card ranges of the same array.
// TODO(verify): 32 elements per card assumes 256-byte cards (card_size on 64-bit) and 8-byte
// references, i.e. the precise (bitwise) region barrier; the byte-wise barriers mark 2048 bytes
// (256 elements) at once.
// TODO(verify): That the array lives in the LOH here (more than 85,000 bytes) and that LOH cards
// are scanned the same way during ephemeral GCs.

type Obj = GcHeapState['objects'][number];

const range = (i: number, state: string) => ({
  id: `k${i}`,
  kind: 'loh' as const,
  label: `LOH, Karte ${i + 1}: Elemente [${i * 32}] bis [${i * 32 + 31}] (${state})`,
});

const regions = (states: string[]): GcHeapState['regions'] => [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  ...states.map((s, i) => range(i, s)),
];

const part = (i: number, refs: string[] = []): Obj => ({
  id: `p${i}`,
  region: `k${i}`,
  label: `s_recent, Teil ${i + 1}`,
  refs,
});

const order = (i: number, region = 'g0', status?: Obj['status']): Obj => ({
  id: `o${i}`,
  region,
  label: `Order ${i}`,
  status,
});

const roots: GcHeapState['roots'] = [
  { id: 'r-recent', label: 's_recent (statisch)', refs: ['p0'] },
];

const clean = ['sauber', 'sauber', 'sauber', 'sauber'];
const dirty = ['markiert', 'markiert', 'markiert', 'markiert'];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Ein großes Verweis-Array im LOH',
  code: {
    cs: `static Order[] s_recent = new Order[100_000];   // LOH, logisch Gen2

void Record(int i) =>
    s_recent[i % s_recent.Length] = new Order(i);   // Barrier bei jedem Schreiben

// Alternative ohne Verweise:
static OrderData[] s_data = new OrderData[100_000];
void RecordData(int i) =>
    s_data[i % s_data.Length] = new OrderData(i, DateTime.UtcNow);
record struct OrderData(int Id, DateTime At);`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        regions: regions(clean),
        objects: [part(0), part(1), part(2), part(3)],
        roots,
        phase: 'alloc',
      },
      changed: ['k0', 'k1', 'k2', 'k3'],
      explanation:
        'Ein großes Array mit Verweisen lebt seit Programmstart im **Large Object Heap**, der logisch zu Gen2 gehört. Es ist **ein** Objekt, die Teile zeigen nur, welche Karten seine Elemente abdecken. Alle Karten sind sauber.',
    },
    {
      codeLine: 4,
      state: {
        regions: regions(dirty),
        objects: [
          part(0, ['o0']),
          part(1, ['o1']),
          part(2, ['o2']),
          part(3, ['o3']),
          order(0),
          order(1),
          order(2),
          order(3),
        ],
        roots,
        phase: 'alloc',
      },
      changed: ['k0', 'k1', 'k2', 'k3', 'o0', 'o1', 'o2', 'o3'],
      explanation:
        'Der Ringpuffer schreibt fortlaufend neue `Order`-Objekte in seine Elemente. Jede Zuweisung läuft durch die Write Barrier, und weil die Schreibstellen über das ganze Array wandern, wird nach und nach jede Karte markiert.',
    },
    {
      codeLine: 4,
      state: {
        regions: regions(dirty),
        objects: [
          part(0, ['o0']),
          part(1, ['o1']),
          part(2, ['o2']),
          part(3, ['o3']),
          order(0, 'g0', 'marked'),
          order(1, 'g0', 'marked'),
          order(2, 'g0', 'marked'),
          order(3, 'g0', 'marked'),
        ],
        roots,
        phase: 'mark',
      },
      changed: ['p0', 'p1', 'p2', 'p3'],
      explanation:
        'Bei der nächsten Gen0-Collection muss der GC alle markierten Karten durchsuchen, also praktisch das ganze Array, Element für Element. Und alles, was er findet, überlebt, weil das Array es festhält.',
    },
    {
      codeLine: 4,
      state: {
        regions: regions(dirty),
        objects: [
          part(0, ['o0']),
          part(1, ['o1']),
          part(2, ['o2']),
          part(3, ['o3']),
          order(0, 'g1'),
          order(1, 'g1'),
          order(2, 'g1'),
          order(3, 'g1'),
        ],
        roots,
        phase: 'done',
      },
      changed: ['o0', 'o1', 'o2', 'o3'],
      explanation:
        'Die `Order`-Objekte werden promotet und sind immer noch jünger als das Array. Die Karten bleiben markiert, bis die Objekte Gen2 erreichen oder überschrieben werden. Der Puffer erzeugt so dauerhaft teure ephemere Collections und mittel lang lebende Objekte.',
    },
    {
      codeLine: 9,
      state: {
        regions: [
          { id: 'g0', kind: 'gen0' },
          { id: 'g1', kind: 'gen1' },
          { id: 'd0', kind: 'loh', label: 'LOH: s_data (keine Verweise, keine Karten nötig)' },
        ],
        objects: [{ id: 'data', region: 'd0', label: 'OrderData[100000] mit Werten inline' }],
        roots: [{ id: 'r-data', label: 's_data (statisch)', refs: ['data'] }],
        phase: 'done',
      },
      changed: ['d0', 'data'],
      explanation:
        'Speichert das Array Structs ohne Verweisfelder, ist jede Zuweisung ein einfaches Kopieren von Bytes ohne Barrier. Es entstehen keine Objekte in Gen0, keine Karten werden markiert, und der GC muss das Array nie durchsuchen.',
    },
  ],
});
