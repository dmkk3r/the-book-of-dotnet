import { defineStepScript, type TableState } from '@/components/viz';

// The walk follows the PE/COFF specification (Microsoft Learn, "PE Format") and ECMA-335
// Partition II, chapters 24 and 25. It is the path PEReader and the runtime take from the
// first byte of the file to the IL of one method.
// TODO(verify): Machine 0x14C (i386) and PE32 for an AnyCPU library built with the current SDK,
// three sections (.text, .rsrc, .reloc), metadata version string "v4.0.30319",
// stream order #~, #Strings, #US, #GUID, #Blob, tiny header byte 0x12 and IL bytes 02 03 58 2A
// for Add in a Release build (check with System.Reflection.Metadata or ILSpy's metadata view).

type Table = TableState['tables'][number];
type Status = NonNullable<Table['rows'][number]['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

/** Which rows are highlighted and which references are already followed. */
interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[]; // row ids whose references are drawn
}

// Each structure is a small table of fields. The chain runs left to right in grid row 1, back
// from right to left in grid row 2 and ends below in grid row 3.
function tables({ status = {}, follow = [] }: Look): Table[] {
  const row = (id: string, cells: string[], refs?: { col: number; to: string }[]) => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(refs && follow.includes(id) ? { refs } : {}),
  });
  const columns = ['Feld', 'Wert'];
  return [
    {
      id: 't-dos',
      title: 'DOS-Header',
      columns,
      row: 1,
      col: 1,
      rows: [
        row('dos-magic', ['e_magic', 'MZ']),
        row('dos-lfanew', ['e_lfanew (0x3C)', 'Offset'], [{ col: 1, to: 'pe-sig' }]),
      ],
    },
    {
      id: 't-pe',
      title: 'PE-Signatur, COFF-Header',
      columns,
      row: 1,
      col: 2,
      rows: [
        row('pe-sig', ['Signatur', 'PE\\0\\0']),
        row('pe-machine', ['Machine', 'i386']),
        row('pe-sections', ['Abschnitte', '3']),
        // The optional header follows the COFF header directly, no field points to it.
        row('pe-next', ['danach', 'Optional Header'], [{ col: 1, to: 'opt-magic' }]),
      ],
    },
    {
      id: 't-opt',
      title: 'Optional Header',
      columns,
      row: 2,
      col: 2,
      rows: [
        row('opt-magic', ['Magic', 'PE32']),
        row('opt-dir', ['Verzeichnis 14', 'RVA, Größe'], [{ col: 1, to: 'cli-flags' }]),
      ],
    },
    {
      id: 't-cli',
      title: 'CLI-Header',
      columns,
      row: 2,
      col: 1,
      rows: [
        row('cli-flags', ['Flags', 'ILONLY']),
        row('cli-md', ['MetaData', 'RVA, Größe'], [{ col: 1, to: 'meta-sig' }]),
        row('cli-entry', ['EntryPointToken', '0']),
        row('cli-native', ['ManagedNativeHeader', 'leer']),
      ],
    },
    {
      id: 't-meta',
      title: 'Metadatenstamm',
      columns,
      row: 3,
      col: 1,
      rows: [
        row('meta-sig', ['Signatur', 'BSJB']),
        row('meta-ver', ['Version', 'v4.0.30319']),
        row('meta-tables', ['#~', 'Tabellen'], [{ col: 1, to: 'mdef-rva' }]),
        row('meta-heaps', ['Heaps', '#Strings, #US, #GUID, #Blob']),
      ],
    },
    {
      id: 't-mdef',
      title: 'MethodDef: Add',
      columns,
      row: 3,
      col: 2,
      rows: [
        row('mdef-rva', ['RVA', 'in .text'], [{ col: 1, to: 'body-hdr' }]),
        row('mdef-name', ['Name', '#Strings: "Add"']),
        row('mdef-sig', ['Signature', '#Blob']),
      ],
    },
    {
      id: 't-body',
      title: 'Methodenrumpf',
      columns,
      row: 4,
      col: 2,
      rows: [row('body-hdr', ['Header', '0x12 (Tiny)']), row('body-il', ['IL', '02 03 58 2A'])],
    },
  ];
}

const DIM = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'dim' as const]));
const ACTIVE = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'active' as const]));
const DOS = ['dos-magic', 'dos-lfanew'];
const PE = ['pe-sig', 'pe-machine', 'pe-sections', 'pe-next'];
const OPT = ['opt-magic', 'opt-dir'];
const CLI = ['cli-flags', 'cli-md', 'cli-entry', 'cli-native'];
const META = ['meta-sig', 'meta-ver', 'meta-tables', 'meta-heaps'];
const MDEF = ['mdef-rva', 'mdef-name', 'mdef-sig'];
const BODY = ['body-hdr', 'body-il'];
// The fields that point to the next structure, in the order they are followed.
const CHAIN = ['dos-lfanew', 'pe-next', 'opt-dir', 'cli-md', 'meta-tables', 'mdef-rva'];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Vom ersten Byte bis zum IL einer Methode',
  code: {
    cs: `// Rechner.dll, gebaut mit dotnet build -c Release
namespace Demo;

public static class Rechner
{
    public static int Add(int a, int b) => a + b;
}`,
    il: `.method public hidebysig static
    int32 Add (int32 a, int32 b) cil managed
{
    // Code size 4 (0x4)
    .maxstack 8
    IL_0000: ldarg.0
    IL_0001: ldarg.1
    IL_0002: add
    IL_0003: ret
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        tables: tables({ status: ACTIVE(DOS) }),
        facts: [
          fact('f-magic', 'Erste zwei Byte', 'MZ'),
          fact('f-lfanew', 'Feld e_lfanew', 'Offset 0x3C, zeigt auf die PE-Signatur'),
        ],
      },
      changed: ['f-magic', 'f-lfanew'],
      explanation:
        'Jede Assembly beginnt wie jede Windows-EXE mit einem **DOS-Header**. Von ihm zählen nur zwei Dinge: die Kennung `MZ` und das Feld `e_lfanew`, das verrät, wo der eigentliche PE-Header steht. Dazwischen liegt ein kleiner DOS-Stub, der unter DOS nur eine Meldung ausgibt.',
    },
    {
      codeLine: 1,
      state: {
        tables: tables({ status: { ...DIM(DOS), ...ACTIVE(PE) }, follow: CHAIN.slice(0, 1) }),
        facts: [
          fact('f-sig', 'Signatur', 'PE\\0\\0'),
          fact('f-machine', 'Machine', 'i386 (bei AnyCPU)'),
          fact('f-sections', 'Abschnitte', '.text, .rsrc, .reloc'),
        ],
      },
      changed: ['f-sig', 'f-machine', 'f-sections'],
      explanation:
        'Hinter der Signatur `PE\\0\\0` folgt der **COFF-Header**: Zielmaschine, Zahl der Abschnitte, Zeitstempel. Eine AnyCPU-Bibliothek trägt hier die 32-Bit-Kennung i386, obwohl sie auf jedem Prozessor läuft. Ob sie wirklich an 32 Bit gebunden ist, steht erst im CLI-Header.',
    },
    {
      codeLine: 1,
      state: {
        tables: tables({
          status: { ...DIM([...DOS, ...PE]), ...ACTIVE(OPT) },
          follow: CHAIN.slice(0, 2),
        }),
        facts: [
          fact('f-magic2', 'Magic', 'PE32'),
          fact('f-dir', 'Verzeichnis 14', 'CLR Runtime Header: RVA und Größe'),
          fact('f-rva', 'RVA in Dateiposition', 'RVA minus VirtualAddress plus PointerToRawData'),
        ],
      },
      changed: ['f-dir', 'f-rva'],
      explanation:
        'Der **Optional Header** endet mit einer Liste von Datenverzeichnissen, jedes ein Paar aus Adresse und Größe. Der 15. Eintrag ist der entscheidende: Ist er belegt, ist die Datei eine .NET-Assembly. Adressen sind **RVAs** (relativ zur Ladeadresse) und werden über die Abschnittstabelle in eine Position in der Datei umgerechnet.',
    },
    {
      codeLine: 1,
      state: {
        tables: tables({
          status: { ...DIM([...DOS, ...PE, ...OPT]), ...ACTIVE(CLI) },
          follow: CHAIN.slice(0, 3),
        }),
        facts: [
          fact('f-flags', 'Flags', 'ILONLY'),
          fact('f-md', 'MetaData', 'RVA und Größe der Metadaten'),
          fact('f-entry', 'EntryPointToken', '0 (Bibliothek ohne Main)'),
          fact('f-native', 'ManagedNativeHeader', 'leer (kein ReadyToRun)'),
        ],
      },
      changed: ['f-flags', 'f-md', 'f-entry', 'f-native'],
      explanation:
        'Der **CLI-Header** ist die Tür in die .NET-Welt. Er sagt, wo die Metadaten liegen, ob die Datei nur IL enthält (`ILONLY`) und welche Methode der Einstiegspunkt ist. Alles davor ist gewöhnliches PE, das auch jede native DLL hat.',
    },
    {
      codeLine: 4,
      state: {
        tables: tables({
          status: { ...DIM([...DOS, ...PE, ...OPT, ...CLI]), ...ACTIVE(META) },
          follow: CHAIN.slice(0, 4),
        }),
        facts: [
          fact('f-bsjb', 'Signatur des Metadatenstamms', 'BSJB'),
          fact('f-ver', 'Versionsstring', 'v4.0.30319'),
          fact('f-streams', 'Streams', '#~, #Strings, #US, #GUID, #Blob'),
        ],
      },
      changed: ['f-bsjb', 'f-ver', 'f-streams'],
      explanation:
        'Die Metadaten beginnen mit dem **Metadatenstamm**: einer Signatur, einem Versionsstring und einer Liste von Streams. `#~` enthält die Tabellen, die anderen Streams sind Heaps für Namen, String-Literale, GUIDs und Binärdaten. Der Versionsstring stammt aus .NET-Framework-Zeiten und sagt nichts über die Zielversion.',
    },
    {
      codeLine: 6,
      state: {
        tables: tables({
          status: { ...DIM([...DOS, ...PE, ...OPT, ...CLI, ...META]), ...ACTIVE(MDEF) },
          follow: CHAIN.slice(0, 5),
        }),
        facts: [
          fact('f-row', 'MethodDef-Zeile', 'Add'),
          fact('f-name', 'Name', 'Index in #Strings, dort steht "Add"'),
          fact('f-sigblob', 'Signature', 'Index in #Blob'),
          fact('f-mrva', 'RVA', 'Adresse des Methodenrumpfs in .text'),
        ],
      },
      changed: ['f-row', 'f-name', 'f-sigblob', 'f-mrva'],
      explanation:
        'In der Tabelle **MethodDef** hat `Add` eine Zeile. Sie enthält keinen Code, sondern Verweise: den Namen als Index in `#Strings`, die Signatur als Index in `#Blob` und die **RVA** des Methodenrumpfs. Wie diese Tabellen aufgebaut sind, zeigt die nächste Lektion.',
    },
    {
      codeLine: 6,
      highlight: { il: [4, 5, 6, 7, 8, 9] },
      state: {
        tables: tables({
          status: { ...DIM([...DOS, ...PE, ...OPT, ...CLI, ...META, ...MDEF]), ...ACTIVE(BODY) },
          follow: CHAIN,
        }),
        facts: [
          fact('f-hdr', 'Header', 'Tiny, 1 Byte (0x12)'),
          fact('f-ilbytes', 'IL', '02 03 58 2A'),
          fact('f-len', 'Codegröße', '4 Byte'),
        ],
      },
      changed: ['f-hdr', 'f-ilbytes', 'f-len'],
      explanation:
        'An der RVA liegt der **Methodenrumpf**: ein Header und dahinter die IL-Bytes. Für eine so kleine Methode reicht ein einziges Header-Byte, das Tiny-Format. Die vier Bytes danach sind `ldarg.0`, `ldarg.1`, `add` und `ret`.',
    },
    {
      codeLine: 6,
      highlight: { il: [6, 7, 8, 9] },
      state: {
        tables: tables({ status: { 'body-il': 'match' }, follow: CHAIN }),
        facts: [
          fact('f-native-code', 'Maschinencode für Add in der Datei', 'keiner'),
          fact('f-jit', 'Wer erzeugt ihn', 'der JIT beim ersten Aufruf'),
        ],
      },
      changed: ['f-native-code', 'f-jit'],
      explanation:
        'Fehlannahme: „Eine DLL enthält Maschinencode.“ Eine normale .NET-Assembly enthält für `Add` nur diese vier IL-Bytes. Erst zur Laufzeit übersetzt der JIT sie für den Prozessor, auf dem das Programm gerade läuft.',
    },
  ],
});
