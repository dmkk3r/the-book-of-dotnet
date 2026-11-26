import { defineStepScript, type TimelineState } from '@/components/viz';

// One blocking workstation GC with four threads, after BotR threading.md ("Suspending the EE",
// "Hijacking") and ThreadSuspend::SuspendAllThreads in src/coreclr/vm/threadsuspend.cpp:
// set the trap, then wait for threads in cooperative mode, preemptive threads are left alone and
// block only when they try to return to cooperative mode.
// Time units are abstract and not measured. Real suspensions usually take microseconds.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'l1', label: 'Thread 1 (alloziert, löst GC aus)', kind: 'main' },
  { id: 'l2', label: 'Thread 2 (Rechenschleife)', kind: 'pool' },
  { id: 'l3', label: 'Thread 3 (P/Invoke)', kind: 'pool' },
  { id: 'l4', label: 'Thread 4 (wartet auf Lock)', kind: 'pool' },
];

const ALL: Item[] = [
  { id: 't1-alloc', lane: 'l1', start: 0, end: 4, label: 'Allokationen', kind: 'run' },
  { id: 't1-susp', lane: 'l1', start: 4, end: 7, label: 'SuspendEE', kind: 'run' },
  { id: 't1-gc', lane: 'l1', start: 7, end: 13, label: 'GC läuft', kind: 'run' },
  { id: 't1-restart', lane: 'l1', start: 13, end: 14, label: 'RestartEE', kind: 'run' },
  { id: 't1-more', lane: 'l1', start: 14, end: 20, label: 'Allokation erfüllt', kind: 'run' },
  { id: 't2-loop', lane: 'l2', start: 0, end: 4, label: 'Schleife', kind: 'run' },
  { id: 't2-tosp', lane: 'l2', start: 4, end: 7, label: 'zum Safe Point', kind: 'run' },
  { id: 't2-stop', lane: 'l2', start: 7, end: 14, label: 'angehalten', kind: 'blocked' },
  { id: 't2-loop2', lane: 'l2', start: 14, end: 20, label: 'Schleife', kind: 'run' },
  { id: 't3-native', lane: 'l3', start: 0, end: 9, label: 'nativer Code (präemptiv)', kind: 'run' },
  { id: 't3-block', lane: 'l3', start: 9, end: 14, label: 'Rückkehr blockiert', kind: 'blocked' },
  { id: 't3-managed', lane: 'l3', start: 14, end: 20, label: 'verwalteter Code', kind: 'run' },
  { id: 't4-wait', lane: 'l4', start: 0, end: 17, label: 'wartet (präemptiv)', kind: 'blocked' },
  { id: 't4-run', lane: 'l4', start: 17, end: 20, label: 'Lock erhalten', kind: 'run' },
];

/** Timeline up to `now`: items that have started, cut at `now`. */
function at(now: number): TimelineState {
  const items = ALL.filter((i) => i.start < now).map((i) => ({ ...i, end: Math.min(i.end, now) }));
  return { lanes, duration: 20, items, now };
}

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'Vier Threads, eine blockierende GC',
  code: {
    cs: `// Thread 1: alloziert, bis Gen0 voll ist
var buffer = new byte[4096];

// Thread 2: rechnet in einer Schleife ohne Aufruf
for (int i = 0; i < data.Length; i++) sum += data[i];

// Thread 3: steckt in einem nativen Aufruf
int read = NativeApi.Read(handle, ptr, size);

// Thread 4: wartet auf einen Lock
lock (gate) { Work(); }`,
  },
  steps: [
    {
      codeLine: 2,
      state: at(4),
      changed: ['t1-alloc', 't2-loop', 't3-native', 't4-wait'],
      explanation:
        'Vier Threads arbeiten. Thread 1 und 2 führen verwalteten Code aus, sie sind im **kooperativen Modus**. Thread 3 steckt in nativem Code und Thread 4 wartet auf einen Lock: Beide sind im **präemptiven Modus**, sie haben der Runtime zugesagt, keine Verweise anzufassen.',
    },
    {
      codeLine: 2,
      state: at(5),
      changed: ['t1-susp'],
      explanation:
        'Thread 1 findet keinen Platz mehr für seine Allokation und löst eine GC aus. Als Erstes ruft er `SuspendEE` auf: Er setzt das globale Trap-Flag und schaut nach, welche Threads noch kooperativ laufen. Das sind nur Thread 2, die anderen beiden gelten sofort als angehalten.',
    },
    {
      codeLine: 5,
      state: at(8),
      changed: ['t2-tosp', 't2-stop', 't1-gc'],
      explanation:
        'Thread 2 rechnet weiter, bis die Runtime ihn an einen Safe Point bringt: Seine Methode ist fully interruptible, also wird er unterbrochen und an Ort und Stelle umgeleitet. Thread 3 läuft die ganze Zeit ungestört nativ weiter. Mit dem letzten kooperativen Thread endet `SuspendEE`, und die eigentliche GC beginnt.',
    },
    {
      codeLine: 8,
      state: at(10),
      changed: ['t3-block'],
      explanation:
        'Die GC läuft. Thread 3 kehrt aus dem nativen Aufruf zurück und will wieder in den kooperativen Modus. Dabei sieht er das Trap-Flag und blockiert, bis die GC fertig ist. Er hat nie Verweise angefasst, während der GC sie umschrieb.',
    },
    {
      codeLine: 2,
      state: at(14),
      changed: ['t1-restart', 't2-stop', 't3-block'],
      explanation:
        '`RestartEE` löscht das Trap-Flag und weckt alle Threads, die auf das Ende der GC warten. Für Thread 2 dauerte die Pause von 7 bis 14, gemessen ab dem Auslösen der GC sogar von 4 bis 14: Die Zeit bis zum Safe Point gehört zur Pause dazu.',
    },
    {
      codeLine: 11,
      state: at(20),
      changed: ['t1-more', 't2-loop2', 't3-managed', 't4-run'],
      explanation:
        'Alle laufen weiter. Thread 4 hat von der GC nichts gemerkt: Er wartete die ganze Zeit präemptiv und bekommt seinen Lock erst später. Ein Thread wird also nicht an jeder beliebigen Stelle eingefroren, sondern nur dort, wo er Verweise anfassen könnte.',
    },
  ],
});
