import { defineStepScript, type MemoryState } from '@/components/viz';

// Why a field array keeps its bounds checks when the loop body contains a call: the condition and
// the access read the field separately, and the call in between may replace the array.
// Addresses are fictitious but consistent. Element values are illustrative.
// TODO(verify): That without any call or store in the loop body the JIT may load the field once
// (loop hoisting / CSE of the field load, allowed by the .NET memory model for non-volatile fields)
// and then remove the check; with a non-inlined call in the body it must reload and keep the check.

type Frame = MemoryState['frames'][number];
type Obj = MemoryState['heap'][number];

const ADDR_BUF = '0x0000_7F10_4000';
const ADDR_A = '0x0000_7F10_4018';
const ADDR_B = '0x0000_7F10_4040';

const buffer = (target: 'a' | 'b'): Obj => ({
  id: 'buf',
  type: 'Buffer',
  address: ADDR_BUF,
  generation: 0,
  fields: [{ name: '_data', value: target === 'a' ? ADDR_A : ADDR_B, ref: `arr-${target}` }],
});
const arrA: Obj = {
  id: 'arr-a',
  type: 'int[]',
  address: ADDR_A,
  generation: 0,
  fields: [
    { name: 'Length', value: '4' },
    { name: '[0]', value: '1' },
    { name: '[1]', value: '2' },
    { name: '[2]', value: '3' },
    { name: '[3]', value: '4' },
  ],
};
const arrB: Obj = {
  id: 'arr-b',
  type: 'int[]',
  address: ADDR_B,
  generation: 0,
  fields: [
    { name: 'Length', value: '2' },
    { name: '[0]', value: '0' },
    { name: '[1]', value: '0' },
  ],
};

const frame = (i: string, sum: string, local?: 'a'): Frame => ({
  id: 'fr-sum',
  method: local ? 'SumLocal()' : 'Sum()',
  slots: [
    { id: 's-this', name: 'this', type: 'Buffer', value: ADDR_BUF, ref: 'buf' },
    ...(local ? [{ id: 's-data', name: 'data', type: 'int[]', value: ADDR_A, ref: 'arr-a' }] : []),
    { id: 's-i', name: 'i', type: 'int', value: i },
    { id: 's-sum', name: 'sum', type: 'int', value: sum },
  ],
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Ein Feld-Array in der Schleife',
  code: {
    cs: `class Buffer
{
    private int[] _data = [1, 2, 3, 4];

    public int Sum()
    {
        int sum = 0;
        for (int i = 0; i < _data.Length; i++)
        {
            Log(i);                    // nicht eingebettet, könnte _data ersetzen
            sum += _data[i];
        }
        return sum;
    }

    public int SumLocal()
    {
        int[] data = _data;            // einmal lesen
        int sum = 0;
        for (int i = 0; i < data.Length; i++) { Log(i); sum += data[i]; }
        return sum;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Log(int i) { if (i == 2) _data = new int[2]; }
}`,
  },
  steps: [
    {
      codeLine: 8,
      state: { frames: [frame('2', '3')], heap: [buffer('a'), arrA] },
      changed: ['s-i', 'buf._data', 'arr-a.Length'],
      explanation:
        'Dritter Durchlauf von `Sum`, `i` ist `2`. Die Bedingung liest das Feld `_data`, findet das Array mit Länge 4 und lässt den Rumpf laufen. Bewiesen ist damit nur: `i` ist kleiner als die Länge **dieses** Arrays.',
    },
    {
      codeLine: 10,
      state: { frames: [frame('2', '3')], heap: [buffer('b'), arrA, arrB] },
      changed: ['buf._data', 'arr-b'],
      explanation:
        '`Log(2)` ersetzt `_data` durch ein neues Array mit Länge 2. Für den JIT ist `Log` eine Blackbox, er muss also immer damit rechnen, dass ein Aufruf Felder verändert.',
    },
    {
      codeLine: 11,
      state: {
        frames: [frame('2', '3')],
        heap: [buffer('b'), arrA, arrB],
        output: 'IndexOutOfRangeException',
      },
      changed: ['arr-b.Length'],
      explanation:
        '`_data[i]` liest das Feld neu und landet beim kurzen Array. `2` ist nicht kleiner als `2`, der Bounds-Check schlägt zu. Er ist hier also keine Formalität, sondern das Einzige, was einen Lesezugriff hinter das Array verhindert.',
    },
    {
      codeLine: 18,
      state: { frames: [frame('0', '0', 'a')], heap: [buffer('a'), arrA] },
      changed: ['s-data'],
      explanation:
        '`SumLocal` liest das Feld einmal in die lokale Variable `data`. Eine lokale Variable kann kein anderer Code verändern, und die Länge eines Arrays ist fest. Bedingung und Zugriff beziehen sich jetzt beweisbar auf dasselbe Array.',
    },
    {
      codeLine: 20,
      state: { frames: [frame('4', '10', 'a')], heap: [buffer('b'), arrA, arrB] },
      changed: ['s-i', 's-sum', 'buf._data'],
      explanation:
        'Auch hier ersetzt `Log(2)` das Feld, aber die Schleife arbeitet weiter auf dem alten Array und summiert alle vier Elemente. Der JIT kann den Bounds-Check entfernen. Beachte: Das ist ein anderes Verhalten als bei `Sum`, du entscheidest dich also bewusst dafür.',
    },
  ],
});
