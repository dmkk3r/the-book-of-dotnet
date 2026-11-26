import { defineStepScript, type GcHeapState } from '@/components/viz';

// TODO(verify): Object sizes on x64 (byte[1000] = 1024 B, byte[100000] = 100024 B, i.e. 24 B for
// header, MethodTable pointer and length), GC.GetGeneration returning 2 for an LOH object, and that
// a Release build without debugger treats `large` as dead after `large = null`.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2' },
  { id: 'loh', kind: 'loh' },
];

const small = (region = 'g0', status?: Status): Obj => ({
  id: 'small',
  region,
  label: 'byte[1_000]',
  sizeBytes: 1024,
  status,
});
const large = (status?: Status): Obj => ({
  id: 'large',
  region: 'loh',
  label: 'byte[100_000]',
  sizeBytes: 100024,
  status,
});

const rSmall = { id: 'r-small', label: 'small', refs: ['small'] };
const rLarge = { id: 'r-large', label: 'large', refs: ['large'] };

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Ein großes Array im Large Object Heap',
  code: {
    cs: `var small = new byte[1_000];
var large = new byte[100_000];
Console.WriteLine(GC.GetGeneration(small));   // 0
Console.WriteLine(GC.GetGeneration(large));   // 2
large = null;
GC.Collect(0);
GC.Collect(1);
GC.Collect(2);
GC.KeepAlive(small);`,
  },
  steps: [
    {
      codeLine: 1,
      state: { regions, objects: [small()], roots: [rSmall], phase: 'alloc' },
      changed: ['small'],
      explanation:
        'Ein kleines Array mit rund 1 KB landet wie jedes normale Objekt in **Gen0**. Der Allokator schiebt nur einen Zeiger in seinem Allokationsbereich weiter.',
    },
    {
      codeLine: 2,
      state: { regions, objects: [small(), large()], roots: [rSmall, rLarge], phase: 'alloc' },
      changed: ['large'],
      explanation:
        'Das zweite Array ist mit Header über 85.000 Byte groß (64-Bit). Es überspringt Gen0 und wird direkt im **Large Object Heap** angelegt. Die Runtime muss dafür rund 100 KB Speicher nullen.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [small(), large()],
        roots: [rSmall, rLarge],
        phase: 'alloc',
        output: '0',
      },
      explanation: 'Für das kleine Array meldet `GC.GetGeneration` erwartungsgemäß Generation 0.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [small(), large()],
        roots: [rSmall, rLarge],
        phase: 'alloc',
        output: '2',
      },
      changed: ['large'],
      explanation:
        'Häufige Fehlannahme: Der LOH sei eine eigene, vierte Generation mit eigenen Collections. Logisch gehört er zu **Gen2**, deshalb meldet `GC.GetGeneration` für das frische Array schon 2. Eingesammelt wird es nur bei einer vollen Collection.',
    },
    {
      codeLine: 5,
      state: { regions, objects: [small(), large()], roots: [rSmall], phase: 'alloc' },
      changed: ['r-small'],
      explanation:
        'Nach `large = null` verweist nichts mehr auf das große Array. Es ist Müll, belegt aber weiter seine 100 KB, denn nichts räumt sofort auf.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [small('g1', 'live'), large()],
        roots: [rSmall],
        phase: 'done',
      },
      changed: ['small'],
      explanation:
        'Eine Gen0-Collection: Das kleine Array überlebt und wird nach Gen1 promotet. Den LOH schaut sich diese Collection gar nicht an, das tote große Array bleibt liegen.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [small('g2', 'live'), large()],
        roots: [rSmall],
        phase: 'done',
      },
      changed: ['small'],
      explanation:
        'Auch eine Gen1-Collection lässt den LOH unberührt. Das kleine Array ist inzwischen in Gen2, das große liegt immer noch tot im LOH.',
    },
    {
      codeLine: 8,
      state: {
        regions,
        objects: [small('g2', 'marked'), large('unknown')],
        roots: [rSmall],
        phase: 'mark',
      },
      changed: ['small'],
      explanation:
        'Erst eine **Gen2-Collection** markiert auch im LOH. Sie findet das große Array nicht, weil keine Root mehr darauf zeigt.',
    },
    {
      codeLine: 8,
      state: {
        regions,
        objects: [small('g2', 'live'), large('dead')],
        roots: [rSmall],
        phase: 'sweep',
      },
      changed: ['large'],
      explanation:
        'Der LOH wird standardmäßig nicht kompaktiert, sondern nur **freigegeben**: Der Platz des toten Arrays kommt in eine Freiliste. Lebende LOH-Objekte bleiben, wo sie sind.',
    },
    {
      codeLine: 9,
      state: { regions, objects: [small('g2', 'live')], roots: [rSmall], phase: 'done' },
      explanation:
        'Fazit: Das große Array war nur eine Zeile lang in Gebrauch, sein Speicher war aber bis zur nächsten vollen Collection gebunden. Bei vielen solchen Arrays wird daraus ein echtes Problem.',
    },
  ],
});
