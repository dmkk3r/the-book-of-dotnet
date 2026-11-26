import { defineStepScript, type MemoryState } from '@/components/viz';

// One allocation site, first on the heap, then stack allocated, then promoted into registers.
// Addresses and frame offsets are fictional but consistent across steps.
// Sizes: a heap object with two int fields is 24 B on x64 (8 B header, 8 B MethodTable pointer,
// 2 x 4 B fields). A stack allocated object has no header: the JIT asks the runtime for
// getHeapClassSize, which is "GetNumInstanceFieldBytes() + OBJECT_SIZE" (MethodTable pointer plus
// fields, src/coreclr/vm/jitinterface.cpp), here 16 B.
// TODO(verify): Complete asm listing (Windows x64, .NET 10, FullOpts) for both variants, in
// particular register allocation and whether the heap variant keeps the reload of X and Y.
// TODO(verify): That the promoted variant reduces to exactly imul/imul/lea/ret.

type Slot = MemoryState['frames'][number]['slots'][number];
type Obj = MemoryState['heap'][number];

const HEAP = '0x7F3A0210';

const args: Slot[] = [
  { id: 'x', name: 'x', type: 'int (Argument)', value: '3' },
  { id: 'y', name: 'y', type: 'int (Argument)', value: '4' },
];

const heapPoint = (x: string, y: string): Obj => ({
  id: 'point',
  type: 'Point',
  address: HEAP,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ Point' },
    { name: 'X', value: x },
    { name: 'Y', value: y },
  ],
  sizeBytes: 24,
});

const frame = (slots: Slot[]): MemoryState['frames'][number] => ({
  id: 'ls',
  method: 'LengthSquared(3, 4)',
  slots: [...args, ...slots],
});

const pRef = (target: 'heap' | 'stack' | null): Slot => ({
  id: 'p',
  name: 'p',
  type: target === 'stack' ? 'Point (zeigt in den Frame)' : 'Point (Verweis, 8 Byte)',
  value: target === 'heap' ? HEAP : target === 'stack' ? 'rsp+0x20 (Frame)' : 'null',
  ...(target === 'heap' ? { ref: 'point' } : {}),
});

const stackObject: Slot[] = [
  { id: 's-mt', name: '[rsp+0x20] MethodTable', type: 'Zeiger, 8 Byte', value: '→ Point' },
  { id: 's-x', name: '[rsp+0x28] X', type: 'int', value: '3' },
  { id: 's-y', name: '[rsp+0x2C] Y', type: 'int', value: '4' },
];

export default defineStepScript({
  view: 'memory',
  title: 'Ein Objekt wandert vom Heap in den Frame und in Register',
  code: {
    cs: `sealed class Point
{
    public int X, Y;
    public Point(int x, int y) { X = x; Y = y; }
}

static int LengthSquared(int x, int y)
{
    var p = new Point(x, y);
    return p.X * p.X + p.Y * p.Y;
}`,
    asm: `; Variante A: ohne Stack-Allokation (Windows x64)
push     rsi
push     rbx
sub      rsp, 40
mov      ebx, ecx
mov      esi, edx
mov      rcx, 0x7FF8A1B2C3D0      ; Point
call     CORINFO_HELP_NEWSFAST
mov      dword ptr [rax+0x08], ebx
mov      dword ptr [rax+0x0C], esi
mov      ecx, dword ptr [rax+0x08]
imul     ecx, ecx
mov      eax, dword ptr [rax+0x0C]
imul     eax, eax
add      eax, ecx
add      rsp, 40
pop      rbx
pop      rsi
ret

; Variante B: Escape Analysis und Promotion
imul     ecx, ecx
imul     edx, edx
lea      eax, [rcx+rdx]
ret`,
  },
  steps: [
    {
      codeLine: 7,
      state: { frames: [frame([pRef(null)])], heap: [] },
      explanation:
        '`LengthSquared` beginnt. Die Argumente `x` und `y` liegen in Registern oder im Frame, `p` ist noch leer. Wir sehen uns zuerst an, was ohne Escape Analysis passiert, so wie in Tier 0 oder mit abgeschalteter Optimierung.',
    },
    {
      codeLine: 9,
      highlight: { asm: [7, 8] },
      state: { frames: [frame([pRef('heap')])], heap: [heapPoint('0', '0')] },
      changed: ['p', 'point'],
      explanation:
        '`new Point` ruft den Allokations-Helfer der Runtime auf. Er schiebt im Allocation Context den Zeiger um 24 Byte weiter und liefert ein genulltes Objekt mit Header und MethodTable-Zeiger. `p` enthält jetzt einen echten Heap-Verweis.',
    },
    {
      codeLine: 4,
      highlight: { asm: [9, 10] },
      state: { frames: [frame([pRef('heap')])], heap: [heapPoint('3', '4')] },
      changed: ['point.X', 'point.Y'],
      explanation:
        'Der Konstruktor schreibt `X` und `Y`. Im optimierten Code ist er eingebettet, deshalb stehen die beiden Schreibzugriffe direkt in `LengthSquared`.',
    },
    {
      codeLine: 10,
      highlight: { asm: [11, 12, 13, 14, 15] },
      state: {
        frames: [frame([pRef('heap')])],
        heap: [heapPoint('3', '4')],
        output: '25',
      },
      explanation:
        'Die Methode liest beide Felder und liefert 25. Danach ist das Objekt Müll: Niemand verweist mehr darauf, trotzdem belegt es Platz in Gen0, bis der nächste GC es einsammelt. Bei Millionen Aufrufen sind das Millionen solcher Objekte.',
    },
    {
      codeLine: 9,
      state: { frames: [frame([pRef('stack'), ...stackObject])], heap: [] },
      changed: ['p', 's-mt', 's-x', 's-y'],
      explanation:
        'Jetzt mit Escape Analysis: Der JIT hat bewiesen, dass `p` die Methode nie verlässt. Er ersetzt die Allokation durch einen Bereich im Frame, schreibt dort den MethodTable-Zeiger hinein und lässt `p` auf diesen Bereich zeigen. Ein Object Header fehlt, der Heap bleibt leer.',
    },
    {
      codeLine: 10,
      highlight: { asm: [22, 23, 24, 25] },
      state: {
        frames: [
          frame([
            { id: 'r-x', name: 'X (in ecx)', type: 'int, Register', value: '3' },
            { id: 'r-y', name: 'Y (in edx)', type: 'int, Register', value: '4' },
          ]),
        ],
        heap: [],
        output: '25',
      },
      changed: ['r-x', 'r-y'],
      explanation:
        'Das Stack-Objekt ist nur ein Zwischenzustand im JIT. Weil niemand seine Adresse oder seinen MethodTable-Zeiger braucht, zerlegt die Promotion es in zwei einzelne Werte, die in Registern bleiben. Vom Objekt ist im Maschinencode nichts mehr übrig.',
    },
    {
      codeLine: 4,
      state: { frames: [frame([pRef('heap')])], heap: [heapPoint('3', '4')] },
      changed: ['p', 'point'],
      explanation:
        'Häufige Fehlannahme: Kurzlebig heißt nicht automatisch Stack. Trüge der Konstruktor `NoInlining`, ginge `p` als `this` an eine Methode, die der JIT nicht sieht. Er muss annehmen, dass sie sich den Verweis merkt, und alloziert wieder auf dem Heap.',
    },
  ],
});
