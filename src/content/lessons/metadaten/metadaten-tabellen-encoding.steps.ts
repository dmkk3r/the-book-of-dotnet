import { defineStepScript, type LayoutState } from '@/components/viz';

// IL bytes of Main in a Release build. Opcodes after ECMA-335 Partition III: ldstr 0x72,
// call 0x28, ret 0x2A. Tokens are stored as 4-byte little-endian values, so the row part comes
// first and the table byte last.
// TODO(verify): Token values 0x70000001 (first user string at #US offset 1),
// 0x0A00000C (example MemberRef row) and 0x06000002 (Helper as second MethodDef row) with ILSpy
// or the verify sample; a Debug build adds nop instructions and changes the offsets.

const il: LayoutState = {
  title: 'IL von Main, 16 Byte',
  totalSize: 16,
  parts: [
    { id: 'op-ldstr', name: '72 ldstr', type: 'Opcode', offset: 0, size: 1, kind: 'field' },
    {
      id: 'us-row',
      name: '01 00 00 (Offset 1)',
      type: 'Token, untere 3 Byte',
      offset: 1,
      size: 3,
      kind: 'field',
    },
    {
      id: 'us-tab',
      name: '70 (#US)',
      type: 'Token, oberstes Byte',
      offset: 4,
      size: 1,
      kind: 'field',
    },
    { id: 'op-call1', name: '28 call', type: 'Opcode', offset: 5, size: 1, kind: 'field' },
    {
      id: 'mr-row',
      name: '0C 00 00 (Zeile 12)',
      type: 'Token, untere 3 Byte',
      offset: 6,
      size: 3,
      kind: 'field',
    },
    {
      id: 'mr-tab',
      name: '0A (MemberRef)',
      type: 'Token, oberstes Byte',
      offset: 9,
      size: 1,
      kind: 'field',
    },
    { id: 'op-call2', name: '28 call', type: 'Opcode', offset: 10, size: 1, kind: 'field' },
    {
      id: 'md-row',
      name: '02 00 00 (Zeile 2)',
      type: 'Token, untere 3 Byte',
      offset: 11,
      size: 3,
      kind: 'field',
    },
    {
      id: 'md-tab',
      name: '06 (MethodDef)',
      type: 'Token, oberstes Byte',
      offset: 14,
      size: 1,
      kind: 'field',
    },
    { id: 'op-ret', name: '2A ret', type: 'Opcode', offset: 15, size: 1, kind: 'field' },
  ],
  note: 'Drei Instruktionen mit Token, je ein Byte Opcode und vier Byte Token in Little Endian.',
};

export default defineStepScript({
  view: 'layout',
  layout: 'stacked',
  title: 'Tokens im IL-Strom',
  code: {
    cs: `static void Main()
{
    Console.WriteLine("Hallo");
    Helper();
}`,
    il: `IL_0000: ldstr "Hallo"   // 72 01000070
IL_0005: call  WriteLine // 28 0C00000A
IL_000a: call  Helper    // 28 02000006
IL_000f: ret             // 2A`,
  },
  steps: [
    {
      codeLine: 3,
      highlight: { il: [1] },
      state: il,
      changed: ['op-ldstr'],
      explanation:
        'Das String-Literal `"Hallo"` steht nicht im IL. `ldstr` hat den Opcode **0x72** und als Operand ein Token, wie fast jede Instruktion, die sich auf etwas außerhalb des Methodenrumpfs bezieht.',
    },
    {
      codeLine: 3,
      highlight: { il: [1] },
      state: il,
      changed: ['us-row', 'us-tab'],
      explanation:
        'Das Token wird in **Little Endian** gespeichert, das oberste Byte steht also zuletzt. Die Kennung **0x70** ist keine Tabelle, sondern bedeutet „User String“. Die unteren drei Byte sind hier keine Zeile, sondern ein Byte-Offset in den Heap `#US`.',
    },
    {
      codeLine: 3,
      highlight: { il: [2] },
      state: il,
      changed: ['op-call1', 'mr-row', 'mr-tab'],
      explanation:
        '`call` mit **0x0A**: ein Verweis auf eine MemberRef-Zeile, weil `WriteLine` in einer anderen Assembly definiert ist. Der Aufruf ist im Rumpf genau fünf Byte lang, egal wie lang der Methodenname ist.',
    },
    {
      codeLine: 4,
      highlight: { il: [3] },
      state: il,
      changed: ['op-call2', 'md-row', 'md-tab'],
      explanation:
        'Derselbe Opcode, aber ein Token mit **0x06**: eine Zeile der eigenen Tabelle MethodDef. Am obersten Byte erkennt die Runtime sofort, ob sie im eigenen Modul nachschlagen kann oder einen Verweis auflösen muss.',
    },
    {
      codeLine: 5,
      highlight: { il: [4] },
      state: il,
      changed: ['op-ret'],
      explanation:
        '`ret` braucht keinen Operanden. Instruktionen wie `ldarg.0`, `add` oder `ret` arbeiten nur mit dem Evaluation Stack, Tokens tragen nur Instruktionen, die Typen, Felder, Methoden, Signaturen oder Strings benennen.',
    },
  ],
});
