import { defineStepScript, type TableState } from '@/components/viz';

// How hostpolicy turns App.deps.json into the probing properties.
// The package "Demo.Zip" is fictional; the structure follows the deps.json format.
// Sources: dotnet/runtime docs/design/features/host-probing.md, host-runtime-information.md,
// Microsoft Learn "Default probing" (dependency-loading/default-probing), "RID catalog".
// TODO(verify): Exact deps.json shape for a portable (RID-less) build with runtimeTargets
// (keys "rid" and "assetType", "resources" with "locale").
// TODO(verify): That hostpolicy flattens package assets to the file name in the app directory
// for build output, but keeps the relative path for runtimeTargets assets
// (runtimes/linux-x64/native/...).
// TODO(verify): That since .NET 8 the host uses a fixed list of portable RIDs instead of the
// RID graph (breaking change "RID-specific assets resolved using a known set of RIDs").

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

/** Which rows are highlighted, which references are followed and which result rows exist. */
interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[]; // row ids whose references are drawn
  filled?: string[]; // result rows (TPA, native, resources) added so far
}

// Left: what App.deps.json (libraries as group rows) and the framework deps.json declare.
// Right: what hostpolicy builds.
function tables({ status = {}, follow = [], filled = [] }: Look): Table[] {
  const row = (id: string, cells: string[], refs?: Row['refs']): Row => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(refs && follow.includes(id) ? { refs } : {}),
  });
  /** Result table: only the rows added so far, or a placeholder. */
  const result = (id: string, rows: Row[]): Row[] => {
    const shown = rows.filter((r) => filled.includes(r.id));
    return shown.length > 0 ? shown : [{ id: `${id}-empty`, cells: ['leer'], status: 'dim' }];
  };
  return [
    {
      id: 't-assets',
      title: 'App.deps.json: targets',
      columns: ['Art', 'Datei', 'Für'],
      row: 1,
      col: 1,
      rows: [
        row('lib-app', ['Bibliothek', 'App 1.0.0', '']),
        row('a-app', ['runtime', 'App.dll', 'alle'], [{ col: 1, to: 'tpa-app' }]),
        row('lib-bk', ['Bibliothek', 'Demo.Zip 2.1.0', '']),
        row('a-bk', ['runtime', 'Demo.Zip.dll', 'alle'], [{ col: 1, to: 'tpa-bk' }]),
        row(
          'a-linux',
          ['runtimeTargets', 'libdemozip.so', 'linux-x64'],
          [{ col: 1, to: 'nat-rid' }],
        ),
        row('a-win', ['runtimeTargets', 'demozip.dll', 'win-x64']),
        row('a-res', ['resources', 'de/….resources.dll', 'de'], [{ col: 1, to: 'res-de' }]),
      ],
    },
    {
      id: 't-fw',
      title: 'Microsoft.NETCore.App.deps.json',
      columns: ['Art', 'Datei'],
      row: 2,
      col: 1,
      rows: [
        row(
          'fw-corelib',
          ['runtime', 'System.Private.CoreLib.dll'],
          [{ col: 1, to: 'tpa-corelib' }],
        ),
        row('fw-rt', ['runtime', 'System.Runtime.dll'], [{ col: 1, to: 'tpa-rt' }]),
      ],
    },
    {
      id: 't-tpa',
      title: 'TPA-Liste',
      columns: ['Pfad'],
      row: 1,
      col: 2,
      rows: result('t-tpa', [
        row('tpa-app', ['<App>/App.dll']),
        row('tpa-bk', ['<App>/Demo.Zip.dll']),
        row('tpa-corelib', ['<FW>/System.Private.CoreLib.dll']),
        row('tpa-rt', ['<FW>/System.Runtime.dll']),
      ]),
    },
    {
      id: 't-native',
      title: 'Native Suchpfade',
      columns: ['Ordner'],
      row: 2,
      col: 2,
      rows: result('t-native', [
        row('nat-rid', ['<App>/runtimes/linux-x64/native/']),
        row('nat-app', ['<App>']),
        row('nat-fw', ['<FW>']),
      ]),
    },
    {
      id: 't-res',
      title: 'Ressourcen',
      columns: ['Datei'],
      row: 3,
      col: 2,
      rows: result('t-res', [row('res-de', ['de/Demo.Zip.resources.dll'])]),
    },
  ];
}

const APP = ['tpa-app', 'tpa-bk', 'res-de'];
const RID = [...APP, 'nat-rid'];
const FW = [...RID, 'tpa-corelib', 'tpa-rt'];
const ALL = [...FW, 'nat-app', 'nat-fw'];

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Von der deps.json zur TPA-Liste',
  code: {
    cs: `// App.deps.json (gekürzt, Paket frei erfunden)
"targets": {
  ".NETCoreApp,Version=v8.0": {
    "App/1.0.0": {
      "dependencies": { "Demo.Zip": "2.1.0" },
      "runtime": { "App.dll": {} }
    },
    "Demo.Zip/2.1.0": {
      "runtime": {
        "lib/net6.0/Demo.Zip.dll": {}
      },
      "runtimeTargets": {
        "runtimes/linux-x64/native/libdemozip.so": {
          "rid": "linux-x64", "assetType": "native" },
        "runtimes/win-x64/native/demozip.dll": {
          "rid": "win-x64", "assetType": "native" }
      },
      "resources": {
        "lib/net6.0/de/Demo.Zip.resources.dll": {
          "locale": "de" }
      }
    }
  }
},
"libraries": {
  "Demo.Zip/2.1.0": {
    "type": "package", "path": "demo.zip/2.1.0" }
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        tables: tables({}),
        facts: [
          fact('f-who', 'Leser', 'hostpolicy aus shared/Microsoft.NETCore.App/8.0.11/'),
          fact('f-os', 'Maschine', 'Linux, x64'),
        ],
      },
      changed: ['f-who', 'f-os'],
      explanation:
        '`hostpolicy` öffnet `App.deps.json`. Die Datei hat zwei Hauptteile: `targets` sagt, welche Dateien jede Bibliothek zur Laufzeit beisteuert, `libraries` sagt, woher die Bibliothek stammt (Paket oder Projekt) und unter welchem Pfad sie in einem Paketordner läge.',
    },
    {
      codeLine: 3,
      state: {
        tables: tables({ status: { 'lib-app': 'active', 'lib-bk': 'active' } }),
        facts: [
          fact('f-target', 'Ziel', '.NETCoreApp,Version=v8.0'),
          fact('f-port', 'Art', 'portabel, ohne RID im Namen'),
        ],
      },
      changed: ['f-target', 'f-port'],
      explanation:
        'Ohne `RuntimeIdentifier` beim Build gibt es ein portables Ziel, das auf jedem Betriebssystem laufen soll. Plattformspezifische Dateien stehen dann nicht direkt im Ziel, sondern unter `runtimeTargets` mit ihrer RID.',
    },
    {
      codeLine: 10,
      state: {
        tables: tables({
          status: { 'a-app': 'active', 'a-bk': 'active', 'a-res': 'active' },
          follow: ['lib-app', 'lib-bk', 'a-app', 'a-bk', 'a-res'],
          filled: APP,
        }),
        facts: [
          fact('f-tpa', 'TPA', '<App-Ordner>/App.dll, <App-Ordner>/Demo.Zip.dll'),
          fact('f-res', 'Ressourcen', 'de/Demo.Zip.resources.dll'),
        ],
      },
      changed: ['f-tpa', 'f-res'],
      explanation:
        'Jede Datei unter `runtime` ist eine verwaltete Assembly und kommt mit vollem Pfad auf die **TPA-Liste**. Der Pfad `lib/net6.0/...` beschreibt die Lage im NuGet-Paket. Nach `dotnet build` liegt die Datei direkt im App-Ordner, und dort findet `hostpolicy` sie.',
    },
    {
      codeLine: 13,
      state: {
        tables: tables({
          status: { 'a-linux': 'match', 'a-win': 'miss' },
          follow: ['lib-app', 'lib-bk', 'a-app', 'a-bk', 'a-res', 'a-linux'],
          filled: RID,
        }),
        facts: [
          fact('f-rids', 'Angeboten', 'linux-x64, win-x64'),
          fact('f-mine', 'Eigene RID', 'linux-x64'),
          fact('f-pick', 'Gewählt', 'runtimes/linux-x64/native/libdemozip.so'),
        ],
      },
      changed: ['f-rids', 'f-mine', 'f-pick'],
      explanation:
        'Für `runtimeTargets` wählt `hostpolicy` den Eintrag, dessen RID am besten zur Maschine passt. Gibt es kein `linux-x64`, versucht es allgemeinere RIDs wie `linux`, `unix` und `any`. Die gewählte Datei bestimmt einen nativen Suchpfad, `win-x64` wird ignoriert.',
    },
    {
      codeLine: 1,
      state: {
        tables: tables({
          status: { 'fw-corelib': 'active', 'fw-rt': 'active' },
          follow: ['lib-app', 'lib-bk', 'a-app', 'a-bk', 'a-res', 'a-linux', 'fw-corelib', 'fw-rt'],
          filled: FW,
        }),
        facts: [
          fact('f-fwdeps', 'Gelesen', 'Microsoft.NETCore.App.deps.json'),
          fact('f-fwtpa', 'TPA dazu', 'System.Private.CoreLib.dll, System.Runtime.dll, ...'),
          fact('f-conf', 'Doppelte Assembly', 'höhere Version gewinnt'),
        ],
      },
      changed: ['f-fwdeps', 'f-fwtpa', 'f-conf'],
      explanation:
        'Dasselbe passiert mit der `deps.json` jedes Frameworks. Bringen App und Framework dieselbe Assembly mit, kommt nur eine Datei auf die Liste, ausgewählt nach Assembly- und Dateiversion.',
    },
    {
      state: {
        tables: tables({
          status: Object.fromEntries(ALL.map((id) => [id, 'match' as const])),
          follow: ['lib-app', 'lib-bk', 'a-app', 'a-bk', 'a-res', 'a-linux', 'fw-corelib', 'fw-rt'],
          filled: ALL,
        }),
        facts: [
          fact('f-p1', 'TRUSTED_PLATFORM_ASSEMBLIES', 'App, Paket, Framework (volle Pfade)'),
          fact(
            'f-p2',
            'NATIVE_DLL_SEARCH_DIRECTORIES',
            '<App-Ordner>/runtimes/linux-x64/native/, App-Ordner, Framework-Ordner',
          ),
          fact('f-p3', 'PLATFORM_RESOURCE_ROOTS', 'Ordner für Satelliten-Assemblies'),
          fact('f-p4', 'APP_CONTEXT_DEPS_FILES', 'Pfad zu App.deps.json'),
        ],
      },
      changed: ['f-p1', 'f-p2', 'f-p3', 'f-p4'],
      explanation:
        'Am Ende stehen Pfadlisten, getrennt durch `:` unter Unix und `;` unter Windows, in denen die Runtime später nur noch nachschlägt. Häufige Fehlannahme: „Die `deps.json` ist nur Information für Werkzeuge.“ Sie entscheidet, was ladbar ist.',
    },
  ],
});
