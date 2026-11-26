import { defineStepScript, type GraphState } from '@/components/viz';

// Life cycle of one basic region. Reserve range and region size per Microsoft Learn
// (runtime-config/garbage-collector: 256 GB reserve by default, 4 MB SOH regions, UOH 8x).
// Free regions: plan_phase.cpp says returning a region to free does not decommit;
// decommit happens gradually (gradual decommit, global_regions_to_decommit in gc.cpp).
// TODO(verify): Timing and policy of decommitting free regions (aging of free regions,
// DECOMMIT_TIME_STEP_MILLISECONDS, budget-based number of free regions kept per heap).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

// The region as a state machine: the way in along row 1, the way back in row 2. A free region can
// be taken over again or decommitted; its address range stays reserved either way.
const NODES: Omit<Node, 'status'>[] = [
  {
    id: 'reserve',
    label: 'Reserviert',
    detail: 'Adressraum, noch kein Speicher',
    row: 1,
    col: 1,
    shape: 'state',
  },
  {
    id: 'commit',
    label: 'Committed',
    detail: 'Speicher zugesagt, Region im Einsatz',
    row: 1,
    col: 2,
    shape: 'state',
  },
  {
    id: 'gen0',
    label: 'Gen0',
    detail: 'Allocation Contexts füllen die Region',
    row: 1,
    col: 3,
    shape: 'state',
  },
  { id: 'gen1', label: 'Gen1', detail: 'als Ganzes promotet', row: 1, col: 4, shape: 'state' },
  {
    id: 'free',
    label: 'Freiliste',
    detail: 'leer, noch committed',
    row: 2,
    col: 4,
    shape: 'state',
  },
  {
    id: 'decommit',
    label: 'Decommitted',
    detail: 'Speicher zurück an das Betriebssystem',
    row: 2,
    col: 3,
    shape: 'state',
  },
];
const EDGES: Edge[] = [
  { from: 'reserve', to: 'commit', label: 'Bedarf' },
  { from: 'commit', to: 'gen0' },
  { from: 'gen0', to: 'gen1', label: 'Collection' },
  { from: 'gen1', to: 'free', label: 'leer' },
  { from: 'free', to: 'gen0', label: 'wiederverwendet' },
  { from: 'free', to: 'decommit', label: 'Überschuss' },
];

/** Graph for one step: `path` lists the visited states in order, the last one is active. */
function run(path: string[], facts: Fact[]): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const LIFE = ['reserve', 'commit', 'gen0', 'gen1', 'free', 'decommit'];
const upTo = (n: number) => LIFE.slice(0, n);
const mem = (value: string) => fact('f-mem', 'Physischer Speicher', value);
const owner = (value: string) => fact('f-owner', 'Gehört zu', value);

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Lebenszyklus einer Region',
  code: {
    cs: `// Prozessstart: der GC reserviert den Adressbereich für alle Regions
var data = LoadData();      // füllt eine Gen0-Region
GC.Collect(0);              // Region wird als Ganzes Gen1
data = null;
GC.Collect(1);              // Region ist leer
// einige Zeit später: Speicher geht an das Betriebssystem`,
  },
  steps: [
    {
      codeLine: 1,
      state: run(upTo(1), [mem('keiner'), owner('niemandem')]),
      changed: ['reserve', 'f-mem', 'f-owner'],
      explanation:
        'Beim Start **reserviert** der GC einen großen Bereich virtuellen Adressraums für alle künftigen Regions. Reservieren kostet keinen physischen Speicher, es hält nur Adressen frei.',
    },
    {
      codeLine: 2,
      state: run(upTo(2), [mem('committed'), owner('Gen0')]),
      changed: ['commit', 'f-mem'],
      explanation:
        'Braucht Gen0 eine neue Region, schneidet der GC sie aus dem reservierten Bereich und **committed** Speicher dafür. Erst jetzt zählt sie zum Speicherverbrauch des Prozesses.',
    },
    {
      codeLine: 2,
      state: run(upTo(3), [mem('committed'), owner('Gen0')]),
      changed: ['gen0'],
      explanation:
        'Die Threads allozieren mit ihren Allocation Contexts in die Region hinein, bis sie voll ist oder eine Collection kommt.',
    },
    {
      codeLine: 3,
      state: run(upTo(4), [mem('committed'), owner('Gen1')]),
      changed: ['gen1', 'f-owner'],
      explanation:
        'Die Collection gibt nur frei, statt zu kompaktieren. Die Objekte bleiben liegen, und die Region wechselt **als Ganzes** in die Liste von Gen1. Kopiert wird nichts.',
    },
    {
      codeLine: 5,
      state: run(upTo(5), [mem('committed'), owner('Freiliste')]),
      changed: ['free', 'f-owner'],
      explanation:
        'Nach der Gen1-Collection lebt in der Region nichts mehr. Sie kommt in die **Freiliste** und kann von jeder Generation wieder übernommen werden. Ihr Speicher bleibt vorerst committed, damit die Wiederverwendung billig ist.',
    },
    {
      codeLine: 6,
      state: run(upTo(6), [mem('zurückgegeben'), owner('niemandem')]),
      changed: ['decommit', 'f-mem', 'f-owner'],
      explanation:
        'Bleiben mehr freie Regions übrig, als der GC voraussichtlich braucht, **decommitted** er sie nach und nach. Der Adressbereich bleibt reserviert, der physische Speicher geht an das Betriebssystem zurück. Das geht für jede Region einzeln, unabhängig davon, was in den Nachbarregions liegt.',
    },
  ],
});
