import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps. Each stackalloc block is 1024 bytes and
// lies below the previous one, because the stack grows towards lower addresses.
// localloc memory is released only when the method returns (ECMA-335, Partition III, localloc).
// TODO(verify): Exact console text when the runtime terminates on stack overflow
// ("Stack overflow." plus a repeated frame list since .NET 5?) on Windows and Linux.
// TODO(verify): 1 MB default stack of the main thread on Windows x64 (Linux main thread uses
// ulimit -s, often 8 MB), so the iteration count at which the overflow happens is approximate.

type Frame = MemoryState['frames'][number];
type Slot = Frame['slots'][number];

const block = (n: number, address: string, value: string): Slot => ({
  id: `b${n}`,
  name: `stackalloc-Block ${n}`,
  type: `byte[1024] im Frame, ab ${address}`,
  value,
});

const B1 = '0x7FFEE4A0';
const B2 = '0x7FFEE0A0';
const B3 = '0x7FFEDCA0';

const frame = (
  line: string,
  total: string,
  tmp: string,
  blocks: Slot[],
  id = 'sum',
  method = 'SumLines(string[] lines)',
): Frame => ({
  id,
  method,
  slots: [
    { id: `${id}-lines`, name: 'lines', type: 'string[] (Verweis)', value: '0x7F3A2000' },
    { id: `${id}-total`, name: 'total', type: 'int', value: total },
    { id: `${id}-line`, name: 'line', type: 'string (Verweis)', value: line },
    { id: `${id}-tmp`, name: 'tmp', type: 'Span<byte>', value: tmp },
    ...blocks,
  ],
});

const main: Frame = { id: 'main', method: 'Main()', slots: [] };

export default defineStepScript({
  view: 'memory',
  title: 'stackalloc in einer Schleife',
  code: {
    cs: `static int SumLines(string[] lines)
{
    int total = 0;
    foreach (string line in lines)
    {
        Span<byte> tmp = stackalloc byte[1024];
        total += Encoding.UTF8.GetBytes(line, tmp);
    }   // tmp ist weg, der Block nicht
    return total;
}   // erst hier wird alles freigegeben

static int SumLinesFixed(string[] lines)
{
    int total = 0;
    Span<byte> tmp = stackalloc byte[1024];
    foreach (string line in lines)
        total += Encoding.UTF8.GetBytes(line, tmp);
    return total;
}`,
  },
  steps: [
    {
      codeLine: 3,
      state: { frames: [main, frame('null', '0', 'leer (default)', [])], heap: [] },
      changed: ['sum'],
      explanation:
        '`SumLines` soll für viele Zeilen die UTF-8-Länge aufsummieren. Der Frame enthält zunächst nur die festen Locals. Gleich beginnt die Schleife über 10.000 Zeilen.',
    },
    {
      codeLine: 6,
      state: {
        frames: [
          main,
          frame('"alpha"', '0', `→ ${B1}, Länge 1024`, [block(1, B1, 'in Benutzung')]),
        ],
        heap: [],
      },
      changed: ['b1', 'sum-tmp', 'sum-line'],
      explanation:
        'Erste Iteration: `stackalloc` schiebt den Stackzeiger um 1024 Byte weiter, `tmp` zeigt auf den neuen Block. So weit genau das, was man erwartet.',
    },
    {
      codeLine: 8,
      state: {
        frames: [
          main,
          frame('"alpha"', '5', `→ ${B1}, Länge 1024`, [block(1, B1, 'in Benutzung')]),
        ],
        heap: [],
      },
      changed: ['sum-total'],
      explanation:
        'Häufige Fehlannahme: Am Ende des Schleifenrumpfs werde der Block freigegeben, weil `tmp` dort seinen Gültigkeitsbereich verlässt. Das gilt nur für den Namen `tmp`. Speicher aus `localloc` lebt bis zum Rücksprung der **Methode**, einen Befehl zum vorzeitigen Freigeben gibt es nicht.',
    },
    {
      codeLine: 6,
      state: {
        frames: [
          main,
          frame('"beta"', '5', `→ ${B2}, Länge 1024`, [
            block(1, B1, 'belegt, aber unerreichbar'),
            block(2, B2, 'in Benutzung'),
          ]),
        ],
        heap: [],
      },
      changed: ['b2', 'b1', 'sum-tmp', 'sum-line'],
      explanation:
        'Zweite Iteration: Der Stackzeiger rückt **noch einmal** um 1024 Byte weiter. Block 1 ist von keinem Namen mehr erreichbar, belegt aber weiter seinen Platz im Frame.',
    },
    {
      codeLine: 6,
      state: {
        frames: [
          main,
          frame('"gamma"', '9', `→ ${B3}, Länge 1024`, [
            block(1, B1, 'belegt, aber unerreichbar'),
            block(2, B2, 'belegt, aber unerreichbar'),
            block(3, B3, 'in Benutzung'),
          ]),
        ],
        heap: [],
      },
      changed: ['b3', 'b2', 'sum-tmp', 'sum-line', 'sum-total'],
      explanation:
        'Mit jeder Iteration wächst der Frame um weitere 1024 Byte. Nach drei Zeilen sind es 3 KB, nach 10.000 Zeilen wären es rund 10 MB. Das ist mehr, als ein typischer Thread-Stack überhaupt hat.',
    },
    {
      codeLine: 6,
      state: {
        frames: [
          main,
          frame('etwa Zeile 1.000', 'offen', 'nicht mehr erreicht', [
            block(1, B1, 'belegt, aber unerreichbar'),
            block(2, B2, 'belegt, aber unerreichbar'),
            block(3, B3, 'belegt, aber unerreichbar'),
            {
              id: 'bmore',
              name: 'Blöcke 4 bis rund 1.000',
              type: 'je 1024 Byte',
              value: 'Stack-Ende erreicht',
            },
          ]),
        ],
        heap: [],
        output: 'Stack overflow.\nProzess beendet, kein catch und kein finally läuft.',
      },
      changed: ['bmore', 'sum-tmp'],
      explanation:
        'Bei etwa 1 MB Stack ist nach rund tausend Iterationen Schluss: Der nächste Block trifft die Guard-Page am Ende des Stacks. Ein Stack Overflow lässt sich in .NET nicht abfangen, die Runtime beendet den Prozess sofort.',
    },
    {
      codeLine: 15,
      state: {
        frames: [
          main,
          frame(
            '"alpha"',
            '0',
            `→ ${B1}, Länge 1024`,
            [block(1, B1, 'in Benutzung')],
            'fix',
            'SumLinesFixed(string[] lines)',
          ),
        ],
        heap: [],
      },
      changed: ['fix', 'b1', 'fix-tmp'],
      explanation:
        'Die Korrektur: den Block **vor** der Schleife anfordern. `stackalloc` läuft genau einmal, der Frame wächst einmal um 1024 Byte.',
    },
    {
      codeLine: 17,
      state: {
        frames: [
          main,
          frame(
            'Zeile 10.000',
            '58.211',
            `→ ${B1}, Länge 1024`,
            [block(1, B1, 'in Benutzung, 10.000-mal überschrieben')],
            'fix',
            'SumLinesFixed(string[] lines)',
          ),
        ],
        heap: [],
      },
      changed: ['b1', 'fix-line', 'fix-total'],
      explanation:
        'Jede Iteration überschreibt denselben Block. Nach 10.000 Zeilen ist der Frame so groß wie nach der ersten. Die Analyseregel CA2014 warnt genau vor dem ersten Muster.',
    },
  ],
});
