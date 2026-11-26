import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual scenario. The edge from Widget 2 to Meta 2 is not a field: it stands for the
// dependent handle, which keeps the secondary (value) alive exactly as long as the primary (key)
// is alive. Internals of the table (container, entries array) are omitted.
// TODO(verify): ConditionalWeakTable<TKey, TValue> is implemented with dependent handles in
// CoreCLR (ConditionalWeakTable.cs uses DependentHandle).

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
type Root = NonNullable<GcHeapState['roots']>[number];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
];

const dict = (region = 'g0', status?: Status): Obj => ({
  id: 'dict',
  region,
  label: 'Dictionary<object, Meta>',
  refs: ['k1', 'm1'],
  status,
});
const cwt = (region = 'g0', status?: Status): Obj => ({
  id: 'cwt',
  region,
  label: 'ConditionalWeakTable<object, Meta>',
  status,
});
const widget = (i: number, region = 'g0', status?: Status, refs?: string[]): Obj => ({
  id: `k${i}`,
  region,
  label: i === 2 ? 'Widget 2 (Schlüssel)' : 'Widget 1 (Schlüssel)',
  refs,
  status,
});
const meta = (i: number, region = 'g0', status?: Status): Obj => ({
  id: `m${i}`,
  region,
  label: i === 2 ? 'Meta 2 (Wert, zeigt auf Widget 2)' : 'Meta 1 (Wert, zeigt auf Widget 1)',
  refs: [`k${i}`],
  status,
});

const dictRoot: Root = { id: 'r-dict', label: 'dict', refs: ['dict'] };
const cwtRoot: Root = { id: 'r-cwt', label: 'cwt', refs: ['cwt'] };
const k1Root = (refs: string[] = ['k1']): Root => ({ id: 'r-k1', label: 'k1', refs });
const k2Root = (refs: string[] = ['k2']): Root => ({ id: 'r-k2', label: 'k2', refs });
const dep = (refs: string[] = ['k2']): Root => ({
  id: 'r-dep',
  label: 'Dependent-Handle (keine Root)',
  refs,
});

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Dictionary gegen ConditionalWeakTable',
  code: {
    cs: `var dict = new Dictionary<object, Meta>();
var cwt = new ConditionalWeakTable<object, Meta>();
var k1 = new Widget(); dict[k1] = new Meta(k1);
var k2 = new Widget(); cwt.Add(k2, new Meta(k2));
k1 = null;
k2 = null;
GC.Collect(0);`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        regions,
        objects: [dict(), cwt(), widget(1), meta(1)],
        roots: [dictRoot, cwtRoot, k1Root()],
        phase: 'alloc',
      },
      changed: ['k1', 'm1', 'dict'],
      explanation:
        'Das `Dictionary` hält Schlüssel und Wert mit starken Verweisen. Der Wert `Meta 1` zeigt zusätzlich zurück auf seinen Schlüssel, ein ganz typischer Fall für angehängte Zusatzdaten.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [dict(), cwt(), widget(1), meta(1), widget(2, 'g0', undefined, ['m2']), meta(2)],
        roots: [dictRoot, cwtRoot, k1Root(), k2Root(), dep()],
        phase: 'alloc',
      },
      changed: ['k2', 'm2', 'r-dep'],
      explanation:
        'Die `ConditionalWeakTable` legt pro Eintrag ein **Dependent-Handle** an. Es hält den Schlüssel nicht fest. Der Pfeil von `Widget 2` zu `Meta 2` ist kein Feld, er steht für die Regel des Handles: Der Wert lebt genau so lange wie der Schlüssel.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [dict(), cwt(), widget(1), meta(1), widget(2, 'g0', undefined, ['m2']), meta(2)],
        roots: [dictRoot, cwtRoot, k1Root([]), k2Root([]), dep()],
        phase: 'alloc',
      },
      changed: ['r-k1', 'r-k2'],
      explanation:
        'Beide Widgets werden vom Programm nicht mehr gebraucht. Die lokalen Variablen zeigen auf nichts mehr.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          dict('g0', 'marked'),
          cwt('g0', 'marked'),
          widget(1, 'g0', 'marked'),
          meta(1, 'g0', 'marked'),
          widget(2, 'g0', 'unknown', ['m2']),
          meta(2, 'g0', 'unknown'),
        ],
        roots: [dictRoot, cwtRoot, k1Root([]), k2Root([]), dep()],
        phase: 'mark',
      },
      changed: ['dict', 'cwt', 'k1', 'm1'],
      explanation:
        '**Markieren:** Über `dict` erreicht der GC `Widget 1` und `Meta 1`, beide überleben. `Widget 2` erreicht er von keiner Root aus. Dass `Meta 2` auf `Widget 2` zeigt, spielt keine Rolle, denn `Meta 2` selbst ist nur über `Widget 2` erreichbar.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [
          dict('g1', 'live'),
          cwt('g1', 'live'),
          widget(1, 'g1', 'live'),
          meta(1, 'g1', 'live'),
        ],
        roots: [dictRoot, cwtRoot, k1Root([]), k2Root([]), dep([])],
        phase: 'done',
      },
      changed: ['r-dep', 'dict', 'cwt', 'k1', 'm1'],
      explanation:
        'Der Eintrag der Tabelle ist samt Wert verschwunden, das Dependent-Handle ist leer. Im `Dictionary` dagegen lebt `Widget 1` ewig. Häufige Fehlannahme: Ein `Dictionary` mit `WeakReference`-Schlüsseln löse das. Nein, der stark gehaltene Wert zeigt ja weiter auf den Schlüssel.',
    },
  ],
});
