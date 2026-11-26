import { defineStepScript, type GraphState } from '@/components/viz';

// What the runtime decides when a method is called for the first time in a process that loads
// ReadyToRun images. Sources: BOTR readytorun-overview.md, readytorun-format.md (sections
// MethodDefEntryPoints, InstanceMethodEntryPoints, fixup kinds Check_TypeLayout and
// Check_InstructionSetSupport), Microsoft Learn "ReadyToRun deployment overview".
// TODO(verify): That List<Customer>.Add (reference type argument) runs the shared canonical code
// List<__Canon>.Add precompiled in the R2R image of System.Private.CoreLib.
// TODO(verify): That crossgen2 does not pregenerate List<Price>.Add (struct from App.dll, generic
// definition from CoreLib) into App.dll when CoreLib is outside the version bubble, so it is jitted.
// TODO(verify): That a failed Check_InstructionSetSupport fixup makes the runtime drop the R2R code
// of that method and fall back to the JIT (readytorun-format.md describes the fixup this way).
// TODO(verify): That an attached profiler can make the runtime ignore all R2R code (e.g. the
// COR_PRF_DISABLE_ALL_NGEN_IMAGES event mask flag).

type Node = GraphState['nodes'][number];
type Edge = GraphState['edges'][number];
type Fact = NonNullable<GraphState['facts']>[number];

const NODES: Omit<Node, 'status'>[] = [
  { id: 'call', label: 'Erster Aufruf', detail: 'Methode hat noch keinen Code', row: 1, col: 1 },
  {
    id: 'img',
    label: 'Image angenommen?',
    detail: 'beim Laden der Assembly geprüft',
    row: 1,
    col: 2,
    shape: 'decision',
  },
  {
    id: 'entry',
    label: 'Code im Image?',
    detail: 'Eintrag für genau diese Methode',
    row: 1,
    col: 3,
    shape: 'decision',
  },
  { id: 'fix', label: 'Fixups füllen', detail: 'Zellen der Methode', row: 1, col: 4 },
  {
    id: 'jit',
    label: 'JIT übersetzt',
    detail: 'IL aus derselben Datei',
    row: 2,
    col: 2,
    shape: 'end',
  },
  { id: 'check', label: 'Prüfungen bestanden?', row: 2, col: 4, shape: 'decision' },
  { id: 'r2r', label: 'R2R-Code läuft', detail: 'kein JIT nötig', row: 3, col: 4, shape: 'end' },
];
const EDGES: Edge[] = [
  { from: 'call', to: 'img' },
  { from: 'img', to: 'entry', label: 'ja' },
  { from: 'img', to: 'jit', label: 'nein' },
  { from: 'entry', to: 'fix', label: 'ja' },
  { from: 'entry', to: 'jit', label: 'nein' },
  { from: 'fix', to: 'check' },
  { from: 'check', to: 'r2r', label: 'ja' },
  { from: 'check', to: 'jit', label: 'nein' },
];

/** Graph for one first call: `path` lists the visited nodes, the last one is active. */
function run(path: string[], details: Record<string, string> = {}, facts: Fact[] = []): GraphState {
  const visited = new Set(path);
  const pairs = new Set(path.slice(1).map((id, i) => `${path[i]}->${id}`));
  return {
    nodes: NODES.map((n) => ({
      ...n,
      ...(details[n.id] ? { detail: details[n.id] } : {}),
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
const SUM = 'Billing.Sum';

export default defineStepScript({
  view: 'graph',
  layout: 'stacked',
  title: 'Wird ReadyToRun-Code benutzt oder gejittet?',
  code: {
    cs: `// dotnet publish -c Release -r linux-x64 -p:PublishReadyToRun=true
var customers = new List<Customer> { new("Ada") };
var prices = new List<Price> { new(9.99m) };
Console.WriteLine(Billing.Sum(prices));

record class Customer(string Name);     // Klasse aus App.dll
record struct Price(decimal Amount);    // Struct aus App.dll

static class Billing
{
    public static decimal Sum(List<Price> items)
    {
        decimal total = 0;
        foreach (var p in items) total += p.Amount;
        return total;
    }
}

// Zweiter Start: DOTNET_ReadyToRun=0 ./App`,
  },
  steps: [
    {
      codeLine: 4,
      state: run(['call'], { call: SUM }, [
        fact('f-m', 'Methode', SUM),
        fact('f-src', 'Assembly', 'App.dll (R2R, linux-x64)'),
      ]),
      changed: ['call', 'f-m', 'f-src'],
      explanation:
        '`Billing.Sum` wird zum ersten Mal aufgerufen. Ihr Einstiegspunkt zeigt noch auf einen Vorbereitungs-Stub der Runtime. Ohne ReadyToRun würde die Runtime jetzt den JIT rufen, mit ReadyToRun schaut sie zuerst in die Datei.',
    },
    {
      codeLine: 1,
      state: run(['call', 'img'], { call: SUM, img: 'ja: Format, Plattform, Schalter' }, [
        fact('f-m', 'Methode', SUM),
        fact('f-img', 'Image', 'angenommen'),
      ]),
      changed: ['img', 'f-img'],
      explanation:
        'Ob das Image als Ganzes taugt, hat die Runtime schon beim Laden von `App.dll` entschieden: Der ReadyToRun-Header muss ein Format haben, das sie versteht, und zur Plattform passen. Mit `DOTNET_ReadyToRun=0` oder bestimmten Profiler-Einstellungen ignoriert sie den vorkompilierten Code vollständig.',
    },
    {
      codeLine: 11,
      state: run(
        ['call', 'img', 'entry'],
        { call: SUM, img: 'ja', entry: 'ja: MethodDef-Eintrag' },
        [fact('f-m', 'Methode', SUM), fact('f-img', 'Image', 'angenommen')],
      ),
      changed: ['entry'],
      explanation:
        'Für nicht generische Methoden führt das Image eine Tabelle, die vom MethodDef-Token zum Maschinencode führt. `Sum` hat dort einen Eintrag, crossgen2 hat sie also beim Veröffentlichen übersetzt.',
    },
    {
      codeLine: 13,
      state: run(
        ['call', 'img', 'entry', 'fix'],
        { call: SUM, img: 'ja', entry: 'ja', fix: 'Typ List<Price>, Layout Price' },
        [fact('f-m', 'Methode', SUM), fact('f-fix', 'Fixups', 'vor dem ersten Lauf auflösen')],
      ),
      changed: ['fix', 'f-fix'],
      explanation:
        'Zum Eintrag gehört eine Liste von Zellen, die gefüllt sein müssen, bevor die Methode laufen darf, etwa der Typ-Handle von `List<Price>`. Erst jetzt lädt die Runtime diese Typen, so wie sie es beim JIT während des Übersetzens täte.',
    },
    {
      codeLine: 14,
      state: {
        ...run(
          ['call', 'img', 'entry', 'fix', 'check', 'r2r'],
          { call: SUM, img: 'ja', entry: 'ja', fix: 'gefüllt', check: 'ja' },
          [
            fact('f-m', 'Methode', SUM),
            fact('f-res', 'Ergebnis', 'R2R-Code'),
            fact('f-jit', 'JIT-Übersetzungen', '0'),
          ],
        ),
        output: '9,99',
      },
      changed: ['check', 'r2r', 'f-res', 'f-jit'],
      explanation:
        'Manche Zellen sind Prüfungen: Stimmt das Layout eines Typs noch mit dem überein, das crossgen2 angenommen hat? Alles passt, der Einstiegspunkt wird auf den vorkompilierten Code gesetzt. Für `Sum` musste der JIT nichts tun.',
    },
    {
      codeLine: 2,
      state: run(
        ['call', 'img', 'entry', 'fix', 'check', 'r2r'],
        {
          call: 'List<Customer>.Add',
          img: 'ja (CoreLib)',
          entry: 'ja: List<__Canon>.Add',
          fix: 'gefüllt',
          check: 'ja',
        },
        [
          fact('f-m', 'Methode', 'List<Customer>.Add'),
          fact('f-res', 'Ergebnis', 'R2R-Code aus CoreLib'),
          fact('f-jit', 'JIT-Übersetzungen', '0'),
        ],
      ),
      changed: ['call', 'entry', 'f-m', 'f-res'],
      explanation:
        'Für Referenztypen als Typargument teilen sich alle Instanziierungen denselben Code, intern `List<__Canon>`. Den hat CoreLib schon in ihrem eigenen Image. `List<Customer>.Add` läuft deshalb vorkompiliert, obwohl `Customer` aus deiner App stammt.',
    },
    {
      codeLine: 3,
      state: run(
        ['call', 'img', 'entry', 'jit'],
        {
          call: 'List<Price>.Add',
          img: 'ja',
          entry: 'nein: Struct aus App, Code aus CoreLib',
          jit: 'Tier 0',
        },
        [
          fact('f-m', 'Methode', 'List<Price>.Add'),
          fact('f-res', 'Ergebnis', 'gejittet'),
          fact('f-jit', 'JIT-Übersetzungen', '1'),
        ],
      ),
      changed: ['call', 'entry', 'jit', 'f-m', 'f-res', 'f-jit'],
      explanation:
        'Häufige Fehlannahme: „Mit ReadyToRun entfällt der JIT.“ `List<Price>` braucht eigenen Code für das Struct `Price`, der Rumpf von `Add` gehört aber CoreLib und damit nicht zur Version Bubble deiner App. Niemand hat ihn vorkompiliert, also übersetzt der JIT ihn wie gewohnt.',
    },
    {
      codeLine: 4,
      state: run(
        ['call', 'img', 'entry', 'fix', 'check', 'jit'],
        {
          call: SUM,
          img: 'ja',
          entry: 'ja',
          fix: 'gefüllt',
          check: 'nein: Befehlssatz fehlt',
          jit: 'Tier 0',
        },
        [
          fact('f-m', 'Methode', SUM),
          fact('f-res', 'Ergebnis', 'Code verworfen, gejittet'),
          fact('f-why', 'Grund', 'Annahme passt nicht zur Maschine'),
        ],
      ),
      changed: ['check', 'jit', 'f-res', 'f-why'],
      explanation:
        'Gedankenexperiment: Hätte crossgen2 für `Sum` einen Befehlssatz vorausgesetzt, den diese CPU nicht hat, schlägt die Prüfung fehl. Die Runtime verwirft dann nur den Code dieser einen Methode und lässt den JIT aus dem IL übersetzen. Deshalb bleibt das IL im Image.',
    },
    {
      codeLine: 19,
      state: run(
        ['call', 'img', 'jit'],
        { call: SUM, img: 'nein: ReadyToRun=0', jit: 'alles gejittet' },
        [
          fact('f-m', 'Methode', SUM),
          fact('f-res', 'Ergebnis', 'gejittet'),
          fact('f-all', 'Betroffen', 'auch das Framework'),
        ],
      ),
      changed: ['img', 'jit', 'f-res', 'f-all'],
      explanation:
        'Mit `DOTNET_ReadyToRun=0` nimmt die Runtime kein Image an, auch nicht die des Frameworks. Jede Methode geht durch den JIT, der Start wird deutlich langsamer. Für Messungen ist das nützlich: Die Differenz zeigt, was ReadyToRun dir spart.',
    },
  ],
});
