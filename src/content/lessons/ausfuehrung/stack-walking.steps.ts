import { defineStepScript, type MemoryState } from '@/components/viz';

// A stack walk through mixed frames: managed code calls native qsort via P/Invoke, qsort calls
// back into managed code ([UnmanagedCallersOnly]), and the callback captures a StackTrace.
// Frames newest first. Runtime Frame objects (BOTR stackwalking.md: allocated on the stack inside
// the frame of the code that pushes them, linked newest to oldest, head stored in the Thread) are
// shown as slots inside the frame that contains them.
// Sources: BOTR stackwalking.md (virtual unwind, Frame chain, transition frames, comparison of
// stack addresses), BOTR clr-abi.md (InlinedCallFrame holds return address, stack pointer and
// frame pointer; method with an InlinedCallFrame uses rbp on AMD64).
// TODO(verify): That the qsort P/Invoke is inlined (InlinedCallFrame instead of an IL stub) in
// optimized code; the exact kind of transition record for [UnmanagedCallersOnly] entry (the JIT
// calls a reverse P/Invoke enter helper with a frame structure in the method's own frame); the
// name StackFrameHelper for the managed object the runtime fills; that the frames of
// System.Diagnostics.StackTrace itself are skipped; the exact console format of the trace.
// The IL offsets in the helper object are fictional examples.

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

const FRAMES: Frame[] = [
  {
    id: 'w-rt',
    method: 'Runtime-Code (nativ, C++)',
    slots: [
      slot('w-rt-walk', 'Stack Walker', 'läuft hier', 'Startkontext: eigene Register'),
      slot(
        'w-rt-tf',
        'Übergangsframe',
        'Frame-Objekt, jüngstes der Kette',
        'IP, SP, FP des Aufrufers',
      ),
    ],
  },
  {
    id: 'w-st',
    method: 'StackTrace-Konstruktor und Helfer (verwaltet)',
    slots: [slot('w-st-h', 'helper', 'Verweis', '0x7F3A1040', 'helper')],
  },
  {
    id: 'w-cmp',
    method: 'Compare(int*, int*) (verwaltet, UnmanagedCallersOnly)',
    slots: [
      slot('w-cmp-loc', 'Locals, Spills', 'Layout laut GC-Info', 'keine Verweise'),
      slot('w-cmp-rp', 'Reverse-P/Invoke-Daten', 'vom JIT im Frame angelegt', 'Thread, Zustand'),
      slot('w-cmp-ret', 'Rücksprungadresse', '8 B', '→ qsort'),
    ],
  },
  {
    id: 'w-qs',
    method: 'qsort (nativ, C-Bibliothek)',
    slots: [
      slot('w-qs-data', 'eigene Daten', 'für die Runtime undurchsichtig', '?'),
      slot('w-qs-ret', 'Rücksprungadresse', '8 B', '→ Sort'),
    ],
  },
  {
    id: 'w-sort',
    method: 'Sort(int[]) (verwaltet)',
    slots: [
      slot('w-sort-arr', 'arr', 'Verweis, als GC-Root gemeldet', '0x7F3A0F00'),
      slot('w-sort-icf', 'InlinedCallFrame', 'Frame-Objekt', 'IP, SP, FP von Sort am Aufruf'),
      slot('w-sort-ret', 'Rücksprungadresse', '8 B', '→ Main'),
    ],
  },
  {
    id: 'w-main',
    method: 'Main() (verwaltet)',
    slots: [slot('w-main-ret', 'Rücksprungadresse', '8 B', '→ Runtime, Aufruf von Main')],
  },
];

const ENTRIES = ['Compare, IL-Offset 0x0', 'Sort, IL-Offset 0x1A', 'Main, IL-Offset 0x10'] as const;

const helper = (n: number): Obj => ({
  id: 'helper',
  type: 'StackFrameHelper',
  address: '0x7F3A1040',
  generation: 0,
  fields: ENTRIES.map((e, i) => ({ name: `Frame ${i}`, value: i < n ? e : 'leer' })),
});

const state = (n: number, output?: string): MemoryState => ({
  frames: FRAMES,
  heap: [helper(n)],
  ...(output !== undefined ? { output } : {}),
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Ein Stack Walk durch gemischte Frames',
  code: {
    cs: `static void Main() => Sort(new[] { 3, 1, 2 });

static unsafe void Sort(int[] arr)
{
    fixed (int* p = arr)
        qsort(p, (nuint)arr.Length, sizeof(int), &Compare);
}

[UnmanagedCallersOnly]
static unsafe int Compare(int* a, int* b)
{
    Console.WriteLine(new StackTrace());
    return *a - *b;
}

[DllImport("libc")]
static extern unsafe void qsort(void* b, nuint n, nuint size,
    delegate* unmanaged<int*, int*, int> cmp);`,
  },
  steps: [
    {
      codeLine: 12,
      state: state(0),
      changed: ['w-rt', 'w-rt-walk'],
      explanation:
        'Der jüngste Frame steht oben. `new StackTrace()` ist in der Runtime angekommen, und der Walker beginnt mit dem Registerzustand des Runtime-Codes. Nativen C++-Code will die Runtime aber nicht selbst entwirren.',
    },
    {
      codeLine: 12,
      state: state(0),
      changed: ['w-rt-tf'],
      explanation:
        'Beim Übergang von verwaltetem Code in die Runtime wurde ein **Übergangsframe** angelegt, ein `Frame`-Objekt mit den Registern des verwalteten Aufrufers. Der Thread kennt das jüngste dieser Objekte. Daraus übernimmt der Walker IP, SP und FP und steht damit im verwalteten Code.',
    },
    {
      codeLine: 12,
      state: state(0),
      changed: ['w-st'],
      explanation:
        'Die ersten verwalteten Frames gehören zur `StackTrace`-Klasse selbst. Der Walker besucht sie, die API lässt sie aber weg, weil sie niemanden interessieren. Weiter geht es mit dem **virtuellen Unwind**: Die Unwind-Info sagt, wo Rücksprungadresse und gesicherte Register liegen.',
    },
    {
      codeLine: 12,
      state: state(1),
      changed: ['w-cmp', 'helper.Frame 0'],
      explanation:
        'Die IP liegt in JIT-Code. Der **Code Manager** findet über die Adresse die Methode `Compare`, die Debug-Info übersetzt die native Position in einen IL-Offset. Beides landet im Hilfsobjekt, aus dem `StackTrace` später seine Zeilen baut.',
    },
    {
      codeLine: 6,
      state: state(1),
      changed: ['w-qs'],
      explanation:
        'Der Unwind aus `Compare` liefert eine Rücksprungadresse in `qsort`. Die gehört keinem JIT-Code, und über fremden nativen Code weiß die Runtime nichts Verlässliches. Statt zu raten, springt der Walker zum nächsten `Frame`-Objekt der Kette.',
    },
    {
      codeLine: 6,
      state: state(2),
      changed: ['w-sort-icf', 'w-sort', 'helper.Frame 1'],
      explanation:
        'Vor dem P/Invoke-Aufruf hat `Sort` ein **InlinedCallFrame** in seinem eigenen Frame angelegt und IP, SP und FP darin gespeichert. Damit landet der Walker sicher in `Sort`, alle nativen Frames dazwischen sind übersprungen.',
    },
    {
      codeLine: 1,
      state: state(3),
      changed: ['w-main', 'helper.Frame 2'],
      explanation:
        'Noch ein virtueller Unwind mit der Unwind-Info von `Sort`, und der Walker steht in `Main`. Würde gerade ein GC laufen statt `StackTrace`, würde der Walker hier und in `Sort` zusätzlich die lebenden Verweise melden, etwa `arr`.',
    },
    {
      codeLine: 12,
      state: state(
        3,
        '   at Program.Compare(Int32* a, Int32* b)\n   at Program.Sort(Int32[] arr)\n   at Program.Main()',
      ),
      changed: ['helper'],
      explanation:
        'Hinter `Main` folgt nur noch Code der Runtime, der Walk ist zu Ende. Im Ergebnis fehlen `qsort`, die Runtime-Frames und die Frames von `StackTrace`: Ein Stack Trace zeigt die verwalteten Frames, die der Walker gefunden und die API behalten hat, nicht alles, was auf dem Stack liegt.',
    },
  ],
});
