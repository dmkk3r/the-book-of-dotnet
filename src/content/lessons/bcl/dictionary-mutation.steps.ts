import { defineStepScript, type BucketState } from '@/components/viz';

// Hash codes are fictional (HashCode.Combine uses a per-process random seed) but consistent:
// Punkt(1, 2) -> 17 (17 % 3 = 2), Punkt(5, 2) -> 22 (22 % 3 = 1).

type Entry = BucketState['entries'][number];
const entry = (key: string): Entry => ({
  id: 'e-p',
  key,
  value: '"A"',
  hash: '17',
  bucket: 2,
  next: null,
});
const mutated: BucketState = { buckets: [null, null, 0], entries: [entry('p (X=5, Y=2)')] };

export default defineStepScript({
  view: 'buckets',
  title: 'Veränderter Schlüssel',
  code: {
    cs: `var p = new Punkt { X = 1, Y = 2 };
var d = new Dictionary<Punkt, string>();
d[p] = "A";
p.X = 5;
Console.WriteLine(d.ContainsKey(p));
Console.WriteLine(d.ContainsKey(new Punkt { X = 1, Y = 2 }));

class Punkt
{
    public int X, Y;
    public override int GetHashCode() => HashCode.Combine(X, Y);
    public override bool Equals(object? o) => o is Punkt q && q.X == X && q.Y == Y;
}`,
  },
  steps: [
    {
      codeLine: 2,
      state: { buckets: [], entries: [] },
      explanation:
        '`Punkt` ist eine Klasse mit veränderlichen Feldern. `GetHashCode` und `Equals` hängen beide von X und Y ab, wie es der Vertrag verlangt.',
    },
    {
      codeLine: 3,
      state: { buckets: [null, null, 0], entries: [entry('p (X=1, Y=2)')] },
      changed: ['bucket-2', 'e-p'],
      explanation:
        'Beim Einfügen berechnet das Dictionary einmal den Hash von (1, 2), hier 17, und legt den Eintrag in Bucket 2 ab. Gespeichert wird ein Verweis auf genau dieses Objekt `p`, keine Kopie.',
    },
    {
      codeLine: 4,
      state: mutated,
      changed: ['e-p'],
      explanation:
        'Jetzt ändert sich das Objekt, auf das der Eintrag zeigt. Das Dictionary bekommt davon nichts mit: Im Eintrag steht weiter Hash 17, und er liegt weiter in Bucket 2. Sein „richtiger“ Hash wäre jetzt aber 22.',
    },
    {
      codeLine: 5,
      state: {
        ...mutated,
        probe: { key: 'p (X=5, Y=2)', hash: '22', bucket: 1, path: [], found: false },
        output: 'False',
      },
      explanation:
        'Die Suche mit demselben Objekt berechnet den aktuellen Hash 22 und landet in Bucket 1. Der ist leer, also „nicht gefunden“, obwohl `p` im Dictionary steckt.',
    },
    {
      codeLine: 6,
      state: {
        ...mutated,
        probe: { key: 'Punkt(1, 2)', hash: '17', bucket: 2, path: [0], found: false },
        output: 'False\nFalse',
      },
      explanation:
        'Ein neuer Punkt (1, 2) trifft den richtigen Bucket und sogar den gespeicherten Hash 17. Doch `Equals` vergleicht mit dem gespeicherten Objekt, und das hat inzwischen X = 5. Der Eintrag ist damit über keinen Schlüssel mehr erreichbar, er belegt aber weiter Platz und zählt in `Count` mit.',
    },
  ],
});
