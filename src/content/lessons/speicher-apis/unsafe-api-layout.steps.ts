import { defineStepScript, type LayoutState } from '@/components/viz';

// Sequential layout with natural alignment as described in „Struct-Layout und Padding“:
// ushort at 0, byte at 2, one byte padding, int at 4, total 8 bytes. Values on a little-endian
// machine (x64, Arm64).
// TODO(verify): Unsafe.SizeOf<Header>() == 8 and the byte sequence 01 00 80 ?? 02 01 00 00 in
// SharpLab (Run). The padding byte has no defined content.

const BYTES = ['0x01', '0x00', '0x80', '?', '0x02', '0x01', '0x00', '0x00'];

const struct = (length: string): LayoutState => ({
  title: 'struct Header (8 Byte)',
  totalSize: 8,
  parts: [
    { id: 's-ver', name: 'Version = 1', type: 'ushort', offset: 0, size: 2, kind: 'field' },
    { id: 's-flags', name: 'Flags = 0x80', type: 'byte', offset: 2, size: 1, kind: 'field' },
    { id: 's-pad', name: 'Padding', offset: 3, size: 1, kind: 'padding' },
    { id: 's-len', name: `Length = ${length}`, type: 'int', offset: 4, size: 4, kind: 'field' },
  ],
  note: 'Der Wert h liegt im Stack-Frame. Alle weiteren Sichten zeigen genau diese 8 Byte.',
});

const bytes = (values: string[]): LayoutState => ({
  title: 'Span<byte> bytes (Länge 8)',
  totalSize: 8,
  parts: values.map((v, i) => ({
    id: `b${i}`,
    name: `[${i}] = ${v}`,
    type: 'byte',
    offset: i,
    size: 1,
    kind: i === 3 ? ('padding' as const) : ('field' as const),
  })),
  note: 'Kleinstes Byte zuerst (Little Endian). Byte 3 ist das Padding: Sein Inhalt ist nicht festgelegt.',
});

const ints: LayoutState = {
  title: 'Span<int> ints (Länge 2)',
  totalSize: 8,
  parts: [
    { id: 'i0', name: 'ints[0] = 0x??800001', type: 'int', offset: 0, size: 4, kind: 'field' },
    { id: 'i1', name: 'ints[1] = 258', type: 'int', offset: 4, size: 4, kind: 'field' },
  ],
  note: 'ints[0] setzt sich aus Version, Flags und dem Padding-Byte zusammen.',
};

const changedBytes = BYTES.map((v, i) => (i === 5 ? '0x02' : v));

export default defineStepScript({
  view: 'layout',
  title: 'Ein Struct als Bytes und als int umgedeutet',
  code: {
    cs: `var h = new Header { Version = 1, Flags = 0x80, Length = 258 };
Span<byte> bytes = MemoryMarshal.AsBytes(new Span<Header>(ref h));
Span<int> ints = MemoryMarshal.Cast<byte, int>(bytes);
bytes[5] = 0x02;
Console.WriteLine(h.Length);

struct Header { public ushort Version; public byte Flags; public int Length; }`,
  },
  steps: [
    {
      codeLine: 1,
      state: struct('258'),
      explanation:
        'Das Struct mit seinem gewöhnlichen Layout: `Length` braucht eine durch 4 teilbare Adresse, deshalb steht zwischen `Flags` und `Length` ein Byte Padding. Zusammen 8 Byte.',
    },
    {
      codeLine: 2,
      state: bytes(BYTES),
      changed: ['b0', 'b1', 'b4', 'b5', 'b6', 'b7'],
      explanation:
        '`AsBytes` liefert einen `Span<byte>` über **denselben** Speicher, nur die Länge wird in Byte umgerechnet. Die Reihenfolge der Bytes ist die der Maschine: Auf x64 und Arm64 steht das niederwertigste Byte zuerst, 258 erscheint als `02 01 00 00`.',
    },
    {
      codeLine: 2,
      state: bytes(BYTES),
      changed: ['b3'],
      explanation:
        'Auch das Padding-Byte gehört zur Sicht. Was darin steht, legt niemand fest. Wer diese Bytes in eine Datei schreibt oder hasht, schreibt diesen Zufall mit.',
    },
    {
      codeLine: 3,
      state: ints,
      changed: ['i0', 'i1'],
      explanation:
        '`Cast<byte, int>` teilt 8 Byte durch 4 und liefert einen `Span<int>` der Länge 2, wieder ohne Kopie. `ints[1]` ist zufällig genau `Length`, `ints[0]` ein Mischwert aus drei Feldern und dem Padding.',
    },
    {
      codeLine: 4,
      state: bytes(changedBytes),
      changed: ['b5'],
      explanation:
        'Häufige Fehlannahme: „`MemoryMarshal.Cast` und `AsBytes` kopieren die Daten in einen neuen Puffer.“ Sie tun es nicht. Der Schreibzugriff auf `bytes[5]` ändert direkt das zweite Byte von `h.Length`.',
    },
    {
      codeLine: 5,
      state: struct('514'),
      changed: ['s-len'],
      explanation:
        'Aus `02 01 00 00` wurde `02 02 00 00`, also 0x0202 = 514. Alle drei Sichten, `h`, `bytes` und `ints`, sehen die Änderung sofort, weil es nur einen Speicher gibt.',
    },
  ],
});
