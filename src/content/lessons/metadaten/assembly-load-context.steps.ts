import { defineStepScript, type GraphState } from '@/components/viz';

// Load-by-name order after "Managed assembly loading algorithm" on Microsoft Learn: determine the
// active ALC (for a static reference the ALC that loaded the referring assembly), then cache-by-name,
// AssemblyLoadContext.Load, AssemblyLoadContext.Default (cache and default probing over the TPA
// list), the Resolving event of the active ALC, AppDomain.AssemblyResolve. PluginLoadContext as in
// the plugin tutorial on Microsoft Learn (AssemblyDependencyResolver with the plugin's deps.json).
// TODO(verify): That AssemblyDependencyResolver.ResolveAssemblyToPath returns null for framework
// assemblies (System.Runtime) and for assemblies excluded with Private=false / ExcludeAssets=runtime.
// TODO(verify): Versions (Newtonsoft.Json 13.0.0.0 in the plugin, 12.0.0.0 in the host) are examples.
// TODO(verify): Exact FileNotFoundException message when all steps return null.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

// Row 2: the order for loading by name, left to right. Row 1: where the search ends when a step
// delivers. Row 3: both events, then failure, right to left.
const NODES: Omit<Node, 'status'>[] = [
  { id: 'hit-cache', label: 'Aus dem Cache', row: 1, col: 2, shape: 'end' },
  {
    id: 'hit-load',
    label: 'Eigene Kopie',
    detail: 'im Plugin-Kontext',
    row: 1,
    col: 3,
    shape: 'end',
  },
  {
    id: 'hit-default',
    label: 'Vom Default-Kontext',
    detail: 'geteilt mit dem Host',
    row: 1,
    col: 4,
    shape: 'end',
  },
  { id: 'active', label: 'Aktiver Kontext', detail: 'wer fragt?', row: 2, col: 1 },
  {
    id: 'cache',
    label: 'Im eigenen Cache?',
    detail: 'schon geladen?',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'load',
    label: 'Load() liefert?',
    detail: 'Überschreibung',
    row: 2,
    col: 3,
    shape: 'decision',
  },
  {
    id: 'default',
    label: 'Default findet?',
    detail: 'Cache, TPA-Liste',
    row: 2,
    col: 4,
    shape: 'decision',
  },
  { id: 'resolving', label: 'Resolving', detail: 'Ereignis des Kontexts', row: 3, col: 4 },
  { id: 'appdomain', label: 'AssemblyResolve', detail: 'Ereignis der AppDomain', row: 3, col: 3 },
  { id: 'fail', label: 'FileNotFoundException', row: 3, col: 2, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'active', to: 'cache' },
  { from: 'cache', to: 'hit-cache', label: 'ja' },
  { from: 'cache', to: 'load', label: 'nein' },
  { from: 'load', to: 'hit-load', label: 'Assembly' },
  { from: 'load', to: 'default', label: 'null' },
  { from: 'default', to: 'hit-default', label: 'ja' },
  { from: 'default', to: 'resolving', label: 'nein' },
  { from: 'resolving', to: 'appdomain', label: 'null' },
  { from: 'appdomain', to: 'fail', label: 'null' },
];

/** Graph for one run: `path` lists the visited nodes in order, the last one is active unless
 * `noActive` is set. `skipped` marks nodes this kind of load does not ask at all. */
function run(path: string[], { skipped = [] as string[], noActive = false } = {}): GraphState {
  const visited = new Set(path);
  const last = noActive ? undefined : path[path.length - 1];
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status:
        n.id === last
          ? 'active'
          : visited.has(n.id)
            ? 'done'
            : skipped.includes(n.id)
              ? 'skipped'
              : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
  };
}
const BY_PATH_SKIPPED = NODES.map((n) => n.id).filter((id) => id !== 'active' && id !== 'cache');

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Ein Plugin-Kontext löst seine Abhängigkeiten auf',
  code: {
    cs: `class PluginLoadContext : AssemblyLoadContext
{
    private readonly AssemblyDependencyResolver _resolver;

    public PluginLoadContext(string pluginPath)
        => _resolver = new AssemblyDependencyResolver(pluginPath);

    protected override Assembly? Load(AssemblyName name)
    {
        string? path = _resolver.ResolveAssemblyToPath(name);
        return path is null ? null : LoadFromAssemblyPath(path);
    }
}

// im Host
var ctx = new PluginLoadContext(@"plugins/Wetter/Wetter.dll");
Assembly plugin = ctx.LoadFromAssemblyPath(@"plugins/Wetter/Wetter.dll");
// Wetter.dll verweist auf Newtonsoft.Json, Contracts und Fehlt`,
  },
  steps: [
    {
      codeLine: 17,
      state: {
        ...run(['active', 'cache'], { skipped: BY_PATH_SKIPPED, noActive: true }),
        facts: [
          fact('f-ctx', 'Kontext', 'PluginLoadContext'),
          fact('f-asm', 'Geladen', 'Wetter.dll, aus dem Pfad'),
          fact('f-deps', 'Abhängigkeiten', 'noch keine geladen'),
        ],
      },
      changed: ['f-ctx', 'f-asm', 'f-deps'],
      explanation:
        'Laden per Pfad ist einfach: Der Kontext prüft seinen Cache und lädt dann genau diese Datei. `Load()` wird dafür nicht gefragt. Die Abhängigkeiten von `Wetter.dll` sind noch nicht geladen, das passiert erst, wenn Code sie braucht.',
    },
    {
      codeLine: 18,
      state: {
        ...run(['active']),
        facts: [
          fact('f-need', 'Gesucht', 'Newtonsoft.Json, Version 13.0.0.0'),
          fact('f-who', 'Verweis aus', 'Wetter.dll'),
          fact('f-ctx', 'Aktiver Kontext', 'PluginLoadContext'),
        ],
      },
      changed: ['f-need', 'f-who', 'f-ctx'],
      explanation:
        'Der JIT übersetzt eine Methode des Plugins und braucht einen Typ aus `Newtonsoft.Json`. Für einen statischen Verweis ist der **aktive Kontext** immer der, der die verweisende Assembly geladen hat. Weil `Wetter.dll` im Plugin-Kontext liegt, wird dieser gefragt, nicht der Default-Kontext.',
    },
    {
      codeLine: 10,
      state: {
        ...run(['active', 'cache', 'load', 'hit-load']),
        facts: [
          fact('f-cache', 'Cache', 'kein Eintrag für Newtonsoft.Json'),
          fact('f-res', 'Resolver', 'plugins/Wetter/Newtonsoft.Json.dll'),
          fact('f-loaded', 'Ergebnis', 'Version 13 im Plugin-Kontext'),
        ],
      },
      changed: ['f-cache', 'f-res', 'f-loaded'],
      explanation:
        'Der Cache kennt den Namen noch nicht, also ruft der Kontext deine Überschreibung von `Load` auf. Der Resolver liest die `Wetter.deps.json` und findet die Datei im Plugin-Ordner. Dass der Host selbst Version 12 im Default-Kontext hat, stört nicht: Jeder Kontext hat seinen eigenen Cache.',
    },
    {
      codeLine: 11,
      state: {
        ...run(['active', 'cache', 'load', 'default', 'hit-default']),
        facts: [
          fact('f-need', 'Gesucht', 'Contracts'),
          fact('f-res', 'Resolver', 'null: nicht im Plugin-Ordner'),
          fact('f-def', 'Default-Kontext', 'findet Contracts.dll in der TPA-Liste'),
          fact('f-shared', 'Ergebnis', 'dieselbe Assembly wie im Host'),
        ],
      },
      changed: ['f-need', 'f-res', 'f-def', 'f-shared'],
      explanation:
        'Für `Contracts` liefert der Resolver `null`, weil das Plugin die Datei bewusst nicht mitbringt. Dann fragt die Runtime den **Default-Kontext**, und der liefert die Assembly, die der Host schon benutzt. So teilen Host und Plugin dieselben Schnittstellen. Framework-Assemblies wie `System.Runtime` kommen auf demselben Weg.',
    },
    {
      codeLine: 18,
      state: {
        ...run(['active', 'cache', 'load', 'default', 'resolving']),
        facts: [
          fact('f-need', 'Gesucht', 'Fehlt'),
          fact('f-res', 'Load()', 'null'),
          fact('f-def', 'Default-Kontext', 'nicht gefunden'),
          fact('f-ev', 'Resolving', 'Handler in Registrierungsreihenfolge'),
        ],
      },
      changed: ['f-need', 'f-res', 'f-def', 'f-ev'],
      explanation:
        'Für `Fehlt` liefert weder `Load` noch der Default-Kontext etwas. Jetzt löst der aktive Kontext sein Ereignis **Resolving** aus. Der erste Handler, der eine Assembly zurückgibt, beendet die Suche. Das ist der Platz für Notlösungen, etwa eine Suche in zusätzlichen Ordnern.',
    },
    {
      codeLine: 18,
      state: {
        ...run(['active', 'cache', 'load', 'default', 'resolving', 'appdomain', 'fail']),
        facts: [
          fact('f-ev2', 'AssemblyResolve', 'letzte Chance, ebenfalls null'),
          fact('f-exc', 'Ergebnis', 'FileNotFoundException'),
          fact('f-where', 'Sichtbar', 'beim Übersetzen der Methode, die Fehlt braucht'),
        ],
      },
      changed: ['f-ev2', 'f-exc', 'f-where'],
      explanation:
        'Als Letztes kommt das alte Ereignis `AppDomain.AssemblyResolve`, das es aus Kompatibilitätsgründen noch gibt. Liefert auch das nichts, scheitert das Laden mit einer `FileNotFoundException`, und zwar dort, wo die Assembly gebraucht wurde, typischerweise beim Übersetzen einer Methode.',
    },
    {
      codeLine: 8,
      state: {
        ...run(['active', 'cache', 'load', 'default']),
        facts: [
          fact('f-myth', 'Fehlannahme', '„Der Default-Kontext wird zuerst gefragt.“'),
          fact('f-truth', 'Tatsächlich', 'erst eigener Cache, dann Load(), dann Default'),
        ],
      },
      changed: ['f-myth', 'f-truth'],
      explanation:
        'Fehlannahme: „Ein eigener Kontext ergänzt nur, was der Default-Kontext nicht findet.“ Es ist umgekehrt: Dein `Load` hat Vorrang. Genau deshalb kann ein Plugin eine andere Version einer Bibliothek benutzen als der Host, und genau deshalb musst du gemeinsame Assemblies bewusst mit `null` an den Default-Kontext abgeben.',
    },
  ],
});
