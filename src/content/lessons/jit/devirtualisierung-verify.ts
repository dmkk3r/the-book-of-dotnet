// Code samples for the VerifyCard in devirtualisierung.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const devirtCode = `using System.Runtime.CompilerServices;

public abstract class Animal { public abstract int Legs(); }
public sealed class Dog : Animal { public override int Legs() => 4; }
public class Cat : Animal { public override int Legs() => 4; }

public static class Demo
{
    // Typ unbekannt: Aufruf über den Slot der MethodTable
    public static int ViaBase(Animal a) => a.Legs() + 1;

    // sealed: direkter Aufruf, hier sogar eingebettet
    public static int ViaDog(Dog d) => d.Legs() + 1;

    // nicht sealed: bleibt virtuell, denn es könnte eine Ableitung von Cat sein
    public static int ViaCat(Cat c) => c.Legs() + 1;

    // exakter Typ aus new: direkt, obwohl Cat nicht sealed ist
    public static int ViaNewCat() => new Cat().Legs() + 1;

    // Werttyp in Generics: eigener Code für T = int, Equals wird direkt aufgerufen
    public static bool Same<T>(T a, T b) => EqualityComparer<T>.Default.Equals(a, b);
    public static bool SameInt(int a, int b) => Same(a, b);
}

// Lokal: DOTNET_JitDisasm="ViaBase ViaDog ViaCat ViaNewCat SameInt" dotnet run -c Release
// Mit DOTNET_TieredCompilation=0 siehst du direkt den optimierten Code
// (dann ohne Dynamic PGO, also ohne Guarded Devirtualization).`;

export const benchmarkCode = `public class DevirtBench
{
    private readonly Animal[] _animals = new Animal[1024];
    private readonly Dog[] _dogs = new Dog[1024];

    [GlobalSetup]
    public void Setup()
    {
        for (int i = 0; i < _dogs.Length; i++) _animals[i] = _dogs[i] = new Dog();
    }

    [Benchmark(Baseline = true)]
    public int ViaAnimal()
    {
        int sum = 0;
        foreach (Animal a in _animals) sum += a.Legs();
        return sum;
    }

    [Benchmark]
    public int ViaSealedDog()
    {
        int sum = 0;
        foreach (Dog d in _dogs) sum += d.Legs();
        return sum;
    }
}

// Zum Vergleich einen zweiten Job ohne Dynamic PGO anlegen, etwa in der Config:
// AddJob(Job.Default.WithEnvironmentVariables(new EnvironmentVariable("DOTNET_TieredPGO", "0")))`;
