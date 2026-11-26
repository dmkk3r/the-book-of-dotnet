import { defineStepScript, type GcHeapState } from '@/components/viz';

// Sweep instead of compact in gen2. Sizes and addresses are fictional but consistent.
// TODO(verify): Minimum free object size on x64 (24 B), and that compacting: false really
// yields a sweeping GC here (GCMemoryInfo.Compacted == false).
// TODO(verify): That a later gen1 GC can promote survivors into gen2 free list items
// (allocation in the older generation during plan) with both segments and regions.

type Obj = GcHeapState['objects'][number];

const regions: GcHeapState['regions'] = [
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2' },
];

const roots: GcHeapState['roots'] = [
  { id: 'r-cfg', label: 's_config (statisch)', refs: ['cfg'] },
  { id: 'r-sess', label: 's_sessions (statisch)', refs: ['dict'] },
];

const obj = (id: string, label: string, sizeBytes: number, extra: Partial<Obj> = {}): Obj => ({
  id,
  region: 'g2',
  label,
  sizeBytes,
  ...extra,
});

const s1 = (status?: Obj['status']) => obj('s1', 'Session 1 @8100', 96, { status });
const s3 = (status?: Obj['status']) => obj('s3', 'Session 3 @8200', 64, { status });

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Freigeben statt Kompaktieren',
  code: {
    cs: `// Gen2 nach längerer Laufzeit: fast alles lebt
s_sessions.Remove(id1);    // Session 1 wird unerreichbar
s_sessions.Remove(id3);    // Session 3 wird unerreichbar
GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: false);

// später: eine Gen1-Collection promotet ein Objekt nach Gen2
var info = GC.GetGCMemoryInfo();
Console.WriteLine(info.Compacted);`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        regions,
        objects: [
          obj('cfg', 'Config @8000', 256),
          s1(),
          obj('s2', 'Session 2 @8160', 160),
          s3(),
          obj('dict', 'Dictionary @8240', 128, { refs: ['s2'] }),
        ],
        roots,
        phase: 'alloc',
      },
      changed: ['s1', 's3'],
      explanation:
        'Ein typisches Gen2-Bild: Die meisten Objekte leben noch, nur zwei Sitzungen sind seit dem Entfernen aus dem Dictionary unerreichbar. Die beiden Lücken wären klein im Verhältnis zur Generation.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [
          obj('cfg', 'Config @8000', 256, { status: 'live' }),
          s1('dead'),
          obj('s2', 'Session 2 @8160', 160, { status: 'live' }),
          s3('dead'),
          obj('dict', 'Dictionary @8240', 128, { status: 'live', refs: ['s2'] }),
        ],
        roots,
        phase: 'mark',
      },
      changed: ['s1', 's3'],
      explanation:
        'Markieren funktioniert wie immer. Danach plant der GC und stellt fest: Kompaktieren würde nur 160 von 704 Byte gewinnen, dafür müssten Session 2 und das Dictionary kopiert und alle Verweise auf sie umgeschrieben werden.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [
          obj('cfg', 'Config @8000', 256, { status: 'live' }),
          obj('f1', 'Free-Objekt @8100 (Freiliste)', 96),
          obj('s2', 'Session 2 @8160', 160, { status: 'live' }),
          obj('f2', 'Free-Objekt @8200 (Freiliste)', 64),
          obj('dict', 'Dictionary @8240', 128, { status: 'live', refs: ['s2'] }),
        ],
        roots,
        phase: 'sweep',
      },
      changed: ['f1', 'f2'],
      explanation:
        'Beim **Freigeben** (Sweep) bleibt jedes überlebende Objekt, wo es ist. Aus jeder Lücke wird ein Free-Objekt, das in die **Freiliste** von Gen2 kommt. Keine Kopie, kein Umschreiben von Verweisen, also deutlich weniger Arbeit.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          obj('cfg', 'Config @8000', 256),
          obj('f1', 'Free-Objekt @8100 (Freiliste)', 96),
          obj('s2', 'Session 2 @8160', 160),
          obj('f2', 'Free-Objekt @8200 (Freiliste)', 64),
          obj('dict', 'Dictionary @8240', 128, { refs: ['s2'] }),
        ],
        roots,
        phase: 'done',
        output: 'False',
      },
      explanation:
        'Häufige Fehlannahme: Freigegebener Speicher sei wie neuer Speicher. Er ist es nur, wenn ein Objekt in eine Lücke passt. Die zwei Lücken bieten 160 Byte, aber kein Objekt über 96 Byte findet darin Platz. Das ist **Fragmentierung**.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [
          obj('cfg', 'Config @8000', 256),
          obj('order', 'Order @8100 (aus Gen1 promotet)', 72),
          obj('f1', 'Free-Objekt @8148 (Rest)', 24),
          obj('s2', 'Session 2 @8160', 160),
          obj('f2', 'Free-Objekt @8200 (Freiliste)', 64),
          obj('dict', 'Dictionary @8240', 128, { refs: ['s2'] }),
        ],
        roots: [...(roots ?? []), { id: 'r-order', label: 'order (Stack)', refs: ['order'] }],
        phase: 'done',
      },
      changed: ['order', 'f1'],
      explanation:
        'Genutzt werden die Lücken später, wenn eine Gen1-Collection Überlebende nach Gen2 promotet: Passt ein Objekt in einen Eintrag der Freiliste, landet es dort, der Rest bleibt frei. Erst eine kompaktierende Collection beseitigt die Fragmentierung ganz.',
    },
  ],
});
