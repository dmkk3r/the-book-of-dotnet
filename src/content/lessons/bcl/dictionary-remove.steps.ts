import { defineStepScript, type BucketState } from '@/components/viz';

// Continues the resize script (7 buckets). Fictional but consistent hash codes:
// "rot" 17, "grün" 41, "blau" 30, "gelb" 23, "lila" 50 (50 % 7 = 1), "pink" 12 (12 % 7 = 5).
// Checked against Dictionary.cs on dotnet/runtime main (2026-11-25): Remove unlinks the entry,
// pushes it onto the free list (_freeList = i, so the last removed entry is reused first) and
// TryInsert takes entries from the free list while _freeCount > 0 before using _count.
// The source stores the free list link in `next` as StartOfFreeList - index (StartOfFreeList = -3,
// so -2 marks the end of the free list). The view shows that link as a plain index instead.
// The enumerator walks entries by index and skips free slots, hence the output order.
// TODO(verify): Free list encoding and LIFO reuse are unchanged in the .NET version named in the lesson.

type Entry = BucketState['entries'][number];

const rot: Entry = { id: 'e-0', key: '"rot"', value: '1', hash: '17', bucket: 3, next: null };
const grün: Entry = { id: 'e-1', key: '"grün"', value: '2', hash: '41', bucket: 6, next: null };
const blau: Entry = { id: 'e-2', key: '"blau"', value: '3', hash: '30', bucket: 2, next: null };
const gelb = (next: number | null): Entry => ({
  id: 'e-3',
  key: '"gelb"',
  value: '4',
  hash: '23',
  bucket: 2,
  next,
});
// A free slot: not reachable from any bucket, `next` is the free list link.
const free = (id: string, bucket: number, next: number | null): Entry => ({
  id,
  key: '(frei)',
  value: '(frei)',
  hash: '(frei)',
  bucket,
  next,
});
const lila: Entry = { id: 'e-2', key: '"lila"', value: '5', hash: '50', bucket: 1, next: null };
const pink: Entry = { id: 'e-1', key: '"pink"', value: '6', hash: '12', bucket: 5, next: null };

const afterBlau: BucketState = {
  buckets: [null, null, 3, 0, null, null, null],
  entries: [rot, free('e-1', 6, null), free('e-2', 2, 1), gelb(null)],
};
const final: BucketState = {
  buckets: [null, 2, 3, 0, null, 1, null],
  entries: [rot, pink, lila, gelb(null)],
};

export default defineStepScript({
  view: 'buckets',
  title: 'Remove und die Freiliste',
  code: {
    cs: `// d enthält "rot", "grün", "blau", "gelb" (7 Buckets)
d.Remove("grün");
d.Remove("blau");
d["lila"] = 5;
d["pink"] = 6;
foreach (var key in d.Keys)
    Console.Write(key + " ");`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        buckets: [null, null, 3, 0, null, null, 1],
        entries: [rot, grün, blau, gelb(2)],
      },
      explanation:
        'Ausgangslage ist das Ergebnis des Resize: vier Einträge, sieben Buckets, eine Kette in Bucket 2 („gelb“ vor „blau“).',
    },
    {
      codeLine: 2,
      state: {
        buckets: [null, null, 3, 0, null, null, null],
        entries: [rot, free('e-1', 6, null), blau, gelb(2)],
      },
      changed: ['bucket-6', 'e-1'],
      explanation:
        '"grün" ist der einzige Eintrag in Bucket 6, der Bucket wird leer. Der Eintrag selbst bleibt als Lücke stehen, nichts rückt nach. Er wird erster Eintrag der **Freiliste**.',
    },
    {
      codeLine: 3,
      state: {
        buckets: [null, null, 3, 0, null, null, null],
        entries: [rot, free('e-1', 6, null), blau, gelb(2)],
        probe: { key: '"blau"', hash: '30', bucket: 2, path: [3, 2], found: true },
      },
      explanation:
        'Zum Entfernen muss das Dictionary den Eintrag erst finden und sich dabei den Vorgänger merken: Eintrag 3 („gelb“) zeigt auf Eintrag 2 („blau“).',
    },
    {
      codeLine: 3,
      state: afterBlau,
      changed: ['e-3', 'e-2'],
      explanation:
        'Der Vorgänger übernimmt das `next` von "blau", die Kette ist wieder geschlossen. Eintrag 2 kommt vorne auf die Freiliste, sein `next` zeigt hier auf den nächsten freien Eintrag 1. Im Quellcode ist dieser Verweis negativ kodiert, damit freie und belegte Einträge unterscheidbar bleiben.',
    },
    {
      codeLine: 4,
      state: {
        buckets: [null, 2, 3, 0, null, null, null],
        entries: [rot, free('e-1', 6, null), lila, gelb(null)],
      },
      changed: ['bucket-1', 'e-2'],
      explanation:
        '"lila" (50 % 7 = 1) bekommt keinen neuen Platz am Ende, sondern den Kopf der Freiliste: Eintrag 2, also den zuletzt entfernten. Das Array wächst nicht, ein Resize ist ausgeschlossen.',
    },
    {
      codeLine: 5,
      state: final,
      changed: ['bucket-5', 'e-1'],
      explanation:
        '"pink" (12 % 7 = 5) übernimmt den letzten freien Eintrag 1. Die Freiliste ist leer, der nächste neue Schlüssel käme wieder ans Ende, an Index 4.',
    },
    {
      codeLine: 7,
      state: { ...final, output: 'rot pink lila gelb' },
      explanation:
        'Der Enumerator läuft `entries` einfach nach Index ab. Deshalb erscheint "pink" vor "gelb", obwohl es zuletzt eingefügt wurde. Fehlannahme: Ein Dictionary liefere seine Einträge in Einfügereihenfolge. Das stimmt nur, solange nie etwas entfernt wurde, und garantiert ist es nie.',
    },
  ],
});
