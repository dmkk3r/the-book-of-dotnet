import { defineStepScript, fieldId, type MemoryState } from '@/components/viz';

// try/finally inside an iterator and an early break in the caller.
// Addresses are fictional but consistent across steps; "a.txt" contains the lines "a" and "STOP".
// TODO(verify): Lowered shape against SharpLab (Release): the finally body moved into
// <>m__Finally1, state -3 while running inside the try, a fault handler around MoveNext that calls
// Dispose, and Dispose running the finally only for states -3 and 1 (via try { } finally { }).

const IT = '0x7F3B0200';
const SR = '0x7F3B0260';

type Obj = MemoryState['heap'][number];

interface S {
  state: string;
  current: string;
  reader: boolean;
  open?: boolean;
  l?: string;
  output?: string;
}

const state = (s: S): MemoryState => {
  const it: Obj = {
    id: 'it',
    type: '<Lines>d__0',
    address: IT,
    generation: 0,
    fields: [
      { name: '<>1__state', value: s.state },
      { name: '<>2__current', value: s.current },
      { name: 'path', value: '"a.txt"' },
      s.reader
        ? { name: '<reader>5__1', value: SR, ref: 'sr' }
        : { name: '<reader>5__1', value: 'null' },
    ],
  };
  const sr: Obj = {
    id: 'sr',
    type: 'StreamReader',
    address: SR,
    generation: 0,
    fields: [{ name: 'Datei', value: s.open === false ? 'geschlossen' : 'offen' }],
  };
  return {
    frames: [
      {
        id: 'main',
        method: 'Main()',
        slots: [
          { id: 'e', name: 'e', type: 'IEnumerator<string> (Verweis)', value: IT, ref: 'it' },
          { id: 'l', name: 'l', type: 'string', value: s.l ?? 'null' },
        ],
      },
    ],
    heap: s.reader ? [it, sr] : [it],
    ...(s.output !== undefined ? { output: s.output } : {}),
  };
};

const f = (name: string) => fieldId('it', name);

export default defineStepScript({
  view: 'memory',
  title: 'finally in einem Iterator',
  code: {
    cs: `static IEnumerable<string> Lines(string path)
{
    var reader = new StreamReader(path);
    try
    {
        while (reader.ReadLine() is string line)
            yield return line;
    }
    finally
    {
        reader.Dispose();
    }
}

foreach (string l in Lines("a.txt"))
    if (l == "STOP") break;`,
    lowered: `bool MoveNext()
{
    try
    {
        switch (<>1__state)
        {
            case 0:
                <>1__state = -1;
                <reader>5__1 = new StreamReader(path);
                <>1__state = -3;
                break;
            case 1:
                <>1__state = -3;
                break;
            default:
                return false;
        }
        if (<reader>5__1.ReadLine() is string line)
        {
            <>2__current = line;
            <>1__state = 1;
            return true;
        }
        <>m__Finally1();
        return false;
    }
    fault   // nur bei Exception, kein C#, aber gültiges IL
    {
        Dispose();
    }
}

void Dispose()
{
    if (<>1__state == -3 || <>1__state == 1)
    {
        try { }
        finally { <>m__Finally1(); }
    }
}

void <>m__Finally1()
{
    <>1__state = -1;
    <reader>5__1.Dispose();
}`,
  },
  steps: [
    {
      codeLine: 15,
      state: state({ state: '0', current: 'null', reader: false }),
      changed: ['it', 'e'],
      explanation:
        'Der Iterator ist erzeugt und hat sich per `GetEnumerator` in Zustand 0 versetzt. Die Datei ist noch nicht geöffnet, denn auch `new StreamReader` gehört zum Rumpf.',
    },
    {
      codeLine: 3,
      highlight: { lowered: [7, 8, 9, 10, 11] },
      state: state({ state: '-3', current: 'null', reader: true }),
      changed: ['sr', f('<reader>5__1'), f('<>1__state')],
      explanation:
        'Der erste `MoveNext` öffnet die Datei. Die lokale Variable `reader` wird zum Feld, weil sie über ein `yield` hinweg leben muss. Beim Betreten des `try` wechselt der Zustand auf -3: „läuft innerhalb des ersten `try` mit `finally`“.',
    },
    {
      codeLine: 7,
      highlight: { lowered: [18, 19, 20, 21, 22, 23] },
      state: state({ state: '1', current: '"a"', reader: true, l: '"a"' }),
      changed: [f('<>2__current'), f('<>1__state'), 'l'],
      explanation:
        'Erstes `yield return`: Zustand 1, die Zeile „a“ geht an den Aufrufer. Die Methode ist jetzt **mitten im try angehalten**. Ein `finally` kann hier nicht wie gewohnt beim Verlassen des Blocks laufen, denn `MoveNext` ist ja schon zurückgekehrt.',
    },
    {
      codeLine: 7,
      highlight: { lowered: [12, 13, 14, 18, 19, 20, 21, 22, 23] },
      state: state({ state: '1', current: '"STOP"', reader: true, l: '"STOP"' }),
      changed: [f('<>2__current'), 'l'],
      explanation:
        'Der zweite `MoveNext` springt über Zustand 1 zurück in das `try` (Zustand -3), liest „STOP“ und hält wieder mit Zustand 1 an.',
    },
    {
      codeLine: 16,
      highlight: { lowered: [33, 34, 35, 36, 37, 38, 39, 40, 42, 43, 44, 45, 46] },
      state: state({ state: '-1', current: '"STOP"', reader: true, open: false, l: '"STOP"' }),
      changed: [f('<>1__state'), 'sr.Datei'],
      explanation:
        '`break` verlässt die Schleife, das `finally` von `foreach` ruft `e.Dispose()`. Der Iterator erkennt am Zustand 1, dass er im `try` angehalten ist, und führt den `finally`-Code aus, der in `<>m__Finally1` ausgelagert wurde. Die Datei wird geschlossen, obwohl die `while`-Schleife nie zu Ende lief.',
    },
    {
      codeLine: 16,
      state: state({
        state: '-1',
        current: '"STOP"',
        reader: true,
        open: false,
        l: '"STOP"',
        output: 'Datei geschlossen, Iterator beendet',
      }),
      explanation:
        'Genau deshalb erzeugt `foreach` ein `finally` mit `Dispose`. Wer einen Iterator von Hand mit `MoveNext` aufzählt und dabei kein `Dispose` aufruft, lässt die Datei offen, bis der GC irgendwann das Datei-Handle finalisiert.',
    },
  ],
});
