import { defineStepScript, type TimelineState } from '@/components/viz';

// Abstract time units. Writer fills the pipe from a socket, reader parses lines.
// Back pressure follows the PipeOptions docs: FlushAsync does not complete while the unconsumed
// data exceeds PauseWriterThreshold, and resumes once it drops below ResumeWriterThreshold.
// TODO(verify): Defaults PauseWriterThreshold 65536 and ResumeWriterThreshold 32768 bytes
// (PipeOptions docs / PipeOptions.cs).

type Item = TimelineState['items'][number];
type Link = NonNullable<TimelineState['links']>[number];

const LANES: TimelineState['lanes'] = [
  { id: 'writer', label: 'Writer-Task (Socket → Pipe)', kind: 'io' },
  { id: 'reader', label: 'Reader-Task (Pipe → Parser)', kind: 'pool' },
];

const ALL: Record<string, Item> = {
  wRecv1: {
    id: 'wRecv1',
    lane: 'writer',
    start: 0,
    end: 2,
    label: 'wartet',
    kind: 'wait',
  },
  rRead1: {
    id: 'rRead1',
    lane: 'reader',
    start: 0,
    end: 3,
    label: 'ReadAsync',
    kind: 'wait',
  },
  wFlush1: {
    id: 'wFlush1',
    lane: 'writer',
    start: 2,
    end: 3,
    label: 'Flush',
    kind: 'run',
  },
  rParse1: {
    id: 'rParse1',
    lane: 'reader',
    start: 3,
    end: 5,
    label: 'AdvanceTo',
    kind: 'continuation',
  },
  wMore: {
    id: 'wMore',
    lane: 'writer',
    start: 3,
    end: 9,
    label: 'empfangen, schreiben',
    kind: 'run',
  },
  rParse2: {
    id: 'rParse2',
    lane: 'reader',
    start: 5,
    end: 13,
    label: 'langsame Verarbeitung',
    kind: 'run',
  },
  wPause: {
    id: 'wPause',
    lane: 'writer',
    start: 9,
    end: 13,
    label: 'Flush wartet',
    kind: 'wait',
  },
  wResume: {
    id: 'wResume',
    lane: 'writer',
    start: 13,
    end: 16,
    label: 'weiter',
    kind: 'continuation',
  },
  wDone: { id: 'wDone', lane: 'writer', start: 16, end: 17, label: 'Complete', kind: 'run' },
  rRead3: {
    id: 'rRead3',
    lane: 'reader',
    start: 13,
    end: 17,
    label: 'weitere Runden',
    kind: 'run',
  },
  rLast: {
    id: 'rLast',
    lane: 'reader',
    start: 17,
    end: 19,
    label: 'Rest',
    kind: 'continuation',
  },
};

const LINKS: Link[] = [
  { from: 'wFlush1', to: 'rParse1' },
  { from: 'rParse2', to: 'wResume' },
  { from: 'wDone', to: 'rLast' },
];

function state(ids: string[], now: number, output: string): TimelineState {
  const items = ids.map((id) => ALL[id]!);
  const present = new Set(ids);
  return {
    lanes: LANES,
    duration: 20,
    items,
    links: LINKS.filter((l) => present.has(l.from) && present.has(l.to)),
    now,
    output,
  };
}

export default defineStepScript({
  view: 'timeline',
  layout: 'stacked',
  title: 'Writer und Reader einer Pipe mit Gegendruck',
  code: {
    cs: `var pipe = new Pipe();
// Writer-Task
Memory<byte> mem = pipe.Writer.GetMemory(512);
int n = await socket.ReceiveAsync(mem, SocketFlags.None);
pipe.Writer.Advance(n);
FlushResult f = await pipe.Writer.FlushAsync();
// Reader-Task
ReadResult r = await pipe.Reader.ReadAsync();
/* Zeilen parsen */
pipe.Reader.AdvanceTo(consumed, examined);
await pipe.Writer.CompleteAsync();      // Writer ist fertig`,
  },
  steps: [
    {
      codeLine: 4,
      state: state(['wRecv1', 'rRead1'], 1, 'In der Pipe: 0 Byte'),
      changed: ['wRecv1', 'rRead1'],
      explanation:
        'Beide Seiten warten, keine belegt dabei einen Thread. Der Writer hat sich mit `GetMemory` ein Stück Speicher aus der Pipe geholt und lässt den Socket direkt hineinschreiben. Der Reader wartet in `ReadAsync` auf Daten.',
    },
    {
      codeLine: 6,
      state: state(['wRecv1', 'rRead1', 'wFlush1'], 3, 'In der Pipe: 19 Byte, ungelesen'),
      changed: ['wFlush1'],
      explanation:
        '`Advance(19)` meldet, wie viel tatsächlich geschrieben wurde. Erst `FlushAsync` macht die Bytes für den Reader sichtbar und weckt ihn. `FlushAsync` wartet dabei **nicht**, bis der Reader die Daten verarbeitet hat.',
    },
    {
      codeLine: 10,
      state: state(
        ['wRecv1', 'rRead1', 'wFlush1', 'rParse1'],
        5,
        'In der Pipe: 6 Byte (eine halbe Zeile)',
      ),
      changed: ['rParse1'],
      explanation:
        'Die Fortsetzung des Readers findet zwei vollständige Zeilen und eine halbe. Mit `AdvanceTo` gibt er die zwei Zeilen frei und behält den Rest, bis mehr Daten kommen.',
    },
    {
      codeLine: 6,
      state: state(
        ['wRecv1', 'rRead1', 'wFlush1', 'rParse1', 'wMore', 'rParse2'],
        9,
        'Ungelesen: über PauseWriterThreshold',
      ),
      changed: ['wMore', 'rParse2'],
      explanation:
        'Jetzt ist der Reader langsamer als das Netz. Der Writer schreibt weiter, und die ungelesenen Daten wachsen. Ohne Grenze würde die Pipe so lange Segmente anfordern, bis der Speicher ausgeht.',
    },
    {
      codeLine: 6,
      state: state(
        ['wRecv1', 'rRead1', 'wFlush1', 'rParse1', 'wMore', 'rParse2', 'wPause'],
        11,
        'Ungelesen: über PauseWriterThreshold',
      ),
      changed: ['wPause'],
      explanation:
        'Das ist **Gegendruck**: Liegt mehr als `PauseWriterThreshold` ungelesen in der Pipe, kehrt `FlushAsync` nicht sofort zurück. Der Writer wartet, ohne Thread, und liest in dieser Zeit nichts vom Socket. Der Socket-Puffer füllt sich, und TCP bremst den Sender.',
    },
    {
      codeLine: 10,
      state: state(
        [
          'wRecv1',
          'rRead1',
          'wFlush1',
          'rParse1',
          'wMore',
          'rParse2',
          'wPause',
          'wResume',
          'rRead3',
        ],
        14,
        'Ungelesen: unter ResumeWriterThreshold',
      ),
      changed: ['wResume', 'rRead3'],
      explanation:
        'Der Reader gibt mit `AdvanceTo` viele Bytes frei. Fällt die Menge unter `ResumeWriterThreshold`, wird das wartende `FlushAsync` fertig und der Writer läuft weiter. Die Lücke zwischen beiden Schwellen verhindert, dass der Writer bei jedem Byte hin und her schaltet.',
    },
    {
      codeLine: 11,
      state: state(
        [
          'wRecv1',
          'rRead1',
          'wFlush1',
          'rParse1',
          'wMore',
          'rParse2',
          'wPause',
          'wResume',
          'rRead3',
          'wDone',
          'rLast',
        ],
        19,
        'Pipe leer, beide Seiten abgeschlossen',
      ),
      changed: ['wDone', 'rLast'],
      explanation:
        'Der Socket liefert 0 Byte, der Writer ruft `CompleteAsync`. Der Reader bekommt danach ein `ReadResult` mit `IsCompleted = true`, verarbeitet **zuerst** die restlichen Bytes und ruft dann selbst `CompleteAsync`.',
    },
  ],
});
