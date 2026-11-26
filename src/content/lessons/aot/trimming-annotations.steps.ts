import { defineStepScript, type TableState } from '@/components/viz';

// How a DynamicallyAccessedMembers annotation is checked at each call site and what ILLink keeps.
// Sources: Microsoft Learn "Fixing trim warnings" and "Prepare .NET libraries for trimming".
// TODO(verify): Whether passing the unknown Type.GetType result to an annotated parameter
// (Activator.CreateInstance / Create) produces an additional warning (IL2072) besides IL2057.
// TODO(verify): Warning codes IL2057 (non-constant Type.GetType argument) and IL2067 (parameter
// without annotation passed to an annotated parameter).
// TODO(verify): That ILLink resolves Type.GetType("Report") with an unqualified name in the
// calling assembly, like the runtime does.
// TODO(verify): That typeof(Export) alone keeps the type but not its constructor.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Fact = NonNullable<TableState['facts']>[number];

const DAM = 'PublicParameterlessConstructor';

const annotations = (laterAnnotated: boolean, active?: string): Table => ({
  id: 't-anno',
  title: 'Annotationen',
  columns: ['Parameter', 'Verlangt'],
  rows: [
    {
      id: 'a-create',
      cells: ['Create(type)', DAM],
      ...(active === 'a-create' ? { status: 'active' as const } : {}),
    },
    {
      id: 'a-later',
      cells: ['CreateLater(t)', laterAnnotated ? DAM : 'nichts'],
      ...(active === 'a-later'
        ? { status: 'active' as const }
        : laterAnnotated
          ? { status: 'match' as const }
          : {}),
    },
  ],
  row: 1,
  col: 1,
});

const calls = (rows: Row[]): Table => ({
  id: 't-calls',
  title: 'Aufrufstellen',
  columns: ['Zeile', 'Argument', 'Ergebnis'],
  rows,
  row: 1,
  col: 2,
});

const keptTable = (rows: Row[]): Table => ({
  id: 't-kept',
  title: 'Was ILLink zusätzlich behält',
  columns: ['Typ', 'Member', 'Grund'],
  rows,
  row: 2,
  col: 1,
  note: 'Nur Member, die über die Annotation markiert werden',
});

const cAudit = (status?: Row['status']): Row => ({
  id: 'c-audit',
  cells: ['10', 'typeof(Audit)', 'erfüllt'],
  refs: [
    { col: 0, to: 'a-create' },
    { col: 2, to: 'k-audit' },
  ],
  ...(status ? { status } : {}),
});
const cReport = (status?: Row['status']): Row => ({
  id: 'c-report',
  cells: ['11', 'GetType("Report")', 'erfüllt'],
  refs: [{ col: 2, to: 'k-report' }],
  ...(status ? { status } : {}),
});
const cInput = (status?: Row['status']): Row => ({
  id: 'c-input',
  cells: ['12', 'GetType(Eingabe)', 'IL2057'],
  ...(status ? { status } : {}),
});
const cLater = (fixed: boolean, status?: Row['status']): Row =>
  fixed
    ? {
        id: 'c-later',
        cells: ['13', 'typeof(Export)', 'erfüllt'],
        refs: [
          { col: 0, to: 'a-later' },
          { col: 2, to: 'k-export' },
        ],
        ...(status ? { status } : {}),
      }
    : {
        id: 'c-later',
        cells: ['8', 'Create(t)', 'IL2067'],
        refs: [{ col: 0, to: 'a-later' }],
        ...(status ? { status } : {}),
      };

const kAudit: Row = { id: 'k-audit', cells: ['Audit', '.ctor()', 'Zeile 10'], status: 'match' };
const kReport: Row = { id: 'k-report', cells: ['Report', '.ctor()', 'Zeile 11'], status: 'match' };
const kExportMissing: Row = {
  id: 'k-export',
  cells: ['Export', '.ctor() fehlt', 'nicht garantiert'],
  status: 'miss',
};
const kExport: Row = { id: 'k-export', cells: ['Export', '.ctor()', 'Zeile 13'], status: 'match' };

const contract: Fact = { id: 'f-contract', label: 'Vertrag', value: `type braucht ${DAM}` };

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Wie eine Annotation geprüft wird',
  code: {
    cs: `using System.Diagnostics.CodeAnalysis;

static object Create(
    [DynamicallyAccessedMembers(
        DynamicallyAccessedMemberTypes.PublicParameterlessConstructor)]
    Type type) => Activator.CreateInstance(type)!;

static object CreateLater(Type t) => Create(t);    // keine Annotation

Create(typeof(Audit));
Create(Type.GetType("Report")!);
Create(Type.GetType(Console.ReadLine()!)!);
CreateLater(typeof(Export));

class Audit { }
class Report { }
class Export { }`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        tables: [annotations(false, 'a-create'), calls([]), keptTable([])],
        facts: [contract],
      },
      changed: ['a-create', 'f-contract'],
      explanation:
        'Das Attribut am Parameter ist ein **Vertrag**: Jeder Typ, der hier ankommt, muss seinen öffentlichen parameterlosen Konstruktor behalten. Innerhalb von `Create` ist `Activator.CreateInstance(type)` damit abgesichert und erzeugt keine Warnung.',
    },
    {
      codeLine: 10,
      state: {
        tables: [annotations(false), calls([cAudit('active')]), keptTable([kAudit])],
        facts: [contract],
      },
      changed: ['c-audit', 'k-audit'],
      explanation:
        'Die Prüfung findet beim **Aufrufer** statt. `typeof(Audit)` ist ein bekannter Typ, also markiert ILLink dessen Konstruktor. Der Vertrag ist erfüllt, und der Konstruktor überlebt, obwohl ihn niemand direkt aufruft.',
    },
    {
      codeLine: 11,
      state: {
        tables: [
          annotations(false),
          calls([cAudit('match'), cReport('active')]),
          keptTable([kAudit, kReport]),
        ],
        facts: [contract],
      },
      changed: ['c-report', 'k-report'],
      explanation:
        'Auch `Type.GetType` mit einem **String-Literal** versteht die Analyse. Sie löst den Namen beim Build auf und behandelt das Ergebnis wie `typeof(Report)`.',
    },
    {
      codeLine: 12,
      state: {
        tables: [
          annotations(false),
          calls([cAudit('match'), cReport('match'), cInput('active')]),
          keptTable([kAudit, kReport]),
        ],
        facts: [contract, { id: 'f-warn', label: 'Warnungen', value: 'IL2057 (Zeile 12)' }],
      },
      changed: ['c-input', 'f-warn'],
      explanation:
        'Ein Name aus der Eingabe ist beim Build unbekannt. ILLink kann den Vertrag nicht prüfen und warnt. Behalten wird hier nichts, denn es gibt keinen Typ, den man markieren könnte.',
    },
    {
      codeLine: 8,
      state: {
        tables: [
          annotations(false, 'a-later'),
          calls([cAudit('match'), cReport('match'), cInput('miss'), cLater(false, 'active')]),
          keptTable([kAudit, kReport, kExportMissing]),
        ],
        facts: [
          contract,
          { id: 'f-warn', label: 'Warnungen', value: 'IL2057 (Zeile 12), IL2067 (Zeile 8)' },
        ],
      },
      changed: ['a-later', 'c-later', 'k-export', 'f-warn'],
      explanation:
        '`CreateLater` reicht ein **unannotiertes** `Type` weiter. Innerhalb von `CreateLater` ist nicht bekannt, woher `t` kommt, also kann der Vertrag von `Create` nicht erfüllt werden. Die Warnung steht hier und nicht in Zeile 13, und der Konstruktor von `Export` ist nicht garantiert.',
    },
    {
      codeLine: 13,
      state: {
        tables: [
          annotations(true),
          calls([cAudit('match'), cReport('match'), cInput('miss'), cLater(true, 'active')]),
          keptTable([kAudit, kReport, kExport]),
        ],
        facts: [
          { id: 'f-contract', label: 'Vertrag', value: 'gilt jetzt auch für CreateLater(t)' },
          { id: 'f-warn', label: 'Warnungen', value: 'IL2057 (Zeile 12)' },
        ],
      },
      changed: ['a-later', 'c-later', 'k-export', 'f-contract', 'f-warn'],
      explanation:
        'Bekommt auch `t` das Attribut, wandert der Vertrag eine Ebene nach oben. Jetzt wird an Zeile 13 geprüft, `typeof(Export)` erfüllt ihn, und der Konstruktor bleibt. Annotationen müssen so lange weitergereicht werden, bis ein bekannter Typ auftaucht.',
    },
  ],
});
