import { defineStepScript, type GraphState } from '@/components/viz';

// Decision "Exception oder Try-Muster?" for typical error situations.
// Sources: Framework Design Guidelines, "Exceptions and Performance" (Tester-Doer pattern,
// Try-Parse pattern for members that might throw in common scenarios; do not use exceptions for
// the normal flow of control); Microsoft Learn "Best practices for exceptions" (handle common
// conditions to avoid exceptions, design classes so that exceptions can be avoided).
// This is guidance, not a runtime mechanism; the scenarios are examples.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  {
    id: 'start',
    label: 'Fehlerfall',
    detail: 'etwas klappt nicht',
    row: 1,
    col: 1,
    shape: 'state',
  },
  {
    id: 'bug',
    label: 'Programmierfehler?',
    detail: 'falsches Argument, falscher Zustand',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'fail',
    label: 'Exception werfen',
    detail: 'schnell scheitern, nicht fangen',
    row: 1,
    col: 3,
    shape: 'end',
  },
  {
    id: 'expected',
    label: 'Gehört zum normalen Betrieb?',
    detail: 'Eingabe, Suche, Format',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  { id: 'hot', label: 'Häufig oder im heißen Pfad?', row: 2, col: 3, shape: 'decision' },
  {
    id: 'try',
    label: 'Try-Muster oder Ergebnis-Typ',
    detail: 'bool plus out, Result',
    row: 2,
    col: 4,
    shape: 'end',
  },
  {
    id: 'rare',
    label: 'Exception werfen',
    detail: 'selten, Aufrufer kann wenig tun',
    row: 3,
    col: 2,
    shape: 'end',
  },
  {
    id: 'both',
    label: 'Exception, Try-Variante anbieten',
    detail: 'wie Parse und TryParse',
    row: 3,
    col: 3,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'start', to: 'bug' },
  { from: 'bug', to: 'fail', label: 'ja' },
  { from: 'bug', to: 'expected', label: 'nein' },
  { from: 'expected', to: 'rare', label: 'nein' },
  { from: 'expected', to: 'hot', label: 'ja' },
  { from: 'hot', to: 'try', label: 'ja' },
  { from: 'hot', to: 'both', label: 'nein' },
];

function run(path: string[], facts: Fact[]): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
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

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Exception oder Try-Muster?',
  code: {
    cs: `// 1. Argument ist null
ArgumentNullException.ThrowIfNull(order);

// 2. Zahlen aus einer Datei mit Millionen Zeilen
if (!int.TryParse(line, out var value)) { skipped++; continue; }

// 3. Schlüssel im Cache nachschlagen
if (cache.TryGetValue(key, out var hit)) return hit;

// 4. Netzwerk bricht ab
var data = await client.GetStringAsync(url);   // wirft HttpRequestException

// 5. Konfigurationswert beim Start lesen
var port = int.Parse(config["Port"]!);`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(
        ['start', 'bug', 'fail'],
        [
          fact('f-case', 'Fall', 'order ist null'),
          fact('f-why', 'Warum', 'Fehler im aufrufenden Code'),
        ],
      ),
      changed: ['fail', 'f-case', 'f-why'],
      explanation:
        'Ein `null`-Argument ist ein Fehler des Aufrufers, kein Zustand, den das Programm behandeln sollte. Hier ist eine Exception richtig, und niemand sollte sie fangen, sondern den Fehler beheben. Die Kosten spielen keine Rolle, weil es im korrekten Programm nie passiert.',
    },
    {
      codeLine: 5,
      state: run(
        ['start', 'bug', 'expected', 'hot', 'try'],
        [
          fact('f-case', 'Fall', 'kaputte Zeilen in Eingabedaten'),
          fact('f-why', 'Warum', 'erwartbar und massenhaft'),
        ],
      ),
      changed: ['expected', 'hot', 'try', 'f-case', 'f-why'],
      explanation:
        'Ungültige Zeilen in einer großen Datei sind normaler Betrieb, und sie können tausendfach vorkommen. Jede einzelne als Exception würde zwei Wanderungen über den Stack kosten. `int.TryParse` meldet dasselbe mit einem `bool`.',
    },
    {
      codeLine: 8,
      state: run(
        ['start', 'bug', 'expected', 'hot', 'try'],
        [
          fact('f-case', 'Fall', 'Schlüssel fehlt im Cache'),
          fact('f-why', 'Warum', 'ein Fehltreffer ist ein Ergebnis'),
        ],
      ),
      changed: ['f-case', 'f-why'],
      explanation:
        'Ein fehlender Schlüssel ist bei einem Cache das normalste Ergebnis der Welt. `TryGetValue` gibt es genau dafür. Wer stattdessen den Indexer nimmt und `KeyNotFoundException` fängt, bezahlt bei jedem Fehltreffer den vollen Wurf.',
    },
    {
      codeLine: 11,
      state: run(
        ['start', 'bug', 'expected', 'rare'],
        [
          fact('f-case', 'Fall', 'Netzwerkfehler'),
          fact('f-why', 'Warum', 'selten, Abbruch der Operation'),
        ],
      ),
      changed: ['rare', 'f-case', 'f-why'],
      explanation:
        'Ein abgebrochener Netzwerkaufruf ist selten und beendet die ganze Operation. Hier ist die Exception das passende Mittel: Sie trägt Details, läuft automatisch bis zu der Ebene, die entscheiden kann, und ihr Preis verschwindet neben der Netzwerklatenz.',
    },
    {
      codeLine: 14,
      state: run(
        ['start', 'bug', 'expected', 'hot', 'both'],
        [
          fact('f-case', 'Fall', 'Konfiguration einmal beim Start'),
          fact('f-why', 'Warum', 'erwartbar, aber nur einmal'),
        ],
      ),
      changed: ['both', 'f-case', 'f-why'],
      explanation:
        'Ein falscher Konfigurationswert kann vorkommen, wird aber genau einmal geprüft. `int.Parse` mit Exception ist hier völlig in Ordnung. Bibliotheken bieten für solche Fälle oft beides an, wie `Parse` und `TryParse`, damit der Aufrufer wählen kann.',
    },
  ],
});
