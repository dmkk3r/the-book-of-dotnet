import { defineStepScript, type GraphState } from '@/components/viz';

// Reachability analysis of ILLink, heavily simplified: only the nodes that matter for the
// example are shown (no CoreLib internals, no interpolated string handler, no Console.ReadLine).
// Sources: Microsoft Learn "Introduction to trim warnings" and "Fixing trim warnings".
// TODO(verify): Whether passing the unknown Type.GetType result to an annotated parameter
// (Activator.CreateInstance / Create) produces an additional warning (IL2072) besides IL2057.
// TODO(verify): Warning code IL2057 for a non-constant string passed to Type.GetType(string).
// TODO(verify): That the SDK roots the app assembly via its entry point (RootMode EntryPoint)
// in TrimMode=full and does not keep all of its types.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];
type Status = Node['status'];
type EdgeStatus = NonNullable<Edge['status']>;

const NODES: Omit<Node, 'status'>[] = [
  { id: 'greeter', label: 'Greeter', detail: 'Typ und Konstruktor', row: 1, col: 2 },
  { id: 'bye', label: 'Greeter.Bye', detail: 'nirgends aufgerufen', row: 1, col: 3 },
  { id: 'main', label: 'Main', detail: 'Einstiegspunkt, Wurzel', row: 2, col: 1, shape: 'state' },
  { id: 'hello', label: 'Greeter.Hello', row: 2, col: 2 },
  { id: 'wl', label: 'Console.WriteLine', detail: 'System.Console.dll', row: 2, col: 3 },
  {
    id: 'gettype',
    label: 'Type.GetType(name)',
    detail: 'name kommt aus der Eingabe',
    row: 3,
    col: 2,
  },
  {
    id: 'warn',
    label: 'Warnung IL2057',
    detail: 'Wert nicht analysierbar',
    row: 3,
    col: 3,
    shape: 'end',
  },
  { id: 'create', label: 'Activator.CreateInstance', row: 4, col: 2 },
  { id: 'audit', label: 'Audit', detail: 'Typ und Konstruktor', row: 4, col: 3 },
];

const EDGES: Edge[] = [
  { from: 'main', to: 'greeter', label: 'new' },
  { from: 'main', to: 'hello', label: 'ruft' },
  { from: 'hello', to: 'wl', label: 'ruft' },
  { from: 'main', to: 'gettype', label: 'ruft' },
  { from: 'gettype', to: 'warn' },
  { from: 'main', to: 'create', label: 'ruft' },
  { from: 'create', to: 'audit', label: 'nur zur Laufzeit' },
];

function graph(
  nodes: Record<string, Status>,
  edges: Record<string, EdgeStatus>,
  facts: Fact[],
  output?: string,
): GraphState {
  return {
    title: 'Was ILLink von Main aus erreicht (vereinfacht)',
    nodes: NODES.map((n) => ({ ...n, status: nodes[n.id] ?? 'pending' })),
    edges: EDGES.map((e) => ({ ...e, status: edges[`${e.from}->${e.to}`] ?? 'idle' })),
    facts,
    ...(output !== undefined ? { output } : {}),
  };
}

const roots: Fact = { id: 'f-roots', label: 'Wurzeln', value: 'Main' };
const kept = (value: string): Fact => ({ id: 'f-kept', label: 'Markiert', value });

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Trimming als Erreichbarkeitsanalyse',
  code: {
    cs: `var greeter = new Greeter();
greeter.Hello("Welt");

string name = Console.ReadLine()!;   // Eingabe: "Audit"
Type? type = Type.GetType(name);     // Warnung beim Publish
Activator.CreateInstance(type!);

class Greeter
{
    public void Hello(string who) => Console.WriteLine($"Hallo {who}");
    public void Bye() => Console.WriteLine("Tschüss");
}

class Audit
{
    public Audit() => Console.WriteLine("Audit aktiv");
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: graph({ main: 'active' }, {}, [roots, kept('noch nichts')]),
      changed: ['main', 'f-roots'],
      explanation:
        'Beim `dotnet publish` mit `PublishTrimmed` liest ILLink die IL **aller** Assemblies der App. Es startet bei den Wurzeln, hier beim Einstiegspunkt. Alles, was von dort nicht erreichbar ist, wird später entfernt.',
    },
    {
      codeLine: 1,
      state: graph({ main: 'done', greeter: 'active' }, { 'main->greeter': 'taken' }, [
        roots,
        kept('Main, Greeter'),
      ]),
      changed: ['greeter', 'main->greeter', 'f-kept'],
      explanation:
        'Main enthält ein `newobj` für `Greeter`. ILLink markiert den Typ und genau den aufgerufenen Konstruktor. Ein markierter Typ bedeutet aber **nicht**, dass alle seine Methoden bleiben.',
    },
    {
      codeLine: 2,
      state: graph(
        { main: 'done', greeter: 'done', hello: 'active' },
        { 'main->greeter': 'taken', 'main->hello': 'taken' },
        [roots, kept('Main, Greeter, Hello')],
      ),
      changed: ['hello', 'main->hello', 'f-kept'],
      explanation:
        'Der Aufruf von `Hello` steht als Methodenverweis in der IL von Main. Hello wird markiert, weil Main sie aufruft, nicht weil Greeter markiert ist.',
    },
    {
      codeLine: 10,
      state: graph(
        { main: 'done', greeter: 'done', hello: 'done', wl: 'active' },
        { 'main->greeter': 'taken', 'main->hello': 'taken', 'hello->wl': 'taken' },
        [roots, kept('Main, Greeter, Hello, WriteLine')],
      ),
      changed: ['wl', 'hello->wl', 'f-kept'],
      explanation:
        'Die Analyse folgt dem Aufruf in die Assembly `System.Console` und weiter ins Framework. Gekürzt wird also nicht nur dein Code, sondern das gesamte mitgelieferte Framework.',
    },
    {
      codeLine: 5,
      state: graph(
        { main: 'done', greeter: 'done', hello: 'done', wl: 'done', gettype: 'active' },
        {
          'main->greeter': 'taken',
          'main->hello': 'taken',
          'hello->wl': 'taken',
          'main->gettype': 'taken',
        },
        [roots, kept('Main, Greeter, Hello, WriteLine, GetType')],
      ),
      changed: ['gettype', 'main->gettype', 'f-kept'],
      explanation:
        '`Type.GetType` selbst ist ein gewöhnlicher Aufruf und wird markiert. Spannend ist sein Argument: ILLink sieht nur, dass der String aus `Console.ReadLine` kommt. Welcher Typ das zur Laufzeit sein wird, steht nirgends in der IL.',
    },
    {
      codeLine: 5,
      state: graph(
        {
          main: 'done',
          greeter: 'done',
          hello: 'done',
          wl: 'done',
          gettype: 'done',
          warn: 'active',
        },
        {
          'main->greeter': 'taken',
          'main->hello': 'taken',
          'hello->wl': 'taken',
          'main->gettype': 'taken',
          'gettype->warn': 'taken',
        },
        [
          roots,
          kept('Main, Greeter, Hello, WriteLine, GetType'),
          { id: 'f-warn', label: 'Warnung', value: 'IL2057 in Zeile 5' },
        ],
      ),
      changed: ['warn', 'gettype->warn', 'f-warn'],
      explanation:
        'ILLink kann den Wert nicht auflösen und meldet eine **Trim-Warnung**. Die Warnung ist die einzige Spur dieses Problems: Der Build gelingt trotzdem, und die Analyse markiert für diesen Aufruf keinen Zieltyp.',
    },
    {
      codeLine: 6,
      state: graph(
        {
          main: 'done',
          greeter: 'done',
          hello: 'done',
          wl: 'done',
          gettype: 'done',
          warn: 'done',
          create: 'done',
          audit: 'rejected',
        },
        {
          'main->greeter': 'taken',
          'main->hello': 'taken',
          'hello->wl': 'taken',
          'main->gettype': 'taken',
          'gettype->warn': 'taken',
          'main->create': 'taken',
          'create->audit': 'rejected',
        },
        [
          roots,
          kept('… und CreateInstance'),
          { id: 'f-warn', label: 'Warnung', value: 'IL2057 in Zeile 5' },
          { id: 'f-removed', label: 'Entfernt', value: 'Audit' },
        ],
      ),
      changed: ['create', 'audit', 'main->create', 'create->audit', 'f-kept', 'f-removed'],
      explanation:
        'Kein Verweis in der IL führt zu `Audit`. Die Verbindung entsteht erst zur Laufzeit über den String, und den sieht ILLink nicht. Audit ist für die Analyse unerreichbar und wird entfernt, obwohl das Programm ihn braucht.',
    },
    {
      codeLine: 11,
      state: graph(
        {
          main: 'done',
          greeter: 'done',
          hello: 'done',
          wl: 'done',
          gettype: 'done',
          warn: 'done',
          create: 'done',
          audit: 'rejected',
          bye: 'skipped',
        },
        {
          'main->greeter': 'taken',
          'main->hello': 'taken',
          'hello->wl': 'taken',
          'main->gettype': 'taken',
          'gettype->warn': 'taken',
          'main->create': 'taken',
          'create->audit': 'rejected',
        },
        [
          roots,
          kept('… und CreateInstance'),
          { id: 'f-warn', label: 'Warnung', value: 'IL2057 in Zeile 5' },
          { id: 'f-removed', label: 'Entfernt', value: 'Audit, Greeter.Bye' },
        ],
      ),
      changed: ['bye', 'f-removed'],
      explanation:
        'Auch `Greeter.Bye` fliegt heraus, obwohl `Greeter` bleibt. Trimming arbeitet auf der Ebene einzelner Methoden, Felder und Typen, **nicht nur auf ganzen Assemblies**. Das ist der Grund, warum es so viel spart und warum Reflection so leicht danebengreift.',
    },
    {
      codeLine: 6,
      state: graph(
        {
          main: 'done',
          greeter: 'done',
          hello: 'done',
          wl: 'done',
          gettype: 'done',
          warn: 'done',
          create: 'active',
          audit: 'rejected',
          bye: 'skipped',
        },
        {
          'main->greeter': 'taken',
          'main->hello': 'taken',
          'hello->wl': 'taken',
          'main->gettype': 'taken',
          'gettype->warn': 'taken',
          'main->create': 'taken',
          'create->audit': 'rejected',
        },
        [
          roots,
          { id: 'f-warn', label: 'Warnung', value: 'IL2057 in Zeile 5' },
          { id: 'f-removed', label: 'Entfernt', value: 'Audit, Greeter.Bye' },
        ],
        'Hallo Welt, danach ArgumentNullException',
      ),
      changed: ['create'],
      explanation:
        'Die gekürzte App startet: „Hallo Welt“ erscheint, dann liefert `Type.GetType("Audit")` **null**, weil der Typ nicht mehr existiert, und `CreateInstance` wirft. Mit `dotnet run` lief derselbe Code fehlerfrei, denn dort wird nicht gekürzt.',
    },
  ],
});
