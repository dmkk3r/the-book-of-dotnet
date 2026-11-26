import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.
// TODO(verify): Size of a PointC instance on x64 (24 B: header, MethodTable pointer, int, padding).

const ADDR = '0x7F3A0400';
type Slot = MemoryState['frames'][number]['slots'][number];

const s = (id: string, x: string | null): Slot => ({
  id,
  name: id,
  type: 'PointS (Werttyp, 4 Byte)',
  value: x === null ? '{ X = 0 }' : `{ X = ${x} }`,
});
const c = (id: string, set: boolean): Slot => ({
  id,
  name: id,
  type: 'PointC (Verweis, 8 Byte)',
  value: set ? ADDR : 'null',
  ...(set ? { ref: 'pc' } : {}),
});
const pointC = (x: string): MemoryState['heap'][number] => ({
  id: 'pc',
  type: 'PointC',
  address: ADDR,
  generation: 0,
  fields: [{ name: 'X', value: x }],
  sizeBytes: 24,
});
const frame = (slots: Slot[]): MemoryState['frames'] => [{ id: 'main', method: 'Main()', slots }];

export default defineStepScript({
  view: 'memory',
  title: 'Wert- und Referenztypen Schritt für Schritt',
  code: {
    cs: `struct PointS { public int X; }
class  PointC { public int X; }

var s1 = new PointS { X = 1 };
var s2 = s1;        // kopiert den Wert
s2.X = 2;
var c1 = new PointC { X = 1 };
var c2 = c1;        // kopiert den Verweis
c2.X = 2;
Console.WriteLine($"{s1.X} {c1.X}");`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        frames: frame([s('s1', '1'), s('s2', null), c('c1', false), c('c2', false)]),
        heap: [],
      },
      changed: ['s1'],
      explanation:
        '`PointS` ist ein Werttyp. Die lokale Variable `s1` **enthält** das Struct selbst, hier mit `X = 1`. Ein Heap-Objekt entsteht nicht.',
    },
    {
      codeLine: 5,
      state: {
        frames: frame([s('s1', '1'), s('s2', '1'), c('c1', false), c('c2', false)]),
        heap: [],
      },
      changed: ['s2'],
      explanation:
        'Die Zuweisung `s2 = s1` kopiert alle Felder. Danach gibt es zwei unabhängige Structs mit gleichem Inhalt.',
    },
    {
      codeLine: 6,
      state: {
        frames: frame([s('s1', '1'), s('s2', '2'), c('c1', false), c('c2', false)]),
        heap: [],
      },
      changed: ['s2'],
      explanation: '`s2.X = 2` ändert nur die Kopie in `s2`. `s1` bleibt bei 1.',
    },
    {
      codeLine: 7,
      state: {
        frames: frame([s('s1', '1'), s('s2', '2'), c('c1', true), c('c2', false)]),
        heap: [pointC('1')],
      },
      changed: ['c1', 'pc'],
      explanation:
        '`PointC` ist ein Referenztyp. `new` legt ein Objekt auf dem Heap an, `c1` enthält nur dessen **Adresse**.',
    },
    {
      codeLine: 8,
      state: {
        frames: frame([s('s1', '1'), s('s2', '2'), c('c1', true), c('c2', true)]),
        heap: [pointC('1')],
      },
      changed: ['c2'],
      explanation:
        'Auch hier kopiert die Zuweisung, aber nur die Adresse. `c1` und `c2` zeigen jetzt auf **dasselbe** Objekt.',
    },
    {
      codeLine: 9,
      state: {
        frames: frame([s('s1', '1'), s('s2', '2'), c('c1', true), c('c2', true)]),
        heap: [pointC('2')],
      },
      changed: ['pc.X'],
      explanation:
        '`c2.X = 2` schreibt in das gemeinsame Objekt. Über `c1` sieht man die Änderung ebenfalls, weil es nur ein Objekt gibt.',
    },
    {
      codeLine: 10,
      state: {
        frames: frame([s('s1', '1'), s('s2', '2'), c('c1', true), c('c2', true)]),
        heap: [pointC('2')],
        output: '1 2',
      },
      explanation:
        'Ausgabe „1 2“. Die Regel dahinter ist immer dieselbe: Zuweisung kopiert den Inhalt der Variablen. Bei Werttypen ist das der Wert, bei Referenztypen der Verweis.',
    },
  ],
});
