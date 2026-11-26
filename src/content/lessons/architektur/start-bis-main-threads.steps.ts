import { defineStepScript, type TimelineState } from '@/components/viz';

// Threads during startup and shutdown of a console app. Time units are abstract, not measured.
// Sources: src/coreclr/vm/ceemain.cpp (FinalizerThread::FinalizerThreadCreate in EEStartupHelper),
// src/coreclr/vm/assembly.cpp (RunMainPost: ThreadStore::WaitForOtherThreads),
// Microsoft Learn "Tiered compilation" runtime config, Object.Finalize remarks
// (finalizers do not run on process exit in .NET Core and later).
// TODO(verify): That the tiering background worker is created on demand and only after the
// call counting delay (TC_CallCountingDelayMs, 100 ms by default).
// TODO(verify): Further runtime threads not shown here (diagnostics server / EventPipe IPC,
// on Unix a signal handling thread), their names and whether they exist in every configuration.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'main', label: 'Hauptthread', kind: 'main' },
  { id: 'fin', label: 'Finalizer-Thread' },
  { id: 'tier', label: 'Tiering-Hintergrund' },
  { id: 'fg', label: 'eigener Vordergrund-Thread' },
];

const host: Item = { id: 'host', lane: 'main', start: 0, end: 3, label: 'Host', kind: 'run' };
const ee: Item = {
  id: 'ee',
  lane: 'main',
  start: 3,
  end: 6,
  label: 'coreclr_initialize',
  kind: 'run',
};
const fin = (end: number): Item => ({
  id: 'fin-wait',
  lane: 'fin',
  start: 5,
  end,
  label: 'wartet auf Arbeit',
  kind: 'blocked',
});
const load: Item = {
  id: 'load',
  lane: 'main',
  start: 6,
  end: 8,
  label: 'App laden, Hooks',
  kind: 'run',
};
const main = (end: number): Item => ({
  id: 'main-run',
  lane: 'main',
  start: 8,
  end,
  label: 'Main',
  kind: 'run',
});
const fg = (end: number): Item => ({
  id: 'fg-run',
  lane: 'fg',
  start: 10,
  end,
  label: 'Arbeit',
  kind: 'run',
});
const tier: Item = {
  id: 'tier-run',
  lane: 'tier',
  start: 12,
  end: 14,
  label: 'Tier1-JIT',
  kind: 'run',
};
const waitFg: Item = {
  id: 'main-wait',
  lane: 'main',
  start: 14,
  end: 18,
  label: 'wartet auf Vordergrund-Threads',
  kind: 'blocked',
};
const shutdown: Item = {
  id: 'shutdown',
  lane: 'main',
  start: 18,
  end: 20,
  label: 'Shutdown',
  kind: 'run',
};

export default defineStepScript({
  view: 'timeline',
  title: 'Welche Threads beim Start entstehen und wann der Prozess endet',
  code: {
    cs: `static int Main()
{
    AppDomain.CurrentDomain.ProcessExit +=
        (_, _) => Console.WriteLine("ProcessExit");

    var t = new Thread(() => Arbeit()); // Vordergrund
    t.Start();

    for (int i = 0; i < 1_000; i++)
        Berechne(i);                    // wird heiß

    Console.WriteLine("Main fertig");
    return 0;
}`,
  },
  steps: [
    {
      state: { lanes, duration: 20, items: [host], now: 3 },
      changed: ['host'],
      explanation:
        'Der Prozess beginnt mit einem einzigen Thread. Auf ihm laufen Muxer, `hostfxr` und `hostpolicy`, alles nativer Code.',
    },
    {
      state: { lanes, duration: 20, items: [host, ee, fin(6)], now: 6 },
      changed: ['ee', 'fin-wait'],
      explanation:
        'Während `coreclr_initialize` startet die Runtime den **Finalizer-Thread**. Er legt sich sofort schlafen und wacht nur auf, wenn der GC Objekte mit Finalizer zum Aufräumen übergibt.',
    },
    {
      codeLine: 1,
      state: { lanes, duration: 20, items: [host, ee, fin(10), load, main(10)], now: 10 },
      changed: ['load', 'main-run'],
      explanation:
        'Laden der App, Startup Hooks und `Main` laufen auf **demselben Thread**, auf dem der Host begonnen hat. Die Runtime erzeugt für `Main` keinen eigenen Thread.',
    },
    {
      codeLine: 7,
      state: { lanes, duration: 20, items: [host, ee, fin(12), load, main(12), fg(12)], now: 12 },
      changed: ['fg-run'],
      explanation:
        '`new Thread` erzeugt standardmäßig einen **Vordergrund-Thread** (`IsBackground` ist `false`). Das wird gleich wichtig.',
    },
    {
      codeLine: 10,
      state: {
        lanes,
        duration: 20,
        items: [host, ee, fin(14), load, main(14), fg(14), tier],
        now: 14,
      },
      changed: ['tier-run'],
      explanation:
        '`Berechne` wird oft aufgerufen. Nach einer kurzen Verzögerung zählt die Runtime die Aufrufe und übersetzt die Methode auf einem **Hintergrund-Thread** neu mit voller Optimierung. `Main` läuft währenddessen mit dem Tier0-Code weiter.',
    },
    {
      codeLine: 13,
      state: {
        lanes,
        duration: 20,
        items: [host, ee, fin(18), load, main(14), fg(18), tier, waitFg],
        now: 18,
        output: 'Main fertig',
      },
      changed: ['main-wait'],
      explanation:
        'Häufige Fehlannahme: „Wenn `Main` zurückkehrt, endet der Prozess.“ Die Runtime wartet zuerst, bis alle Vordergrund-Threads fertig sind. Hintergrund-Threads, etwa aus dem ThreadPool, hielten den Prozess dagegen nicht auf.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 20,
        items: [host, ee, fin(20), load, main(14), fg(18), tier, waitFg, shutdown],
        now: 20,
        output: 'Main fertig\nProcessExit',
      },
      changed: ['shutdown'],
      explanation:
        'Erst dann fährt die Runtime herunter und löst `ProcessExit` aus. Ausstehende Finalizer laufen dabei seit .NET Core nicht mehr: Wer beim Beenden aufräumen muss, braucht `Dispose` oder `ProcessExit`, keinen Finalizer.',
    },
  ],
});
