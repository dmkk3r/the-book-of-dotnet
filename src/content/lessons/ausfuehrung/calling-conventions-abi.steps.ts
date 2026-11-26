import { defineStepScript, type TableState } from '@/components/viz';

// One managed call, mapped to argument locations on three platforms.
// Sources: BOTR clr-abi.md (this first; order this, return buffer, generic context, user
// arguments; return buffer address returned in RAX on AMD64; ARM64 return buffer in x8; Windows
// x64 passes structs that are not 1, 2, 4 or 8 bytes by implicit reference; ARM64 passes structs
// larger than 16 bytes by implicit reference except HFAs), Microsoft Learn "x64 calling
// convention" (positional slots: the fourth slot is xmm3 for a double, the fifth is on the stack),
// System V AMD64 psABI (separate integer and SSE register sequences, aggregates larger than 16
// bytes are class MEMORY: passed on the stack by value, returned via a hidden pointer in rdi).
// TODO(verify): For System V, that CoreCLR puts the return buffer right after `this` (rsi) and
// not in rdi before `this` as native C++ does; that Point3 (three doubles) is treated as an HFA by
// CoreCLR on ARM64 (passed in d0..d2, returned in d0..d2 without a return buffer).
// TODO(verify): Stack offsets ([rsp+0x20] on Windows) are those seen by the caller at the call.

type Table = TableState['tables'][number];
type Status = NonNullable<Table['rows'][number]['status']>;
type Fact = NonNullable<TableState['facts']>[number];

const ARGS = ['this', 'buf', 'p', 'f', 'n', 'res'] as const;
type Arg = (typeof ARGS)[number];

/** cur: argument of this step (null: overview); done: arguments shown before. */
function tables(cur: Arg | null, arrows: boolean): Table[] {
  const idx = cur === null ? ARGS.length : ARGS.indexOf(cur);
  const status = (a: Arg, here: Status): Status | undefined => {
    const i = ARGS.indexOf(a);
    if (a === cur) return here;
    return i > idx ? 'dim' : undefined;
  };
  const row = (prefix: string, a: Arg, cells: string[]) => {
    const s = status(a, 'match');
    return { id: `${prefix}-${a}`, cells, ...(s ? { status: s } : {}) };
  };
  const callRow = (a: Arg, cells: string[]) => {
    const s = status(a, 'active');
    return {
      id: `c-${a}`,
      cells,
      ...(s ? { status: s } : {}),
      ...(a === cur && arrows
        ? {
            refs: [
              { col: 1, to: `w-${a}` },
              { col: 1, to: `s-${a}` },
              { col: 1, to: `a-${a}` },
            ],
          }
        : {}),
    };
  };
  return [
    {
      id: 't-call',
      title: 'Aufruf',
      columns: ['Argument', 'Typ'],
      row: 1,
      col: 1,
      rows: [
        callRow('this', ['this', 'Mover (Verweis)']),
        callRow('buf', ['Rückgabepuffer', 'versteckt']),
        callRow('p', ['p', 'Point3, 24 B']),
        callRow('f', ['f', 'double']),
        callRow('n', ['n', 'int']),
        callRow('res', ['Ergebnis', 'Point3']),
      ],
    },
    {
      id: 't-win',
      title: 'Windows x64',
      columns: ['Argument', 'Ort'],
      row: 1,
      col: 2,
      rows: [
        row('w', 'this', ['this', 'rcx']),
        row('w', 'buf', ['Puffer', 'rdx']),
        row('w', 'p', ['p', 'r8 → Kopie']),
        row('w', 'f', ['f', 'xmm3']),
        row('w', 'n', ['n', '[rsp+0x20]']),
        row('w', 'res', ['Ergebnis', 'Puffer, rax']),
      ],
    },
    {
      id: 't-sysv',
      title: 'Linux, macOS x64',
      columns: ['Argument', 'Ort'],
      row: 2,
      col: 1,
      rows: [
        row('s', 'this', ['this', 'rdi']),
        row('s', 'buf', ['Puffer', 'rsi']),
        row('s', 'p', ['p', 'Stack, 24 B']),
        row('s', 'f', ['f', 'xmm0']),
        row('s', 'n', ['n', 'rdx']),
        row('s', 'res', ['Ergebnis', 'Puffer, rax']),
      ],
    },
    {
      id: 't-arm',
      title: 'ARM64',
      columns: ['Argument', 'Ort'],
      row: 2,
      col: 2,
      rows: [
        row('a', 'this', ['this', 'x0']),
        row('a', 'buf', ['Puffer', 'keiner']),
        row('a', 'p', ['p', 'd0, d1, d2']),
        row('a', 'f', ['f', 'd3']),
        row('a', 'n', ['n', 'x1']),
        row('a', 'res', ['Ergebnis', 'd0, d1, d2']),
      ],
    },
  ];
}

const fact = (id: string, label: string, value: string): Fact => ({ id, label, value });
const state = (cur: Arg | null, facts: Fact[], arrows = true): TableState => ({
  tables: tables(cur, arrows),
  facts,
});

export default defineStepScript({
  view: 'table',
  layout: 'stacked',
  title: 'Ein Aufruf, drei Aufrufkonventionen',
  code: {
    cs: `struct Point3 { public double X, Y, Z; }   // 24 Byte

class Mover
{
    public Point3 Move(Point3 p, double f, int n) => p;
}

Point3 q = mover.Move(origin, 1.5, 7);`,
  },
  steps: [
    {
      codeLine: 8,
      state: state(null, [fact('f-sig', 'Aufruf', 'Instanzmethode, Struct rein und raus')], false),
      explanation:
        'Ein einziger Aufruf mit drei sichtbaren Argumenten. Die Tabellen zeigen, wo jedes Argument auf den drei wichtigsten 64-Bit-Plattformen ankommt. Es sind mehr Zeilen als Argumente, denn der Compiler sieht nur drei, die Runtime übergibt fünf Dinge.',
    },
    {
      codeLine: 5,
      state: state('this', [fact('f-why', 'Regel', '`this` ist immer das erste Argument')]),
      changed: ['c-this', 'w-this', 's-this', 'a-this'],
      explanation:
        '`this` ist ein ganz normales, verstecktes erstes Argument. Es landet im ersten Ganzzahlregister der Plattform: `rcx`, `rdi` oder `x0`. Eine Instanzmethode ist für die Maschine eine statische Methode mit einem Parameter mehr.',
    },
    {
      codeLine: 8,
      state: state('buf', [fact('f-why', 'Grund', 'Point3 passt nicht in rax')]),
      changed: ['c-buf', 'w-buf', 's-buf', 'a-buf'],
      explanation:
        'Ein 24-Byte-Struct passt auf x64 in kein Rückgaberegister. Der Aufrufer reserviert deshalb Platz in seinem Frame und übergibt dessen Adresse als **versteckten Rückgabepuffer** direkt nach `this`. Auf ARM64 entfällt der Puffer hier, warum, zeigt die Ergebniszeile.',
    },
    {
      codeLine: 8,
      state: state('p', [fact('f-why', 'Grund', '24 B ist nicht 1, 2, 4 oder 8 B')]),
      changed: ['c-p', 'w-p', 's-p', 'a-p'],
      explanation:
        'Hier gehen die Plattformen auseinander. Windows x64 legt eine **Kopie** an und übergibt einen Zeiger darauf in `r8`. System V kopiert die 24 Byte direkt in den Argumentbereich auf dem Stack. ARM64 erkennt drei `double` als **HFA** und verteilt die Felder auf drei Gleitkommaregister.',
    },
    {
      codeLine: 8,
      state: state('f', [fact('f-why', 'Windows', 'Position 4 → xmm3, r9 bleibt frei')]),
      changed: ['c-f', 'w-f', 's-f', 'a-f'],
      explanation:
        'Windows zählt Positionen: `f` ist das vierte Argument und bekommt deshalb das vierte Gleitkommaregister `xmm3`, egal was davor war. System V und ARM64 zählen Ganzzahl- und Gleitkommaregister getrennt, deshalb `xmm0` und `d3`.',
    },
    {
      codeLine: 8,
      state: state('n', [fact('f-why', 'Windows', 'Position 5 → Stack')]),
      changed: ['c-n', 'w-n', 's-n', 'a-n'],
      explanation:
        'Unter Windows sind nach vier Positionen alle Registerplätze verbraucht, `n` geht auf den Stack hinter den Shadow Space. Unter System V ist erst das dritte Ganzzahlregister dran (`rdx`), unter ARM64 das zweite (`x1`).',
    },
    {
      codeLine: 8,
      state: state('res', [fact('f-why', 'ARM64', 'HFA bis 4 Felder kommt in Registern zurück')]),
      changed: ['c-res', 'w-res', 's-res', 'a-res'],
      explanation:
        'Auf x64 schreibt der Aufgerufene das Ergebnis in den Puffer und gibt dessen Adresse zusätzlich in `rax` zurück. Auf ARM64 kommt das HFA in `d0` bis `d2` zurück, ein Puffer ist gar nicht nötig.',
    },
    {
      codeLine: 8,
      state: state(
        null,
        [
          fact('f-win', 'Speicher bei Windows', 'Kopie von p, n, Puffer'),
          fact('f-sysv', 'Speicher bei System V', 'p (24 B), Puffer'),
          fact('f-arm', 'Speicher bei ARM64', 'nichts'),
        ],
        false,
      ),
      changed: ['f-win', 'f-sysv', 'f-arm'],
      explanation:
        'Derselbe C#-Aufruf erzeugt drei verschiedene Bilder. Auf ARM64 berührt kein einziges Argument den Speicher, unter Windows liegen drei Dinge im Frame des Aufrufers. Wer die Kosten eines Aufrufs abschätzen will, muss also wissen, für welche Plattform übersetzt wird.',
    },
  ],
});
