import { defineStepScript, type MemoryState } from '@/components/viz';

// Addresses are fictional but consistent across steps.
// Behaviour of ArrayPool<byte>.Shared from dotnet/runtime SharedArrayPool.cs: Rent rounds up to
// the bucket size (16 << SelectBucketIndex(n), so 100 → 128 and 80 → 128), checks the
// thread-local slot of that bucket first, Return stores into that slot. Rent allocates with
// GC.AllocateUninitializedArray for primitive types, so contents are not guaranteed to be zero.
// The per-thread cache is a managed array (SharedArrayPoolThreadLocalArray[]) with one slot per
// bucket; only four buckets are shown here.
// TODO(verify): Array size 24 B header + 128 B on x64 = 152 B.

type Frame = MemoryState['frames'][number];
type Obj = MemoryState['heap'][number];

const ARR = '0x7F3A3080';
const TLS = '0x7F3A3000';

const main: Frame = {
  id: 'main',
  method: 'Main()',
  slots: [
    { id: 'secret', name: 'secret', type: 'byte[] (100 Byte)', value: 'Daten A' },
    { id: 'other', name: 'other', type: 'byte[] (80 Byte)', value: 'Daten B' },
  ],
};

const proc = (input: string, buf: 'arr' | null): Frame => ({
  id: 'proc',
  method: 'Process(ReadOnlySpan<byte> input)',
  slots: [
    { id: 'input', name: 'input', type: 'ReadOnlySpan<byte>', value: input },
    {
      id: 'buf',
      name: 'buf',
      type: 'byte[] (Verweis)',
      value: buf ? `${ARR}, Length 128` : 'null',
      ...(buf ? { ref: buf } : {}),
    },
  ],
});

const tls = (slot128: boolean): Obj => ({
  id: 'tls',
  type: 'Pool-Cache von Thread 1',
  address: TLS,
  generation: 0,
  fields: [
    { name: 'Bucket 16', value: 'leer' },
    { name: 'Bucket 32', value: 'leer' },
    { name: 'Bucket 64', value: 'leer' },
    {
      name: 'Bucket 128',
      value: slot128 ? ARR : 'leer',
      ...(slot128 ? { ref: 'arr' } : {}),
    },
  ],
});

const arr = (content: string): Obj => ({
  id: 'arr',
  type: 'byte[128]',
  address: ARR,
  generation: 0,
  fields: [
    { name: 'Length', value: '128' },
    { name: 'Inhalt', value: content },
  ],
  sizeBytes: 152,
});

export default defineStepScript({
  view: 'memory',
  title: 'Rent und Return Schritt für Schritt',
  code: {
    cs: `static void Process(ReadOnlySpan<byte> input)
{
    byte[] buf = ArrayPool<byte>.Shared.Rent(input.Length);
    input.CopyTo(buf);
    Send(buf);                        // Fehler: ganzes Array
    ArrayPool<byte>.Shared.Return(buf);
}

Process(secret);   // 100 Byte
Process(other);    // 80 Byte`,
  },
  steps: [
    {
      codeLine: 3,
      state: { frames: [main, proc('100 Byte (Daten A)', null)], heap: [] },
      changed: ['proc', 'input'],
      explanation:
        '`Process` braucht einen Puffer für 100 Byte und leiht ihn sich beim gemeinsamen Pool `ArrayPool<byte>.Shared`. Noch hat dieser Thread nie etwas ausgeliehen.',
    },
    {
      codeLine: 3,
      state: {
        frames: [main, proc('100 Byte (Daten A)', 'arr')],
        heap: [tls(false), arr('128 Byte, Inhalt nicht garantiert')],
      },
      changed: ['buf', 'arr', 'tls'],
      explanation:
        'Häufige Fehlannahme: `Rent(100)` liefere 100 Elemente. Der Pool rundet auf seine Größenklasse auf, hier **128**. Weil der Cache leer ist, alloziert er ein neues Array, und zwar ohne Garantie, dass es genullt ist.',
    },
    {
      codeLine: 4,
      state: {
        frames: [main, proc('100 Byte (Daten A)', 'arr')],
        heap: [tls(false), arr('0 bis 99: Daten A, 100 bis 127: unbestimmt')],
      },
      changed: ['arr.Inhalt'],
      explanation:
        '`CopyTo` füllt die ersten 100 Byte. Die letzten 28 Byte gehören zum Array, wurden aber nie beschrieben.',
    },
    {
      codeLine: 5,
      state: {
        frames: [main, proc('100 Byte (Daten A)', 'arr')],
        heap: [tls(false), arr('0 bis 99: Daten A, 100 bis 127: unbestimmt')],
        output: 'Send: 128 Byte',
      },
      changed: ['buf'],
      explanation:
        'Der Fehler in Zeile 5: `Send(buf)` schickt `buf.Length` Byte, also 128 statt 100. Wer mit gepoolten Arrays arbeitet, muss die gewünschte Länge selbst mitführen, etwa mit `buf.AsSpan(0, input.Length)`.',
    },
    {
      codeLine: 6,
      state: {
        frames: [main, proc('100 Byte (Daten A)', 'arr')],
        heap: [tls(true), arr('0 bis 99: Daten A, 100 bis 127: unbestimmt')],
        output: 'Send: 128 Byte',
      },
      changed: ['tls.Bucket 128'],
      explanation:
        '`Return` legt das Array in den Cache dieses Threads, Platz für Größenklasse 128. Es wird **nicht** geleert, und `buf` zeigt weiterhin darauf. Ab jetzt wäre jeder Zugriff über `buf` ein Zugriff auf fremdes Eigentum.',
    },
    {
      codeLine: 10,
      state: {
        frames: [main, proc('80 Byte (Daten B)', 'arr')],
        heap: [tls(false), arr('0 bis 99: Daten A, 100 bis 127: unbestimmt')],
        output: 'Send: 128 Byte',
      },
      changed: ['proc', 'input', 'buf', 'tls.Bucket 128'],
      explanation:
        'Zweiter Aufruf, `Rent(80)`: Auch 80 fällt in die Größenklasse 128. Der Pool nimmt das Array aus dem Cache, ohne neue Allokation. Es ist **dasselbe** Objekt an derselben Adresse, mit den Daten des vorigen Aufrufs.',
    },
    {
      codeLine: 4,
      state: {
        frames: [main, proc('80 Byte (Daten B)', 'arr')],
        heap: [
          tls(false),
          arr('0 bis 79: Daten B, 80 bis 99: Rest von Daten A, 100 bis 127: unbestimmt'),
        ],
        output: 'Send: 128 Byte',
      },
      changed: ['arr.Inhalt'],
      explanation:
        '`CopyTo` überschreibt nur 80 Byte. Dahinter stehen noch 20 Byte aus dem ersten Aufruf, etwa aus einem Passwort-Hash.',
    },
    {
      codeLine: 5,
      state: {
        frames: [main, proc('80 Byte (Daten B)', 'arr')],
        heap: [
          tls(false),
          arr('0 bis 79: Daten B, 80 bis 99: Rest von Daten A, 100 bis 127: unbestimmt'),
        ],
        output: 'Send: 128 Byte\nSend: 128 Byte (enthält 20 Byte von Daten A)',
      },
      changed: ['buf'],
      explanation:
        'Jetzt wird aus dem Längenfehler ein Datenleck: Der zweite Empfänger bekommt Bytes, die zum ersten Aufruf gehörten. Hilfreich ist hier `Return(buf, clearArray: true)` für sensible Daten, die eigentliche Lösung ist aber die richtige Länge.',
    },
  ],
});
