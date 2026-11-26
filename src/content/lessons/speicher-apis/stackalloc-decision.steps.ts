import { defineStepScript, type GraphState } from '@/components/viz';

// Decision "stack, pool or heap" for a temporary buffer, walked through for four scenarios.
// Based on the guidance in Microsoft Learn (stackalloc: limit the size, avoid loops) and the
// ArrayPool<T> documentation. The 1 KB limit is the MaxStackLimit used in the stackalloc docs,
// not a rule of the runtime.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'need', label: 'Temporärer Puffer', detail: 'Länge n, Elementtyp T', row: 1, col: 1 },
  {
    id: 'escape',
    label: 'Lebt er länger als die Methode?',
    detail: 'Rückgabe, Feld, über await',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'often',
    label: 'Groß oder sehr häufig?',
    detail: 'etwa pro Anfrage, ab einigen KB',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'pool',
    label: 'ArrayPool',
    detail: 'Rent, Return in finally',
    row: 1,
    col: 4,
    shape: 'end',
  },
  { id: 'heap', label: 'new T[n]', detail: 'einfach, GC räumt auf', row: 2, col: 4, shape: 'end' },
  {
    id: 'size',
    label: 'Klein und begrenzt?',
    detail: 'feste Obergrenze, T unmanaged',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  { id: 'stack', label: 'stackalloc', detail: 'konstante Größe', row: 3, col: 2, shape: 'end' },
  {
    id: 'hybrid',
    label: 'stackalloc oder Pool',
    detail: 'Auswahl zur Laufzeit nach n',
    row: 3,
    col: 3,
    shape: 'end',
  },
];

const EDGES: Edge[] = [
  { from: 'need', to: 'escape' },
  { from: 'escape', to: 'often', label: 'ja' },
  { from: 'escape', to: 'size', label: 'nein' },
  { from: 'size', to: 'stack', label: 'ja' },
  { from: 'size', to: 'hybrid', label: 'meistens' },
  { from: 'size', to: 'often', label: 'nein' },
  { from: 'often', to: 'pool', label: 'ja' },
  { from: 'often', to: 'heap', label: 'nein' },
];

/** `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], details: Record<string, string> = {}, facts: Fact[] = []): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Stack, Pool oder Heap?',
  code: {
    cs: `// Fall 1: int als Hex-Text, höchstens 8 Zeichen
Span<char> hex = stackalloc char[8];

// Fall 2: Pfad normalisieren, Länge unbekannt, meist kurz
char[]? rented = null;
Span<char> buf = path.Length <= 256
    ? stackalloc char[256]
    : (rented = ArrayPool<char>.Shared.Rent(path.Length));

// Fall 3: pro Anfrage 64 KB aus einem Stream lesen
byte[] chunk = ArrayPool<byte>.Shared.Rent(64 * 1024);

// Fall 4: Hash berechnen und dem Aufrufer zurückgeben
byte[] hash = new byte[32];
return hash;`,
  },
  steps: [
    {
      state: run(['need']),
      changed: ['need'],
      explanation:
        'Drei Fragen entscheiden, wo ein temporärer Puffer hingehört. Die erste ist nicht die nach der Geschwindigkeit, sondern nach der **Lebensdauer**.',
    },
    {
      codeLine: 2,
      state: run(['need', 'escape', 'size', 'stack'], { need: 'n = 8, char' }, [
        { id: 'f-case', label: 'Fall', value: 'Hex-Text eines int' },
        { id: 'f-n', label: 'Länge', value: 'höchstens 8, zur Compilezeit bekannt' },
      ]),
      changed: ['escape', 'size', 'stack', 'f-case', 'f-n'],
      explanation:
        'Der Puffer lebt nur innerhalb der Methode, und ein `int` hat hexadezimal höchstens 8 Stellen. Kleiner und sicherer begrenzt geht es nicht: ein klarer Fall für `stackalloc` mit konstanter Größe.',
    },
    {
      codeLine: 6,
      state: run(['need', 'escape', 'size', 'hybrid'], { need: 'n = path.Length, char' }, [
        { id: 'f-case', label: 'Fall', value: 'Pfad normalisieren' },
        { id: 'f-n', label: 'Länge', value: 'unbekannt, meist unter 256' },
      ]),
      changed: ['size', 'hybrid', 'f-case', 'f-n'],
      explanation:
        'Die Länge kommt von außen, ist aber fast immer klein. Dann entscheidet der Code zur Laufzeit: bis 256 Zeichen ein **fester** Stack-Block, darüber ein Array aus dem Pool. Die Obergrenze schützt vor dem Stack Overflow bei bösartig langen Eingaben.',
    },
    {
      codeLine: 11,
      state: run(['need', 'escape', 'size', 'often', 'pool'], { need: 'n = 65.536, byte' }, [
        { id: 'f-case', label: 'Fall', value: 'Stream lesen, pro Anfrage' },
        { id: 'f-n', label: 'Länge', value: '64 KB' },
      ]),
      changed: ['often', 'pool', 'f-case', 'f-n'],
      explanation:
        '64 KB sind für den Stack zu viel, und pro Anfrage neu alloziert entstünde ständig Garbage. Hier lohnt sich `ArrayPool`: einmal anlegen, immer wieder ausleihen. Wie das genau funktioniert, zeigt die Lektion „ArrayPool und Pooling“.',
    },
    {
      codeLine: 15,
      state: run(['need', 'escape', 'often', 'heap'], { need: 'n = 32, byte' }, [
        { id: 'f-case', label: 'Fall', value: 'Hash zurückgeben' },
        { id: 'f-n', label: 'Länge', value: '32 Byte' },
      ]),
      changed: ['escape', 'often', 'heap', 'f-case', 'f-n'],
      explanation:
        'Der Hash verlässt die Methode, also scheidet der Stack aus. Ein gepooltes Array wäre ebenfalls falsch, weil niemand verlässlich `Return` aufrufen würde. Für 32 Byte, die der Aufrufer behalten will, ist `new` die richtige Wahl.',
    },
  ],
});
