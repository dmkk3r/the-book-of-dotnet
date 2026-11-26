import { defineStepScript, type TableState } from '@/components/viz';

// The EH clause table of one method body and the IL ranges its clauses point to.
// Sources: ECMA-335 Partition I, 12.4.2 (protected blocks, the four handler kinds catch, filter,
// finally, fault; one handler per clause; search order); Partition II, 19 (exception handling
// clauses, filter block directly before its handler) and II.25.4.6 (clause format in the extra
// data section of the method body: flags, try offset and length, handler offset and length,
// class token or filter offset).
// TODO(verify): The IL listing and all offsets are hand-assembled from instruction sizes, not
// taken from SharpLab. Roslyn's exact filter prologue for `catch (Exception) when (Log())`
// (isinst, dup, brtrue.s, pop, ldc.i4.0, br.s ... pop, call, ldc.i4.0, cgt.un, endfilter),
// whether the inner leave instructions target the end of the method directly, and the order of
// clauses Roslyn emits (inner clauses before the enclosing finally) must be checked.
// TODO(verify): ECMA-335 rule that nested clauses must appear before their enclosing clauses.

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[];
}

function tables({ status = {}, follow = [] }: Look): Table[] {
  const row = (id: string, cells: string[], refs?: { col: number; to: string }[]): Row => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(refs && follow.includes(id) ? { refs } : {}),
  });
  return [
    {
      id: 't-clauses',
      title: 'EH-Klauseln von Run',
      columns: ['Nr.', 'Art', 'Typ oder Filter'],
      row: 1,
      col: 1,
      rows: [
        row(
          'k1',
          ['1', 'catch', 'IOException'],
          [
            { col: 0, to: 'il-try' },
            { col: 1, to: 'il-io' },
          ],
        ),
        row(
          'k2',
          ['2', 'filter', 'ab 0014'],
          [
            { col: 0, to: 'il-try' },
            { col: 2, to: 'il-filter' },
            { col: 1, to: 'il-handler' },
          ],
        ),
        row(
          'k3',
          ['3', 'finally', 'keiner'],
          [
            { col: 0, to: 'il-outer' },
            { col: 1, to: 'il-finally' },
          ],
        ),
      ],
    },
    {
      id: 't-il',
      title: 'IL-Bereiche',
      columns: ['Bereich', 'Offsets'],
      row: 1,
      col: 2,
      rows: [
        row('il-try', ['innerer try', '0000 bis 0007']),
        row('il-io', ['catch IOException', '0007 bis 0014']),
        row('il-filter', ['Filterblock', '0014 bis 002B']),
        row('il-handler', ['Handler zum Filter', '002B bis 0038']),
        row('il-outer', ['äußerer try', '0000 bis 0038']),
        row('il-finally', ['finally', '0038 bis 0043']),
      ],
    },
  ];
}

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Die Klauseltabelle einer Methode',
  code: {
    cs: `static void Run()
{
    try
    {
        Work();
    }
    catch (IOException)
    {
        Console.WriteLine("IO");
    }
    catch (Exception) when (Log())
    {
        Console.WriteLine("gefangen");
    }
    finally
    {
        Console.WriteLine("aufgeräumt");
    }
}`,
    il: `.try
{
  .try
  {
    IL_0000: call void Work()
    IL_0005: leave.s IL_0043
  }
  catch [System.Runtime]System.IO.IOException
  {
    IL_0007: pop
    IL_0008: ldstr "IO"
    IL_000d: call void Console::WriteLine(string)
    IL_0012: leave.s IL_0043
  }
  filter
  {
    IL_0014: isinst [System.Runtime]System.Exception
    IL_0019: dup
    IL_001a: brtrue.s IL_0020
    IL_001c: pop
    IL_001d: ldc.i4.0
    IL_001e: br.s IL_0029
    IL_0020: pop
    IL_0021: call bool Log()
    IL_0026: ldc.i4.0
    IL_0027: cgt.un
    IL_0029: endfilter
  }
  {
    IL_002b: pop
    IL_002c: ldstr "gefangen"
    IL_0031: call void Console::WriteLine(string)
    IL_0036: leave.s IL_0043
  }
}
finally
{
  IL_0038: ldstr "aufgeräumt"
  IL_003d: call void Console::WriteLine(string)
  IL_0042: endfinally
}
IL_0043: ret`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        tables: tables({}),
        facts: [
          fact('f-where', 'Ablage', 'Zusatzabschnitt hinter dem IL'),
          fact('f-ex', 'Wirft', 'Work() eine InvalidOperationException'),
        ],
      },
      changed: ['t-clauses'],
      explanation:
        'Im IL gibt es keine Instruktion „try betreten“. Ein Methodenrumpf besteht aus dem IL und, falls nötig, einer **Klauseltabelle** dahinter. Jede Zeile beschreibt einen geschützten Bereich, einen Handler und dessen Art.',
    },
    {
      codeLine: 7,
      highlight: { il: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
      state: {
        tables: tables({
          status: { k1: 'active', 'il-try': 'match', 'il-io': 'match' },
          follow: ['k1'],
        }),
        facts: [fact('f-k', 'Klausel 1', 'catch mit Typ-Token')],
      },
      changed: ['k1', 'il-try', 'il-io'],
      explanation:
        'Klausel 1 ist ein typisiertes `catch`: try-Bereich 0000 bis 0007, Handler 0007 bis 0014, dazu ein Token für `IOException`. Das Ende eines Bereichs ist exklusiv, und der Handler bekommt die Exception als einzigen Wert auf dem Auswertungsstack, hier sofort per `pop` verworfen.',
    },
    {
      codeLine: 11,
      highlight: {
        il: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34],
      },
      state: {
        tables: tables({
          status: { k2: 'active', 'il-try': 'match', 'il-filter': 'match', 'il-handler': 'match' },
          follow: ['k2'],
        }),
        facts: [
          fact('f-k', 'Klausel 2', 'filter statt Typ'),
          fact('f-end', 'Filter endet mit', 'endfilter: 0 oder 1'),
        ],
      },
      changed: ['k2', 'il-filter', 'il-handler'],
      explanation:
        'Aus `catch (Exception) when (Log())` wird eine **filter**-Klausel. Sie hat keinen Typ, sondern einen Filterblock direkt vor dem Handler. Der Compiler baut die Typprüfung selbst mit `isinst` in den Filter ein, `endfilter` meldet 1 für „fangen“ oder 0 für „weitersuchen“.',
    },
    {
      codeLine: 15,
      highlight: { il: [1, 36, 37, 38, 39, 40, 41] },
      state: {
        tables: tables({
          status: { k3: 'active', 'il-outer': 'match', 'il-finally': 'match' },
          follow: ['k3'],
        }),
        facts: [fact('f-k', 'Klausel 3', 'finally, kein Typ')],
      },
      changed: ['k3', 'il-outer', 'il-finally'],
      explanation:
        'Für ein `try` mit `catch` **und** `finally` erzeugt C# zwei verschachtelte Blöcke: einen inneren mit den `catch`-Klauseln und einen äußeren mit dem `finally`. Deshalb umfasst der try-Bereich von Klausel 3 auch beide inneren Handler.',
    },
    {
      codeLine: 5,
      highlight: { il: [5] },
      state: {
        tables: tables({ status: { k1: 'miss', k2: 'match', k3: 'dim', 'il-try': 'active' } }),
        facts: [
          fact('f-ip', 'Wurfpunkt', 'IL_0000, im inneren try'),
          fact('f-p1', 'Durchlauf 1', 'Klausel 1 nein, Klausel 2 ja'),
        ],
      },
      changed: ['k1', 'k2', 'k3'],
      explanation:
        '`Work` wirft eine `InvalidOperationException`. Durchlauf 1 liest die Klauseln der Reihe nach, innere vor äußeren: Klausel 1 passt vom Typ nicht, der Filter von Klausel 2 läuft und liefert `true`. Klausel 3 ist ein `finally` und spielt für die Suche keine Rolle.',
    },
    {
      codeLine: 17,
      highlight: { il: [30, 31, 32, 33, 38, 39, 40] },
      state: {
        tables: tables({
          status: { k2: 'match', k3: 'active', 'il-handler': 'active', 'il-finally': 'active' },
        }),
        facts: [
          fact('f-p2', 'Durchlauf 2', 'kein finally zwischen Wurf und Handler'),
          fact('f-out', 'Ausgabe', 'gefangen, dann aufgeräumt'),
        ],
        output: 'gefangen\naufgeräumt',
      },
      changed: ['k3', 'il-handler', 'il-finally'],
      explanation:
        'Durchlauf 2 führt nur `finally`-Blöcke aus, deren try-Bereich **innerhalb** des fangenden liegt. Klausel 3 umschließt den Handler, also läuft zuerst der Handler. Erst sein `leave.s` aus dem äußeren try heraus löst das `finally` aus, ganz ohne Exception.',
    },
  ],
});
