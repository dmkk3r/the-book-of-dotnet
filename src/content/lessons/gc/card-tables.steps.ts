import { defineStepScript, type GraphState } from '@/components/viz';

// The checks of the classic x64 write barrier (segments, Workstation GC), simplified.
// Source shape: JIT_WriteBarrier_PreGrow64 in src/coreclr/vm/amd64/JitHelpers_FastWriteBarriers.asm.
// TODO(verify): Caller side (lea/mov/call) is illustrative; the real register allocation and the
// helper name shown by SharpLab (CORINFO_HELP_ASSIGN_REF) depend on platform and JIT version.
// TODO(verify): With regions (default since .NET 7 on 64-bit) the barrier compares the generations
// of the source and destination regions instead of an ephemeral range; see the lesson text.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Status = Node['status'];

// The barrier from left to right in row 1; both early exits go down into row 2.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'store', label: 'Speichern', detail: 'mov [rcx], rdx', row: 1, col: 1 },
  {
    id: 'range',
    label: 'Wert ephemer?',
    detail: 'zeigt der Wert in den ephemeren Bereich',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'check',
    label: 'Karte schon markiert?',
    detail: 'Kartenbyte für das Ziel',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'set', label: 'Karte markieren', detail: 'Kartenbyte auf 0xFF setzen', row: 1, col: 4 },
  { id: 'exit-old', label: 'Zurück', detail: 'nichts zu merken', row: 2, col: 2, shape: 'end' },
  { id: 'exit-set', label: 'Zurück', detail: 'nur gelesen', row: 2, col: 3, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'store', to: 'range' },
  { from: 'range', to: 'check', label: 'ja' },
  { from: 'range', to: 'exit-old', label: 'nein' },
  { from: 'check', to: 'set', label: 'nein' },
  { from: 'check', to: 'exit-set', label: 'ja' },
];

/**
 * Graph for one barrier call: `path` lists the visited nodes in order, the last one is active.
 * `skipped` marks nodes that are not reached in this call.
 */
function run(
  path: string[],
  skipped: string[] = [],
  details: Record<string, string> = {},
): Pick<GraphState, 'nodes' | 'edges'> {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  const status = (id: string): Status =>
    id === path[path.length - 1]
      ? 'active'
      : visited.has(id)
        ? 'done'
        : skipped.includes(id)
          ? 'skipped'
          : 'pending';
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status: status(n.id),
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
  };
}

const facts = (target: string, value: string, card: string) => [
  { id: 'target', label: 'Ziel', value: target },
  { id: 'value', label: 'Gespeicherter Wert', value },
  { id: 'card', label: 'Kartenbyte für Ziel', value: card },
];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Die Write Barrier Schritt für Schritt',
  code: {
    cs: `class Cache { public Order? Last; public Order? Prev; public Config? Owner; }
// s_cache und s_config liegen längst in Gen2
var order = new Order(42);      // neu, also Gen0
s_cache.Last = order;           // alt zeigt auf jung
s_cache.Prev = order;           // gleiche Karte noch einmal
s_cache.Owner = s_config;       // alt zeigt auf alt
s_cache.Last = null;            // null`,
    asm: `; Aufrufer, vereinfacht
lea  rcx, [rax+8]                ; rcx = Adresse von s_cache.Last
mov  rdx, rsi                    ; rdx = order
call JIT_WriteBarrier
; JIT_WriteBarrier (Segmente, Workstation), vereinfacht
mov  [rcx], rdx                  ; 1. speichern
cmp  rdx, ephemeral_low          ; 2. jung?
jb   Exit
shr  rcx, 0Bh                    ; 3. Index des Kartenbytes
cmp  byte ptr [rcx+card_table], 0FFh
jne  UpdateCardTable
ret
UpdateCardTable:
mov  byte ptr [rcx+card_table], 0FFh   ; 4. markieren
ret
Exit:
ret`,
  },
  steps: [
    {
      codeLine: 4,
      highlight: { asm: [2, 3, 4] },
      state: {
        ...run([]),
        facts: facts('s_cache.Last (Gen2, @7F08)', 'order (Gen0, @2040)', '0x00'),
      },
      changed: ['target', 'value'],
      explanation:
        'Für die Zuweisung an ein Feld eines Heap-Objekts erzeugt der JIT keinen einfachen Speicherbefehl, sondern ruft die **Write Barrier** auf. Sie bekommt die Adresse des Felds und den neuen Wert.',
    },
    {
      codeLine: 4,
      highlight: { asm: [6] },
      state: {
        ...run(['store']),
        facts: facts('s_cache.Last (Gen2, @7F08)', 'order (Gen0, @2040)', '0x00'),
      },
      changed: ['store'],
      explanation:
        'Zuerst wird ganz normal gespeichert. Die Barrier verhindert nichts und verzögert nichts, sie merkt sich nur etwas für den GC.',
    },
    {
      codeLine: 4,
      highlight: { asm: [7, 8] },
      state: {
        ...run(['store', 'range']),
        facts: facts('s_cache.Last (Gen2, @7F08)', 'order (Gen0, @2040)', '0x00'),
      },
      changed: ['range', 'value'],
      explanation:
        'Dann die Frage: Zeigt der **gespeicherte Wert** in den ephemeren Bereich, also nach Gen0 oder Gen1? `order` ist neu, die Antwort ist ja. Geprüft wird der Wert, nicht das Ziel.',
    },
    {
      codeLine: 4,
      highlight: { asm: [9, 10, 11] },
      state: {
        ...run(['store', 'range', 'check']),
        facts: facts('s_cache.Last (Gen2, @7F08)', 'order (Gen0, @2040)', '0x00'),
      },
      changed: ['check', 'card'],
      explanation:
        'Aus der **Zieladresse** wird durch Verschieben um 11 Bit der Index eines Bytes in der Card Table. Ein Byte steht damit für 2048 Byte Heap. Es ist noch 0, also nicht markiert.',
    },
    {
      codeLine: 4,
      highlight: { asm: [13, 14] },
      state: {
        ...run(['store', 'range', 'check', 'set'], ['exit-old', 'exit-set']),
        facts: facts('s_cache.Last (Gen2, @7F08)', 'order (Gen0, @2040)', '0xFF'),
      },
      changed: ['set', 'card'],
      explanation:
        'Die Barrier setzt das Byte auf 0xFF. Die nächste ephemere Collection wird die Objekte in diesem Bereich durchsuchen und dabei `order` finden.',
    },
    {
      codeLine: 5,
      highlight: { asm: [9, 10, 11, 12] },
      state: {
        ...run(['store', 'range', 'check', 'exit-set'], ['exit-old', 'set']),
        facts: facts('s_cache.Prev (Gen2, @7F10)', 'order (Gen0, @2040)', '0xFF'),
      },
      changed: ['exit-set', 'set', 'target'],
      explanation:
        '`Prev` liegt im selben Bereich, das Byte ist schon markiert. Die Barrier liest nur und schreibt nicht erneut. So bleibt die Cache-Zeile der Card Table unverändert, was bei vielen Threads und Kernen Zeit spart.',
    },
    {
      codeLine: 6,
      highlight: { asm: [7, 8, 16, 17] },
      state: {
        ...run(['store', 'range', 'exit-old'], ['check', 'set', 'exit-set']),
        facts: facts('s_cache.Owner (Gen2, @7F18)', 's_config (Gen2, @6A00)', '0xFF'),
      },
      changed: ['exit-old', 'check', 'set', 'value'],
      explanation:
        'Ein Verweis von alt nach alt ist für ephemere Collections uninteressant. Die Bereichsprüfung schlägt fehl, die Barrier kehrt sofort zurück. Häufige Fehlannahme: Jede Barrier markiere eine Karte. Die meisten Aufrufe enden hier.',
    },
    {
      codeLine: 7,
      state: {
        ...run(['store'], ['range', 'check', 'set', 'exit-old', 'exit-set'], {
          store: 'einfacher Speicherbefehl, ohne Barrier',
        }),
        facts: facts('s_cache.Last (Gen2, @7F08)', 'null', '0xFF'),
      },
      changed: ['range', 'value', 'card'],
      explanation:
        'Für `null` ruft der JIT die Barrier gar nicht erst auf, ein einfacher Speicherbefehl genügt. Die Karte bleibt trotzdem markiert: Die Barrier löscht nie, das erledigt erst der GC, wenn er im Bereich keinen Verweis auf Junges mehr findet.',
    },
  ],
});
