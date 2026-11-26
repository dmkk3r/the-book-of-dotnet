import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual scenario without sizes. Which generation a pinned gen0 survivor ends up in depends
// on GC heuristics.
// TODO(verify): Demotion of pinned gen0 survivors (they may stay in gen0 so the space around them
// remains usable for gen0 allocations) in segments and in regions (.NET 7+), see gc.cpp.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'poh', kind: 'poh' },
];

const req = (i: number, status?: Status): Obj => ({
  id: `r${i}`,
  region: 'g0',
  label: `Anfrage ${i}`,
  status,
});
const bufA = (status?: Status): Obj => ({
  id: 'a',
  region: 'g0',
  label: 'byte[] (a)',
  pinned: true,
  status,
});
const bufB = (status?: Status): Obj => ({
  id: 'b',
  region: 'poh',
  label: 'byte[] (b)',
  status,
});
const gap = (id: string): Obj => ({ id, region: 'g0', label: 'frei' });

const handle = { id: 'r-h', label: 'h (Pinned-Handle)', refs: ['a'] };
const rootB = { id: 'r-b', label: 'b', refs: ['b'] };

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Langlebig fixierter Puffer in Gen0 und auf dem POH',
  code: {
    cs: `// Variante A: normales Array, für die ganze I/O-Operation fixiert
var a = new byte[4096];
var h = GCHandle.Alloc(a, GCHandleType.Pinned);
StartNativeRead(h.AddrOfPinnedObject());   // fertig erst viel später

// Variante B: Array auf dem Pinned Object Heap
var b = GC.AllocateArray<byte>(4096, pinned: true);
StartNativeRead(Marshal.UnsafeAddrOfPinnedArrayElement(b, 0));`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        regions,
        objects: [req(1), bufA(), req(2)],
        roots: [handle],
        phase: 'alloc',
      },
      changed: ['a', 'r-h'],
      explanation:
        'Variante A: Der Puffer liegt mitten zwischen anderen jungen Objekten in Gen0. Das Pinned-Handle hält ihn fixiert, bis die native Operation fertig ist und jemand `h.Free()` aufruft.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [req(1, 'dead'), bufA('live'), req(2, 'dead')],
        roots: [handle],
        phase: 'plan',
      },
      changed: ['r1', 'r2'],
      explanation:
        'Eine Gen0-Collection: Die Anfrageobjekte sind tot, `a` lebt und darf nicht bewegt werden. Gen0 kann deshalb nicht zu einem einzigen freien Block werden.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [gap('f1'), bufA('live'), gap('f2')],
        roots: [handle],
        phase: 'done',
      },
      changed: ['a', 'f1', 'f2'],
      explanation:
        'Statt den fixierten Puffer nach Gen1 zu promoten und den Bereich um ihn herum zu verlieren, lässt der GC ihn oft in Gen0 liegen (**Demotion**). Die Lücken davor und dahinter werden wieder für Allokationen verwendet.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [req(3), bufA(), req(4), req(5)],
        roots: [handle],
        phase: 'alloc',
      },
      changed: ['r3', 'r4', 'r5'],
      explanation:
        'Neue Anfragen füllen die Lücken. Der Puffer steckt weiter mittendrin, und zwar so lange, wie die I/O-Operation dauert, oft über viele Collections hinweg.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [gap('f1'), bufA('live'), gap('f2')],
        roots: [handle],
        phase: 'done',
      },
      changed: ['f1', 'f2'],
      explanation:
        'Jede weitere Gen0-Collection wiederholt das Spiel: Der GC muss den pinned plug einplanen, Gen0 bleibt zerstückelt. Mit Hunderten solcher Puffer bei vielen gleichzeitigen Verbindungen wird daraus ernsthafte Fragmentierung.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [req(6), req(7), req(8), bufB()],
        roots: [rootB],
        phase: 'alloc',
      },
      changed: ['b', 'r-b'],
      explanation:
        'Variante B: Der Puffer kommt mit `pinned: true` auf den **POH**. In Gen0 liegen nur noch die kurzlebigen Anfrageobjekte. Ein Handle ist nicht nötig, denn auf dem POH bewegt sich nie etwas.',
    },
    {
      codeLine: 8,
      state: {
        regions,
        objects: [req(6, 'dead'), req(7, 'dead'), req(8, 'dead'), bufB()],
        roots: [rootB],
        phase: 'plan',
      },
      changed: ['r6', 'r7', 'r8'],
      explanation:
        'Die nächste Gen0-Collection findet nur tote Objekte. Der POH ist an ihr gar nicht beteiligt.',
    },
    {
      codeLine: 8,
      state: { regions, objects: [bufB()], roots: [rootB], phase: 'done' },
      explanation:
        'Gen0 ist danach komplett frei, ohne einen einzigen pinned plug. Genau dafür gibt es den POH: langlebig fixierte Puffer aus den jungen Generationen herauszuhalten.',
    },
  ],
});
