import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual scenario without sizes. `a` is kept alive until the end with GC.KeepAlive.
// TODO(verify): Short weak handles of condemned generations are cleared after marking from
// strong roots and before ScanForFinalization (gc.cpp mark_phase, GcShortWeakPtrScan).
// TODO(verify): The WeakReference object itself only stores the handle (no managed field
// pointing to the target), so drawing no edge from it to the target is accurate.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
type Root = NonNullable<GcHeapState['roots']>[number];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
];

const data = (name: string, region = 'g0', status?: Status): Obj => ({
  id: `d${name}`,
  region,
  label: `Data ${name}`,
  status,
});
const weakObj = (region = 'g0', status?: Status): Obj => ({
  id: 'wr',
  region,
  label: 'WeakReference<Data>',
  status,
});

const rootA: Root = { id: 'r-a', label: 'a (lokal)', refs: ['dA'] };
const normal = (refs: string[] = ['dB']): Root => ({
  id: 'r-normal',
  label: 'Handle-Tabelle: Normal (Root)',
  refs,
});
const weak = (refs: string[] = ['dC']): Root => ({
  id: 'r-weak',
  label: 'Handle-Tabelle: Weak (keine Root)',
  refs,
});
const weakLocal: Root = { id: 'r-wl', label: 'weak (lokal)', refs: ['wr'] };

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Lokale Variable, Normal-Handle und Weak-Handle im GC',
  code: {
    cs: `var a = new Data("A");                               // gewöhnliche lokale Variable
GCHandle strong = GCHandle.Alloc(new Data("B"));     // Normal-Handle
var weak = new WeakReference<Data>(new Data("C"));   // Weak-Handle
GC.Collect(0);
Console.WriteLine(weak.TryGetTarget(out _));         // False
Console.WriteLine(strong.Target is not null);        // True
strong.Free();
GC.KeepAlive(a);`,
  },
  steps: [
    {
      codeLine: 1,
      state: { regions, objects: [data('A')], roots: [rootA], phase: 'alloc' },
      changed: ['dA'],
      explanation:
        'Der Normalfall: Eine lokale Variable ist eine Root, solange der JIT sie als lebendig meldet. Hier hält sie `Data A` am Leben.',
    },
    {
      codeLine: 2,
      state: { regions, objects: [data('A'), data('B')], roots: [rootA, normal()], phase: 'alloc' },
      changed: ['dB', 'r-normal'],
      explanation:
        '`GCHandle.Alloc` legt einen Eintrag in der **Handle-Tabelle** der Runtime an. Ein `Normal`-Handle ist eine starke Root, unabhängig von jeder lokalen Variable. `strong` selbst ist nur ein Struct, das die Nummer des Eintrags enthält.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [data('A'), data('B'), data('C'), weakObj()],
        roots: [rootA, normal(), weakLocal, weak()],
        phase: 'alloc',
      },
      changed: ['dC', 'wr', 'r-weak', 'r-wl'],
      explanation:
        '`WeakReference<Data>` ist ein gewöhnliches Objekt, das intern ein **Weak-Handle** besitzt. Das Handle zeigt auf `Data C`, zählt aber nicht als Root. Niemand sonst verweist auf `Data C`.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [
          data('A', 'g0', 'marked'),
          data('B', 'g0', 'marked'),
          data('C', 'g0', 'unknown'),
          weakObj('g0', 'marked'),
        ],
        roots: [rootA, normal(), weakLocal, weak()],
        phase: 'mark',
      },
      changed: ['dA', 'dB', 'wr'],
      explanation:
        '**Markieren:** Der GC folgt der lokalen Variable `a`, dem Normal-Handle und der Variable `weak`. Das `WeakReference`-Objekt wird markiert, `Data C` nicht, denn das Weak-Handle ist keine Root.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [
          data('A', 'g0', 'live'),
          data('B', 'g0', 'live'),
          data('C', 'g0', 'dead'),
          weakObj('g0', 'live'),
        ],
        roots: [rootA, normal(), weakLocal, weak([])],
        phase: 'mark',
      },
      changed: ['r-weak', 'dC'],
      explanation:
        'Nach dem Markieren geht der GC die Weak-Handles durch: Zeigt eines auf ein unmarkiertes Objekt, setzt er es auf `null`. Häufige Fehlannahme: Ein Weak-Handle halte sein Ziel, bis der Speicher knapp wird. Nein, schon die nächste Collection dieser Generation räumt es ab.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [data('A', 'g1', 'live'), data('B', 'g1', 'live'), weakObj('g1', 'live')],
        roots: [rootA, normal(), weakLocal, weak([])],
        phase: 'done',
      },
      changed: ['dA', 'dB', 'wr'],
      explanation:
        'Die Überlebenden sind nach Gen1 promotet. `Data C` ist weg, das `WeakReference`-Objekt lebt weiter, sein Handle ist jetzt leer.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [data('A', 'g1', 'live'), data('B', 'g1', 'live'), weakObj('g1', 'live')],
        roots: [rootA, normal(), weakLocal, weak([])],
        phase: 'done',
        output: 'False\nTrue',
      },
      explanation:
        '`TryGetTarget` liefert `false`, das Normal-Handle liefert sein Ziel noch. Ein `WeakReference` beobachtet ein Objekt, ohne es am Leben zu halten.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [data('A', 'g1', 'live'), data('B', 'g1', 'dead'), weakObj('g1', 'live')],
        roots: [rootA, weakLocal, weak([])],
        phase: 'done',
        output: 'False\nTrue',
      },
      changed: ['dB'],
      explanation:
        '`Free` entfernt den Eintrag aus der Handle-Tabelle. Erst jetzt ist `Data B` unerreichbar und wird bei der nächsten Collection von Gen1 frei. Ohne `Free` bliebe es für immer am Leben: ein Leck, das kein Profiler einer Variable zuordnen kann.',
    },
  ],
});
