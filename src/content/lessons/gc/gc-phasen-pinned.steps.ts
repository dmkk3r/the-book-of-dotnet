import { defineStepScript, type GcHeapState } from '@/components/viz';

// Compaction around a pinned plug. Addresses are fictional but consistent.
// TODO(verify): Object sizes on x64 (Node 32 B, byte[200] 224 B, byte[64] 88 B).
// TODO(verify): Whether the pinned plug and the free space in front of it stay in gen0
// (demotion) or are promoted with the rest; the view keeps one ephemeral range on purpose.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'eph', kind: 'gen0', label: 'Ephemerer Bereich (Ausschnitt)' },
];

const before = (
  s: Partial<Record<'a' | 'g1' | 'buf' | 'g2' | 'b', Status>> = {},
  l: Partial<Record<'a' | 'g1' | 'buf' | 'g2' | 'b', string>> = {},
): Obj[] => [
  { id: 'a', region: 'eph', label: l.a ?? 'A: Node @4000', sizeBytes: 32, status: s.a },
  { id: 'g1', region: 'eph', label: l.g1 ?? 'byte[200] @4020', sizeBytes: 224, status: s.g1 },
  {
    id: 'buf',
    region: 'eph',
    label: l.buf ?? 'buffer: byte[64] @4100',
    sizeBytes: 88,
    status: s.buf,
    pinned: true,
  },
  { id: 'g2', region: 'eph', label: l.g2 ?? 'byte[200] @4158', sizeBytes: 224, status: s.g2 },
  { id: 'b', region: 'eph', label: l.b ?? 'B: Node @4238', sizeBytes: 32, status: s.b },
];

const roots: GcHeapState['roots'] = [
  { id: 'r-a', label: 'a (Stack)', refs: ['a'] },
  { id: 'r-h', label: 'h (GCHandle, Pinned)', refs: ['buf'] },
  { id: 'r-b', label: 'b (Stack)', refs: ['b'] },
];

const live = { a: 'live', g1: 'dead', buf: 'live', g2: 'dead', b: 'live' } as const;

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Kompaktieren mit einem fixierten Objekt',
  code: {
    cs: `var a = new Node();
_ = new byte[200];                                    // Müll
var buffer = new byte[64];
var h = GCHandle.Alloc(buffer, GCHandleType.Pinned);  // fixiert
_ = new byte[200];                                    // Müll
var b = new Node();
GC.Collect(0);
h.Free();`,
  },
  steps: [
    {
      codeLine: 6,
      state: { regions, objects: before(), roots, phase: 'alloc' },
      changed: ['buf', 'r-h'],
      explanation:
        'Zwischen zwei normalen Objekten liegt `buffer`, fixiert über ein Pinned-Handle. Solange das Handle existiert, darf sich seine Adresse nicht ändern, etwa weil nativer Code gerade hineinschreibt.',
    },
    {
      codeLine: 7,
      state: { regions, objects: before(live), roots, phase: 'mark' },
      changed: ['a', 'buf', 'b'],
      explanation:
        'Die Markierphase findet `A`, `buffer` und `B`. Für `buffer` meldet die Root-Quelle zusätzlich, dass das Objekt fixiert ist, und der GC vermerkt das am Objekt selbst.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: before(live, {
          a: 'Plug: A @4000 → 4000',
          g1: 'Lücke (224 B)',
          buf: 'Fixierter Plug: buffer @4100 → 4100',
          g2: 'Lücke (224 B)',
          b: 'Plug: B @4238 → 4158',
        }),
        roots,
        phase: 'plan',
      },
      changed: ['buf', 'b', 'g1'],
      explanation:
        '`buffer` bildet einen **fixierten Plug**: Seine neue Adresse ist seine alte. Damit endet das Zusammenschieben an dieser Stelle, `B` kann nur bis direkt hinter `buffer` rutschen. Die Lücke vor `buffer` lässt sich nicht schließen.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          { id: 'a', region: 'eph', label: 'A: Node @4000', sizeBytes: 32, status: 'live' },
          { id: 'free', region: 'eph', label: 'Free-Objekt @4020', sizeBytes: 224 },
          {
            id: 'buf',
            region: 'eph',
            label: 'buffer: byte[64] @4100',
            sizeBytes: 88,
            status: 'live',
            pinned: true,
          },
          { id: 'b', region: 'eph', label: 'B: Node @4158', sizeBytes: 32, status: 'live' },
        ],
        roots,
        phase: 'compact',
      },
      changed: ['free', 'b'],
      explanation:
        'Nach dem Kompaktieren steht `B` direkt hinter `buffer`. Vor `buffer` bleibt ein Loch, das der GC zu einem **Free-Objekt** macht. Häufige Fehlannahme: Pinning koste nur etwas, solange der GC gerade läuft. Das Loch bleibt aber auch danach.',
    },
    {
      codeLine: 8,
      state: {
        regions,
        objects: [
          { id: 'a', region: 'eph', label: 'A: Node @4000', sizeBytes: 32 },
          {
            id: 'free',
            region: 'eph',
            label: 'Free-Objekt @4020 (wiederverwendbar)',
            sizeBytes: 224,
          },
          { id: 'buf', region: 'eph', label: 'buffer: byte[64] @4100', sizeBytes: 88 },
          { id: 'b', region: 'eph', label: 'B: Node @4158', sizeBytes: 32 },
        ],
        roots: [
          { id: 'r-a', label: 'a (Stack)', refs: ['a'] },
          { id: 'r-b', label: 'b (Stack)', refs: ['b'] },
        ],
        phase: 'done',
      },
      changed: ['buf', 'free'],
      explanation:
        'Nach `h.Free()` ist `buffer` wieder ein gewöhnliches Objekt. Der freie Platz davor kann für spätere Allokationen genutzt werden, doch ein einzelnes fixiertes Objekt hat die Kompaktierung dieser Collection durchlöchert. Viele kurz fixierte Puffer machen daraus echte Fragmentierung.',
    },
  ],
});
