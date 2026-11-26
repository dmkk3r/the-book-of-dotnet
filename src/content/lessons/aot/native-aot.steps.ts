import { defineStepScript, type GraphState } from '@/components/viz';

// How the Native AOT compiler (ILCompiler) finds what to compile: it starts at the entry point and
// follows every static dependency (Microsoft Learn "Introduction to AOT warnings"; rd-xml-format.md:
// "The NativeAOT compiler discovers methods to compile and types to generate by compiling the
// application entry point and its transitive dependencies").
// Simplified: the real dependency graph also contains MethodTables, generic dictionaries, static
// bases, reflection metadata and much more, and Main itself is reached from a runtime startup stub.
// TODO(verify): Type.GetType(string) with a non-constant argument produces warning IL2057 and
// returns null at runtime when the type was not kept.
// TODO(verify): List<Order> (reference type argument) uses shared canonical code List<__Canon>.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];
type Status = Node['status'];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'main', label: 'Main', detail: 'Einstiegspunkt', row: 1, col: 1 },
  { id: 'list', label: 'List<Order>', detail: 'Add, Enumerator', row: 1, col: 2 },
  { id: 'order', label: 'Order', detail: 'Konstruktor, Price', row: 1, col: 3 },
  { id: 'total', label: 'Total', row: 2, col: 1 },
  { id: 'dec', label: 'decimal.op_Addition', detail: 'aus CoreLib', row: 2, col: 2 },
  { id: 'describe', label: 'Order.Describe', detail: 'nie aufgerufen', row: 2, col: 3 },
  { id: 'gettype', label: 'Type.GetType', detail: 'Name aus args[0]', row: 3, col: 1 },
  { id: 'report', label: 'Report', detail: 'nur über einen Namen erreichbar', row: 3, col: 2 },
];
const EDGES: Edge[] = [
  { from: 'main', to: 'list' },
  { from: 'list', to: 'order', label: 'T = Order' },
  { from: 'main', to: 'total' },
  { from: 'total', to: 'dec' },
  { from: 'order', to: 'describe' },
  { from: 'main', to: 'gettype' },
  { from: 'gettype', to: 'report', label: '?' },
];

/** status per node (default pending), edges between two kept nodes count as taken. */
function graph(
  status: Partial<Record<string, Status>>,
  rejected: string[] = [],
  facts: Fact[] = [],
  output?: string,
): GraphState {
  const st = (id: string): Status => status[id] ?? 'pending';
  const kept = (id: string) => st(id) === 'done' || st(id) === 'active';
  return {
    nodes: NODES.map((n) => ({ ...n, status: st(n.id) })),
    edges: EDGES.map((e) => {
      const id = `${e.from}->${e.to}`;
      return {
        ...e,
        status: rejected.includes(id) ? 'rejected' : kept(e.from) && kept(e.to) ? 'taken' : 'idle',
      };
    }),
    facts,
    ...(output !== undefined ? { output } : {}),
  };
}

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Was der Native-AOT-Compiler übersetzt',
  code: {
    cs: `// App.csproj: <PublishAot>true</PublishAot>
var orders = new List<Order> { new("Tee", 3.5m), new("Brot", 2m) };
Console.WriteLine(Total(orders));

var t = Type.GetType(args[0]);          // Name erst zur Laufzeit bekannt
Console.WriteLine(t?.Name ?? "unbekannt");

static decimal Total(List<Order> list)
{
    decimal sum = 0;
    foreach (var o in list) sum += o.Price;
    return sum;
}

class Order(string name, decimal price)
{
    public string Name { get; } = name;
    public decimal Price { get; } = price;
    public string Describe() => $"{Name}: {Price}";
}

class Report { public void Print() => Console.WriteLine("Bericht"); }`,
  },
  steps: [
    {
      codeLine: 1,
      state: graph(
        { main: 'active' },
        [],
        [fact('f-start', 'Analyse beginnt bei', 'Main'), fact('f-n', 'Methoden gefunden', '1')],
      ),
      changed: ['main', 'f-start', 'f-n'],
      explanation:
        'Beim `dotnet publish` startet der Native-AOT-Compiler beim Einstiegspunkt. Er übersetzt `Main` und notiert jede Methode und jeden Typ, den der Code berührt. Was nie auf dieser Liste landet, kommt nicht ins Programm.',
    },
    {
      codeLine: 2,
      state: graph(
        { main: 'done', list: 'active', order: 'done' },
        [],
        [
          fact('f-n', 'Methoden gefunden', 'Main, List-Methoden, Order-Konstruktor'),
          fact('f-mt', 'MethodTables', 'List<Order>, Order'),
        ],
      ),
      changed: ['list', 'order', 'f-n', 'f-mt'],
      explanation:
        '`new List<Order>` und `new Order(...)` ziehen Code nach sich: Konstruktoren, `Add` und für das `foreach` später den Enumerator. Dazu kommen die MethodTables beider Typen. Sie entstehen nicht erst zur Laufzeit, der Compiler legt sie als fertige Daten in die Datei.',
    },
    {
      codeLine: 11,
      state: graph(
        { main: 'done', list: 'done', order: 'done', total: 'done', dec: 'active' },
        [],
        [
          fact('f-n', 'neu', 'Total, Order.Price, decimal.op_Addition'),
          fact('f-bcl', 'Aus der BCL', 'nur Benutztes'),
        ],
      ),
      changed: ['total', 'dec', 'f-n', 'f-bcl'],
      explanation:
        '`Total` liest `o.Price` und addiert `decimal`-Werte. Auch Code aus CoreLib wird nur übersetzt, wenn ihn jemand erreicht. Vom riesigen Framework landet so nur ein kleiner Teil in der Programmdatei.',
    },
    {
      codeLine: 19,
      state: graph(
        {
          main: 'done',
          list: 'done',
          order: 'done',
          total: 'done',
          dec: 'done',
          describe: 'rejected',
        },
        ['order->describe'],
        [
          fact('f-gone', 'Entfernt', 'Describe, Getter von Name'),
          fact('f-why', 'Grund', 'kein Aufruf im Programm'),
        ],
      ),
      changed: ['describe', 'f-gone', 'f-why'],
      explanation:
        '`Describe` ruft niemand auf, also übersetzt der Compiler die Methode nicht. Damit fällt auch der Getter von `Name` weg, denn nur `Describe` hat ihn benutzt. Das Programm enthält nur, was von `Main` aus erreichbar ist.',
    },
    {
      codeLine: 5,
      state: graph(
        {
          main: 'done',
          list: 'done',
          order: 'done',
          total: 'done',
          dec: 'done',
          describe: 'rejected',
          gettype: 'active',
          report: 'rejected',
        },
        ['order->describe', 'gettype->report'],
        [
          fact('f-warn', 'Warnung', 'IL2057: Typname nicht konstant'),
          fact('f-gone', 'Entfernt', 'Report, Describe, Getter von Name'),
        ],
      ),
      changed: ['gettype', 'report', 'f-warn', 'f-gone'],
      explanation:
        '`Type.GetType(args[0])` bekommt einen Namen, den erst der Benutzer liefert. Der Compiler kann ihm nicht folgen, `Report` bleibt unerreichbar und wird nicht übersetzt. Statt zu schweigen, meldet er eine Warnung an genau dieser Stelle.',
    },
    {
      codeLine: 6,
      state: graph(
        {
          main: 'done',
          list: 'done',
          order: 'done',
          total: 'done',
          dec: 'done',
          describe: 'rejected',
          gettype: 'done',
          report: 'rejected',
        },
        ['order->describe', 'gettype->report'],
        [fact('f-run', 'Aufruf', './App Report'), fact('f-res', 'Type.GetType', 'null')],
        'unbekannt',
      ),
      changed: ['f-run', 'f-res'],
      explanation:
        'Häufige Fehlannahme: „Reflection findet alles, was im Quelltext steht.“ Mit JIT würde `./App Report` den Typ finden. Im Native-AOT-Programm existiert `Report` nicht mehr, `Type.GetType` liefert `null`. Die Warnung beim Veröffentlichen war die Ankündigung dieses Fehlers.',
    },
  ],
});
