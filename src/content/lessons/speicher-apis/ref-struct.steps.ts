import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent: 0x7F3A… GC heap, 0xA1… stack of the main thread.
// The first array element lies 16 bytes after the array reference on x64 (see span.steps.ts).
// A ref into a stack frame has no heap object to point at, so it is shown as text only.

const ARR = 0x7f3a3000;
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const ELEM1 = hex(ARR + 16 + 4);
const LOCAL = '0xA1F7B0';

type Slot = MemoryState['frames'][number]['slots'][number];
type Frame = MemoryState['frames'][number];

const data = (second: string): MemoryState['heap'][number] => ({
  id: 'data',
  type: 'int[]',
  address: hex(ARR),
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ int[]' },
    { name: 'Length', value: '3' },
    { name: '[0]', value: '3' },
    { name: '[1]', value: second },
    { name: '[2]', value: '9' },
  ],
});

const dataSlot: Slot = {
  id: 'dataRef',
  name: 'data',
  type: 'int[] (Verweis)',
  value: hex(ARR),
  ref: 'data',
};

type Target = 'array' | 'local';
const slotRef = (target: Target): Slot =>
  target === 'array'
    ? {
        id: 'slot',
        name: 'slot',
        type: 'ref int (8 Byte)',
        value: `${ELEM1} (→ data[1])`,
        ref: 'data',
      }
    : { id: 'slot', name: 'slot', type: 'ref int (8 Byte)', value: `${LOCAL} (→ local)` };

const main = (slots: Slot[]): Frame => ({ id: 'main', method: 'Main()', slots });

const find: Frame = {
  id: 'find',
  method: 'Find(int[] items, int value)',
  slots: [
    { id: 'items', name: 'items', type: 'int[] (Verweis)', value: hex(ARR), ref: 'data' },
    { id: 'value', name: 'value', type: 'int', value: '7' },
    { id: 'i', name: 'i', type: 'int', value: '1' },
    {
      id: 'ret',
      name: '(Rückgabe)',
      type: 'ref int',
      value: `${ELEM1} (→ items[1])`,
      ref: 'data',
    },
  ],
};

const localSlot = (v: string): Slot => ({
  id: 'local',
  name: 'local',
  type: `int (Adresse ${LOCAL})`,
  value: v,
});

const st = (frames: Frame[], second: string, output?: string): MemoryState => ({
  frames,
  heap: [data(second)],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  title: 'ref-Locals und ref-Rückgaben Schritt für Schritt',
  code: {
    cs: `static ref int Find(int[] items, int value)
{
    for (int i = 0; i < items.Length; i++)
        if (items[i] == value) return ref items[i];
    throw new InvalidOperationException();
}

int[] data = { 3, 7, 9 };
ref int slot = ref Find(data, 7);
slot = 70;
int local = 5;
slot = ref local;        // ref-Neuzuweisung
slot++;
Console.WriteLine($"{data[1]} {local}");`,
  },
  steps: [
    {
      codeLine: 8,
      state: st([main([dataSlot])], '7'),
      changed: ['dataRef', 'data'],
      explanation:
        'Ein Array mit drei Zahlen auf dem Heap, im Frame von `Main` nur der Verweis darauf. Gesucht ist nicht der **Wert** 7, sondern die **Speicherstelle**, an der er steht.',
    },
    {
      codeLine: 4,
      state: st([main([dataSlot]), find], '7'),
      changed: ['find', 'ret'],
      explanation:
        '`return ref items[i]` gibt keine Kopie zurück, sondern einen verwalteten Verweis auf das Element. Das ist erlaubt, weil das Array auf dem Heap liegt und den Frame von `Find` überlebt.',
    },
    {
      codeLine: 9,
      state: st([main([dataSlot, slotRef('array')])], '7'),
      changed: ['slot'],
      explanation:
        'Häufige Fehlannahme: „`slot` enthält jetzt eine 7.“ In `slot` steht eine **Adresse**, ein Verweis mitten in das Array. Jede Verwendung von `slot` liest oder schreibt `data[1]`.',
    },
    {
      codeLine: 10,
      state: st([main([dataSlot, slotRef('array')])], '70'),
      changed: ['data.[1]'],
      explanation:
        '`slot = 70` schreibt durch den Verweis. Geändert hat sich das Array, nicht der Frame. So lässt sich ein Element finden und in einem zweiten Schritt ändern, ohne den Index zu kennen.',
    },
    {
      codeLine: 11,
      state: st([main([dataSlot, slotRef('array'), localSlot('5')])], '70'),
      changed: ['local'],
      explanation:
        'Eine gewöhnliche lokale Variable im Frame von `Main`. Sie hat eine Adresse auf dem Stack, auch wenn du sie im Quelltext nie siehst.',
    },
    {
      codeLine: 12,
      state: st([main([dataSlot, slotRef('local'), localSlot('5')])], '70'),
      changed: ['slot'],
      explanation:
        '`= ref` setzt den **Verweis selbst** neu, nicht den Wert dahinter. `slot` zeigt jetzt auf `local` im eigenen Frame. Das Array ist davon unberührt.',
    },
    {
      codeLine: 13,
      state: st([main([dataSlot, slotRef('local'), localSlot('6')])], '70'),
      changed: ['local'],
      explanation:
        '`slot++` wirkt jetzt auf `local`. Ein ref-Local ist ein zweiter Name für eine fremde Speicherstelle, und welche das ist, entscheidet die letzte `= ref`-Zuweisung.',
    },
    {
      codeLine: 14,
      state: st([main([dataSlot, slotRef('local'), localSlot('6')])], '70', '70 6'),
      explanation:
        'Ein Verweis auf `local` wäre gefährlich, wenn er `Main` verlassen könnte, etwa per `return ref`. Genau das verbietet der Compiler. Ein Verweis in das Array dürfte die Methode dagegen verlassen.',
    },
  ],
});
