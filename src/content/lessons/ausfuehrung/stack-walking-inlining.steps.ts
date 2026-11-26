import { defineStepScript, type MemoryState } from '@/components/viz';

// The same exception, once from Tier 0 code (no inlining) and once from optimized code in which
// Validate was inlined into Process. Frames newest first.
// Sources: Lesson "Inlining" (inlined methods have no frame of their own), BOTR stackwalking.md
// (the walker only sees physical frames).
// TODO(verify): That the JIT inlines Validate into Process in Tier 1 and does not inline
// ThrowEmpty (a method that always throws); the exact trace text; that the exception object
// stores the captured frames in an internal field (_stackTrace in System.Exception).

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

const throwFrame: Frame = {
  id: 'i-throw',
  method: 'ThrowEmpty()',
  slots: [slot('i-throw-ex', 'Exception', 'Verweis', '0x7F3A2000', 'ex')],
};
const validateFrame: Frame = {
  id: 'i-val',
  method: 'Validate(string)',
  slots: [slot('i-val-s', 's', 'string (Verweis)', '0x7F3A0010')],
};
const processFrame = (inlined: boolean): Frame => ({
  id: 'i-proc',
  method: inlined ? 'Process(string), mit Validate eingebettet' : 'Process(string)',
  slots: [
    slot('i-proc-s', 's', 'string (Verweis)', '0x7F3A0010'),
    ...(inlined
      ? [slot('i-proc-in', 'Code von Validate', 'kein eigener Frame', 'Teil von Process')]
      : []),
  ],
});
const mainFrame: Frame = {
  id: 'i-main',
  method: 'Main()',
  slots: [slot('i-main-ret', 'Rücksprungadresse', '8 B', '→ Runtime')],
};

const ex = (trace: string): Obj => ({
  id: 'ex',
  type: 'ArgumentException',
  address: '0x7F3A2000',
  generation: 0,
  fields: [
    { name: 'Message', value: '„leer“' },
    { name: 'Stack-Trace-Daten', value: trace },
  ],
});

const TRACE0 = 'ThrowEmpty, Validate, Process, Main';
const TRACE1 = 'ThrowEmpty, Process, Main';

const state = (tier1: boolean, trace: string, output?: string): MemoryState => ({
  frames: tier1
    ? [throwFrame, processFrame(true), mainFrame]
    : [throwFrame, validateFrame, processFrame(false), mainFrame],
  heap: [ex(trace)],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Eingebettete Methoden im Stack Trace',
  code: {
    cs: `static void Main() => Process("");

static void Process(string s)
{
    Validate(s);
    Console.WriteLine(s);
}

static void Validate(string s)
{
    if (s.Length == 0) ThrowEmpty();
}

static void ThrowEmpty() => throw new ArgumentException("leer");`,
  },
  steps: [
    {
      codeLine: 14,
      state: state(false, 'noch nicht erfasst'),
      changed: ['i-throw', 'i-val', 'i-proc', 'i-main'],
      explanation:
        'Erster Lauf in **Tier 0**: Der JIT bettet nichts ein, jede Methode aus dem Quelltext hat ihren eigenen Frame. `ThrowEmpty` hat die Exception gerade erzeugt und wirft sie.',
    },
    {
      codeLine: 14,
      state: state(
        false,
        TRACE0,
        '   at Program.ThrowEmpty()\n   at Program.Validate(String s)\n   at Program.Process(String s)\n   at Program.Main()',
      ),
      changed: ['ex.Stack-Trace-Daten'],
      explanation:
        'Beim Werfen läuft ein Stack Walk und hält die Frames im Exception-Objekt fest. Hier stimmen Stack Trace und Quelltext überein, weil es vier echte Frames gab.',
    },
    {
      codeLine: 5,
      state: state(true, 'noch nicht erfasst'),
      changed: ['i-proc', 'i-proc-in'],
      explanation:
        'Später, im optimierten **Tier 1**, hat der JIT `Validate` in `Process` eingebettet. Der Code der Prüfung steckt jetzt mitten in `Process`, und auf dem Stack gibt es nur noch drei Frames.',
    },
    {
      codeLine: 14,
      state: state(
        true,
        TRACE1,
        '   at Program.ThrowEmpty()\n   at Program.Process(String s)\n   at Program.Main()',
      ),
      changed: ['ex.Stack-Trace-Daten'],
      explanation:
        'Derselbe Fehler, ein anderer Stack Trace: `Validate` **fehlt**. Der Walker kann nur melden, was physisch auf dem Stack liegt. Die Fehlannahme „Der Stack Trace zeigt jeden Aufruf wie im Quelltext“ scheitert genau hier.',
    },
  ],
});
