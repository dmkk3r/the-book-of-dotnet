import { defineStepScript, type LayoutState } from '@/components/viz';

// TODO(verify): Minimum object size on x64 (24 B) and the header layout (thin lock bits,
// hash code bits, sync block index) against syncblk.h / object.h.

const layout = (header: string, note?: string): LayoutState => ({
  title: 'new object() auf x64',
  totalSize: 24,
  parts: [
    { id: 'hdr', name: header, offset: 0, size: 8, kind: 'header' },
    { id: 'mt', name: 'MethodTable-Zeiger', offset: 8, size: 8, kind: 'methodtable' },
    { id: 'pad', name: 'Mindestgröße', offset: 16, size: 8, kind: 'padding' },
  ],
  note:
    note ??
    'Ein Verweis auf das Objekt zeigt auf den MethodTable-Zeiger. Der Header liegt direkt davor.',
});

export default defineStepScript({
  view: 'layout',
  title: 'Objekt-Header Schritt für Schritt',
  code: {
    cs: `var o = new object();
lock (o)
{
    // kurz gesperrt
}
int h = o.GetHashCode();
lock (o)
{
    // gesperrt und gehasht
}`,
  },
  steps: [
    {
      codeLine: 1,
      state: layout('Header: leer'),
      changed: ['hdr', 'mt'],
      explanation:
        'Jedes Objekt auf dem Heap hat vor seinen Daten zwei Verwaltungsfelder: den **Header** und den **MethodTable-Zeiger**. Selbst ein leeres `object` belegt deshalb Platz.',
    },
    {
      codeLine: 2,
      state: layout('Header: Thin Lock (Thread-ID)'),
      changed: ['hdr'],
      explanation:
        'Ein unumkämpftes `lock` braucht keine zusätzliche Struktur. Die Runtime trägt die ID des sperrenden Threads direkt in den Header ein, ein sogenannter **Thin Lock**.',
    },
    {
      codeLine: 6,
      state: layout('Header: Hashcode'),
      changed: ['hdr'],
      explanation:
        'Nach dem `lock` ist der Header wieder frei. `GetHashCode` erzeugt für dieses Objekt einen Hashcode, der sich nie mehr ändern darf. Die Runtime merkt ihn sich ebenfalls im Header.',
    },
    {
      codeLine: 7,
      state: layout(
        'Header: Sync-Block-Index',
        'Lock-Zustand und Hashcode passen nicht gleichzeitig in den Header. Beides steht jetzt in einem Sync Block, der Header enthält nur noch dessen Index.',
      ),
      changed: ['hdr'],
      explanation:
        'Jetzt wird ein Objekt gesperrt, das schon einen Hashcode hat. Beides zusammen passt nicht in den Header. Die Runtime legt einen **Sync Block** an und schreibt nur dessen Index in den Header.',
    },
    {
      codeLine: 10,
      state: layout(
        'Header: Sync-Block-Index',
        'Ein Sync Block liegt außerhalb des Objekts in einer eigenen Tabelle der Runtime. Er kann auch eine umkämpfte Sperre mit wartenden Threads verwalten.',
      ),
      explanation:
        'Häufige Fehlannahme: Jedes Objekt habe einen Sync Block. Tatsächlich bekommen nur Objekte einen, die ihn brauchen. Die meisten Objekte kommen mit den 8 Byte im Header aus.',
    },
  ],
});
