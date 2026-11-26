import { defineStepScript, type MemoryState } from '@/components/viz';

// What type loading creates, after BOTR type-loader.md: MethodTable plus EEClass per type,
// generic instantiations built on demand and cached per loader module, all reference type
// instantiations share one EEClass via the canonical List<__Canon>, value type instantiations get
// their own. Addresses are fictional but consistent; loader heap structures carry no generation.
// TODO(verify): That List<Order> and List<int> are loaded when Main is JIT compiled and not at
// first execution of the newobj (they could also be loaded lazily through fixups with ReadyToRun).
// TODO(verify): That a non-canonical MethodTable reaches the shared EEClass through its canonical
// MethodTable (union m_pEEClass / m_pCanonMT in methodtable.h); the view simplifies this to one arrow.
// TODO(verify): Field names of List<T> (_items, _size) for .NET 8.

type Obj = MemoryState['heap'][number];

const mtEntity: Obj = {
  id: 'mt-entity',
  type: 'MethodTable Entity (Loader Heap)',
  address: '0x7FFA1000',
  fields: [
    { name: 'Basistyp', value: 'Object' },
    { name: 'Felder', value: 'Id: int' },
  ],
};
const mtOrder: Obj = {
  id: 'mt-order',
  type: 'MethodTable Order (Loader Heap)',
  address: '0x7FFA1100',
  fields: [
    { name: 'Basistyp', value: '→ Entity', ref: 'mt-entity' },
    { name: 'Interfaces', value: 'IComparable<Order>' },
    { name: 'EEClass', value: '→ Order', ref: 'ee-order' },
  ],
};
const eeOrder: Obj = {
  id: 'ee-order',
  type: 'EEClass Order (Loader Heap)',
  address: '0x7FFA3000',
  fields: [
    { name: 'Metadaten', value: 'Shop.dll, TypeDef 0x02000003' },
    { name: 'Methoden', value: '.ctor, CompareTo' },
  ],
};
const mtListOrder: Obj = {
  id: 'mt-list-order',
  type: 'MethodTable List<Order> (Loader Heap)',
  address: '0x7FFA1400',
  fields: [
    { name: 'Typargument', value: 'Order' },
    { name: 'EEClass', value: '→ List<__Canon> (geteilt)', ref: 'ee-list-canon' },
  ],
};
const eeListCanon: Obj = {
  id: 'ee-list-canon',
  type: 'EEClass List<__Canon> (Loader Heap)',
  address: '0x7FFA3200',
  fields: [{ name: 'gilt für', value: 'alle List<T> mit Referenztyp T' }],
};
const mtListInt: Obj = {
  id: 'mt-list-int',
  type: 'MethodTable List<int> (Loader Heap)',
  address: '0x7FFA1600',
  fields: [
    { name: 'Typargument', value: 'int' },
    { name: 'EEClass', value: '→ List<int> (eigene)', ref: 'ee-list-int' },
  ],
};
const eeListInt: Obj = {
  id: 'ee-list-int',
  type: 'EEClass List<int> (Loader Heap)',
  address: '0x7FFA3400',
  fields: [{ name: 'gilt für', value: 'nur List<int>' }],
};

const order = (id: string, address: string, value: string): Obj => ({
  id,
  type: 'Order',
  address,
  generation: 0,
  fields: [
    { name: 'MethodTable', value: '→ Order', ref: 'mt-order' },
    { name: 'Id', value },
  ],
});
const listOrder: Obj = {
  id: 'obj-list',
  type: 'List<Order>',
  address: '0x7F3A0240',
  generation: 0,
  fields: [
    { name: 'MethodTable', value: '→ List<Order>', ref: 'mt-list-order' },
    { name: '_size', value: '2' },
  ],
};
const listInt: Obj = {
  id: 'obj-ints',
  type: 'List<int>',
  address: '0x7F3A0280',
  generation: 0,
  fields: [
    { name: 'MethodTable', value: '→ List<int>', ref: 'mt-list-int' },
    { name: '_size', value: '0' },
  ],
};

const loaded: Obj[] = [mtEntity, mtOrder, eeOrder, mtListOrder, eeListCanon, mtListInt, eeListInt];

type Slot = MemoryState['frames'][number]['slots'][number];
const slot = (id: string, type: string, target?: Obj): Slot => ({
  id,
  name: id,
  type: `${type} (Verweis)`,
  value: target ? target.address : 'null',
  ...(target ? { ref: target.id } : {}),
});

const A = order('obj-a', '0x7F3A0200', '1');
const B = order('obj-b', '0x7F3A0220', '2');

const state = (n: number, heap: Obj[]): MemoryState => ({
  frames: [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        slot('a', 'Order', n >= 1 ? A : undefined),
        slot('b', 'Order', n >= 2 ? B : undefined),
        slot('list', 'List<Order>', n >= 3 ? listOrder : undefined),
        slot('ints', 'List<int>', n >= 4 ? listInt : undefined),
      ],
    },
  ],
  heap,
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Was das Typladen im Speicher anlegt',
  code: {
    cs: `var a = new Order(1);
var b = new Order(2);
var list = new List<Order> { a, b };
var ints = new List<int>();`,
  },
  steps: [
    {
      state: state(0, loaded),
      changed: loaded.map((o) => o.id),
      explanation:
        'Bevor die erste Zeile läuft, hat der JIT `Main` übersetzt und dabei alle vier Typen gebraucht. Im **Loader Heap** stehen jetzt ihre MethodTables und EEClasses. Auf dem GC-Heap gibt es noch kein einziges Objekt dieser Typen.',
    },
    {
      codeLine: 1,
      state: state(1, [...loaded, A]),
      changed: ['a', 'obj-a.MethodTable'],
      explanation:
        'Das erste `Order`-Objekt entsteht auf dem GC-Heap. Sein erstes Feld ist der Zeiger auf die MethodTable. Diesen Zeiger hat der JIT als Konstante in den Allokationsaufruf eingebaut, die Typsuche ist zur Laufzeit längst erledigt.',
    },
    {
      codeLine: 2,
      state: state(2, [...loaded, A, B]),
      changed: ['b', 'obj-b.MethodTable'],
      explanation:
        'Das zweite Objekt zeigt auf **dieselbe** MethodTable. Ein Typ wird pro Kontext genau einmal geladen, egal wie viele Instanzen es gibt. Deshalb ist der Vergleich zweier MethodTable-Zeiger ein gültiger Typvergleich.',
    },
    {
      codeLine: 3,
      state: state(3, [...loaded, A, B, listOrder]),
      changed: ['list', 'obj-list.MethodTable', 'mt-list-order.EEClass'],
      explanation:
        '`List<Order>` steht in keiner Assembly als TypeDef. Die Runtime hat diese Instanz bei Bedarf gebaut und merkt sie sich in einer Hashtabelle, damit es nie zwei MethodTables für denselben Typ gibt. Die EEClass teilt sie sich mit allen anderen `List<T>` für Referenztypen.',
    },
    {
      codeLine: 4,
      state: state(4, [...loaded, A, B, listOrder, listInt]),
      changed: ['ints', 'obj-ints.MethodTable', 'mt-list-int.EEClass'],
      explanation:
        '`List<int>` bekommt dagegen eine **eigene** EEClass und später eigenen Code, weil ein `int` anders im Speicher liegt als ein Verweis. Wie Code zwischen Instanzen geteilt wird, behandelt „Generics zur Laufzeit“.',
    },
    {
      codeLine: 4,
      state: state(4, [...loaded, A, B, listOrder, listInt]),
      changed: ['mt-order', 'ee-order'],
      explanation:
        'Fehlannahme: „Typinformation ist ein Objekt, das der GC aufräumt, wenn keiner mehr darauf zeigt.“ MethodTable und EEClass liegen im Loader Heap ihres Kontexts. Sie bleiben, bis dieser Kontext entladen wird, beim Default-Kontext also bis zum Prozessende.',
    },
  ],
});
