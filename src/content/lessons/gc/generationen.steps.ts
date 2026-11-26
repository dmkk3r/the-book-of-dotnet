import { defineStepScript, type GcHeapState } from '@/components/viz';

// TODO(verify): Object sizes (List 32 B, Order[4] 56 B, Order 24 B, byte[100] 128 B) on x64,
// and that a Release build treats `temp` as dead after the loop.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2' },
];

const list = (region = 'g0', status?: Status, refs = ['arr']): Obj => ({
  id: 'list',
  region,
  label: 'List<Order>',
  sizeBytes: 32,
  refs,
  status,
});
const arr = (n: number, region = 'g0', status?: Status): Obj => ({
  id: 'arr',
  region,
  label: 'Order[4]',
  sizeBytes: 56,
  refs: ['o0', 'o1', 'o2'].slice(0, n),
  status,
});
const order = (i: number, region = 'g0', status?: Status): Obj => ({
  id: `o${i}`,
  region,
  label: `Order ${i}`,
  sizeBytes: 24,
  status,
});
const bytes = (i: number, status?: Status): Obj => ({
  id: `b${i}`,
  region: 'g0',
  label: 'byte[100]',
  sizeBytes: 128,
  status,
});

const keep = (refs = ['list']) => ({ id: 'r-keep', label: 'keep', refs });

const survivors = (status: Status, region = 'g1'): Obj[] => [
  list(region, status),
  arr(3, region, status),
  order(0, region, status),
  order(1, region, status),
  order(2, region, status),
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Gen0-Collection Schritt für Schritt',
  code: {
    cs: `var keep = new List<Order>();
for (int i = 0; i < 3; i++)
{
    var temp = new byte[100];   // nur kurz gebraucht
    keep.Add(new Order(i));
}
GC.Collect(0);
Console.WriteLine(GC.GetGeneration(keep[0]));`,
  },
  steps: [
    {
      codeLine: 1,
      state: { regions, objects: [list('g0', undefined, [])], roots: [keep()], phase: 'alloc' },
      changed: ['list'],
      explanation:
        'Neue Objekte landen in **Gen0**. Die lokale Variable `keep` ist eine **Root**: ein Startpunkt, von dem aus der GC später nach lebenden Objekten sucht.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [list(), bytes(0), arr(1), order(0)],
        roots: [keep(), { id: 'r-temp', label: 'temp', refs: ['b0'] }],
        phase: 'alloc',
      },
      changed: ['b0', 'arr', 'o0'],
      explanation:
        'Erster Durchlauf: ein `byte[100]` für `temp`, ein `Order` und beim ersten `Add` das interne Array der Liste. Allokation ist billig: Die Runtime schiebt meist nur einen Zeiger im Gen0-Bereich weiter.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [list(), bytes(0), arr(3), order(0), bytes(1), order(1), bytes(2), order(2)],
        roots: [keep(), { id: 'r-temp', label: 'temp', refs: ['b2'] }],
        phase: 'alloc',
      },
      changed: ['b1', 'o1', 'b2', 'o2'],
      explanation:
        'Nach drei Durchläufen zeigt `temp` nur noch auf das letzte Array. Auf die ersten beiden `byte[100]` verweist nichts mehr. Sie sind bereits Müll, liegen aber noch im Speicher, denn nichts räumt sofort auf.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          list('g0', 'marked'),
          bytes(0, 'unknown'),
          arr(3, 'g0', 'marked'),
          order(0, 'g0', 'marked'),
          bytes(1, 'unknown'),
          order(1, 'g0', 'marked'),
          bytes(2, 'unknown'),
          order(2, 'g0', 'marked'),
        ],
        roots: [keep()],
        phase: 'mark',
      },
      changed: ['list', 'arr', 'o0', 'o1', 'o2'],
      explanation:
        '**Markieren:** `GC.Collect(0)` fordert eine Gen0-Collection an. Der GC folgt ab den Roots allen Verweisen in Gen0 und markiert, was er erreicht. `temp` zählt nach der Schleife im Release-Build nicht mehr als Root, also bleiben alle drei `byte[100]` unmarkiert.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          list('g0', 'live'),
          bytes(0, 'dead'),
          arr(3, 'g0', 'live'),
          order(0, 'g0', 'live'),
          bytes(1, 'dead'),
          order(1, 'g0', 'live'),
          bytes(2, 'dead'),
          order(2, 'g0', 'live'),
        ],
        roots: [keep()],
        phase: 'plan',
      },
      changed: ['b0', 'b1', 'b2'],
      explanation:
        'Häufige Fehlannahme: Der GC suche nach Müll. Er sucht nur nach **lebenden** Objekten, alles Unmarkierte ist automatisch tot, egal wie viel es ist. Deshalb kostet eine Gen0-Collection vor allem pro Überlebendem.',
    },
    {
      codeLine: 7,
      state: { regions, objects: survivors('live'), roots: [keep()], phase: 'done' },
      changed: ['list', 'arr', 'o0', 'o1', 'o2'],
      explanation:
        'Die Überlebenden werden **promotet**: Sie gehören jetzt zu Gen1. Gen0 ist wieder frei für neue Allokationen. Der Platz der toten Objekte wird nicht einzeln freigegeben, er wird als Ganzes wiederverwendet.',
    },
    {
      codeLine: 8,
      state: { regions, objects: survivors('live'), roots: [keep()], phase: 'done', output: '1' },
      explanation:
        '`GC.GetGeneration` bestätigt es: `keep[0]` hat eine Collection überlebt und ist jetzt in Generation 1. Überlebt es noch eine Collection, die Gen1 einschließt, kommt es nach Gen2 und bleibt dort.',
    },
  ],
});
