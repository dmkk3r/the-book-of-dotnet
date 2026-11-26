import { defineStepScript, type GraphState } from '@/components/viz';

// The decision DAG Roslyn builds for a switch expression over property patterns
// (Roslyn: DecisionDagBuilder, BoundDecisionDag). Four arms, four tests, shared nodes.
// The order of the tests follows the arms and, inside an arm, the order of the properties as
// written. The language does not guarantee this order (see the lesson text).
// TODO(verify): Lowered code against SharpLab (Release, C# output): one null check, Country read
// once into a temp, Total only on the "DE" path, both the null path and Express == false end in
// the same arm `_`.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'in', label: 'Eingabe o', detail: 'Order?', row: 1, col: 1 },
  { id: 'nul', label: 'o is null?', detail: 'Verweisvergleich', row: 1, col: 2, shape: 'decision' },
  {
    id: 'de',
    label: 'o.Country == "DE"?',
    detail: 'einmal gelesen',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'tot', label: 'o.Total >= 50?', row: 1, col: 4, shape: 'decision' },
  { id: 'a1', label: 'Arm 1', detail: '0,00', row: 2, col: 4, shape: 'end' },
  { id: 'a2', label: 'Arm 2', detail: '4,90', row: 3, col: 4, shape: 'end' },
  { id: 'exp', label: 'o.Express?', row: 2, col: 3, shape: 'decision' },
  { id: 'a3', label: 'Arm 3', detail: '19,90', row: 3, col: 3, shape: 'end' },
  { id: 'a4', label: 'Arm 4 (_)', detail: '9,90', row: 2, col: 2, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'in', to: 'nul' },
  { from: 'nul', to: 'de', label: 'nein' },
  { from: 'nul', to: 'a4', label: 'ja' },
  { from: 'de', to: 'tot', label: 'ja' },
  { from: 'de', to: 'exp', label: 'nein' },
  { from: 'tot', to: 'a1', label: 'ja' },
  { from: 'tot', to: 'a2', label: 'nein' },
  { from: 'exp', to: 'a3', label: 'ja' },
  { from: 'exp', to: 'a4', label: 'nein' },
];

/** Graph for one input: `path` lists the visited nodes in order, the last one is active. */
function run(path: string[], facts: Fact[]): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      status:
        path.length > 0 && n.id === path[path.length - 1]
          ? 'active'
          : visited.has(n.id)
            ? 'done'
            : 'pending',
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const input = (value: string): Fact => ({ id: 'f-in', label: 'Eingabe', value });
const reads = (value: string): Fact => ({ id: 'f-reads', label: 'Gelesene Properties', value });
const result = (value: string): Fact => ({ id: 'f-res', label: 'Ergebnis', value });

const A = 'Country "DE", Total 80';
const B = 'Country "DE", Total 20';
const C = 'Country "AT", Express false';

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Der Entscheidungsgraph eines switch-Ausdrucks',
  code: {
    cs: `sealed class Order
{
    public string Country { get; init; } = "";
    public decimal Total { get; init; }
    public bool Express { get; init; }
}

static decimal Shipping(Order? o) => o switch
{
    { Country: "DE", Total: >= 50m } => 0m,     // Arm 1
    { Country: "DE" }                => 4.90m,  // Arm 2
    { Express: true }                => 19.90m, // Arm 3
    _                                => 9.90m,  // Arm 4
};`,
    lowered: `// vereinfacht, Release
static decimal Shipping(Order o)
{
    decimal result;
    if ((object)o != null)
    {
        string country = o.Country;
        if (country == "DE")
        {
            if (o.Total >= 50m)
            {
                result = 0m;        // Arm 1
                goto end;
            }
            result = 4.90m;         // Arm 2
            goto end;
        }
        if (o.Express)
        {
            result = 19.90m;        // Arm 3
            goto end;
        }
    }
    result = 9.90m;                 // Arm 4
end:
    return result;
}`,
  },
  steps: [
    {
      codeLine: 8,
      highlight: { lowered: [2] },
      state: run([], [{ id: 'f-arms', label: 'Arme', value: '4' }]),
      changed: ['nul', 'de', 'tot', 'exp', 'f-arms'],
      explanation:
        'Diesen Graphen baut der Compiler beim Übersetzen, nicht zur Laufzeit. Arm für Arm einzeln geprüft wären es sieben Tests: drei versteckte Null-Prüfungen (jedes Property-Muster enthält eine), zweimal `Country`, je einmal `Total` und `Express`. Im Graphen bleiben vier, weil gleiche Tests nur einmal vorkommen.',
    },
    {
      codeLine: 10,
      highlight: { lowered: [5] },
      state: run(['in', 'nul'], [input(A), reads('keine'), result('offen')]),
      changed: ['in', 'nul', 'f-in', 'f-reads', 'f-res'],
      explanation:
        'Erste Eingabe: eine Bestellung aus Deutschland über 80. Zuerst prüft der Code, ob `o` null ist, als reiner Verweisvergleich `(object)o != null`. Ein Property-Muster passt nie auf null, also wäre bei null nur noch Arm 4 übrig.',
    },
    {
      codeLine: 10,
      highlight: { lowered: [7, 8] },
      state: run(['in', 'nul', 'de'], [input(A), reads('Country'), result('offen')]),
      changed: ['de', 'f-reads'],
      explanation:
        '`Country` wird gelesen, in einer verborgenen Variable gemerkt und mit `"DE"` verglichen. Das Ergebnis gilt für Arm 1 und Arm 2 zugleich, beide brauchen dieselbe Bedingung.',
    },
    {
      codeLine: 10,
      highlight: { lowered: [10] },
      state: run(['in', 'nul', 'de', 'tot'], [input(A), reads('Country, Total'), result('offen')]),
      changed: ['tot', 'f-reads'],
      explanation:
        'Jetzt erst wird `Total` gelesen. Der Test steht nur auf dem Pfad, auf dem er noch etwas entscheiden kann: Bei einem anderen Land ist `Total` für kein Arm mehr wichtig.',
    },
    {
      codeLine: 10,
      highlight: { lowered: [12, 13] },
      state: run(
        ['in', 'nul', 'de', 'tot', 'a1'],
        [input(A), reads('Country, Total'), result('0,00')],
      ),
      changed: ['a1', 'f-res'],
      explanation:
        'Arm 1 passt, das Ergebnis ist 0. Drei Tests, zwei Property-Zugriffe, `Express` wurde nie angefasst.',
    },
    {
      codeLine: 11,
      highlight: { lowered: [15, 16] },
      state: run(
        ['in', 'nul', 'de', 'tot', 'a2'],
        [input(B), reads('Country, Total'), result('4,90')],
      ),
      changed: ['a2', 'f-in', 'f-res'],
      explanation:
        'Zweite Eingabe: Deutschland, aber nur 20. `Total >= 50` scheitert, und der Graph springt **direkt** zu Arm 2. Häufige Fehlannahme: „Danach wird Arm 2 geprüft, also noch einmal `Country`.“ Der Compiler weiß an dieser Stelle bereits, dass das Land stimmt, und erzeugt keinen zweiten Vergleich.',
    },
    {
      codeLine: 12,
      highlight: { lowered: [18] },
      state: run(
        ['in', 'nul', 'de', 'exp'],
        [input(C), reads('Country, Express'), result('offen')],
      ),
      changed: ['exp', 'f-in', 'f-reads', 'f-res'],
      explanation:
        'Dritte Eingabe: Österreich ohne Express. Der Vergleich mit `"DE"` scheitert, damit sind Arm 1 und Arm 2 auf einen Schlag erledigt. `Total` wird auf diesem Pfad nie gelesen.',
    },
    {
      codeLine: 13,
      highlight: { lowered: [24] },
      state: run(
        ['in', 'nul', 'de', 'exp', 'a4'],
        [input(C), reads('Country, Express'), result('9,90')],
      ),
      changed: ['a4', 'f-res'],
      explanation:
        '`Express` ist false, es bleibt nur der Verwerfer `_`. Arm 4 ist ein gemeinsamer Knoten: Zwei verschiedene Pfade enden hier. Deshalb ist es ein gerichteter azyklischer Graph (DAG) und kein Baum.',
    },
    {
      codeLine: 13,
      highlight: { lowered: [5, 24] },
      state: run(['in', 'nul', 'a4'], [input('null'), reads('keine'), result('9,90')]),
      changed: ['nul', 'a4', 'f-in', 'f-reads', 'f-res'],
      explanation:
        'Letzte Eingabe: `null`. Der erste Test entscheidet alles, keine einzige Property wird gelesen, und es gibt keine `NullReferenceException`. Ohne den Arm `_` würde der Compiler hier warnen, dass null nicht abgedeckt ist.',
    },
  ],
});
