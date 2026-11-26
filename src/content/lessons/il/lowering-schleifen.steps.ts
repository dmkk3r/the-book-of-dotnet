import { defineStepScript, type MemoryState } from '@/components/viz';

// foreach over a List<int> with the struct enumerator List<T>.Enumerator.
// Field names follow dotnet/runtime src/libraries/System.Private.CoreLib/src/System/Collections/Generic/List.cs
// (_items, _size, _version; Enumerator: _list, _index, _version, _current).
// Addresses are fictional but consistent across steps.
// TODO(verify): Lowered code and IL against SharpLab (Release). Object sizes on x64:
// List<int> 32 B, int[4] 40 B.

const LIST = '0x7F3A0400';
const ARR = '0x7F3A0420';

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

interface Enum {
  index: string;
  current: string;
}

const state = (sum: string, e: Enum | null, x: string, output?: string): MemoryState => {
  const slots: Slot[] = [
    { id: 'list-var', name: 'list', type: 'List<int> (Verweis)', value: LIST, ref: 'list' },
    { id: 'sum', name: 'sum', type: 'int', value: sum },
  ];
  if (e) {
    slots.push(
      { id: 'e._list', name: 'e._list', type: 'List<int> (Verweis)', value: LIST, ref: 'list' },
      { id: 'e._index', name: 'e._index', type: 'int', value: e.index },
      { id: 'e._version', name: 'e._version', type: 'int', value: '2' },
      { id: 'e._current', name: 'e._current', type: 'int', value: e.current },
    );
  }
  slots.push({ id: 'x', name: 'x', type: 'int', value: x });
  return {
    frames: [{ id: 'main', method: 'Main()', slots }],
    heap: [list, arr],
    ...(output !== undefined ? { output } : {}),
  };
};

export default defineStepScript({
  view: 'memory',
  title: 'foreach über eine List<int>',
  code: {
    cs: `var list = new List<int> { 3, 5 };
int sum = 0;
foreach (int x in list)
    sum += x;
Console.WriteLine(sum);`,
    lowered: `List<int> list = new List<int>();
list.Add(3);
list.Add(5);
int sum = 0;
List<int>.Enumerator e = list.GetEnumerator();
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
    ((IDisposable)e).Dispose(); // constrained call, keine Box
}
Console.WriteLine(sum);`,
    il: `// vereinfacht, Release
ldloc.0
callvirt   instance valuetype List\`1/Enumerator<!0> List\`1<int32>::GetEnumerator()
stloc.2
.try
{
  br.s       CHECK
LOOP:
  ldloca.s   2
  call       instance !0 valuetype List\`1/Enumerator<int32>::get_Current()
  stloc.3
  ldloc.1
  ldloc.3
  add
  stloc.1
CHECK:
  ldloca.s   2
  call       instance bool valuetype List\`1/Enumerator<int32>::MoveNext()
  brtrue.s   LOOP
  leave.s    END
}
finally
{
  ldloca.s   2
  constrained. valuetype List\`1/Enumerator<int32>
  callvirt   instance void IDisposable::Dispose()
  endfinally
}
END:`,
  },
  steps: [
    {
      codeLine: 1,
      highlight: { lowered: [1, 2, 3, 4] },
      state: state('0', null, '0'),
      changed: ['list', 'arr', 'list-var', 'sum'],
      explanation:
        'Die Liste ist ein Objekt auf dem Heap, ihre Elemente liegen in einem eigenen `int[]`. Jedes `Add` hat `_version` erhöht, deshalb steht dort 2. Der Collection Initializer ist selbst schon Lowering: Er wird zu zwei `Add`-Aufrufen.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [5], il: [2, 3, 4] },
      state: state('0', { index: '0', current: '0' }, '0'),
      changed: ['e._list', 'e._index', 'e._version', 'e._current'],
      explanation:
        '`List<T>.GetEnumerator()` liefert kein Interface, sondern das Struct `List<int>.Enumerator`. Es landet als lokale Variable im Stack-Frame: vier Felder, darunter eine Kopie von `_version`. Häufige Fehlannahme: „foreach über eine Liste alloziert einen Enumerator.“ Der Heap enthält weiterhin nur Liste und Array.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [8], il: [16, 17, 18, 19] },
      state: state('0', { index: '1', current: '3' }, '0'),
      changed: ['e._index', 'e._current'],
      explanation:
        '`MoveNext` ist ein direkter Aufruf (`call`, nicht `callvirt`) auf dem Struct im Frame. Es vergleicht `e._version` mit `list._version`, liest `_items[0]` nach `_current` und erhöht `_index`. Der JIT kann diesen Aufruf inlinen.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [10, 11], il: [9, 10, 11, 12, 13, 14, 15] },
      state: state('3', { index: '1', current: '3' }, '3'),
      changed: ['x', 'sum'],
      explanation:
        '`e.Current` kopiert `_current` in die Schleifenvariable `x`. Seit C# 5 ist `x` innerhalb der Schleife deklariert, jede Iteration hat also ihre eigene Variable. Das spielt erst bei Closures eine Rolle.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [8], il: [16, 17, 18, 19] },
      state: state('3', { index: '2', current: '5' }, '3'),
      changed: ['e._index', 'e._current'],
      explanation:
        'Zweiter Aufruf von `MoveNext`: Version stimmt noch, `_index` ist kleiner als `_size`. `_current` wird 5, `_index` wird 2.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [10, 11], il: [9, 10, 11, 12, 13, 14, 15] },
      state: state('8', { index: '2', current: '5' }, '5'),
      changed: ['x', 'sum'],
      explanation: 'Der Schleifenrumpf läuft ein zweites Mal, `sum` ist jetzt 8.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [8], il: [17, 18, 19, 20] },
      state: state('8', { index: '3', current: '0' }, '5'),
      changed: ['e._index', 'e._current'],
      explanation:
        '`_index` erreicht `_size`, also geht `MoveNext` in seinen seltenen Pfad: Es prüft die Version noch einmal, setzt `_index` hinter das Ende, löscht `_current` und liefert `false`. Die `while`-Schleife endet.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [14, 15, 16, 17], il: [22, 23, 24, 25, 26, 27] },
      state: state('8', { index: '3', current: '0' }, '5'),
      explanation:
        'Der `finally`-Block ruft `Dispose` auf. Obwohl der Code wie ein Cast auf `IDisposable` aussieht, boxt der Compiler nicht: `constrained.` vor `callvirt` sagt der Runtime, dass die Methode direkt auf dem Struct an dieser Adresse aufgerufen werden soll. `Dispose` ist hier leer.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [18] },
      state: state('8', { index: '3', current: '0' }, '5', '8'),
      explanation:
        'Bilanz: keine einzige Allokation für die Schleife, nur direkte Aufrufe auf einem Struct im Stack-Frame. Genau deshalb ist `foreach` über eine `List<T>` kaum teurer als eine `for`-Schleife mit Index.',
    },
  ],
});
