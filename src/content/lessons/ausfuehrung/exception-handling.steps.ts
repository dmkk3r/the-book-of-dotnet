import { defineStepScript, type MemoryState } from '@/components/viz';

// The two-pass exception dispatch, shown on the stack: Main → A → B, B throws, Main catches with
// an exception filter. The teaching point is the order of the console output:
// "Filter in Main", "Finally in B", "Finally in A", "Catch in Main".
// Sources: ECMA-335 Partition I, 12.4.2 (search for a handler whose filter wishes to handle the
// exception first, then walk back calling finally and fault handlers, then start the handler);
// BOTR exceptions.md; BOTR clr-abi.md (funclets on 64-bit, catch funclet returns the address
// where execution continues).
// Frames newest first. The runtime dispatcher frame and funclet frames are simplified: in
// reality there are several runtime frames (and, with the .NET 9 managed implementation, managed
// dispatcher code) between the throwing frame and the funclets.
// TODO(verify): That the stack trace data is appended frame by frame during the first pass
// (CoreCLR StackTraceInfo / managed EH AppendExceptionStackFrame).
// TODO(verify): That the frames of B and A are only logically unwound during the second pass and
// physically cut back when the catch funclet has returned its continuation address and the
// runtime resumes there (CoreCLR funclet model, NativeAOT-based EH since .NET 9).
// Addresses are fictional.

type Slot = MemoryState['frames'][number]['slots'][number];
type Frame = MemoryState['frames'][number];
type Obj = MemoryState['heap'][number];

const slot = (id: string, name: string, type: string, value: string, ref?: string): Slot => ({
  id,
  name,
  type,
  value,
  ...(ref ? { ref } : {}),
});

const EX = 'ex';
const EX_ADDR = '0x7F3A2040';

interface Look {
  /** Value of the status slot of B, A and Main. */
  b: string;
  a: string;
  main: string;
  /** Dispatcher frame: pass and what it is doing. */
  pass?: string;
  doing?: string;
  /** Extra funclet frame on top. */
  funclet?: { method: string; what: string };
  /** B still holds the reference on its evaluation stack (before the throw). */
  evalRef?: boolean;
  /** Frames B and A are gone. */
  resumed?: boolean;
}

function frames(l: Look): Frame[] {
  const result: Frame[] = [];
  if (l.funclet) {
    result.push({
      id: 'f-funclet',
      method: l.funclet.method,
      slots: [slot('f-funclet-what', 'läuft', 'eigener kleiner Frame', l.funclet.what)],
    });
  }
  if (l.pass) {
    result.push({
      id: 'f-rt',
      method: 'Exception-Dispatch (Runtime)',
      slots: [
        slot('f-rt-pass', 'Durchlauf', 'Zustand der Suche', l.pass),
        slot('f-rt-doing', 'Arbeit', 'aktueller Frame', l.doing ?? 'keine'),
        slot('f-rt-ex', 'Exception', 'Verweis', EX_ADDR, EX),
      ],
    });
  }
  if (!l.resumed) {
    result.push({
      id: 'f-b',
      method: 'B()',
      slots: [
        slot('f-b-clauses', 'EH-Klauseln', 'aus der Klauseltabelle', 'finally (Zeile 35)'),
        slot('f-b-state', 'Zustand', 'Frame', l.b),
        ...(l.evalRef ? [slot('f-b-eval', 'Auswertungsstack', 'Verweis', EX_ADDR, EX)] : []),
      ],
    });
    result.push({
      id: 'f-a',
      method: 'A()',
      slots: [
        slot(
          'f-a-clauses',
          'EH-Klauseln',
          'aus der Klauseltabelle',
          'catch ArgumentException, finally',
        ),
        slot('f-a-state', 'Zustand', 'Frame', l.a),
      ],
    });
  }
  result.push({
    id: 'f-main',
    method: 'Main()',
    slots: [
      slot(
        'f-main-clauses',
        'EH-Klauseln',
        'aus der Klauseltabelle',
        'filter + catch InvalidOperationException',
      ),
      slot('f-main-state', 'Zustand', 'Frame', l.main),
    ],
  });
  return result;
}

const exception = (trace: string): Obj => ({
  id: EX,
  type: 'InvalidOperationException',
  address: EX_ADDR,
  generation: 0,
  fields: [
    { name: 'Message', value: '"kaputt"' },
    { name: 'Stack-Trace-Daten', value: trace },
  ],
});

const state = (l: Look, trace: string | null, output: string): MemoryState => ({
  frames: frames(l),
  heap: trace === null ? [] : [exception(trace)],
  output,
});

const OUT_FILTER = 'Filter in Main';
const OUT_B = `${OUT_FILTER}\nFinally in B`;
const OUT_A = `${OUT_B}\nFinally in A`;
const OUT_CATCH = `${OUT_A}\nCatch in Main`;

const WAIT_B = 'wartet auf B()';
const WAIT_A = 'wartet auf A()';

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Zwei Durchläufe: erst suchen, dann abwickeln',
  code: {
    cs: `static void Main()
{
    try
    {
        A();
    }
    catch (InvalidOperationException) when (Log("Filter in Main"))
    {
        Console.WriteLine("Catch in Main");
    }
}

static void A()
{
    try
    {
        B();
    }
    catch (ArgumentException)
    {
        Console.WriteLine("Catch in A");
    }
    finally
    {
        Console.WriteLine("Finally in A");
    }
}

static void B()
{
    try
    {
        throw new InvalidOperationException("kaputt");
    }
    finally
    {
        Console.WriteLine("Finally in B");
    }
}

static bool Log(string text)
{
    Console.WriteLine(text);
    return true;
}`,
  },
  steps: [
    {
      codeLine: 33,
      state: state({ b: 'im try, vor dem throw', a: WAIT_B, main: WAIT_A }, null, ''),
      changed: ['f-b-state'],
      explanation:
        '`Main` hat `A` aufgerufen, `A` hat `B` aufgerufen. Jeder der drei Frames liegt in einem `try`-Block, und jede Methode hat ihre eigene Klauseltabelle. Noch ist nichts passiert.',
    },
    {
      codeLine: 33,
      state: state(
        { b: 'im try, vor dem throw', a: WAIT_B, main: WAIT_A, evalRef: true },
        'leer',
        '',
      ),
      changed: [EX, 'f-b-eval'],
      explanation:
        '`new InvalidOperationException(...)` ist eine ganz normale Allokation: ein Objekt auf dem Heap, ein Verweis auf dem Auswertungsstack von `B`. Geworfen ist noch nichts, der Stack-Trace ist leer.',
    },
    {
      codeLine: 33,
      state: state(
        { b: 'Wurfpunkt', a: WAIT_B, main: WAIT_A, pass: '1: Handler suchen', doing: 'Start' },
        'leer',
        '',
      ),
      changed: ['f-rt', 'f-b-state'],
      explanation:
        'Die Instruktion `throw` übergibt das Objekt an die Runtime. Ab hier steuert die Runtime, nicht mehr dein Code. Sie meldet die Exception zuerst als **First-Chance-Exception** an Debugger und Ereignisse und beginnt dann den ersten Durchlauf.',
    },
    {
      codeLine: 35,
      state: state(
        {
          b: 'geprüft: kein Handler',
          a: WAIT_B,
          main: WAIT_A,
          pass: '1: Handler suchen',
          doing: 'Frame B',
        },
        'B',
        '',
      ),
      changed: ['f-rt-doing', 'f-b-state', `${EX}.Stack-Trace-Daten`],
      explanation:
        'Durchlauf 1 schaut sich `B` an. Die `finally`-Klausel deckt den Wurfpunkt zwar ab, aber ein `finally` kann eine Exception nicht fangen, also ist sie für die Suche uninteressant. Ausgeführt wird sie jetzt **nicht**, die Runtime merkt sich nur den Frame im Stack-Trace.',
    },
    {
      codeLine: 19,
      state: state(
        {
          b: 'geprüft: kein Handler',
          a: 'geprüft: Typ passt nicht',
          main: WAIT_A,
          pass: '1: Handler suchen',
          doing: 'Frame A',
        },
        'B, A',
        '',
      ),
      changed: ['f-rt-doing', 'f-a-state', `${EX}.Stack-Trace-Daten`],
      explanation:
        'Mit einem virtuellen Unwind kommt die Suche zu `A`. Dort gibt es `catch (ArgumentException)`, aber `InvalidOperationException` ist keine `ArgumentException`. Das `finally` in `A` wird wieder nur übergangen.',
    },
    {
      codeLine: 7,
      state: state(
        {
          b: 'geprüft: kein Handler',
          a: 'geprüft: Typ passt nicht',
          main: 'geprüft: Typ passt, Filter läuft',
          pass: '1: Handler suchen',
          doing: 'Frame Main',
          funclet: { method: 'Filter-Funclet von Main', what: 'Log("Filter in Main")' },
        },
        'B, A, Main',
        OUT_FILTER,
      ),
      changed: ['f-funclet', 'f-main-state', 'f-rt-doing', `${EX}.Stack-Trace-Daten`],
      explanation:
        'In `Main` passt der Typ, also ruft die Runtime den **Filter** auf, und `Log` schreibt seine Zeile. Die Fehlannahme wäre, dass vorher schon „Finally in B“ erscheint: Die Frames von `B` und `A` liegen unangetastet darunter, kein einziges `finally` ist gelaufen.',
    },
    {
      codeLine: 7,
      state: state(
        {
          b: 'geprüft: kein Handler',
          a: 'geprüft: Typ passt nicht',
          main: 'Handler gefunden',
          pass: '1 beendet: Ziel ist Main',
          doing: 'Ziel: catch in Main',
        },
        'B, A, Main',
        OUT_FILTER,
      ),
      changed: ['f-main-state', 'f-rt-pass', 'f-rt-doing'],
      explanation:
        'Der Filter liefert `true`. Damit steht das Ziel fest, und Durchlauf 1 ist zu Ende. Erst jetzt weiß die Runtime, bis wohin sie abwickeln muss.',
    },
    {
      codeLine: 37,
      state: state(
        {
          b: 'abgewickelt',
          a: 'geprüft: Typ passt nicht',
          main: 'Handler gefunden',
          pass: '2: abwickeln',
          doing: 'finally in B',
          funclet: { method: 'Finally-Funclet von B', what: 'Console.WriteLine(...)' },
        },
        'B, A, Main',
        OUT_B,
      ),
      changed: ['f-rt-pass', 'f-rt-doing', 'f-b-state', 'f-funclet'],
      explanation:
        'Durchlauf 2 geht denselben Weg noch einmal, jetzt aber mit Wirkung. Für den jüngsten Frame ruft die Runtime das `finally` von `B` auf. Danach gilt `B` als abgewickelt.',
    },
    {
      codeLine: 25,
      state: state(
        {
          b: 'abgewickelt',
          a: 'abgewickelt',
          main: 'Handler gefunden',
          pass: '2: abwickeln',
          doing: 'finally in A',
          funclet: { method: 'Finally-Funclet von A', what: 'Console.WriteLine(...)' },
        },
        'B, A, Main',
        OUT_A,
      ),
      changed: ['f-rt-doing', 'f-a-state', 'f-funclet'],
      explanation:
        'Dann `A`: Das `finally` läuft, das `catch (ArgumentException)` wird nicht noch einmal geprüft. Durchlauf 2 führt nur noch aus, was Durchlauf 1 entschieden hat.',
    },
    {
      codeLine: 9,
      state: state(
        {
          b: 'abgewickelt',
          a: 'abgewickelt',
          main: 'im catch',
          pass: '2: Handler betreten',
          doing: 'catch in Main',
          funclet: { method: 'Catch-Funclet von Main', what: 'Console.WriteLine(...)' },
        },
        'B, A, Main',
        OUT_CATCH,
      ),
      changed: ['f-rt-pass', 'f-rt-doing', 'f-main-state', 'f-funclet'],
      explanation:
        'Erst jetzt betritt die Runtime den `catch`-Block in `Main`. Auf 64-Bit-Plattformen ist auch er ein Funclet und läuft noch oberhalb der logisch schon abgewickelten Frames.',
    },
    {
      codeLine: 11,
      state: state(
        { b: '', a: '', main: 'läuft nach dem try weiter', resumed: true },
        'B, A, Main',
        OUT_CATCH,
      ),
      changed: ['f-main-state'],
      explanation:
        'Der `catch`-Funclet liefert die Adresse zurück, an der `Main` weitermacht. Die Runtime setzt Stackzeiger und Register darauf, und die Frames von `B`, `A` und dem Dispatcher sind weg. Die Exception hängt an keinem Verweis mehr und ist Futter für den nächsten GC.',
    },
  ],
});
