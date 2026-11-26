import { defineStepScript, type TableState } from '@/components/viz';

// How a type reference compiled against System.Runtime ends up in System.Private.CoreLib.
// TODO(verify): That System.Runtime.dll in shared/Microsoft.NETCore.App forwards System.Object
// to System.Private.CoreLib (check with ILSpy or System.Reflection.Metadata ExportedTypes).
// TODO(verify): Assembly version 8.0.0.0 of System.Runtime for net8.0 is an example.
// TODO(verify): Row number 1 of the AssemblyRef in App.dll is an example.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

/** Which rows are highlighted and which references ("<row id>:<col>") are already followed. */
interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[];
}

// Row 1: what the compiler sees at build time. Row 2: the type chain at run time, left to right.
// Row 3: how the assembly System.Runtime is found.
function tables({ status = {}, follow = [] }: Look): Table[] {
  const row = (id: string, cells: string[], refs: { col: number; to: string }[] = []): Row => {
    const shown = refs.filter((r) => follow.includes(`${id}:${r.col}`));
    return {
      id,
      cells,
      ...(status[id] ? { status: status[id] } : {}),
      ...(shown.length > 0 ? { refs: shown } : {}),
    };
  };
  return [
    {
      id: 't-ref',
      title: 'Referenzassembly System.Runtime',
      columns: ['Typ', 'Inhalt'],
      row: 3,
      col: 1,
      note: 'packs/Microsoft.NETCore.App.Ref',
      rows: [row('ref-obj', ['System.Object', 'nur Signaturen'])],
    },
    {
      id: 't-tref',
      title: 'App.dll: TypeRef',
      columns: ['Typ', 'Scope'],
      row: 1,
      col: 1,
      rows: [
        row(
          'tref',
          ['System.Object', 'AssemblyRef 1'],
          [
            { col: 1, to: 'aref' },
            { col: 0, to: 'exp-obj' },
          ],
        ),
      ],
    },
    {
      id: 't-exp',
      title: 'System.Runtime: ExportedType',
      columns: ['Typ', 'Ziel'],
      row: 1,
      col: 2,
      rows: [
        row('exp-obj', ['System.Object', 'System.Private.CoreLib'], [{ col: 1, to: 'def-obj' }]),
      ],
    },
    {
      id: 't-def',
      title: 'System.Private.CoreLib: TypeDef',
      columns: ['Typ', 'Inhalt'],
      row: 2,
      col: 2,
      rows: [row('def-obj', ['System.Object', 'echte Definition'])],
    },
    {
      id: 't-aref',
      title: 'App.dll: AssemblyRef',
      columns: ['Zeile', 'Name', 'Version'],
      row: 2,
      col: 1,
      rows: [row('aref', ['1', 'System.Runtime', '8.0.0.0'], [{ col: 1, to: 'tpa-rt' }])],
    },
    {
      id: 't-tpa',
      title: 'TPA-Liste des Hosts',
      columns: ['Datei'],
      row: 3,
      col: 2,
      rows: [
        row('tpa-rt', ['System.Runtime.dll']),
        row('tpa-corelib', ['System.Private.CoreLib.dll']),
      ],
    },
  ];
}

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Wie object von System.Runtime nach System.Private.CoreLib kommt',
  code: {
    cs: `// Program.cs
object o = new object();
Console.WriteLine(o.GetType().Assembly.GetName().Name);

// IL in App.dll:
// newobj instance void [System.Runtime]System.Object::.ctor()`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        tables: tables({ status: { 'ref-obj': 'active' } }),
        facts: [
          fact('f-ref', 'Compiler sieht', 'System.Runtime.dll (nur Signaturen)'),
          fact('f-body', 'Methodenrümpfe', 'keine echte Implementierung'),
        ],
      },
      changed: ['f-ref', 'f-body'],
      explanation:
        'Beim Build sieht der Compiler nicht die Runtime, sondern **Referenzassemblies** aus dem Targeting Pack. Sie beschreiben die öffentliche API eines Frameworks, enthalten aber keinen ausführbaren Code. Laut ihnen liegt `System.Object` in `System.Runtime`.',
    },
    {
      codeLine: 6,
      state: {
        tables: tables({
          status: { 'ref-obj': 'dim', tref: 'active', aref: 'match' },
          follow: ['tref:1'],
        }),
        facts: [
          fact('f-asmref', 'AssemblyRef', 'System.Runtime, Version=8.0.0.0'),
          fact('f-typeref', 'TypeRef', 'System.Object in System.Runtime'),
        ],
      },
      changed: ['f-asmref', 'f-typeref'],
      explanation:
        'In `App.dll` landen genau diese Angaben: ein Verweis auf die Assembly `System.Runtime` und ein Typverweis „`System.Object` aus `System.Runtime`“. Mehr weiß die App nicht, und mehr muss sie auch nicht wissen.',
    },
    {
      codeLine: 2,
      state: {
        tables: tables({
          status: { 'ref-obj': 'dim', tref: 'dim', aref: 'active', 'tpa-rt': 'match' },
          follow: ['tref:1', 'aref:1'],
        }),
        facts: [
          fact('f-file', 'Gefunden', 'shared/Microsoft.NETCore.App/8.0.11/System.Runtime.dll'),
          fact('f-how', 'Woher bekannt', 'Liste des Hosts (TPA)'),
        ],
      },
      changed: ['f-file', 'f-how'],
      explanation:
        'Zur Laufzeit sucht die Runtime eine Assembly namens `System.Runtime`. Der Host hat ihr vorab eine Liste aller Framework-Dateien übergeben, darin steht die **Implementierungsassembly** aus dem Shared Framework.',
    },
    {
      codeLine: 2,
      state: {
        tables: tables({
          status: {
            'ref-obj': 'dim',
            tref: 'active',
            aref: 'dim',
            'tpa-rt': 'dim',
            'exp-obj': 'match',
          },
          follow: ['tref:1', 'aref:1', 'tref:0'],
        }),
        facts: [
          fact('f-fwd', 'Eintrag für System.Object', 'weitergeleitet an System.Private.CoreLib'),
        ],
      },
      changed: ['f-fwd'],
      explanation:
        'Häufige Fehlannahme: „`object` steckt in `System.Runtime.dll`.“ Die Datei ist größtenteils eine **Fassade**: Für `System.Object` enthält sie nur eine Typweiterleitung, also den Vermerk „dieser Typ liegt in Wahrheit in `System.Private.CoreLib`“.',
    },
    {
      codeLine: 3,
      state: {
        tables: tables({
          status: {
            'ref-obj': 'dim',
            tref: 'dim',
            aref: 'dim',
            'tpa-rt': 'dim',
            'exp-obj': 'active',
            'def-obj': 'match',
          },
          follow: ['tref:1', 'aref:1', 'tref:0', 'exp-obj:1'],
        }),
        facts: [
          fact('f-def', 'Definiert in', 'System.Private.CoreLib.dll'),
          fact('f-tie', 'Gekoppelt an', 'genau diese Version von CoreCLR'),
        ],
        output: 'System.Private.CoreLib',
      },
      changed: ['f-def', 'f-tie'],
      explanation:
        'Die Runtime folgt der Weiterleitung und lädt den Typ aus `System.Private.CoreLib`. Diese Assembly gehört so eng zur VM, dass beide immer gemeinsam ausgeliefert werden. Deshalb darf deine App nie direkt gegen sie kompilieren.',
    },
  ],
});
