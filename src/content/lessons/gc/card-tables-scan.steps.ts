import { defineStepScript, type GcHeapState } from '@/components/viz';

// Gen2 is drawn as four card ranges (A to D) to show which parts an ephemeral GC visits.
// No card sizes on purpose; see the lesson text.
// TODO(verify): A card is cleared during an ephemeral GC when scanning it finds no reference
// into the condemned (or a younger) generation (card_transition / clear_cards in card_table.cpp),
// and stays set when the scanned objects still reference a younger generation after promotion.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const card = (id: string, name: string, state: string) => ({
  id,
  kind: 'gen2' as const,
  label: `Gen2, Karte ${name} (${state})`,
});

const regions = (b = 'markiert', c = 'markiert'): GcHeapState['regions'] => [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  card('kA', 'A', 'sauber'),
  card('kB', 'B', b),
  card('kC', 'C', c),
  card('kD', 'D', 'sauber'),
];

const old = (refsCache: string[] = ['order']): Obj[] => [
  { id: 'config', region: 'kA', label: 'Config' },
  { id: 'cache', region: 'kB', label: 'Cache (Last → Order)', refs: refsCache },
  { id: 'logger', region: 'kC', label: 'Logger (Pending = null)' },
  { id: 'format', region: 'kD', label: 'Format' },
];

const young = (s: Partial<Record<'order' | 'entry' | 'tmp' | 'msg', Status>> = {}): Obj[] => [
  { id: 'order', region: 'g0', label: 'Order 42', status: s.order },
  { id: 'entry', region: 'g0', label: 'Entry', status: s.entry },
  { id: 'tmp', region: 'g0', label: 'byte[100]', status: s.tmp },
  { id: 'msg', region: 'g0', label: 'Message', status: s.msg },
];

const roots: GcHeapState['roots'] = [
  { id: 'r-statics', label: 'Statische Felder', refs: ['config', 'cache', 'logger', 'format'] },
  { id: 'r-msg', label: 'msg (Stack)', refs: ['msg'] },
];

const unknown = { order: 'unknown', entry: 'unknown', tmp: 'unknown', msg: 'unknown' } as const;

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Eine Gen0-Collection liest die Card Table',
  code: {
    cs: `// Config, Cache, Logger und Format liegen längst in Gen2
s_cache.Last = new Order(42);    // Karte B wird markiert
s_logger.Pending = new Entry();  // Karte C wird markiert
s_logger.Pending = null;         // Karte C bleibt markiert
_ = new byte[100];               // Müll
var msg = new Message();
GC.Collect(0);
Console.WriteLine(msg);`,
  },
  steps: [
    {
      codeLine: 6,
      state: { regions: regions(), objects: [...old(), ...young()], roots, phase: 'alloc' },
      changed: ['kB', 'kC'],
      explanation:
        'Zwei Zuweisungen haben neue Objekte in Gen2-Objekte geschrieben, die Write Barrier hat dabei die Karten B und C markiert. Dass `Pending` inzwischen wieder `null` ist, weiß die Card Table nicht.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(),
        objects: [...old(), ...young({ ...unknown, msg: 'marked' })],
        roots,
        phase: 'mark',
      },
      changed: ['msg', 'r-msg'],
      explanation:
        'Die Gen0-Collection markiert zuerst ab den Roots. `msg` liegt im Stack und führt zu `Message`. Die statischen Felder zeigen nur auf Gen2-Objekte, und Gen2 wird nicht eingesammelt, also folgt der GC ihnen nicht weiter.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(),
        objects: [...old(), ...young({ ...unknown, msg: 'marked', order: 'marked' })],
        roots,
        phase: 'mark',
      },
      changed: ['kB', 'cache', 'order'],
      explanation:
        'Jetzt sucht der GC in der Card Table nach markierten Karten. Karte B: Er durchsucht die Objekte, die in diesem Bereich liegen, findet in `Cache` einen Verweis nach Gen0 und markiert `Order 42`.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(),
        objects: [...old(), ...young({ ...unknown, msg: 'marked', order: 'marked' })],
        roots,
        phase: 'mark',
      },
      changed: ['kC', 'logger'],
      explanation:
        'Karte C: Der GC durchsucht `Logger`, findet aber keinen Verweis in eine jüngere Generation mehr. Diese Karte war umsonst markiert, ihr Besuch hat trotzdem Zeit gekostet.',
    },
    {
      codeLine: 7,
      state: {
        regions: regions(),
        objects: [...old(), ...young({ msg: 'live', order: 'live', entry: 'dead', tmp: 'dead' })],
        roots,
        phase: 'mark',
      },
      changed: ['kA', 'kD', 'entry', 'tmp'],
      explanation:
        'Häufige Fehlannahme: Eine ephemere Collection müsse alle Gen2-Objekte auf Verweise prüfen. `Config` und `Format` in den sauberen Karten A und D hat der GC nie angesehen. `Entry` und das Array sind tot.',
    },
    {
      codeLine: 8,
      state: {
        regions: regions('bleibt markiert', 'gelöscht'),
        objects: [
          ...old(),
          { id: 'order', region: 'g1', label: 'Order 42' },
          { id: 'msg', region: 'g1', label: 'Message' },
        ],
        roots,
        phase: 'done',
      },
      changed: ['kB', 'kC', 'order', 'msg'],
      explanation:
        'Nach der Collection liegt `Order 42` in Gen1, also immer noch jünger als `Cache`. Karte B bleibt deshalb markiert. In Karte C hat der GC keinen solchen Verweis gefunden und die Karte gelöscht, die nächste Collection überspringt sie.',
    },
  ],
});
