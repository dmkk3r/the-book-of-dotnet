import { defineStepScript, type LayoutState } from '@/components/viz';

// Method header formats after ECMA-335 Partition II, 25.4.2 (tiny) and 25.4.3 (fat).
// Tiny: one byte, low two bits 0x2, upper six bits code size; allowed if code < 64 bytes,
// max stack <= 8, no locals, no exception handlers. Fat: 12 bytes, 4-byte aligned.
// TODO(verify): IL bytes of Add in a Release build (02 03 58 2A), tiny header 0x12,
// fat flags FatFormat | InitLocals (0x3013 little-endian as 13 30) for Sum, and the
// LocalVarSigTok value 0x11000001 (example: first StandAloneSig row), with ILSpy or
// System.Reflection.Metadata (MethodBodyBlock).

const tiny: LayoutState = {
  title: 'Methodenrumpf von Add (Tiny-Format)',
  totalSize: 5,
  parts: [
    {
      id: 't-hdr',
      name: 'Tiny Header 0x12',
      type: 'Größe 4, Format 0x2',
      offset: 0,
      size: 1,
      kind: 'field',
    },
    { id: 't-0', name: '02 ldarg.0', type: 'IL', offset: 1, size: 1, kind: 'field' },
    { id: 't-1', name: '03 ldarg.1', type: 'IL', offset: 2, size: 1, kind: 'field' },
    { id: 't-2', name: '58 add', type: 'IL', offset: 3, size: 1, kind: 'field' },
    { id: 't-3', name: '2A ret', type: 'IL', offset: 4, size: 1, kind: 'field' },
  ],
  note: 'Fünf Byte insgesamt: ein Byte Header, vier Byte IL.',
};

const fat: LayoutState = {
  title: 'Fat Header von Sum (12 Byte, danach folgt das IL)',
  totalSize: 12,
  parts: [
    {
      id: 'f-flags',
      name: 'Flags und Headergröße',
      type: '12 + 4 Bit',
      offset: 0,
      size: 2,
      kind: 'field',
    },
    { id: 'f-stack', name: 'MaxStack', type: 'uint16', offset: 2, size: 2, kind: 'field' },
    { id: 'f-size', name: 'CodeSize', type: 'uint32', offset: 4, size: 4, kind: 'field' },
    { id: 'f-locals', name: 'LocalVarSigTok', type: 'Token', offset: 8, size: 4, kind: 'field' },
  ],
  note: 'Der Fat Header beginnt immer an einer durch 4 teilbaren Adresse.',
};

export default defineStepScript({
  view: 'layout',
  layout: 'stacked',
  title: 'Tiny und Fat Header im Vergleich',
  code: {
    cs: `public static int Add(int a, int b) => a + b;

public static int Sum(int[] values)
{
    int sum = 0;
    foreach (var v in values) sum += v;
    return sum;
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: tiny,
      changed: ['t-hdr'],
      explanation:
        'Das erste Byte ist der **Tiny Header**. Die unteren zwei Bits (`10` binär) kennzeichnen das Format, die oberen sechs Bits die Länge des IL, hier 4. Mehr braucht eine Methode ohne lokale Variablen und ohne `try` nicht.',
    },
    {
      codeLine: 1,
      state: tiny,
      changed: ['t-0', 't-1', 't-2', 't-3'],
      explanation:
        'Direkt dahinter stehen die IL-Instruktionen, jede hier genau ein Byte lang. Weil das Tiny-Format keinen Platz für `MaxStack` hat, gilt implizit ein Stack von höchstens 8 Einträgen.',
    },
    {
      codeLine: 5,
      state: fat,
      changed: ['f-flags'],
      explanation:
        '`Sum` hat lokale Variablen, also reicht das Tiny-Format nicht. Der **Fat Header** beginnt mit Flags (Format `0x3`, dazu etwa `InitLocals`) und seiner eigenen Größe in 4-Byte-Einheiten, hier 3.',
    },
    {
      codeLine: 6,
      state: fat,
      changed: ['f-stack', 'f-size'],
      explanation:
        '**MaxStack** sagt dem JIT und dem Verifier, wie tief der Evaluation Stack höchstens wird. **CodeSize** ist die Länge des IL in Byte, das direkt nach dem Header folgt.',
    },
    {
      codeLine: 5,
      state: fat,
      changed: ['f-locals'],
      explanation:
        'Die lokalen Variablen stehen nicht im Methodenrumpf. **LocalVarSigTok** ist ein Token auf eine Zeile der Tabelle StandAloneSig, deren Signatur im `#Blob`-Heap die Typen aller Locals beschreibt.',
    },
    {
      codeLine: 6,
      state: {
        ...fat,
        note: 'Hat die Methode try, catch oder finally, setzt der Header das Flag MoreSects. Hinter dem IL folgen dann, auf 4 Byte ausgerichtet, die Ausnahmeabschnitte.',
      },
      changed: ['f-flags'],
      explanation:
        'Ausnahmeblöcke stehen ebenfalls nicht im IL, sondern in eigenen Abschnitten hinter dem Code. Ein `foreach` über ein Array erzeugt keinen `try/finally`, ein `foreach` über eine `List<T>` dagegen schon, weil der Enumerator entsorgt werden muss.',
    },
  ],
});
