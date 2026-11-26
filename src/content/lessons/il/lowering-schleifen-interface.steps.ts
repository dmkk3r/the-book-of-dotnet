import { defineStepScript, type MemoryState } from '@/components/viz';

// The same List<int> enumerated through IEnumerable<int>. List<T> implements
// IEnumerable<T>.GetEnumerator() explicitly and returns its struct enumerator as an interface,
// which boxes it (for a non-empty list).
// Addresses are fictional but consistent across steps.
// TODO(verify): Lowered code and IL against SharpLab (Release); size of the boxed
// List<int>.Enumerator on x64 (40 B assumed: header, MethodTable, 24 B struct).
// TODO(verify): Since .NET 8 an empty List<T> returns a cached empty enumerator here instead of a box.

const LIST = '0x7F3A0400';
const ARR = '0x7F3A0420';
const BOX = '0x7F3A0448';

type Obj = MemoryState['heap'][number];
type Slot = MemoryState['frames'][number]['slots'][number];

const list: Obj = {
  id: 'list',
  type: 'List<int>',
  address: LIST,
  generation: 0,
  fields: [
    { name: '_items', value: ARR, ref: 'arr' },
    { name: '_size', value: '2' },
    { name: '_version', value: '2' },
  ],
  sizeBytes: 32,
};
const arr: Obj = {
  id: 'arr',
  type: 'int[] (Länge 4)',
  address: ARR,
  generation: 0,
  fields: [
    { name: '[0]', value: '3' },
    { name: '[1]', value: '5' },
    { name: '[2]', value: '0' },
    { name: '[3]', value: '0' },
  ],
  sizeBytes: 40,
};
const box = (index: string, current: string): Obj => ({
  id: 'box',
  type: 'List<int>.Enumerator (geboxt)',
  address: BOX,
  generation: 0,
  fields: [
    { name: 'MethodTable', value: '→ List<int>.Enumerator' },
    { name: '_list', value: LIST, ref: 'list' },
    { name: '_index', value: index },
    { name: '_version', value: '2' },
    { name: '_current', value: current },
  ],
  sizeBytes: 40,
});

interface Opts {
  sum: string;
  /** null: no enumerator yet; otherwise index and current of the box. */
  e: [string, string] | null;
  x: string;
  /** false: Sum has returned. */
  inSum?: boolean;
  output?: string;
}

const state = ({ sum, e, x, inSum = true, output }: Opts): MemoryState => {
  const main: MemoryState['frames'][number] = {
    id: 'main',
    method: 'Main()',
    slots: [
      { id: 'list-var', name: 'list', type: 'List<int> (Verweis)', value: LIST, ref: 'list' },
    ],
  };
  const sumSlots: Slot[] = [
    {
      id: 'items',
      name: 'items',
      type: 'IEnumerable<int> (Verweis)',
      value: LIST,
      ref: 'list',
    },
    { id: 'sum', name: 'sum', type: 'int', value: sum },
    e
      ? { id: 'e', name: 'e', type: 'IEnumerator<int> (Verweis)', value: BOX, ref: 'box' }
      : { id: 'e', name: 'e', type: 'IEnumerator<int> (Verweis)', value: 'null' },
    { id: 'x', name: 'x', type: 'int', value: x },
  ];
  return {
    frames: inSum ? [main, { id: 'sum-frame', method: 'Sum(items)', slots: sumSlots }] : [main],
    heap: [list, arr, ...(e ? [box(e[0], e[1])] : [])],
    ...(output !== undefined ? { output } : {}),
  };
};

export default defineStepScript({
  view: 'memory',
  title: 'foreach über IEnumerable<int>',
  code: {
    cs: `static int Sum(IEnumerable<int> items)
{
    int sum = 0;
    foreach (int x in items)
        sum += x;
    return sum;
}
// Aufruf: Sum(list) mit list = new List<int> { 3, 5 }`,
    lowered: `static int Sum(IEnumerable<int> items)
{
    int sum = 0;
    IEnumerator<int> e = items.GetEnumerator();
    try
    {
        while (e.MoveNext())
        {
            int x = e.Current;
            sum += x;
        }
    }
    finally
    {
        if (e != null)
            e.Dispose();
    }
    return sum;
}`,
    il: `// vereinfacht, Release
ldarg.0
callvirt   instance IEnumerator\`1<!0> IEnumerable\`1<int32>::GetEnumerator()
stloc.1
.try
{
  br.s       CHECK
LOOP:
  ldloc.1
  callvirt   instance !0 IEnumerator\`1<int32>::get_Current()
  stloc.2
  ldloc.0
  ldloc.2
  add
  stloc.0
CHECK:
  ldloc.1
  callvirt   instance bool IEnumerator::MoveNext()
  brtrue.s   LOOP
  leave.s    END
}
finally
{
  ldloc.1
  brfalse.s  SKIP
  ldloc.1
  callvirt   instance void IDisposable::Dispose()
SKIP:
  endfinally
}
END:`,
  },
  steps: [
    {
      codeLine: 3,
      highlight: { lowered: [3] },
      state: state({ sum: '0', e: null, x: '0' }),
      changed: ['items', 'sum'],
      explanation:
        'Dieselbe Liste wie eben, aber `Sum` kennt nur `IEnumerable<int>`. Der Compiler sieht beim Übersetzen von `Sum` nicht, welcher Typ später übergeben wird. Er kann das Struct-Muster von `List<T>` deshalb nicht nutzen.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [4], il: [2, 3, 4] },
      state: state({ sum: '0', e: ['0', '0'], x: '0' }),
      changed: ['e', 'box'],
      explanation:
        '`GetEnumerator` ist jetzt ein Interface-Aufruf. `List<T>` erzeugt dasselbe Struct wie vorher, muss es aber als `IEnumerator<int>` zurückgeben, und eine Interface-Referenz kann nur auf ein Heap-Objekt zeigen. Das Struct wird **geboxt**: eine Allokation pro Schleife.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [7], il: [16, 17, 18, 19] },
      state: state({ sum: '0', e: ['1', '3'], x: '0' }),
      changed: ['box._index', 'box._current'],
      explanation:
        '`MoveNext` läuft über `callvirt` auf dem Interface. Die Runtime muss zur Laufzeit die passende Implementierung finden (Interface-Dispatch), und ohne Hilfe des JIT ist kein Inlining möglich. Geändert werden die Felder in der Box, nicht auf dem Stack.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [9, 10], il: [9, 10, 11, 12, 13, 14, 15] },
      state: state({ sum: '3', e: ['1', '3'], x: '3' }),
      changed: ['x', 'sum'],
      explanation:
        'Auch `Current` ist ein Interface-Aufruf. Pro Element fallen also zwei Interface-Aufrufe an, bei der Struct-Variante waren es zwei direkte, inlinebare Aufrufe.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [7], il: [16, 17, 18, 19] },
      state: state({ sum: '3', e: ['2', '5'], x: '3' }),
      changed: ['box._index', 'box._current'],
      explanation: 'Zweiter Aufruf von `MoveNext` über das Interface: `_current` wird 5.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [9, 10], il: [9, 10, 11, 12, 13, 14, 15] },
      state: state({ sum: '8', e: ['2', '5'], x: '5' }),
      changed: ['x', 'sum'],
      explanation: 'Zweiter Durchlauf des Rumpfs, `sum` ist 8.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [7], il: [17, 18, 19, 20] },
      state: state({ sum: '8', e: ['3', '0'], x: '5' }),
      changed: ['box._index', 'box._current'],
      explanation: '`MoveNext` liefert `false`, die Schleife ist zu Ende.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [13, 14, 15, 16, 17], il: [22, 23, 24, 25, 26, 27, 28, 29] },
      state: state({ sum: '8', e: ['3', '0'], x: '5' }),
      changed: ['e'],
      explanation:
        'Im `finally` steht jetzt eine **Null-Prüfung**: Ein Interface-Verweis könnte `null` sein, ein Struct nicht. Danach folgt `Dispose`, wieder als Interface-Aufruf.',
    },
    {
      codeLine: 6,
      highlight: { lowered: [18] },
      state: state({ sum: '8', e: ['3', '0'], x: '5', inSum: false, output: '8' }),
      changed: ['box'],
      explanation:
        'Nach dem `return` zeigt nichts mehr auf die Box. Sie bleibt als Müll im Gen0-Bereich liegen, bis der nächste GC sie einsammelt. Gleiches Ergebnis, aber mit einer Allokation pro Schleife und zwei Interface-Aufrufen pro Element, solange der JIT nichts davon wegoptimiert.',
    },
  ],
});
