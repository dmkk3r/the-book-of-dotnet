import { defineStepScript, type TableState } from '@/components/viz';

// Resolution chain from a call instruction to the target method, after ECMA-335 Partition II
// (tables MemberRef 0x0A, TypeRef 0x01, AssemblyRef 0x23; coded indexes MemberRefParent and
// ResolutionScope) and Partition III (call takes a MethodDef, MemberRef or MethodSpec token).
// Token table numbers checked against the CorTokenType list in ECMA-335 II.22 / corhdr.h:
// TODO(verify): 0x0A MemberRef, 0x01 TypeRef, 0x23 AssemblyRef, 0x70 user string.
// TODO(verify): Concrete row numbers (MemberRef 12, TypeRef 5, AssemblyRef 2) are examples, not
// measured; the WriteLine(string) signature blob 00 01 01 0E; System.Console version 8.0.0.0 and
// public key token b03f5f7f11d50a3a when targeting net8.0; that CoreCLR caches the resolved
// MemberRef per module (lookup maps in Module, src/coreclr/vm/ceeload.h).

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
      title: 'IL von Main',
      columns: ['Offset', 'Opcode', 'Operand'],
      row: 1,
      col: 1,
      rows: [
        row('il-0', ['IL_0000', 'ldstr', '70000001']),
        row('il-5', ['IL_0005', 'call', '0A00000C'], [{ col: 2, to: 'mref-12' }]),
        row('il-a', ['IL_000a', 'call', '06000002'], [{ col: 2, to: 'mdef-2' }]),
        row('il-f', ['IL_000f', 'ret', '']),
      ],
    },
    {
      id: 't-mdef',
      title: 'MethodDef (0x06)',
      columns: ['Zeile', 'Name'],
      row: 2,
      col: 1,
      rows: [row('mdef-1', ['1', 'Main']), row('mdef-2', ['2', 'Helper'])],
    },
    {
      id: 't-mref',
      title: 'MemberRef (0x0A)',
      columns: ['Zeile', 'Class', 'Name', 'Signature'],
      row: 1,
      col: 2,
      rows: [
        row('mref-12', ['12', 'TypeRef 5', 'WriteLine', '00 01 01 0E'], [{ col: 1, to: 'tref-5' }]),
      ],
    },
    {
      id: 't-tref',
      title: 'TypeRef (0x01)',
      columns: ['Zeile', 'ResolutionScope', 'Namespace', 'Name'],
      row: 2,
      col: 2,
      rows: [
        row('tref-5', ['5', 'AssemblyRef 2', 'System', 'Console'], [{ col: 1, to: 'aref-2' }]),
      ],
    },
    {
      id: 't-aref',
      title: 'AssemblyRef (0x23)',
      columns: ['Zeile', 'Name', 'Version'],
      row: 3,
      col: 2,
      rows: [row('aref-2', ['2', 'System.Console', '8.0.0.0'])],
    },
  ];
}

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Ein call-Token wird aufgelöst',
  code: {
    cs: `class Program
{
    static void Main()
    {
        Console.WriteLine("Hallo");
        Helper();
    }

    static void Helper() { }
}`,
    il: `.method private hidebysig static void Main () cil managed
{
    .entrypoint
    .maxstack 8
    IL_0000: ldstr "Hallo"     // 72 | 70000001
    IL_0005: call void [System.Console]System.Console::WriteLine(string)
                               // 28 | 0A00000C
    IL_000a: call void Program::Helper()
                               // 28 | 06000002
    IL_000f: ret
}`,
  },
  steps: [
    {
      codeLine: 5,
      highlight: { il: [6, 7] },
      state: {
        tables: tables({ status: { 'il-5': 'active' } }),
        facts: [fact('f-op', 'Opcode', '0x28 (call)'), fact('f-operand', 'Operand', '0x0A00000C')],
      },
      changed: ['f-op', 'f-operand'],
      explanation:
        'Im IL steht für den Aufruf genau ein Byte Opcode und vier Byte Operand. ildasm zeigt dir zwar `System.Console::WriteLine(string)` an, aber diesen Text hat das Werkzeug erst beim Anzeigen zusammengesetzt. In der Datei steht nur die Zahl **0x0A00000C**, ein Metadaten-Token.',
    },
    {
      codeLine: 5,
      highlight: { il: [6, 7] },
      state: {
        tables: tables({ status: { 'il-5': 'active', 'mref-12': 'match' }, follow: ['il-5'] }),
        facts: [
          fact('f-table', 'Oberstes Byte', '0x0A: Tabelle MemberRef'),
          fact('f-row', 'Untere drei Byte', '0x00000C: Zeile 12'),
          fact('f-base', 'Zählung', 'Zeilen beginnen bei 1, 0 heißt „kein Eintrag“'),
        ],
      },
      changed: ['f-table', 'f-row', 'f-base'],
      explanation:
        'Ein Token ist eine Tabellennummer im obersten Byte und eine Zeilennummer in den unteren drei Byte. **0x0A** ist die Tabelle MemberRef, also ein Verweis auf ein Member, das nicht in diesem Modul definiert ist. Die Zeilen zählen ab 1, damit 0 als „leer“ frei bleibt.',
    },
    {
      codeLine: 5,
      highlight: { il: [6, 7] },
      state: {
        tables: tables({
          status: { 'il-5': 'dim', 'mref-12': 'active' },
          follow: ['il-5', 'mref-12'],
        }),
        facts: [
          fact('f-class', 'Class', 'TypeRef, Zeile 5'),
          fact('f-name', 'Name', 'Index in #Strings: "WriteLine"'),
          fact('f-sig', 'Signature', 'Index in #Blob: 00 01 01 0E'),
        ],
      },
      changed: ['f-class', 'f-name', 'f-sig'],
      explanation:
        'Die MemberRef-Zeile hat drei Spalten. **Class** sagt, in welchem Typ das Member gesucht wird, **Name** zeigt in den Heap `#Strings`, **Signature** in den Heap `#Blob`. Die Signatur codiert hier: statisch, ein Parameter, Rückgabe `void`, Parameter `string`.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({
          status: { 'il-5': 'dim', 'mref-12': 'dim', 'tref-5': 'active' },
          follow: ['il-5', 'mref-12', 'tref-5'],
        }),
        facts: [
          fact('f-scope', 'ResolutionScope', 'AssemblyRef, Zeile 2'),
          fact('f-ns', 'TypeNamespace', '"System"'),
          fact('f-tn', 'TypeName', '"Console"'),
        ],
      },
      changed: ['f-scope', 'f-ns', 'f-tn'],
      explanation:
        'Die TypeRef-Zeile beschreibt `System.Console` nur mit Namensraum und Namen, beide als Index in `#Strings`. **ResolutionScope** sagt, wo der Typ zu suchen ist: in einer anderen Assembly, einem anderen Modul oder, bei geschachtelten Typen, in einem anderen TypeRef.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({
          status: { 'il-5': 'dim', 'mref-12': 'dim', 'tref-5': 'dim', 'aref-2': 'active' },
          follow: ['il-5', 'mref-12', 'tref-5'],
        }),
        facts: [
          fact('f-aname', 'Name', '"System.Console"'),
          fact('f-aver', 'Version', '8.0.0.0'),
          fact('f-akey', 'PublicKeyOrToken', 'b03f5f7f11d50a3a'),
        ],
      },
      changed: ['f-aname', 'f-aver', 'f-akey'],
      explanation:
        'Die AssemblyRef-Zeile ist das Ende der Kette innerhalb deiner Datei. Sie enthält Name, Version, Kultur und Schlüssel der Assembly, gegen die du kompiliert hast. Mehr weiß deine Assembly über `Console.WriteLine` nicht.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({
          status: { 'il-5': 'match', 'mref-12': 'match', 'tref-5': 'match', 'aref-2': 'match' },
          follow: ['il-5', 'mref-12', 'tref-5'],
        }),
        facts: [
          fact('f-bind', 'Binder', 'lädt System.Console'),
          fact('f-find', 'Typsuche', 'TypeDef System.Console per Name'),
          fact('f-match', 'Methodensuche', 'MethodDef WriteLine mit gleicher Signatur'),
          fact('f-cache', 'Ergebnis', 'pro Token gemerkt'),
        ],
      },
      changed: ['f-bind', 'f-find', 'f-match', 'f-cache'],
      explanation:
        'Erst zur Laufzeit wird daraus eine echte Methode. Die Runtime lädt die Assembly, sucht dort den Typ per Namen und darin die Methode per Name und Signatur. Das Ergebnis merkt sie sich, damit dasselbe Token beim nächsten Mal nicht wieder aufgelöst werden muss.',
    },
    {
      codeLine: 6,
      highlight: { il: [8, 9] },
      state: {
        tables: tables({ status: { 'il-a': 'active', 'mdef-2': 'match' }, follow: ['il-a'] }),
        facts: [
          fact('f-op2', 'Operand', '0x06000002'),
          fact('f-table2', 'Tabelle', '0x06: MethodDef'),
          fact('f-row2', 'Zeile', '2: Helper in diesem Modul'),
        ],
      },
      changed: ['f-op2', 'f-table2', 'f-row2'],
      explanation:
        'Ganz anders der Aufruf von `Helper`: Die Methode steht im selben Modul, also zeigt das Token direkt auf eine Zeile der Tabelle **MethodDef**. Keine Namenssuche, keine andere Assembly. Def heißt „hier definiert“, Ref heißt „anderswo definiert, hier nur beschrieben“.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({ follow: ['il-5', 'mref-12', 'tref-5', 'il-a'] }),
        facts: [
          fact('f-myth', 'Fehlannahme', '„Im IL steht der Methodenname.“'),
          fact('f-truth', 'Tatsächlich', 'Token, drei Zeilen, dann erst der Name in #Strings'),
        ],
      },
      changed: ['f-myth', 'f-truth'],
      explanation:
        'Fehlannahme: „Ein Methodenaufruf im IL enthält den Methodennamen.“ Er enthält vier Byte Token. Der Name ist erst über MemberRef und `#Strings` erreichbar, und gebunden wird er zur Laufzeit per Name und Signatur.',
    },
  ],
});
