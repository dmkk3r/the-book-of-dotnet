import { defineStepScript, type MemoryState } from '@/components/viz';

// Example and both asm listings from "What's new in .NET 10 runtime" (Microsoft Learn, section
// "Escape analysis > Delegates"), Linux x64, abbreviated: prolog and epilog omitted there,
// loop and comments shortened here. Addresses in the listings are the ones from the docs.
// Object sizes on x64: closure with one int field 24 B; int[100] 16 B + 400 B = 416 B on the
// stack (no header, see escape-analysis.steps.ts), 424 B on the heap; Func<int, int> 64 B.
// TODO(verify): Func<int, int> instance size 64 B on x64 (Delegate fields _target, _methodBase,
// _methodPtr, _methodPtrAux, plus MulticastDelegate _invocationList, _invocationCount).
// TODO(verify): Why the closure still escapes in .NET 10 (it is the target argument of the
// indirect call to the lambda body, which is not inlined); the docs only say that stack
// allocation of closures is planned for a future release.
// Frame offsets and the heap addresses below are fictional.

type Slot = MemoryState['frames'][number]['slots'][number];
type Obj = MemoryState['heap'][number];

const C_ADDR = '0x7F3A0400';
const A_ADDR = '0x7F3A0418';
const F_ADDR = '0x7F3A05C0';

const closure: Obj = {
  id: 'closure',
  type: '<>c__DisplayClass0_0',
  address: C_ADDR,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ DisplayClass' },
    { name: 'local', value: '1' },
  ],
  sizeBytes: 24,
};

const heapArray: Obj = {
  id: 'arr-heap',
  type: 'int[100]',
  address: A_ADDR,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ int[]' },
    { name: 'Length', value: '100' },
    { name: '[0] bis [99]', value: '0' },
  ],
  sizeBytes: 424,
};

const heapFunc: Obj = {
  id: 'func-heap',
  type: 'Func<int, int>',
  address: F_ADDR,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ Func<int, int>' },
    { name: '_target', value: C_ADDR, ref: 'closure' },
    { name: '_methodPtr', value: '→ <Main>b__0' },
  ],
  sizeBytes: 64,
};

const sum = (v: string): Slot => ({ id: 'sum', name: 'sum', type: 'int', value: v });

const net9: MemoryState = {
  frames: [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        { id: 'closure-ref', name: 'Closure', type: 'Verweis', value: C_ADDR, ref: 'closure' },
        { id: 'arr', name: 'arr', type: 'int[] (Verweis)', value: A_ADDR, ref: 'arr-heap' },
        {
          id: 'func',
          name: 'func',
          type: 'Func<int, int> (Verweis)',
          value: F_ADDR,
          ref: 'func-heap',
        },
        sum('0'),
      ],
    },
  ],
  heap: [closure, heapArray, heapFunc],
};

const stackArray: Slot[] = [
  { id: 'arr', name: 'arr', type: 'int[] (zeigt in den Frame)', value: 'rbp-0x1C0' },
  { id: 'a-mt', name: '[rbp-0x1C0] MethodTable', type: 'Zeiger, 8 Byte', value: '→ int[]' },
  { id: 'a-len', name: '[rbp-0x1B8] Length', type: 'int', value: '100' },
  { id: 'a-data', name: '[rbp-0x1B0] Elemente', type: '400 Byte', value: 'alle 0' },
];

export default defineStepScript({
  view: 'memory',
  title: 'Delegate und Array im Frame, Closure auf dem Heap',
  code: {
    cs: `public static int Main()
{
    int local = 1;
    int[] arr = new int[100];
    var func = (int x) => x + local;
    int sum = 0;

    foreach (int num in arr)
        sum += func(num);

    return sum;
}`,
    asm: `; .NET 9 (Linux x64, gekürzt)
call     CORINFO_HELP_NEWSFAST       ; Closure
mov      dword ptr [rbx+0x08], 1
call     CORINFO_HELP_NEWARR_1_VC    ; int[100]
call     CORINFO_HELP_NEWSFAST       ; Func<int, int>
call     CORINFO_HELP_ASSIGN_REF     ; _target = Closure
mov      qword ptr [r14+0x18], rsi   ; _methodPtr
call     [r14+0x18]System.Func\`2[int,int]:Invoke(int):int:this

; .NET 10 (Linux x64, gekürzt)
call     CORINFO_HELP_NEWSFAST       ; Closure
mov      dword ptr [rbx+0x08], 1
mov      qword ptr [rbp-0x1C0], rsi  ; int[]: MethodTable in den Frame
lea      rsi, [rbp-0x1C0]
mov      dword ptr [rsi+0x08], 100   ; Length
mov      rdi, rbx                    ; Closure als this
mov      rax, 0x7B52F7901638         ; Lambda-Rumpf
call     rax`,
  },
  steps: [
    {
      codeLine: 5,
      highlight: { asm: [2, 3, 4, 5, 6, 7] },
      state: net9,
      changed: ['closure', 'arr-heap', 'func-heap'],
      explanation:
        'So sah es in .NET 9 aus: drei Heap-Objekte. Die Closure trägt die eingefangene Variable `local`, das Array die Daten, der Delegate zeigt mit `_target` auf die Closure und mit `_methodPtr` auf den Lambda-Rumpf.',
    },
    {
      codeLine: 9,
      highlight: { asm: [8] },
      state: net9,
      changed: ['func', 'func-heap._target'],
      explanation:
        'Jeder Schleifendurchlauf ruft `Invoke` indirekt über den gespeicherten Methodenzeiger auf. Für den JIT war dieser Aufruf eine Blackbox, und an ihr hing der Delegate: Was `Invoke` mit `this` tut, konnte er nicht wissen.',
    },
    {
      codeLine: 4,
      highlight: { asm: [13, 14, 15] },
      state: {
        frames: [
          {
            id: 'main',
            method: 'Main()',
            slots: [
              {
                id: 'closure-ref',
                name: 'Closure',
                type: 'Verweis',
                value: C_ADDR,
                ref: 'closure',
              },
              ...stackArray,
              sum('0'),
            ],
          },
        ],
        heap: [closure],
      },
      changed: ['arr', 'a-mt', 'a-len', 'a-data'],
      explanation:
        '.NET 10 legt das Array in den Frame: konstante Länge, Werttyp-Elemente, 416 Byte und damit unter der Grenze, und `foreach` liest es nur. Der Code schreibt MethodTable-Zeiger und Länge selbst, ein Helfer wird nicht mehr gerufen.',
    },
    {
      codeLine: 9,
      highlight: { asm: [16, 17, 18] },
      state: {
        frames: [
          {
            id: 'main',
            method: 'Main()',
            slots: [
              {
                id: 'closure-ref',
                name: 'Closure (in rbx)',
                type: 'Verweis',
                value: C_ADDR,
                ref: 'closure',
              },
              ...stackArray,
              sum('0'),
            ],
          },
        ],
        heap: [closure],
      },
      changed: ['closure-ref'],
      explanation:
        'Der JIT weiß jetzt, dass `Invoke` den Delegate nicht festhält, und er kennt das Ziel. Also ruft er den Lambda-Rumpf direkt auf und übergibt die Closure als `this`. Der Delegate ist erst auf den Stack gewandert und dann ganz verschwunden.',
    },
    {
      codeLine: 5,
      highlight: { asm: [11, 12] },
      state: {
        frames: [
          {
            id: 'main',
            method: 'Main()',
            slots: [
              {
                id: 'closure-ref',
                name: 'Closure (in rbx)',
                type: 'Verweis',
                value: C_ADDR,
                ref: 'closure',
              },
              ...stackArray,
              sum('0'),
            ],
          },
        ],
        heap: [closure],
      },
      changed: ['closure'],
      explanation:
        'Übrig bleibt eine einzige Heap-Allokation: die Closure. Sie geht als Argument an den Lambda-Rumpf, und den bettet der JIT hier nicht ein. Laut .NET-Team soll die Stack-Allokation von Closures in einer späteren Version folgen.',
    },
  ],
});
