import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract. Bar lengths only show "the blocking pause is long, the BGC pauses are
// short", not a measured ratio. Both scenarios use workstation GC: the blocking GC runs on the
// thread that triggered it (Microsoft Learn, workstation-server-gc), the BGC on one dedicated
// background GC thread (Microsoft Learn, background-gc).
// TODO(verify): That the work done during the initial suspension of a BGC runs on the BGC thread
// (BotR "Functional Behavior": "Background GC thread calls RestartEE to resume managed threads").

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'b1', label: 'Blockierend: Thread 1', kind: 'pool' },
  { id: 'b2', label: 'Blockierend: Thread 2', kind: 'pool' },
  { id: 'g1', label: 'Background: Thread 1', kind: 'pool' },
  { id: 'g2', label: 'Background: Thread 2', kind: 'pool' },
  { id: 'gbgc', label: 'Background: BGC-Thread' },
];

const item = (
  id: string,
  lane: string,
  start: number,
  end: number,
  label: string,
  kind: Item['kind'] = 'run',
): Item => ({ id, lane, start, end, label, kind });

const before: Item[] = [
  item('b1-a', 'b1', 0, 6, 'Anfragen'),
  item('b2-a', 'b2', 0, 6, 'Anfragen'),
  item('g1-a', 'g1', 0, 6, 'Anfragen'),
  item('g2-a', 'g2', 0, 6, 'Anfragen'),
];

const blocking: Item[] = [
  item('b1-gc', 'b1', 6, 16, 'Gen2-GC, blockierend'),
  item('b2-stop', 'b2', 6, 16, 'angehalten', 'blocked'),
  item('b1-b', 'b1', 16, 24, 'Anfragen'),
  item('b2-b', 'b2', 16, 24, 'Anfragen'),
];

const initial: Item[] = [
  item('g1-s1', 'g1', 6, 7, 'Pause', 'blocked'),
  item('g2-s1', 'g2', 6, 7, 'Pause', 'blocked'),
  item('bgc-init', 'gbgc', 6, 7, 'Start'),
];

const concurrentMark: Item[] = [
  item('g1-b', 'g1', 7, 14, 'Anfragen, allozieren'),
  item('g2-b', 'g2', 7, 14, 'Anfragen, allozieren'),
  item('bgc-mark', 'gbgc', 7, 14, 'Gen2 markieren'),
];

const finalPause: Item[] = [
  item('g1-s2', 'g1', 14, 15, 'Pause', 'blocked'),
  item('g2-s2', 'g2', 14, 15, 'Pause', 'blocked'),
  item('bgc-final', 'gbgc', 14, 15, 'Abschluss'),
];

const sweep: Item[] = [
  item('g1-c', 'g1', 15, 24, 'Anfragen'),
  item('g2-c', 'g2', 15, 24, 'Anfragen'),
  item('bgc-sweep', 'gbgc', 15, 21, 'Sweep'),
];

export default defineStepScript({
  view: 'timeline',
  title: 'Blockierende Gen2-GC und Background GC im Vergleich',
  layout: 'stacked',
  code: {
    cs: `// Ein Dienst mit großem, langlebigem Heap
static readonly Dictionary<int, Customer> s_cache = LoadCustomers(); // liegt in Gen2

void HandleRequest(int id)
{
    var buffer = new byte[4096];    // kurzlebig, landet in Gen0
    var customer = s_cache[id];
    Render(customer, buffer);
}`,
  },
  steps: [
    {
      codeLine: 6,
      state: { lanes, duration: 24, items: before, now: 6 },
      changed: ['b1-a', 'b2-a', 'g1-a', 'g2-a'],
      explanation:
        'Zweimal derselbe Dienst: oben ohne, unten mit Background GC. Beide Threads bearbeiten Anfragen und allozieren. Zum Zeitpunkt 6 entscheidet der GC, dass eine **Gen2-Collection** fällig ist.',
    },
    {
      codeLine: 2,
      state: { lanes, duration: 24, items: [...before, ...blocking], now: 16 },
      changed: ['b1-gc', 'b2-stop'],
      explanation:
        'Ohne Background GC läuft die volle Collection **blockierend**: Thread 1 hat sie ausgelöst und führt sie selbst aus, Thread 2 ist die ganze Zeit angehalten. Die Pause wächst mit dem, was in Gen2 lebt, hier also mit dem großen Cache.',
    },
    {
      codeLine: 2,
      state: { lanes, duration: 24, items: [...before, ...blocking, ...initial], now: 7 },
      changed: ['g1-s1', 'g2-s1', 'bgc-init'],
      explanation:
        'Mit Background GC beginnt die Collection ebenfalls mit einer Pause, aber nur einer **kurzen**. Darin wird der dedizierte BGC-Thread gestartet und bereitet die Markierung vor. Danach laufen die Anwendungs-Threads wieder.',
    },
    {
      codeLine: 6,
      state: {
        lanes,
        duration: 24,
        items: [...before, ...blocking, ...initial, ...concurrentMark],
        now: 14,
      },
      changed: ['g1-b', 'g2-b', 'bgc-mark'],
      explanation:
        'Der Hauptteil der Arbeit, das Markieren von Gen2, läuft auf dem BGC-Thread **gleichzeitig** mit dem Programm. Die Anfrage-Threads arbeiten weiter und allozieren neue Objekte in Gen0. Dass sie dabei Verweise ändern, muss der GC berücksichtigen (dazu später mehr).',
    },
    {
      codeLine: 2,
      state: {
        lanes,
        duration: 24,
        items: [...before, ...blocking, ...initial, ...concurrentMark, ...finalPause],
        now: 15,
      },
      changed: ['g1-s2', 'g2-s2', 'bgc-final'],
      explanation:
        'Zum Abschluss der Markierung hält der GC die Threads noch einmal **kurz** an. In dieser Pause holt er nach, was sich während der nebenläufigen Markierung verändert hat. Danach steht fest, was in Gen2 lebt.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 24,
        items: [...before, ...blocking, ...initial, ...concurrentMark, ...finalPause, ...sweep],
        now: 24,
      },
      changed: ['g1-c', 'g2-c', 'bgc-sweep'],
      explanation:
        'Das Freigeben (**Sweep**) läuft wieder nebenläufig: Die Lücken der toten Gen2-Objekte kommen in eine Freiliste, nichts wird verschoben. Die Anwendung sieht nur zwei kurze Pausen statt einer langen.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 24,
        items: [...before, ...blocking, ...initial, ...concurrentMark, ...finalPause, ...sweep],
        now: 24,
        output:
          'Pausen (abstrakte Einheiten): blockierend 10, Background 1 + 1. GC-Arbeit insgesamt: in beiden Fällen ein voller Durchlauf über Gen2.',
      },
      changed: ['bgc-mark', 'bgc-sweep'],
      explanation:
        // TODO(verify): BGC total CPU cost is at least that of a blocking gen2 (extra work for revisiting written pages).
        'Häufige Fehlannahme: „Background GC macht die volle Collection billiger.“ Nein, der BGC-Thread muss genauso alles Lebende in Gen2 markieren, dazu kommt das Nacharbeiten geänderter Seiten. Background GC verschiebt die Arbeit **neben** das Programm, sie kostet weiterhin CPU-Zeit.',
    },
  ],
});
