import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.
// TODO(verify): Box size (24 B on x64) with BenchmarkDotNet; IL for a Release build in SharpLab.

const A1 = '0x7F3A0210';
const A2 = '0x7F3A0228';
type Obj = MemoryState['heap'][number];
const box = (id: 'box1' | 'box2', address: string, value: string): Obj => ({
  id,
  type: 'Int32 (geboxt)',
  address,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ Int32' },
    { name: 'Wert', value },
  ],
  sizeBytes: 24,
});

type Slot = MemoryState['frames'][number]['slots'][number];
const intSlot = (id: string, value: string): Slot => ({
  id,
  name: id,
  type: 'int (4 Byte)',
  value,
});
const refSlot = (id: string, target: 'box1' | 'box2' | null): Slot => ({
  id,
  name: id,
  type: 'object (Verweis, 8 Byte)',
  value: target === null ? 'null' : target === 'box1' ? A1 : A2,
  ...(target ? { ref: target } : {}),
});
const state = (x: string, o: boolean, y: string, o2: boolean, output?: string): MemoryState => ({
  frames: [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        intSlot('x', x),
        refSlot('o', o ? 'box1' : null),
        intSlot('y', y),
        refSlot('o2', o2 ? 'box2' : null),
      ],
    },
  ],
  heap: [...(o ? [box('box1', A1, '42')] : []), ...(o2 ? [box('box2', A2, '42')] : [])],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  title: 'Boxing und Unboxing Schritt für Schritt',
  code: {
    cs: `int x = 42;
object o = x;          // Boxing
x = 7;
int y = (int)o;        // Unboxing
object o2 = y;         // noch eine Box
Console.WriteLine(o == o2);
Console.WriteLine(o.Equals(o2));`,
    il: `ldc.i4.s   42
stloc.0
ldloc.0
box        [System.Runtime]System.Int32
stloc.1
ldc.i4.7
stloc.0
ldloc.1
unbox.any  [System.Runtime]System.Int32
stloc.2
ldloc.2
box        [System.Runtime]System.Int32
stloc.3
ldloc.1
ldloc.3
ceq
call       void [System.Console]System.Console::WriteLine(bool)
ldloc.1
ldloc.3
callvirt   instance bool [System.Runtime]System.Object::Equals(object)
call       void [System.Console]System.Console::WriteLine(bool)`,
  },
  steps: [
    {
      state: state('0', false, '0', false),
      explanation:
        'Vier lokale Variablen, alle im Stack-Frame: zwei `int` und zwei `object`. Der Heap ist leer. Die `object`-Variablen enthalten noch `null`, also keinen Verweis.',
    },
    {
      codeLine: 1,
      highlight: { il: [1, 2] },
      state: state('42', false, '0', false),
      changed: ['x'],
      explanation:
        '`x = 42` legt die Zahl direkt in den Slot von `x`. Ein `int` ist ein Werttyp: Der Slot *ist* der Wert.',
    },
    {
      codeLine: 2,
      highlight: { il: [3, 4, 5] },
      state: state('42', true, '0', false),
      changed: ['o', 'box1'],
      explanation:
        'Eine `object`-Variable kann nur einen Verweis auf ein Heap-Objekt enthalten. Die IL-Instruktion `box` legt deshalb ein neues Objekt an, **kopiert** die 42 hinein und liefert seine Adresse. Das Objekt trägt die MethodTable von `Int32`, damit die Runtime weiß, was darin steckt.',
    },
    {
      codeLine: 3,
      highlight: { il: [6, 7] },
      state: state('7', true, '0', false),
      changed: ['x'],
      explanation:
        '`x = 7` ändert nur den Slot von `x`. Die Box enthält eine **unabhängige Kopie** und bleibt bei 42. Zwischen `x` und der Box besteht keinerlei Verbindung mehr.',
    },
    {
      codeLine: 4,
      highlight: { il: [8, 9, 10] },
      state: state('7', true, '42', false),
      changed: ['y'],
      explanation:
        '`unbox.any` prüft zuerst, ob die Box wirklich einen `Int32` enthält. Wäre `o` null, gäbe es eine `NullReferenceException`, bei einem anderen Typ eine `InvalidCastException`. Erst danach wird der Wert auf den Stack **kopiert**. Unboxing alloziert nichts.',
    },
    {
      codeLine: 5,
      highlight: { il: [11, 12, 13] },
      state: state('7', true, '42', true),
      changed: ['o2', 'box2'],
      explanation:
        'Jedes Boxing erzeugt ein **neues** Objekt, auch wenn der Wert derselbe ist. Jetzt gibt es zwei Boxen mit der 42 an verschiedenen Adressen.',
    },
    {
      codeLine: 6,
      highlight: { il: [14, 15, 16, 17] },
      state: state('7', true, '42', true, 'False'),
      changed: ['o', 'o2'],
      explanation:
        'Häufige Falle: `==` auf zwei `object`-Variablen vergleicht **Verweise**, nicht Inhalte. Es sind zwei verschiedene Boxen, also `False`, obwohl beide 42 enthalten.',
    },
    {
      codeLine: 7,
      highlight: { il: [18, 19, 20, 21] },
      state: state('7', true, '42', true, 'False\nTrue'),
      explanation:
        '`Equals` ist virtuell und landet in `Int32.Equals(object)`, das die Werte vergleicht: `True`. Beide Boxen bleiben auf dem Heap, bis sie nicht mehr erreichbar sind und ein Gen0-GC sie einsammelt.',
    },
  ],
});
