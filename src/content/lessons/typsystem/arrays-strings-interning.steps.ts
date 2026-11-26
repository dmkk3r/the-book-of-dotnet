import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.
// TODO(verify): Where string literals live in .NET 8+ (frozen / non-GC heap) and that the
// generation shown here is therefore only illustrative.

type Obj = MemoryState['heap'][number];
const lit: Obj = {
  id: 'lit',
  type: 'string (Literal, interniert)',
  address: '0x7FFC0100',
  fields: [{ name: 'Inhalt', value: '"hallo"' }],
};
const built: Obj = {
  id: 'built',
  type: 'string (zur Laufzeit erzeugt)',
  address: '0x7F3A0C00',
  generation: 0,
  fields: [{ name: 'Inhalt', value: '"hallo"' }],
};
type Slot = MemoryState['frames'][number]['slots'][number];
const slot = (id: string, target: 'lit' | 'built' | null, type = 'string'): Slot => ({
  id,
  name: id,
  type: `${type} (Verweis)`,
  value: target === null ? 'null' : target === 'lit' ? '0x7FFC0100' : '0x7F3A0C00',
  ...(target ? { ref: target } : {}),
});
const state = (n: number, output?: string): MemoryState => ({
  frames: [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        slot('a', 'lit'),
        slot('b', n >= 2 ? 'lit' : null),
        slot('c', n >= 3 ? 'built' : null),
        slot('oa', n >= 4 ? 'lit' : null, 'object'),
        slot('oc', n >= 4 ? 'built' : null, 'object'),
      ],
    },
  ],
  heap: [lit, ...(n >= 3 ? [built] : [])],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  title: 'String-Literale und Interning Schritt für Schritt',
  code: {
    cs: `string a = "hallo";
string b = "hallo";
string c = new string("hallo".AsSpan());
object oa = a, oc = c;
Console.WriteLine(a == c);
Console.WriteLine(oa == oc);`,
  },
  steps: [
    {
      codeLine: 1,
      state: state(1),
      changed: ['a', 'lit'],
      explanation:
        'Für ein String-Literal legt die Runtime genau ein Objekt an und merkt es sich in einer prozessweiten Tabelle. Das nennt man **Interning**.',
    },
    {
      codeLine: 2,
      state: state(2),
      changed: ['b'],
      explanation:
        'Dasselbe Literal an anderer Stelle liefert **dasselbe Objekt**. `a` und `b` enthalten dieselbe Adresse.',
    },
    {
      codeLine: 3,
      state: state(3),
      changed: ['c', 'built'],
      explanation:
        'Ein zur Laufzeit erzeugter String ist ein neues Objekt, auch wenn er dieselben Zeichen enthält. Er wird nicht automatisch interniert.',
    },
    {
      codeLine: 5,
      state: state(4, 'True'),
      changed: ['a', 'c'],
      explanation:
        '`==` zwischen zwei `string`-Variablen ruft den überladenen Operator von `string` auf, und der vergleicht die **Zeichen**: `True`.',
    },
    {
      codeLine: 6,
      state: state(4, 'True\nFalse'),
      changed: ['oa', 'oc'],
      explanation:
        'Häufige Falle: Sind die Variablen vom Typ `object`, wählt der Compiler den Operator von `object`, und der vergleicht **Verweise**. Zwei verschiedene Objekte, also `False`. Strings deshalb mit `string.Equals` oder als `string` typisiert vergleichen.',
    },
  ],
});
