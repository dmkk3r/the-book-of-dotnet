import { defineStepScript, type GcHeapState } from '@/components/viz';

// The same request handler twice: a fresh 128 KB buffer per request versus a pooled one.
// Rent(131072) maps to the bucket of exactly 131072 elements (16 << 13), see
// Utilities.SelectBucketIndex / GetMaxSizeForBucket in dotnet/runtime.
// TODO(verify): Object size 131072 + 24 B array header on x64; LOH objects are only reclaimed
// by a gen2 (full) collection.

type Obj = GcHeapState['objects'][number];
type Root = NonNullable<GcHeapState['roots']>[number];

const REGIONS: GcHeapState['regions'] = [
  { id: 'gen0', kind: 'gen0' },
  { id: 'gen2', kind: 'gen2' },
  { id: 'loh', kind: 'loh', label: 'LOH (ab 85.000 Byte)' },
];

const SIZE = 131_096;
const buf = (id: string, label: string, status: Obj['status']): Obj => ({
  id,
  region: 'loh',
  label,
  sizeBytes: SIZE,
  status,
});
const req = (n: number, target?: string): Root => ({
  id: `r${n}`,
  label: `Anfrage ${n}`,
  refs: target ? [target] : [],
});

export default defineStepScript({
  view: 'gcheap',
  title: 'Wegwerfpuffer gegen gepoolten Puffer',
  code: {
    cs: `// Variante A: pro Anfrage ein neuer Puffer
async Task HandleA(Stream body)
{
    byte[] buf = new byte[128 * 1024];
    await body.ReadAsync(buf);
    Process(buf);
}

// Variante B: Puffer aus dem Pool
async Task HandleB(Stream body)
{
    byte[] buf = ArrayPool<byte>.Shared.Rent(128 * 1024);
    try
    {
        await body.ReadAsync(buf);
        Process(buf);
    }
    finally
    {
        ArrayPool<byte>.Shared.Return(buf);
    }
}`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        regions: REGIONS,
        objects: [buf('a1', 'byte[131072] #1', 'live')],
        roots: [req(1, 'a1')],
        phase: 'alloc',
      },
      changed: ['a1', 'r1'],
      explanation:
        'Variante A: Der Puffer ist größer als 85.000 Byte und landet deshalb direkt im LOH, nicht in Gen0. Die Anfrage hält ihn, solange sie läuft.',
    },
    {
      codeLine: 4,
      state: {
        regions: REGIONS,
        objects: [buf('a1', 'byte[131072] #1', 'dead'), buf('a2', 'byte[131072] #2', 'live')],
        roots: [req(1), req(2, 'a2')],
        phase: 'alloc',
      },
      changed: ['a1', 'a2', 'r1', 'r2'],
      explanation:
        'Anfrage 1 ist fertig, ihr Puffer ist tot. Anfrage 2 bekommt einen **neuen** Puffer. Der alte bleibt liegen, denn der LOH wird nur bei einer Gen2-Collection aufgeräumt.',
    },
    {
      codeLine: 4,
      state: {
        regions: REGIONS,
        objects: [
          buf('a1', 'byte[131072] #1', 'dead'),
          buf('a2', 'byte[131072] #2', 'dead'),
          buf('a3', 'byte[131072] #3', 'dead'),
          buf('a4', 'byte[131072] #4', 'live'),
        ],
        roots: [req(4, 'a4')],
        phase: 'alloc',
      },
      changed: ['a3', 'a4', 'r4'],
      explanation:
        'Nach vier Anfragen liegt ein halbes Megabyte im LOH, davon drei Viertel tot. Bei Hunderten Anfragen pro Sekunde wächst der LOH schnell, bis sein Budget eine volle Gen2-Collection auslöst.',
    },
    {
      state: {
        regions: REGIONS,
        objects: [buf('a4', 'byte[131072] #4', 'live')],
        roots: [req(4, 'a4')],
        phase: 'sweep',
      },
      changed: ['a4'],
      explanation:
        'Die volle Collection räumt die toten Puffer weg, muss dafür aber den ganzen Heap betrachten. Diese Arbeit entsteht nur, weil Puffer weggeworfen wurden, die man hätte wiederverwenden können.',
    },
    {
      codeLine: 12,
      state: {
        regions: REGIONS,
        objects: [buf('p1', 'byte[131072] (gepoolt)', 'live')],
        roots: [req(1, 'p1'), { id: 'pool', label: 'ArrayPool<byte>.Shared', refs: [] }],
        phase: 'alloc',
      },
      changed: ['p1', 'r1', 'pool'],
      explanation:
        'Variante B: Beim ersten `Rent` ist der Pool leer, also alloziert er selbst ein Array, ebenfalls im LOH. Die Anfrage hält es, der Pool kennt es noch nicht.',
    },
    {
      codeLine: 20,
      state: {
        regions: REGIONS,
        objects: [buf('p1', 'byte[131072] (gepoolt)', 'live')],
        roots: [req(1), { id: 'pool', label: 'ArrayPool<byte>.Shared', refs: ['p1'] }],
        phase: 'alloc',
      },
      changed: ['pool', 'r1'],
      explanation:
        '`Return` legt das Array in den Pool. Es bleibt erreichbar, ist also nicht tot, sondern wartet auf den nächsten Einsatz.',
    },
    {
      codeLine: 12,
      state: {
        regions: REGIONS,
        objects: [buf('p1', 'byte[131072] (gepoolt)', 'live')],
        roots: [req(2, 'p1'), { id: 'pool', label: 'ArrayPool<byte>.Shared', refs: [] }],
        phase: 'alloc',
      },
      changed: ['r2', 'pool'],
      explanation:
        'Anfrage 2 bekommt **dasselbe** Array. Nach tausend Anfragen auf einem Thread gibt es immer noch genau einen Puffer, und der LOH wächst nicht. Bei parallelen Anfragen braucht der Pool entsprechend mehr Arrays, aber nicht mehr als gleichzeitig benutzt werden.',
    },
  ],
});
