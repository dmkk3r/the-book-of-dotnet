// Code samples for the VerifyCard in pgo.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const pgoCode = `interface IShape { double Area(); }
sealed class Circle(double r) : IShape { public double Area() => Math.PI * r * r; }
sealed class Square(double a) : IShape { public double Area() => a * a; }

static class Program
{
    static void Main()
    {
        IShape[] shapes = new IShape[1000];
        for (int i = 0; i < shapes.Length; i++)
            shapes[i] = i % 10 == 0 ? new Square(i) : new Circle(i);

        double sum = 0;
        for (int round = 0; round < 200_000; round++)
            foreach (var s in shapes)
                sum += AreaOf(s);
        Console.WriteLine(sum);
    }

    static double AreaOf(IShape? s)
    {
        if (s is null) return 0;
        return s.Area();
    }
}

// Alle Fassungen von AreaOf anzeigen (Tier 0, instrumentiert, Tier 1):
// DOTNET_JitDisasm=AreaOf dotnet run -c Release
// Zum Vergleich ohne Dynamic PGO:
// DOTNET_TieredPGO=0 DOTNET_JitDisasm=AreaOf dotnet run -c Release`;

export const benchmarkCode = `public class PgoBench
{
    private IShape[] _mostlyCircles = null!;
    private IShape[] _mixed = null!;

    [GlobalSetup]
    public void Setup()
    {
        _mostlyCircles = Enumerable.Range(0, 1000)
            .Select(i => i % 10 == 0 ? (IShape)new Square(i) : new Circle(i)).ToArray();
        _mixed = Enumerable.Range(0, 1000)
            .Select(i => (i % 4) switch
            {
                0 => (IShape)new Circle(i),
                1 => new Square(i),
                2 => new Triangle(i),
                _ => new Hexagon(i),
            }).ToArray();
    }

    [Benchmark(Baseline = true)]
    public double MostlyCircles() => Sum(_mostlyCircles);

    [Benchmark]
    public double Megamorphic() => Sum(_mixed);

    private static double Sum(IShape[] shapes)
    {
        double sum = 0;
        foreach (var s in shapes) sum += s.Area();
        return sum;
    }
}

// Einmal mit und einmal ohne Dynamic PGO laufen lassen, etwa mit einer Konfiguration:
// AddJob(Job.Default.WithId("PGO"));
// AddJob(Job.Default.WithId("NoPGO")
//     .WithEnvironmentVariables(new EnvironmentVariable("DOTNET_TieredPGO", "0")));
// Triangle und Hexagon sind weitere IShape-Klassen wie Circle und Square.`;
