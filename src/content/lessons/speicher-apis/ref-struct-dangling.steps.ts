import { defineStepScript, type MemoryState } from '@/components/viz';

// Thought experiment: what would happen if the compiler accepted `return buf;` for a span over
// stackalloc memory. Addresses on the stack are fictional; that Other() reuses exactly the same
// bytes is a simplification to make the effect visible (real frame layouts differ).
// 0x1234 = 4660; on little endian x64 the low 4 bytes of the long are read as int.
// TODO(verify): Exact text of CS8352 in the current compiler („Cannot use variable 'buf' in this
// context because it may expose referenced variables outside of their declaration scope“;
// Stephen Toub's 2018 article quotes it with „local“ instead of „variable“).

const BUF = '0xA1F6C0';

type Slot = MemoryState['frames'][number]['slots'][number];
type Frame = MemoryState['frames'][number];

const sSlot = (value: string): Slot => ({ id: 's', name: 's', type: 'Span<int>', value });
const main = (s: string): Frame => ({ id: 'main', method: 'Main()', slots: [sSlot(s)] });

const create = (contents: string): Frame => ({
  id: 'create',
  method: 'Create()',
  slots: [
    {
      id: 'puffer',
      name: '(stackalloc-Puffer)',
      type: `int[3] ab ${BUF}`,
      value: contents,
    },
    {
      id: 'buf',
      name: 'buf',
      type: 'Span<int>',
      value: `_reference = ${BUF} (→ Puffer), _length = 3`,
    },
  ],
});

const other: Frame = {
  id: 'other',
  method: 'Other()',
  slots: [{ id: 'secret', name: 'secret', type: `long ab ${BUF}`, value: '0x1234' }],
};

const DANGLING = `_reference = ${BUF} (→ ehemaliger Frame von Create), _length = 3`;

export default defineStepScript({
  view: 'memory',
  title: 'Gedankenexperiment: ein Span überlebt seinen Stack-Speicher',
  code: {
    cs: `static Span<int> Create()
{
    Span<int> buf = stackalloc int[3];
    buf[0] = 42;
    return buf;            // in Wirklichkeit: Fehler CS8352
}

static void Other()
{
    long secret = 0x1234;
    // …
}

Span<int> s = Create();    // angenommen, das ginge
Other();
Console.WriteLine(s[0]);`,
  },
  steps: [
    {
      codeLine: 3,
      state: { frames: [main('noch nicht zugewiesen'), create('0 0 0')], heap: [] },
      changed: ['create', 'puffer', 'buf'],
      explanation:
        '`stackalloc` legt drei `int` **im Frame von Create** an, `buf` zeigt darauf. Dieser Speicher gehört dem Frame und wird mit ihm aufgegeben, ganz ohne GC.',
    },
    {
      codeLine: 4,
      state: { frames: [main('noch nicht zugewiesen'), create('42 0 0')], heap: [] },
      changed: ['puffer'],
      explanation: 'Der Span schreibt die 42 in den Puffer. Bis hierhin ist alles korrekt.',
    },
    {
      codeLine: 14,
      state: { frames: [main(DANGLING)], heap: [] },
      changed: ['s'],
      explanation:
        'Angenommen, `return buf` wäre erlaubt: `Create` kehrt zurück, ihr Frame ist aufgegeben. `s` zeigt nun auf Stack-Speicher, der niemandem mehr gehört. Die 42 steht dort vielleicht noch, aber nur zufällig.',
    },
    {
      codeLine: 15,
      state: { frames: [main(DANGLING), other], heap: [] },
      changed: ['other', 'secret'],
      explanation:
        'Der nächste Aufruf legt seinen Frame in denselben Bereich. Die Variable `secret` von `Other` belegt jetzt die Bytes, auf die `s` zeigt.',
    },
    {
      codeLine: 16,
      state: { frames: [main(DANGLING)], heap: [], output: '4660' },
      changed: ['s'],
      explanation:
        'Häufige Fehlannahme: „Der Bounds-Check hätte das abgefangen.“ Index 0 ist kleiner als die Länge 3, die Prüfung besteht. Gelesen wird ein Teil von `secret` (0x1234 ist 4660). Ein Span schützt vor falschen Indizes, nicht vor totem Speicher.',
    },
    {
      codeLine: 5,
      state: {
        frames: [main('noch nicht zugewiesen'), create('42 0 0')],
        heap: [],
        output:
          "error CS8352: Cannot use variable 'buf' in this context because it may expose referenced variables outside of their declaration scope",
      },
      changed: ['buf'],
      explanation:
        'Deshalb lässt der Compiler es gar nicht so weit kommen. Er weiß, dass `buf` aus `stackalloc` stammt und deshalb nur innerhalb von `Create` gültig ist, und lehnt `return buf` ab. Wie er diese Lebensdauer verfolgt, ist das Thema dieser Lektion.',
    },
  ],
});
