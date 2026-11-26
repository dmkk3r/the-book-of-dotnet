import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.

const A1 = '0x7F3A0900';
const A2 = '0x7F3A0918';
type Frame = MemoryState['frames'][number];
type Obj = MemoryState['heap'][number];

const main = (px: string): Frame => ({
  id: 'main',
  method: 'Main()',
  slots: [
    { id: 'p', name: 'p', type: 'PointS (Werttyp)', value: `{ X = ${px} }` },
    { id: 'c', name: 'c', type: 'PointC (Verweis)', value: A1, ref: 'obj1' },
  ],
});
const change = (sx: string, k: 'obj1' | 'obj2'): Frame => ({
  id: 'change',
  method: 'Change(PointS s, PointC k)',
  slots: [
    { id: 's', name: 's', type: 'PointS (Kopie)', value: `{ X = ${sx} }` },
    {
      id: 'k',
      name: 'k',
      type: 'PointC (Kopie des Verweises)',
      value: k === 'obj1' ? A1 : A2,
      ref: k,
    },
  ],
});
const obj = (id: 'obj1' | 'obj2', addr: string, x: string): Obj => ({
  id,
  type: 'PointC',
  address: addr,
  generation: 0,
  fields: [{ name: 'X', value: x }],
});

export default defineStepScript({
  view: 'memory',
  title: 'Parameterübergabe Schritt für Schritt',
  code: {
    cs: `static void Change(PointS s, PointC k)
{
    s.X = 9;
    k.X = 9;
    k = new PointC { X = 5 };
}

var p = new PointS { X = 1 };
var c = new PointC { X = 1 };
Change(p, c);
Console.WriteLine($"{p.X} {c.X}");`,
  },
  steps: [
    {
      codeLine: 9,
      state: { frames: [main('1')], heap: [obj('obj1', A1, '1')] },
      changed: ['p', 'c', 'obj1'],
      explanation:
        'Vor dem Aufruf: `p` enthält ein Struct, `c` einen Verweis auf ein `PointC`-Objekt. Beide haben `X = 1`.',
    },
    {
      codeLine: 1,
      state: { frames: [main('1'), change('1', 'obj1')], heap: [obj('obj1', A1, '1')] },
      changed: ['change', 's', 'k'],
      explanation:
        'Der Aufruf legt einen neuen Stack-Frame an. Die Parameter werden mit **Kopien** der Argumente gefüllt: `s` bekommt eine Kopie des Structs, `k` eine Kopie des Verweises. `k` und `c` zeigen auf dasselbe Objekt.',
    },
    {
      codeLine: 3,
      state: { frames: [main('1'), change('9', 'obj1')], heap: [obj('obj1', A1, '1')] },
      changed: ['s'],
      explanation:
        '`s.X = 9` ändert nur die Kopie im Frame von `Change`. Das `p` des Aufrufers bleibt bei 1.',
    },
    {
      codeLine: 4,
      state: { frames: [main('1'), change('9', 'obj1')], heap: [obj('obj1', A1, '9')] },
      changed: ['obj1.X'],
      explanation:
        '`k.X = 9` folgt dem Verweis und schreibt ins gemeinsame Objekt. Diese Änderung sieht der Aufrufer über `c`.',
    },
    {
      codeLine: 5,
      state: {
        frames: [main('1'), change('9', 'obj2')],
        heap: [obj('obj1', A1, '9'), obj('obj2', A2, '5')],
      },
      changed: ['k', 'obj2'],
      explanation:
        'Häufige Fehlannahme: Referenztypen würden „per Referenz übergeben“. Tatsächlich wird der Verweis **per Wert** übergeben. `k = new PointC()` ändert nur die lokale Kopie `k`, `c` zeigt weiter auf das alte Objekt.',
    },
    {
      codeLine: 11,
      state: {
        frames: [main('1')],
        heap: [obj('obj1', A1, '9'), obj('obj2', A2, '5')],
        output: '1 9',
      },
      explanation:
        'Der Frame von `Change` ist weg, mit ihm `s` und `k`. Ausgabe „1 9“. Das neue Objekt mit `X = 5` ist nicht mehr erreichbar und wird beim nächsten GC eingesammelt.',
    },
  ],
});
