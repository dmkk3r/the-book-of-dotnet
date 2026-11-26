import { defineStepScript, fieldId, type MemoryState } from '@/components/viz';

// An iterator method as the compiler rewrites it: kickoff, GetEnumerator and MoveNext.
// Addresses and the thread id are fictional but consistent across steps.
// TODO(verify): Lowered code against SharpLab ("C#", Release): class name <Range>d__0, field names
// <>1__state, <>2__current, <>l__initialThreadId, <>3__start, <i>5__2; state values -2 (enumerable
// not yet enumerated), 0 (before first MoveNext), -1 (running or finished), 1 (after yield return).
// TODO(verify): Object size on x64 (48 B assumed: header, MethodTable, eight int fields).

const IT = '0x7F3B0100';

interface It {
  state: string;
  current: string;
  start: string;
  count: string;
  i: string;
}

const iterator = (s: It) => ({
  id: 'it',
  type: '<Range>d__0',
  address: IT,
  generation: 0 as const,
  fields: [
    { name: '<>1__state', value: s.state },
    { name: '<>2__current', value: s.current },
    { name: '<>l__initialThreadId', value: '1' },
    { name: '<>3__start', value: '10' },
    { name: '<>3__count', value: '2' },
    { name: 'start', value: s.start },
    { name: 'count', value: s.count },
    { name: '<i>5__2', value: s.i },
  ],
  sizeBytes: 48,
});

const ref = (id: string, name: string, type: string, on: boolean) =>
  on ? { id, name, type, value: IT, ref: 'it' } : { id, name, type, value: 'null' };

const state = (
  s: It,
  o: { e?: boolean; v?: string; moveNext?: boolean; output?: string } = {},
): MemoryState => ({
  frames: [
    {
      id: 'main',
      method: 'Main()',
      slots: [
        ref('seq', 'seq', 'IEnumerable<int> (Verweis)', true),
        ref('e', 'e', 'IEnumerator<int> (Verweis)', o.e ?? false),
        { id: 'v', name: 'v', type: 'int', value: o.v ?? '0' },
      ],
    },
    ...(o.moveNext
      ? [
          {
            id: 'mn',
            method: '<Range>d__0.MoveNext()',
            slots: [{ id: 'this', name: 'this', type: 'Verweis', value: IT, ref: 'it' }],
          },
        ]
      : []),
  ],
  heap: [iterator(s)],
  ...(o.output !== undefined ? { output: o.output } : {}),
});

const f = (name: string) => fieldId('it', name);

export default defineStepScript({
  view: 'memory',
  title: 'Ein Iterator Schritt für Schritt',
  code: {
    cs: `static IEnumerable<int> Range(int start, int count)
{
    for (int i = 0; i < count; i++)
        yield return start + i;
}

var seq = Range(10, 2);
foreach (int v in seq)
    Console.WriteLine(v);`,
    lowered: `// Kickoff: dein Code ist hier verschwunden
static IEnumerable<int> Range(int start, int count)
{
    var d = new <Range>d__0(-2);
    d.<>3__start = start;
    d.<>3__count = count;
    return d;
}

IEnumerator<int> IEnumerable<int>.GetEnumerator()
{
    <Range>d__0 d;
    if (<>1__state == -2 && <>l__initialThreadId == Environment.CurrentManagedThreadId)
    {
        <>1__state = 0;
        d = this;
    }
    else
        d = new <Range>d__0(0);
    d.start = <>3__start;
    d.count = <>3__count;
    return d;
}

bool MoveNext()
{
    int num = <>1__state;
    if (num == 0)
    {
        <>1__state = -1;
        <i>5__2 = 0;
    }
    else if (num == 1)
    {
        <>1__state = -1;
        <i>5__2++;
    }
    else
        return false;
    if (<i>5__2 < count)
    {
        <>2__current = start + <i>5__2;
        <>1__state = 1;
        return true;
    }
    return false;
}`,
  },
  steps: [
    {
      codeLine: 7,
      highlight: { lowered: [2, 3, 4, 5, 6, 7, 8] },
      state: state({ state: '-2', current: '0', start: '0', count: '0', i: '0' }),
      changed: ['it', 'seq'],
      explanation:
        '`Range(10, 2)` führt keine einzige Zeile deines Rumpfs aus. Die Methode mit dem ursprünglichen Namen legt nur ein Objekt der generierten Klasse an, merkt sich die Argumente in `<>3__start` und `<>3__count` und gibt es zurück. Häufige Fehlannahme: „Beim Aufruf läuft die Methode bis zum ersten yield.“',
    },
    {
      codeLine: 8,
      highlight: { lowered: [10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23] },
      state: state({ state: '0', current: '0', start: '10', count: '2', i: '0' }, { e: true }),
      changed: ['e', f('<>1__state'), f('start'), f('count')],
      explanation:
        '`foreach` ruft `GetEnumerator`. Der Zustand ist -2 und der Thread derselbe wie beim Erzeugen, also gibt das Objekt **sich selbst** zurück und wechselt in Zustand 0. Die Argumente werden aus den `<>3__`-Feldern in die Arbeitskopien `start` und `count` kopiert. `seq` und `e` zeigen auf dasselbe Objekt.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [25, 26, 27, 28, 29, 30, 31, 32] },
      state: state(
        { state: '-1', current: '0', start: '10', count: '2', i: '0' },
        { e: true, moveNext: true },
      ),
      changed: ['mn', f('<>1__state'), f('<i>5__2')],
      explanation:
        'Erst der erste `MoveNext` startet deinen Code. Zustand 0 führt an den Anfang, der Zustand wird sofort auf -1 („läuft“) gesetzt. Die Schleifenvariable `i` ist kein Slot im Frame von `MoveNext`, sondern das Feld `<i>5__2` im Objekt: Sie muss die Rückkehr zum Aufrufer überleben.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [40, 41, 42, 43, 44, 45] },
      state: state(
        { state: '1', current: '10', start: '10', count: '2', i: '0' },
        { e: true, v: '0' },
      ),
      changed: [f('<>2__current'), f('<>1__state')],
      explanation:
        '`yield return start + i` wird zu drei Dingen: Wert in `<>2__current` ablegen, Zustand auf 1 setzen (die Stelle hinter diesem `yield`), `return true`. `MoveNext` kehrt zurück, sein Frame verschwindet. Der gesamte Zustand der Methode steckt jetzt im Heap-Objekt.',
    },
    {
      codeLine: 9,
      state: state(
        { state: '1', current: '10', start: '10', count: '2', i: '0' },
        { e: true, v: '10', output: '10' },
      ),
      changed: ['v'],
      explanation:
        '`e.Current` liest nur `<>2__current`, es berechnet nichts. Dann läuft der Rumpf der `foreach`-Schleife, auf demselben Thread, während der Iterator angehalten ist.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [25, 26, 27, 33, 34, 35, 36, 37] },
      state: state(
        { state: '-1', current: '10', start: '10', count: '2', i: '1' },
        { e: true, v: '10', moveNext: true, output: '10' },
      ),
      changed: ['mn', f('<>1__state'), f('<i>5__2')],
      explanation:
        'Der zweite `MoveNext` springt über Zustand 1 direkt hinter das `yield`, also zum `i++` der `for`-Schleife. Hier zeigt sich, wozu der Zustand dient: Er ist die Sprungmarke, an der es weitergeht.',
    },
    {
      codeLine: 4,
      highlight: { lowered: [40, 41, 42, 43, 44, 45] },
      state: state(
        { state: '1', current: '11', start: '10', count: '2', i: '1' },
        { e: true, v: '10', output: '10' },
      ),
      changed: [f('<>2__current'), f('<>1__state')],
      explanation: 'Wieder ein `yield return`: `<>2__current` wird 11, Zustand 1, `return true`.',
    },
    {
      codeLine: 9,
      state: state(
        { state: '1', current: '11', start: '10', count: '2', i: '1' },
        { e: true, v: '11', output: '10\n11' },
      ),
      changed: ['v'],
      explanation: 'Der Aufrufer holt 11 ab und gibt sie aus.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [33, 34, 35, 36, 40, 46] },
      state: state(
        { state: '-1', current: '11', start: '10', count: '2', i: '2' },
        { e: true, v: '11', output: '10\n11' },
      ),
      changed: [f('<>1__state'), f('<i>5__2')],
      explanation:
        'Dritter `MoveNext`: `i` wird 2, die Bedingung `i < count` ist falsch, der Code fällt aus der Methode und liefert `false`. Der Zustand bleibt -1, jeder weitere `MoveNext` endet sofort mit `false`.',
    },
    {
      codeLine: 8,
      state: state(
        { state: '-1', current: '11', start: '10', count: '2', i: '2' },
        { e: true, v: '11', output: '10\n11' },
      ),
      explanation:
        'Zum Schluss ruft das `finally` von `foreach` `e.Dispose()` auf. Dieser Iterator hat keinen `finally`-Block, also gibt es nichts aufzuräumen. Bilanz: ein Heap-Objekt für die ganze Aufzählung, drei Aufrufe von `MoveNext`, alle auf dem Main-Thread.',
    },
  ],
});
