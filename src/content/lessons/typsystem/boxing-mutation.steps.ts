import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.

const ADDR = '0x7F3A0300';
const state = (c: string, boxed: string | null, output?: string): MemoryState => ({
  frames: [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        { id: 'c', name: 'c', type: 'Counter (Struct)', value: `{ _v = ${c} }` },
        {
          id: 'i',
          name: 'i',
          type: 'ICounter (Verweis)',
          value: boxed === null ? 'null' : ADDR,
          ...(boxed === null ? {} : { ref: 'box' }),
        },
      ],
    },
  ],
  heap:
    boxed === null
      ? []
      : [
          {
            id: 'box',
            type: 'Counter (geboxt)',
            address: ADDR,
            generation: 0,
            fields: [
              { name: 'MethodTable', value: '→ Counter' },
              { name: '_v', value: boxed },
            ],
          },
        ],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  title: 'Struct hinter einem Interface Schritt für Schritt',
  code: {
    cs: `interface ICounter { void Inc(); int Value { get; } }
struct Counter : ICounter
{
    int _v;
    public void Inc() => _v++;
    public int Value => _v;
}

var c = new Counter();
ICounter i = c;        // Boxing
i.Inc();
c.Inc();
c.Inc();
Console.WriteLine($"{c.Value} {i.Value}");`,
  },
  steps: [
    {
      codeLine: 9,
      state: state('0', null),
      changed: ['c'],
      explanation: '`c` ist ein Struct und liegt direkt im Stack-Frame. Sein Feld `_v` ist 0.',
    },
    {
      codeLine: 10,
      state: state('0', '0'),
      changed: ['i', 'box'],
      explanation:
        'Eine Interface-Variable ist immer ein Verweis. Die Zuweisung boxt `c`: Es entsteht eine **Kopie** auf dem Heap, und `i` zeigt auf diese Kopie, nicht auf `c`.',
    },
    {
      codeLine: 11,
      state: state('0', '1'),
      changed: ['box._v'],
      explanation:
        '`i.Inc()` ruft die Methode auf dem Objekt auf, auf das `i` zeigt, also auf der Box. Die Box zählt auf 1, das Original `c` merkt davon nichts.',
    },
    {
      codeLine: 13,
      state: state('2', '1'),
      changed: ['c'],
      explanation:
        'Umgekehrt genauso: `c.Inc()` ändert nur das Original im Stack-Frame. Nach zwei Aufrufen steht `c` bei 2, die Box bleibt bei 1.',
    },
    {
      codeLine: 14,
      state: state('2', '1', '2 1'),
      explanation:
        'Ausgabe „2 1“. Wer ein veränderliches Struct über ein Interface anspricht, arbeitet mit einer Kopie. Das ist einer der Gründe für die Empfehlung, Structs möglichst unveränderlich zu machen (`readonly struct`).',
    },
  ],
});
