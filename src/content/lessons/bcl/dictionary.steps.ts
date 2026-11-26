import { defineStepScript, type BucketState } from '@/components/viz';

// Hash codes are fictional (string hashing is randomized per process) but consistent
// across all dictionary*.steps.ts files: "rot" 17, "grün" 41, "blau" 30, "gelb" 23.
// Checked against Dictionary.cs and HashHelpers.cs on dotnet/runtime main (2026-11-25):
// the first insert calls Initialize(0), GetPrime(0) returns 3, the bucket index is hash % length
// (FastMod on 64-bit gives the same result), a new entry becomes the head of its chain.
// TODO(verify): Initial size 3 and head insertion also hold for the .NET version named in the lesson.

type Entry = BucketState['entries'][number];
const rot: Entry = { id: 'e-rot', key: '"rot"', value: '1', hash: '17', bucket: 2, next: null };
const grün: Entry = { id: 'e-grün', key: '"grün"', value: '2', hash: '41', bucket: 2, next: 0 };
const blau: Entry = { id: 'e-blau', key: '"blau"', value: '3', hash: '30', bucket: 0, next: null };

const full = { buckets: [2, null, 1], entries: [rot, grün, blau] };

export default defineStepScript({
  view: 'buckets',
  title: 'Dictionary Schritt für Schritt',
  code: {
    cs: `var d = new Dictionary<string, int>();
d["rot"]  = 1;
d["grün"] = 2;
d["blau"] = 3;
Console.WriteLine(d["blau"]);
Console.WriteLine(d["rot"]);
Console.WriteLine(d.ContainsKey("gelb"));`,
  },
  steps: [
    {
      codeLine: 1,
      state: { buckets: [], entries: [] },
      explanation:
        'Ein neues `Dictionary` ohne Kapazitätsangabe legt noch keine Arrays an. Das passiert erst beim ersten Einfügen, ein leeres Dictionary kostet deshalb fast nichts.',
    },
    {
      codeLine: 2,
      state: { buckets: [null, null, 0], entries: [rot] },
      changed: ['bucket-2', 'e-rot'],
      explanation:
        'Jetzt entstehen `buckets` und `entries`, beide mit der kleinsten Primzahl aus der Größentabelle (3). Der Hash von "rot" ist 17, **17 % 3 = 2**, also zeigt Bucket 2 auf Eintrag 0. Der Hashcode wird im Eintrag mitgespeichert.',
    },
    {
      codeLine: 3,
      state: { buckets: [null, null, 1], entries: [rot, grün] },
      changed: ['bucket-2', 'e-grün'],
      explanation:
        'Kollision: 41 % 3 ist ebenfalls 2. Der neue Eintrag kommt an die nächste freie Stelle von `entries`, sein `next` zeigt auf den bisherigen Kopf, und der Bucket zeigt jetzt auf ihn. Neue Einträge werden also vorne in die Kette gehängt.',
    },
    {
      codeLine: 4,
      state: full,
      changed: ['bucket-0', 'e-blau'],
      explanation:
        '30 % 3 = 0, also Bucket 0. Alle Einträge liegen dicht hintereinander in einem einzigen Array, nicht als einzelne Knotenobjekte auf dem Heap. `entries` ist jetzt voll, der nächste neue Schlüssel löst ein Resize aus.',
    },
    {
      codeLine: 5,
      state: {
        ...full,
        probe: { key: '"blau"', hash: '30', bucket: 0, path: [2], found: true },
        output: '3',
      },
      explanation:
        'Nachschlagen: Hash berechnen, Bucket bestimmen, Kette ablaufen. Für jeden Kandidaten vergleicht das Dictionary erst den gespeicherten Hash und nur bei Gleichheit die Schlüssel mit `Equals`. Hier reicht ein einziger Vergleich.',
    },
    {
      codeLine: 6,
      state: {
        ...full,
        probe: { key: '"rot"', hash: '17', bucket: 2, path: [1, 0], found: true },
        output: '3\n1',
      },
      explanation:
        '"rot" liegt in Bucket 2 hinter "grün". Die Suche prüft erst Eintrag 1 (Hash 41 passt nicht, `Equals` wird gar nicht aufgerufen), dann über `next` Eintrag 0. Häufige Fehlannahme: Ein Zugriff sei immer genau ein Schritt. Er kostet so viele Schritte, wie die Kette lang ist.',
    },
    {
      codeLine: 7,
      state: {
        ...full,
        probe: { key: '"gelb"', hash: '23', bucket: 2, path: [1, 0], found: false },
        output: '3\n1\nFalse',
      },
      explanation:
        'Auch eine erfolglose Suche läuft die ganze Kette ab: 23 % 3 = 2, beide Einträge in Bucket 2 haben einen anderen Hash. Erst am Kettenende steht fest, dass "gelb" fehlt.',
    },
  ],
});
