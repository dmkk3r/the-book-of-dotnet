import { defineStepScript, type GcHeapState } from '@/components/viz';

// TODO(verify): Object sizes on x64 (byte[4096] = 4120 B, byte[64] = 88 B), that GC.AllocateArray
// with pinned: true places the array on the POH regardless of size, and that GC.GetGeneration
// returns 2 for a POH object.
// TODO(verify): That a pinned gen0 survivor stays in gen0 (demotion) instead of being promoted.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'poh', kind: 'poh' },
];

const tmp = (i: number, status?: Status): Obj => ({
  id: `t${i}`,
  region: 'g0',
  label: 'byte[64]',
  sizeBytes: 88,
  status,
});
const pinnedBuf = (region: string, status?: Status): Obj => ({
  id: 'a',
  region,
  label: 'byte[4096] (a)',
  sizeBytes: 4120,
  pinned: true,
  status,
});
const pohBuf = (status?: Status): Obj => ({
  id: 'b',
  region: 'poh',
  label: 'byte[4096] (b)',
  sizeBytes: 4120,
  status,
});

const roots = [
  { id: 'r-h', label: 'h (Pinned-Handle)', refs: ['a'] },
  { id: 'r-b', label: 'b', refs: ['b'] },
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Fixierter Puffer in Gen0 und auf dem POH',
  code: {
    cs: `var a = new byte[4096];
var h = GCHandle.Alloc(a, GCHandleType.Pinned);
var b = GC.AllocateArray<byte>(4096, pinned: true);
for (int i = 0; i < 4; i++) _ = new byte[64];
GC.Collect(0);
Console.WriteLine(GC.GetGeneration(b));   // 2`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        regions,
        objects: [pinnedBuf('g0')],
        roots: [roots[0]],
        phase: 'alloc',
      },
      changed: ['a', 'r-h'],
      explanation:
        '`a` ist ein normales Array in Gen0. Erst das Pinned-Handle sorgt dafür, dass der GC es nicht verschieben darf, und zwar so lange, bis jemand `h.Free()` aufruft.',
    },
    {
      codeLine: 3,
      state: { regions, objects: [pinnedBuf('g0'), pohBuf()], roots, phase: 'alloc' },
      changed: ['b'],
      explanation:
        '`b` kommt mit `pinned: true` direkt auf den **Pinned Object Heap**. Dort bewegt sich nie ein Objekt, ein Handle ist nicht nötig. Die Fixierung ist eine Eigenschaft des Orts, nicht des Objekts.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [pinnedBuf('g0'), tmp(1), tmp(2), tmp(3), tmp(4), pohBuf()],
        roots,
        phase: 'alloc',
      },
      changed: ['t1', 't2', 't3', 't4'],
      explanation:
        'Das Programm alloziert weiter. Die kleinen Arrays landen in Gen0, hinter dem fixierten `a`. Auf dem POH ändert sich nichts.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [
          pinnedBuf('g0', 'live'),
          tmp(1, 'dead'),
          tmp(2, 'dead'),
          tmp(3, 'dead'),
          tmp(4, 'dead'),
          pohBuf(),
        ],
        roots,
        phase: 'plan',
      },
      changed: ['a', 't1', 't2', 't3', 't4'],
      explanation:
        'Bei der Gen0-Collection sind die kleinen Arrays tot. `a` lebt, darf aber nicht bewegt werden: Der GC muss um dieses Objekt herum planen. Der POH ist an dieser Collection gar nicht beteiligt.',
    },
    {
      codeLine: 5,
      state: { regions, objects: [pinnedBuf('g0', 'live'), pohBuf()], roots, phase: 'done' },
      changed: ['a'],
      explanation:
        'Das fixierte `a` bleibt mitten im Gen0-Bereich liegen, statt mit anderen Überlebenden nach Gen1 kopiert zu werden. Wie der GC damit umgeht, zeigt die Lektion „Pinning und Fragmentierung“.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [pinnedBuf('g0', 'live'), pohBuf()],
        roots,
        phase: 'done',
        output: '2',
      },
      changed: ['b'],
      explanation:
        'Wie der LOH wird auch der POH logisch mit Gen2 eingesammelt, `GC.GetGeneration` meldet 2. Für langlebige Puffer ist das genau richtig: Sie stören die jungen Generationen nicht.',
    },
  ],
});
