import { defineStepScript, type TimelineState } from '@/components/viz';

// Caller and iterator take turns on one thread. Time units are abstract.

const lanes: TimelineState['lanes'] = [{ id: 'main', label: 'Main-Thread', kind: 'main' }];
type Item = TimelineState['items'][number];
const item = (id: string, start: number, end: number, label: string): Item => ({
  id,
  lane: 'main',
  start,
  end,
  label,
  kind: 'run',
});

const ITEMS: Item[] = [
  item('kick', 0, 1, 'Numbers(): nur Objekt anlegen'),
  item('print', 1, 2, 'Aufrufer: WriteLine'),
  item('get', 2, 3, 'GetEnumerator'),
  item('m1', 3, 5, 'MoveNext: Start bis yield 1'),
  item('b1', 5, 6, 'Aufrufer: 1'),
  item('m2', 6, 8, 'MoveNext: bis yield 2'),
  item('b2', 8, 9, 'Aufrufer: 2'),
  item('m3', 9, 11, 'MoveNext: Ende, false'),
  item('disp', 11, 12, 'Dispose'),
];
const LINKS = [
  { from: 'm1', to: 'm2' },
  { from: 'm2', to: 'm3' },
];

const OUT = [
  'Aufrufer: Numbers() ist zurück',
  '  Iterator: Start',
  'Aufrufer: 1',
  '  Iterator: nach 1',
  'Aufrufer: 2',
  '  Iterator: Ende',
];

/** Shows the first `n` items and the first `lines` output lines. */
const state = (n: number, lines: number): TimelineState => {
  const items = ITEMS.slice(0, n);
  const ids = new Set(items.map((i) => i.id));
  return {
    lanes,
    duration: 12,
    items,
    links: LINKS.filter((l) => ids.has(l.from) && ids.has(l.to)),
    now: items[items.length - 1]!.end,
    ...(lines > 0 ? { output: OUT.slice(0, lines).join('\n') } : {}),
  };
};

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'Aufrufer und Iterator wechseln sich ab',
  code: {
    cs: `static IEnumerable<int> Numbers()
{
    Console.WriteLine("  Iterator: Start");
    yield return 1;
    Console.WriteLine("  Iterator: nach 1");
    yield return 2;
    Console.WriteLine("  Iterator: Ende");
}

var seq = Numbers();
Console.WriteLine("Aufrufer: Numbers() ist zurück");
foreach (int n in seq)
    Console.WriteLine($"Aufrufer: {n}");`,
  },
  steps: [
    {
      codeLine: 10,
      state: state(1, 0),
      changed: ['kick'],
      explanation:
        '`Numbers()` kehrt sofort zurück. Die Zeile „Iterator: Start“ wird **nicht** ausgegeben, denn der Kickoff legt nur das Iterator-Objekt an.',
    },
    {
      codeLine: 11,
      state: state(2, 1),
      changed: ['print'],
      explanation:
        'Die erste Ausgabe kommt vom Aufrufer. Hätte `Numbers` eine Argumentprüfung am Anfang, wäre sie bis hierher ebenfalls nicht gelaufen.',
    },
    {
      codeLine: 12,
      state: state(3, 1),
      changed: ['get'],
      explanation:
        '`foreach` holt den Enumerator. Weil der Aufrufer auf demselben Thread ist, der das Objekt erzeugt hat, ist es dasselbe Objekt.',
    },
    {
      codeLine: 4,
      state: state(4, 2),
      changed: ['m1'],
      explanation:
        'Erst der erste `MoveNext` führt den Code des Iterators aus, bis zum ersten `yield return`. Er läuft auf dem Main-Thread, als ganz gewöhnlicher Methodenaufruf des Aufrufers.',
    },
    {
      codeLine: 13,
      state: state(5, 3),
      changed: ['b1'],
      explanation:
        'Der Iterator ist angehalten, der Aufrufer verarbeitet die 1. Häufige Fehlannahme: „yield return führt den Rest der Methode in einem anderen Thread aus.“ Es gibt keinen zweiten Thread, die Zeitleiste hat nur eine Spur.',
    },
    {
      codeLine: 6,
      state: state(6, 4),
      changed: ['m2'],
      explanation:
        'Der zweite `MoveNext` setzt den Iterator hinter dem ersten `yield` fort. Die Verbindung zeigt: Es ist dieselbe Methode, nur in Abschnitten ausgeführt.',
    },
    {
      codeLine: 13,
      state: state(7, 5),
      changed: ['b2'],
      explanation: 'Wieder ist der Aufrufer dran und gibt die 2 aus.',
    },
    {
      codeLine: 7,
      state: state(8, 6),
      changed: ['m3'],
      explanation:
        'Der dritte `MoveNext` führt den Rest der Methode aus und liefert `false`. Die Zeile „Iterator: Ende“ erscheint also erst, wenn der Aufrufer nach einem weiteren Element fragt. Bricht er vorher ab, erscheint sie nie.',
    },
    {
      codeLine: 12,
      state: state(9, 6),
      changed: ['disp'],
      explanation:
        'Zum Schluss `Dispose` aus dem `finally` von `foreach`. Der Ablauf ist eine strikte Abwechslung auf einem Thread: Der Aufrufer zieht jedes Element einzeln, der Iterator rechnet nie auf Vorrat.',
    },
  ],
});
