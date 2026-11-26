import { defineStepScript, fieldId, type MemoryState } from '@/components/viz';

// Modifying a List<T> during foreach. The version check lives in List<T>.Enumerator.MoveNext
// (dotnet/runtime, List.cs): fast path `_version == localList._version && index < size`,
// otherwise MoveNextRare throws.
// Addresses are fictional but consistent across steps.
// TODO(verify): Exact exception message text in current .NET.

const LIST = '0x7F3A0400';
const ARR = '0x7F3A0420';

type Obj = MemoryState['heap'][number];

const state = (o: {
  size: string;
  version: string;
  third: string;
  e: [string, string] | null;
  x: string;
  output?: string;
}): MemoryState => {
  const list: Obj = {
    id: 'list',
    type: 'List<int>',
    address: LIST,
    generation: 0,
    fields: [
      { name: '_items', value: ARR, ref: 'arr' },
      { name: '_size', value: o.size },
      { name: '_version', value: o.version },
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
      { name: '[2]', value: o.third },
      { name: '[3]', value: '0' },
    ],
    sizeBytes: 40,
  };
  const slots: MemoryState['frames'][number]['slots'] = [
    { id: 'list-var', name: 'list', type: 'List<int> (Verweis)', value: LIST, ref: 'list' },
  ];
  if (o.e) {
    slots.push(
      { id: 'e._list', name: 'e._list', type: 'List<int> (Verweis)', value: LIST, ref: 'list' },
      { id: 'e._index', name: 'e._index', type: 'int', value: o.e[0] },
      { id: 'e._version', name: 'e._version', type: 'int', value: '2' },
      { id: 'e._current', name: 'e._current', type: 'int', value: o.e[1] },
    );
  }
  slots.push({ id: 'x', name: 'x', type: 'int', value: o.x });
  return {
    frames: [{ id: 'main', method: 'Main()', slots }],
    heap: [list, arr],
    ...(o.output !== undefined ? { output: o.output } : {}),
  };
};

export default defineStepScript({
  view: 'memory',
  title: 'Die Liste ändert sich während foreach',
  code: {
    cs: `var list = new List<int> { 3, 5 };
foreach (int x in list)
{
    if (x == 3)
        list.Add(7);
}`,
    lowered: `List<int>.Enumerator e = list.GetEnumerator();
try
{
    while (e.MoveNext())
    {
        int x = e.Current;
        if (x == 3)
            list.Add(7);
    }
}
finally
{
    ((IDisposable)e).Dispose();
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: state({ size: '2', version: '2', third: '0', e: null, x: '0' }),
      changed: ['list', 'arr'],
      explanation:
        'Ausgangslage: zwei Elemente, Kapazität 4, `_version` ist 2. Die Versionsnummer ist ein gewöhnliches `int`-Feld der Liste, das jede verändernde Methode erhöht.',
    },
    {
      codeLine: 2,
      highlight: { lowered: [1] },
      state: state({ size: '2', version: '2', third: '0', e: ['0', '0'], x: '0' }),
      changed: ['e._list', 'e._index', 'e._version', 'e._current'],
      explanation:
        'Der Enumerator merkt sich beim Erzeugen den Stand: `e._version` ist eine **Kopie** von `list._version`. Mehr Schutz gibt es nicht, keine Sperre und keinen Snapshot der Daten.',
    },
    {
      codeLine: 2,
      highlight: { lowered: [4, 6] },
      state: state({ size: '2', version: '2', third: '0', e: ['1', '3'], x: '3' }),
      changed: ['e._index', 'e._current', 'x'],
      explanation: 'Erste Runde: Die Versionen stimmen überein, `x` wird 3.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [7, 8] },
      state: state({ size: '3', version: '3', third: '7', e: ['1', '3'], x: '3' }),
      changed: [fieldId('list', '_size'), fieldId('list', '_version'), fieldId('arr', '[2]')],
      explanation:
        '`Add` schreibt die 7 in das freie Feld des Arrays, erhöht `_size` und `_version`. Die Kapazität reicht, das Array bleibt dasselbe. Technisch wäre ein Weiterlaufen also möglich.',
    },
    {
      codeLine: 2,
      highlight: { lowered: [4] },
      state: state({
        size: '3',
        version: '3',
        third: '7',
        e: ['1', '3'],
        x: '3',
        output:
          'InvalidOperationException: Collection was modified; enumeration operation may not execute.',
      }),
      changed: ['e._version', fieldId('list', '_version')],
      explanation:
        'Der nächste `MoveNext` vergleicht 2 mit 3 und wirft eine `InvalidOperationException`. Die Prüfung schützt nicht vor einem Absturz, sondern vor stillen Fehlern: Ob ein neues Element noch mitgezählt würde, wäre sonst Zufall.',
    },
    {
      codeLine: 2,
      highlight: { lowered: [11, 12, 13, 14] },
      state: state({
        size: '3',
        version: '3',
        third: '7',
        e: ['1', '3'],
        x: '3',
        output:
          'InvalidOperationException: Collection was modified; enumeration operation may not execute.',
      }),
      explanation:
        'Bevor die Exception die Methode verlässt, läuft der `finally`-Block und ruft `Dispose`. Die Prüfung steckt im Enumerator, nicht im Compiler: Eine `for`-Schleife mit Index oder `foreach` über ein Array prüft nichts dergleichen.',
    },
  ],
});
