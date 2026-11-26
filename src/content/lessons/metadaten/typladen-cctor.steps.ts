import { defineStepScript, type GraphState } from '@/components/viz';

// Type initializer semantics after ECMA-335 Partition I, 8.9.5 (precise semantics without
// beforefieldinit: first static field access, first static method call, first constructor call
// trigger the .cctor; with beforefieldinit only "at or before first static field access") and the
// TypeInitializationException API docs. C# emits beforefieldinit only if the class has no
// explicit static constructor.
// TODO(verify): That the runtime does not retry a failed .cctor and rethrows a
// TypeInitializationException on every later access (and whether it is the same exception object).
// TODO(verify): That static field storage is allocated and zeroed when the type is loaded, before
// the .cctor runs (CoreCLR allocates statics lazily in newer versions; wording kept neutral).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Status = Node['status'];
type Fact = NonNullable<GraphState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

// The type initializer as a state machine: states in row 1 and 2, the access check between
// "nicht gelaufen" and "läuft". A failed .cctor is never started again.
const NODES: Omit<Node, 'status'>[] = [
  {
    id: 'notrun',
    label: 'Nicht gelaufen',
    detail: 'Typ geladen, MethodTable existiert',
    row: 1,
    col: 1,
    shape: 'state',
  },
  {
    id: 'access',
    label: 'Zugriff löst aus?',
    detail: 'erster Zugriff nach ECMA-Regeln',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'running',
    label: '.cctor läuft',
    detail: 'genau einmal, unter Sperre',
    row: 1,
    col: 3,
    shape: 'state',
  },
  { id: 'done', label: 'Initialisiert', row: 1, col: 4, shape: 'state' },
  {
    id: 'nocctor',
    label: 'Kein Auslöser',
    detail: 'Zugriff ohne .cctor',
    row: 2,
    col: 2,
    shape: 'end',
  },
  {
    id: 'failed',
    label: 'Fehlgeschlagen',
    detail: 'kein neuer Versuch',
    row: 2,
    col: 3,
    shape: 'state',
  },
  {
    id: 'throw',
    label: 'TypeInitializationException',
    detail: 'beim Aufrufer',
    row: 2,
    col: 4,
    shape: 'end',
  },
];
const EDGES: Edge[] = [
  { from: 'notrun', to: 'access', label: 'Zugriff' },
  { from: 'access', to: 'running', label: 'ja' },
  { from: 'access', to: 'nocctor', label: 'nein' },
  { from: 'running', to: 'done', label: 'ohne Fehler' },
  { from: 'running', to: 'failed', label: 'Ausnahme' },
  { from: 'failed', to: 'throw', label: 'jeder Zugriff' },
];

/**
 * Graph for one step: `path` lists the visited nodes in order, the last one is active.
 * `status` overrides single nodes, e.g. a state that is ruled out.
 */
function run(
  path: string[],
  facts: Fact[],
  {
    details = {},
    status = {},
  }: { details?: Record<string, string>; status?: Partial<Record<string, Status>> } = {},
): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
      status:
        status[n.id] ??
        (n.id === path[path.length - 1] ? 'active' : visited.has(n.id) ? 'done' : 'pending'),
    })),
    edges: EDGES.map((e) => ({
      ...e,
      status: pairs.has(`${e.from}->${e.to}`) ? 'taken' : 'idle',
    })),
    facts,
  };
}

const PRECISE = { access: 'präzise: Feld, Methode, Konstruktor' };

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Ein statischer Konstruktor schlägt fehl',
  code: {
    cs: `try { Config.Hallo(); }
catch (TypeInitializationException e) { Console.WriteLine(e.InnerException?.GetType().Name); }
try { Console.WriteLine(Config.Pfad); }
catch (TypeInitializationException) { Console.WriteLine("wieder"); }

class Config
{
    public static readonly string Pfad = Lade();
    static Config() { }   // explizit: kein beforefieldinit
    static string Lade() => File.ReadAllText("fehlt.txt");
    public static void Hallo() => Console.WriteLine("Hallo");
}`,
    il: `.class private auto ansi Config extends [System.Runtime]System.Object
{
    .field public static initonly string Pfad

    .method private hidebysig specialname rtspecialname static void .cctor () cil managed
    {
        call string Config::Lade()
        stsfld string Config::Pfad
        ret
    }
}`,
  },
  steps: [
    {
      codeLine: 6,
      highlight: { il: [1] },
      state: {
        ...run(
          ['notrun'],
          [
            fact('f-load', 'Geladen', 'beim Übersetzen der Hauptmethode'),
            fact('f-pfad', 'Config.Pfad', 'null'),
            fact('f-cctor', '.cctor', 'noch nicht gelaufen'),
          ],
        ),
      },
      changed: ['f-load', 'f-pfad', 'f-cctor'],
      explanation:
        'Der JIT hat `Config` geladen, weil die Hauptmethode den Typ benutzt. Laden heißt aber nicht initialisieren: Das statische Feld `Pfad` existiert und ist `null`, der statische Konstruktor ist nicht gelaufen. Im IL fehlt das Flag `beforefieldinit`, weil `Config` einen expliziten statischen Konstruktor hat.',
    },
    {
      codeLine: 1,
      state: {
        ...run(
          ['notrun', 'access'],
          [
            fact('f-access', 'Erster Zugriff', 'Aufruf der statischen Methode Hallo'),
            fact('f-rule', 'Regel', 'präzise: auch Methodenaufrufe lösen aus'),
            fact('f-out', 'Ausgabe', 'noch nichts'),
          ],
          { details: PRECISE },
        ),
      },
      changed: ['f-access', 'f-rule'],
      explanation:
        '`Hallo` greift auf kein Feld zu. Trotzdem muss der statische Konstruktor **vor** dem ersten Aufruf einer statischen Methode laufen, denn ohne `beforefieldinit` gelten die präzisen Regeln aus ECMA-335: erster Feldzugriff, erster Aufruf einer statischen Methode oder erster Konstruktoraufruf.',
    },
    {
      codeLine: 8,
      highlight: { il: [5, 6, 7, 8, 9] },
      state: {
        ...run(
          ['notrun', 'access', 'running'],
          [
            fact('f-body', '.cctor', 'Feldinitialisierer, dann Rumpf von static Config()'),
            fact('f-throw', 'Lade()', 'wirft FileNotFoundException'),
          ],
          { details: PRECISE },
        ),
      },
      changed: ['f-body', 'f-throw'],
      explanation:
        'Der C#-Compiler hat den Feldinitialisierer in die Methode `.cctor` verschoben, vor den Rumpf des statischen Konstruktors. `Lade()` findet die Datei nicht und wirft. Die Runtime hält während der Ausführung eine Sperre, damit kein anderer Thread den Typ halb initialisiert sieht.',
    },
    {
      codeLine: 2,
      state: {
        ...run(
          ['notrun', 'access', 'running', 'failed', 'throw'],
          [
            fact('f-exc', 'Aufrufer sieht', 'TypeInitializationException'),
            fact('f-inner', 'InnerException', 'FileNotFoundException'),
            fact('f-state', 'Zustand von Config', 'Initialisierung fehlgeschlagen'),
          ],
          { details: PRECISE },
        ),
        output: 'FileNotFoundException',
      },
      changed: ['f-exc', 'f-inner', 'f-state'],
      explanation:
        'Die Ausnahme verlässt den statischen Konstruktor nicht direkt. Die Runtime verpackt sie in eine **TypeInitializationException**, die an der Stelle des Zugriffs auftaucht. `Hallo` selbst ist nie gelaufen, „Hallo“ wird nicht ausgegeben.',
    },
    {
      codeLine: 3,
      state: {
        ...run(
          ['notrun', 'failed', 'throw'],
          [
            fact('f-retry', 'Neuer Versuch', 'nein'),
            fact('f-exc', 'Aufrufer sieht', 'wieder TypeInitializationException'),
            fact('f-state', 'Zustand von Config', 'bleibt kaputt bis Prozessende'),
          ],
          {
            details: PRECISE,
            status: { access: 'skipped', running: 'rejected' },
          },
        ),
        output: 'FileNotFoundException\nwieder',
      },
      changed: ['f-retry', 'f-exc', 'f-state'],
      explanation:
        'Der zweite Zugriff startet den Konstruktor **nicht** neu, auch wenn die Datei inzwischen existieren würde. Der Typ ist für den Rest des Prozesses unbenutzbar, jeder Zugriff wirft erneut. Einen Wiederholungsversuch gibt es nicht.',
    },
    {
      codeLine: 9,
      state: {
        ...run(
          ['notrun', 'access', 'nocctor'],
          [
            fact('f-myth', 'Fehlannahme', '„Die .cctor läuft beim Laden der Assembly.“'),
            fact('f-truth', 'Tatsächlich', 'beim ersten Zugriff nach ECMA-Regeln'),
            fact('f-bfi', 'Ohne Zeile 9', 'beforefieldinit: Hallo() löst nichts aus'),
          ],
          { details: { access: 'beforefieldinit: nur Feldzugriff' } },
        ),
        output: 'FileNotFoundException\nwieder',
      },
      changed: ['f-myth', 'f-truth', 'f-bfi'],
      explanation:
        'Fehlannahme: „Der statische Konstruktor läuft, sobald die Assembly geladen wird.“ Er läuft weder beim Laden der Assembly noch beim Laden des Typs, sondern beim ersten auslösenden Zugriff. Ohne die Zeile `static Config() { }` setzt der Compiler `beforefieldinit`, und dann muss nur noch ein Zugriff auf ein statisches Feld die Initialisierung auslösen.',
    },
  ],
});
