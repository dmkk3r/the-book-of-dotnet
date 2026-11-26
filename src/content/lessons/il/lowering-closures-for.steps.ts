import { defineStepScript, fieldId, type MemoryState } from '@/components/viz';

// Capturing the loop variable of a for loop: one display class for the whole loop.
// Addresses are fictional but consistent across steps.
// TODO(verify): Generated names and the IL listing (order of locals, offsets, the form of i++ on
// the field, br.s to the condition at the end) in SharpLab, Release.
// TODO(verify): Sizes on x64: Action[3] 48 B, display class 24 B, delegate 64 B.

const ARR = '0x7F3A3000';
const DC = '0x7F3A3030';
const D = ['0x7F3A3048', '0x7F3A3088', '0x7F3A30C8'] as const;
const DC_TYPE = '<>c__DisplayClass0_0';

type Obj = MemoryState['heap'][number];

const delegate = (n: number): Obj => ({
  id: `d${n}`,
  type: 'Action',
  address: D[n]!,
  generation: 0,
  fields: [
    { name: '_target', value: DC, ref: 'dc' },
    { name: '_methodPtr', value: '→ <Main>b__0' },
  ],
  sizeBytes: 64,
});

/** dc: display class exists; i: value of the field; delegates: how many were created. */
function state(dc: boolean, i: string, delegates: number, output?: string): MemoryState {
  const element = (n: number) =>
    n < delegates
      ? { name: `[${n}]`, value: D[n]!, ref: `d${n}` }
      : { name: `[${n}]`, value: 'null' };
  return {
    frames: [
      {
        id: 'main',
        method: 'Main()',
        slots: [
          { id: 'actions', name: 'actions', type: 'Action[] (Verweis)', value: ARR, ref: 'arr' },
          {
            id: 'closure',
            name: 'closure',
            type: `${DC_TYPE} (Verweis, vom Compiler erzeugt)`,
            value: dc ? DC : 'null',
            ...(dc ? { ref: 'dc' } : {}),
          },
        ],
      },
    ],
    heap: [
      {
        id: 'arr',
        type: 'Action[]',
        address: ARR,
        generation: 0,
        fields: [element(0), element(1), element(2)],
        sizeBytes: 48,
      },
      ...(dc
        ? [
            {
              id: 'dc',
              type: DC_TYPE,
              address: DC,
              generation: 0 as const,
              fields: [{ name: 'i', value: i }],
              sizeBytes: 24,
            },
          ]
        : []),
      ...[0, 1, 2].filter((n) => n < delegates).map(delegate),
    ],
    ...(output !== undefined ? { output } : {}),
  };
}

const iField = fieldId('dc', 'i');

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Die Schleifenvariable einer for-Schleife einfangen',
  code: {
    cs: `var actions = new Action[3];
for (int i = 0; i < 3; i++)
    actions[i] = () => Console.Write(i);

actions[0]();
actions[1]();
actions[2]();`,
    il: `IL_0000: ldc.i4.3
IL_0001: newarr [System.Runtime]System.Action
IL_0006: stloc.0
IL_0007: newobj instance void Program/'<>c__DisplayClass0_0'::.ctor()
IL_000c: stloc.1
IL_000d: ldloc.1
IL_000e: ldc.i4.0
IL_000f: stfld int32 Program/'<>c__DisplayClass0_0'::i
IL_0014: br.s IL_0038
// Schleifenrumpf
IL_0016: ldloc.0
IL_0017: ldloc.1
IL_0018: ldfld int32 Program/'<>c__DisplayClass0_0'::i
IL_001d: ldloc.1
IL_001e: ldftn instance void Program/'<>c__DisplayClass0_0'::'<Main>b__0'()
IL_0024: newobj instance void [System.Runtime]System.Action::.ctor(object, native int)
IL_0029: stelem.ref
// i++
IL_002a: ldloc.1
IL_002b: ldloc.1
IL_002c: ldfld int32 Program/'<>c__DisplayClass0_0'::i
IL_0031: ldc.i4.1
IL_0032: add
IL_0033: stfld int32 Program/'<>c__DisplayClass0_0'::i
// Bedingung
IL_0038: ldloc.1
IL_0039: ldfld int32 Program/'<>c__DisplayClass0_0'::i
IL_003e: ldc.i4.3
IL_003f: blt.s IL_0016
// Aufrufe
IL_0041: ldloc.0
IL_0042: ldc.i4.0
IL_0043: ldelem.ref
IL_0044: callvirt instance void [System.Runtime]System.Action::Invoke()
// ebenso für [1] und [2]`,
    lowered: `Action[] actions = new Action[3];
<>c__DisplayClass0_0 closure = new <>c__DisplayClass0_0();
closure.i = 0;
while (closure.i < 3)
{
    actions[closure.i] = new Action(closure.<Main>b__0);
    closure.i++;
}
actions[0]();
actions[1]();
actions[2]();`,
  },
  steps: [
    {
      codeLine: 1,
      highlight: { il: [1, 2, 3], lowered: [1] },
      state: state(false, '0', 0),
      changed: ['arr', 'actions'],
      explanation:
        'Ein Array für drei Delegates, alle Elemente sind `null`. Noch gibt es keine Display-Klasse.',
    },
    {
      codeLine: 2,
      highlight: { il: [4, 5, 6, 7, 8], lowered: [2, 3] },
      state: state(true, '0', 0),
      changed: ['dc', 'closure', iField],
      explanation:
        'Die Lambda fängt `i` ein, und `i` ist für die **ganze Schleife** deklariert, nicht pro Durchlauf. Also legt der Compiler die Display-Klasse einmal **vor** der Schleife an. `i` ist ab jetzt ein Feld.',
    },
    {
      codeLine: 3,
      highlight: { il: [11, 12, 13, 14, 15, 16, 17], lowered: [6] },
      state: state(true, '0', 1),
      changed: ['d0', fieldId('arr', '[0]')],
      explanation:
        'Erster Durchlauf: Ein neuer Delegate entsteht und landet in `actions[0]`. Sein `_target` ist das eine Display-Objekt. Der Delegate merkt sich keinen Wert von `i`, nur, wo `i` wohnt.',
    },
    {
      codeLine: 2,
      highlight: { il: [19, 20, 21, 22, 23, 24], lowered: [7] },
      state: state(true, '1', 1),
      changed: [iField],
      explanation:
        '`i++` erhöht das Feld. Der bereits erzeugte Delegate sieht diese Änderung, denn er zeigt auf dasselbe Objekt.',
    },
    {
      codeLine: 3,
      highlight: { il: [11, 12, 13, 14, 15, 16, 17], lowered: [6] },
      state: state(true, '1', 2),
      changed: ['d1', fieldId('arr', '[1]')],
      explanation:
        'Zweiter Durchlauf: wieder ein neuer Delegate, wieder mit demselben `_target`. Neu ist nur der Delegate, nicht die Variable.',
    },
    {
      codeLine: 2,
      highlight: { il: [19, 20, 21, 22, 23, 24], lowered: [7] },
      state: state(true, '2', 2),
      changed: [iField],
      explanation: '`i` wird 2.',
    },
    {
      codeLine: 3,
      highlight: { il: [11, 12, 13, 14, 15, 16, 17], lowered: [6] },
      state: state(true, '2', 3),
      changed: ['d2', fieldId('arr', '[2]')],
      explanation:
        'Dritter Durchlauf, dritter Delegate. Alle drei zeigen auf dasselbe Display-Objekt.',
    },
    {
      codeLine: 2,
      highlight: { il: [19, 20, 21, 22, 23, 24, 26, 27, 28, 29], lowered: [4, 7] },
      state: state(true, '3', 3),
      changed: [iField],
      explanation:
        '`i++` macht 3 daraus, die Bedingung `i < 3` ist falsch, die Schleife endet. Das Feld `i` behält den Wert 3, denn das Display-Objekt lebt weiter, solange die Delegates es brauchen.',
    },
    {
      codeLine: 5,
      highlight: { il: [31, 32, 33, 34], lowered: [9] },
      state: state(true, '3', 3, '3'),
      explanation:
        'Erwartet hätten viele eine 0. Der Delegate liest aber **jetzt** das Feld `i`, und das steht auf 3. Eingefangen wird die Variable, nicht ihr Wert zum Zeitpunkt der Erzeugung.',
    },
    {
      codeLine: 7,
      highlight: { il: [35], lowered: [10, 11] },
      state: state(true, '3', 3, '333'),
      explanation:
        'Die anderen beiden Delegates lesen dasselbe Feld: Ausgabe `333`. Mit `foreach` oder einer Kopie im Schleifenrumpf wäre es `012`, wie der nächste Abschnitt zeigt.',
    },
  ],
});
