import { defineStepScript, type GcHeapState } from '@/components/viz';

// One blocking gen0 GC through all phases. Addresses are fictional but consistent.
// TODO(verify): Object sizes on x64 (Node with two reference fields 32 B, byte[64] 88 B,
// string of 10 chars 48 B, byte[32] 56 B).
// TODO(verify): That a Release build treats t1 and t2 as dead at GC.Collect(0), and that the
// survivors of this gen0 GC end up in gen1 (GC.GetGeneration(a) == 1).

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
type Root = NonNullable<GcHeapState['roots']>[number];

const regions = (g2Label = 'Gen2 (Karte mit s_root: markiert)'): GcHeapState['regions'] => [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2', label: g2Label },
];

interface Labels {
  a?: string;
  t1?: string;
  b?: string;
  t2?: string;
  c?: string;
  d?: string;
  root?: string;
}

const base: Required<Labels> = {
  a: 'A: Node @2000',
  t1: 't1: byte[64] @2020',
  b: 'B: Node @2078',
  t2: 't2: string @2098',
  c: 'C: Node @20C8',
  d: 'D: byte[32] @20E8',
  root: 's_root: Node (Next = 20C8)',
};

const heap = (
  status: Partial<Record<'a' | 't1' | 'b' | 't2' | 'c' | 'd', Status>> = {},
  labels: Labels = {},
  region = 'g0',
): Obj[] => {
  const l = { ...base, ...labels };
  return [
    { id: 'root', region: 'g2', label: l.root, refs: ['c'] },
    { id: 'a', region, label: l.a, sizeBytes: 32, status: status.a, refs: ['b'] },
    { id: 't1', region, label: l.t1, sizeBytes: 88, status: status.t1 },
    { id: 'b', region, label: l.b, sizeBytes: 32, status: status.b },
    { id: 't2', region, label: l.t2, sizeBytes: 48, status: status.t2 },
    { id: 'c', region, label: l.c, sizeBytes: 32, status: status.c, refs: ['d'] },
    { id: 'd', region, label: l.d, sizeBytes: 56, status: status.d },
  ];
};

const roots = (aLabel = 'a (Stack, GC-Info)', rootLabel = 's_root (statisch)'): Root[] => [
  { id: 'r-a', label: aLabel, refs: ['a'] },
  { id: 'r-static', label: rootLabel, refs: ['root'] },
];

const planLabels: Labels = {
  a: 'Plug 1: A @2000 → 2000',
  t1: 'Lücke (88 B)',
  b: 'Plug 2: B @2078 → 2020',
  t2: 'Lücke (48 B)',
  c: 'Plug 3: C @20C8 → 2040',
  d: 'Plug 3: D @20E8 → 2060',
};

const live = { a: 'live', b: 'live', c: 'live', d: 'live', t1: 'dead', t2: 'dead' } as const;

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Eine Gen0-Collection durch alle Phasen',
  code: {
    cs: `class Node { public Node? Next; public byte[]? Data; }
static Node s_root = new Node();   // lebt längst in Gen2

var a = new Node();                // A
var t1 = new byte[64];             // wird nie wieder benutzt
a.Next = new Node();               // B
var t2 = new string('x', 10);      // wird nie wieder benutzt
s_root.Next = new Node { Data = new byte[32] };   // C und D
GC.Collect(0);
Console.WriteLine(GC.GetGeneration(a));`,
  },
  steps: [
    {
      codeLine: 8,
      state: { regions: regions(), objects: heap(), roots: roots(), phase: 'alloc' },
      changed: ['c', 'd', 'root'],
      explanation:
        'Sechs neue Objekte liegen in Gen0, in der Reihenfolge ihrer Allokation. `C` ist nur über `s_root` erreichbar, ein altes Objekt in Gen2. Die Write Barrier hat deshalb die Karte markiert, in der `s_root` liegt.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap({
          a: 'unknown',
          t1: 'unknown',
          b: 'unknown',
          t2: 'unknown',
          c: 'unknown',
          d: 'unknown',
        }),
        roots: roots(),
        phase: 'mark',
      },
      changed: ['g0'],
      explanation:
        'Bevor irgendetwas markiert wird, hält die Runtime alle verwalteten Threads an einem sicheren Punkt an. Nur Gen0 wird eingesammelt (die **verurteilte** Generation), alle Objekte darin gelten zunächst als unbekannt.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap({
          a: 'marked',
          t1: 'unknown',
          b: 'unknown',
          t2: 'unknown',
          c: 'unknown',
          d: 'unknown',
        }),
        roots: roots(),
        phase: 'mark',
      },
      changed: ['r-a', 'a'],
      explanation:
        'Zuerst die Stack-Roots: Die **GC-Info** des JIT sagt, dass der Slot von `a` an dieser Stelle einen lebenden Verweis enthält. Der GC setzt bei `A` das Markierbit und legt `A` auf den **Mark Stack**, um später seine Felder zu besuchen.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap({
          a: 'marked',
          t1: 'unknown',
          b: 'marked',
          t2: 'unknown',
          c: 'unknown',
          d: 'unknown',
        }),
        roots: roots(),
        phase: 'mark',
      },
      changed: ['a', 'b'],
      explanation:
        'Der GC nimmt `A` vom Mark Stack. Welche Felder von `A` Verweise sind, steht im **GC-Deskriptor** an der MethodTable von `Node`. Über `Next` findet er `B` und markiert es. `B` hat keine Verweise auf weitere Objekte, der Stack ist leer.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap({
          a: 'marked',
          t1: 'unknown',
          b: 'marked',
          t2: 'unknown',
          c: 'marked',
          d: 'unknown',
        }),
        roots: roots(),
        phase: 'mark',
      },
      changed: ['root', 'c'],
      explanation:
        'Die statische Root zeigt nur auf `s_root` in Gen2, und Gen2 wird nicht eingesammelt. Bei einer ephemeren Collection kommen deshalb die **markierten Karten** dazu: Der GC durchsucht die Objekte in markierten Karten und findet über `s_root.Next` das Objekt `C`.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap({
          a: 'marked',
          t1: 'unknown',
          b: 'marked',
          t2: 'unknown',
          c: 'marked',
          d: 'marked',
        }),
        roots: roots(),
        phase: 'mark',
      },
      changed: ['c', 'd'],
      explanation:
        'Von `C` aus geht es wie bei jedem markierten Objekt weiter: Das Feld `Data` führt zu `D`. Danach sind Mark Stack und alle Root-Quellen abgearbeitet.',
    },
    {
      codeLine: 9,
      state: { regions: regions(), objects: heap(live), roots: roots(), phase: 'mark' },
      changed: ['t1', 't2'],
      explanation:
        'Häufige Fehlannahme: Der GC suche den Müll und lösche ihn Objekt für Objekt. Tatsächlich hat er `t1` und `t2` nie angefasst. Tot sind sie nur, weil ihr Markierbit nicht gesetzt ist.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap(live, {
          a: 'Plug 1: A',
          t1: 'Lücke (88 B)',
          b: 'Plug 2: B',
          t2: 'Lücke (48 B)',
          c: 'Plug 3: C',
          d: 'Plug 3: D',
        }),
        roots: roots(),
        phase: 'plan',
      },
      changed: ['a', 't1', 'b', 't2', 'c', 'd'],
      explanation:
        'Die Planphase läuft linear durch Gen0. Benachbarte lebende Objekte bilden einen **Plug**, tote Bereiche dazwischen eine **Lücke** (Gap). `C` und `D` liegen direkt hintereinander und werden als ein Plug behandelt.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap(live, planLabels),
        roots: roots(),
        phase: 'plan',
      },
      changed: ['b', 'c', 'd'],
      explanation:
        'Für jeden Plug rechnet der GC aus, wohin er beim Zusammenschieben käme, und merkt sich die Verschiebung im Speicher der Lücke davor. Bewegt wird noch nichts. 136 von 288 Byte sind Lücken, diese Fragmentierung ist die Grundlage für die Entscheidung: kompaktieren oder nur freigeben.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: heap(live, {
          ...planLabels,
          a: 'Plug 1: A (Next = 2020)',
          c: 'Plug 3: C (Data = 2060)',
          root: 's_root: Node (Next = 2040)',
        }),
        roots: roots('a = 2000 (Stack, GC-Info)'),
        phase: 'relocate',
      },
      changed: ['a', 'c', 'root', 'r-a'],
      explanation:
        'Jetzt werden **alle Verweise** auf Objekte der verurteilten Generation auf die neuen Adressen umgeschrieben: in Objekten, in Stack-Slots und Registern, in Handles und in den Objekten markierter Karten. Sie zeigen kurz auf Adressen, an denen die Objekte noch gar nicht liegen. Das ist sicher, weil kein Thread läuft.',
    },
    {
      codeLine: 9,
      state: {
        regions: regions(),
        objects: [
          { id: 'root', region: 'g2', label: 's_root: Node (Next = 2040)', refs: ['c'] },
          {
            id: 'a',
            region: 'g1',
            label: 'A: Node @2000',
            sizeBytes: 32,
            status: 'live',
            refs: ['b'],
          },
          { id: 'b', region: 'g1', label: 'B: Node @2020', sizeBytes: 32, status: 'live' },
          {
            id: 'c',
            region: 'g1',
            label: 'C: Node @2040',
            sizeBytes: 32,
            status: 'live',
            refs: ['d'],
          },
          { id: 'd', region: 'g1', label: 'D: byte[32] @2060', sizeBytes: 56, status: 'live' },
        ],
        roots: roots('a = 2000 (Stack, GC-Info)'),
        phase: 'compact',
      },
      changed: ['b', 'c', 'd', 'g1'],
      explanation:
        'Die Kompaktierphase kopiert die Plugs an die geplanten Adressen. Die Lücken verschwinden, dahinter entsteht ein zusammenhängender freier Bereich. Die Überlebenden gehören danach zu Gen1.',
    },
    {
      codeLine: 10,
      state: {
        regions: regions('Gen2 (Karte bleibt markiert)'),
        objects: [
          { id: 'root', region: 'g2', label: 's_root: Node (Next = 2040)', refs: ['c'] },
          { id: 'a', region: 'g1', label: 'A: Node @2000', sizeBytes: 32, refs: ['b'] },
          { id: 'b', region: 'g1', label: 'B: Node @2020', sizeBytes: 32 },
          { id: 'c', region: 'g1', label: 'C: Node @2040', sizeBytes: 32, refs: ['d'] },
          { id: 'd', region: 'g1', label: 'D: byte[32] @2060', sizeBytes: 56 },
        ],
        roots: roots('a = 2000 (Stack, GC-Info)'),
        phase: 'done',
        output: '1',
      },
      changed: ['g0', 'r-a'],
      explanation:
        'Die Threads laufen weiter, Gen0 ist leer und bekommt neues Allokationsbudget. Dein Code merkt nichts davon, dass `a` jetzt eine andere Adresse enthält: Der GC hat den Wert im Stack-Slot selbst umgeschrieben.',
    },
  ],
});
