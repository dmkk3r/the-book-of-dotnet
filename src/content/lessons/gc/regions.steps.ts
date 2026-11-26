import { defineStepScript, type GcHeapState } from '@/components/viz';

// Regions heap (.NET 7+, 64-bit). Conceptual, no sizes. Behavior from plan_phase.cpp:
// - compacting GC: survivors are planned into regions of the next generation, regions without
//   survivors go back to the free region list (returning to free does not decommit),
// - sweeping GC: condemned regions are promoted as a whole ("if we are not in special sweep we
//   need to promote all regions", find_first_valid_region).
// Whether a given GC compacts or sweeps is decided for the whole GC in the plan phase.
// TODO(verify): That gen0 always gets a fresh/free region after a GC and the exact region ids
// chosen; the free list is shown in the console line for illustration.

type Obj = GcHeapState['objects'][number];
type Status = Obj['status'];
type Region = GcHeapState['regions'][number];

const R1: Region = { id: 'r1', kind: 'gen0', label: 'R1 (Gen0)' };
const R2: Region = { id: 'r2', kind: 'gen0', label: 'R2 (Gen0)' };
const R3: Region = { id: 'r3', kind: 'gen1', label: 'R3 (Gen1)' };
const R4: Region = { id: 'r4', kind: 'gen2', label: 'R4 (Gen2)' };
const R5: Region = { id: 'r5', kind: 'gen0', label: 'R5 (Gen0)' };
const R5promoted: Region = { id: 'r5', kind: 'gen1', label: 'R5 (jetzt Gen1)' };
const R6: Region = { id: 'r6', kind: 'gen0', label: 'R6 (Gen0)' };

const o = (id: string, region: string, label: string, status?: Status, refs?: string[]): Obj => ({
  id,
  region,
  label,
  status,
  refs,
});

const old = (status?: Status): Obj[] => [
  o('config', 'r4', 'Config', status),
  o('entry', 'r3', 'Eintrag', status),
];

const firstRoots = [
  { id: 'r-config', label: 's_config', refs: ['config'] },
  { id: 'r-order', label: 'order', refs: ['order'] },
  { id: 'r-session', label: 'session', refs: ['session'] },
];

const young = (s: { order?: Status; session?: Status; dead?: Status }): Obj[] => [
  o('p1', 'r1', 'Puffer', s.dead),
  o('order', 'r1', 'Order', s.order),
  o('p2', 'r1', 'Puffer', s.dead),
  o('p3', 'r2', 'Puffer', s.dead),
  o('session', 'r2', 'Session', s.session),
];

const batch = (status: Status | undefined, region = 'r5'): Obj[] => [
  o('b1', region, 'Zeile 1', status),
  o('b2', region, 'Zeile 2', status),
  o('b3', region, 'Zeile 3', status),
  o('b4', region, 'Zeile 4', status),
];

const batchRoots = [
  { id: 'r-config', label: 's_config', refs: ['config'] },
  { id: 'r-rows', label: 'rows', refs: ['b1', 'b2', 'b3', 'b4'] },
];

export default defineStepScript({
  view: 'gcheap',
  layout: 'stacked',
  title: 'Eine Gen0-Collection mit Regions',
  code: {
    cs: `var order = new Order();         // überlebt
var session = new Session();     // überlebt
// ... viele kurzlebige Puffer
GC.Collect(0);                   // der GC entscheidet sich fürs Kompaktieren

var rows = LoadRows();           // fast alles bleibt am Leben
GC.Collect(0);                   // diesmal entscheidet er sich fürs Freigeben`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        regions: [R1, R2, R3, R4],
        objects: [...young({}), ...old()],
        roots: firstRoots,
        phase: 'alloc',
        output: 'Freie Regions: R5, R6',
      },
      explanation:
        'Mit **Regions** besteht der Heap aus vielen gleich großen Blöcken. Jede Generation besitzt eine Liste davon: Gen0 hier R1 und R2, Gen1 R3, Gen2 R4. Unbenutzte Regions liegen in einer **Freiliste**.',
    },
    {
      codeLine: 4,
      state: {
        regions: [R1, R2, R3, R4],
        objects: [...young({ order: 'marked', session: 'marked', dead: 'unknown' }), ...old()],
        roots: firstRoots,
        phase: 'mark',
        output: 'Freie Regions: R5, R6',
      },
      changed: ['order', 'session'],
      explanation:
        'Die Gen0-Collection markiert wie gewohnt ab den Roots. In jeder Gen0-Region überlebt nur ein Objekt, der Rest ist Müll.',
    },
    {
      codeLine: 4,
      state: {
        regions: [R1, R2, R3, R4],
        objects: [
          o('entry', 'r3', 'Eintrag'),
          o('order', 'r3', 'Order', 'live'),
          o('session', 'r3', 'Session', 'live'),
          o('config', 'r4', 'Config'),
        ],
        roots: firstRoots,
        phase: 'compact',
        output: 'Freie Regions: R5, R6',
      },
      changed: ['order', 'session'],
      explanation:
        'Bei wenigen Überlebenden lohnt sich **Kompaktieren**: Der GC kopiert `Order` und `Session` hinter die vorhandenen Objekte in einer Gen1-Region. Promotion heißt hier also Kopieren in eine Region der älteren Generation.',
    },
    {
      codeLine: 4,
      state: {
        regions: [R3, R4, R5],
        objects: [
          o('entry', 'r3', 'Eintrag'),
          o('order', 'r3', 'Order', 'live'),
          o('session', 'r3', 'Session', 'live'),
          o('config', 'r4', 'Config'),
        ],
        roots: firstRoots,
        phase: 'done',
        output: 'Freie Regions: R1, R2, R6',
      },
      changed: ['r5'],
      explanation:
        'R1 und R2 sind jetzt leer und gehen als Ganzes zurück in die Freiliste. Gen0 bekommt eine freie Region für neue Allokationen. Eine freie Region kann später **jede Generation** übernehmen, nicht nur die, aus der sie kam.',
    },
    {
      codeLine: 6,
      state: {
        regions: [R3, R4, R5],
        objects: [
          o('entry', 'r3', 'Eintrag'),
          o('order', 'r3', 'Order'),
          o('session', 'r3', 'Session'),
          o('config', 'r4', 'Config', 'marked'),
          ...batch('marked'),
          o('p4', 'r5', 'Puffer', 'unknown'),
        ],
        roots: batchRoots,
        phase: 'mark',
        output: 'Freie Regions: R1, R2, R6',
      },
      changed: ['b1', 'b2', 'b3', 'b4'],
      explanation:
        'Zweite Collection: `LoadRows` hat R5 fast vollständig mit Objekten gefüllt, die alle am Leben bleiben. Sie alle zu kopieren, wäre teuer und würde kaum Platz gewinnen.',
    },
    {
      codeLine: 7,
      state: {
        regions: [R3, R4, R5promoted, R6],
        objects: [
          o('entry', 'r3', 'Eintrag'),
          o('order', 'r3', 'Order'),
          o('session', 'r3', 'Session'),
          o('config', 'r4', 'Config'),
          ...batch('live'),
        ],
        roots: batchRoots,
        phase: 'sweep',
        output: 'Freie Regions: R1, R2',
      },
      changed: ['r5', 'r6'],
      explanation:
        'Häufige Fehlannahme: Promotion bedeute immer Kopieren. Entscheidet sich der GC fürs **Freigeben** statt Kompaktieren, bleibt jedes Objekt, wo es ist, und **R5 wird als Ganzes Gen1**. Die Lücke des toten Puffers kommt in eine Freiliste, Gen0 übernimmt R6.',
    },
  ],
});
