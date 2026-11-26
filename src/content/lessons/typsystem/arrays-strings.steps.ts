import { defineStepScript, type LayoutState } from '@/components/viz';

// TODO(verify): Array and string layout on x64 (length field incl. padding, null terminator,
// total sizes 40 B, 32 B and 40 B) with BenchmarkDotNet or SOS !dumpobj.

const intArray: LayoutState = {
  title: 'new int[] { 1, 2, 3 }',
  totalSize: 40,
  parts: [
    { id: 'i-hdr', name: 'Header', offset: 0, size: 8, kind: 'header' },
    { id: 'i-mt', name: 'MethodTable int[]', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'i-len', name: 'Length = 3', type: 'int', offset: 16, size: 4, kind: 'field' },
    { id: 'i-lpad', name: 'Padding', offset: 20, size: 4, kind: 'padding' },
    { id: 'i-0', name: '[0] = 1', type: 'int', offset: 24, size: 4, kind: 'field' },
    { id: 'i-1', name: '[1] = 2', type: 'int', offset: 28, size: 4, kind: 'field' },
    { id: 'i-2', name: '[2] = 3', type: 'int', offset: 32, size: 4, kind: 'field' },
    { id: 'i-pad', name: 'Padding', offset: 36, size: 4, kind: 'padding' },
  ],
};

const str: LayoutState = {
  title: 'string "Hi"',
  totalSize: 32,
  parts: [
    { id: 's-hdr', name: 'Header', offset: 0, size: 8, kind: 'header' },
    { id: 's-mt', name: 'MethodTable string', offset: 8, size: 8, kind: 'methodtable' },
    { id: 's-len', name: 'Length = 2', type: 'int', offset: 16, size: 4, kind: 'field' },
    { id: 's-h', name: "'H'", type: 'char', offset: 20, size: 2, kind: 'field' },
    { id: 's-i', name: "'i'", type: 'char', offset: 22, size: 2, kind: 'field' },
    { id: 's-nul', name: "'\\0'", type: 'char', offset: 24, size: 2, kind: 'field' },
    { id: 's-pad', name: 'Padding', offset: 26, size: 6, kind: 'padding' },
  ],
};

const objArray: LayoutState = {
  title: 'new object[2]',
  totalSize: 40,
  parts: [
    { id: 'o-hdr', name: 'Header', offset: 0, size: 8, kind: 'header' },
    { id: 'o-mt', name: 'MethodTable object[]', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'o-len', name: 'Length = 2', type: 'int', offset: 16, size: 4, kind: 'field' },
    { id: 'o-lpad', name: 'Padding', offset: 20, size: 4, kind: 'padding' },
    { id: 'o-0', name: '[0] = null', type: 'object (Verweis)', offset: 24, size: 8, kind: 'field' },
    { id: 'o-1', name: '[1] = null', type: 'object (Verweis)', offset: 32, size: 8, kind: 'field' },
  ],
};

export default defineStepScript({
  view: 'layout',
  title: 'Layout von Arrays und Strings Schritt für Schritt',
  code: {
    cs: `int[]    numbers = { 1, 2, 3 };
string   text    = "Hi";
object[] slots   = new object[2];`,
  },
  steps: [
    {
      codeLine: 1,
      state: intArray,
      changed: ['i-hdr', 'i-mt'],
      explanation:
        'Ein Array ist ein ganz normales Objekt: Es beginnt mit Header und MethodTable-Zeiger. Der Typ `int[]` hat eine eigene MethodTable.',
    },
    {
      codeLine: 1,
      state: intArray,
      changed: ['i-len', 'i-lpad'],
      explanation:
        'Direkt danach steht die **Länge**. Sie liegt im Objekt selbst, deshalb ist `Length` ein einfacher Speicherzugriff. Auf 64-Bit wird danach auf 8 Byte aufgefüllt.',
    },
    {
      codeLine: 1,
      state: intArray,
      changed: ['i-0', 'i-1', 'i-2'],
      explanation:
        'Die Elemente folgen lückenlos hintereinander. Ein Index wird so zu einer einfachen Rechnung: Startadresse plus Index mal Elementgröße.',
    },
    {
      codeLine: 2,
      state: str,
      changed: ['s-len', 's-h', 's-i', 's-nul'],
      explanation:
        'Ein `string` speichert seine Länge und die Zeichen als UTF-16 direkt im Objekt, kein separates Array. Am Ende steht zusätzlich ein Nullzeichen, damit die Zeichen ohne Kopie an native Funktionen übergeben werden können.',
    },
    {
      codeLine: 3,
      state: objArray,
      changed: ['o-0', 'o-1'],
      explanation:
        'Bei einem Array von Referenztypen enthalten die Elemente nur **Verweise**, je 8 Byte. Die Objekte selbst liegen woanders auf dem Heap. Häufige Fehlannahme: `new object[2]` lege zwei Objekte an. Es legt nur ein Array mit zwei leeren Verweisen an.',
    },
  ],
});
