import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps. A reference points at the MethodTable
// pointer, array elements start 16 bytes later on x64 (MethodTable 8 B, Length 4 B, padding 4 B),
// as in span.steps.ts.
// List<T> fields (_items, _size, _version) and growth (double the capacity) follow List.cs in
// dotnet/runtime.
// TODO(verify): Sizes on x64: List<int> 32 B, int[4] 40 B, int[8] 56 B (BenchmarkDotNet or SOS).
// TODO(verify): _version is 4 after the collection initializer (one increment per Add).

const LIST = 0x7f3a2000;
const ARR4 = 0x7f3a2020;
const ARR8 = 0x7f3a2048;
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

type Slot = MemoryState['frames'][number]['slots'][number];
type Obj = MemoryState['heap'][number];

const list = (grown: boolean): Obj => ({
  id: 'list',
  type: 'List<int>',
  address: hex(LIST),
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ List<int>' },
    grown
      ? { name: '_items', value: hex(ARR8), ref: 'arr8' }
      : { name: '_items', value: hex(ARR4), ref: 'arr4' },
    { name: '_size', value: grown ? '5' : '4' },
    { name: '_version', value: grown ? '5' : '4' },
  ],
  sizeBytes: 32,
});

const array = (id: 'arr4' | 'arr8', address: number, values: string[]): Obj => ({
  id,
  type: `int[${values.length}]`,
  address: hex(address),
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ int[]' },
    { name: 'Length', value: String(values.length) },
    ...values.map((v, i) => ({ name: `[${i}]`, value: v })),
  ],
  sizeBytes: 16 + 8 + 4 * values.length,
});

const listSlot: Slot = {
  id: 'listRef',
  name: 'list',
  type: 'List<int> (Verweis, 8 Byte)',
  value: hex(LIST),
  ref: 'list',
};
const spanSlot: Slot = {
  id: 'span',
  name: 'span',
  type: 'Span<int> (16 Byte)',
  value: `_reference = ${hex(ARR4 + 16)} (→ [0] im int[4]), _length = 4`,
  ref: 'arr4',
};

const state = (
  withSpan: boolean,
  small: string[],
  big: string[] | null,
  output?: string,
): MemoryState => ({
  frames: [{ id: 'main', method: 'Main()', slots: withSpan ? [listSlot, spanSlot] : [listSlot] }],
  heap: [
    list(big !== null),
    array('arr4', ARR4, small),
    ...(big ? [array('arr8', ARR8, big)] : []),
  ],
  ...(output !== undefined ? { output } : {}),
});

const START = ['1', '2', '3', '4'];
const AFTER_WRITE = ['10', '2', '3', '4'];
const GROWN = ['10', '2', '3', '4', '5', '0', '0', '0'];
const STALE = ['10', '20', '3', '4'];

export default defineStepScript({
  view: 'memory',
  title: 'CollectionsMarshal.AsSpan und das Wachstum einer Liste',
  code: {
    cs: `var list = new List<int>(4) { 1, 2, 3, 4 };
Span<int> span = CollectionsMarshal.AsSpan(list);
span[0] = 10;
Console.WriteLine(list[0]);
list.Add(5);                  // Kapazität 4 reicht nicht
span[1] = 20;
Console.WriteLine(list[1]);`,
  },
  steps: [
    {
      codeLine: 1,
      state: state(false, START, null),
      changed: ['list', 'arr4'],
      explanation:
        'Eine `List<int>` besteht aus zwei Objekten: der Liste selbst mit `_items`, `_size` und `_version` und dem internen Array. Kapazität 4, Anzahl 4: Das Array ist genau voll.',
    },
    {
      codeLine: 2,
      state: state(true, START, null),
      changed: ['span'],
      explanation:
        '`CollectionsMarshal.AsSpan` liefert einen Span direkt über das interne Array, mit der Länge `_size`. Nichts wird kopiert. Der Span kennt aber nur das Array, nicht die Liste.',
    },
    {
      codeLine: 3,
      state: state(true, AFTER_WRITE, null),
      changed: ['arr4.[0]'],
      explanation:
        'Der Schreibzugriff geht ohne Umweg über `List<T>`-Code direkt ins Array. Kein Aufruf des Indexers der Liste, keine Erhöhung von `_version`.',
    },
    {
      codeLine: 4,
      state: state(true, AFTER_WRITE, null, '10'),
      explanation:
        'Die Liste liest aus demselben Array und sieht die 10. Solange sich die Liste nicht strukturell ändert, sind Span und Liste zwei Wege zu denselben Elementen.',
    },
    {
      codeLine: 5,
      state: state(true, AFTER_WRITE, GROWN, '10'),
      changed: ['arr8', 'list._items', 'list._size', 'list._version'],
      explanation:
        '`Add` findet kein freies Element mehr. Die Liste legt ein doppelt so großes Array an, kopiert die vier Werte, hängt die 5 an und setzt `_items` um. Der Span wird darüber nicht informiert: Er zeigt weiter auf das alte Array.',
    },
    {
      codeLine: 6,
      state: state(true, STALE, GROWN, '10'),
      changed: ['arr4.[1]'],
      explanation:
        'Häufige Fehlannahme: „Der Span ist ein Fenster auf die Liste.“ Er ist ein Fenster auf **ein bestimmtes Array**. Die 20 landet im alten Array, das nur noch der Span erreicht. Der GC hält es am Leben, es gibt also keinen Absturz.',
    },
    {
      codeLine: 7,
      state: state(true, STALE, GROWN, '10\n2'),
      explanation:
        'Die Liste liest aus dem neuen Array und sieht weiter die 2. Die Änderung ist still verloren gegangen. Ein `foreach` hätte hier wegen `_version` eine Exception geworfen, der Span hat keine solche Prüfung.',
    },
  ],
});
