import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. Static fields are drawn next to the MethodTable they
// belong to; where the runtime actually stores them is an implementation detail.
// TODO(verify): Storage of statics for generic instantiations (per instantiation, reachable from
// the MethodTable) in the current runtime.

type Obj = MemoryState['heap'][number];
const mt = (id: string, type: string, addr: string, count: string): Obj => ({
  id,
  type: `MethodTable ${type}`,
  address: addr,
  fields: [
    { name: 'Code Increment', value: '→ geteilter Code', ref: 'code' },
    { name: 'static Count', value: count },
  ],
});
const code: Obj = {
  id: 'code',
  type: 'Maschinencode Counter<__Canon>.Increment',
  address: '0x7FFB0300',
  fields: [{ name: 'Count', value: 'über das Wörterbuch des Typs' }],
};
const state = (strCount: string, objCount: string | null, output?: string): MemoryState => ({
  frames: [{ id: 'main', method: 'Main()', slots: [] }],
  heap: [
    mt('mt-str', 'Counter<string>', '0x7FFA3000', strCount),
    ...(objCount === null ? [] : [mt('mt-obj', 'Counter<object>', '0x7FFA3100', objCount)]),
    code,
  ],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Statische Felder generischer Typen Schritt für Schritt',
  code: {
    cs: `class Counter<T>
{
    public static int Count;
    public static void Increment() => Count++;
}

Counter<string>.Increment();
Counter<string>.Increment();
Counter<object>.Increment();
Console.WriteLine($"{Counter<string>.Count} {Counter<object>.Count}");`,
  },
  steps: [
    {
      codeLine: 7,
      state: state('1', null),
      changed: ['mt-str', 'mt-str.static Count'],
      explanation:
        '`Counter<string>` wird geladen und bekommt eine eigene MethodTable mit **eigenem** statischem Feld `Count`. Der erste Aufruf erhöht es auf 1.',
    },
    {
      codeLine: 8,
      state: state('2', null),
      changed: ['mt-str.static Count'],
      explanation: 'Der zweite Aufruf über `Counter<string>` erhöht dasselbe Feld auf 2.',
    },
    {
      codeLine: 9,
      state: state('2', '1'),
      changed: ['mt-obj', 'mt-obj.static Count'],
      explanation:
        '`Counter<object>` ist ein **anderer Typ**. Er teilt sich mit `Counter<string>` den Maschinencode von `Increment`, hat aber sein eigenes `Count`. Der geteilte Code findet das richtige Feld über das Wörterbuch des jeweiligen Typs.',
    },
    {
      codeLine: 10,
      state: state('2', '1', '2 1'),
      explanation:
        'Ausgabe „2 1“. Häufige Fehlannahme: Ein statisches Feld in einer generischen Klasse gebe es einmal für alle Typargumente. Es gibt eines pro geschlossenem Typ, also pro Instanziierung.',
    },
  ],
});
