import { defineStepScript, type GraphState } from '@/components/viz';

// A simplified decision guide. It encodes the trade-offs described in the Microsoft Learn pages on
// ReadyToRun, Native AOT and runtime compilation settings, not a measured rule. Real decisions
// need measurements of the own app.
// TODO(verify): That Native AOT reduces working set compared to JIT for typical ASP.NET Core apps
// (ASP.NET Core Native AOT docs mention smaller memory footprint).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'app', label: 'Deine App', row: 1, col: 1, shape: 'state' },
  {
    id: 'life',
    label: 'Läuft der Prozess lange?',
    detail: 'Minuten bis Wochen',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'warm',
    label: 'Zählen die ersten Sekunden?',
    detail: 'Skalieren, Deployments',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'jit', label: 'JIT-Standard', detail: 'Tiering und PGO', row: 1, col: 4, shape: 'end' },
  {
    id: 'mem',
    label: 'Speicher pro Instanz knapp?',
    detail: 'viele kleine Container',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  { id: 'r2r', label: 'ReadyToRun', detail: 'plus Tiering', row: 2, col: 4, shape: 'end' },
  {
    id: 'compat',
    label: 'Ohne dynamischen Code machbar?',
    detail: 'keine Warnungen beim AOT-Publish',
    row: 3,
    col: 2,
    shape: 'decision',
  },
  { id: 'aot', label: 'Native AOT', detail: 'kein JIT', row: 3, col: 3, shape: 'end' },
  {
    id: 'r2rb',
    label: 'ReadyToRun',
    detail: 'Reflection bleibt möglich',
    row: 4,
    col: 2,
    shape: 'end',
  },
];

const EDGES: Edge[] = [
  { from: 'app', to: 'life' },
  { from: 'life', to: 'warm', label: 'ja' },
  { from: 'life', to: 'compat', label: 'nein' },
  { from: 'warm', to: 'jit', label: 'nein' },
  { from: 'warm', to: 'mem', label: 'ja' },
  { from: 'mem', to: 'r2r', label: 'nein' },
  { from: 'mem', to: 'compat', label: 'ja' },
  { from: 'compat', to: 'aot', label: 'ja' },
  { from: 'compat', to: 'r2rb', label: 'nein' },
];

/** Graph for one walk: `path` lists the visited nodes in order, the last one is active. */
function walk(path: string[], facts: Fact[]): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    title: 'Welche Variante passt zu meiner App?',
    nodes: NODES.map((n) => ({
      ...n,
      status: n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const facts = (scenario: string, result: string, price: string): Fact[] => [
  { id: 'f-scenario', label: 'Szenario', value: scenario },
  { id: 'f-result', label: 'Ergebnis', value: result },
  { id: 'f-price', label: 'Preis', value: price },
];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Entscheidungshilfe: JIT, ReadyToRun oder Native AOT',
  code: {
    cs: `<!-- JIT-Standard: nichts einstellen -->

<!-- ReadyToRun -->
<PublishReadyToRun>true</PublishReadyToRun>
<RuntimeIdentifier>linux-x64</RuntimeIdentifier>

<!-- Native AOT (schließt Trimming ein) -->
<PublishAot>true</PublishAot>

<!-- Nur zum Messen und Vergleichen -->
<TieredCompilation>false</TieredCompilation>
<TieredPGO>false</TieredPGO>`,
  },
  steps: [
    {
      codeLine: 1,
      state: walk(['app'], []),
      changed: ['app'],
      explanation:
        'Die Entscheidung hängt an zwei Fragen: Wie lange lebt ein Prozess, und wie viel Gewicht hat die Zeit bis zur ersten Antwort im Verhältnis zum Dauerbetrieb? Die dritte Frage ist eine harte Grenze: ob die App ohne Code auskommt, der erst zur Laufzeit entsteht.',
    },
    {
      codeLine: 1,
      state: walk(
        ['app', 'life', 'warm', 'jit'],
        facts('Web-API, läuft wochenlang', 'JIT-Standard', 'erste Anfragen langsamer'),
      ),
      changed: ['life', 'warm', 'jit', 'f-scenario', 'f-result', 'f-price'],
      explanation:
        'Eine Web-API, die selten neu startet, verbringt fast ihre gesamte Lebenszeit im Dauerbetrieb. Ein paar langsamere Sekunden nach dem Start fallen kaum ins Gewicht. Hier spielen Tiering und Dynamic PGO ihre Stärke aus, also bleibt es beim Standard.',
    },
    {
      codeLine: 4,
      state: walk(
        ['app', 'life', 'warm', 'mem', 'r2r'],
        facts('Dienst mit automatischer Skalierung', 'ReadyToRun', 'größere Dateien'),
      ),
      changed: ['warm', 'mem', 'r2r', 'f-scenario', 'f-result', 'f-price'],
      explanation:
        'Startet der Dienst bei Lastspitzen neue Instanzen, zählt die Zeit bis zur ersten Antwort. ReadyToRun verkürzt sie, ohne etwas am Programmiermodell zu ändern, und im Dauerbetrieb übernimmt wieder der JIT. Der Preis: Die Assemblies enthalten IL **und** Maschinencode und werden größer.',
    },
    {
      codeLine: 8,
      state: walk(
        ['app', 'life', 'warm', 'mem', 'compat', 'aot'],
        facts('Viele kleine Container', 'Native AOT', 'kein PGO, kein dynamischer Code'),
      ),
      changed: ['mem', 'compat', 'aot', 'f-scenario', 'f-result', 'f-price'],
      explanation:
        'Laufen Hunderte kleine Instanzen mit wenig Speicher, zählt jedes Megabyte Working Set. Native AOT spart den JIT samt seinen Datenstrukturen. Das geht aber nur, wenn die App beim Veröffentlichen ohne AOT- und Trim-Warnungen durchkommt.',
    },
    {
      codeLine: 8,
      state: walk(
        ['app', 'life', 'compat', 'aot'],
        facts(
          'CLI-Tool oder Serverless-Funktion',
          'Native AOT',
          'längerer Build, plattformgebunden',
        ),
      ),
      changed: ['life', 'compat', 'aot', 'f-scenario', 'f-result', 'f-price'],
      explanation:
        'Ein Kommandozeilenwerkzeug oder eine Funktion, die pro Aufruf kalt startet, erreicht Tier 1 nie. Die Laufzeit besteht fast nur aus Start. Hier ist Native AOT der stärkste Hebel, sofern die App kompatibel ist.',
    },
    {
      codeLine: 4,
      state: walk(
        ['app', 'life', 'compat', 'r2rb'],
        facts('CLI-Tool mit Plugins per Reflection', 'ReadyToRun', 'JIT für Plugins bleibt'),
      ),
      changed: ['compat', 'r2rb', 'f-scenario', 'f-result', 'f-price'],
      explanation:
        'Lädt das Werkzeug Plugins zur Laufzeit oder erzeugt Code per `Reflection.Emit`, scheidet Native AOT aus. ReadyToRun bringt trotzdem einen großen Teil des Startgewinns. Der JIT bleibt für alles, was erst zur Laufzeit dazukommt.',
    },
  ],
});
