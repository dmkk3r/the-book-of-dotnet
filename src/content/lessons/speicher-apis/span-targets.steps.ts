import { defineStepScript, type MemoryState } from '@/components/viz';

// One method, three kinds of memory. Addresses are fictional but consistent: 0x7F3A… GC heap,
// 0x00A1… stack of the main thread, 0x01C4… native memory from NativeMemory.Alloc.
// A string reference points at its MethodTable pointer, the length (int) follows at +8 and the
// first char at +12 on x64 (String._stringLength, String._firstChar in String.CoreCLR.cs).
// TODO(verify): Offset 12 of _firstChar on x64 with SOS !dumpobj or Unsafe.ByteOffset.

const STR = 0x7f3a2000;
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const BUF = '0xA1F7C8';
const NATIVE = '0x1C40000';

type Slot = MemoryState['frames'][number]['slots'][number];
type Frame = MemoryState['frames'][number];

const text: MemoryState['heap'][number] = {
  id: 'str',
  type: 'string',
  address: hex(STR),
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ string' },
    { name: '_stringLength', value: '7' },
    { name: 'Zeichen', value: "'i' 'd' '=' '4' '7' '1' '1'" },
  ],
};

const textSlot: Slot = {
  id: 'text',
  name: 'text',
  type: 'string (Verweis)',
  value: hex(STR),
  ref: 'str',
};
const intSlot = (id: string, value: string): Slot => ({ id, name: id, type: 'int', value });

interface MainParts {
  a?: string;
  buf?: string;
  b?: string;
  p?: 'live' | 'freed';
  n?: string;
}
function main(parts: MainParts): Frame {
  const slots: Slot[] = [textSlot];
  if (parts.a !== undefined) slots.push(intSlot('a', parts.a));
  if (parts.buf !== undefined) {
    slots.push({
      id: 'puffer',
      name: '(stackalloc-Puffer)',
      type: 'char[3] im Frame, 6 Byte',
      value: `${parts.buf}  (Adresse ${BUF})`,
    });
    slots.push({
      id: 'buf',
      name: 'buf',
      type: 'Span<char>',
      value: `_reference = ${BUF} (→ Puffer in diesem Frame), _length = 3`,
    });
  }
  if (parts.b !== undefined) slots.push(intSlot('b', parts.b));
  if (parts.p) {
    slots.push({
      id: 'p',
      name: 'p',
      type: 'char* (Zeiger)',
      value:
        parts.p === 'live'
          ? `${NATIVE} (nativer Speicher: '4' '2')`
          : `${NATIVE} (freigegeben, ungültig)`,
    });
  }
  if (parts.n !== undefined) slots.push(intSlot('n', parts.n));
  return { id: 'main', method: 'Main()', slots };
}

const sum = (value: string, ref?: 'str'): Frame => ({
  id: 'sum',
  method: 'Sum(ReadOnlySpan<char> digits)',
  slots: [
    {
      id: 'digits',
      name: 'digits',
      type: 'ReadOnlySpan<char>',
      value,
      ...(ref ? { ref } : {}),
    },
  ],
});

const st = (frames: Frame[], output?: string): MemoryState => ({
  frames,
  heap: [text],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  title: 'Eine Methode, drei Arten von Speicher',
  code: {
    cs: `static int Sum(ReadOnlySpan<char> digits)
{
    int s = 0;
    foreach (char c in digits) s += c - '0';
    return s;
}

string text = "id=4711";
int a = Sum(text.AsSpan(3));             // in einen String
Span<char> buf = stackalloc char[3];     // in den eigenen Frame
"123".AsSpan().CopyTo(buf);
int b = Sum(buf);
char* p = (char*)NativeMemory.Alloc(2, sizeof(char)); // unsafe
p[0] = '4'; p[1] = '2';
int n = Sum(new ReadOnlySpan<char>(p, 2)); // in nativen Speicher
NativeMemory.Free(p);`,
  },
  steps: [
    {
      codeLine: 8,
      state: st([main({})]),
      changed: ['text', 'str'],
      explanation:
        'Ein String ist ein Heap-Objekt: Header, MethodTable, Länge und direkt dahinter die Zeichen als UTF-16. Gesucht ist die Ziffernsumme von „4711“, ohne dafür einen Teilstring anzulegen.',
    },
    {
      codeLine: 9,
      state: st([
        main({}),
        sum(`_reference = ${hex(STR + 12 + 6)} (→ text[3]), _length = 4`, 'str'),
      ]),
      changed: ['digits'],
      explanation:
        '`AsSpan(3)` liefert einen `ReadOnlySpan<char>`, dessen Verweis auf das vierte Zeichen **im String-Objekt** zeigt. `Sum` bekommt nur diese 16 Byte als Argument. `Substring(3)` hätte dagegen einen neuen String alloziert und vier Zeichen kopiert.',
    },
    {
      codeLine: 10,
      state: st([main({ a: '13', buf: "'\\0' '\\0' '\\0'" })]),
      changed: ['a', 'puffer', 'buf'],
      explanation:
        '`stackalloc` reserviert 6 Byte **im Frame von Main**. Weil das Ergebnis direkt einem `Span<char>` zugewiesen wird, braucht es kein `unsafe`. Der Span zeigt auf eine Stack-Adresse, auf dem Heap ändert sich nichts.',
    },
    {
      codeLine: 11,
      state: st([main({ a: '13', buf: "'1' '2' '3'" })]),
      changed: ['puffer'],
      explanation:
        '`CopyTo` schreibt durch den Span in den Puffer. Der Code von `CopyTo` weiß nicht und muss nicht wissen, dass das Ziel auf dem Stack liegt.',
    },
    {
      codeLine: 12,
      state: st([
        main({ a: '13', buf: "'1' '2' '3'" }),
        sum(`_reference = ${BUF} (→ Puffer im Frame von Main), _length = 3`),
      ]),
      changed: ['digits'],
      explanation:
        'Derselbe Maschinencode von `Sum` läuft jetzt über Stack-Speicher des Aufrufers. Für `Sum` sieht der Span genauso aus wie eben: ein Verweis und eine Länge.',
    },
    {
      codeLine: 13,
      state: st([main({ a: '13', buf: "'1' '2' '3'", b: '6', p: 'live' })]),
      changed: ['b', 'p'],
      explanation:
        '`NativeMemory.Alloc` holt Speicher außerhalb des GC-Heaps, etwa so wie `malloc` in C. Den GC interessiert dieser Bereich nicht, er wird nie verschoben und nie automatisch freigegeben.',
    },
    {
      codeLine: 15,
      state: st([
        main({ a: '13', buf: "'1' '2' '3'", b: '6', p: 'live' }),
        sum(`_reference = ${NATIVE} (→ nativer Speicher), _length = 2`),
      ]),
      changed: ['digits'],
      explanation:
        'Der unsichere Konstruktor `ReadOnlySpan<char>(void*, int)` verpackt Zeiger und Länge. Ab hier ist der Zugriff wieder bounds-geprüft. Ob die Länge 2 zum Speicher passt, kann aber niemand mehr prüfen: Das hast du mit `unsafe` zugesichert.',
    },
    {
      codeLine: 16,
      state: st(
        [main({ a: '13', buf: "'1' '2' '3'", b: '6', p: 'freed', n: '6' })],
        'a = 13, b = 6, n = 6',
      ),
      changed: ['n', 'p'],
      explanation:
        'Nach `Free` zeigt `p` ins Leere. Ein Span, der diesen Punkt überlebt, würde das auch tun. Bei nativem Speicher liegt die Lebensdauer allein in deiner Verantwortung, bei Arrays und Strings sorgt der GC dafür, bei `stackalloc` der Compiler.',
    },
  ],
});
