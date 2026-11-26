import { defineStepScript, type GcHeapState } from '@/components/viz';

// Segment-based heap (before .NET 7, still used on 32-bit and via the standalone segments GC).
// Conceptual, no sizes. Backed by BOTR garbage-collection.md: one ephemeral segment per SOH
// holding gen0 and gen1 (possibly gen2 objects too), additional segments are gen2 segments,
// small object allocations only consider the ephemeral segment.
// Decommit only after the last live object of a segment: Maoni Stephens, "Put a DPAD on that GC!".
// TODO(verify): That free space in gen2 segments is reused only for promotion into gen2
// (gen2 free list), never for gen0 allocations.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'seg1', kind: 'gen2', label: 'Gen2-Segment' },
  { id: 'eph2', kind: 'gen2', label: 'Ephemeres Segment: Gen2-Teil' },
  { id: 'eph1', kind: 'gen1', label: 'Ephemeres Segment: Gen1' },
  { id: 'eph0', kind: 'gen0', label: 'Ephemeres Segment: Gen0' },
  { id: 'lohseg', kind: 'loh', label: 'LOH-Segment' },
];

const obj = (id: string, region: string, label: string, status?: Status, refs?: string[]): Obj => ({
  id,
  region,
  label,
  status,
  refs,
});
const gap = (id: string): Obj => ({ id, region: 'seg1', label: 'freier Bereich' });

const roots = [
  { id: 'r-config', label: 's_config', refs: ['config'] },
  { id: 'r-cache', label: 's_cache', refs: ['cache'] },
];

const young = (status?: Status): Obj[] => [
  obj('order', 'eph1', 'Order', status),
  obj('buf1', 'eph0', 'Puffer', status),
  obj('buf2', 'eph0', 'Puffer', status),
  obj('big', 'lohseg', 'byte[200_000]', status),
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Heap mit Segmenten',
  code: {
    cs: `static readonly Config s_config = LoadConfig();
static readonly Cache s_cache = new();

// Sitzungen leben lange genug, um in Gen2 zu landen
s_cache.Add(new Session("A"));
s_cache.Add(new Session("B"));
s_cache.Add(new Session("C"));

s_cache.Clear();   // alle Sitzungen laufen ab
GC.Collect();      // volle Collection`,
  },
  steps: [
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          obj('config', 'seg1', 'Config'),
          obj('sa', 'seg1', 'Session A'),
          obj('sb', 'seg1', 'Session B'),
          obj('sc', 'seg1', 'Session C'),
          obj('cache', 'seg1', 'Cache', undefined, ['sa', 'sb', 'sc']),
          ...young(),
        ],
        roots,
        phase: 'alloc',
      },
      explanation:
        'Mit **Segmenten** reserviert der GC wenige große, zusammenhängende Blöcke. Gen0 und Gen1 liegen am Ende des **ephemeren Segments**, weitere Segmente enthalten nur Gen2, große Objekte haben eigene LOH-Segmente.',
    },
    {
      codeLine: 10,
      state: {
        regions,
        objects: [
          obj('config', 'seg1', 'Config', 'marked'),
          obj('sa', 'seg1', 'Session A', 'unknown'),
          obj('sb', 'seg1', 'Session B', 'unknown'),
          obj('sc', 'seg1', 'Session C', 'unknown'),
          obj('cache', 'seg1', 'Cache', 'marked'),
          ...young('unknown'),
        ],
        roots,
        phase: 'mark',
      },
      changed: ['config', 'cache'],
      explanation:
        'Nach `Clear` verweist der Cache auf keine Sitzung mehr. Die volle Collection markiert nur `Config` und `Cache`. Die drei Sitzungen und der junge Kleinkram sind tot.',
    },
    {
      codeLine: 10,
      state: {
        regions,
        objects: [
          obj('config', 'seg1', 'Config', 'live'),
          gap('gap1'),
          obj('cache', 'seg1', 'Cache', 'live'),
        ],
        roots,
        phase: 'sweep',
        output: 'Gen2-Segment: Lücke in der Mitte, Segment bleibt committed',
      },
      changed: ['gap1'],
      explanation:
        'Volle Collections kompaktieren oft nicht, sondern **geben nur frei** (Background GC kompaktiert nie). Im Gen2-Segment entsteht eine Lücke zwischen `Config` und `Cache`. Sie wird in die Freiliste von Gen2 eingetragen.',
    },
    {
      codeLine: 10,
      state: {
        regions,
        objects: [
          obj('config', 'seg1', 'Config', 'live'),
          gap('gap1'),
          obj('cache', 'seg1', 'Cache', 'live'),
        ],
        roots,
        phase: 'done',
        output: 'An das Betriebssystem zurückgegeben: nur der Bereich hinter Cache',
      },
      explanation:
        'Häufige Fehlannahme: Freier Speicher gehe nach einer Collection an das Betriebssystem zurück. Ein Segment gibt nur den Bereich **hinter seinem letzten lebenden Objekt** zurück. Weil `Cache` am Ende liegt, bleibt die Lücke davor committed, obwohl sie leer ist.',
    },
    {
      codeLine: 10,
      state: {
        regions,
        objects: [
          obj('config', 'seg1', 'Config', 'live'),
          gap('gap1'),
          obj('cache', 'seg1', 'Cache', 'live'),
          obj('n1', 'eph0', 'Puffer'),
          obj('n2', 'eph0', 'Puffer'),
          obj('n3', 'eph0', 'Puffer'),
        ],
        roots,
        phase: 'alloc',
        output: 'Neue kleine Objekte: nur im ephemeren Segment',
      },
      changed: ['n1', 'n2', 'n3'],
      explanation:
        'Neue Objekte landen wieder im ephemeren Segment. Die Lücke im Gen2-Segment hilft ihnen nicht: Kleine Allokationen berücksichtigen nur das ephemere Segment. Freier Platz ist an das Segment und damit an die Generation gebunden.',
    },
  ],
});
