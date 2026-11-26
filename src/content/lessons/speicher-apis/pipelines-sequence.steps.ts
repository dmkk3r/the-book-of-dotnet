import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional. Segments are tiny (8 bytes) for illustration only; real Pipe segments
// are much larger (PipeOptions.MinimumSegmentSize).
// A position is written as (segment, index in that segment), as SequencePosition stores an object
// and an integer. ReadOnlySequenceSegment<T> exposes Memory, Next and RunningIndex.
// TODO(verify): Pipe returns fully consumed segments to its pool during AdvanceTo (Pipe.cs), and
// the default MinimumSegmentSize is 4096.

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const ADDR = { seg1: 0x7f3a4000, seg2: 0x7f3a4100, seg3: 0x7f3a4200 } as const;

type Slot = MemoryState['frames'][number]['slots'][number];
type Obj = MemoryState['heap'][number];
type SegId = keyof typeof ADDR;

const segment = (
  id: SegId,
  memory: string,
  next: SegId | null,
  running: number,
  returned = false,
): Obj => ({
  id,
  type: returned ? 'Segment (zurück im Pool)' : 'Segment (ReadOnlySequenceSegment<byte>)',
  address: hex(ADDR[id]),
  fields: [
    { name: 'Memory', value: returned ? 'nicht mehr gültig' : memory },
    next ? { name: 'Next', value: hex(ADDR[next]), ref: next } : { name: 'Next', value: 'null' },
    { name: 'RunningIndex', value: String(running) },
  ],
});

const SEG1 = segment('seg1', '"PING\\nECH" (8 Byte)', 'seg2', 0);
const SEG2 = segment('seg2', '"O hi\\nTIM" (8 Byte)', 'seg3', 8);
const SEG3 = segment('seg3', '"E 1" (3 Byte belegt)', null, 16);

const slot = (id: string, type: string, value: string, ref?: SegId): Slot => ({
  id,
  name: id,
  type,
  value,
  ...(ref ? { ref } : {}),
});
const SEQ = 'ReadOnlySequence<byte>';
const POS = 'SequencePosition';

const state = (slots: Slot[], heap: Obj[], output?: string): MemoryState => ({
  frames: [{ id: 'read', method: 'ReadLinesAsync()', slots }],
  heap,
  ...(output !== undefined ? { output } : {}),
});

const FULL = [SEG1, SEG2, SEG3];

export default defineStepScript({
  view: 'memory',
  title: 'ReadOnlySequence, consumed und examined',
  code: {
    cs: `ReadResult result = await reader.ReadAsync();
ReadOnlySequence<byte> buffer = result.Buffer;
while (TryReadLine(ref buffer, out ReadOnlySequence<byte> line))
    Process(line);
reader.AdvanceTo(buffer.Start, buffer.End);
result = await reader.ReadAsync();      // nächste Runde`,
  },
  steps: [
    {
      codeLine: 2,
      state: state(
        [slot('buffer', SEQ, 'Start = (seg1, 0), End = (seg3, 3), Length = 19', 'seg1')],
        FULL,
      ),
      changed: ['buffer', 'seg1', 'seg2', 'seg3'],
      explanation:
        '`ReadAsync` liefert alle ungelesenen Bytes als `ReadOnlySequence<byte>`: eine verkettete Liste von Segmenten mit Start- und Endposition. Die 19 Byte liegen nicht zusammenhängend, sondern in drei Segmenten. Kopiert wurde nichts.',
    },
    {
      codeLine: 3,
      state: state(
        [
          slot('buffer', SEQ, 'Start = (seg1, 5), End = (seg3, 3), Length = 14', 'seg1'),
          slot('line', SEQ, '(seg1, 0) bis (seg1, 4): "PING"', 'seg1'),
        ],
        FULL,
      ),
      changed: ['buffer', 'line'],
      explanation:
        '`TryReadLine` sucht das `\\n`, schneidet die Zeile davor als eigene Sequenz heraus und verschiebt den Anfang von `buffer` hinter das Trennzeichen. `Slice` rechnet nur Positionen um, wie bei einem Span.',
    },
    {
      codeLine: 3,
      state: state(
        [
          slot('buffer', SEQ, 'Start = (seg2, 5), End = (seg3, 3), Length = 6', 'seg2'),
          slot('line', SEQ, '(seg1, 5) bis (seg2, 4): "ECHO hi", 2 Segmente', 'seg1'),
        ],
        FULL,
      ),
      changed: ['buffer', 'line'],
      explanation:
        'Die zweite Zeile beginnt in `seg1` und endet in `seg2`. `line.IsSingleSegment` ist hier `false`, ein einzelner Span reicht nicht. Code, der nur `line.FirstSpan` ansieht, würde „ECH“ statt „ECHO hi“ lesen.',
    },
    {
      codeLine: 3,
      state: state(
        [
          slot('buffer', SEQ, 'Start = (seg2, 5), End = (seg3, 3), Length = 6: "TIME 1"', 'seg2'),
          slot('line', SEQ, 'default (leer)'),
        ],
        FULL,
      ),
      changed: ['line'],
      explanation:
        'Im Rest „TIME 1“ steht kein Zeilenende. `TryReadLine` liefert `false`, die Schleife endet. Diese 6 Byte sind eine unvollständige Nachricht: Der Rest steckt noch im Netz.',
    },
    {
      codeLine: 5,
      state: state(
        [
          slot('buffer', SEQ, 'darf nicht mehr benutzt werden'),
          slot('line', SEQ, 'darf nicht mehr benutzt werden'),
          slot('consumed', POS, '(seg2, 5)', 'seg2'),
          slot('examined', POS, '(seg3, 3) = Ende', 'seg3'),
        ],
        [segment('seg1', '', 'seg2', 0, true), SEG2, SEG3],
      ),
      changed: ['consumed', 'examined', 'seg1'],
      explanation:
        '`consumed` sagt: Alles davor ist verarbeitet und darf weg. `seg1` liegt komplett davor und geht zurück an den Pool. `examined` sagt: Bis hierhin habe ich alles angesehen und brauche mehr Daten. Ab jetzt sind `buffer`, `line` und jeder Span daraus tabu.',
    },
    {
      codeLine: 6,
      state: state([slot('buffer', SEQ, 'ausstehend: ReadAsync wartet')], [SEG2, SEG3]),
      changed: ['buffer'],
      explanation:
        'Häufige Fehlannahme: „Was ich als examined markiere, ist verarbeitet.“ Nein: „TIME 1“ ist nur angesehen, nicht verbraucht, und bleibt in der Pipe. Weil `examined` am Ende steht, kehrt `ReadAsync` erst zurück, wenn **neue** Bytes kommen, statt dieselben 6 Byte sofort wieder zu liefern.',
    },
    {
      codeLine: 6,
      state: state(
        [
          slot(
            'buffer',
            SEQ,
            'Start = (seg2, 5), End = (seg3, 4), Length = 7: "TIME 1\\n"',
            'seg2',
          ),
        ],
        [SEG2, segment('seg3', '"E 1\\n" (4 Byte belegt)', null, 16)],
      ),
      changed: ['buffer', 'seg3.Memory'],
      explanation:
        'Der Writer schreibt das fehlende `\\n` und ruft `FlushAsync`. Der neue Puffer beginnt wieder bei `consumed` und enthält jetzt eine vollständige Zeile über zwei Segmente. Der Parser muss nichts selbst zusammensetzen.',
    },
  ],
});
