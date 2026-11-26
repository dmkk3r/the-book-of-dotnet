import { defineStepScript, type TableState } from '@/components/viz';

// Generic instantiations in metadata after ECMA-335 Partition II: TypeSpec (0x1B) holds a type
// signature in #Blob, MethodSpec (0x2B) holds a generic method plus an instantiation blob.
// Element types from II.23.1.16: GENERICINST 0x15, CLASS 0x12, I4 0x08, VAR 0x13, MVAR 0x1E.
// A MemberRef on a generic type instantiation carries the signature of the generic definition
// (parameter !0), not the instantiated one.
// TODO(verify): Token values (MemberRef rows, TypeSpec row 1, MethodSpec row 1) are examples;
// that List<T> is referenced via [System.Collections] and Array via [System.Runtime] when
// targeting net8.0; the blob bytes shown in the facts. MemberRef row 17 for Array::Empty is an
// example as well.

type Table = TableState['tables'][number];
type Status = NonNullable<Table['rows'][number]['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

/** Which rows are highlighted and which references are already followed. */
interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[]; // row ids whose references are drawn
}

function tables({ status = {}, follow = [] }: Look): Table[] {
  const row = (id: string, cells: string[], refs?: { col: number; to: string }[]) => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(refs && follow.includes(id) ? { refs } : {}),
  });
  return [
    {
      id: 't-il',
      title: 'IL (gekürzt)',
      columns: ['Opcode', 'Token'],
      row: 1,
      col: 1,
      rows: [
        row('il-add', ['callvirt', '0A000010'], [{ col: 1, to: 'mref-16' }]),
        row('il-empty', ['call', '2B000001'], [{ col: 1, to: 'mspec-1' }]),
      ],
    },
    {
      id: 't-mspec',
      title: 'MethodSpec (0x2B)',
      columns: ['Zeile', 'Method', 'Instantiation'],
      row: 2,
      col: 1,
      rows: [row('mspec-1', ['1', 'MemberRef 17', 'I4'], [{ col: 1, to: 'mref-17' }])],
    },
    {
      id: 't-mref',
      title: 'MemberRef (0x0A)',
      columns: ['Zeile', 'Class', 'Name'],
      row: 1,
      col: 2,
      rows: [
        row('mref-16', ['16', 'TypeSpec 1', 'Add'], [{ col: 1, to: 'tspec-1' }]),
        row('mref-17', ['17', 'TypeRef Array', 'Empty']),
      ],
    },
    {
      id: 't-tspec',
      title: 'TypeSpec (0x1B)',
      columns: ['Zeile', 'Signature'],
      row: 2,
      col: 2,
      rows: [row('tspec-1', ['1', 'GENERICINST List`1 I4'], [{ col: 1, to: 'tref-list' }])],
    },
    {
      id: 't-tref',
      title: 'TypeRef (0x01)',
      columns: ['Name', 'ResolutionScope'],
      row: 3,
      col: 2,
      rows: [row('tref-list', ['List`1', 'System.Collections'])],
    },
  ];
}

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Generische Typen und Methoden in den Metadaten',
  code: {
    cs: `var list = new List<int>();
list.Add(42);
int[] leer = Array.Empty<int>();`,
    il: `// gekürzt, ohne stloc und ldloc
newobj   instance void class [System.Collections]
         System.Collections.Generic.List\`1<int32>::.ctor()
ldc.i4.s 42
callvirt instance void class [System.Collections]
         System.Collections.Generic.List\`1<int32>::Add(!0)
call     !!0[] [System.Runtime]System.Array::Empty<int32>()`,
  },
  steps: [
    {
      codeLine: 2,
      highlight: { il: [5, 6] },
      state: {
        tables: tables({ status: { 'il-add': 'active' } }),
        facts: [
          fact('f-op', 'Opcode', '0x6F (callvirt)'),
          fact('f-tok', 'Token', '0x0A000010: MemberRef'),
        ],
      },
      changed: ['f-op', 'f-tok'],
      explanation:
        '`list.Add(42)` wird zu `callvirt` mit einem MemberRef-Token. Das ist dieselbe Tabelle wie bei `Console.WriteLine`, obwohl hier ein generischer Typ im Spiel ist.',
    },
    {
      codeLine: 2,
      highlight: { il: [5, 6] },
      state: {
        tables: tables({ status: { 'il-add': 'active', 'mref-16': 'match' }, follow: ['il-add'] }),
        facts: [
          fact('f-class', 'Class', 'TypeSpec, Zeile 1 (nicht TypeRef)'),
          fact('f-name', 'Name', '"Add"'),
          fact('f-sig', 'Signature', 'instance void (!0)'),
        ],
      },
      changed: ['f-class', 'f-sig'],
      explanation:
        'Der Unterschied steckt in **Class**: Sie zeigt nicht auf ein TypeRef, sondern auf ein **TypeSpec**, also auf einen zusammengesetzten Typ. Die Signatur ist die der generischen Definition: Der Parameter heißt `!0` (erster Typparameter des Typs), nicht `int32`.',
    },
    {
      codeLine: 1,
      state: {
        tables: tables({
          status: { 'il-add': 'dim', 'mref-16': 'dim', 'tspec-1': 'active' },
          follow: ['il-add', 'mref-16'],
        }),
        facts: [
          fact('f-blob', 'Signatur in #Blob', 'GENERICINST CLASS List`1 1 I4'),
          fact('f-bytes', 'Als Bytes', '15 12 (TypeRef-Index) 01 08'),
        ],
      },
      changed: ['f-blob', 'f-bytes'],
      explanation:
        'Eine TypeSpec-Zeile hat nur eine Spalte: einen Index in `#Blob`. Dort steht `List<int>` als Typsignatur: „generische Instanz einer Klasse, nämlich dieses TypeRef, mit einem Typargument `int32`“. Für jede verwendete Instanz wie `List<string>` gibt es eine eigene TypeSpec-Zeile.',
    },
    {
      codeLine: 1,
      state: {
        tables: tables({
          status: { 'il-add': 'dim', 'mref-16': 'dim', 'tspec-1': 'dim', 'tref-list': 'active' },
          follow: ['il-add', 'mref-16', 'tspec-1'],
        }),
        facts: [
          fact('f-ns', 'TypeNamespace', '"System.Collections.Generic"'),
          fact('f-tn', 'TypeName', '"List`1"'),
          fact('f-scope', 'ResolutionScope', 'AssemblyRef System.Collections'),
        ],
      },
      changed: ['f-tn', 'f-scope'],
      explanation:
        'Das TypeRef beschreibt die offene Definition `List`1`, der Backtick mit Zahl ist Teil des Namens und nennt die Zahl der Typparameter. Aus Definition und Typargument baut die Runtime später den konkreten Typ `List<int>`.',
    },
    {
      codeLine: 3,
      highlight: { il: [7] },
      state: {
        tables: tables({
          status: { 'il-empty': 'dim', 'mspec-1': 'active', 'mref-17': 'match' },
          follow: ['il-empty', 'mspec-1'],
        }),
        facts: [
          fact('f-tok2', 'Token', '0x2B000001: MethodSpec'),
          fact('f-method', 'Method', 'MemberRef Array::Empty'),
          fact('f-inst', 'Instantiation', '#Blob: GENERICINST, 1 Argument, I4'),
        ],
      },
      changed: ['f-tok2', 'f-method', 'f-inst'],
      explanation:
        'Bei einer **generischen Methode** ist nicht der Typ generisch, sondern die Methode selbst. Dafür gibt es die Tabelle **MethodSpec** mit zwei Spalten: die Methode (MethodDef oder MemberRef) und die Typargumente als Blob. `call` bekommt das MethodSpec-Token.',
    },
  ],
});
