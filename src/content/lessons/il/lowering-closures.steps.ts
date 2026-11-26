import { defineStepScript, fieldId, type MemoryState } from '@/components/viz';

// Two lambdas capturing the same local: one display class, two delegates pointing to it.
// Addresses are fictional but consistent across steps.
// TODO(verify): Compiler-generated names (<>c__DisplayClass0_0, <Main>b__0, <Main>b__1) and the
// exact Release IL in SharpLab (Roslyn may keep the delegates on the stack instead of V_1/V_2).
// TODO(verify): Sizes on x64: display class with one int field 24 B, Action/Func delegate 64 B
// (Delegate fields _target, _methodBase, _methodPtr, _methodPtrAux plus MulticastDelegate fields
// _invocationList, _invocationCount).

const DC = '0x7F3A2000';
const D1 = '0x7F3A2018';
const D2 = '0x7F3A2058';
const DC_TYPE = '<>c__DisplayClass0_0';

type Obj = MemoryState['heap'][number];
type Frame = MemoryState['frames'][number];

const delegate = (id: string, type: string, address: string, method: string): Obj => ({
  id,
  type,
  address,
  generation: 0,
  fields: [
    { name: '_target', value: DC, ref: 'dc' },
    { name: '_methodPtr', value: `→ ${method}` },
    {
      name: 'weitere Felder',
      value: '_methodPtrAux, _methodBase, _invocationList, _invocationCount',
    },
  ],
  sizeBytes: 64,
});

interface Look {
  count: string;
  inc: boolean;
  get: boolean;
  call?: 'inc' | 'get';
  output?: string;
}

function state({ count, inc, get, call, output }: Look): MemoryState {
  const frames: Frame[] = [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        {
          id: 'closure',
          name: 'closure',
          type: `${DC_TYPE} (Verweis, vom Compiler erzeugt)`,
          value: DC,
          ref: 'dc',
        },
        {
          id: 'inc',
          name: 'inc',
          type: 'Action (Verweis)',
          value: inc ? D1 : 'null',
          ...(inc ? { ref: 'd1' } : {}),
        },
        {
          id: 'get',
          name: 'get',
          type: 'Func<int> (Verweis)',
          value: get ? D2 : 'null',
          ...(get ? { ref: 'd2' } : {}),
        },
      ],
    },
  ];
  if (call) {
    frames.push({
      id: 'lambda',
      method: call === 'inc' ? `${DC_TYPE}.<Main>b__0()` : `${DC_TYPE}.<Main>b__1()`,
      slots: [{ id: 'this', name: 'this', type: `${DC_TYPE} (Verweis)`, value: DC, ref: 'dc' }],
    });
  }
  return {
    frames,
    heap: [
      {
        id: 'dc',
        type: DC_TYPE,
        address: DC,
        generation: 0,
        fields: [{ name: 'count', value: count }],
        sizeBytes: 24,
      },
      ...(inc ? [delegate('d1', 'Action', D1, '<Main>b__0')] : []),
      ...(get ? [delegate('d2', 'Func<int>', D2, '<Main>b__1')] : []),
    ],
    ...(output !== undefined ? { output } : {}),
  };
}

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Zwei Lambdas teilen sich eine Variable',
  code: {
    cs: `static void Main()
{
    int count = 0;
    Action inc = () => count++;
    Func<int> get = () => count;
    inc();
    inc();
    count = 10;
    Console.WriteLine(get());
}`,
    il: `.locals init (class Program/'<>c__DisplayClass0_0' V_0, class [System.Runtime]System.Action V_1, class [System.Runtime]System.Func\`1<int32> V_2)
newobj instance void Program/'<>c__DisplayClass0_0'::.ctor()
stloc.0
ldloc.0
ldc.i4.0
stfld int32 Program/'<>c__DisplayClass0_0'::count
ldloc.0
ldftn instance void Program/'<>c__DisplayClass0_0'::'<Main>b__0'()
newobj instance void [System.Runtime]System.Action::.ctor(object, native int)
stloc.1
ldloc.0
ldftn instance int32 Program/'<>c__DisplayClass0_0'::'<Main>b__1'()
newobj instance void class [System.Runtime]System.Func\`1<int32>::.ctor(object, native int)
stloc.2
ldloc.1
callvirt instance void [System.Runtime]System.Action::Invoke()
ldloc.1
callvirt instance void [System.Runtime]System.Action::Invoke()
ldloc.0
ldc.i4.s 10
stfld int32 Program/'<>c__DisplayClass0_0'::count
ldloc.2
callvirt instance !0 class [System.Runtime]System.Func\`1<int32>::Invoke()
call void [System.Console]System.Console::WriteLine(int32)
ret`,
    lowered: `[CompilerGenerated]
private sealed class <>c__DisplayClass0_0
{
    public int count;

    internal void <Main>b__0()
    {
        count++;
    }

    internal int <Main>b__1()
    {
        return count;
    }
}

private static void Main()
{
    <>c__DisplayClass0_0 closure = new <>c__DisplayClass0_0();
    closure.count = 0;
    Action inc = new Action(closure.<Main>b__0);
    Func<int> get = new Func<int>(closure.<Main>b__1);
    inc();
    inc();
    closure.count = 10;
    Console.WriteLine(get());
}`,
  },
  steps: [
    {
      codeLine: 2,
      highlight: { il: [1, 2, 3], lowered: [19] },
      state: state({ count: '0', inc: false, get: false }),
      changed: ['dc', 'closure'],
      explanation:
        'Noch bevor die erste Zeile läuft, legt die Methode ein Objekt der vom Compiler erzeugten **Display-Klasse** an. Sie ist das Zuhause von `count`: Im Stack-Frame gibt es keinen Platz mehr für diese Variable, nur einen versteckten Local mit dem Verweis.',
    },
    {
      codeLine: 3,
      highlight: { il: [4, 5, 6], lowered: [20] },
      state: state({ count: '0', inc: false, get: false }),
      changed: [fieldId('dc', 'count')],
      explanation:
        '`count = 0` wird zu `stfld` auf das Feld der Display-Klasse. Jeder Zugriff auf `count` in `Main` geht ab jetzt über dieses Feld, nicht nur die Zugriffe in den Lambdas.',
    },
    {
      codeLine: 4,
      highlight: { il: [7, 8, 9, 10], lowered: [6, 7, 8, 9, 21] },
      state: state({ count: '0', inc: true, get: false }),
      changed: ['d1', 'inc'],
      explanation:
        'Der Rumpf der ersten Lambda ist eine gewöhnliche Instanzmethode der Display-Klasse geworden. Der Delegate besteht aus zwei Teilen: `_target` zeigt auf das Display-Objekt, `_methodPtr` auf den Code. `ldftn` liefert die Methodenadresse, `newobj` baut daraus das Delegate-Objekt.',
    },
    {
      codeLine: 5,
      highlight: { il: [11, 12, 13, 14], lowered: [11, 12, 13, 14, 22] },
      state: state({ count: '0', inc: true, get: true }),
      changed: ['d2', 'get'],
      explanation:
        'Die zweite Lambda landet in **derselben** Display-Klasse, weil sie Variablen aus demselben Gültigkeitsbereich einfängt. Ihr Delegate zeigt auf dasselbe Objekt. Bis hierhin hat die Methode drei Objekte alloziert.',
    },
    {
      codeLine: 6,
      highlight: { il: [15, 16], lowered: [8, 23] },
      state: state({ count: '1', inc: true, get: true, call: 'inc' }),
      changed: ['lambda', fieldId('dc', 'count')],
      explanation:
        '`inc()` ist ein Aufruf von `Invoke` auf dem Delegate. Der ruft `<Main>b__0` auf und übergibt `_target` als `this`. Die Lambda erhöht also das Feld des Display-Objekts.',
    },
    {
      codeLine: 7,
      highlight: { il: [17, 18], lowered: [8, 24] },
      state: state({ count: '2', inc: true, get: true, call: 'inc' }),
      changed: [fieldId('dc', 'count')],
      explanation:
        'Der zweite Aufruf arbeitet auf demselben Feld weiter. Der Zustand lebt im Display-Objekt, nicht im Delegate und nicht in der Lambda.',
    },
    {
      codeLine: 8,
      highlight: { il: [19, 20, 21], lowered: [25] },
      state: state({ count: '10', inc: true, get: true }),
      changed: [fieldId('dc', 'count')],
      explanation:
        'Häufige Fehlannahme: Die Lambda habe beim Erzeugen eine Kopie von `count` mitgenommen. Es gibt aber nur **eine** Variable, das Feld im Display-Objekt. `count = 10` in `Main` schreibt genau dorthin.',
    },
    {
      codeLine: 9,
      highlight: { il: [22, 23, 24], lowered: [13, 26] },
      state: state({ count: '10', inc: true, get: true, call: 'get', output: '10' }),
      changed: ['lambda'],
      explanation:
        '`get()` liest dasselbe Feld und liefert 10, nicht 2 und nicht 0. Display-Objekt und Delegates bleiben am Leben, solange einer der Delegates erreichbar ist.',
    },
  ],
});
