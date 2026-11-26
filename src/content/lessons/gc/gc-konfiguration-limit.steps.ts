import { defineStepScript, type GraphState } from '@/components/viz';

// Order of precedence and the container default (75 % of the container limit, at least 20 MB)
// come from Microsoft Learn, "Runtime configuration options for garbage collection".
// TODO(verify): Whether the GC reads cgroup v1 and v2 memory limits in the same way, and which
// .NET version introduced the 75 % / 20 MB default (believed .NET Core 3.0).
// TODO(verify): Exact value reported by GCMemoryInfo.TotalAvailableMemoryBytes in each case
// (docs: "an implementation-defined fraction of the container's size").

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Status = Node['status'];

// The precedence as a chain of questions in column 1, top to bottom; every "ja" ends in column 2.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'cgroup', label: 'Container-Limit lesen', detail: 'cgroup memory limit', row: 1, col: 1 },
  {
    id: 'perheap',
    label: 'Limits pro Objekt-Heap?',
    detail: 'SOH, LOH, POH',
    row: 2,
    col: 1,
    shape: 'decision',
  },
  {
    id: 'p-perheap',
    label: 'Limits pro Heap',
    // TODO(verify): that the total limit is the sum of the per-heap limits (GCHeapHardLimitSOH/LOH/POH).
    detail: 'Summe der Teile',
    row: 2,
    col: 2,
    shape: 'end',
  },
  {
    id: 'hard',
    label: 'GCHeapHardLimit?',
    detail: 'feste Bytezahl',
    row: 3,
    col: 1,
    shape: 'decision',
  },
  { id: 'p-hard', label: 'Feste Grenze', row: 3, col: 2, shape: 'end' },
  {
    id: 'percent',
    label: 'GCHeapHardLimitPercent?',
    detail: 'Prozent des Limits',
    row: 4,
    col: 1,
    shape: 'decision',
  },
  { id: 'p-percent', label: 'Prozent des Limits', row: 4, col: 2, shape: 'end' },
  {
    id: 'default',
    label: 'Standard im Container',
    detail: '75 %, mindestens 20 MB',
    row: 5,
    col: 1,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'cgroup', to: 'perheap' },
  { from: 'perheap', to: 'p-perheap', label: 'ja' },
  { from: 'perheap', to: 'hard', label: 'nein' },
  { from: 'hard', to: 'p-hard', label: 'ja' },
  { from: 'hard', to: 'percent', label: 'nein' },
  { from: 'percent', to: 'p-percent', label: 'ja' },
  { from: 'percent', to: 'default', label: 'nein' },
];

/**
 * Graph for one run: `path` lists the visited nodes in order, the last one is active unless
 * `status` overrides it. Results off the path are skipped once the run has reached a result.
 */
function run(
  path: string[],
  {
    details = {},
    status = {},
  }: { details?: Record<string, string>; status?: Partial<Record<string, Status>> } = {},
): Pick<GraphState, 'nodes' | 'edges'> {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  const finished = NODES.some((n) => n.shape === 'end' && visited.has(n.id));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status:
        status[n.id] ??
        (n.id === path[path.length - 1]
          ? 'active'
          : visited.has(n.id)
            ? 'done'
            : finished && n.shape === 'end'
              ? 'skipped'
              : 'pending'),
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
  };
}

const RUN1 = ['cgroup', 'perheap', 'hard', 'percent', 'default'];
const RUN2 = ['cgroup', 'perheap', 'hard', 'percent', 'p-percent'];
const RUN3 = ['cgroup', 'perheap', 'hard', 'p-hard'];

const container = {
  id: 'f-container',
  label: 'Container-Limit (docker --memory)',
  value: '512 MiB',
};

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wie der GC sein Heap-Limit bestimmt',
  code: {
    cs: `# Lauf 1: nur ein Container-Limit
docker run --memory=512m myapp

# Lauf 2: zusätzlich ein Prozentwert (hexadezimal: 0x32 = 50)
docker run --memory=512m -e DOTNET_GCHeapHardLimitPercent=0x32 myapp

# Lauf 3: feste Grenze (hexadezimal: 0xC800000 = 200 MiB)
docker run --memory=512m -e DOTNET_GCHeapHardLimit=0xC800000 myapp`,
  },
  steps: [
    {
      codeLine: 2,
      state: { ...run(['cgroup']), facts: [container] },
      changed: ['cgroup', 'f-container'],
      explanation:
        'Beim Start liest die Runtime das Speicherlimit des Containers aus den cgroups. Für den GC ist dieses Limit ab jetzt der **gesamte physische Speicher**, egal wie viel RAM der Host hat.',
    },
    {
      codeLine: 2,
      state: {
        ...run(RUN1, { details: { default: '384 MiB' } }),
        facts: [
          container,
          { id: 'f-set', label: 'Explizit gesetzt', value: 'nichts' },
          {
            id: 'f-limit',
            label: 'Heap Hard Limit',
            value: 'max(20 MB, 75 % von 512 MiB) = 384 MiB',
          },
        ],
      },
      changed: ['default', 'f-set', 'f-limit'],
      explanation:
        'Keine der Einstellungen ist gesetzt, also greift der Standard: 75 % des Container-Limits, mindestens 20 MB. Die restlichen 128 MiB bleiben für alles, was nicht GC-Heap ist.',
    },
    {
      codeLine: 5,
      state: {
        ...run(RUN2, { details: { 'p-percent': '256 MiB' } }),
        facts: [
          container,
          { id: 'f-set', label: 'DOTNET_GCHeapHardLimitPercent', value: '0x32 (dezimal 50)' },
          { id: 'f-limit', label: 'Heap Hard Limit', value: '50 % von 512 MiB = 256 MiB' },
        ],
      },
      changed: ['p-percent', 'f-set', 'f-limit'],
      explanation:
        'Lauf 2 setzt einen Prozentwert. Er bezieht sich auf das Container-Limit, und der Standard wird nicht mehr gebraucht. Achtung: Als Umgebungsvariable ist der Wert **hexadezimal**, `0x32` bedeutet 50.',
    },
    {
      codeLine: 5,
      state: {
        ...run(RUN2, { details: { 'p-percent': '256 MiB' } }),
        facts: [
          container,
          { id: 'f-set', label: 'DOTNET_GCHeapHardLimitPercent', value: '32 (ohne 0x)' },
          { id: 'f-limit', label: 'Heap Hard Limit', value: '50 % von 512 MiB = 256 MiB' },
        ],
      },
      changed: ['f-set'],
      explanation:
        'Häufige Fehlannahme: `32` heiße 32 Prozent. In Umgebungsvariablen wird die Zahl auch ohne Präfix hexadezimal gelesen, `32` ist also ebenfalls 50 Prozent. Wer 32 Prozent will, schreibt `0x20` oder `20`.',
    },
    {
      codeLine: 8,
      state: {
        ...run(RUN3, { details: { 'p-hard': '200 MiB' }, status: { percent: 'skipped' } }),
        facts: [
          container,
          { id: 'f-set', label: 'DOTNET_GCHeapHardLimit', value: '0xC800000 (dezimal 209715200)' },
          { id: 'f-limit', label: 'Heap Hard Limit', value: '200 MiB' },
        ],
      },
      changed: ['p-hard', 'percent', 'f-set', 'f-limit'],
      explanation:
        'Eine feste Grenze schlägt den Prozentwert: `GCHeapHardLimitPercent` wird ignoriert, wenn `GCHeapHardLimit` gesetzt ist. Beides wird nur noch übertroffen von Limits pro Objekt-Heap (SOH, LOH, POH).',
    },
    {
      codeLine: 8,
      state: {
        ...run(RUN3, {
          details: { 'p-hard': '200 MiB' },
          status: { percent: 'skipped', 'p-hard': 'done' },
        }),
        facts: [
          {
            id: 'f-order',
            label: 'Reihenfolge',
            value: 'pro Objekt-Heap, dann absolut, dann Prozent, dann Standard',
          },
          {
            id: 'f-scope',
            label: 'Umfang',
            value: 'GC-Heap plus Buchhaltung des GC, kein nativer Speicher',
          },
        ],
      },
      changed: ['f-order', 'f-scope'],
      explanation:
        'Das Limit begrenzt den **committeten Speicher des GC-Heaps** samt der Verwaltungsdaten des GC. Native Allokationen, Thread-Stacks und JIT-Code zählen nicht dazu, die passen in den Rest bis zum Container-Limit oder eben nicht.',
    },
  ],
});
