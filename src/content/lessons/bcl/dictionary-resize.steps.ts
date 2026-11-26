import { defineStepScript, type BucketState } from '@/components/viz';

// Continues the main script: same fictional hash codes ("rot" 17, "grün" 41, "blau" 30, "gelb" 23).
// Checked against Dictionary.cs and HashHelpers.cs on dotnet/runtime main (2026-11-25):
// TryInsert searches the chain first, then calls Resize() when _count == entries.Length;
// Resize() uses ExpandPrime(_count) = GetPrime(2 * 3) = 7, copies entries with Array.Copy
// (same indices), allocates new buckets and relinks every entry in index order using the
// stored hashCode (GetHashCode is not called again).
// TODO(verify): Growth from 3 to 7 holds for the .NET version named in the lesson.

type Entry = BucketState['entries'][number];

// Buckets after the resize: 17 % 7 = 3, 41 % 7 = 6, 30 % 7 = 2, 23 % 7 = 2.
const rot = (next: number | null, bucket = 3): Entry => ({
  id: 'e-rot',
  key: '"rot"',
  value: '1',
  hash: '17',
  bucket,
  next,
});
const grün = (next: number | null, bucket = 6): Entry => ({
  id: 'e-grün',
  key: '"grün"',
  value: '2',
  hash: '41',
  bucket,
  next,
});
const blau = (bucket = 2): Entry => ({
  id: 'e-blau',
  key: '"blau"',
  value: '3',
  hash: '30',
  bucket,
  next: null,
});
const gelb: Entry = { id: 'e-gelb', key: '"gelb"', value: '4', hash: '23', bucket: 2, next: 2 };

const empty7 = (): (number | null)[] => [null, null, null, null, null, null, null];

export default defineStepScript({
  view: 'buckets',
  title: 'Resize von 3 auf 7 Buckets',
  code: {
    cs: `d["gelb"] = 4;   // entries ist voll

// vereinfacht nach Dictionary.Resize():
int newSize = HashHelpers.ExpandPrime(_count); // 7
var entries = new Entry[newSize];
Array.Copy(_entries, entries, _count);  // gleiche Indizes
_buckets = new int[newSize];            // alle Buckets leer
for (int i = 0; i < _count; i++)
{
    ref int bucket = ref GetBucket(entries[i].hashCode);
    entries[i].next = bucket - 1;  // alter Kopf wird Nachfolger
    bucket = i + 1;                // Eintrag i wird neuer Kopf
}
_entries = entries;`,
  },
  steps: [
    {
      codeLine: 1,
      state: {
        buckets: [2, null, 1],
        entries: [rot(null, 2), grün(0, 2), blau(0)],
        probe: { key: '"gelb"', hash: '23', bucket: 2, path: [1, 0], found: false },
      },
      explanation:
        'Zuerst sucht das Dictionary wie immer in der Kette, denn ein vorhandener Schlüssel würde nur überschrieben. "gelb" ist neu. Jetzt fällt auf: Alle drei Plätze in `entries` sind belegt.',
    },
    {
      codeLine: 6,
      state: { buckets: empty7(), entries: [rot(null), grün(0), blau()] },
      changed: ['e-rot', 'e-grün', 'e-blau'],
      explanation:
        'Die neue Größe ist die nächste Primzahl ab dem Doppelten: Das Doppelte von 3 wäre 6, die Tabelle liefert **7**. `entries` wird in ein neues Array kopiert, jeder Eintrag behält seinen Index. Die Buckets sind neu und leer, die alten `next`-Werte sind noch nicht angepasst.',
    },
    {
      codeLine: 12,
      state: {
        buckets: [null, null, null, 0, null, null, null],
        entries: [rot(null), grün(0), blau()],
      },
      changed: ['bucket-3', 'e-rot'],
      explanation:
        'Eintrag 0: Der gespeicherte Hash 17 ergibt jetzt **17 % 7 = 3**. `GetHashCode` wird dafür nicht erneut aufgerufen, der Hash steht ja im Eintrag. Bucket 3 zeigt auf Eintrag 0.',
    },
    {
      codeLine: 12,
      state: {
        buckets: [null, null, null, 0, null, null, 1],
        entries: [rot(null), grün(null), blau()],
      },
      changed: ['bucket-6', 'e-grün'],
      explanation:
        'Eintrag 1: 41 % 7 = 6. Bisher teilte "grün" sich Bucket 2 mit "rot", jetzt landen beide in verschiedenen Buckets. Die alte Kette zerfällt, `next` von "grün" wird „keiner“.',
    },
    {
      codeLine: 12,
      state: {
        buckets: [null, null, 2, 0, null, null, 1],
        entries: [rot(null), grün(null), blau()],
      },
      changed: ['bucket-2', 'e-blau'],
      explanation:
        'Eintrag 2: 30 % 7 = 2. Damit sind alle Einträge neu verteilt. Mehr Buckets heißt im Schnitt kürzere Ketten, genau dafür ist das Resize da.',
    },
    {
      codeLine: 1,
      state: {
        buckets: [null, null, 3, 0, null, null, 1],
        entries: [rot(null), grün(null), blau(), gelb],
      },
      changed: ['bucket-2', 'e-gelb'],
      explanation:
        'Erst jetzt wird "gelb" eingefügt: 23 % 7 = 2, Eintrag 3 wird neuer Kopf von Bucket 2 und verweist auf "blau". Kollisionen verschwinden durch ein Resize also nicht, sie werden nur seltener.',
    },
  ],
});
