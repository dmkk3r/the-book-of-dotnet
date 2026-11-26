import { defineStepScript, type LayoutState } from '@/components/viz';

// Illustration of bump-pointer allocation inside one allocation context. The block is scaled down
// to 112 bytes on purpose; real allocation quanta are much larger (CLR_SIZE in gcinternal.h).
// The reserve at the end mirrors adjust_limit_clr in allocation.cpp: alloc_limit is set to
// start + limit_size - Align(min_obj_size), so a free object always fits behind the context.
// TODO(verify): Object sizes on x64 (class with one int field 24 B, int[4] 40 B) and
// min_obj_size = 24 B on 64-bit.

type Part = LayoutState['parts'][number];

const node = (id: string, offset: number, label: string): Part => ({
  id,
  name: label,
  type: 'Node (24 B)',
  offset,
  size: 24,
  kind: 'field',
});
const ints = (id: string, offset: number, label: string): Part => ({
  id,
  name: label,
  type: 'int[4] (40 B)',
  offset,
  size: 40,
  kind: 'field',
});
const free = (offset: number, end = 88): Part => ({
  id: 'free',
  name: 'frei, genullt',
  offset,
  size: end - offset,
  kind: 'padding',
});
const reserve: Part = {
  id: 'reserve',
  name: 'Reserve hinter alloc_limit',
  offset: 88,
  size: 24,
  kind: 'padding',
};

const oldTitle = 'Allocation Context von Thread A (stark verkleinert, 64-Bit)';

export default defineStepScript({
  view: 'layout',
  title: 'Bump-Pointer-Allokation Schritt für Schritt',
  code: {
    cs: `class Node { public int Value; }

var a = new Node();      // 24 B
var b = new int[4];      // 40 B
var c = new Node();      // 24 B
var d = new int[4];      // passt nicht mehr in den Context`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        title: oldTitle,
        totalSize: 112,
        bytesPerRow: 16,
        parts: [free(0), reserve],
        note: 'alloc_ptr = +0, alloc_limit = +88. Der Bereich gehört nur diesem Thread.',
      },
      explanation:
        'Thread A besitzt ein **Allocation Context**: zwei Zeiger in einen Block von Gen0, den der GC ihm überlassen hat. `alloc_ptr` zeigt auf das nächste freie Byte, `alloc_limit` auf das Ende des nutzbaren Bereichs. Der Block ist bereits genullt.',
    },
    {
      codeLine: 3,
      state: {
        title: oldTitle,
        totalSize: 112,
        bytesPerRow: 16,
        parts: [node('a', 0, 'a: Node'), free(24), reserve],
        note: 'alloc_ptr = +24, alloc_limit = +88',
      },
      changed: ['a'],
      explanation:
        'Häufige Fehlannahme: `new` müsse wie `malloc` erst passenden Platz suchen. Hier passiert nur Folgendes: Prüfen, ob `alloc_ptr + 24` noch unter dem Limit liegt, das Objekt an die alte Position legen, den Zeiger um 24 Byte weiterschieben. Danach wird der MethodTable-Zeiger geschrieben und der Konstruktor läuft.',
    },
    {
      codeLine: 4,
      state: {
        title: oldTitle,
        totalSize: 112,
        bytesPerRow: 16,
        parts: [node('a', 0, 'a: Node'), ints('b', 24, 'b: int[4]'), free(64), reserve],
        note: 'alloc_ptr = +64, alloc_limit = +88',
      },
      changed: ['b'],
      explanation:
        'Das Array kommt direkt hinter `a`. Weil der Speicher schon genullt ist, stehen die vier `int` ohne weitere Arbeit auf 0. Zusätzlich schreibt der Helfer nur noch die Länge des Arrays.',
    },
    {
      codeLine: 5,
      state: {
        title: oldTitle,
        totalSize: 112,
        bytesPerRow: 16,
        parts: [
          node('a', 0, 'a: Node'),
          ints('b', 24, 'b: int[4]'),
          node('c', 64, 'c: Node'),
          reserve,
        ],
        note: 'alloc_ptr = +88 = alloc_limit',
      },
      changed: ['c'],
      explanation:
        '`c` passt genau bis zum Limit. Objekte, die direkt nacheinander alloziert werden, liegen damit auch nebeneinander im Speicher, was dem Prozessorcache entgegenkommt.',
    },
    {
      codeLine: 6,
      state: {
        title: oldTitle,
        totalSize: 112,
        bytesPerRow: 16,
        parts: [
          node('a', 0, 'a: Node'),
          ints('b', 24, 'b: int[4]'),
          node('c', 64, 'c: Node'),
          { ...reserve, id: 'hole', name: 'freies Objekt (Lücke)' },
        ],
        note: 'alloc_ptr + 40 > alloc_limit: langsamer Pfad',
      },
      changed: ['hole'],
      explanation:
        '`alloc_ptr + 40` liegt hinter dem Limit, der schnelle Pfad scheitert. Der **langsame Pfad** im GC übernimmt. Liegt der neue Block nicht direkt dahinter, macht er aus dem Rest ein **freies Objekt**, damit der Heap lückenlos durchlaufbar bleibt.',
    },
    {
      codeLine: 6,
      state: {
        title: 'Neuer Block für Thread A (stark verkleinert, 64-Bit)',
        totalSize: 112,
        bytesPerRow: 16,
        parts: [ints('d', 0, 'd: int[4]'), free(40), reserve],
        note: 'alloc_ptr = +40, alloc_limit = +88 im neuen Block',
      },
      changed: ['d', 'free'],
      explanation:
        'Der GC hat Thread A einen neuen, genullten Block zugeteilt und den Context auf ihn umgestellt. `d` liegt am Anfang, danach geht es wieder im schnellen Pfad weiter. Reale Blöcke sind viel größer, so dass der langsame Pfad selten nötig ist.',
    },
  ],
});
