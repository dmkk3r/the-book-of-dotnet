import { defineStepScript, fieldId, type MemoryState } from '@/components/viz';

// A copy inside the loop body: one display class per iteration (the same thing foreach does for
// its iteration variable since C# 5).
// Addresses are fictional but consistent across steps.
// TODO(verify): Generated names in SharpLab; that the display class is allocated at the start of
// each iteration of the body block; sizes on x64 (Action[3] 48 B, display class 24 B, delegate 64 B).

const ARR = '0x7F3A4000';
const DC = ['0x7F3A4030', '0x7F3A4088', '0x7F3A40E0'] as const;
const D = ['0x7F3A4048', '0x7F3A40A0', '0x7F3A40F8'] as const;
const DC_TYPE = '<>c__DisplayClass0_0';

type Obj = MemoryState['heap'][number];

/** closures: number of display classes created; delegates: number of delegates created. */
function state(i: string, closures: number, delegates: number, output?: string): MemoryState {
  const element = (n: number) =>
    n < delegates
      ? { name: `[${n}]`, value: D[n]!, ref: `d${n}` }
      : { name: `[${n}]`, value: 'null' };
  const heap: Obj[] = [
    {
      id: 'arr',
      type: 'Action[]',
      address: ARR,
      generation: 0,
      fields: [element(0), element(1), element(2)],
      sizeBytes: 48,
    },
  ];
  for (let n = 0; n < closures; n++) {
    heap.push({
      id: `dc${n}`,
      type: DC_TYPE,
      address: DC[n]!,
      generation: 0,
      fields: [{ name: 'copy', value: String(n) }],
      sizeBytes: 24,
    });
    if (n < delegates) {
      heap.push({
        id: `d${n}`,
        type: 'Action',
        address: D[n]!,
        generation: 0,
        fields: [
          { name: '_target', value: DC[n]!, ref: `dc${n}` },
          { name: '_methodPtr', value: '→ <Main>b__0' },
        ],
        sizeBytes: 64,
      });
    }
  }
  const current = closures - 1;
  return {
    frames: [
      {
        id: 'main',
        method: 'Main()',
        slots: [
          { id: 'actions', name: 'actions', type: 'Action[] (Verweis)', value: ARR, ref: 'arr' },
          { id: 'i', name: 'i', type: 'int (4 Byte)', value: i },
          {
            id: 'closure',
            name: 'closure',
            type: `${DC_TYPE} (Verweis, vom Compiler erzeugt)`,
            value: current >= 0 ? DC[current]! : 'null',
            ...(current >= 0 ? { ref: `dc${current}` } : {}),
          },
        ],
      },
    ],
    heap,
    ...(output !== undefined ? { output } : {}),
  };
}

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Eine Kopie pro Durchlauf',
  code: {
    cs: `var actions = new Action[3];
for (int i = 0; i < 3; i++)
{
    int copy = i;
    actions[i] = () => Console.Write(copy);
}

actions[0]();
actions[1]();
actions[2]();`,
    lowered: `Action[] actions = new Action[3];
for (int i = 0; i < 3; i++)
{
    <>c__DisplayClass0_0 closure = new <>c__DisplayClass0_0();
    closure.copy = i;
    actions[i] = new Action(closure.<Main>b__0);
}
actions[0]();
actions[1]();
actions[2]();`,
  },
  steps: [
    {
      codeLine: 2,
      highlight: { lowered: [1, 2] },
      state: state('0', 0, 0),
      changed: ['arr', 'actions', 'i'],
      explanation:
        'Diesmal fängt die Lambda nicht `i` ein, sondern `copy`. Deshalb bleibt `i` ein ganz normaler Local im Stack-Frame, ohne Display-Klasse.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [4, 5] },
      state: state('0', 1, 0),
      changed: ['dc0', 'closure', fieldId('dc0', 'copy')],
      explanation:
        '`copy` ist **im Schleifenrumpf** deklariert. Jeder Durchlauf betritt diesen Block neu, also legt jeder Durchlauf ein eigenes Display-Objekt an und schreibt den aktuellen Wert von `i` hinein.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [6] },
      state: state('0', 1, 1),
      changed: ['d0', fieldId('arr', '[0]')],
      explanation: 'Der erste Delegate zeigt auf das erste Display-Objekt mit `copy = 0`.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [2, 4, 5] },
      state: state('1', 2, 1),
      changed: ['i', 'dc1', 'closure', fieldId('dc1', 'copy')],
      explanation:
        'Zweiter Durchlauf: ein **neues** Display-Objekt mit `copy = 1`. Der versteckte Local zeigt jetzt dorthin, das erste Objekt bleibt über den ersten Delegate erreichbar.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [6] },
      state: state('1', 2, 2),
      changed: ['d1', fieldId('arr', '[1]')],
      explanation: 'Der zweite Delegate bekommt sein eigenes `_target`.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [2, 4, 5] },
      state: state('2', 3, 2),
      changed: ['i', 'dc2', 'closure', fieldId('dc2', 'copy')],
      explanation: 'Dritter Durchlauf, drittes Display-Objekt mit `copy = 2`.',
    },
    {
      codeLine: 5,
      highlight: { lowered: [6] },
      state: state('2', 3, 3),
      changed: ['d2', fieldId('arr', '[2]')],
      explanation:
        'Jetzt gibt es drei Paare aus Display-Objekt und Delegate. Der Preis: sechs Objekte für Closures und Delegates statt vier wie in der Variante ohne Kopie.',
    },
    {
      codeLine: 8,
      highlight: { lowered: [8, 9, 10] },
      state: state('3', 3, 3, '012'),
      changed: ['i'],
      explanation:
        'Die Schleife endet mit `i = 3`, doch das betrifft keinen Delegate mehr. Jeder liest sein eigenes `copy`: Ausgabe `012`.',
    },
  ],
});
