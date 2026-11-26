import { defineStepScript, type GraphState } from '@/components/viz';

// Lazy type load triggered by the JIT, after BOTR type-loader.md ("types are usually resolved
// and loaded at JIT time"), the managed assembly loading algorithm on Microsoft Learn
// (static references are loaded on demand, the active ALC is the one of the referring assembly)
// and ECMA-335 Partition II (TypeRef, ResolutionScope, AssemblyRef).
// TODO(verify): Token values (0x0A000007, 0x01000004, 0x02000003) are examples, not measured.
// TODO(verify): IL of Bestellen in a Release build (whether the local o survives, .maxstack).
// TODO(verify): That the JIT resolves newobj and ldfld tokens while compiling Bestellen with
// Tier0 (getCallInfo / getFieldInfo in the JIT-EE interface) and not at first execution.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

// Main path in row 1, the parent check below the TypeDef lookup. Loading a parent is a recursion
// through the same steps, drawn as an edge back to "TypeRef auflösen".
const NODES: Omit<Node, 'status'>[] = [
  { id: 'trigger', label: 'JIT braucht Typ', detail: 'Auslöser', row: 1, col: 1 },
  { id: 'ref', label: 'TypeRef auflösen', detail: 'Name und Scope', row: 1, col: 2 },
  { id: 'asm', label: 'Assembly laden', detail: 'Binder und Kontext', row: 1, col: 3 },
  { id: 'def', label: 'TypeDef finden', detail: 'Namenssuche im Modul', row: 1, col: 4 },
  {
    id: 'parents',
    label: 'Eltern geladen?',
    detail: 'Basistyp, Interfaces',
    row: 2,
    col: 4,
    shape: 'decision',
  },
  { id: 'loadp', label: 'Eltern zuerst laden', detail: 'mit denselben Schritten', row: 2, col: 2 },
  {
    id: 'build',
    label: 'MethodTable bauen',
    detail: 'mit EEClass, im Loader Heap',
    row: 3,
    col: 4,
  },
  { id: 'handle', label: 'TypeHandle', detail: 'zurück an den JIT', row: 4, col: 4, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'trigger', to: 'ref' },
  { from: 'ref', to: 'asm' },
  { from: 'asm', to: 'def' },
  { from: 'def', to: 'parents' },
  { from: 'parents', to: 'loadp', label: 'nein' },
  { from: 'loadp', to: 'ref', label: 'rekursiv' },
  { from: 'parents', to: 'build', label: 'ja' },
  { from: 'build', to: 'handle' },
];

/**
 * Graph for one step: `path` lists the visited nodes in order, the last one is active (none if
 * `finished`). `back` marks extra edges as taken, e.g. the recursion.
 */
function run(
  path: string[],
  facts: Fact[],
  {
    details = {},
    back = [],
    finished = false,
  }: { details?: Record<string, string>; back?: string[]; finished?: boolean } = {},
): GraphState {
  const visited = new Set(path);
  const last = finished ? undefined : path[path.length - 1];
  const taken = new Set([...path.slice(1).map((id, i) => `${path[i]}->${id}`), ...back]);
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status: n.id === last ? 'active' : visited.has(n.id) ? 'done' : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: taken.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const MAIN = ['trigger', 'ref', 'asm', 'def'];
const PARENTS = [...MAIN, 'parents', 'loadp'];
// After the recursion the parents exist, the check now answers "ja".
const BUILT = [...PARENTS, 'parents', 'build'];
const RECURSION = { back: ['loadp->ref'], details: { loadp: 'Entity, rekursiv' } };

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Ein Typ wird beim ersten Gebrauch geladen',
  code: {
    cs: `class Program
{
    static void Main()
    {
        Console.WriteLine("Start");
        Bestellen();
    }

    static void Bestellen()
    {
        var o = new Order(42);
        Console.WriteLine(o.Id);
    }
}

// in Shop.dll
public class Entity { public int Id; }
public class Order : Entity, IComparable<Order>
{
    public Order(int id) => Id = id;
    public int CompareTo(Order? other) => Id - (other?.Id ?? 0);
}`,
    il: `.method private hidebysig static void Bestellen () cil managed
{
    .locals init ([0] class [Shop]Order o)
    IL_0000: ldc.i4.s 42
    IL_0002: newobj instance void [Shop]Order::.ctor(int32)
    IL_0007: stloc.0
    IL_0008: ldloc.0
    IL_0009: ldfld int32 [Shop]Entity::Id
    IL_000e: call void [System.Console]System.Console::WriteLine(int32)
    IL_0013: ret
}`,
  },
  steps: [
    {
      codeLine: 5,
      state: {
        ...run(
          [],
          [
            fact('f-asm', 'Shop.dll', 'nicht geladen'),
            fact('f-types', 'Typen aus Shop.dll', 'keine'),
            fact('f-jit', 'Übersetzt', 'Main'),
          ],
        ),
      },
      changed: ['f-asm', 'f-types', 'f-jit'],
      explanation:
        '`Main` läuft. Der JIT hat beim Übersetzen nur gebraucht, was in `Main` vorkommt: `Console` und die Methode `Bestellen`. `Order` steht nicht in `Main`, deshalb ist `Shop.dll` noch nicht einmal geladen, obwohl sie als Verweis im Manifest der App steht.',
    },
    {
      codeLine: 6,
      highlight: { il: [5] },
      state: {
        ...run(MAIN.slice(0, 1), [
          fact('f-call', 'Aufruf', 'Bestellen, zum ersten Mal'),
          fact('f-jit', 'Übersetzt', 'Bestellen, vor seiner ersten Zeile'),
          fact('f-need', 'Gefunden', 'newobj mit MemberRef auf Order::.ctor'),
        ]),
      },
      changed: ['f-call', 'f-jit', 'f-need'],
      explanation:
        'Bevor `Bestellen` zum ersten Mal läuft, übersetzt der JIT die Methode. Dabei trifft er auf `newobj` mit einem Token für den Konstruktor von `Order`. Um Maschinencode für die Allokation zu erzeugen, braucht er den Typ: Das ist der **Auslöser** für das Typladen, und er liegt vor der ersten Zeile von `Bestellen`.',
    },
    {
      codeLine: 11,
      highlight: { il: [5] },
      state: {
        ...run(MAIN.slice(0, 2), [
          fact('f-tref', 'TypeRef', 'Namensraum leer, Name "Order"'),
          fact('f-scope', 'ResolutionScope', 'AssemblyRef Shop, Version 1.0.0.0'),
        ]),
      },
      changed: ['f-tref', 'f-scope'],
      explanation:
        'Die Runtime folgt der Kette aus MemberRef, TypeRef und AssemblyRef. Am Ende weiß sie nur zwei Dinge: Der Typ heißt `Order`, und er soll in einer Assembly namens `Shop` stehen. Wie diese Kette in den Tabellen aussieht, zeigt die Lektion zu Metadatentabellen.',
    },
    {
      codeLine: 11,
      state: {
        ...run(MAIN.slice(0, 3), [
          fact('f-ctx', 'Aktiver Kontext', 'der von App.dll: Default'),
          fact('f-asm', 'Shop.dll', 'gefunden über die TPA-Liste, geladen'),
          fact('f-types', 'Typen aus Shop.dll', 'immer noch keine'),
        ]),
      },
      changed: ['f-ctx', 'f-asm', 'f-types'],
      explanation:
        'Der Binder fragt den `AssemblyLoadContext`, der `App.dll` geladen hat, nach `Shop`. Der Default-Kontext findet die Datei über die TPA-Liste, bildet sie in den Speicher ab und liest den Metadatenkopf. Eine geladene Assembly ist aber noch kein geladener Typ: Für die Typen darin existiert bis jetzt keine einzige Laufzeitstruktur.',
    },
    {
      codeLine: 18,
      state: {
        ...run(MAIN, [
          fact('f-def', 'TypeDef', 'Order, Token 0x02000003'),
          fact('f-extends', 'Extends', 'TypeDef Entity'),
          fact('f-impl', 'InterfaceImpl', 'IComparable<Order> (TypeSpec)'),
        ]),
      },
      changed: ['f-def', 'f-extends', 'f-impl'],
      explanation:
        'In `Shop.dll` sucht die Runtime einen TypeDef mit Namensraum und Name. Gesucht wird per Name, nicht per Zeilennummer, denn das TypeRef in `App.dll` kennt die Zeilen von `Shop.dll` nicht. Die TypeDef-Zeile verrät, was als Nächstes nötig ist: ein Basistyp und ein Interface.',
    },
    {
      codeLine: 17,
      state: {
        ...run(
          PARENTS,
          [
            fact('f-entity', 'Entity', 'wird zuerst geladen'),
            fact('f-object', 'System.Object', 'schon geladen'),
            fact('f-icomp', 'IComparable<Order>', 'Instanz wird bei Bedarf gebaut'),
          ],
          RECURSION,
        ),
      },
      changed: ['f-entity', 'f-object', 'f-icomp'],
      explanation:
        'Eine MethodTable übernimmt die virtuellen Slots und das Feldlayout ihres Basistyps. Deshalb muss **`Entity` vor `Order`** geladen werden, rekursiv mit denselben Schritten. `IComparable<Order>` ist eine generische Instanz, die erst jetzt entsteht. Ihr Typargument ist `Order` selbst, das gerade noch im Bau ist: Genau für solche Zyklen hat der Loader Ladestufen.',
    },
    {
      codeLine: 18,
      state: {
        ...run(
          BUILT,
          [
            fact('f-mt', 'MethodTable Order', 'Größe, Basistyp, Slots, Interfaces'),
            fact('f-ee', 'EEClass Order', 'Felder, Methoden, Metadatenverweise'),
            fact('f-where', 'Ort', 'Loader Heap des Default-Kontexts'),
          ],
          { back: RECURSION.back },
        ),
      },
      changed: ['f-mt', 'f-ee', 'f-where'],
      explanation:
        'Jetzt baut die Runtime die eigentlichen Strukturen: die **MethodTable** mit allem, was zur Laufzeit oft gebraucht wird, und die **EEClass** mit den selteneren Daten. Beide landen im Loader Heap, nicht auf dem GC-Heap. Code für die Methoden von `Order` entsteht dabei noch nicht, den übersetzt der JIT erst beim ersten Aufruf.',
    },
    {
      codeLine: 11,
      highlight: { il: [5, 9] },
      state: {
        ...run(
          [...BUILT, 'handle'],
          [
            fact('f-handle', 'TypeHandle', 'Zeiger auf MethodTable Order'),
            fact('f-cache', 'Gemerkt', 'im Modul, pro Token'),
            fact('f-jit', 'Übersetzt', 'Bestellen fertig'),
          ],
          { back: RECURSION.back },
        ),
      },
      changed: ['f-handle', 'f-cache', 'f-jit'],
      explanation:
        'Der JIT bekommt ein **TypeHandle** zurück und baut die Adresse der MethodTable direkt in den Allokationsaufruf ein. Für `ldfld Entity::Id` braucht er den Feld-Offset, den er jetzt kennt. Erst danach beginnt `Bestellen` zu laufen.',
    },
    {
      codeLine: 12,
      state: {
        ...run(
          [...BUILT, 'handle'],
          [
            fact('f-types', 'Typen aus Shop.dll', 'Entity, Order, IComparable<Order>'),
            fact('f-other', 'Alle übrigen Typen von Shop.dll', 'nicht geladen'),
            fact('f-myth', 'Fehlannahme', '„Beim Start werden alle Typen geladen.“'),
          ],
          { back: RECURSION.back, finished: true },
        ),
      },
      changed: ['f-types', 'f-other', 'f-myth'],
      explanation:
        'Fehlannahme: „Beim Programmstart lädt die Runtime alle Typen.“ Geladen wurde genau das, was der übersetzte Code brauchte. Hätte `Shop.dll` hundert weitere Typen, gäbe es für sie keine MethodTable, solange kein Code sie anfasst.',
    },
  ],
});
