import { defineStepScript, type GraphState } from '@/components/viz';

// A rough decision path for "does this code work under Native AOT?". Sources: Microsoft Learn
// "Native AOT deployment overview" (limitations), "Introduction to AOT warnings" (IL3050,
// MakeGenericType throws at runtime when the instantiation was not generated).
// Simplified: the real analysis is done by the trim and AOT analyzers per call site.
// TODO(verify): Exception types under Native AOT: DynamicMethod/AssemblyBuilder and
// Assembly.LoadFrom throw PlatformNotSupportedException.
// TODO(verify): typeof(Order).GetProperties() keeps all public properties of Order without
// a warning (GetProperties is annotated with DynamicallyAccessedMembers on the Type instance).
// TODO(verify): Warning numbers: IL2057 for Type.GetType with a non-constant name, IL2075 for
// GetMethod on an unannotated Type value, IL3050 for MakeGenericType.

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'q-emit', label: 'Erzeugt Code zur Laufzeit?', row: 1, col: 1, shape: 'decision' },
  {
    id: 'e-emit',
    label: 'Geht nicht',
    detail: 'kein JIT im Prozess',
    row: 1,
    col: 2,
    shape: 'end',
  },
  { id: 'q-load', label: 'Lädt eine Assembly nach?', row: 2, col: 1, shape: 'decision' },
  {
    id: 'e-load',
    label: 'Geht nicht',
    detail: 'kein IL, kein Typlader dafür',
    row: 2,
    col: 2,
    shape: 'end',
  },
  { id: 'q-known', label: 'Reflection-Ziel statisch sichtbar?', row: 3, col: 1, shape: 'decision' },
  {
    id: 'e-warn',
    label: 'Warnung',
    detail: 'Member fehlen evtl. zur Laufzeit',
    row: 3,
    col: 2,
    shape: 'end',
  },
  { id: 'q-gen', label: 'Neue Instanziierung über Werttyp?', row: 4, col: 1, shape: 'decision' },
  {
    id: 'e-gen',
    label: 'Warnung IL3050',
    detail: 'Ausnahme, falls Code fehlt',
    row: 4,
    col: 2,
    shape: 'end',
  },
  { id: 'ok', label: 'Funktioniert', detail: 'ohne Warnung', row: 5, col: 1, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'q-emit', to: 'e-emit', label: 'ja' },
  { from: 'q-emit', to: 'q-load', label: 'nein' },
  { from: 'q-load', to: 'e-load', label: 'ja' },
  { from: 'q-load', to: 'q-known', label: 'nein' },
  { from: 'q-known', to: 'e-warn', label: 'nein' },
  { from: 'q-known', to: 'q-gen', label: 'ja' },
  { from: 'q-gen', to: 'e-gen', label: 'ja' },
  { from: 'q-gen', to: 'ok', label: 'nein' },
];

function run(path: string[], facts: Fact[] = []): GraphState {
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

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Funktioniert dieser Code unter Native AOT?',
  code: {
    cs: `// 1: Reflection auf einen bekannten Typ
var props = typeof(Order).GetProperties();

// 2: Code zur Laufzeit erzeugen
var dm = new DynamicMethod("Add", typeof(int), [typeof(int), typeof(int)]);

// 3: Assembly zur Laufzeit laden
var plugin = Assembly.LoadFrom("Plugin.dll");

// 4: Typ über einen Namen aus der Konfiguration
var handler = Type.GetType(config["Handler"]!)?.GetMethod("Run");

// 5: neue generische Instanziierung über ein Struct
var t = typeof(List<>).MakeGenericType(typeof(Point));
var list = Activator.CreateInstance(t);`,
  },
  steps: [
    {
      codeLine: 2,
      state: run(
        ['q-emit', 'q-load', 'q-known', 'q-gen', 'ok'],
        [
          fact('f-case', 'Fall', 'typeof(Order).GetProperties()'),
          fact('f-why', 'Warum', 'Typ steht im Code'),
        ],
      ),
      changed: ['q-known', 'ok', 'f-case', 'f-why'],
      explanation:
        'Reflection an sich ist erlaubt. Hier steht der Typ als `typeof(Order)` im Code, der Compiler sieht ihn und weiß aus der Annotation von `GetProperties`, dass die öffentlichen Properties gebraucht werden. Er behält sie samt Metadaten.',
    },
    {
      codeLine: 5,
      state: run(
        ['q-emit', 'e-emit'],
        [
          fact('f-case', 'Fall', 'DynamicMethod'),
          fact('f-res', 'Zur Laufzeit', 'PlatformNotSupportedException'),
        ],
      ),
      changed: ['q-emit', 'e-emit', 'f-case', 'f-res'],
      explanation:
        '`DynamicMethod` und `Reflection.Emit` erzeugen IL, das erst ein JIT in Maschinencode verwandeln würde. Den gibt es im Native-AOT-Prozess nicht. Mit `RuntimeFeature.IsDynamicCodeSupported` kann Code das prüfen und einen anderen Weg nehmen.',
    },
    {
      codeLine: 8,
      state: run(
        ['q-emit', 'q-load', 'e-load'],
        [fact('f-case', 'Fall', 'Assembly.LoadFrom'), fact('f-res', 'Zur Laufzeit', 'Ausnahme')],
      ),
      changed: ['q-load', 'e-load', 'f-case', 'f-res'],
      explanation:
        'Eine nachgeladene Assembly bestünde aus IL. Der Prozess hat weder einen JIT noch einen Typlader, der aus Metadaten MethodTables baut. Plugin-Architekturen mit `Assembly.LoadFrom` sind deshalb mit Native AOT nicht möglich.',
    },
    {
      codeLine: 11,
      state: run(
        ['q-emit', 'q-load', 'q-known', 'e-warn'],
        [
          fact('f-case', 'Fall', 'Type.GetType(name).GetMethod'),
          fact('f-warn', 'Warnungen', 'IL2057, IL2075'),
        ],
      ),
      changed: ['q-known', 'e-warn', 'f-case', 'f-warn'],
      explanation:
        'Der Typname kommt aus der Konfiguration. Der Compiler kann nicht wissen, welcher Typ und welche Methode gemeint sind, und warnt. Läuft die App trotzdem, fehlt der Typ oder seine Methode vielleicht, und `handler` ist `null`.',
    },
    {
      codeLine: 14,
      state: run(
        ['q-emit', 'q-load', 'q-known', 'q-gen', 'e-gen'],
        [
          fact('f-case', 'Fall', 'List<Point> per MakeGenericType'),
          fact('f-warn', 'Warnung', 'IL3050'),
          fact('f-res', 'Zur Laufzeit', 'Ausnahme, wenn List<Point> nie kompiliert wurde'),
        ],
      ),
      changed: ['q-gen', 'e-gen', 'f-case', 'f-warn', 'f-res'],
      explanation:
        'Für jedes Struct als Typargument braucht `List<T>` eigenen Maschinencode. Der muss beim Veröffentlichen entstanden sein, und `MakeGenericType` verrät dem Compiler nicht, welches Struct gemeint ist. Gibt es `List<Point>` nirgends sonst im Programm, scheitert der Aufruf zur Laufzeit.',
    },
  ],
});
