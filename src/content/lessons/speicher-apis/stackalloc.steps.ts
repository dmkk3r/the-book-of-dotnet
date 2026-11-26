import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps. Stack addresses start with 0x7FFE,
// heap addresses with 0x7F3A.
// TODO(verify): Size of char[8] on x64 (24 B array header + 16 B data = 40 B) with
// BenchmarkDotNet MemoryDiagnoser, and that the IL shown (constant folded size 16, conv.u,
// localloc, Span ctor) matches a Release build in SharpLab.

type Frame = MemoryState['frames'][number];
type Slot = Frame['slots'][number];
type Obj = MemoryState['heap'][number];

const STACK_BUF = '0x7FFEF8A0';
const HEAP_ARR = '0x7F3A1040';

const main: Frame = {
  id: 'main',
  method: 'Main()',
  slots: [{ id: 'n', name: 'n', type: 'int', value: '1234' }],
};

/** Frame of WriteHex; `region` is the stackalloc block inside the frame, if any. */
const writeHex = (buf: string, written: string, region?: string): Frame => ({
  id: 'hex',
  method: 'WriteHex(int value)',
  slots: [
    { id: 'value', name: 'value', type: 'int', value: '1234' },
    { id: 'buf', name: 'buf', type: 'Span<char> (16 Byte)', value: buf },
    { id: 'written', name: 'written', type: 'int', value: written },
    ...(region !== undefined
      ? [
          {
            id: 'region',
            name: 'stackalloc-Block',
            type: `char[8] im Frame, ab ${STACK_BUF} (16 Byte)`,
            value: region,
          } satisfies Slot,
        ]
      : []),
  ],
});

const writeHexHeap = (written: string): Frame => ({
  id: 'hexheap',
  method: 'WriteHexHeap(int value)',
  slots: [
    { id: 'value2', name: 'value', type: 'int', value: '1234' },
    {
      id: 'buf2',
      name: 'buf',
      type: 'char[] (Verweis, 8 Byte)',
      value: HEAP_ARR,
      ref: 'arr',
    },
    { id: 'written2', name: 'written', type: 'int', value: written },
  ],
});

const arr = (content: string): Obj => ({
  id: 'arr',
  type: 'char[8]',
  address: HEAP_ARR,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ char[]' },
    { name: 'Length', value: '8' },
    { name: 'Elemente', value: content },
  ],
  sizeBytes: 40,
});

const ZERO = "'\\0' × 8";
const FILLED = "'4' 'D' '2' '\\0' '\\0' '\\0' '\\0' '\\0'";

export default defineStepScript({
  view: 'memory',
  title: 'stackalloc gegen new Schritt für Schritt',
  code: {
    cs: `static void Main()
{
    int n = 1234;
    WriteHex(n);
    WriteHexHeap(n);
}

static void WriteHex(int value)
{
    Span<char> buf = stackalloc char[8];
    value.TryFormat(buf, out int written, "X");
    Console.Out.Write(buf[..written]);
}   // Frame weg, Puffer weg

static void WriteHexHeap(int value)
{
    char[] buf = new char[8];
    value.TryFormat(buf, out int written, "X");
    Console.Out.Write(buf.AsSpan(0, written));
}   // Array bleibt bis zum nächsten GC liegen`,
    il: `// WriteHex, gekürzt
.locals init (valuetype System.Span\`1<char> buf, int32 written)
ldc.i4.s   16
conv.u
localloc
ldc.i4.8
newobj     instance void valuetype System.Span\`1<char>::.ctor(void*, int32)
stloc.0`,
  },
  steps: [
    {
      codeLine: 4,
      state: { frames: [main], heap: [] },
      changed: ['n'],
      explanation:
        '`Main` hat einen Frame mit einer lokalen Variable. Gleich ruft es `WriteHex` auf, das eine Zahl hexadezimal ausgibt und dafür einen kleinen Zwischenpuffer braucht.',
    },
    {
      codeLine: 8,
      state: { frames: [main, writeHex('leer (default)', '0')], heap: [] },
      changed: ['hex', 'value', 'buf', 'written'],
      explanation:
        'Der Aufruf legt den Frame von `WriteHex` an. Seine Größe für die festen Locals steht schon beim Kompilieren fest: `value`, `written` und der `Span` selbst, der nur aus einem Zeiger und einer Länge besteht.',
    },
    {
      codeLine: 10,
      highlight: { il: [3, 4, 5, 6, 7, 8] },
      state: {
        frames: [main, writeHex(`→ ${STACK_BUF}, Länge 8`, '0', ZERO)],
        heap: [],
      },
      changed: ['region', 'buf'],
      explanation:
        '`stackalloc` wird zur IL-Instruktion `localloc`: Der Stackzeiger rückt um 16 Byte weiter, der Frame wächst. Der `Span` zeigt jetzt mitten in den eigenen Frame, der GC erfährt davon nie. Die Nullen stehen nur da, weil der Compiler die Methode mit `.locals init` markiert hat.',
    },
    {
      codeLine: 11,
      state: {
        frames: [main, writeHex(`→ ${STACK_BUF}, Länge 8`, '3', FILLED)],
        heap: [],
      },
      changed: ['region', 'written'],
      explanation:
        '`TryFormat` schreibt über den `Span` direkt in den Block: drei Zeichen für `4D2`. Jeder Zugriff über den `Span` ist bereichsgeprüft, ein Schreiben hinter Index 7 würde eine Exception auslösen, statt den Frame zu zerstören.',
    },
    {
      codeLine: 13,
      state: { frames: [main], heap: [], output: '4D2' },
      changed: ['main'],
      explanation:
        'Beim Rücksprung wird der Stackzeiger zurückgesetzt, und mit dem Frame verschwindet auch der Block. Es gibt kein `free`, keinen Destruktor und keine Arbeit für den GC. Freigeben kostet praktisch nichts.',
    },
    {
      codeLine: 17,
      state: {
        frames: [main, writeHexHeap('0')],
        heap: [arr(ZERO)],
        output: '4D2',
      },
      changed: ['hexheap', 'buf2', 'arr'],
      explanation:
        'Zum Vergleich die Heap-Variante: `new char[8]` legt ein vollwertiges Objekt in Gen0 an, mit Header, MethodTable-Zeiger und Längenfeld. Aus 16 Byte Nutzdaten werden 40 Byte, und `new` garantiert genullten Speicher.',
    },
    {
      codeLine: 20,
      state: { frames: [main], heap: [arr(FILLED)], output: '4D2\n4D2' },
      changed: ['arr'],
      explanation:
        'Nach dem Rücksprung ist das Array unerreichbar, liegt aber weiter im Heap. Erst die nächste Gen0-Collection gibt den Platz frei. Einzeln ist das billig, millionenfach pro Sekunde wird es zu GC-Druck.',
    },
  ],
});
