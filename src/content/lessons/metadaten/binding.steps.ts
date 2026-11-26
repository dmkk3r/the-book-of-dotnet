import { defineStepScript, type GraphState } from '@/components/viz';

// How the default AssemblyLoadContext binds an AssemblyRef via the TPA list.
// Based on src/coreclr/binder/assemblybindercommon.cpp at release/9.0 (checked 2026-11):
//   BindLocked: FindInExecutionContext (already loaded), else BindByTpaList, then IsCompatibleAssemblyVersion.
//   BindByTpaList: lookup by simple name in the TPA map, TestCandidateRefMatchesDef with INCLUDE_DEFAULT
//   (simple name case-insensitive, culture; no public key token, no version), then app paths.
//   IsCompatibleAssemblyVersion: found version must be >= requested, compared component by component.
// Microsoft Learn: the runtime never validates the strong-name signature nor uses it for binding.
// Contoso.Json is a fictional library; the public key token is fictional.
// TODO(verify): That the binding of a TypeRef is triggered while the JIT compiles the calling method (Tier0),
// not when App.dll is loaded.
// TODO(verify): That a name or culture mismatch after a TPA hit is rejected with FUSION_E_REF_DEF_MISMATCH
// (FileLoadException), like a too low version. The graph only says "abgelehnt".
// The graph leaves out the app paths (APP_PATHS) after the TPA list, they are normally empty.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

// Checks left to right; cache hit and file check both end in the version check.
const NODES: Omit<Node, 'status'>[] = [
  {
    id: 'ref',
    label: 'AssemblyRef',
    detail: 'Name, Version, Kultur, Token',
    row: 1,
    col: 1,
  },
  {
    id: 'cache',
    label: 'Schon geladen?',
    detail: 'Cache des Kontexts',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'ver',
    label: 'Version reicht?',
    detail: 'gefunden ≥ verlangt',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'ok', label: 'Assembly geladen', row: 1, col: 4, shape: 'end' },
  {
    id: 'tpa',
    label: 'Auf TPA-Liste?',
    detail: 'nur einfacher Name',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'name',
    label: 'Name und Kultur gleich?',
    detail: 'Manifest der Datei',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  { id: 'rej', label: 'Abgelehnt', detail: 'Datei passt nicht', row: 2, col: 4, shape: 'end' },
  {
    id: 'nf',
    label: 'Nicht gefunden',
    detail: 'FileNotFoundException',
    row: 3,
    col: 2,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'ref', to: 'cache' },
  { from: 'cache', to: 'ver', label: 'ja' },
  { from: 'cache', to: 'tpa', label: 'nein' },
  { from: 'tpa', to: 'name', label: 'gefunden' },
  { from: 'tpa', to: 'nf', label: 'fehlt' },
  { from: 'name', to: 'ver', label: 'ja' },
  { from: 'name', to: 'rej', label: 'nein' },
  { from: 'ver', to: 'ok', label: 'ja' },
  { from: 'ver', to: 'rej', label: 'nein' },
];

/** Graph for one run: `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], facts: Fact[], details: Record<string, string> = {}): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const ref = {
  id: 'f-ref',
  label: 'Verlangt',
  value: 'Contoso.Json, Version=2.1.0.0, Culture=neutral',
};

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wie der Default-Kontext eine AssemblyRef bindet',
  code: {
    cs: `// App.dll, gebaut gegen das Paket Contoso.Json 2.1.0
var doc = Contoso.Json.Parser.Parse(text);

// AssemblyRef in App.dll (Metadatentabelle 0x23):
//   Contoso.Json, Version=2.1.0.0, Culture=neutral,
//   PublicKeyToken=0a1b2c3d4e5f6071   (fiktiv)

// TPA-Liste, gebaut von hostpolicy aus App.deps.json:
//   /srv/app/Contoso.Json.dll   (Paket 2.3.0, AssemblyVersion 2.3.0.0)

// Später ruft Contoso.Http in den Default-Kontext:
//   verlangt Contoso.Json, Version=2.0.0.0`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(
        ['ref'],
        [ref, { id: 'f-why', label: 'Auslöser', value: 'JIT braucht den Typ Parser' }],
      ),
      changed: ['f-ref', 'f-why'],
      explanation:
        'Der JIT übersetzt die Methode und stößt auf `Contoso.Json.Parser`. Der TypeRef führt zu einer **AssemblyRef**: Name, Version, Kultur und Public Key Token, so wie der Compiler sie beim Build aus der Referenz abgeschrieben hat. Diese vier Teile sind die Identität, nach der gesucht wird.',
    },
    {
      codeLine: 2,
      state: run(
        ['ref', 'cache'],
        [
          ref,
          { id: 'f-alc', label: 'Aktiver Kontext', value: 'Default (hat App.dll geladen)' },
          { id: 'f-cache', label: 'Contoso.Json geladen?', value: 'nein' },
        ],
      ),
      changed: ['f-alc', 'f-cache'],
      explanation:
        'Gesucht wird in dem Kontext, der die verweisende Assembly geladen hat, hier im Default-Kontext. Zuerst schaut der Binder, ob dort schon eine Assembly mit diesem Namen geladen ist. Beim ersten Zugriff ist das nicht der Fall.',
    },
    {
      codeLine: 9,
      state: run(
        ['ref', 'cache', 'tpa'],
        [
          ref,
          { id: 'f-key', label: 'Schlüssel', value: 'Contoso.Json (ohne Endung)' },
          { id: 'f-path', label: 'Treffer', value: '/srv/app/Contoso.Json.dll' },
        ],
      ),
      changed: ['f-key', 'f-path'],
      explanation:
        'Die TPA-Liste ist ein Verzeichnis **einfacher Name zu Pfad**. Version, Kultur und Token spielen beim Nachschlagen keine Rolle, es gibt pro Name nur einen Eintrag. Kein Ordner wird durchsucht, die Entscheidung, welche Datei es ist, hat der Host schon beim Start getroffen.',
    },
    {
      codeLine: 5,
      state: run(
        ['ref', 'cache', 'tpa', 'name'],
        [
          ref,
          {
            id: 'f-def',
            label: 'In der Datei',
            value: 'Contoso.Json, Version=2.3.0.0, Culture=neutral',
          },
          { id: 'f-cmp', label: 'Verglichen', value: 'Name, Kultur' },
          { id: 'f-sig', label: 'Signatur geprüft', value: 'nein' },
        ],
      ),
      changed: ['f-def', 'f-cmp', 'f-sig'],
      explanation:
        'Der Binder öffnet die Datei und liest ihr Manifest. Name und Kultur müssen passen. Das Public Key Token vergleicht er beim TPA-Treffer nicht, und eine Strong-Name-Signatur prüft .NET (Core) laut Microsoft nie.',
    },
    {
      codeLine: 9,
      state: run(
        ['ref', 'cache', 'tpa', 'name', 'ver'],
        [
          ref,
          { id: 'f-found', label: 'Gefunden', value: '2.3.0.0' },
          { id: 'f-rule', label: 'Regel', value: 'gefunden ≥ verlangt, komponentenweise' },
          { id: 'f-ok', label: 'Passt', value: 'ja' },
        ],
      ),
      changed: ['f-found', 'f-rule', 'f-ok'],
      explanation:
        'Jetzt erst zählt die Version. Verglichen wird Haupt-, Neben-, Build- und Revisionsnummer der Reihe nach. 2.3.0.0 ist höher als 2.1.0.0, also passt es. Häufige Fehlannahme: „Dafür brauche ich einen Binding Redirect.“ In .NET (Core) ist eine höhere Version ohne jede Konfiguration in Ordnung.',
    },
    {
      codeLine: 9,
      state: {
        ...run(
          ['ref', 'cache', 'tpa', 'name', 'ver', 'ok'],
          [
            ref,
            { id: 'f-loaded', label: 'Geladen im Default-Kontext', value: 'Contoso.Json 2.3.0.0' },
          ],
          { ok: 'Contoso.Json 2.3.0.0' },
        ),
        output: 'Parser kommt aus Contoso.Json 2.3.0.0',
      },
      changed: ['f-loaded'],
      explanation:
        'Die Assembly ist geladen und steht im Cache des Kontexts. Ab jetzt beantwortet jede Anfrage nach `Contoso.Json` im Default-Kontext diese eine Assembly. Eine zweite Version desselben Namens kann es hier nicht geben.',
    },
    {
      codeLine: 12,
      state: run(
        ['ref', 'cache', 'ver'],
        [
          { id: 'f-ref', label: 'Verlangt', value: 'Contoso.Json, Version=2.0.0.0' },
          { id: 'f-cache', label: 'Contoso.Json geladen?', value: 'ja, 2.3.0.0' },
          { id: 'f-ok', label: 'Passt', value: 'ja, 2.3 ≥ 2.0' },
        ],
        { ver: 'gegen die geladene' },
      ),
      changed: ['f-ref', 'f-cache', 'f-ok'],
      explanation:
        'Eine zweite Bibliothek, gebaut gegen 2.0, fragt dieselbe Assembly an. Der Binder findet sie im Cache und prüft nur noch die Version gegen die **geladene**. 2.3.0.0 erfüllt auch 2.0.0.0. Beide Bibliotheken teilen sich dieselbe Assembly.',
    },
  ],
});
