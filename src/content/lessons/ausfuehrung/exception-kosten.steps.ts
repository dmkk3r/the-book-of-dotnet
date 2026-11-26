import { defineStepScript, type PipelineState } from '@/components/viz';

// The work behind one throw, from the allocation to the continuation after the catch.
// The stages are strictly sequential for a single exception, so a pipeline fits.
// Sources: ECMA-335 Partition I, 12.4.2 (two passes); BOTR exceptions.md; BOTR clr-abi.md
// (funclets, catch funclet returns continuation address); Microsoft Learn,
// AppDomain.FirstChanceException (raised before the runtime searches for a handler);
// "What's new in the .NET 9 runtime" (managed exception handling ported from NativeAOT).
// TODO(verify): Which frames lie between the throw and Sum for int.Parse("abc") in .NET 8/9/10
// (Number.ThrowFormatException or similar helpers; [StackTraceHidden] helpers still count for
// the walk even if hidden in the trace).
// TODO(verify): That a throw also raises an EventPipe/ETW ExceptionThrown event when a session
// with the exception keyword is active, and the debugger first-chance notification.
// TODO(verify): That the FormatException message comes from a resource lookup (SR) on first use.
// No absolute timings on purpose; relative statements only.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];
type Fact = NonNullable<PipelineState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

const stages = (...status: Status[]): Stage[] => [
  {
    id: 'alloc',
    label: 'Exception erzeugen',
    detail: 'Objekt, Konstruktor, Text',
    status: status[0] ?? 'pending',
  },
  {
    id: 'throw',
    label: 'Übergabe an die Runtime',
    detail: 'Übergang, Benachrichtigungen',
    status: status[1] ?? 'pending',
  },
  {
    id: 'pass1',
    label: 'Durchlauf 1',
    detail: 'pro Frame: suchen, Trace',
    status: status[2] ?? 'pending',
  },
  {
    id: 'pass2',
    label: 'Durchlauf 2',
    detail: 'pro Frame: abwickeln',
    status: status[3] ?? 'pending',
  },
  {
    id: 'catch',
    label: 'catch und Fortsetzung',
    detail: 'Funclet, Register setzen',
    status: status[4] ?? 'pending',
  },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Was ein einziger Wurf an Arbeit auslöst',
  code: {
    cs: `static int Sum(string[] lines)
{
    int sum = 0;
    foreach (var s in lines)
    {
        try
        {
            sum += int.Parse(s);
        }
        catch (FormatException)
        {
            // ungültige Zeile überspringen
        }
    }
    return sum;
}

Sum(["12", "abc"]);`,
  },
  steps: [
    {
      codeLine: 8,
      state: {
        stages: stages('skipped', 'skipped', 'skipped', 'skipped', 'skipped'),
        facts: [fact('f-in', 'Eingabe', '"12"'), fact('f-work', 'Aufwand für try', 'keiner')],
      },
      changed: ['f-in', 'f-work'],
      explanation:
        'Erste Zeile, gültige Eingabe. Der `try`-Block kostet hier nichts: Es gibt keinen Befehl, der ihn betritt oder verlässt, nur einen Eintrag in einer Tabelle. Keine der fünf Stufen läuft: Ein `try` ohne Wurf bremst nicht.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('active'),
        facts: [
          fact('f-in', 'Eingabe', '"abc"'),
          fact('f-work', 'Arbeit', 'Allokation, Konstruktor, Meldungstext'),
        ],
      },
      changed: ['alloc', 'f-in', 'f-work'],
      explanation:
        'Zweite Zeile, `int.Parse` erkennt den Fehler und erzeugt eine `FormatException`. Das ist eine gewöhnliche Allokation mit Konstruktoraufruf, dazu kommt der Meldungstext. Billig im Vergleich zu dem, was folgt.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'active'),
        facts: [
          fact('f-in', 'Eingabe', '"abc"'),
          fact('f-work', 'Arbeit', 'Kontext sichern, First-Chance melden'),
        ],
      },
      changed: ['throw', 'f-work'],
      explanation:
        '`throw` verlässt den schnellen JIT-Code und ruft in die Runtime. Sie sichert den Registerzustand als Startpunkt, meldet die Exception als First-Chance an einen angehängten Debugger, an `FirstChanceException`-Handler und gegebenenfalls an eine laufende Trace-Sitzung.',
    },
    {
      codeLine: 10,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          fact('f-frames', 'Frames bis zum catch', 'Parse-Helfer, int.Parse, Sum'),
          fact('f-work', 'Arbeit pro Frame', 'Methode suchen, Klauseln prüfen, Unwind'),
        ],
      },
      changed: ['pass1', 'f-frames', 'f-work'],
      explanation:
        'Durchlauf 1 läuft vom Wurfpunkt nach oben. Für jeden Frame sucht die Runtime die Methode zur Codeadresse, liest ihre Klauseln, prüft Typen und hängt einen Eintrag an den Stack-Trace an. Diese Arbeit wächst mit der Zahl der Frames zwischen `throw` und `catch`.',
    },
    {
      codeLine: 10,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          fact('f-frames', 'Frames bis zum catch', 'dieselben noch einmal'),
          fact('f-work', 'Arbeit pro Frame', 'Unwind, finally-Funclets aufrufen'),
        ],
      },
      changed: ['pass2', 'f-frames', 'f-work'],
      explanation:
        'Durchlauf 2 geht denselben Weg ein zweites Mal, ruft `finally`-Blöcke auf und wickelt ab. Jeder Frame zwischen Wurf und Handler wird also zweimal angefasst.',
    },
    {
      codeLine: 12,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        facts: [
          fact('f-work', 'Arbeit', 'catch-Funclet, Stack zurücksetzen'),
          fact('f-left', 'Übrig', 'Exception-Objekt für den GC'),
        ],
      },
      changed: ['catch', 'f-work', 'f-left'],
      explanation:
        'Zum Schluss läuft der `catch`-Funclet, die Runtime setzt den Stack auf die Fortsetzungsadresse und kehrt in den JIT-Code zurück. Das Exception-Objekt mit seinen Trace-Daten bleibt als Müll für den GC liegen.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done'),
        facts: [
          fact('f-in', 'Mit int.TryParse', 'keine der fünf Stufen'),
          fact('f-rel', 'Verhältnis', 'ein Wurf kostet ein Vielfaches eines Parse'),
        ],
      },
      changed: ['f-in', 'f-rel'],
      explanation:
        'Bilanz: Ein Wurf ist eine Allokation, ein Ausflug in die Runtime und zwei Wanderungen über den Stack. `int.TryParse` liefert für dieselbe Eingabe einfach `false` zurück. Wie groß der Unterschied in Zahlen ist, misst der Abschnitt „Selbst nachweisen“.',
    },
  ],
});
