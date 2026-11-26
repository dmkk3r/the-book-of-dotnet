import { defineStepScript, type TableState } from '@/components/viz';

// Hot path with the throw inline versus the ThrowHelper pattern.
// Sources: Performance Improvements in .NET posts (ThrowHelper pattern used throughout the BCL),
// BOTR / JIT docs: blocks that end in a throw are treated as rarely run and moved out of the hot
// layout; the inliner does not inline methods that never return. [DoesNotReturn] is a nullable
// flow analysis attribute for the C# compiler (System.Diagnostics.CodeAnalysis).
// TODO(verify): The whole asm tab is illustrative (Windows x64, simplified, hand-written), not
// taken from DOTNET_JitDisasm. In particular: whether Get really saves rbx/rsi in its prolog
// because index must survive the calls in the throw block, the exact helper names
// (CORINFO_HELP_NEWSFAST, CORINFO_HELP_THROW, CORINFO_HELP_RNGCHKFAIL), and the field offsets.
// TODO(verify): That the JIT detects ThrowIndex as a no-return call by itself (from its IL, not
// from [DoesNotReturn]), marks the calling block as rarely run and moves it to the end.
// TODO(verify): IL sizes of Get and GetFast (expected: Get noticeably larger, because of newobj,
// ldstr, box and the ctor call).

type Table = TableState['tables'][number];
type Row = Table['rows'][number];
type Status = NonNullable<Row['status']>;
type Fact = NonNullable<TableState['facts']>[number];
const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });

interface Look {
  status?: Partial<Record<string, Status>>;
  follow?: string[];
  cold?: boolean;
}

const COLS = ['Teil', 'Inhalt', 'Pfad'];

function tables({ status = {}, follow = [], cold = false }: Look): Table[] {
  const row = (id: string, cells: string[], refs?: { col: number; to: string }[]): Row => ({
    id,
    cells,
    ...(status[id] ? { status: status[id] } : {}),
    ...(refs && follow.includes(id) ? { refs } : {}),
  });
  const result: Table[] = [
    {
      id: 't-inline',
      title: 'Get: Wurf im Rumpf',
      columns: COLS,
      row: 1,
      col: 1,
      rows: [
        row('i-check', ['Prüfung', 'cmp, jae', 'heiß']),
        row('i-load', ['Zugriff', 'Element laden, ret', 'heiß']),
        row('i-alloc', ['Wurfblock', 'Objekt und Box allozieren', 'kalt']),
        row('i-ctor', ['Wurfblock', 'Texte laden, Konstruktor', 'kalt']),
        row('i-throw', ['Wurfblock', 'Wurf-Helfer aufrufen', 'kalt']),
      ],
    },
    {
      id: 't-helper',
      title: 'GetFast: ThrowHelper',
      columns: COLS,
      row: 2,
      col: 1,
      rows: [
        row('h-check', ['Prüfung', 'cmp, jae', 'heiß']),
        row('h-load', ['Zugriff', 'Element laden, ret', 'heiß']),
        row('h-call', ['Wurfblock', 'call ThrowIndex', 'kalt'], [{ col: 1, to: 'c-body' }]),
      ],
    },
  ];
  if (cold) {
    result.push({
      id: 't-cold',
      title: 'ThrowHelper.ThrowIndex',
      columns: COLS,
      row: 3,
      col: 1,
      rows: [
        row('c-body', ['Rumpf', 'Objekt, Box, Konstruktor, Wurf', 'nur im Fehlerfall']),
        row('c-inl', ['Inlining', 'nie, kehrt nicht zurück', 'kalt']),
      ],
    });
  }
  return result;
}

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Heißer Pfad mit und ohne ThrowHelper',
  code: {
    cs: `class Buffer
{
    int[] _items = new int[16];
    int _count;

    public int Get(int index)
    {
        if ((uint)index >= (uint)_count)
            throw new ArgumentOutOfRangeException(nameof(index), index, "außerhalb");
        return _items[index];
    }

    public int GetFast(int index)
    {
        if ((uint)index >= (uint)_count)
            ThrowHelper.ThrowIndex(index);
        return _items[index];
    }
}

static class ThrowHelper
{
    [DoesNotReturn, StackTraceHidden]
    public static void ThrowIndex(int index) =>
        throw new ArgumentOutOfRangeException(nameof(index), index, "außerhalb");
}`,
    asm: `; Illustration, vereinfacht, x64 Windows
; Buffer:Get(int):int
       push     rbx
       sub      rsp, 32
       mov      ebx, edx
       cmp      ebx, dword ptr [rcx+10h]   ; _count
       jae      SHORT THROW
       mov      rax, gword ptr [rcx+08h]   ; _items
       cmp      ebx, dword ptr [rax+08h]   ; Länge des Arrays
       jae      SHORT RNGCHK
       mov      eax, dword ptr [rax+4*rbx+10h]
       add      rsp, 32
       pop      rbx
       ret
THROW: call     CORINFO_HELP_NEWSFAST      ; Exception
       ; ... Box für index, Texte laden,
       ; ... Konstruktor aufrufen
       call     CORINFO_HELP_THROW
RNGCHK: call    CORINFO_HELP_RNGCHKFAIL

; Buffer:GetFast(int):int
       sub      rsp, 40
       cmp      edx, dword ptr [rcx+10h]   ; _count
       jae      SHORT THROW2
       mov      rax, gword ptr [rcx+08h]   ; _items
       cmp      edx, dword ptr [rax+08h]
       jae      SHORT RNGCHK2
       mov      eax, dword ptr [rax+4*rdx+10h]
       add      rsp, 40
       ret
THROW2: mov     ecx, edx
       call     ThrowHelper:ThrowIndex(int)
       int3
RNGCHK2: call   CORINFO_HELP_RNGCHKFAIL`,
  },
  steps: [
    {
      codeLine: 8,
      highlight: { asm: [6, 7, 23, 24] },
      state: {
        tables: tables({ status: { 'i-check': 'active', 'h-check': 'active' } }),
        facts: [fact('f-same', 'Prüfung', 'in beiden Varianten gleich')],
      },
      changed: ['i-check', 'h-check'],
      explanation:
        'Beide Methoden prüfen den Index mit demselben Vergleich. Der Trick `(uint)index >= (uint)_count` fängt negative Werte gleich mit ab. Auf dem heißen Pfad unterscheidet sich hier nichts.',
    },
    {
      codeLine: 9,
      highlight: { asm: [15, 16, 17, 18] },
      state: {
        tables: tables({
          status: { 'i-alloc': 'active', 'i-ctor': 'active', 'i-throw': 'active' },
        }),
        facts: [
          fact('f-same', 'Prüfung', 'in beiden Varianten gleich'),
          fact('f-il', 'IL von Get', 'newobj, ldstr, box, Konstruktor, throw'),
        ],
      },
      changed: ['i-alloc', 'i-ctor', 'i-throw', 'f-il'],
      explanation:
        'In `Get` steht der ganze Wurf im Rumpf: Exception allozieren, `index` boxen (der Parameter `actualValue` ist ein `object`), Texte laden, Konstruktor aufrufen, werfen. Der JIT legt diesen Block als selten ausgeführt ans Ende, aber er gehört zur Methode und macht sie größer.',
    },
    {
      codeLine: 6,
      highlight: { asm: [3, 4, 5, 12, 13] },
      state: {
        tables: tables({
          status: {
            'i-check': 'active',
            'i-load': 'active',
            'i-alloc': 'dim',
            'i-ctor': 'dim',
            'i-throw': 'dim',
          },
        }),
        facts: [
          fact('f-il', 'IL von Get', 'ein Vielfaches des heißen Teils'),
          fact('f-reg', 'Prolog', 'kann Register für den Wurfblock sichern'),
        ],
      },
      changed: ['i-check', 'i-load', 'f-reg'],
      explanation:
        'Der kalte Block kann auch den heißen Pfad beeinflussen. Im Beispiel muss `index` die Aufrufe im Wurfblock überleben, also legt der JIT ihn in ein gesichertes Register, und Prolog und Epilog sichern es bei **jedem** Aufruf. Vor allem aber ist `Get` als Ganzes größer, was das Einbetten in Aufrufer erschwert.',
    },
    {
      codeLine: 16,
      highlight: { asm: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34] },
      state: {
        tables: tables({
          status: { 'h-check': 'match', 'h-load': 'match', 'h-call': 'active' },
          follow: ['h-call'],
          cold: true,
        }),
        facts: [
          fact('f-il', 'IL von GetFast', 'Prüfung, call, Zugriff'),
          fact('f-reg', 'Prolog', 'nur Platz für den Aufruf'),
        ],
      },
      changed: ['h-call', 't-cold'],
      explanation:
        '`GetFast` enthält statt des Wurfs nur einen Aufruf von `ThrowIndex`. Die ganze Wurf-Arbeit liegt in einer eigenen Methode, die nur im Fehlerfall überhaupt angefasst wird. `GetFast` bleibt klein genug, um in jeden Aufrufer eingebettet zu werden.',
    },
    {
      codeLine: 24,
      highlight: { asm: [31, 32, 33] },
      state: {
        tables: tables({
          status: { 'c-body': 'match', 'c-inl': 'active' },
          follow: ['h-call'],
          cold: true,
        }),
        facts: [
          fact('f-ret', 'ThrowIndex', 'kehrt nie zurück'),
          fact('f-attr', '[DoesNotReturn]', 'für den C#-Compiler, nicht für den JIT'),
        ],
      },
      changed: ['c-inl', 'f-ret', 'f-attr'],
      explanation:
        'Der JIT erkennt am IL, dass `ThrowIndex` nur wirft, und bettet sie nicht ein: Das würde den Wurf-Code zurück in den heißen Pfad holen. `[DoesNotReturn]` hilft dagegen der Null-Analyse des C#-Compilers, `[StackTraceHidden]` hält den Helfer aus dem Stack-Trace heraus.',
    },
  ],
});
