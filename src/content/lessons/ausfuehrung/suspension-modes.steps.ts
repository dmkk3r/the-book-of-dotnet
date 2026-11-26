import { defineStepScript, type GraphState } from '@/components/viz';

// The GC mode of one thread as a state machine, after BotR threading.md (cooperative and
// preemptive mode, "Suspending the EE", "Hijacking") and src/coreclr/vm/threadsuspend.cpp
// (Thread::Hijack, HandleSuspensionForInterruptedThread: redirect if the interrupted IP is
// GC safe, otherwise hijack the return address).
// Simplified: threads in cooperative mode inside runtime (VM) code are neither redirected nor
// hijacked, the runtime waits until they switch modes themselves; GC polls are left out.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'pre', label: 'Präemptiv', detail: 'nativer Code, Warten', row: 1, col: 1, shape: 'state' },
  {
    id: 'ret',
    label: 'Trap-Flag gesetzt?',
    detail: 'beim Wechsel zurück',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'susp',
    label: 'Angehalten',
    detail: 'wartet auf Ende der GC',
    row: 1,
    col: 3,
    shape: 'state',
  },
  {
    id: 'coop',
    label: 'Kooperativ',
    detail: 'verwalteter Code',
    row: 2,
    col: 1,
    shape: 'state',
  },
  {
    id: 'where',
    label: 'Unterbrochen: Safe Point?',
    detail: 'GC-Info an dieser Stelle',
    row: 2,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'redir',
    label: 'Umgeleitet',
    detail: 'Stub sichert Kontext',
    row: 2,
    col: 3,
    shape: 'state',
  },
  {
    id: 'hij',
    label: 'Hijacked',
    detail: 'Rücksprung umgebogen',
    row: 3,
    col: 2,
    shape: 'state',
  },
];

const EDGES: Edge[] = [
  { from: 'coop', to: 'pre', label: 'P/Invoke, Warten' },
  { from: 'pre', to: 'ret', label: 'zurück' },
  { from: 'ret', to: 'coop', label: 'nein' },
  { from: 'ret', to: 'susp', label: 'ja' },
  { from: 'coop', to: 'where', label: 'GC hält an' },
  { from: 'where', to: 'redir', label: 'ja' },
  { from: 'redir', to: 'susp' },
  { from: 'where', to: 'hij', label: 'nein' },
  { from: 'hij', to: 'susp', label: 'Methode kehrt zurück' },
  { from: 'susp', to: 'coop', label: 'RestartEE' },
];

function state(path: string[], facts: Fact[]): GraphState {
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

const facts = (gc: string, where: string): Fact[] => [
  { id: 'f-gc', label: 'GC', value: gc },
  { id: 'f-where', label: 'Thread', value: where },
];

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Die Modi eines Threads',
  code: {
    cs: `void Process(Item[] items)
{
    var buffer = Read(fileHandle);      // P/Invoke
    foreach (var item in items)         // Schleife ohne Aufruf
        item.Total = item.Price * item.Count;
    Report(items);                      // Aufruf
}`,
  },
  steps: [
    {
      codeLine: 2,
      state: state(['coop'], facts('keine', 'verwalteter Code')),
      explanation:
        'Ein Thread, der verwalteten Code ausführt, ist im **kooperativen Modus**. Er darf Verweise lesen und schreiben, und der GC darf erst beginnen, wenn er diesen Modus verlassen hat. Das Book of the Runtime vergleicht den Modus mit einem Lock, den der Thread hält.',
    },
    {
      codeLine: 3,
      state: state(['coop', 'pre'], facts('keine', 'nativer Code')),
      changed: ['pre'],
      explanation:
        'Für den P/Invoke wechselt der Thread in den **präemptiven Modus**, der Lock ist freigegeben. Ab jetzt darf der GC jederzeit laufen, ohne diesen Thread anzuhalten: Nativer Code fasst keine verwalteten Verweise an.',
    },
    {
      codeLine: 3,
      state: state(['coop', 'pre'], facts('läuft', 'nativer Code, läuft weiter')),
      changed: ['f-gc', 'f-where'],
      explanation:
        'Ein anderer Thread startet eine GC und setzt das Trap-Flag. Für unseren Thread ändert sich nichts, er bleibt im nativen Code und arbeitet weiter. Er zählt für die Runtime bereits als angehalten.',
    },
    {
      codeLine: 3,
      state: state(['coop', 'pre', 'ret', 'susp'], facts('läuft', 'blockiert bei Rückkehr')),
      changed: ['ret', 'susp'],
      explanation:
        'Der native Aufruf kehrt zurück. Bevor der Thread wieder kooperativ wird, prüft er das Trap-Flag. Es ist gesetzt, also wartet er, statt weiterzulaufen. Ohne GC hätte er den Weg „nein“ direkt zurück in den kooperativen Modus genommen.',
    },
    {
      codeLine: 4,
      state: state(['susp', 'coop'], facts('beendet', 'verwalteter Code')),
      changed: ['coop'],
      explanation:
        '`RestartEE` weckt den Thread, er ist wieder kooperativ und betritt die Schleife. Die Schleife enthält keinen Aufruf, deshalb hat der JIT die Methode fully interruptible gemacht.',
    },
    {
      codeLine: 5,
      state: state(['coop', 'where', 'redir', 'susp'], facts('läuft', 'mitten in der Schleife')),
      changed: ['where', 'redir', 'susp'],
      explanation:
        'Die nächste GC beginnt, während der Thread in der Schleife steckt. Die Runtime unterbricht ihn über das Betriebssystem und prüft die Stelle: Sie ist ein Safe Point. Der Thread wird **umgeleitet**: Ein Stub sichert seinen vollständigen Registerzustand, wechselt in den präemptiven Modus und wartet.',
    },
    {
      codeLine: 6,
      state: state(['coop', 'where', 'hij'], facts('läuft', 'in Report, kein Safe Point')),
      changed: ['where', 'hij'],
      explanation:
        'Eine dritte GC trifft den Thread in `Report`, das partially interruptible ist, und zwar zwischen zwei Aufrufen. Hier gilt keine GC-Info. Die Runtime überschreibt deshalb die **Rücksprungadresse** von `Report` im Stack mit der Adresse eines eigenen Stubs und lässt den Thread weiterlaufen.',
    },
    {
      codeLine: 6,
      state: state(['coop', 'where', 'hij', 'susp'], facts('läuft', 'beim Rücksprung angehalten')),
      changed: ['susp'],
      explanation:
        'Sobald `Report` zurückkehrt, landet der Thread im Stub statt in `Process`. Die Rücksprungstelle in `Process` ist eine Aufrufstelle und damit ein Safe Point. Der Stub stellt die echte Adresse wieder her und hält den Thread dort an, bis die GC fertig ist.',
    },
  ],
});
