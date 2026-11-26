import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual model of write barrier and card table. No sizes on purpose.
// TODO(verify): That the GC keeps a card set after an ephemeral GC as long as the scanned
// range still holds a reference into a younger generation, and clears it otherwise.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions = (g2Label?: string): GcHeapState['regions'] => [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2', ...(g2Label ? { label: g2Label } : {}) },
];
const DIRTY = 'Gen2 (Karte mit Cache: markiert)';

const cache = (refs: string[] = [], status?: Status): Obj => ({
  id: 'cache',
  region: 'g2',
  label: 'Cache',
  refs,
  status,
});
const settings = (status?: Status): Obj => ({
  id: 'settings',
  region: 'g2',
  label: 'Settings',
  status,
});
const order = (region = 'g0', status?: Status): Obj => ({
  id: 'order',
  region,
  label: 'Order 42',
  status,
});
const tmp = (status?: Status): Obj => ({ id: 'tmp', region: 'g0', label: 'byte[100]', status });

const statics = [
  { id: 'r-cache', label: 's_cache (statisch)', refs: ['cache'] },
  { id: 'r-settings', label: 's_settings (statisch)', refs: ['settings'] },
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Verweis von Gen2 nach Gen0 Schritt für Schritt',
  code: {
    cs: `class Cache { public Order? Last; }
static Cache s_cache = new Cache();   // lebt seit Programmstart

// viel später: s_cache liegt längst in Gen2
var tmp = new byte[100];
s_cache.Last = new Order(42);
GC.Collect(0);
Console.WriteLine(GC.GetGeneration(s_cache.Last));`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        regions: regions(),
        objects: [cache(), settings()],
        roots: statics,
        phase: 'alloc',
      },
      changed: ['cache', 'settings'],
      explanation:
        '`Cache` und `Settings` wurden früh angelegt und haben mehrere Collections überlebt. Sie liegen in **Gen2**. Statische Felder sind Roots, die auf sie zeigen.',
    },
    {
      codeLine: 5,
      state: {
        regions: regions(),
        objects: [cache(), settings(), tmp()],
        roots: [...statics, { id: 'r-tmp', label: 'tmp', refs: ['tmp'] }],
        phase: 'alloc',
      },
      changed: ['tmp'],
      explanation: 'Ein kurzlebiges Array für `tmp` entsteht wie jedes neue Objekt in Gen0.',
    },
    {
      codeLine: 6,
      state: {
        regions: regions(DIRTY),
        objects: [cache(['order']), settings(), tmp(), order()],
        roots: [...statics, { id: 'r-tmp', label: 'tmp', refs: ['tmp'] }],
        phase: 'alloc',
      },
      changed: ['order', 'cache', 'g2'],
      explanation:
        'Jetzt zeigt ein **altes** Objekt auf ein **junges**. Die Zuweisung an das Feld `Last` läuft durch die **Write Barrier**, ein kleines Stück Code, das der JIT beim Speichern eines Verweises in ein Heap-Objekt einfügt. Sie markiert in der **Card Table** die Karte, also den Speicherbereich, in dem `Cache` liegt.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(DIRTY),
        objects: [cache(['order']), settings(), tmp('unknown'), order('g0', 'unknown')],
        roots: statics,
        phase: 'mark',
      },
      changed: ['order'],
      explanation:
        'Häufige Fehlannahme: Eine Gen0-Collection durchsuche den ganzen Heap. Sie folgt aber keinen Verweisen innerhalb von Gen2, die Roots `s_cache` und `s_settings` zeigen nur auf alte Objekte. Allein über die Roots wäre `Order 42` unerreichbar und würde fälschlich eingesammelt.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(DIRTY),
        objects: [cache(['order']), settings(), tmp('unknown'), order('g0', 'marked')],
        roots: statics,
        phase: 'mark',
      },
      changed: ['cache', 'order'],
      explanation:
        'Deshalb liest der GC zusätzlich die Card Table. Nur die Objekte in markierten Karten werden durchsucht, hier `Cache`, und ihre Verweise in jüngere Generationen wirken wie zusätzliche Roots. So findet er `Order 42`, während `Settings` gar nicht angefasst wird.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(DIRTY),
        objects: [cache(['order']), settings(), tmp('dead'), order('g0', 'live')],
        roots: statics,
        phase: 'plan',
      },
      changed: ['tmp'],
      explanation:
        '`tmp` ist nach der Zuweisung im Release-Build keine Root mehr, das Array bleibt unmarkiert und ist tot.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions('Gen2 (Karte bleibt markiert)'),
        objects: [cache(['order']), settings(), order('g1', 'live')],
        roots: statics,
        phase: 'done',
      },
      changed: ['order', 'g2'],
      explanation:
        '`Order 42` wird nach Gen1 promotet. Weil `Cache` weiterhin in eine jüngere Generation zeigt, bleibt die Karte für spätere Gen0- und Gen1-Collections markiert.',
    },
    {
      codeLine: 8,
      state: {
        regions: regions('Gen2 (Karte bleibt markiert)'),
        objects: [cache(['order']), settings(), order('g1', 'live')],
        roots: statics,
        phase: 'done',
        output: '1',
      },
      explanation:
        'Das Objekt hat überlebt, obwohl nur ein Gen2-Objekt darauf zeigt. Die Write Barrier hat bei der Zuweisung die Information hinterlassen, die der GC später braucht.',
    },
  ],
});
