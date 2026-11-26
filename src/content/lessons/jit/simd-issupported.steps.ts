import { defineStepScript, type GraphState } from '@/components/viz';

// IsSupported checks are JIT-time constants: the JIT replaces them with true or false for the
// machine it compiles on and removes the dead branches (Microsoft Learn, "Use SIMD and hardware
// intrinsics in .NET": "These properties are turned into constants by the JIT").
// Config knobs: DOTNET_EnableAVX512F in .NET 8 and 9, DOTNET_EnableAVX512 (F+BW+CD+DQ+VL) in
// .NET 10 (src/coreclr/inc/clrconfigvalues.h on release/9.0 and release/10.0);
// DOTNET_EnableHWIntrinsic=0 disables all hardware intrinsics.
// TODO(verify): That Tier 0 also folds IsSupported to a constant (intrinsic expansion even in
// MinOpts) and removes the dead branches, or whether Tier 0 keeps them.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'q512', label: 'Avx512F.IsSupported?', row: 1, col: 1, shape: 'decision' },
  { id: 'p512', label: 'Pfad mit 512 Bit', detail: 'Vector512, zmm', row: 1, col: 2, shape: 'end' },
  { id: 'q256', label: 'Avx2.IsSupported?', row: 2, col: 1, shape: 'decision' },
  { id: 'p256', label: 'Pfad mit 256 Bit', detail: 'Vector256, ymm', row: 2, col: 2, shape: 'end' },
  { id: 'qneon', label: 'AdvSimd.IsSupported?', row: 3, col: 1, shape: 'decision' },
  { id: 'pneon', label: 'Pfad für Arm64', detail: 'Vector128, NEON', row: 3, col: 2, shape: 'end' },
  {
    id: 'scalar',
    label: 'Skalarer Pfad',
    detail: 'ein Element pro Befehl',
    row: 4,
    col: 1,
    shape: 'end',
  },
];

const EDGES: Edge[] = [
  { from: 'q512', to: 'p512', label: 'true' },
  { from: 'q512', to: 'q256', label: 'false' },
  { from: 'q256', to: 'p256', label: 'true' },
  { from: 'q256', to: 'qneon', label: 'false' },
  { from: 'qneon', to: 'pneon', label: 'true' },
  { from: 'qneon', to: 'scalar', label: 'false' },
];

/** `path` lists the nodes the JIT keeps, in order; everything else is removed as dead code. */
function folded(path: string[], facts: Fact[]): GraphState {
  const kept = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  const last = path[path.length - 1];
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status: n.id === last ? 'active' : kept.has(n.id) ? 'done' : 'skipped',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : kept.has(e.from) ? 'rejected' : 'idle',
    })),
    facts,
  };
}

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Der JIT faltet die IsSupported-Prüfungen zu einem Pfad',
  code: {
    cs: `static int Count(ReadOnlySpan<byte> data, byte value)
{
    if (Avx512F.IsSupported)       { /* 64 Byte pro Schritt */ }
    else if (Avx2.IsSupported)     { /* 32 Byte pro Schritt */ }
    else if (AdvSimd.IsSupported)  { /* 16 Byte pro Schritt, Arm64 */ }
    else                           { /* ein Byte pro Schritt */ }
}`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        nodes: NODES.map((n) => ({ ...n, status: 'pending' })),
        edges: EDGES.map((e) => ({ ...e })),
        facts: [{ id: 'f-where', label: 'Stand', value: 'IL in der Assembly' }],
      },
      explanation:
        'Im IL stehen alle vier Zweige, und jede Prüfung ist ein gewöhnlicher Aufruf eines Property-Getters. Die Assembly weiß nicht, auf welcher CPU sie laufen wird. Diese Entscheidung fällt erst beim Übersetzen.',
    },
    {
      codeLine: 3,
      state: folded(
        ['q512', 'p512'],
        [
          { id: 'f-where', label: 'Maschine', value: 'x64 mit AVX-512' },
          { id: 'f-const', label: 'Avx512F.IsSupported', value: 'Konstante true' },
          { id: 'f-check', label: 'Prüfung zur Laufzeit', value: 'keine' },
        ],
      ),
      changed: ['q512', 'p512', 'f-where', 'f-const', 'f-check'],
      explanation:
        'Der JIT kennt die CPU, auf der er läuft, und ersetzt `Avx512F.IsSupported` durch die Konstante `true`. Die anderen Zweige sind damit toter Code und fallen weg. Häufige Fehlannahme: `IsSupported` werde bei jedem Aufruf geprüft, dabei enthält der Maschinencode gar keine Prüfung mehr.',
    },
    {
      codeLine: 4,
      state: folded(
        ['q512', 'q256', 'p256'],
        [
          { id: 'f-where', label: 'Maschine', value: 'dieselbe, AVX-512 abgeschaltet' },
          {
            id: 'f-env',
            label: 'Schalter',
            value: 'DOTNET_EnableAVX512F=0 (ab .NET 10: EnableAVX512)',
          },
          { id: 'f-const', label: 'Avx2.IsSupported', value: 'Konstante true' },
        ],
      ),
      changed: ['q512', 'q256', 'p256', 'f-where', 'f-env', 'f-const'],
      explanation:
        'Mit einem Konfigurationsschalter meldet die Runtime AVX-512 als nicht vorhanden. Der JIT faltet die erste Prüfung zu `false` und die zweite zu `true`. So testest du den AVX2-Pfad auf einer Maschine, die eigentlich mehr kann.',
    },
    {
      codeLine: 5,
      state: folded(
        ['q512', 'q256', 'qneon', 'pneon'],
        [
          { id: 'f-where', label: 'Maschine', value: 'Arm64' },
          { id: 'f-const', label: 'Avx512F, Avx2', value: 'Konstante false' },
          { id: 'f-arm', label: 'AdvSimd.IsSupported', value: 'Konstante true' },
        ],
      ),
      changed: ['q512', 'q256', 'qneon', 'pneon', 'f-where', 'f-const', 'f-arm'],
      explanation:
        'Auf Arm64 sind alle x86-Klassen immer `false`, ihr Code fällt komplett weg. `AdvSimd` ist auf Arm64 praktisch immer vorhanden. Übrig bleibt der Pfad mit 128 Bit breiten NEON-Registern.',
    },
    {
      codeLine: 6,
      state: folded(
        ['q512', 'q256', 'qneon', 'scalar'],
        [
          { id: 'f-where', label: 'Maschine', value: 'x64, alle Intrinsics abgeschaltet' },
          { id: 'f-env', label: 'Schalter', value: 'DOTNET_EnableHWIntrinsic=0' },
          { id: 'f-const', label: 'alle Prüfungen', value: 'Konstante false' },
        ],
      ),
      changed: ['q512', 'q256', 'qneon', 'scalar', 'f-where', 'f-env', 'f-const'],
      explanation:
        'Mit `DOTNET_EnableHWIntrinsic=0` meldet jede Klasse `false`, und nur der skalare Pfad überlebt. Genau so prüfst du, ob dein Fallback stimmt, ohne eine alte CPU suchen zu müssen.',
    },
  ],
});
