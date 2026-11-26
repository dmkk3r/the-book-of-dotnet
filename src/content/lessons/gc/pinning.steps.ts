import { defineStepScript, type GcHeapState } from '@/components/viz';

// Simplified sliding compaction inside one gen0 area, as described in the BOTR (plugs and gaps).
// Promotion to gen1 is left out on purpose. Free gaps are drawn as entries labeled "frei".
// TODO(verify): Object sizes on x64 (byte[64] = 88 B, byte[256] = 280 B); that `d` may be moved
// into the gap directly after the pinned plug; how regions (.NET 7+) handle pinned plugs in gen0.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [{ id: 'g0', kind: 'gen0', label: 'Gen0 (ein Bereich)' }];

const small = (id: string, status?: Status): Obj => ({
  id,
  region: 'g0',
  label: `byte[64] (${id})`,
  sizeBytes: 88,
  status,
});
const buf = (status?: Status, pinned = false): Obj => ({
  id: 'buf',
  region: 'g0',
  label: 'byte[256] (buf)',
  sizeBytes: 280,
  status,
  pinned,
});
const gap = (id: string, bytes: number): Obj => ({
  id,
  region: 'g0',
  label: 'frei',
  sizeBytes: bytes,
});

const root = (name: string, target = name) => ({ id: `r-${name}`, label: name, refs: [target] });
const pinnedLocal = { id: 'r-p', label: 'p (pinned local)', refs: ['buf'] };
const liveRoots = [root('b'), root('buf'), root('d')];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Kompaktieren mit einem fixierten Objekt',
  code: {
    cs: `byte[] a = new byte[64], b = new byte[64];
byte[] buf = new byte[256];
byte[] c = new byte[64], d = new byte[64];
a = null; c = null;
fixed (byte* p = buf)
{
    NativeRead(p, buf.Length);   // währenddessen läuft ein GC
}`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        regions,
        objects: [small('a'), small('b'), buf(), small('c'), small('d')],
        roots: [root('a'), root('b'), root('buf'), root('c'), root('d')],
        phase: 'alloc',
      },
      changed: ['a', 'b', 'buf', 'c', 'd'],
      explanation:
        'Fünf Arrays liegen in Allokationsreihenfolge hintereinander in Gen0. Größen auf 64-Bit inklusive Header.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [small('a'), small('b'), buf(), small('c'), small('d')],
        roots: liveRoots,
        phase: 'alloc',
      },
      explanation:
        '`a` und `c` sind jetzt unerreichbar. Ohne Pinning würde die nächste Collection `b`, `buf` und `d` einfach nach vorn schieben.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [small('a'), small('b'), buf(), small('c'), small('d')],
        roots: [...liveRoots, pinnedLocal],
        phase: 'alloc',
      },
      changed: ['r-p'],
      explanation:
        '`fixed` legt eine lokale Variable an, die im GC-Info als **pinned** gekennzeichnet ist. Mehr passiert nicht: kein Aufruf, kein Eintrag in einer Tabelle, das Objekt selbst bleibt unverändert.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          small('a', 'unknown'),
          small('b', 'marked'),
          buf('marked', true),
          small('c', 'unknown'),
          small('d', 'marked'),
        ],
        roots: [...liveRoots, pinnedLocal],
        phase: 'mark',
      },
      changed: ['b', 'buf', 'd'],
      explanation:
        'Während `NativeRead` läuft, löst ein anderer Thread eine Gen0-Collection aus. Beim Durchsuchen des Stacks findet der GC die pinned local und merkt sich `buf` als **fixiert**. Erst jetzt wird das Pinning wirksam.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          small('a', 'dead'),
          small('b', 'live'),
          buf('live', true),
          small('c', 'dead'),
          small('d', 'live'),
        ],
        roots: [...liveRoots, pinnedLocal],
        phase: 'plan',
      },
      changed: ['a', 'c'],
      explanation:
        '**Planen:** Der GC zerlegt den Bereich in Plugs (zusammenhängende Überlebende) und Gaps (tote Objekte). `buf` bildet einen **pinned plug**: Seine Adresse ist fest, alles andere muss um ihn herum geplant werden.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [small('b', 'live'), gap('f1', 88), buf('live', true), small('d', 'live')],
        roots: [...liveRoots, pinnedLocal],
        phase: 'compact',
      },
      changed: ['b', 'f1', 'd'],
      explanation:
        '`b` rutscht an den Anfang, kann aber nicht an `buf` vorbei. Vor dem fixierten Objekt bleibt eine Lücke. `d` füllt den Platz von `c` direkt dahinter.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [small('b', 'live'), gap('f1', 88), buf('live', true), small('d', 'live')],
        roots: [...liveRoots, pinnedLocal],
        phase: 'done',
      },
      explanation:
        'Häufige Fehlannahme: Pinning halte den ganzen GC an. Der GC läuft normal und verschiebt alles andere. Er darf nur dieses eine Objekt nicht bewegen, und der Preis ist die Lücke davor.',
    },
    {
      codeLine: 8,
      state: {
        regions,
        objects: [small('b', 'live'), gap('f1', 88), buf('live'), small('d', 'live')],
        roots: liveRoots,
        phase: 'done',
      },
      changed: ['buf'],
      explanation:
        'Der `fixed`-Block ist vorbei, die pinned local ist keine Root mehr. Bei der nächsten Collection darf `buf` wieder verschoben werden. Kurzes Pinning hinterlässt also nur einmalig eine kleine Lücke.',
    },
  ],
});
