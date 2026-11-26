import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent. MethodTables and code live outside the GC heap.
// TODO(verify): Sharing rules (value types specialized, reference types share __Canon code with
// a generic dictionary) against BOTR shared-generics.md.

type Obj = MemoryState['heap'][number];
const list = (id: string, type: string, addr: string): Obj => ({
  id,
  type,
  address: addr,
  generation: 0,
  fields: [{ name: 'MethodTable', value: `→ ${type}`, ref: `mt-${id}` }],
});
const mt = (id: string, type: string, addr: string, code: string, dict?: string): Obj => ({
  id: `mt-${id}`,
  type: `MethodTable ${type}`,
  address: addr,
  fields: [
    { name: 'Add', value: code === 'code-int' ? '→ Code für int' : '→ geteilter Code', ref: code },
    ...(dict ? [{ name: 'Wörterbuch', value: dict }] : []),
  ],
});
const codeInt: Obj = {
  id: 'code-int',
  type: 'Maschinencode List<int>.Add',
  address: '0x7FFB0100',
  fields: [{ name: 'T', value: 'fest: int' }],
};
const codeCanon: Obj = {
  id: 'code-canon',
  type: 'Maschinencode List<__Canon>.Add',
  address: '0x7FFB0200',
  fields: [{ name: 'T', value: 'aus dem Wörterbuch' }],
};

type Slot = MemoryState['frames'][number]['slots'][number];
const slot = (id: string, type: string, addr: string | null, target: string): Slot => ({
  id,
  name: id,
  type: `${type} (Verweis)`,
  value: addr ?? 'null',
  ...(addr ? { ref: target } : {}),
});
const frame = (n: number): MemoryState['frames'] => [
  {
    id: 'main',
    method: 'Main()',
    slots: [
      slot('li', 'List<int>', n >= 1 ? '0x7F3A0700' : null, 'li-obj'),
      slot('ls', 'List<string>', n >= 2 ? '0x7F3A0740' : null, 'ls-obj'),
      slot('lo', 'List<object>', n >= 3 ? '0x7F3A0780' : null, 'lo-obj'),
    ],
  },
];

const heap = (n: number, dict = false): Obj[] => [
  list('li-obj', 'List<int>', '0x7F3A0700'),
  { ...mt('li-obj', 'List<int>', '0x7FFA2000', 'code-int'), id: 'mt-li-obj' },
  codeInt,
  ...(n >= 2
    ? [
        list('ls-obj', 'List<string>', '0x7F3A0740'),
        mt('ls-obj', 'List<string>', '0x7FFA2100', 'code-canon', dict ? 'T = string' : undefined),
        codeCanon,
      ]
    : []),
  ...(n >= 3
    ? [
        list('lo-obj', 'List<object>', '0x7F3A0780'),
        mt('lo-obj', 'List<object>', '0x7FFA2200', 'code-canon', dict ? 'T = object' : undefined),
      ]
    : []),
];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Generics zur Laufzeit Schritt für Schritt',
  code: {
    cs: `var li = new List<int>();
var ls = new List<string>();
var lo = new List<object>();

li.Add(1);
ls.Add("a");
lo.Add(new object());`,
  },
  steps: [
    {
      codeLine: 1,
      state: { frames: frame(1), heap: heap(1) },
      changed: ['li-obj', 'mt-li-obj', 'code-int'],
      explanation:
        '`List<int>` bekommt eine eigene MethodTable und **eigenen Maschinencode**. Der JIT kennt `T = int` genau und kann mit echten `int`-Werten arbeiten, ganz ohne Boxing.',
    },
    {
      codeLine: 2,
      state: { frames: frame(2), heap: heap(2) },
      changed: ['ls-obj', 'mt-ls-obj', 'code-canon'],
      explanation:
        '`List<string>` bekommt ebenfalls eine eigene MethodTable. Der Code aber wird für den Platzhalter `__Canon` erzeugt, der für **jeden Referenztyp** steht. Alle Referenztypen sind Verweise gleicher Größe, deshalb funktioniert derselbe Maschinencode für alle.',
    },
    {
      codeLine: 3,
      state: { frames: frame(3), heap: heap(3) },
      changed: ['lo-obj', 'mt-lo-obj', 'mt-lo-obj.Add'],
      explanation:
        '`List<object>` hat wieder eine eigene MethodTable, nutzt aber **denselben** Code wie `List<string>`. So entsteht nicht für jede Klasse eine Kopie des Codes.',
    },
    {
      codeLine: 6,
      state: { frames: frame(3), heap: heap(3, true) },
      changed: ['mt-ls-obj.Wörterbuch', 'mt-lo-obj.Wörterbuch'],
      explanation:
        'Manchmal muss geteilter Code das konkrete `T` doch kennen, etwa für `typeof(T)` oder `new T[]`. Dann liest er es zur Laufzeit aus einem **Wörterbuch**, das an der jeweiligen MethodTable hängt. Das kostet einen zusätzlichen Zugriff.',
    },
    {
      codeLine: 7,
      state: { frames: frame(3), heap: heap(3, true) },
      explanation:
        'Häufige Fehlannahme: Generics würden wie C++-Templates für jedes `T` neu kompiliert. Für Werttypen stimmt das, für Referenztypen teilen sich alle Instanziierungen einen Code.',
    },
  ],
});
