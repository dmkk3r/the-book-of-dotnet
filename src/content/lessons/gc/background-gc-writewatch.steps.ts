import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual model of why concurrent marking needs to track writes. The general problem (a
// mutator hides an object behind an already visited object) is the standard argument for
// concurrent marking. How the .NET GC tracks those writes is only sketched here.
// TODO(verify): The .NET GC uses write watch (OS write watch on Windows or software write watch
// updated by the write barrier, see src/coreclr/gc/softwarewritewatch.h and
// GCHeap revisit_written_pages in gc.cpp) to find pages modified during background marking, and
// revisits them concurrently and once more in the final suspension. Exact granularity (page size)
// and the number of concurrent revisit passes are not verified.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g2', kind: 'gen2', label: 'Gen2 (Seite P)' },
];

const cache = (refs: string[], status?: Status): Obj => ({
  id: 'cache',
  region: 'g2',
  label: 'Cache',
  refs,
  status,
});
const queue = (refs: string[], status?: Status): Obj => ({
  id: 'queue',
  region: 'g2',
  label: 'Queue',
  refs,
  status,
});
const order = (status?: Status): Obj => ({
  id: 'order',
  region: 'g2',
  label: 'Order',
  status,
});

const roots = [
  { id: 'r-cache', label: 's_cache', refs: ['cache'] },
  { id: 'r-queue', label: 's_queue', refs: ['queue'] },
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Warum nebenläufiges Markieren Schreibzugriffe verfolgen muss',
  code: {
    cs: `// Läuft auf einem Anfrage-Thread, während der BGC-Thread markiert
var o = s_queue.First;     // Order, liegt in Gen2
s_cache.Last = o;          // Verweis in ein schon markiertes Objekt schreiben
s_queue.First = null;      // einzigen anderen Verweis entfernen`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        regions,
        objects: [cache([], 'unknown'), queue(['order'], 'unknown'), order('unknown')],
        roots,
        phase: 'mark',
      },
      explanation:
        'Eine Background GC markiert Gen2. Noch ist kein Objekt besucht. `Order` ist nur über die `Queue` erreichbar.',
    },
    {
      codeLine: 1,
      state: {
        regions,
        objects: [cache([], 'marked'), queue(['order'], 'unknown'), order('unknown')],
        roots,
        phase: 'mark',
      },
      changed: ['cache'],
      explanation:
        'Der BGC-Thread hat den `Cache` besucht und markiert. Er hat dessen Felder gelesen und wird ihn in diesem Durchlauf nicht noch einmal ansehen.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [cache(['order'], 'marked'), queue(['order'], 'unknown'), order('unknown')],
        roots,
        phase: 'mark',
      },
      changed: ['cache'],
      explanation:
        'Jetzt schreibt der Anfrage-Thread einen Verweis auf `Order` in den **schon markierten** `Cache`. Der BGC-Thread bekommt davon nichts mit, er ist mit dem `Cache` fertig.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [cache(['order'], 'marked'), queue([], 'unknown'), order('unknown')],
        roots,
        phase: 'mark',
      },
      changed: ['queue'],
      explanation:
        'Dann entfernt er den Verweis aus der `Queue`. Wenn der BGC-Thread die `Queue` nun besucht, findet er `Order` dort nicht mehr. `Order` lebt, wäre aber nach der Markierung **unmarkiert**.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [cache(['order'], 'marked'), queue([], 'marked'), order('unknown')],
        roots,
        phase: 'mark',
        output: 'Seite P wurde während der Markierung beschrieben (Write Watch).',
      },
      changed: ['queue'],
      explanation:
        'Ohne Gegenmaßnahme würde ein lebendes Objekt freigegeben. Deshalb protokolliert die Runtime, welche Speicherseiten während der nebenläufigen Markierung **beschrieben** wurden. Die Zuweisung an `s_cache.Last` hat die Seite des `Cache` als geändert vermerkt.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [cache(['order'], 'marked'), queue([], 'marked'), order('marked')],
        roots,
        phase: 'mark',
        output: 'Geänderte Seiten werden erneut besucht, zuletzt in der Abschlusspause.',
      },
      changed: ['order', 'cache'],
      explanation:
        'Der GC besucht die geänderten Seiten erneut und folgt den Verweisen der Objekte darauf. So findet er `Order` über den `Cache`. Damit am Ende nichts übersehen bleibt, geschieht der letzte Durchgang in der kurzen Abschlusspause, wenn niemand mehr schreiben kann.',
    },
    {
      codeLine: 3,
      state: {
        regions,
        objects: [cache(['order'], 'live'), queue([], 'live'), order('live')],
        roots,
        phase: 'sweep',
      },
      changed: ['order'],
      explanation:
        'Die Markierung ist korrekt, der Sweep darf beginnen. Der Preis: Je mehr das Programm während der Markierung schreibt, desto mehr Seiten muss der GC erneut besuchen, und desto länger kann die Abschlusspause werden.',
    },
  ],
});
