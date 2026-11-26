import { defineStepScript, type GcHeapState } from '@/components/viz';

// Conceptual scenario without sizes. Locals are nulled explicitly to make the model visible;
// in a real experiment the allocation belongs in a [MethodImpl(NoInlining)] helper.
// TODO(verify): Order of mark steps in gc.cpp mark_phase (roots, short weak handles,
// ScanForFinalization, marking from the f-reachable queue, long weak handles).
// TODO(verify): Survivors of a Gen0 collection end up in Gen1 (no demotion in this scenario).

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
type Root = NonNullable<GcHeapState['roots']>[number];

const regions: GcHeapState['regions'] = [
  { id: 'g0', kind: 'gen0' },
  { id: 'g1', kind: 'gen1' },
  { id: 'g2', kind: 'gen2' },
];

const logFile = (region = 'g0', status?: Status): Obj => ({
  id: 'log',
  region,
  label: 'LogFile (mit Finalizer)',
  refs: ['buf'],
  status,
});
const buffer = (region = 'g0', status?: Status): Obj => ({
  id: 'buf',
  region,
  label: 'byte[4096] (Puffer)',
  status,
});
const order = (status?: Status): Obj => ({
  id: 'order',
  region: 'g0',
  label: 'Order (ohne Finalizer)',
  status,
});

const logRoot = (refs: string[] = ['log']): Root => ({ id: 'r-log', label: 'log', refs });
const orderRoot = (refs: string[] = ['order']): Root => ({ id: 'r-order', label: 'order', refs });
const fq = (refs: string[] = ['log']): Root => ({
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
  title: 'Ein Objekt mit Finalizer durch zwei Collections',
  code: {
    cs: `var log = new LogFile("app.log");   // Typ mit ~LogFile()
var order = new Order();            // Typ ohne Finalizer
log = null;
order = null;
GC.Collect(0);                      // 1. Collection (Gen0)
GC.WaitForPendingFinalizers();      // Finalizer-Thread arbeitet
GC.Collect(0);                      // 2. Collection (Gen0)
GC.Collect(1);                      // 3. Collection (Gen0 und Gen1)`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        regions,
        objects: [logFile(), buffer()],
        roots: [logRoot(), fq(), freach()],
        phase: 'alloc',
      },
      changed: ['log', 'buf', 'r-fq'],
      explanation:
        '`LogFile` überschreibt `Finalize`. Deshalb trägt die Runtime das neue Objekt schon **bei der Allokation** in die **Finalization Queue** ein. Diese Liste hält das Objekt nicht am Leben, sie merkt sich nur: „Vor dem Freigeben Finalizer aufrufen.“',
    },
    {
      codeLine: 2,
      state: {
        regions,
        objects: [logFile(), buffer(), order()],
        roots: [logRoot(), orderRoot(), fq(), freach()],
        phase: 'alloc',
      },
      changed: ['order'],
      explanation:
        '`Order` hat keinen Finalizer und landet in keiner Liste. Zum Vergleich: Dieses Objekt behandelt der GC ganz normal.',
    },
    {
      codeLine: 4,
      state: {
        regions,
        objects: [logFile(), buffer(), order()],
        roots: [logRoot([]), orderRoot([]), fq(), freach()],
        phase: 'alloc',
      },
      changed: ['r-log', 'r-order'],
      explanation:
        'Beide lokalen Variablen zeigen auf nichts mehr. Von den Roots aus ist weder `LogFile` noch `Order` erreichbar. Freigegeben wird trotzdem noch nichts, denn das passiert erst bei einer Collection.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [logFile('g0', 'unknown'), buffer('g0', 'unknown'), order('unknown')],
        roots: [logRoot([]), orderRoot([]), fq(), freach()],
        phase: 'mark',
      },
      changed: ['log', 'buf', 'order'],
      explanation:
        '**Markieren ab den Roots:** Der GC folgt allen echten Roots und findet keines der drei Objekte. Die Finalization Queue zählt dabei nicht als Root, sonst würde nie ein Objekt mit Finalizer sterben.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [logFile('g0', 'marked'), buffer('g0', 'marked'), order('unknown')],
        roots: [logRoot([]), orderRoot([]), fq([]), freach(['log'])],
        phase: 'mark',
      },
      changed: ['r-fq', 'r-freach', 'log', 'buf'],
      explanation:
        'Jetzt prüft der GC die Finalization Queue. `LogFile` ist unmarkiert, also tot, hat aber einen Finalizer. Der Eintrag wandert in die **F-Reachable Queue**, und die ist eine Root: Der GC markiert `LogFile` und alles, worauf es zeigt, also auch den Puffer.',
    },
    {
      codeLine: 5,
      state: {
        regions,
        objects: [logFile('g1', 'live'), buffer('g1', 'live')],
        roots: [logRoot([]), orderRoot([]), fq([]), freach(['log'])],
        phase: 'done',
      },
      changed: ['log', 'buf'],
      explanation:
        'Häufige Fehlannahme: „Der GC ruft den Finalizer auf und gibt das Objekt dann frei.“ Tatsächlich ist nur `Order` weg. `LogFile` und sein Puffer haben überlebt und wurden wie jedes lebende Objekt nach **Gen1 promotet**.',
    },
    {
      codeLine: 6,
      state: {
        regions,
        objects: [logFile('g1', 'dead'), buffer('g1', 'dead')],
        roots: [logRoot([]), orderRoot([]), fq([]), freach([])],
        phase: 'done',
      },
      changed: ['r-freach', 'log', 'buf'],
      explanation:
        'Nach der Collection läuft auf dem **Finalizer-Thread** `~LogFile()`. Danach nimmt die Runtime den Eintrag aus der F-Reachable Queue. Jetzt ist `LogFile` wirklich unerreichbar, belegt aber weiter Speicher in Gen1.',
    },
    {
      codeLine: 7,
      state: {
        regions,
        objects: [logFile('g1', 'dead'), buffer('g1', 'dead')],
        roots: [logRoot([]), orderRoot([]), fq([]), freach([])],
        phase: 'done',
      },
      explanation:
        'Eine Gen0-Collection hilft nicht mehr: `LogFile` liegt durch die Promotion in Gen1, und Gen1 wird bei einer Gen0-Collection nicht untersucht. Der Speicher bleibt belegt.',
    },
    {
      codeLine: 8,
      state: {
        regions,
        objects: [],
        roots: [logRoot([]), orderRoot([]), fq([]), freach([])],
        phase: 'done',
      },
      explanation:
        'Erst eine Collection, die Gen1 einschließt, gibt `LogFile` und den Puffer frei. Ein einziger Finalizer hat also mindestens eine zusätzliche Collection und eine Promotion des ganzen Objektgraphen gekostet.',
    },
  ],
});
