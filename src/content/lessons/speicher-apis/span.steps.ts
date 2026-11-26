import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps. A reference to an array points at its
// MethodTable pointer, the first element follows 16 bytes later on x64 (MethodTable 8 B,
// Length 4 B, padding 4 B), see the array access in Stephen Toub's „All About Span“ ([rcx+4*r9+16]).
// TODO(verify): Total size 48 B for int[6] on x64 (BenchmarkDotNet MemoryDiagnoser or SOS !dumpobj).

const ARR = 0x7f3a1000;
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const elem = (i: number) => hex(ARR + 16 + 4 * i);

type Slot = MemoryState['frames'][number]['slots'][number];
type Obj = MemoryState['heap'][number];

const array = (values: string[]): Obj => ({
  id: 'arr',
  type: 'int[]',
  address: hex(ARR),
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ int[]' },
    { name: 'Length', value: '6' },
    ...values.map((v, i) => ({ name: `[${i}]`, value: v })),
  ],
  sizeBytes: 48,
});

const arrSlot: Slot = {
  id: 'arrRef',
  name: 'arr',
  type: 'int[] (Verweis, 8 Byte)',
  value: hex(ARR),
  ref: 'arr',
};
const spanSlot = (id: string, start: number, length: number): Slot => ({
  id,
  name: id,
  type: 'Span<int> (16 Byte)',
  value: `_reference = ${elem(start)} (→ arr[${start}]), _length = ${length}`,
  ref: 'arr',
});

const VALUES = ['10', '20', '30', '40', '50', '60'];
const CHANGED = ['10', '20', '99', '40', '50', '60'];

const state = (slots: Slot[], values: string[], output?: string): MemoryState => ({
  frames: [{ id: 'main', method: 'Main()', slots }],
  heap: [array(values)],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  title: 'Ein Span über einem Array Schritt für Schritt',
  code: {
    cs: `int[] arr = { 10, 20, 30, 40, 50, 60 };
Span<int> all = arr;              // ganzes Array
Span<int> mid = all.Slice(2, 3);  // arr[2] bis arr[4]
mid[0] = 99;
Console.WriteLine(arr[2]);
mid[3] = 1;                       // Index 3 bei Länge 3`,
  },
  steps: [
    {
      codeLine: 1,
      state: state([arrSlot], VALUES),
      changed: ['arrRef', 'arr'],
      explanation:
        'Ein gewöhnliches Array: ein Objekt auf dem Heap mit Header, MethodTable, Länge und sechs Elementen. Im Frame liegt nur der Verweis `arr`, der auf den Anfang des Objekts zeigt.',
    },
    {
      codeLine: 2,
      state: state([arrSlot, spanSlot('all', 0, 6)], VALUES),
      changed: ['all'],
      explanation:
        'Die implizite Umwandlung erzeugt einen `Span<int>` aus genau zwei Feldern: einem **Verweis auf das erste Element** (nicht auf den Objektanfang) und der Länge 6. Der Span ist ein Wert im Frame, auf dem Heap ist nichts dazugekommen.',
    },
    {
      codeLine: 3,
      state: state([arrSlot, spanSlot('all', 0, 6), spanSlot('mid', 2, 3)], VALUES),
      changed: ['mid'],
      explanation:
        'Häufige Fehlannahme: „Slice kopiert den Ausschnitt.“ `Slice(2, 3)` rechnet nur: Verweis plus 2 mal 4 Byte, Länge 3. Es entsteht ein zweiter 16-Byte-Wert im Frame, der mitten in dasselbe Array zeigt. Kein neues Objekt, keine Kopie.',
    },
    {
      codeLine: 4,
      state: state([arrSlot, spanSlot('all', 0, 6), spanSlot('mid', 2, 3)], CHANGED),
      changed: ['arr.[2]'],
      explanation:
        'Der Indexer prüft `0 < 3`, rechnet `_reference + 0 * 4` und schreibt direkt in den Speicher dahinter. Weil das `arr[2]` ist, ändert sich das Array selbst. Ein Span ist eine **Sicht**, kein Behälter.',
    },
    {
      codeLine: 5,
      state: state([arrSlot, spanSlot('all', 0, 6), spanSlot('mid', 2, 3)], CHANGED, '99'),
      explanation:
        'Über `arr`, `all[2]` und `mid[0]` erreichst du dieselben vier Byte. Alle drei Wege sehen deshalb 99.',
    },
    {
      codeLine: 6,
      state: state(
        [arrSlot, spanSlot('all', 0, 6), spanSlot('mid', 2, 3)],
        CHANGED,
        '99\nIndexOutOfRangeException',
      ),
      changed: ['mid'],
      explanation:
        'Der Span prüft gegen **seine eigene** Länge 3, nicht gegen die des Arrays. `mid[3]` wäre `arr[5]` und läge noch im Array, ist aber außerhalb der Sicht. Deshalb wirft der Zugriff, bevor irgendetwas geschrieben wird.',
    },
  ],
});
