import { defineStepScript, type GcHeapState } from '@/components/viz';

// GC.SuppressFinalize docs: "This method sets a bit in the object header of obj, which the
// runtime checks when calling finalizers."
// TODO(verify): In CFinalize::ScanForFinalization (gc.cpp) an entry whose header has the
// "finalizer run" bit set is dropped in the same collection instead of being moved to the
// f-reachable queue, so a disposed object is freed by its first collection.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
type Root = NonNullable<GcHeapState['roots']>[number];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
];

const fileA = (status?: Status, suppressed = false, region = 'g0'): Obj => ({
  id: 'a',
  region,
  label: suppressed ? 'Datei a (Finalizer unterdrückt)' : 'Datei a',
  status,
});
const fileB = (status?: Status, region = 'g0'): Obj => ({
  id: 'b',
  region,
  label: 'Datei b',
  status,
});

const fq = (refs: string[]): Root => ({
  id: 'r-fq',
  label: 'Finalization Queue (keine Root)',
  refs,
});
const freach = (refs: string[] = []): Root => ({
  id: 'r-freach',
  label: 'F-Reachable Queue (Root)',
  refs,
});

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Dispose mit SuppressFinalize gegen vergessenes Dispose',
  code: {
    cs: `var a = new NativeFile("a.dat");
var b = new NativeFile("b.dat");
a.Dispose();          // gibt das Handle frei, ruft GC.SuppressFinalize(this)
a = null;
b = null;             // Dispose vergessen
GC.Collect(0);`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        regions,
        objects: [fileA(), fileB()],
        roots: [
          { id: 'r-a', label: 'a', refs: ['a'] },
          { id: 'r-b', label: 'b', refs: ['b'] },
          fq(['a', 'b']),
          freach(),
        ],
        phase: 'alloc',
      },
      changed: ['a', 'b', 'r-fq'],
      explanation:
        'Zwei Objekte eines Typs mit Finalizer, beide stehen in der Finalization Queue. Jedes hält ein Betriebssystem-Handle.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [fileA(undefined, true), fileB()],
        roots: [
          { id: 'r-a', label: 'a', refs: ['a'] },
          { id: 'r-b', label: 'b', refs: ['b'] },
          fq(['a', 'b']),
          freach(),
        ],
        phase: 'alloc',
      },
      changed: ['a'],
      explanation:
        '`Dispose` schließt das Handle sofort und ruft `GC.SuppressFinalize(this)`. Laut Dokumentation setzt das ein Bit im Object Header, das die Runtime prüft, bevor sie einen Finalizer aufruft. Das Objekt bleibt in der Liste, ist aber als „nicht mehr finalisieren“ markiert.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [fileA(undefined, true), fileB()],
        roots: [
          { id: 'r-a', label: 'a', refs: [] },
          { id: 'r-b', label: 'b', refs: [] },
          fq(['a', 'b']),
          freach(),
        ],
        phase: 'alloc',
      },
      changed: ['r-a', 'r-b'],
      explanation:
        'Beide Objekte sind unerreichbar. Der Unterschied: Für `b` wurde nie `Dispose` aufgerufen, sein Handle ist noch offen.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [fileA('unknown', true), fileB('marked')],
        roots: [
          { id: 'r-a', label: 'a', refs: [] },
          { id: 'r-b', label: 'b', refs: [] },
          fq([]),
          freach(['b']),
        ],
        phase: 'mark',
      },
      changed: ['r-fq', 'r-freach', 'b'],
      explanation:
        'Beim Durchsuchen der Finalization Queue wird nur `b` in die F-Reachable Queue verschoben und damit wieder erreichbar. Der Eintrag von `a` fällt weg, weil sein Finalizer unterdrückt ist.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [fileB('live', 'g1')],
        roots: [
          { id: 'r-a', label: 'a', refs: [] },
          { id: 'r-b', label: 'b', refs: [] },
          fq([]),
          freach(['b']),
        ],
        phase: 'done',
      },
      changed: ['b'],
      explanation:
        '`a` ist nach einer einzigen Collection frei, wie ein Objekt ohne Finalizer. `b` wurde promotet und wartet auf den Finalizer-Thread. Genau deshalb gehört `GC.SuppressFinalize` in jedes `Dispose` eines Typs mit Finalizer.',
    },
  ],
});
