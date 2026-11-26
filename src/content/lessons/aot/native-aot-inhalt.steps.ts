import { defineStepScript, type TableState } from '@/components/viz';

// Contrast: what a framework-dependent JIT app needs at runtime and what a Native AOT executable
// contains. Sources: Microsoft Learn "Native AOT deployment overview" (stripped-down runtime, no JIT,
// self-contained single file), host.mdx/bausteine.mdx of this site for the host chain,
// ILCompiler TypePreinit.cs ("computes the initial state of static fields on a type by interpreting
// the static constructor").
// File names are simplified (Linux names without version numbers).
// TODO(verify): That Native AOT emits MethodTables as read-only data in the executable and keeps
// preinitialized static arrays and string literals as frozen objects outside the GC heap.
// TODO(verify): That the static constructor of Program with an int[] initializer is preinitialized
// (TypePreinit supports arrays initialized from RVA data).

type Table = TableState['tables'][number];
type Status = NonNullable<Table['rows'][number]['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

interface Look {
  status?: Partial<Record<string, Status>>;
  /** Row ids whose references are drawn. */
  follow?: string[];
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
      id: 't-host',
      title: 'JIT-App: Start',
      columns: ['Datei', 'Aufgabe'],
      row: 1,
      col: 1,
      rows: [row('j-host', ['Starter, hostfxr', 'wählen Framework'], [{ col: 0, to: 'j-clr' }])],
    },
    {
      id: 't-runtime',
      title: 'JIT-App: Runtime',
      columns: ['Datei', 'Aufgabe'],
      row: 2,
      col: 1,
      rows: [
        row('j-clr', ['libcoreclr', 'Typlader, GC'], [{ col: 0, to: 'j-app' }]),
        row('j-jit', ['libclrjit', 'JIT-Compiler'], [{ col: 0, to: 'j-app' }]),
      ],
    },
    {
      id: 't-asm',
      title: 'JIT-App: Assemblies',
      columns: ['Datei', 'Inhalt'],
      row: 3,
      col: 1,
      rows: [
        row('j-bcl', ['CoreLib und BCL', 'IL und R2R-Code']),
        row('j-app', ['App.dll', 'IL und Metadaten']),
      ],
    },
    {
      id: 't-code',
      title: 'Native AOT: Code',
      columns: ['Teil', 'Inhalt'],
      row: 1,
      col: 2,
      rows: [
        row('a-code', ['Maschinencode', 'App und benutzte BCL'], [{ col: 0, to: 'a-mt' }]),
        row('a-main', ['Main', 'liest Primes'], [{ col: 0, to: 'a-frozen' }]),
      ],
    },
    {
      id: 't-data',
      title: 'Native AOT: Daten',
      columns: ['Teil', 'Inhalt'],
      row: 2,
      col: 2,
      rows: [
        row('a-mt', ['MethodTables', 'fertig berechnet']),
        row('a-frozen', ['eingefrorene Objekte', 'Strings, Primes']),
        row('a-meta', ['Reflection-Daten', 'nur für Behaltenes']),
      ],
    },
    {
      id: 't-rt',
      title: 'Native AOT: Runtime',
      columns: ['Teil', 'Inhalt'],
      row: 3,
      col: 2,
      rows: [
        row('a-rt', ['Runtime', 'GC, Threads, Ausnahmen']),
        row('a-jit', ['JIT', 'nicht vorhanden']),
      ],
    },
  ];
}

const ALL_JIT = ['j-host', 'j-clr', 'j-jit', 'j-bcl', 'j-app'];
const ALL_AOT = ['a-code', 'a-main', 'a-mt', 'a-frozen', 'a-rt', 'a-meta', 'a-jit'];
const dim = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'dim' as const]));

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'JIT-App und Native-AOT-Programm im Vergleich',
  code: {
    cs: `// A: dotnet publish -c Release                (framework-abhängig, JIT)
// B: dotnet publish -c Release -r linux-x64 -p:PublishAot=true
static class Program
{
    static readonly int[] Primes = { 2, 3, 5, 7 };

    static void Main()
    {
        var o = new Order("Tee", 3.5m);
        Console.WriteLine($"{o.Name} {Primes[2]}");
    }
}

record Order(string Name, decimal Price);`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        tables: tables({
          status: { 'j-host': 'active', ...dim(ALL_AOT) },
          follow: ['j-host'],
        }),
        facts: [fact('f-start', 'Start A', 'Host sucht Runtime und Framework')],
      },
      changed: ['j-host', 'f-start'],
      explanation:
        'Variante A ist eine gewöhnliche framework-abhängige App. Ihr Starter findet `hostfxr`, der liest die `runtimeconfig.json` und wählt eine installierte Runtime. Die Kette beschreibt die Lektion „Der Host: dotnet, hostfxr, hostpolicy“.',
    },
    {
      codeLine: 9,
      state: {
        tables: tables({
          status: { 'j-clr': 'active', 'j-bcl': 'active', 'j-app': 'active', ...dim(ALL_AOT) },
          follow: ['j-clr'],
        }),
        facts: [
          fact('f-start', 'Start A', 'Runtime läuft'),
          fact('f-mt', 'MethodTable Order', 'zur Laufzeit aus Metadaten gebaut'),
        ],
      },
      changed: ['j-clr', 'j-bcl', 'j-app', 'f-start', 'f-mt'],
      explanation:
        'Die Runtime lädt CoreLib und `App.dll`. Für `Order` liest der Typlader die Metadaten und baut die MethodTable im Speicher zusammen, wie in „Wie ein Typ geladen wird“ beschrieben. Das passiert für jeden Typ beim ersten Gebrauch.',
    },
    {
      codeLine: 7,
      state: {
        tables: tables({
          status: { 'j-jit': 'active', 'j-app': 'match', ...dim(ALL_AOT) },
          follow: ['j-jit'],
        }),
        facts: [
          fact('f-start', 'Start A', 'JIT übersetzt Main'),
          fact('f-later', 'Später', 'Tier 1, Dynamic PGO'),
        ],
      },
      changed: ['j-jit', 'j-app', 'f-start', 'f-later'],
      explanation:
        '`Main` hat noch keinen Maschinencode, der JIT übersetzt es aus dem IL von `App.dll`. Framework-Code kommt meist vorkompiliert als ReadyToRun. Der JIT bleibt für die ganze Lebenszeit im Prozess und kann heiße Methoden später besser übersetzen.',
    },
    {
      codeLine: 2,
      state: {
        tables: tables({
          status: { ...dim(ALL_JIT), 'a-code': 'active', 'a-rt': 'active' },
        }),
        facts: [
          fact('f-start', 'Start B', 'Betriebssystem lädt eine Datei'),
          fact('f-host', 'Host, runtimeconfig', 'nicht beteiligt'),
        ],
      },
      changed: ['a-code', 'a-rt', 'f-start', 'f-host'],
      explanation:
        'Variante B ist eine einzige native Programmdatei. Das Betriebssystem lädt sie wie jedes C-Programm, es gibt keinen Host, keine Versionsauflösung und keine IL-Dateien. Eine schlanke Runtime mit GC, Thread-Verwaltung und Ausnahmebehandlung ist fest hineingelinkt.',
    },
    {
      codeLine: 9,
      state: {
        tables: tables({
          status: { ...dim(ALL_JIT), 'a-code': 'active', 'a-mt': 'match' },
          follow: ['a-code'],
        }),
        facts: [
          fact('f-mt', 'MethodTable Order', 'liegt fertig in der Datei'),
          fact('f-load', 'Typladen zur Laufzeit', 'entfällt weitgehend'),
        ],
      },
      changed: ['a-code', 'a-mt', 'f-mt', 'f-load'],
      explanation:
        '`new Order(...)` braucht die MethodTable von `Order`. Der Compiler hat sie beim Veröffentlichen berechnet und als Daten in die Datei geschrieben, der Code verweist direkt darauf. Ein Typlader, der Metadaten liest, ist dafür nicht nötig.',
    },
    {
      codeLine: 5,
      state: {
        tables: tables({
          status: { ...dim(ALL_JIT), 'a-main': 'active', 'a-frozen': 'match' },
          follow: ['a-main'],
        }),
        facts: [
          fact('f-pre', 'Primes', 'beim Veröffentlichen berechnet'),
          fact('f-cctor', 'Statischer Konstruktor', 'läuft nicht zur Laufzeit'),
        ],
      },
      changed: ['a-main', 'a-frozen', 'f-pre', 'f-cctor'],
      explanation:
        'Der statische Konstruktor von `Program` füllt nur ein Array mit Konstanten. Der Compiler kann ihn deshalb schon beim Veröffentlichen ausführen und das fertige Array als **eingefrorenes Objekt** in die Datei legen. Diese Vorinitialisierung spart Arbeit beim Start.',
    },
    {
      codeLine: 10,
      state: {
        tables: tables({
          status: { ...dim(ALL_JIT), 'a-jit': 'miss', 'j-jit': 'active' },
        }),
        facts: [
          fact('f-tier', 'Tier 1, Dynamic PGO', 'gibt es nicht'),
          fact('f-emit', 'Code zur Laufzeit erzeugen', 'unmöglich'),
        ],
      },
      changed: ['a-jit', 'j-jit', 'f-tier', 'f-emit'],
      explanation:
        'Häufige Fehlannahme: „Native AOT macht jede App schneller.“ Schneller wird vor allem der **Start**. Ohne JIT gibt es keine zweite Übersetzung mit Profildaten, im Dauerbetrieb kann die JIT-App deshalb gleichziehen oder vorbeiziehen.',
    },
  ],
});
